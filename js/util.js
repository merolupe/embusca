/* ============================================================
   embusca — shared utilities (browser + Node, no dependencies)
   Every engine file attaches to one global namespace, Embusca.
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};

  /* ---------- text normalisation ---------- */

  // Letters NFD does not decompose (Danish/German/Polish…).
  const SPECIAL = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };

  // Lowercase, strip accents: "Almeida Júnior" -> "almeida junior".
  function fold(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[øæœßłđðþı]/g, c => SPECIAL[c]);
  }

  // Folded, punctuation collapsed to single spaces.
  function norm(s) { return fold(s).replace(/[^a-z0-9]+/g, ' ').trim(); }

  function tokens(s) { const n = norm(s); return n ? n.split(' ') : []; }

  const STOP = new Set([
    'the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'by', 'with', 'for', 'to', 'from', 'or',
    'o', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos',
    'nas', 'com', 'por', 'para', 'pelo', 'pela', 'del', 'la', 'le', 'les', 'des', 'et', 'og', 'i',
  ]);

  // Name particles ignored when comparing artist names
  // ("Gogh, Vincent van" == "Vincent van Gogh").
  const PARTICLES = new Set([
    'van', 'von', 'de', 'der', 'den', 'da', 'di', 'del', 'della', 'du', 'le', 'la', 'y', 'e',
    'dos', 'das', 'do', 'ter', 'ten', 'af', 'zu', 'of', 'the', 'el', 'des', 'st', 'saint',
  ]);

  function nameKey(name) {
    return tokens(name).filter(t => !PARTICLES.has(t) && t.length > 1);
  }

  // Plural-tolerant token equality across EN/PT/DA: cat~cats, flor~flores,
  // lily~lilies, paisagem~paisagens, kat~katte, blomst~blomster.
  function tokEq(a, b) {
    if (a === b) return true;
    if (a.length > b.length) { const t = a; a = b; b = t; }
    if (a.length < 3) return false;
    const rest = b.slice(a.length);
    if (b.startsWith(a) && (rest === 's' || rest === 'es' || rest === 'e' || rest === 'er' || rest === 'te')) return true;
    if (a.endsWith('y') && b === a.slice(0, -1) + 'ies') return true;
    if (a.endsWith('m') && b === a.slice(0, -1) + 'ns') return true;
    if (a.endsWith('ao') && (b === a.slice(0, -2) + 'oes' || b === a.slice(0, -2) + 'aes')) return true;
    if (a.endsWith('al') && b === a.slice(0, -2) + 'ais') return true;
    return false;
  }

  // Does the phrase (token array) occur contiguously inside hay (token array)?
  function hasPhrase(hay, phrase) {
    if (!phrase.length || phrase.length > hay.length) return false;
    outer: for (let i = 0; i + phrase.length <= hay.length; i++) {
      for (let j = 0; j < phrase.length; j++) {
        const last = j === phrase.length - 1;
        if (!(last ? tokEq(hay[i + j], phrase[j]) : hay[i + j] === phrase[j])) continue outer;
      }
      return true;
    }
    return false;
  }

  // Word-prefix match ("impressionis" matches "impressionist", "impressionistic").
  function hasStem(hay, stem) {
    if (!stem || stem.length < 5) return false;
    return hay.some(t => t.startsWith(stem));
  }

  const uniq = arr => Array.from(new Set(arr));
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ---------- dates ---------- */

  const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  function roman(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const v = ROMAN[s[i]], nx = ROMAN[s[i + 1]] || 0;
      n += v < nx ? -v : v;
    }
    return n;
  }

  function centuryRange(c, qualifier, bce) {
    let start = (c - 1) * 100, end = start + 99;
    if (/early|first half|beginning/.test(qualifier)) end = start + (/half/.test(qualifier) ? 49 : 33);
    else if (/mid|middle/.test(qualifier)) { start += 33; end = start + 33; }
    else if (/late|second half|end/.test(qualifier)) start += /half/.test(qualifier) ? 50 : 66;
    return bce ? { start: -end - 1, end: -start - 1 } : { start, end };
  }

  // Parse the year span out of free-form museum date strings:
  // "ca. 1665–67", "1887-88", "1850s", "late 19th century", "500 B.C.",
  // Wikidata ISO "+1889-01-01T00:00:00Z", "século XIX", "1800-tallet".
  function parseYears(input) {
    if (input == null) return null;
    if (typeof input === 'number') return isFinite(input) ? { start: input, end: input } : null;
    const s = String(input).trim();
    if (!s || s === '—') return null;
    let m = s.match(/^([+-]?)(\d{1,6})-\d\d-\d\dT/);
    if (m) { const y = parseInt(m[2], 10) * (m[1] === '-' ? -1 : 1); return { start: y, end: y }; }

    const f = fold(s);
    const bce = /\d\s*(b\.?\s?c\.?(e\.?)?|bce|a\.?\s?c\.?)(?![a-z])/.test(f) || /\bbc\b|\bbce\b/.test(f);

    m = f.match(/(\d{1,2})(?:st|nd|rd|th)\s*(?:[-–—]|to|and)\s*(\d{1,2})(?:st|nd|rd|th)[\s-]+(?:century|centuries|c\.)/);
    if (m) {
      const a = centuryRange(+m[1], '', bce), b = centuryRange(+m[2], '', bce);
      return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
    }
    m = f.match(/((?:early|mid|middle|late|first half of the|second half of the|beginning of the|end of the)?)[\s-]*(\d{1,2})(?:st|nd|rd|th)[\s-]+(?:century|c\.)/);
    if (m) return centuryRange(+m[2], m[1] || '', bce);
    m = f.match(/seculo\s+([ivxlc]+)\b/);
    if (m) return centuryRange(roman(m[1]), '', bce);
    m = f.match(/\b(\d{2})00-tallet\b/);
    if (m) return { start: +m[1] * 100, end: +m[1] * 100 + 99 };
    m = f.match(/\b(\d{3})0\s*'?s\b/);
    if (m) return { start: +m[1] * 10, end: +m[1] * 10 + 9 };

    const years = [];
    const re = /(\d{3,4})(?:\s*[-–—/]\s*(\d{1,4}))?/g;
    while ((m = re.exec(f))) {
      const a = +m[1];
      if (a < 100 || a > 2100) continue;
      years.push(a);
      if (m[2]) {
        let b = m[2];
        if (b.length < m[1].length) b = m[1].slice(0, m[1].length - b.length) + b;
        if (+b >= a && +b - a < 400) years.push(+b);
      }
    }
    if (!years.length) return null;
    let start = Math.min(...years), end = Math.max(...years);
    if (bce) { const t = -end; end = -start; start = t; }
    return { start, end };
  }

  function formatYears(r) {
    if (!r) return '';
    const f = y => y < 0 ? (-y) + ' BCE' : String(y);
    return r.start === r.end ? f(r.start) : f(r.start) + '–' + f(r.end);
  }

  /* ---------- HTML ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Plain text out of a museum HTML fragment. DOMParser builds an inert
  // document (no script execution, no image loads) — unlike assigning to
  // innerHTML of a live element, where <img onerror> would fire.
  function stripHtml(s) {
    if (!s) return '';
    const cut = String(s).split(/<div/i)[0];
    if (typeof root.DOMParser === 'function') {
      const doc = new root.DOMParser().parseFromString(cut, 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return cut.replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* ---------- network ---------- */

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Swappable transport so tests can replace it with fixtures.
  const http = { fetch: (url, opts) => root.fetch(url, opts) };

  const memCache = new Map();   // url -> { t, promise }
  const MEM_MAX = 400;

  function linkSignals(outer, ctrl) {
    if (!outer) return () => {};
    if (outer.aborted) { ctrl.abort(); return () => {}; }
    const on = () => ctrl.abort();
    outer.addEventListener('abort', on, { once: true });
    return () => outer.removeEventListener('abort', on);
  }

  // GET JSON with a hard timeout, abort support, retries with backoff on
  // network errors / 429 / 5xx, and an in-memory cache that also collapses
  // concurrent identical requests.
  function fetchJson(url, opts = {}) {
    const { timeout = 15000, retries = 0, signal, ttl = 10 * 60 * 1000, headers } = opts;
    const hit = memCache.get(url);
    if (ttl > 0 && hit && Date.now() - hit.t < ttl) return hit.promise;

    const promise = (async () => {
      for (let attempt = 0; ; attempt++) {
        const ctrl = new AbortController();
        const unlink = linkSignals(signal, ctrl);
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
          const r = await http.fetch(url, { signal: ctrl.signal, headers });
          if (!r.ok) {
            const err = new Error('HTTP ' + r.status);
            err.status = r.status;
            throw err;
          }
          return await r.json();
        } catch (e) {
          const aborted = e.name === 'AbortError' || (signal && signal.aborted);
          const retryable = !(signal && signal.aborted) && (!e.status || e.status === 429 || e.status >= 500);
          if (attempt >= retries || !retryable) {
            const err = new Error(aborted && !(signal && signal.aborted) ? 'timed out' : (e.message || 'network error'));
            err.status = e.status;
            err.aborted = !!(signal && signal.aborted);
            throw err;
          }
          await sleep(600 * Math.pow(2, attempt));
        } finally {
          clearTimeout(timer);
          unlink();
        }
      }
    })();

    if (ttl > 0) {
      memCache.set(url, { t: Date.now(), promise });
      promise.catch(() => memCache.delete(url));
      if (memCache.size > MEM_MAX) memCache.delete(memCache.keys().next().value);
    }
    return promise;
  }

  // Run fn over items with at most `limit` in flight; keeps result order.
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  // Resolve with the promise, or with `fallback` after ms (never rejects).
  function within(promise, ms, fallback) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(fallback), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
    });
  }

  /* ---------- persistent cache (browser only; silently absent in Node) ---------- */

  function hasStorage() {
    try { return !!root.localStorage; } catch (e) { return false; }
  }

  // A small LRU map persisted in one localStorage key.
  function persistentMap(key, max, ttlMs) {
    let data = null;
    function load() {
      if (data) return data;
      data = {};
      if (!hasStorage()) return data;
      try { data = JSON.parse(root.localStorage.getItem(key)) || {}; } catch (e) { data = {}; }
      return data;
    }
    function save() {
      if (!hasStorage()) return;
      try { root.localStorage.setItem(key, JSON.stringify(data)); } catch (e) {
        // quota: drop the older half and try once more
        const keys = Object.keys(data);
        keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => delete data[k]);
        try { root.localStorage.setItem(key, JSON.stringify(data)); } catch (e2) { /* give up */ }
      }
    }
    let saveTimer = null;
    return {
      get(k) {
        const d = load(), e = d['k' + k];
        if (!e) return null;
        if (ttlMs && Date.now() - e.t > ttlMs) { delete d['k' + k]; return null; }
        return e.v;
      },
      set(k, v) {
        const d = load();
        delete d['k' + k];              // re-insert = most recent
        d['k' + k] = { t: Date.now(), v };
        const keys = Object.keys(d);
        if (keys.length > max) keys.slice(0, keys.length - max).forEach(x => delete d[x]);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 300);
      },
      clear() {
        data = {};
        clearTimeout(saveTimer);
        if (hasStorage()) { try { root.localStorage.removeItem(key); } catch (e) { /* ignore */ } }
      },
    };
  }

  function wikidataId(url) {
    const m = String(url || '').match(/(Q\d+)\s*$/);
    return m ? m[1] : null;
  }

  EB.util = {
    fold, norm, tokens, nameKey, tokEq, hasPhrase, hasStem, uniq, clamp,
    STOP, PARTICLES, parseYears, formatYears, esc, stripHtml,
    sleep, http, fetchJson, mapLimit, within, persistentMap, wikidataId,
    _memCache: memCache,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
