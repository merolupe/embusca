/* ============================================================
   embusca — relevance test suite (author / theme / style, PT + EN)
   The oracles below are the ground truth and are written
   independently of rank.js (own regexes and artist lists), so the
   suite measures the ranker instead of agreeing with it.
   Goal per query: the first 6 main results are all relevant and
   at least 6 relevant works are found.
   Runs in the browser (diagnostics panel) and in Node (tests/live.js).
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};
  const U = EB.util;

  const txt = it => U.norm([it.title, (it.keywords || []).join(' '), it.desc || ''].join(' '));
  const who = it => U.norm([it.artist, it.artistFull].join(' '));
  const NOT_BY = /\b(workshop|follower|circle|school|manner|imitator|copy|after|style of|pupil)\b/;
  const by = re => it => re.test(who(it)) && !NOT_BY.test(U.norm((it.attribution || '') + ' ' + it.artist));
  const about = re => it => re.test(txt(it));
  const any = (...fs) => it => fs.some(f => f(it));
  const wd = kind => it => !!(it.evidence && it.evidence.kind === kind && it.evidence.via);

  // no Portuguese "gato(s)": it mostly hits place names (Los Gatos) in these catalogues
  const CAT = /\b(cat|cats|kitten|kittens|feline|kat|katte)\b/;
  const HORSE = /\b(horse|horses|equestrian|stallion|mare|pony|ponies|horseman|horsemen|cavalry|cavalo|cavalos|hest|heste)\b/;
  const FLOWER = /\b(flower|flowers|bouquet|floral|roses?|tulips?|lily|lilies|peony|peonies|iris|irises|sunflowers?|blossoms?|popp(y|ies)|chrysanthemums?|daisy|daisies|carnations?|lotus|orchids?|camellias?|anemones?|magnolias?|hydrangeas?|flor|flores|blomst|blomster)\b/;
  // Vincent specifically, in any of the catalogue name orders (not Theo, not another van Gogh)
  const VINCENT = /\b(vincent (willem )?van gogh|gogh vincent|v van gogh)\b/;
  const SEA = /\b(sea|seas|seascape|seascapes|ocean|marine|coast|coastal|shore|beach|waves?|harbou?r|ships?|boats?|sailing|bay|cliffs?|surf|mar|hav|havet)\b/;
  const STILL = /\b(still life|still lifes|still lives|nature morte|stilleben|stilleven|natureza morta|opstilling|vanitas)\b/;
  const PORTRAIT = /\b(portrait|portraits|retrato|retratos|portraet|bust of|head of)\b/;

  const IMPRESSIONISTS = /\b(monet|renoir|degas|pissarro|sisley|morisot|cassatt|caillebotte|bazille|guillaumin|manet|gonzales|hassam|twachtman)\b/;
  const BAROQUE = /\b(caravaggio|rubens|rembrandt|velazquez|vermeer|bernini|van dyck|gentileschi|hals|poussin|zurbaran|murillo|ribera|reni|carracci|guercino|lorrain|jordaens|de la tour|steen|ruisdael|cuyp|de hooch|ter borch|claesz|heda|snyders)\b/;
  const UKIYOE = /\b(hokusai|hiroshige|utamaro|kuniyoshi|harunobu|kunisada|sharaku|kiyonaga|eisen|yoshitoshi|toyokuni|moronobu|shunsho|koryusai|kiyonobu|masanobu|shigenobu|hokkei|gakutei)\b/;
  const POINTILLISTS = /\b(seurat|signac|cross|luce|rysselberghe|angrand|dubois pillet|petitjean|lucien pissarro)\b/;
  const NOUVEAU = /\b(mucha|klimt|beardsley|tiffany|galle|lalique|guimard|moser|grasset|steinlen|horta|van de velde)\b/;
  const ROMANTICS = /\b(delacroix|gericault|turner|constable|friedrich|goya|blake|fuseli|cole|gros|girodet|dahl|runge|martin|bonington)\b/;

  const SUITE = [
    // author
    { cat: 'author', q: 'van gogh', relevant: by(VINCENT) },
    { cat: 'author', q: 'Claude Monet', relevant: by(/\bmonet\b/) },
    { cat: 'author', q: 'rembrandt', relevant: by(/\brembrandt\b(?! peale)/) },
    { cat: 'author', q: 'hokusai', relevant: by(/\bhokusai\b/) },
    { cat: 'author', q: 'vermeer', relevant: by(/\bvermeer\b/) },
    { cat: 'author', q: 'Almeida Júnior', relevant: by(/\balmeida junior\b/) },
    { cat: 'author', q: 'pinturas de Monet', relevant: by(/\bmonet\b/) },
    // theme
    { cat: 'theme', q: 'cats', relevant: any(about(CAT), wd('subject')) },
    { cat: 'theme', q: 'gatos', relevant: any(about(CAT), wd('subject')) },
    { cat: 'theme', q: 'cavalos', relevant: any(about(HORSE), wd('subject')) },
    { cat: 'theme', q: 'flores', relevant: any(about(FLOWER), wd('subject')) },
    { cat: 'theme', q: 'the sea', relevant: any(about(SEA), wd('subject')) },
    { cat: 'theme', q: 'natureza morta', relevant: any(about(STILL), wd('genre')) },
    { cat: 'theme', q: 'retrato', relevant: any(about(PORTRAIT), wd('genre')) },
    // style
    { cat: 'style', q: 'impressionism', relevant: any(by(IMPRESSIONISTS), about(/\bimpressionis/), wd('movement')) },
    { cat: 'style', q: 'impressionismo', relevant: any(by(IMPRESSIONISTS), about(/\bimpressionis/), wd('movement')) },
    { cat: 'style', q: 'barroco', relevant: any(by(BAROQUE), about(/\b(baroque|barroco|barok)\b/), wd('movement')) },
    { cat: 'style', q: 'ukiyo-e', relevant: any(by(UKIYOE), about(/\b(ukiyo|nishiki|surimono)/), wd('movement')) },
    { cat: 'style', q: 'pontilhismo', relevant: any(by(POINTILLISTS), about(/\b(pointill|neo impressionis|divisionis)/), wd('movement')) },
    { cat: 'style', q: 'art nouveau', relevant: any(by(NOUVEAU), about(/\b(art nouveau|jugendstil|secession|skonvirke)\b/), wd('movement')) },
    { cat: 'style', q: 'romantismo', relevant: any(by(ROMANTICS), about(/\bromantic/), wd('movement')) },
    // the three queries of the original diagnostics
    { cat: 'legacy', q: 'brazil', relevant: it => wd('place')(it) || /\b(brazil|brasil|brazilian|brasileiro|rio de janeiro|sao paulo|bahia|pernambuco|amazon)\b/.test(U.norm([it.title, it.country, it.artistFull, (it.keywords || []).join(' '), it.desc || ''].join(' '))) },
    { cat: 'legacy', q: 'van gogh (legacy test)', query: 'van gogh', relevant: by(VINCENT) },
    { cat: 'legacy', q: 'medieval', relevant: any(about(/\b(medieval|middle ages|gothic|romanesque|byzantine|carolingian|ottonian)\b/), wd('movement')) },
  ];

  function judge(entry, v) {
    const strong = v.strong, all = v.strong.concat(v.weak);
    const ok = it => { try { return !!entry.relevant(it); } catch (e) { return false; } };
    const top6 = strong.slice(0, 6);
    const p6 = top6.filter(ok).length;
    const relevantStrong = strong.filter(ok).length;
    const relevantAll = all.filter(ok).length;
    const pass = p6 === 6 && relevantStrong >= 6;
    return {
      p6, shown6: top6.length, rel12: strong.slice(0, 12).filter(ok).length,
      relevantStrong, relevantAll, strong: strong.length, weak: v.weak.length,
      precision: strong.length ? relevantStrong / strong.length : 0,
      verdict: pass ? 'PASS' : (p6 >= 5 && relevantStrong >= 6 ? 'WARN' : 'FAIL'),
      top: strong.slice(0, 8).map(it => ({ title: it.title, artist: it.artist, source: it.source, rel: it.rel, why: it.why, ok: ok(it) })),
      misses: strong.slice(0, 12).filter(it => !ok(it)).map(it => ({ title: it.title, artist: it.artist, source: it.source, why: it.why })),
    };
  }

  async function runOne(entry, opts = {}) {
    const s = new EB.Session(entry.query || entry.q, { sources: opts.sources, legacy: opts.legacy });
    await s.start();
    let v = s.view();
    // one infinite-scroll step when the first page is thin
    if (v.strong.length < 12 && s.hasMore() && opts.page2 !== false) { await s.loadMore(); v = s.view(); }
    const i = s.intent;
    return Object.assign({
      q: entry.q, cat: entry.cat, legacy: !!opts.legacy,
      kind: i.kind, label: i.label, qid: i.qid, intentSource: i.source,
      ms: Date.now() - s.t0, sources: s.status(), view: opts.keepView ? v : undefined,
    }, judge(entry, v));
  }

  async function run(opts = {}) {
    const list = opts.only
      ? SUITE.filter(e => opts.only.some(o => U.norm(e.q) === U.norm(o)))
      : SUITE.filter(e => opts.includeLegacy !== false || e.cat !== 'legacy');
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (opts.onProgress) opts.onProgress({ index: i, total: list.length, entry: list[i] });
      let res;
      try { res = await runOne(list[i], opts); } catch (e) { res = { q: list[i].q, cat: list[i].cat, verdict: 'FAIL', error: e.message }; }
      out.push(res);
      if (opts.onResult) opts.onResult(res);
      if (opts.pauseMs && i < list.length - 1) await U.sleep(opts.pauseMs);   // be gentle with the Met
    }
    return out;
  }

  function summarize(results) {
    const n = results.length;
    const count = v => results.filter(r => r.verdict === v).length;
    const byCat = {};
    for (const r of results) {
      const c = byCat[r.cat] || (byCat[r.cat] = { n: 0, pass: 0, p6: 0 });
      c.n++; if (r.verdict === 'PASS') c.pass++; c.p6 += r.p6 || 0;
    }
    return { n, pass: count('PASS'), warn: count('WARN'), fail: count('FAIL'), meanP6: n ? results.reduce((a, r) => a + (r.p6 || 0), 0) / n : 0, byCat };
  }

  EB.suite = { SUITE, judge, runOne, run, summarize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
