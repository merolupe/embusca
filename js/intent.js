/* ============================================================
   embusca — query understanding
   "gatos", "van gogh", "impressionismo" -> a typed intent:
   { kind: artist | movement | genre | subject | place | artwork |
           person | free, qid, English label, aliases, … }
   Resolved against Wikidata (keyless, CORS-enabled), with the
   built-in lexicon as an offline fallback. Nothing here needs keys.
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};
  const U = EB.util, L = EB.lexicon;

  const WD_API = 'https://www.wikidata.org/w/api.php';
  const WDQS = 'https://query.wikidata.org/sparql';
  const DAY = 24 * 3600 * 1000;

  /* ---------- Wikidata type tables ---------- */

  const HUMAN = 'Q5';
  const ART_OCC = new Set([
    'Q1028181', // painter
    'Q483501', // artist
    'Q3391743', // visual artist
    'Q1281618', // sculptor
    'Q11569986', // printmaker
    'Q329439', // engraver
    'Q15296811', // draughtsperson
    'Q644687', // illustrator
    'Q33231', // photographer
    'Q42973', // architect
    'Q5322166', // designer
    'Q16947657', // lithographer
    'Q1925963', // graphic artist
    'Q7541856', // ceramicist
    'Q18074503', // watercolorist
    'Q10862983', // etcher
    'Q3303330', // calligrapher
    'Q211423', // goldsmith
  ]);
  const MOVEMENT = new Set(['Q968159', 'Q1792644', 'Q32880', 'Q2198855', 'Q11514315']);
  const GENRE = new Set(['Q1792379']);
  const ARTWORK = new Set(['Q3305213', 'Q838948', 'Q860861', 'Q93184', 'Q11060274', 'Q179700', 'Q219423', 'Q79218', 'Q15727816', 'Q18761202']);
  const PLACE = new Set(['Q6256', 'Q3624078', 'Q515', 'Q1549591', 'Q5119', 'Q3184121', 'Q485258', 'Q82794', 'Q5107', 'Q23442', 'Q486972', 'Q107390', 'Q15284', 'Q484170', 'Q200250', 'Q3024240', 'Q35657', 'Q1637706']);
  // Things that are never what an art search means.
  const MEDIA = new Set([
    'Q4167410', 'Q101352', 'Q202444', 'Q12308941', 'Q11879590', 'Q11424', 'Q2743', 'Q482994',
    'Q7366', 'Q134556', 'Q5398426', 'Q7889', 'Q215380', 'Q7725634', 'Q571', 'Q13442814',
    'Q4830453', 'Q783794', 'Q13406463', 'Q4167836', 'Q33506', 'Q5633421', 'Q41298',
    'Q1002697', 'Q24856', 'Q1259759', 'Q21191270', 'Q2188189', 'Q15416', 'Q18127', 'Q1344', 'Q25379',
  ]);

  // Fallback classifier on English descriptions ("Dutch painter (1853–1890)").
  const DESC = [
    ['media', /\b(film|musical|album|song|single by|television|tv series|video game|band|novel|family name|given name|surname|disambiguation|company|magazine|journal|newspaper|scholarly article|scientific article|opera by|play by|board game|football|sports)\b/],
    ['artist', /\b(painter|artist|sculptor|printmaker|engraver|etcher|lithographer|illustrator|photographer|draughts(man|woman|person)|draftsman|architect|ceramicist|potter|miniaturist|watercolou?rist|calligrapher|muralist|woodcut)\b/],
    ['movement', /\b(art movement|artistic movement|movement in|style of|art style|architectural style|period of|school of painting|painting style|cultural movement|historical period)\b/],
    ['genre', /\b(genre of|art genre|genre in|painting genre|genre of painting)\b/],
    ['artwork', /\b(painting by|sculpture by|work by|artwork by|drawing by|print by|series of paintings|fresco by|mural by|triptych by)\b/],
    ['place', /\b(country in|country of|sovereign state|capital of|city in|city of|state of|state in|island|region of|municipality|province of|continent)\b/],
  ];

  const KIND_PRIOR = { artist: 3, movement: 3, genre: 3, artwork: 2, subject: 2, place: 2, person: 1.5, media: -4 };

  const qidOf = uri => { const m = String(uri || '').match(/(Q\d+)$/); return m ? m[1] : null; };

  /* ---------- query parsing ---------- */

  function guessLang(text) {
    const lower = String(text).toLowerCase();
    const f = ' ' + U.norm(text) + ' ';
    if (/[ãõç]/.test(lower)) return 'pt';
    if (/ (de|do|da|dos|das|com|em|na|no|pinturas?|quadros?|obras?|arte|estilo) /.test(f)) return 'pt';
    if (/[a-z](cao|coes|oes|ismo|ista|istas|agem|agens|inho|inha|eira)\b/.test(f)) return 'pt';
    if (root.navigator && /^pt/i.test(root.navigator.language || '')) return 'pt';
    return 'en';
  }

  function singular(word) {
    const w = word;
    if (w.length < 4) return w;
    if (/(oes|aes)$/.test(w)) return w.slice(0, -3) + 'ao';
    if (/ns$/.test(w)) return w.slice(0, -2) + 'm';
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
    if (/[rz]es$/.test(w) && w.length > 5) return w.slice(0, -2);
    if (/ais$/.test(w)) return w.slice(0, -2) + 'l';
    if (/[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }

  // "impressionist" -> "impressionism", "cubista" -> "cubismo".
  function nounOf(word) {
    if (/ists?$/.test(word)) return word.replace(/ists?$/, 'ism');
    if (/istas?$/.test(word)) return word.replace(/istas?$/, 'ismo');
    return null;
  }

  function parse(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const words = text ? text.split(' ') : [];
    const strip = w => { const k = U.norm(w); return !k || L.GENERIC.has(k) || U.STOP.has(k); };
    let medium = null, a = 0, b = words.length;
    while (a < b && strip(words[a])) { medium = medium || L.mediumOf(words[a]); a++; }
    while (b > a && strip(words[b - 1])) { medium = medium || L.mediumOf(words[b - 1]); b--; }
    const core = words.slice(a, b).join(' ') || text;
    const lang = guessLang(text);

    const variants = [core];
    const cw = core.split(' ');
    const last = cw[cw.length - 1];
    const sing = singular(U.fold(last));
    if (sing !== U.fold(last)) variants.push(cw.slice(0, -1).concat(sing).join(' '));
    if (cw.length === 1) {
      const n = nounOf(U.fold(core));
      if (n) variants.push(n);
    } else if (cw.length <= 3 && !/-/.test(core) && L.lookup(core)) {
      variants.push(cw.join('-'));   // "natureza morta" -> "natureza-morta"
    }
    // leading articles are part of titles ("The Starry Night")
    if (a > 0 && words.slice(0, a).every(w => U.STOP.has(U.norm(w)))) variants.push(text);
    return { raw: text, core, lang, medium, variants: U.uniq(variants).slice(0, 3) };
  }

  /* ---------- Wikidata calls ---------- */

  function sparql(query, signal, timeout) {
    return U.fetchJson(WDQS + '?format=json&query=' + encodeURIComponent(query),
      { timeout: timeout || 12000, signal, ttl: 3600 * 1000 });
  }

  async function wbSearch(text, lang, signal) {
    const url = WD_API + '?action=wbsearchentities&format=json&origin=*&type=item&limit=8'
      + '&language=' + lang + '&uselang=' + lang + '&search=' + encodeURIComponent(text);
    const data = await U.fetchJson(url, { timeout: 6000, retries: 1, signal, ttl: DAY });
    return (data.search || []).map((r, i) => ({
      id: r.id,
      label: r.label || (r.display && r.display.label && r.display.label.value) || '',
      matchText: (r.match && r.match.text) || r.label || '',
      rank: i, lang, variant: text,
    }));
  }

  async function wbEntities(ids, signal) {
    const base = WD_API + '?action=wbgetentities&format=json&origin=*&languagefallback=1'
      + '&props=labels|descriptions|aliases|sitelinks&ids=' + ids.join('|');
    // "mul" holds the language-neutral label most names now live in.
    let data = await U.fetchJson(base + '&languages=en|pt|da|mul', { timeout: 8000, retries: 1, signal, ttl: DAY });
    if (data && data.error) data = await U.fetchJson(base + '&languages=en|pt|da', { timeout: 8000, signal, ttl: DAY });
    return (data && data.entities) || {};
  }

  async function classify(ids, signal) {
    const q = 'SELECT ?item ?t ?o WHERE { VALUES ?item { ' + ids.map(i => 'wd:' + i).join(' ')
      + ' } OPTIONAL { ?item wdt:P31 ?t } OPTIONAL { ?item wdt:P106 ?o } }';
    const data = await sparql(q, signal, 7000);
    const out = {};
    for (const b of (data.results && data.results.bindings) || []) {
      const id = qidOf(b.item.value);
      const e = out[id] || (out[id] = { types: new Set(), occs: new Set() });
      if (b.t) e.types.add(qidOf(b.t.value));
      if (b.o) e.occs.add(qidOf(b.o.value));
    }
    return out;
  }

  const term = (obj, lang) => obj && obj[lang] ? obj[lang].value : '';

  function entityInfo(e) {
    const labels = e.labels || {}, aliases = e.aliases || {}, sl = e.sitelinks || {};
    const mul = term(labels, 'mul');
    return {
      id: e.id,
      labels: { en: term(labels, 'en') || mul, pt: term(labels, 'pt') || mul, da: term(labels, 'da') },
      descEn: term(e.descriptions, 'en'),
      descPt: term(e.descriptions, 'pt'),
      aliases: U.uniq(['en', 'pt', 'da', 'mul'].flatMap(l => (aliases[l] || []).map(a => a.value))),
      sitelinks: Object.keys(sl).length,
      wiki: { en: sl.enwiki && sl.enwiki.title, pt: sl.ptwiki && sl.ptwiki.title },
    };
  }

  function kindOf(info, cls) {
    const desc = U.fold(info.descEn || '');
    const descKind = (DESC.find(([, re]) => re.test(desc)) || [])[0] || null;
    if (cls) {
      const t = [...cls.types];
      if (t.some(x => MEDIA.has(x))) return 'media';
      if (cls.types.has(HUMAN)) {
        return ([...cls.occs].some(x => ART_OCC.has(x)) || descKind === 'artist') ? 'artist' : 'person';
      }
      if (t.some(x => MOVEMENT.has(x))) return 'movement';
      if (t.some(x => GENRE.has(x))) return 'genre';
      if (t.some(x => ARTWORK.has(x))) return 'artwork';
      if (t.some(x => PLACE.has(x))) return 'place';
    }
    return descKind || 'subject';
  }

  /* ---------- resolution ---------- */

  const cache = U.persistentMap('embusca:intent:v1', 120, 7 * DAY);

  function lexiconIntent(p, entry) {
    return {
      raw: p.raw, core: p.core, lang: p.lang, medium: p.medium,
      kind: entry.kind, qid: null, source: 'lexicon', confidence: 0.6,
      label: entry.en, labels: { en: entry.en, pt: (entry.pt || [])[0] || '', da: (entry.da || [])[0] || '' },
      description: '', aliases: [].concat(entry.alt || [], entry.pt || [], entry.da || []),
      lexicon: entry, wiki: {}, alternatives: [],
      years: entry.years ? { start: entry.years[0], end: entry.years[1] } : null,
    };
  }

  function freeIntent(p, alternatives) {
    return {
      raw: p.raw, core: p.core, lang: p.lang, medium: p.medium, kind: 'free', qid: null,
      source: 'none', confidence: 0, label: p.core, labels: { en: p.core }, description: '',
      aliases: [], lexicon: null, wiki: {}, alternatives: alternatives || [],
    };
  }

  function candidateScore(c, p, entry) {
    const n = U.norm(c.matchText);
    let mq = 0.3;
    if (n === U.norm(p.core)) mq = 3;
    else if (p.variants.some(v => U.norm(v) === n)) mq = 2.5;
    else if (p.variants.some(v => n.startsWith(U.norm(v)))) mq = 1;
    let s = mq + (KIND_PRIOR[c.kind] || 0) + Math.log10(1 + (c.info.sitelinks || 0)) * 1.2 + (8 - c.rank) * 0.08;
    if (entry) {
      const names = [entry.en].concat(entry.alt || []).map(U.norm);
      if (names.includes(U.norm(c.info.labels.en))) s += 3;
    }
    return { score: s, matchQuality: mq };
  }

  function buildIntent(p, c, alternatives, entry) {
    const i = c.info;
    const label = i.labels.en || i.labels.pt || c.label;
    return {
      raw: p.raw, core: p.core, lang: p.lang, medium: p.medium,
      kind: c.kind, qid: c.id, source: 'wikidata', confidence: Math.min(1, c.score / 10),
      label, labels: { en: label, pt: i.labels.pt || '', da: i.labels.da || (entry && entry.da ? entry.da[0] : '') },
      description: i.descEn || '', descriptionPt: i.descPt || '',
      aliases: U.uniq(i.aliases.concat(entry ? [].concat(entry.alt || [], entry.pt || []) : [])),
      lexicon: entry && entry.kind === c.kind ? entry : null,
      wiki: i.wiki, sitelinks: i.sitelinks, alternatives,
      years: entry && entry.years ? { start: entry.years[0], end: entry.years[1] } : null,
    };
  }

  // Candidates for a parsed query, scored. Exposed for tests/diagnostics.
  async function candidates(p, signal, pin) {
    let found;
    if (pin) {
      found = [{ id: pin, label: '', matchText: p.core, rank: 0 }];
    } else {
      const langs = p.lang === 'pt' ? ['pt', 'en'] : ['en', 'pt'];
      const calls = [];
      p.variants.forEach(v => langs.forEach(l => calls.push(wbSearch(v, l, signal).catch(() => []))));
      const lists = await Promise.all(calls);
      const byId = new Map();
      for (const c of lists.flat()) {
        const prev = byId.get(c.id);
        const exact = U.norm(c.matchText) === U.norm(c.variant);
        if (!prev || (exact && !prev.exact) || (exact === prev.exact && c.rank < prev.rank)) byId.set(c.id, Object.assign(c, { exact }));
      }
      found = [...byId.values()].sort((x, y) => (y.exact - x.exact) || (x.rank - y.rank)).slice(0, 8);
    }
    if (!found.length) return [];
    const ids = found.map(c => c.id);
    const [entities, cls] = await Promise.all([
      wbEntities(ids, signal).catch(() => ({})),
      U.within(classify(ids, signal), 4500, null),
    ]);
    const entry = L.lookup(p.core) || p.variants.map(L.lookup).find(Boolean) || null;
    return found.map(c => {
      const e = entities[c.id];
      const info = e ? entityInfo(e) : { id: c.id, labels: { en: c.label }, aliases: [], sitelinks: 0, wiki: {} };
      const cand = Object.assign({}, c, { info, kind: kindOf(info, cls && cls[c.id]) });
      if (pin) cand.matchText = info.labels.en || c.matchText;
      return Object.assign(cand, candidateScore(cand, p, entry));
    }).sort((x, y) => y.score - x.score);
  }

  async function resolve(raw, opts = {}) {
    const p = parse(raw);
    const pin = opts.pin || null;
    if (!p.core) return freeIntent(p);
    if (pin === 'none') return freeIntent(p);
    const ck = U.norm(p.raw) + '|' + (pin || '');
    const hit = cache.get(ck);
    if (hit) return Object.assign(hit, { raw: p.raw });

    const entry = L.lookup(p.core) || p.variants.map(L.lookup).find(Boolean) || null;
    let cands = [];
    try { cands = await candidates(p, opts.signal, pin); } catch (e) { cands = []; }

    const usable = cands.filter(c => c.kind !== 'media');
    let best = usable[0];
    if (!pin && best && (best.matchQuality < 1 || best.score < 4.5)) best = null;
    // a lexicon term beats an unrelated Wikidata hit ("flores" the island)
    if (!pin && entry && best && best.kind !== entry.kind) {
      const agree = usable.find(c => c.kind === entry.kind && c.matchQuality >= 1);
      best = agree || null;
    }
    const alternatives = usable.filter(c => c !== best && c.score >= 3.5).slice(0, 4).map(c => ({
      qid: c.id, label: c.info.labels.en || c.label, description: c.info.descEn || '', kind: c.kind,
    }));

    let intent;
    if (best) intent = buildIntent(p, best, alternatives, entry);
    else if (entry) intent = Object.assign(lexiconIntent(p, entry), { alternatives });
    else intent = freeIntent(p, alternatives);
    // only Wikidata-confirmed answers are kept: a lexicon/free fallback may
    // just mean Wikidata was unreachable this time
    if (intent.source === 'wikidata') cache.set(ck, intent);
    return intent;
  }

  /* ---------- enrichment (kind-specific facts) ---------- */

  const lbl = (v, langs) => 'OPTIONAL { ' + v + ' rdfs:label ' + v + 'L FILTER(LANG(' + v + 'L) IN (' + langs + ')) }';

  async function enrich(intent, opts = {}) {
    if (intent.enriched) return intent;
    const signal = opts.signal;
    const out = intent;
    const seedArtists = intent.kind === 'movement' ? L.movementArtists(intent.label) : [];
    if (seedArtists.length) out.artists = seedArtists.map(name => ({ name, qid: null }));
    if (!intent.qid) { out.enriched = true; return out; }
    const Q = 'wd:' + intent.qid;
    try {
      if (intent.kind === 'artist') {
        const d = await sparql('SELECT ?m ?mL ?b ?d WHERE { OPTIONAL { ' + Q + ' wdt:P135 ?m . ' + lbl('?m', '"en","mul"')
          + ' } OPTIONAL { ' + Q + ' wdt:P569 ?b } OPTIONAL { ' + Q + ' wdt:P570 ?d } }', signal, 8000);
        const rows = d.results.bindings;
        out.movements = U.uniq(rows.filter(r => r.m).map(r => qidOf(r.m.value) + '|' + (r.mL ? r.mL.value : '')))
          .map(s => ({ qid: s.split('|')[0], label: s.split('|')[1] })).filter(m => m.label);
        const b = rows.find(r => r.b), dd = rows.find(r => r.d);
        const by = b && U.parseYears(b.b.value), dy = dd && U.parseYears(dd.d.value);
        out.lifespan = { start: by ? by.start : null, end: dy ? dy.start : null };
      } else if (intent.kind === 'movement') {
        const [a, per] = await Promise.all([
          sparql('SELECT ?a ?aL ?sl WHERE { ?a wdt:P135 ' + Q + ' ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl . '
            + lbl('?a', '"en","mul"') + ' } ORDER BY DESC(?sl) LIMIT 30', signal, 9000),
          sparql('SELECT ?s ?e ?i WHERE { OPTIONAL { ' + Q + ' wdt:P580 ?s } OPTIONAL { ' + Q + ' wdt:P582 ?e } OPTIONAL { '
            + Q + ' wdt:P571 ?i } }', signal, 8000).catch(() => null),
        ]);
        const byQid = new Map();
        for (const r of a.results.bindings) if (r.aL && !byQid.has(r.a.value)) byQid.set(r.a.value, { name: r.aL.value, qid: qidOf(r.a.value) });
        const fromWd = [...byQid.values()];
        const names = new Set(fromWd.map(x => U.norm(x.name)));
        out.artists = fromWd.concat(seedArtists.filter(n => !names.has(U.norm(n))).map(name => ({ name, qid: null })));
        if (per && per.results.bindings[0]) {
          const r = per.results.bindings[0];
          const s = r.s || r.i, e = r.e;
          const sy = s && U.parseYears(s.value), ey = e && U.parseYears(e.value);
          if (sy) out.years = { start: sy.start, end: ey ? ey.start : (out.years ? out.years.end : sy.start + 60) };
        }
      } else if (intent.kind === 'artwork') {
        const d = await sparql('SELECT ?c ?cL ?i WHERE { OPTIONAL { ' + Q + ' wdt:P170 ?c . ' + lbl('?c', '"en","mul"')
          + ' } OPTIONAL { ' + Q + ' wdt:P571 ?i } }', signal, 8000);
        const r = d.results.bindings.find(x => x.c);
        if (r) out.creator = { qid: qidOf(r.c.value), name: r.cL ? r.cL.value : '' };
      } else if (intent.kind === 'place') {
        const d = await sparql('SELECT ?dm WHERE { ' + Q + ' wdt:P1549 ?dm FILTER(LANG(?dm) = "en") }', signal, 8000);
        out.demonyms = U.uniq(d.results.bindings.map(r => r.dm.value));
      }
    } catch (e) {
      out.enrichError = e.message;
    }
    out.enriched = true;
    return out;
  }

  /* ---------- Wikipedia summary for the context panel ---------- */

  async function summary(intent, opts = {}) {
    const langs = intent.lang === 'pt' ? ['pt', 'en'] : ['en', 'pt'];
    for (const l of langs) {
      const title = intent.wiki && intent.wiki[l];
      if (!title) continue;
      const url = 'https://' + l + '.wikipedia.org/w/api.php?action=query&format=json&origin=*'
        + '&prop=extracts|pageimages&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=320'
        + '&redirects=1&titles=' + encodeURIComponent(title);
      try {
        const d = await U.fetchJson(url, { timeout: 7000, signal: opts.signal, ttl: DAY });
        const page = d.query && d.query.pages ? Object.values(d.query.pages)[0] : null;
        if (page && page.extract) {
          return {
            lang: l, title: page.title || title, text: page.extract,
            thumb: page.thumbnail ? page.thumbnail.source : null,
            url: 'https://' + l + '.wikipedia.org/wiki/' + encodeURIComponent((page.title || title).replace(/ /g, '_')),
          };
        }
      } catch (e) { /* try the next language */ }
    }
    return null;
  }

  // The plain-keyword intent (legacy mode, and "search as plain text").
  const free = raw => freeIntent(parse(raw));

  EB.intent = { parse, resolve, enrich, summary, candidates, kindOf, entityInfo, singular, guessLang, sparql, free, _cache: cache };
})(typeof globalThis !== 'undefined' ? globalThis : this);
