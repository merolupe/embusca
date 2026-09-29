'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers');
const world = require('./fixtures/world');

const EB = loadEngine();

function fresh(opts) {
  EB.intent._cache.clear();
  return world.install(EB, opts);
}

test('parse strips generic words and keeps the medium', () => {
  const p = EB.intent.parse('pinturas de Monet');
  assert.equal(p.core, 'Monet');
  assert.equal(p.medium, 'painting');
  assert.equal(p.lang, 'pt');
  const q = EB.intent.parse('impressionist painting');
  assert.equal(q.core, 'impressionist');
  assert.ok(q.variants.includes('impressionism'));
  assert.deepEqual(EB.intent.parse('gatos').variants, ['gatos', 'gato']);
  assert.ok(EB.intent.parse('natureza morta').variants.includes('natureza-morta'));
});

test('singular() covers PT and EN plurals', () => {
  const S = EB.intent.singular;
  assert.equal(S('cavalos'), 'cavalo');
  assert.equal(S('flores'), 'flor');
  assert.equal(S('paisagens'), 'paisagem');
  assert.equal(S('leoes'), 'leao');
  assert.equal(S('animais'), 'animal');
  assert.equal(S('horses'), 'horse');
  assert.equal(S('churches'), 'church');
  assert.equal(S('ladies'), 'lady');
});

test('lexicon maps PT/DA words to English art terms', () => {
  assert.equal(EB.lexicon.lookup('gatos').en, 'cat');
  assert.equal(EB.lexicon.lookup('natureza-morta').en, 'still life');
  assert.equal(EB.lexicon.lookup('impressionismo').kind, 'movement');
  assert.equal(EB.lexicon.lookup('horses').en, 'horse');
  assert.equal(EB.lexicon.lookup('van gogh'), null);
});

test('"van gogh" resolves to the painter, not Theo or the museum', async () => {
  fresh();
  const i = await EB.intent.resolve('van gogh');
  assert.equal(i.kind, 'artist');
  assert.equal(i.qid, 'Q5582');
  assert.equal(i.label, 'Vincent van Gogh');
  assert.ok(!i.alternatives.some(a => a.qid === 'Q224124'), 'museum filtered out as media');
});

test('"gatos" (PT) resolves to the concept cat with English and Danish labels', async () => {
  fresh();
  const i = await EB.intent.resolve('gatos');
  assert.equal(i.kind, 'subject');
  assert.equal(i.qid, 'Q146');
  assert.equal(i.label, 'cat');
  assert.equal(i.labels.da, 'kat');
});

test('"cats" prefers the animal over the musical', async () => {
  fresh();
  const i = await EB.intent.resolve('cats');
  assert.equal(i.qid, 'Q146');
});

test('"flores" prefers flower over the Indonesian island', async () => {
  fresh();
  const i = await EB.intent.resolve('flores');
  assert.equal(i.qid, 'Q506');
  assert.equal(i.kind, 'subject');
});

test('"impressionismo" resolves to the movement and enrichment lists its artists', async () => {
  fresh();
  const i = await EB.intent.resolve('impressionismo');
  assert.equal(i.kind, 'movement');
  assert.equal(i.qid, 'Q40415');
  await EB.intent.enrich(i);
  const names = i.artists.map(a => a.name);
  assert.ok(names.includes('Claude Monet') && names.includes('Edgar Degas'));
  assert.ok(names.includes('Berthe Morisot'), 'lexicon seeds are merged in');
  assert.deepEqual(i.years, { start: 1860, end: 1900 });
});

test('artist enrichment adds movements and lifespan', async () => {
  fresh();
  const i = await EB.intent.resolve('van gogh');
  await EB.intent.enrich(i);
  assert.equal(i.movements[0].label, 'Post-Impressionism');
  assert.deepEqual(i.lifespan, { start: 1853, end: 1890 });
});

test('without Wikidata, the lexicon still understands "gatos"', async () => {
  fresh({ failWikidata: true });
  const i = await EB.intent.resolve('gatos');
  assert.equal(i.kind, 'subject');
  assert.equal(i.label, 'cat');
  assert.equal(i.source, 'lexicon');
});

test('a lexicon fallback is not cached: Wikidata is used again once it is back', async () => {
  fresh({ failWikidata: true });
  assert.equal((await EB.intent.resolve('gatos')).source, 'lexicon');
  world.install(EB);
  const i = await EB.intent.resolve('gatos');
  assert.equal(i.source, 'wikidata');
  assert.equal(i.qid, 'Q146');
});

test('without SPARQL, descriptions still classify the entity', async () => {
  fresh({ failSparql: true });
  const i = await EB.intent.resolve('van gogh');
  assert.equal(i.kind, 'artist');
  assert.equal(i.qid, 'Q5582');
});

test('unknown words fall back to free text', async () => {
  fresh();
  const i = await EB.intent.resolve('xyzzy qwerty');
  assert.equal(i.kind, 'free');
  assert.equal(i.core, 'xyzzy qwerty');
});

test('pinning an entity or "none" overrides resolution', async () => {
  fresh();
  const i = await EB.intent.resolve('van gogh', { pin: 'Q900101' });
  assert.equal(i.qid, 'Q900101');
  assert.equal(i.kind, 'person');
  const f = await EB.intent.resolve('van gogh', { pin: 'none' });
  assert.equal(f.kind, 'free');
});

test('summary() prefers Portuguese Wikipedia for Portuguese queries', async () => {
  fresh();
  const i = await EB.intent.resolve('gatos');
  i.lang = 'pt';
  const s = await EB.intent.summary(i);
  assert.equal(s.lang, 'pt');
  assert.match(s.text, /Gato/);
});
