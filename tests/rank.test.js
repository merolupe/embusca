'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers');

const EB = loadEngine();
const R = EB.rank;

const item = (o) => Object.assign({ id: Math.random().toString(36).slice(2), source: 'aic', title: 'Untitled', artist: 'Unknown artist',
  artistFull: '', country: '—', medium: '—', classification: '', keywords: [], thumb: 't', hires: 'h', rank: 0 }, o);

const artistIntent = { kind: 'artist', qid: 'Q5582', label: 'Vincent van Gogh', labels: { en: 'Vincent van Gogh' }, aliases: ['Van Gogh', 'Vincent Willem van Gogh'], core: 'van gogh', raw: 'van gogh' };

test('artist: QID, name variants, initials and inverted names match', () => {
  const M = R.buildMatcher(artistIntent);
  assert.equal(R.relevance(item({ artistQid: 'Q5582' }), M).rel, 1);
  assert.ok(R.relevance(item({ artist: 'Gogh, Vincent van' }), M).rel > 0.9);
  assert.ok(R.relevance(item({ artist: 'V. van Gogh' }), M).rel > 0.9);
  assert.ok(R.relevance(item({ artist: 'Theo van Gogh' }), M).rel < 0.6);
});

test('artist: workshop/copies are weak, attributions slightly lower', () => {
  const M = R.buildMatcher(artistIntent);
  assert.equal(R.relevance(item({ artist: 'Vincent van Gogh', attribution: 'Copy after' }), M).rel, 0.5);
  assert.equal(R.relevance(item({ artist: 'Vincent van Gogh', attribution: 'Attributed to' }), M).rel, 0.85);
  assert.equal(R.relevance(item({ title: 'Portrait of Vincent van Gogh', artist: 'Henri de Toulouse-Lautrec' }), M).rel, 0.4);
});

test('subject: Met tag QID, keywords, title and plural forms', () => {
  const M = R.buildMatcher({ kind: 'subject', qid: 'Q146', label: 'cat', labels: { en: 'cat', pt: 'gato', da: 'kat' }, aliases: [], core: 'gatos', raw: 'gatos', lexicon: EB.lexicon.lookup('cat') });
  assert.equal(R.relevance(item({ tagQids: ['Q146'] }), M).rel, 1);
  assert.ok(R.relevance(item({ keywords: ['cats', 'animals'] }), M).rel > 0.9);
  assert.ok(R.relevance(item({ title: 'Two Kittens Playing' }), M).rel >= 0.9);
  assert.ok(R.relevance(item({ title: 'En kat', source: 'smk' }), M).rel >= 0.9, 'Danish title');
  assert.ok(R.relevance(item({ title: 'Catskill Mountains' }), M).rel < 0.6, 'no substring false positive');
  assert.ok(R.relevance(item({ title: 'Catherine of Aragon' }), M).rel < 0.6);
});

test('movement: style tags, member artists, adjective stems and period', () => {
  const M = R.buildMatcher({ kind: 'movement', qid: 'Q40415', label: 'Impressionism', labels: { en: 'Impressionism' }, aliases: [], core: 'impressionism', raw: 'impressionism',
    lexicon: EB.lexicon.lookup('impressionism'), artists: [{ name: 'Claude Monet', qid: 'Q296' }, { name: 'Edgar Degas', qid: null }], years: { start: 1860, end: 1900 } });
  assert.equal(R.relevance(item({ keywords: ['Impressionism'] }), M).rel, 0.95);
  assert.equal(R.relevance(item({ artistQid: 'Q296' }), M).rel, 0.85);
  assert.equal(R.relevance(item({ artist: 'Degas, Edgar' }), M).rel, 0.85);
  assert.equal(R.relevance(item({ desc: 'An Impressionist portrait.' }), M).rel, 0.62);
  assert.equal(R.relevance(item({ years: { start: 1880, end: 1880 } }), M).rel, 0.3);
  assert.equal(R.relevance(item({ evidence: { kind: 'movement', qid: 'Q40415', via: 'style' } }), M).rel, 1);
});

test('genre: "natureza morta" matches English and Danish still-life titles', () => {
  const M = R.buildMatcher({ kind: 'genre', qid: 'Q170571', label: 'still life', labels: { en: 'still life' }, aliases: [], core: 'natureza morta', raw: 'natureza morta', lexicon: EB.lexicon.lookup('natureza morta') });
  assert.ok(R.relevance(item({ title: 'Still Life with Apples' }), M).rel >= 0.9);
  assert.ok(R.relevance(item({ title: 'Opstilling med frugt' }), M).rel >= 0.9);
  assert.ok(R.relevance(item({ title: 'Life of Christ' }), M).rel < 0.6);
});

test('free text: every word must be found for a strong match', () => {
  const M = R.buildMatcher({ kind: 'free', core: 'water lilies', raw: 'water lilies', labels: {} });
  assert.equal(R.relevance(item({ title: 'Water Lilies', artist: 'Claude Monet' }), M).rel, 0.9);
  assert.ok(R.relevance(item({ title: 'Water Mill' }), M).rel < 0.6);
});

test('order(): relevant first, weak split out, requested medium boosted', () => {
  const M = R.buildMatcher(Object.assign({}, artistIntent, { medium: 'painting' }));
  const list = [
    item({ id: 'a', title: 'Irrelevant', artist: 'Paul Gauguin', rank: 0, pop: 1 }),
    item({ id: 'b', artist: 'Vincent van Gogh', medium: 'Reed pen and ink', classification: 'Drawing', rank: 1 }),
    item({ id: 'c', artist: 'Vincent van Gogh', medium: 'Oil on canvas', classification: 'Painting', rank: 5 }),
  ];
  const v = R.order(list, M);
  assert.deepEqual(v.strong.map(x => x.id), ['c', 'b']);
  assert.deepEqual(v.weak.map(x => x.id), ['a']);
});

test('diversify() caps one source at 3 per 6 when alternatives are close', () => {
  const mk = (id, source, score) => ({ id, source, score });
  const out = R.diversify([mk(1, 'met', 100), mk(2, 'met', 99), mk(3, 'met', 98), mk(4, 'met', 97), mk(5, 'aic', 95), mk(6, 'met', 60)]);
  assert.deepEqual(out.map(x => x.id), [1, 2, 3, 5, 4, 6]);
});

test('dedupe() keeps the museum record over its Wikidata copy', () => {
  const met = item({ id: 'met:1', source: 'met', title: 'Wheat Field with Cypresses', artist: 'Vincent van Gogh', qid: 'Q900202' });
  const wd = item({ id: 'wd:Q900202', source: 'wmc', title: 'A Wheatfield, with Cypresses', artist: 'Vincent van Gogh', qid: 'Q900202' });
  const aic = item({ id: 'aic:2', source: 'aic', title: 'The Bedroom', artist: 'Vincent van Gogh' });
  const cma = item({ id: 'cma:3', source: 'cma', title: 'The bedroom', artist: 'Gogh, Vincent van' });
  assert.deepEqual(R.dedupe([wd, met, aic, cma]).map(x => x.id), ['met:1', 'aic:2']);
});
