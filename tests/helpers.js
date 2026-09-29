'use strict';
// Loads the browser engine files into a fresh global namespace, in page order.
const FILES = ['util', 'lexicon', 'intent', 'sources', 'rank', 'search', 'suite'];

function loadEngine() {
  globalThis.Embusca = {};
  for (const f of FILES) {
    const p = require.resolve('../js/' + f + '.js');
    delete require.cache[p];
    require(p);
  }
  return globalThis.Embusca;
}

module.exports = { loadEngine, FILES };
