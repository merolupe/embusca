'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers');

const EB = loadEngine();
const U = EB.util;

test('fold/norm/tokens handle accents and Danish letters', () => {
  assert.equal(U.norm('Almeida Júnior'), 'almeida junior');
  assert.equal(U.norm('Christen Købke'), 'christen kobke');
  assert.equal(U.norm('Æble & Ø'), 'aeble o');
  assert.deepEqual(U.tokens('Self-Portrait, 1887'), ['self', 'portrait', '1887']);
});

test('nameKey drops particles so inverted names compare equal', () => {
  assert.deepEqual(U.nameKey('Vincent van Gogh').sort(), U.nameKey('Gogh, Vincent van').sort());
  assert.deepEqual(U.nameKey('Pieter de Hooch'), ['pieter', 'hooch']);
});

test('tokEq is plural tolerant across EN/PT/DA', () => {
  for (const [a, b] of [['cat', 'cats'], ['flor', 'flores'], ['lily', 'lilies'], ['paisagem', 'paisagens'],
    ['leao', 'leoes'], ['animal', 'animais'], ['hest', 'heste'], ['blomst', 'blomster'], ['kat', 'katte']]) {
    assert.ok(U.tokEq(a, b), a + ' ~ ' + b);
  }
  assert.ok(!U.tokEq('cat', 'catalogue'));
  assert.ok(!U.tokEq('art', 'artist'));
});

test('hasPhrase matches contiguous phrases with a plural last word', () => {
  assert.ok(U.hasPhrase(U.tokens('Still Life with Apples'), ['still', 'life']));
  assert.ok(U.hasPhrase(U.tokens('Two Cats on a Roof'), ['cat']));
  assert.ok(!U.hasPhrase(U.tokens('Life is still'), ['still', 'life']));
});

test('parseYears understands museum date formats', () => {
  const cases = [
    ['1889', 1889, 1889], ['ca. 1665–67', 1665, 1667], ['1887-88', 1887, 1888], ['1850s', 1850, 1859],
    ['late 19th century', 1866, 1899], ['early 17th century', 1600, 1633], ['18th–19th century', 1700, 1899],
    ['500 B.C.', -500, -500], ['3rd century BCE', -300, -201], ['+1889-01-01T00:00:00Z', 1889, 1889],
    ['século XIX', 1800, 1899], ['1800-tallet', 1800, 1899], ['1 March 1889', 1889, 1889], ['1850-1860', 1850, 1860],
  ];
  for (const [s, a, b] of cases) assert.deepEqual(U.parseYears(s), { start: a, end: b }, s);
  assert.equal(U.parseYears('—'), null);
  assert.equal(U.parseYears('undated'), null);
});

test('stripHtml falls back to a regex outside the browser', () => {
  assert.equal(U.stripHtml('<a href="x">Vincent</a> &amp; <b>Theo</b><div class="hidden">junk</div>'), 'Vincent & Theo');
});

test('fetchJson caches, collapses concurrent calls and retries 5xx', async () => {
  let calls = 0;
  U.http.fetch = async () => { calls++; return calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ n: calls }) }; };
  U._memCache.clear();
  const [a, b] = await Promise.all([U.fetchJson('https://x.test/a', { retries: 1 }), U.fetchJson('https://x.test/a', { retries: 1 })]);
  assert.deepEqual(a, { n: 2 });
  assert.strictEqual(a, b);
  assert.equal(calls, 2);
  await U.fetchJson('https://x.test/a');
  assert.equal(calls, 2, 'served from cache');
});

test('fetchJson does not retry 4xx', async () => {
  let calls = 0;
  U.http.fetch = async () => { calls++; return { ok: false, status: 404 }; };
  U._memCache.clear();
  await assert.rejects(U.fetchJson('https://x.test/404', { retries: 3 }), /HTTP 404/);
  assert.equal(calls, 1);
});
