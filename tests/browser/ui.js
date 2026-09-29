#!/usr/bin/env node
'use strict';
/* Drives the real page in headless Chromium with every network request
   answered by the offline fixture world (tests/fixtures/world.js).
   Needs Playwright:  npm i -D playwright  (or a global install).
   Usage: node tests/browser/ui.js [--shots=DIR] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const world = require('../fixtures/world');

function loadPlaywright() {
  const tries = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}

const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const pw = loadPlaywright();
  if (!pw) { console.log('SKIP: playwright is not installed'); return; }
  const shots = (process.argv.find(a => a.startsWith('--shots=')) || '').slice(8);
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (/\.(jpe?g|png)(\?|$)|\/iiif\/|framemark|Special:FilePath|flagcdn/i.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    const body = world.route(url, {});
    const status = body && body.status && Object.keys(body).length === 1 ? body.status : 200;
    return route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });

  const step = async (name, fn) => { await fn(); console.log('ok -', name); };
  const cards = () => page.$$eval('#grid .card', els => els.map(e => ({ id: e.dataset.k, title: e.querySelector('.card-title').textContent, artist: e.querySelector('.card-artist').textContent })));

  try {
    await step('van gogh: context panel + 6 relevant cards', async () => {
      await page.goto(base + 'index.html?q=van%20gogh');
      await page.waitForFunction(() => window.embusca && window.embusca.state.done, null, { timeout: 30000 });
      const title = await page.textContent('#context .ctx-title');
      assert.match(title, /Vincent van Gogh/);
      assert.match(await page.textContent('#context .ctx-kind'), /Artist/);
      assert.match(await page.textContent('#context'), /Post-Impressionism/);
      const c = await cards();
      assert.ok(c.length >= 6, 'at least 6 cards');
      c.slice(0, 6).forEach(x => assert.match(x.artist, /Gogh/, JSON.stringify(x)));
      assert.ok(await page.isVisible('#weak'), 'less related section present');
      if (shots) await page.screenshot({ path: path.join(shots, 'grid-van-gogh.png'), fullPage: false });
    });

    await step('timeline: a ten-year career is grouped year by year, in order', async () => {
      await page.click('.toggle button[data-view="timeline"]');
      const labels = await page.$$eval('.tl-label span', els => els.map(e => e.textContent));
      assert.ok(labels.includes('1888') && labels.includes('1889'), labels.join(','));
      const years = labels.filter(l => /^\d{4}$/.test(l)).map(Number);
      assert.deepEqual(years, years.slice().sort((a, b) => a - b));
      if (shots) await page.screenshot({ path: path.join(shots, 'timeline-van-gogh.png') });
      await page.click('.toggle button[data-view="grid"]');
    });

    await step('detail view explains why, keyboard opens and Escape closes', async () => {
      await page.focus('#grid .card');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#overlay.open');
      assert.match(await page.textContent('.fact.why'), /by Vincent van Gogh/);
      if (shots) await page.screenshot({ path: path.join(shots, 'modal.png') });
      await page.keyboard.press('Escape');
      assert.ok(!(await page.isVisible('#overlay.open')));
    });

    await step('"gatos" (PT) → subject cat, Danish query to SMK, no irrelevant card on top', async () => {
      await page.fill('#q', 'gatos');
      await page.press('#q', 'Enter');
      await page.waitForFunction(() => window.embusca.state.query === 'gatos' && window.embusca.state.done, null, { timeout: 30000 });
      assert.match(await page.textContent('#context .ctx-kind'), /Subject/);
      const c = await cards();
      assert.ok(!c.slice(0, 6).some(x => /Catskill|Catherine|Catalogue/.test(x.title)), JSON.stringify(c.slice(0, 6)));
      assert.match(page.url(), /q=gatos/);
      if (shots) await page.screenshot({ path: path.join(shots, 'grid-gatos.png') });
    });

    await step('"Search the exact words instead" chip switches to plain text', async () => {
      await page.click('#context .chip[data-pin="none"]');
      await page.waitForFunction(() => window.embusca.state.pin === 'none' && window.embusca.state.done, null, { timeout: 30000 });
      assert.match(await page.textContent('#context .ctx-kind'), /Keywords/);
    });

    await step('impressionismo: movement panel lists artists; chip pins an artist', async () => {
      await page.goto(base + 'index.html?q=impressionismo');
      await page.waitForFunction(() => window.embusca.state.done, null, { timeout: 30000 });
      assert.match(await page.textContent('#context .ctx-kind'), /Movement/);
      assert.match(await page.textContent('#context'), /Claude Monet/);
      if (shots) await page.screenshot({ path: path.join(shots, 'context-impressionismo.png') });
      await page.click('#context .chip[data-q="Claude Monet"]');
      await page.waitForFunction(() => window.embusca.state.query === 'Claude Monet' && window.embusca.state.done, null, { timeout: 30000 });
      assert.match(await page.textContent('#context .ctx-title'), /Claude Monet/);
    });

    await step('diagnostics panel renders the suite table', async () => {
      await page.evaluate(() => { window.__fast = true; });
      const res = await page.evaluate(() => window.Embusca.suite.run({ only: ['van gogh', 'gatos', 'impressionismo'] })
        .then(r => r.map(x => ({ q: x.q, verdict: x.verdict, p6: x.p6 }))));
      res.forEach(r => assert.equal(r.verdict, 'PASS', JSON.stringify(r)));
    });

    await step('mobile width: no horizontal scroll', async () => {
      await page.setViewportSize({ width: 380, height: 800 });
      await page.goto(base + 'index.html?q=van%20gogh');
      await page.waitForFunction(() => window.embusca.state.done, null, { timeout: 30000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, 'horizontal overflow ' + overflow + 'px');
      if (shots) await page.screenshot({ path: path.join(shots, 'mobile.png') });
    });

    assert.deepEqual(errors, [], 'no page errors');
    console.log('ALL UI CHECKS PASSED');
  } catch (e) {
    console.error('FAIL:', e.message);
    if (errors.length) console.error('page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
