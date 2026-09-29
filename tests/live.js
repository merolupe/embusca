#!/usr/bin/env node
'use strict';
/* Live relevance suite against the real museum APIs and Wikidata.
     node tests/live.js                    new engine
     node tests/live.js --compare          new engine vs. the old round-robin merge
     node tests/live.js --only="van gogh,gatos"
   Behind an HTTP proxy (Node >= 22.21):  NODE_USE_ENV_PROXY=1 node tests/live.js
   Writes tests/report/live-<timestamp>.{json,md}. Exit code 1 if any query fails. */
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./helpers');

const EB = loadEngine();
const arg = name => { const a = process.argv.find(x => x.startsWith('--' + name)); return a ? (a.split('=')[1] || true) : null; };
const only = arg('only') ? String(arg('only')).split(',').map(s => s.trim()) : null;

// Wikimedia asks API clients to identify themselves (browsers do this implicitly).
const UA = 'embusca-relevance-suite/1.0 (https://github.com/merolupe/embusca)';
EB.util.http.fetch = (url, opts) => fetch(url, Object.assign({}, opts, { headers: Object.assign({ 'User-Agent': UA, 'Api-User-Agent': UA }, (opts && opts.headers) || {}) }));

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

function line(r) {
  const why = r.error ? r.error : (r.misses || []).slice(0, 2).map(m => m.title + ' [' + m.source + ']').join('; ');
  return pad(r.q, 24) + pad(r.cat, 7) + pad((r.kind || '-') + (r.label && r.kind !== 'free' ? ': ' + r.label : ''), 30)
    + pad((r.p6 != null ? r.p6 : '-') + '/6', 6) + pad((r.relevantStrong != null ? r.relevantStrong : '-') + '/' + (r.strong != null ? r.strong : '-'), 9)
    + pad(r.ms ? (r.ms / 1000).toFixed(1) + 's' : '-', 7) + pad(r.verdict, 6) + (r.verdict !== 'PASS' ? why : '');
}

function markdown(runs) {
  let md = '# embusca — live relevance report\n\nRun: ' + new Date().toISOString() + '\n\n';
  for (const { label, results } of runs) {
    const s = EB.suite.summarize(results);
    md += '## ' + label + '\n\n**' + s.pass + '/' + s.n + ' PASS** · WARN ' + s.warn + ' · FAIL ' + s.fail + ' · mean relevant in first 6: ' + s.meanP6.toFixed(2) + '\n\n';
    md += '| Query | Type | Understood as | First 6 | Relevant (main) | Time | Verdict |\n|---|---|---|---|---|---|---|\n';
    md += results.map(r => '| ' + r.q + ' | ' + r.cat + ' | ' + (r.kind || '-') + (r.label && r.kind !== 'free' ? ': ' + r.label : '') + ' | ' + (r.p6 != null ? r.p6 : '-') + '/6 | '
      + (r.relevantStrong != null ? r.relevantStrong + ' of ' + r.strong : '-') + ' | ' + (r.ms ? (r.ms / 1000).toFixed(1) + ' s' : '-') + ' | ' + r.verdict + ' |').join('\n') + '\n\n';
    const failing = results.filter(r => r.verdict !== 'PASS');
    if (failing.length) md += '### Misses (irrelevant items in the first 12)\n\n' + failing.map(r => '- **' + r.q + '**: ' + (r.error || (!r.strong ? 'no relevant results' : (r.misses || []).map(m => m.title + ' — ' + m.artist + ' [' + m.source + ']').join('; ') || 'fewer than 6 relevant'))).join('\n') + '\n\n';
    md += '### Sources per query\n\n' + results.map(r => '- ' + r.q + ': ' + (r.sources || []).map(x => x.key + '=' + (x.error ? 'ERR(' + x.error + ')' : x.count)).join(', ')).join('\n') + '\n\n';
  }
  return md;
}

(async () => {
  const modes = arg('compare') ? [false, true] : [!!arg('legacy')];
  const runs = [];
  for (const legacy of modes) {
    const label = legacy ? 'Old engine (raw query, round-robin merge)' : 'New engine (intent + targeted queries + ranking)';
    console.log('\n' + label + '\n' + pad('query', 24) + pad('type', 7) + pad('understood as', 30) + pad('top6', 6) + pad('relevant', 9) + pad('time', 7) + 'verdict');
    const results = await EB.suite.run({ only, legacy, pauseMs: 1500, onResult: r => console.log(line(r)) });
    const s = EB.suite.summarize(results);
    console.log('=> ' + s.pass + '/' + s.n + ' PASS · mean relevant in first 6: ' + s.meanP6.toFixed(2));
    runs.push({ label, legacy, results });
  }
  const dir = path.join(__dirname, 'report');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, 'live-' + stamp + '.json'), JSON.stringify(runs, null, 1));
  fs.writeFileSync(path.join(dir, 'live-' + stamp + '.md'), markdown(runs));
  console.log('\nreport: tests/report/live-' + stamp + '.md');
  if (runs.some(r => !r.legacy && r.results.some(x => x.verdict === 'FAIL'))) process.exitCode = 1;
})();
