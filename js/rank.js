/* ============================================================
   embusca — relevance scoring and ranking
   Every item gets rel (0..1) + why (human-readable reason):
     1.0  structured proof (Wikidata creator/depicts/movement, Met
          subject tag with the same QID)
     ~.9  the metadata says so (artist field, style/subject tags)
     ~.7  the title/description says so
     <.6  weak / unverified  -> "less related" section, never the top
   score = rel*100 + small bonuses (popularity, source order,
   requested medium) so bonuses reorder within a tier only.
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};
  const U = EB.util, L = EB.lexicon;

  const STRONG = 0.6;
  // Attribution qualifiers: "Workshop of Rembrandt" is related, not "by Rembrandt".
  const QUAL = /\b(workshop|studio|atelier|circle|follower|followers|school|manner|imitator|copy|copyist|after|pupil|entourage)\b/;
  const ATTR = /\b(attributed|attribution|possibly|probably)\b/;

  const DEMONYMS = {
    brazil: ['brazilian', 'brasileiro', 'brasileira'], japan: ['japanese'], france: ['french'], italy: ['italian'],
    spain: ['spanish'], netherlands: ['dutch', 'netherlandish'], germany: ['german'], china: ['chinese'],
    india: ['indian'], mexico: ['mexican'], peru: ['peruvian'], egypt: ['egyptian'], portugal: ['portuguese'],
    denmark: ['danish'], russia: ['russian'], greece: ['greek'], england: ['english', 'british'],
    'united kingdom': ['british', 'english'], 'united states': ['american'], 'united states of america': ['american'],
    korea: ['korean'], iran: ['iranian', 'persian'], turkey: ['turkish', 'ottoman'], norway: ['norwegian'],
    sweden: ['swedish'], belgium: ['belgian', 'flemish'], austria: ['austrian'], switzerland: ['swiss'],
    poland: ['polish'], ireland: ['irish'], scotland: ['scottish'], canada: ['canadian'],
    argentina: ['argentine', 'argentinian'], chile: ['chilean'], colombia: ['colombian'], cuba: ['cuban'],
  };

  /* ---------- building blocks ---------- */

  // Artist names as arrays of significant tokens. Single-token names must be
  // distinctive ("Rembrandt", "Hokusai"), never "Jan".
  function nameVariants(names) {
    const seen = new Set(), out = [];
    for (const n of names || []) {
      const k = U.nameKey(n);
      if (!k.length || (k.length === 1 && k[0].length < 5)) continue;
      const key = k.join(' ');
      if (!seen.has(key)) { seen.add(key); out.push(k); }
    }
    return out;
  }

  // Every token present; given names may appear as initials ("V. van Gogh").
  function nameMatch(tokSet, variants) {
    return variants.some(v => v.every((t, i) => tokSet.has(t) || (i < v.length - 1 && tokSet.has(t[0]))));
  }

  function phrasesOf(list) {
    const seen = new Set(), out = [];
    for (const s of list || []) {
      const n = U.norm(s);
      if (n && !seen.has(n)) { seen.add(n); out.push(n.split(' ')); }
    }
    return out;
  }

  const phraseIn = (toks, phrases) => phrases.some(p => U.hasPhrase(toks, p));

  // tolerant token match for free text: plurals and -ist/-ism style endings
  function softHas(toks, t) {
    return toks.some(x => U.tokEq(x, t) || (t.length >= 6 && x.length >= 6 && x.slice(0, t.length - 3) === t.slice(0, t.length - 3)));
  }

  function overlap(a, b) { return a && b && a.start <= b.end && b.start <= a.end; }

  const r = (rel, why) => ({ rel, why });

  /* ---------- matcher: everything precomputed from the intent ---------- */

  function buildMatcher(intent) {
    const lex = intent.lexicon;
    const lexTerms = lex ? [].concat(lex.en, lex.alt || [], lex.pt || [], lex.da || [], lex.rel || []) : [];
    const labels = [intent.label, intent.labels && intent.labels.pt, intent.labels && intent.labels.da];
    const M = {
      intent, kind: intent.kind, qid: intent.qid, label: intent.label,
      query: U.tokens(intent.core).filter(t => !U.STOP.has(t) && !L.GENERIC.has(t)),
    };
    switch (intent.kind) {
      case 'artist':
        M.names = nameVariants(labels.concat(intent.aliases || []));
        break;
      case 'movement': {
        M.phrases = phrasesOf(labels.concat(intent.aliases || [], lexTerms));
        const n = U.norm(intent.label);
        M.stem = (lex && lex.stem) || (/ism$/.test(n) && n.length > 7 ? n.slice(0, -1) : null);
        M.artists = (intent.artists || L.movementArtists(intent.label).map(name => ({ name })))
          .map(a => ({ name: a.name, qid: a.qid || null, v: nameVariants([a.name]) }))
          .filter(a => a.v.length || a.qid);
        M.years = intent.years || null;
        break;
      }
      case 'genre': case 'subject':
        M.phrases = phrasesOf(labels.concat(intent.aliases || [], lexTerms));
        break;
      case 'person': {
        const single = U.tokens(intent.label).filter(t => t.length >= 5);
        M.phrases = phrasesOf(labels.concat(intent.aliases || [], single));
        break;
      }
      case 'place': {
        const dem = (intent.demonyms || []).concat(DEMONYMS[U.norm(intent.label)] || []);
        M.phrases = phrasesOf(labels.concat(intent.aliases || [], dem));
        M.demonyms = phrasesOf(dem);
        break;
      }
      case 'artwork':
        M.title = U.tokens(intent.label).filter(t => !U.STOP.has(t));
        M.creator = intent.creator ? { qid: intent.creator.qid, names: nameVariants([intent.creator.name]) } : null;
        break;
      default: break;
    }
    return M;
  }

  /* ---------- per-item token cache (independent of the query) ---------- */

  function fields(it) {
    if (it._f) return it._f;
    const artistStr = [it.artist, it.artistFull].concat(it.artistAll || []).join(' ');
    const firstLine = String(it.artistFull || '').split(/\n|\(| — /)[0];
    it._f = {
      artist: new Set(U.tokens(artistStr)),
      artistBio: U.tokens(it.artistFull || ''),
      title: U.tokens(it.title),
      kw: U.tokens((it.keywords || []).join(' ; ')),
      desc: U.tokens(it.desc || ''),
      place: U.tokens(it.country === '—' ? '' : it.country),
      medium: U.norm([it.classification, it.medium === '—' ? '' : it.medium].join(' ')),
      qual: U.fold([it.attribution || '', it.artist || '', firstLine].join(' ')),
    };
    return it._f;
  }

  function qualify(f, base, why) {
    if (QUAL.test(f.qual)) return r(0.5, 'workshop, follower or copy');
    if (ATTR.test(f.qual)) return r(Math.min(base, 0.85), 'attributed to the artist');
    return r(base, why);
  }

  /* ---------- relevance ---------- */

  function relevance(it, M) {
    const f = fields(it);
    const ev = it.evidence && M.qid && it.evidence.qid === M.qid ? it.evidence : null;
    switch (M.kind) {
      case 'artist': {
        if ((M.qid && it.artistQid === M.qid) || ev) return qualify(f, 1, 'by ' + M.label + ' (Wikidata)');
        if (nameMatch(f.artist, M.names)) return qualify(f, 0.97, 'by ' + M.label);
        const titleSet = new Set(f.title.concat(f.kw));
        if (nameMatch(titleSet, M.names)) return r(0.4, 'mentions ' + M.label);
        return r(0.05, '');
      }
      case 'movement': {
        if (ev) return ev.via === 'artist' ? r(0.88, 'artist of ' + M.label) : r(1, 'style: ' + M.label + ' (Wikidata)');
        if (phraseIn(f.kw, M.phrases) || (M.stem && U.hasStem(f.kw, M.stem))) return r(0.95, 'style: ' + M.label);
        const hit = M.artists.find(a => (a.qid && a.qid === it.artistQid) || (a.v.length && nameMatch(f.artist, a.v)));
        if (hit && !QUAL.test(f.qual)) return r(0.85, 'by ' + hit.name + ', ' + M.label);
        if (phraseIn(f.title, M.phrases) || (M.stem && U.hasStem(f.title, M.stem))) return r(0.7, 'title mentions ' + M.label);
        if (phraseIn(f.desc, M.phrases) || (M.stem && U.hasStem(f.desc, M.stem))) return r(0.62, 'description mentions ' + M.label);
        if (hit) return r(0.5, 'circle of ' + hit.name);
        if (M.years && overlap(it.years, M.years)) return r(0.3, 'same period as ' + M.label);
        return r(0.05, '');
      }
      case 'genre': case 'subject': case 'person': {
        if (ev) return r(1, (ev.via === 'genre' ? 'genre: ' : 'depicts ') + M.label + ' (Wikidata)');
        if (M.qid && it.tagQids && it.tagQids.includes(M.qid)) return r(1, 'tagged ' + M.label);
        if (phraseIn(f.kw, M.phrases)) return r(0.92, 'subject: ' + M.label);
        if (phraseIn(f.title, M.phrases)) return r(0.9, 'title mentions ' + M.label);
        if (phraseIn(f.desc, M.phrases)) return r(0.62, 'description mentions ' + M.label);
        return r(0.05, '');
      }
      case 'place': {
        if (ev) return ev.via === 'artist' ? r(0.9, 'artist from ' + M.label) : r(1, 'depicts ' + M.label + ' (Wikidata)');
        if (phraseIn(f.place, M.phrases)) return r(0.9, 'from ' + M.label);
        if (phraseIn(f.title, M.phrases)) return r(0.85, 'title mentions ' + M.label);
        if (M.demonyms.length && phraseIn(f.artistBio, M.demonyms)) return r(0.85, 'artist from ' + M.label);
        if (phraseIn(f.kw, M.phrases)) return r(0.75, 'about ' + M.label);
        if (phraseIn(f.desc, M.phrases)) return r(0.6, 'description mentions ' + M.label);
        return r(0.05, '');
      }
      case 'artwork': {
        if ((it.qid && it.qid === M.qid) || (ev && ev.via === 'self')) return r(1, 'this artwork');
        const tset = new Set(f.title);
        const titleHit = M.title.length && M.title.filter(t => tset.has(t)).length / M.title.length >= 0.8;
        const creatorHit = (ev && ev.via === 'creator') || (M.creator &&
          ((M.creator.qid && M.creator.qid === it.artistQid) || nameMatch(f.artist, M.creator.names)));
        if (titleHit && creatorHit) return r(0.98, 'this artwork');
        if (creatorHit) return r(0.8, 'same artist');
        if (titleHit) return r(0.6, 'same title');
        return r(0.05, '');
      }
      default: {
        const q = M.query;
        if (!q.length) return r(0.5, '');
        let sum = 0, strongAll = true, anyAll = true;
        const artistToks = [...f.artist];
        for (const t of q) {
          const inStrong = softHas(f.title, t) || softHas(artistToks, t) || softHas(f.kw, t);
          const inAny = inStrong || softHas(f.place, t) || softHas(f.desc, t) || f.medium.includes(t);
          sum += inStrong ? 1 : inAny ? 0.6 : 0;
          if (!inStrong) strongAll = false;
          if (!inAny) anyAll = false;
        }
        if (strongAll) return r(0.9, 'matches “' + M.intent.core + '”');
        if (anyAll) return r(0.65, 'matches “' + M.intent.core + '”');
        return r(0.55 * sum / q.length, 'partial match');
      }
    }
  }

  function score(it, M) {
    const { rel, why } = relevance(it, M);
    let b = 6 * (it.pop || 0) + 5 * (1 - Math.min(it.rank || 0, 60) / 60);
    const mt = fields(it).medium;
    const med = M.intent.medium;
    if (med && mt) {
      const m = L.MEDIUM.find(x => x.key === med);
      b += m && m.test.test(mt) ? 5 : -3;
    } else if (!med && M.kind !== 'free' && M.kind !== 'place' && /\bpaint|oil on|tempera|maleri/.test(mt)) {
      b += 2;   // art searches: paintings first when nothing else differs
    }
    if (it.hires && it.hires !== it.thumb) b += 1;
    it.rel = rel; it.why = why; it.score = rel * 100 + b;
    return it;
  }

  // Greedy re-order: no more than 3 of the same source in any window of 6,
  // unless the alternative is clearly worse (> 8 points).
  function diversify(list) {
    const pool = list.slice(), out = [];
    while (pool.length) {
      const recent = out.slice(-6);
      const cnt = s => recent.reduce((n, x) => n + (x.source === s ? 1 : 0), 0);
      let pick = 0;
      if (cnt(pool[0].source) >= 3) {
        const alt = pool.findIndex(x => cnt(x.source) < 3 && x.score >= pool[0].score - 8);
        if (alt > 0) pick = alt;
      }
      out.push(pool.splice(pick, 1)[0]);
    }
    return out;
  }

  function order(items, M) {
    items.forEach(it => score(it, M));
    const sorted = items.slice().sort((a, b) => b.score - a.score);
    return {
      strong: diversify(sorted.filter(it => it.rel >= STRONG)),
      weak: sorted.filter(it => it.rel < STRONG),
    };
  }

  /* ---------- duplicates across sources ---------- */

  function keysOf(it) {
    const keys = [];
    if (it.qid) keys.push('q:' + it.qid);
    const t = U.norm(it.title), a = U.nameKey(it.artist).sort().join(' ');
    if (t && t !== 'untitled' && a && !/unknown/.test(a)) keys.push('t:' + t + '|' + a);
    return keys;
  }

  const PREF = { met: 5, aic: 5, cma: 5, smk: 4, vam: 4, wel: 3, wmc: 1 };

  // Keep one copy per artwork; museum records beat Wikidata ones (richer data).
  function dedupe(items) {
    const owner = new Map(), kept = [];
    for (const it of items) {
      const ks = keysOf(it);
      const prev = ks.map(k => owner.get(k)).find(Boolean);
      if (!prev) { kept.push(it); ks.forEach(k => owner.set(k, it)); continue; }
      const better = (PREF[it.source] || 0) > (PREF[prev.source] || 0);
      if (better) {
        kept[kept.indexOf(prev)] = it;
        keysOf(prev).concat(ks).forEach(k => owner.set(k, it));
      } else {
        ks.forEach(k => { if (!owner.has(k)) owner.set(k, prev); });
      }
    }
    return kept;
  }

  // The pre-2026 merge: round-robin across sources in their own order.
  function interleave(items) {
    const by = {};
    items.slice().sort((a, b) => (a.rank || 0) - (b.rank || 0)).forEach(it => (by[it.source] = by[it.source] || []).push(it));
    const lists = Object.values(by), out = [];
    const max = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  }

  EB.rank = { STRONG, buildMatcher, relevance, score, order, diversify, dedupe, keysOf, interleave, nameVariants, nameMatch, fields };
})(typeof globalThis !== 'undefined' ? globalThis : this);
