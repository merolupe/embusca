'use strict';
/* End-to-end over the fake network: real adapters, real ranking,
   judged by the same oracles the live suite uses. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers');
const world = require('./fixtures/world');

const EB = loadEngine();
const suiteEntry = q => EB.suite.SUITE.find(e => e.q === q);

async function run(query, opts = {}) {
  EB.intent._cache.clear();
  const log = world.install(EB, opts.world || {});
  const s = new EB.Session(query, { legacy: !!opts.legacy });
  await s.start();
  return { s, v: s.view(), log };
}

for (const q of ['van gogh', 'gatos', 'impressionismo']) {
  test('"' + q + '": first 6 results are all relevant, legacy merge was not', async () => {
    const entry = suiteEntry(q);
    const { v } = await run(q);
    const j = EB.suite.judge(entry, v);
    assert.equal(j.p6, 6, JSON.stringify(j.top, null, 1));
    assert.ok(j.relevantStrong >= 6);
    assert.equal(j.verdict, 'PASS');
    // every irrelevant fixture record ended below the fold (weak section)
    assert.ok(v.strong.every(entry.relevant), 'no irrelevant item in the main grid: ' + JSON.stringify(j.misses));

    const legacy = EB.suite.judge(entry, (await run(q, { legacy: true })).v);
    assert.ok(legacy.p6 < 6, 'legacy round-robin should let irrelevant items in (p6=' + legacy.p6 + ')');
  });
}

test('Met: only /v1.1/search, never the broken artistOrCulture flag', async () => {
  const { log } = await run('van gogh');
  const met = log.filter(u => u.includes('collectionapi.metmuseum.org'));
  assert.ok(met.some(u => u.includes('/v1.1/search?q=Vincent%20van%20Gogh')));
  assert.ok(met.some(u => u.includes('isHighlight=true')));
  assert.ok(!met.some(u => /\/v1\/search/.test(u)));
  assert.ok(!met.some(u => u.includes('artistOrCulture')));
});

test('artist queries use each museum’s artist filter', async () => {
  const { log } = await run('van gogh');
  assert.ok(log.some(u => u.includes('clevelandart.org') && u.includes('artists=Vincent%20van%20Gogh')));
  assert.ok(log.some(u => u.includes('api.vam.ac.uk') && u.includes('q_actor=Vincent%20van%20Gogh')));
  assert.ok(log.some(u => u.includes('api.vam.ac.uk') && u.includes('?q=Vincent')), 'falls back to q when q_actor is empty');
  assert.ok(log.some(u => u.includes('query.wikidata.org') && decodeURIComponent(u).includes('wdt:P170 wd:Q5582')));
});

test('subject queries: Met subject tags, SMK in Danish, English everywhere else', async () => {
  const { log } = await run('gatos');
  assert.ok(log.some(u => u.includes('metmuseum') && u.includes('q=cat') && u.includes('tags=true')));
  assert.ok(log.some(u => u.includes('api.smk.dk') && u.includes('keys=kat')));
  assert.ok(log.some(u => u.includes('api.artic.edu') && u.includes('q=cat&')));
  assert.ok(log.some(u => u.includes('wellcomecollection') && u.includes('include=production,contributors,subjects,genres')));
  assert.ok(log.some(u => u.includes('api.artic.edu') && u.includes('query[bool][must][1][exists][field]=image_id')));
  assert.ok(!log.some(u => u.includes('gatos') && !u.includes('wikidata')), 'the Portuguese word never reaches a museum');
});

test('movement queries: Met highlights of the movement’s artists', async () => {
  const { log, v } = await run('impressionismo');
  assert.ok(log.some(u => u.includes('metmuseum') && u.includes('q=Claude%20Monet') && u.includes('isHighlight=true')));
  assert.ok(v.strong.some(it => it.id === 'met:2001'), 'Monet highlight made it in');
  assert.ok(v.strong.some(it => it.source === 'smk' && /Morisot/.test(it.artist)), 'SMK found via Danish "impressionisme"');
});

test('cross-source duplicate: Met record replaces its Wikidata copy', async () => {
  const { v } = await run('van gogh');
  const all = v.strong.concat(v.weak);
  assert.ok(all.some(it => it.id === 'met:436535'));
  assert.ok(!all.some(it => it.id === 'wd:Q900202'));
});

test('Wikidata down: lexicon keeps PT queries working', async () => {
  const { v, s } = await run('gatos', { world: { failWikidata: true } });
  assert.equal(s.intent.source, 'lexicon');
  const j = EB.suite.judge(suiteEntry('gatos'), v);
  assert.ok(j.relevantStrong >= 6, 'still ≥ 6 relevant without Wikidata (' + j.relevantStrong + ')');
});

test('Commons fallback (plain text) filters non-art such as maps', async () => {
  EB.intent._cache.clear();
  const log = world.install(EB);
  const s = new EB.Session('gatos', { pin: 'none' });
  await s.start();
  assert.equal(s.intent.kind, 'free');
  assert.ok(log.some(u => u.includes('commons.wikimedia.org') && decodeURIComponent(u).includes('gatos painting filetype:bitmap')));
  const all = s.view();
  assert.ok(!all.strong.concat(all.weak).some(it => it.source === 'wmc' && /map/i.test(it.title)), 'map filtered out');
  assert.equal(s.pager.wmc.count, 0);
});

test('infinite scroll: drain() returns only new items, minus duplicates of what is shown', async () => {
  const { s } = await run('van gogh');
  const shown = s.view().strong[0];
  const dupe = Object.assign({}, shown, { id: 'wd:Q999', source: 'wmc', qid: shown.qid || 'Q999', _f: undefined, title: shown.title, artist: shown.artist });
  const fresh = { id: 'cma:9999', source: 'cma', title: 'Poplars at Saint-Rémy', artist: 'Vincent van Gogh', artistFull: '', country: '—', medium: 'Oil on canvas', classification: 'Painting', keywords: [], thumb: 't', hires: 'h', rank: 3 };
  s.items.set(dupe.id, dupe);
  s.items.set(fresh.id, fresh);
  const d = s.drain();
  assert.deepEqual(d.strong.concat(d.weak).map(x => x.id), ['cma:9999']);
  assert.deepEqual(s.drain().strong, [], 'nothing is handed out twice');
});

test('a failing source is reported, the rest still render', async () => {
  EB.intent._cache.clear();
  world.install(EB);
  const orig = EB.util.http.fetch;
  EB.util.http.fetch = async (url) => /api\.artic\.edu/.test(url) ? { ok: false, status: 500 } : orig(url);
  const s = new EB.Session('van gogh');
  await s.start();
  const st = s.status().find(x => x.key === 'aic');
  assert.equal(st.status, 'error');
  assert.ok(s.view().strong.length >= 6);
});
