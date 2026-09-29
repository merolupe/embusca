/* ============================================================
   embusca — source adapters
   Each adapter turns an intent into the most precise request its
   API supports, and normalises results to one item shape:
   { id, source, title, artist, artistFull, artistQid, attribution,
     date, years:{start,end}, country, medium, classification,
     keywords[], tagQids[], desc, qid, evidence, thumb, hires,
     museum, url, pop (0..1 popularity), rank (position at source) }
   search(ctx) -> { items, done }   ctx = { intent, page, state,
   signal, enriched (promise), legacy }
   Parameters were checked against each API's behaviour in 2026-09.
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};
  const U = EB.util;
  const DAY = 24 * 3600 * 1000;

  const META = {
    met: { name: 'The Metropolitan Museum of Art', short: 'The Met' },
    aic: { name: 'Art Institute of Chicago', short: 'Art Inst. of Chicago' },
    cma: { name: 'Cleveland Museum of Art', short: 'Cleveland Museum' },
    vam: { name: 'Victoria and Albert Museum', short: 'V&A London' },
    smk: { name: 'Statens Museum for Kunst', short: 'SMK Denmark' },
    wmc: { name: 'Wikidata · Wikimedia Commons', short: 'Wikimedia' },
    wel: { name: 'Wellcome Collection', short: 'Wellcome' },
  };

  const dash = v => (v == null || String(v).trim() === '') ? '—' : String(v);
  const untitled = t => (t && String(t).trim()) || 'Untitled';

  // The phrase a museum is asked for. Free text keeps the user's words;
  // everything else uses the canonical English label from Wikidata.
  function term(intent, legacy) {
    if (legacy) return intent.raw;
    if (intent.kind === 'free') return intent.core || intent.raw;
    return intent.label || intent.core;
  }

  function withRanks(items, start) {
    items.forEach((it, i) => { it.rank = start + i; });
    return items;
  }

  /* ============================================================
     The Met — /v1.1/search (paged IDs) + /v1/objects/{id}.
     /v1/search is retired on 2026-10-01. artistOrCulture=true is
     broken upstream (always 0 results) so it is never sent;
     tags=true (subject keywords) and isHighlight=true do work.
     ============================================================ */
  const MET = 'https://collectionapi.metmuseum.org/public/collection';
  const metCache = U.persistentMap('embusca:met:v1', 900, 30 * DAY);
  const MET_WINDOW = 30;

  function metSearchUrl(v, offset, limit) {
    let u = MET + '/v1.1/search?q=' + encodeURIComponent(v.q) + '&hasImages=true'
      + '&offset=' + offset + '&limit=' + limit;
    if (v.isHighlight) u += '&isHighlight=true';
    if (v.tags) u += '&tags=true';
    if (v.title) u += '&title=true';
    if (v.geoLocation) u += '&geoLocation=' + encodeURIComponent(v.geoLocation);
    return u;
  }

  // Precision-first request plan per intent kind; the `main` entry pages.
  function metPlan(intent, legacy) {
    const t = term(intent, legacy);
    if (legacy) return [{ q: t, main: true }];
    const hl = { q: t, isHighlight: true, limit: 24 };
    switch (intent.kind) {
      case 'artist': return [hl, { q: t, main: true }];
      case 'movement':
        return [hl].concat((intent.artists || []).slice(0, 3).map(a => ({ q: a.name, isHighlight: true, limit: 8 })),
          [{ q: t, main: true }]);
      case 'subject': case 'person':
        return [{ q: t, tags: true, isHighlight: true, limit: 24 }, { q: t, tags: true, main: true, fallback: { q: t } }];
      case 'place': return [hl, { q: t, geoLocation: t, main: true, fallback: { q: t } }];
      case 'artwork': {
        const c = intent.creator && intent.creator.name;
        return [{ q: t, title: true, limit: 12 }].concat(c
          ? [{ q: c, isHighlight: true, limit: 16 }, { q: c, main: true }]
          : [{ q: t, main: true }]);
      }
      default: return [{ q: t, isHighlight: true, limit: 12 }, { q: t, main: true }];
    }
  }

  async function metIds(v, offset, limit, signal) {
    const d = await U.fetchJson(metSearchUrl(v, offset, limit), { timeout: 12000, retries: 2, signal });
    return { ids: d.objectIDs || [], total: Math.min(d.total || 0, 10000) };
  }

  function normMet(o) {
    const tags = (o.tags || []).filter(t => t && t.term);
    const c0 = (o.constituents || [])[0];
    const known = o.objectBeginDate || o.objectEndDate;
    return {
      id: 'met:' + o.objectID, source: 'met',
      title: untitled(o.title),
      artist: o.artistDisplayName || 'Unknown artist',
      artistFull: [o.artistDisplayName, o.artistDisplayBio].filter(Boolean).join(' — '),
      artistQid: U.wikidataId(o.artistWikidata_URL || (c0 && c0.constituentWikidata_URL)),
      attribution: o.artistPrefix || '',
      date: dash(o.objectDate || (known ? U.formatYears({ start: o.objectBeginDate, end: o.objectEndDate }) : '')),
      years: known ? { start: o.objectBeginDate, end: o.objectEndDate } : U.parseYears(o.objectDate),
      country: dash(o.country || o.culture || o.artistNationality),
      medium: dash(o.medium),
      classification: o.classification || o.objectName || '',
      keywords: tags.map(t => t.term).concat([o.objectName, o.classification, o.department, o.culture, o.period].filter(Boolean)),
      tagQids: tags.map(t => U.wikidataId(t.Wikidata_URL)).filter(Boolean),
      qid: U.wikidataId(o.objectWikidata_URL),
      thumb: o.primaryImageSmall, hires: o.primaryImage || o.primaryImageSmall,
      museum: META.met.name,
      url: o.objectURL || ('https://www.metmuseum.org/art/collection/search/' + o.objectID),
      pop: o.isHighlight ? 1 : 0,
    };
  }

  async function metObject(id, signal) {
    const hit = metCache.get(id);
    if (hit) return hit.none ? null : Object.assign({}, hit);
    const o = await U.fetchJson(MET + '/v1/objects/' + id, { timeout: 12000, retries: 1, signal, ttl: 0 });
    if (!o || !o.primaryImageSmall) { metCache.set(id, { none: true }); return null; }
    const it = normMet(o);
    metCache.set(id, it);
    return Object.assign({}, it);
  }

  const met = {
    key: 'met',
    async search(ctx) {
      const st = ctx.state;
      if (ctx.page === 1 || !st.ids) {
        const plan = metPlan(ctx.intent, ctx.legacy);
        const res = await Promise.all(plan.map(v =>
          metIds(v, 0, v.main ? 80 : (v.limit || 24), ctx.signal).catch(e => ({ ids: [], total: 0, error: e }))));
        const mainIdx = plan.findIndex(v => v.main);
        let main = plan[mainIdx], mainRes = res[mainIdx];
        if (main.fallback && mainRes.total < 12) {   // e.g. no subject tag -> plain keyword
          main = Object.assign({ main: true }, main.fallback);
          mainRes = await metIds(main, 0, 80, ctx.signal).catch(e => ({ ids: [], total: 0, error: e }));
        }
        if (res.every(r => r.error) && mainRes.error) throw mainRes.error;
        // precision variants first (highlights, tags, movement artists), then the main query
        const precision = res.filter((r, i) => i !== mainIdx).map(r => r.ids);
        st.ids = U.uniq([].concat(...precision, res[mainIdx].ids, mainRes.ids));
        st.main = main; st.mainOffset = mainRes.ids.length; st.mainTotal = mainRes.total; st.cursor = 0;
      }
      // top up the ID queue from the main query when it runs low
      if (st.ids.length - st.cursor < MET_WINDOW && st.mainOffset < st.mainTotal) {
        const more = await metIds(st.main, st.mainOffset, 100, ctx.signal).catch(() => ({ ids: [] }));
        st.mainOffset += Math.max(more.ids.length, 100);
        st.ids = U.uniq(st.ids.concat(more.ids));
      }
      const start = st.cursor;
      const window = st.ids.slice(start, start + MET_WINDOW);
      st.cursor += window.length;
      let failures = 0;
      const objs = await U.mapLimit(window, 6, id => metObject(id, ctx.signal).catch(() => { failures++; return null; }));
      if (window.length && failures === window.length) throw new Error('rate-limited — try again in a minute');
      const items = [];
      objs.forEach((o, i) => { if (o) { o.rank = start + i; items.push(o); } });
      return { items, done: st.cursor >= st.ids.length && st.mainOffset >= st.mainTotal };
    },
  };

  /* ============================================================
     Art Institute of Chicago — Elasticsearch behind a REST facade.
     Filters must be one bool/must array (sibling clauses -> 400).
     ============================================================ */
  const AIC_FIELDS = 'id,title,artist_display,artist_title,artist_titles,date_display,date_start,date_end,'
    + 'place_of_origin,image_id,medium_display,classification_title,classification_titles,style_title,'
    + 'style_titles,subject_titles,term_titles,theme_titles,artwork_type_title,thumbnail,is_boosted';

  function normAIC(a) {
    const kw = [].concat(a.style_titles || [], a.subject_titles || [], a.classification_titles || [],
      a.term_titles || [], a.theme_titles || [], a.artwork_type_title || [], a.style_title || []).filter(Boolean);
    return {
      id: 'aic:' + a.id, source: 'aic',
      title: untitled(a.title),
      artist: a.artist_title || (a.artist_display || 'Unknown artist').split('\n')[0],
      artistFull: a.artist_display || '',
      artistAll: a.artist_titles || [],
      date: dash(a.date_display),
      years: a.date_start != null ? { start: a.date_start, end: a.date_end != null ? a.date_end : a.date_start } : U.parseYears(a.date_display),
      country: dash(a.place_of_origin),
      medium: dash(a.medium_display),
      classification: a.artwork_type_title || a.classification_title || '',
      keywords: U.uniq(kw),
      desc: (a.thumbnail && a.thumbnail.alt_text) || '',
      thumb: 'https://www.artic.edu/iiif/2/' + a.image_id + '/full/400,/0/default.jpg',
      hires: 'https://www.artic.edu/iiif/2/' + a.image_id + '/full/1686,/0/default.jpg',
      museum: META.aic.name,
      url: 'https://www.artic.edu/artworks/' + a.id,
      pop: a.is_boosted ? 0.7 : 0,
    };
  }

  const aic = {
    key: 'aic',
    async search(ctx) {
      const limit = 40;
      const url = 'https://api.artic.edu/api/v1/artworks/search?q=' + encodeURIComponent(term(ctx.intent, ctx.legacy))
        + '&query[bool][must][0][term][is_public_domain]=true'
        + '&query[bool][must][1][exists][field]=image_id'
        + '&fields=' + AIC_FIELDS + '&limit=' + limit + '&page=' + ctx.page;
      const d = await U.fetchJson(url, { signal: ctx.signal, retries: 1 });
      const rows = (d.data || []).filter(a => a.image_id);
      const pg = d.pagination || {};
      const done = (d.data || []).length < limit || (pg.total_pages && ctx.page >= pg.total_pages) || ctx.page * limit >= 1000;
      return { items: withRanks(rows.map(normAIC), (ctx.page - 1) * limit), done: !!done };
    },
  };

  /* ============================================================
     Cleveland Museum of Art — `artists` filters by creator name.
     ============================================================ */
  const CMA_FIELDS = 'id,title,creators,creation_date,creation_date_earliest,creation_date_latest,culture,'
    + 'technique,type,department,images,url,accession_number,description';

  function normCMA(a) {
    const creator = (a.creators && a.creators[0] && a.creators[0].description) || '';
    const early = a.creation_date_earliest, late = a.creation_date_latest;
    return {
      id: 'cma:' + a.id, source: 'cma',
      title: untitled(a.title),
      artist: creator ? creator.split('(')[0].trim() : 'Unknown artist',
      artistFull: creator,
      date: dash(a.creation_date),
      years: early != null && late != null ? { start: early, end: late } : U.parseYears(a.creation_date),
      country: dash(a.culture && a.culture[0]),
      medium: dash(a.technique),
      classification: a.type || '',
      keywords: [a.type, a.department, a.technique].concat(a.culture || []).filter(Boolean),
      desc: U.stripHtml(a.description || '').slice(0, 700),
      thumb: a.images.web.url,
      hires: (a.images.print && a.images.print.url) || a.images.web.url,
      museum: META.cma.name,
      url: a.url || ('https://www.clevelandart.org/art/' + (a.accession_number || '')),
    };
  }

  const cma = {
    key: 'cma',
    async search(ctx) {
      const limit = 40, skip = (ctx.page - 1) * limit, st = ctx.state;
      const base = 'https://openaccess-api.clevelandart.org/api/artworks/?has_image=1&cc0=1&limit=' + limit
        + '&skip=' + skip + '&fields=' + CMA_FIELDS;
      const t = term(ctx.intent, ctx.legacy);
      if (st.byArtist === undefined) st.byArtist = !ctx.legacy && ctx.intent.kind === 'artist';
      let d = await U.fetchJson(base + (st.byArtist ? '&artists=' : '&q=') + encodeURIComponent(t), { signal: ctx.signal, retries: 1 });
      if (st.byArtist && ctx.page === 1 && !(d.data || []).length) {
        st.byArtist = false;
        d = await U.fetchJson(base + '&q=' + encodeURIComponent(t), { signal: ctx.signal, retries: 1 });
      }
      const rows = (d.data || []).filter(a => a.images && a.images.web && a.images.web.url);
      const total = d.info && d.info.total;
      const done = (d.data || []).length < limit || (total != null && skip + limit >= total);
      return { items: withRanks(rows.map(normCMA), skip), done };
    },
  };

  /* ============================================================
     V&A — default ordering is relevance; q_actor targets makers.
     ============================================================ */
  function normVAM(r) {
    const base = r._images._iiif_image_base_url;
    const maker = (r._primaryMaker && r._primaryMaker.name) || 'Unknown artist';
    return {
      id: 'vam:' + r.systemNumber, source: 'vam',
      title: dash(r._primaryTitle) === '—' ? (r.objectType || 'Untitled') : r._primaryTitle,
      artist: maker, artistFull: maker,
      attribution: (r._primaryMaker && r._primaryMaker.association) || '',
      date: dash(r._primaryDate), years: U.parseYears(r._primaryDate),
      country: dash(r._primaryPlace),
      medium: dash(r.objectType), classification: r.objectType || '',
      keywords: [r.objectType, r._primaryPlace].filter(Boolean),
      thumb: base + 'full/!400,400/0/default.jpg',
      hires: base + 'full/!1600,1600/0/default.jpg',
      museum: META.vam.name,
      url: 'https://collections.vam.ac.uk/item/' + r.systemNumber,
    };
  }

  const vam = {
    key: 'vam',
    async search(ctx) {
      const limit = 40, st = ctx.state;
      const t = term(ctx.intent, ctx.legacy);
      if (st.byActor === undefined) st.byActor = !ctx.legacy && ctx.intent.kind === 'artist';
      const url = p => 'https://api.vam.ac.uk/v2/objects/search?' + p + '=' + encodeURIComponent(t)
        + '&images_exist=1&page_size=' + limit + '&page=' + ctx.page;
      let d = await U.fetchJson(url(st.byActor ? 'q_actor' : 'q'), { signal: ctx.signal, retries: 1 });
      if (st.byActor && ctx.page === 1 && !(d.records || []).length) {
        st.byActor = false;
        d = await U.fetchJson(url('q'), { signal: ctx.signal, retries: 1 });
      }
      const rows = (d.records || []).filter(r => r._images && r._images._iiif_image_base_url);
      const pages = d.info && d.info.pages;
      const done = (d.records || []).length < limit || (pages != null && ctx.page >= pages);
      return { items: withRanks(rows.map(normVAM), (ctx.page - 1) * limit), done };
    },
  };

  /* ============================================================
     SMK — metadata is largely Danish, so topics are sent in Danish.
     ============================================================ */
  function smkTerm(intent, legacy) {
    if (legacy) return intent.raw;
    const k = intent.kind;
    if ((k === 'subject' || k === 'genre' || k === 'movement') && intent.labels && intent.labels.da) return intent.labels.da;
    if ((k === 'subject' || k === 'genre' || k === 'movement') && intent.lexicon && intent.lexicon.da && intent.lexicon.da[0]) return intent.lexicon.da[0];
    return term(intent, legacy);
  }

  function normSMK(a) {
    const titles = (a.titles || []).filter(t => t && t.title);
    const en = titles.find(t => /english|engelsk/i.test(t.language || ''));
    const prod = (a.production && a.production[0]) || {};
    const pd = (a.production_date && a.production_date[0]) || {};
    const iso = s => { const m = String(s || '').match(/^(-?\d{1,4})-/); return m ? +m[1] : null; };
    const ys = iso(pd.start), ye = iso(pd.end);
    const artist = (a.artist && a.artist[0]) || 'Unknown artist';
    const names = (a.object_names || []).map(o => o && o.name).filter(Boolean);
    return {
      id: 'smk:' + a.object_number, source: 'smk',
      title: untitled((en || titles[0] || {}).title),
      artist, artistFull: artist,
      date: dash(pd.period),
      years: ys != null ? { start: ys, end: ye != null ? ye : ys } : U.parseYears(pd.period),
      country: dash(prod.creator_nationality),
      medium: dash(a.techniques && a.techniques.join(', ')),
      classification: names[0] || '',
      keywords: names.concat(a.techniques || [], titles.map(t => t.title)),
      thumb: a.image_thumbnail.replace('!1024,', '!400,'),
      // image_native is a slow full download; the IIIF server at 2048px is fast
      hires: a.image_thumbnail.replace('!1024,', '!2048,'),
      museum: META.smk.name,
      url: a.frontend_url || ('https://open.smk.dk/artwork/image/' + (a.object_number || '')),
    };
  }

  const smk = {
    key: 'smk',
    async search(ctx) {
      const limit = 40, offset = (ctx.page - 1) * limit;
      const url = 'https://api.smk.dk/api/v1/art/search/?keys=' + encodeURIComponent(smkTerm(ctx.intent, ctx.legacy))
        + '&filters=' + encodeURIComponent('[has_image:true],[public_domain:true]')
        + '&rows=' + limit + '&offset=' + offset;
      const d = await U.fetchJson(url, { signal: ctx.signal, retries: 1 });
      const rows = (d.items || []).filter(a => a.image_thumbnail);
      const done = (d.items || []).length < limit || (d.found != null && offset + limit >= d.found);
      return { items: withRanks(rows.map(normSMK), offset), done };
    },
  };

  /* ============================================================
     Wikimedia — Wikidata (semantic) first, Commons text as fallback.
     SPARQL is plain SPARQL 1.1 (no label service, no mwapi) so it
     survives WDQS's move from Blazegraph to QLever.
     ============================================================ */
  const ART_TYPES = 'wd:Q3305213 wd:Q93184 wd:Q11060274 wd:Q18761202 wd:Q860861 wd:Q838948 wd:Q179700 wd:Q219423 wd:Q79218';
  const SPARQL_KINDS = new Set(['artist', 'movement', 'genre', 'subject', 'person', 'place', 'artwork']);
  const NON_ART = /\b(diagram|diagrams|infographic|flowchart|schematic|screenshot|chart|charts|clipart|logo|logos|map|maps|coat of arms|coats of arms|title page|flag of|flags of|seal of|signature)\b/;

  function worksQuery(intent, limit, offset) {
    const Q = 'wd:' + intent.qid;
    let where;
    switch (intent.kind) {
      case 'artist':
        where = '?item wdt:P170 ' + Q + ' . BIND("artist" AS ?via) MINUS { ?item wdt:P31 wd:Q133492 }';
        break;
      case 'movement': {
        // the movement's best-known artists only: keeps the join small enough for WDQS
        const arts = (intent.artists || []).filter(a => a.qid).slice(0, 8).map(a => 'wd:' + a.qid).join(' ');
        where = '{ ?item wdt:P135 ' + Q + ' ; wdt:P31 ?type . VALUES ?type { ' + ART_TYPES + ' } BIND("style" AS ?via) }'
          + (arts ? ' UNION { VALUES ?artist { ' + arts + ' } ?item wdt:P170 ?artist ; wdt:P31 wd:Q3305213 . BIND("artist" AS ?via) }' : '');
        break;
      }
      case 'genre':
        where = '?item wdt:P136 ' + Q + ' ; wdt:P31 ?type . VALUES ?type { ' + ART_TYPES + ' } BIND("genre" AS ?via)';
        break;
      case 'subject': case 'person':
        where = '?item wdt:P180 ' + Q + ' ; wdt:P31 ?type . VALUES ?type { ' + ART_TYPES + ' } BIND("depicts" AS ?via)';
        break;
      case 'place':
        // paintings depicting the place, or by painters who were its citizens
        where = '{ ?item wdt:P31 wd:Q3305213 ; wdt:P180 ' + Q + ' . BIND("depicts" AS ?via) }'
          + ' UNION { ?artist wdt:P27 ' + Q + ' ; wdt:P106 wd:Q1028181 . ?item wdt:P170 ?artist ; wdt:P31 wd:Q3305213 . BIND("artist" AS ?via) }';
        break;
      case 'artwork':
        where = '{ VALUES ?item { ' + Q + ' } BIND("self" AS ?via) }'
          + (intent.creator && intent.creator.qid ? ' UNION { ?item wdt:P170 wd:' + intent.creator.qid + ' . BIND("creator" AS ?via) }' : '');
        break;
      default: return null;
    }
    return 'SELECT ?item ?via ?image ?label ?labelPt ?inception ?creator ?creatorL ?collL ?sl WHERE { ' + where
      + ' ?item wdt:P18 ?image .'
      + ' OPTIONAL { ?item wikibase:sitelinks ?sl }'
      + ' OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) IN ("en","mul")) }'
      + ' OPTIONAL { ?item rdfs:label ?labelPt FILTER(LANG(?labelPt) = "pt") }'
      + ' OPTIONAL { ?item wdt:P571 ?inception }'
      + ' OPTIONAL { ?item wdt:P170 ?creator . OPTIONAL { ?creator rdfs:label ?creatorL FILTER(LANG(?creatorL) IN ("en","mul")) } }'
      + ' OPTIONAL { ?item wdt:P195 ?coll . ?coll rdfs:label ?collL FILTER(LANG(?collL) = "en") }'
      + ' } ORDER BY DESC(?sl) ?item LIMIT ' + limit + ' OFFSET ' + offset;
  }

  function commonsFile(uri) {
    const m = String(uri || '').match(/Special:FilePath\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function wdRows(rows, intent, seen) {
    const out = [];
    for (const r of rows) {
      const qid = U.wikidataId(r.item.value);
      if (!qid || seen.has(qid)) continue;
      const file = commonsFile(r.image && r.image.value);
      if (!file || /\.(svg|pdf|djvu|webm|ogv|ogg|stl|mp3|wav)$/i.test(file)) continue;
      seen.add(qid);
      const ys = r.inception ? U.parseYears(r.inception.value) : null;
      const base = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file.replace(/ /g, '_'));
      const creator = r.creatorL ? r.creatorL.value : '';
      out.push({
        id: 'wd:' + qid, source: 'wmc', qid,
        title: untitled((r.label && r.label.value) || (r.labelPt && r.labelPt.value)),
        artist: creator || 'Unknown artist', artistFull: creator,
        artistQid: r.creator ? U.wikidataId(r.creator.value) : null,
        date: ys ? U.formatYears(ys) : '—', years: ys,
        country: '—', medium: '—', classification: '',
        keywords: [],
        evidence: { kind: intent.kind, qid: intent.qid, via: r.via ? r.via.value : '' },
        thumb: base + '?width=400', hires: base + '?width=2000',
        museum: (r.collL && r.collL.value) || META.wmc.name,
        url: 'https://www.wikidata.org/wiki/' + qid,
        pop: r.sl ? Math.min(1, Math.log10(1 + Number(r.sl.value)) / 2) : 0,
      });
    }
    return out;
  }

  function normCommons(p) {
    const info = p.imageinfo[0];
    const m = info.extmetadata || {};
    const get = k => m[k] ? U.stripHtml(m[k].value) : '';
    const title = get('ObjectName') || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
    const date = get('DateTimeOriginal');
    return {
      id: 'wmc:' + (p.pageid || p.title), source: 'wmc',
      title: untitled(title.replace(/\s*(?:title|label)\s*QS:.*$/, '')),
      artist: get('Artist') || 'Unknown artist', artistFull: get('Artist'),
      date: dash(date), years: U.parseYears(date),
      country: '—', medium: '—', classification: '',
      keywords: get('Categories').split('|').filter(Boolean),
      desc: get('ImageDescription').slice(0, 500),
      thumb: info.thumburl, hires: info.url,
      museum: META.wmc.name,
      url: info.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title)),
    };
  }

  async function commonsPage(ctx, offset) {
    const t = term(ctx.intent, ctx.legacy);
    const medium = ctx.intent.medium;
    const q = ctx.legacy ? t + ' painting' : t + (medium && medium !== 'painting' ? '' : ' painting') + ' filetype:bitmap';
    const limit = 40;
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
      + '&generator=search&gsrsearch=' + encodeURIComponent(q)
      + '&gsrnamespace=6&gsrlimit=' + limit + '&gsroffset=' + offset
      + '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400';
    const d = await U.fetchJson(url, { signal: ctx.signal, retries: 1 });
    const pages = d.query ? Object.values(d.query.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)) : [];
    const items = pages
      .filter(p => p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl && /\.(jpe?g|png)$/i.test(p.imageinfo[0].url || ''))
      .map(normCommons)
      .filter(it => ctx.legacy || !NON_ART.test(U.norm(it.title + ' ' + it.keywords.join(' '))));
    return { items: withRanks(items, offset), done: !d.continue };
  }

  const wmc = {
    key: 'wmc',
    async search(ctx) {
      const st = ctx.state, intent = ctx.intent;
      if (st.sparqlOffset === undefined) {
        st.sparqlOffset = 0; st.commonsOffset = 0; st.seen = new Set();
        st.useSparql = !ctx.legacy && !!intent.qid && SPARQL_KINDS.has(intent.kind);
      }
      if (st.useSparql) {
        if (intent.kind === 'movement' || intent.kind === 'artwork') await ctx.enriched;
        try {
          const limit = 48;
          const d = await EB.intent.sparql(worksQuery(intent, limit, st.sparqlOffset), ctx.signal, 15000);
          const rows = (d.results && d.results.bindings) || [];
          const items = withRanks(wdRows(rows, intent, st.seen), st.sparqlOffset);
          st.sparqlOffset += limit;
          if (rows.length < limit) st.useSparql = false;
          if (items.length) return { items, done: false };
        } catch (e) {
          st.useSparql = false;
          st.sparqlError = e.message;
        }
      }
      const res = await commonsPage(ctx, st.commonsOffset);
      st.commonsOffset += 40;
      return res;
    },
  };

  /* ============================================================
     Wellcome Collection — pictures only, open licences only.
     ============================================================ */
  function normWEL(r) {
    const artist = (r.contributors && r.contributors[0] && r.contributors[0].agent && r.contributors[0].agent.label) || 'Unknown artist';
    const prod = (r.production && r.production[0]) || {};
    const date = (prod.dates && prod.dates[0] && prod.dates[0].label) || '';
    return {
      id: 'wel:' + r.id, source: 'wel',
      title: untitled(r.title),
      artist, artistFull: artist,
      date: dash(date), years: U.parseYears(date),
      country: '—', medium: dash(prod.label), classification: (r.workType && r.workType.label) || '',
      keywords: [].concat((r.subjects || []).map(s => s.label), (r.genres || []).map(g => g.label)).filter(Boolean),
      thumb: r.thumbnail.url.replace('300,', '!400,400'),
      hires: r.thumbnail.url.replace('full/300,', 'full/!1800,1800'),
      museum: META.wel.name,
      url: 'https://wellcomecollection.org/works/' + r.id,
    };
  }

  const wel = {
    key: 'wel',
    async search(ctx) {
      const limit = 40;
      const url = 'https://api.wellcomecollection.org/catalogue/v2/works?query=' + encodeURIComponent(term(ctx.intent, ctx.legacy))
        + '&workType=k&items.locations.license=cc0,pdm&pageSize=' + limit + '&page=' + ctx.page
        + '&include=production,contributors,subjects,genres';
      const d = await U.fetchJson(url, { signal: ctx.signal, retries: 1 });
      const rows = (d.results || []).filter(r => r.thumbnail && r.thumbnail.url);
      const done = (d.results || []).length < limit || (d.totalPages != null && ctx.page >= d.totalPages);
      return { items: withRanks(rows.map(normWEL), (ctx.page - 1) * limit), done };
    },
  };

  const ADAPTERS = { met, aic, cma, vam, smk, wmc, wel };

  EB.sources = { META, ADAPTERS, metPlan, metSearchUrl, worksQuery, term, smkTerm, normMet, normAIC, normCMA, normVAM, normSMK, normWEL, normCommons, wdRows };
})(typeof globalThis !== 'undefined' ? globalThis : this);
