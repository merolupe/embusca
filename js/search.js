/* ============================================================
   embusca — search session
   One Session per query: resolves the intent, enriches it in the
   background, queries every enabled source in parallel (each with
   its own timeout), and ranks whatever has arrived on demand.
     view()  -> full ranking of everything loaded   (first page)
     drain() -> ranking of items not yet handed out (infinite scroll)
   onUpdate({ phase: intent | enriched | source | done }) streams
   progress so the UI can render before the slowest museum answers.
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};
  const U = EB.util;

  // The Met needs one request per object, so it gets more time.
  const SOURCE_TIMEOUT = { met: 35000, wmc: 25000 };
  const DEFAULT_TIMEOUT = 18000;

  class Session {
    constructor(query, opts = {}) {
      this.query = String(query || '').trim();
      this.sources = opts.sources || Object.keys(EB.sources.ADAPTERS);
      this.pin = opts.pin || null;
      this.legacy = !!opts.legacy;
      this.onUpdate = opts.onUpdate || null;
      this.ctrl = new AbortController();
      this.items = new Map();       // id -> item (everything loaded)
      this.displayed = new Set();   // ids already handed to the UI
      this.pager = {};              // source -> { page, done, state, count, status, error }
      this.t0 = Date.now();
      this.timing = {};
      this.enriched = Promise.resolve();
    }

    abort() { this.ctrl.abort(); }
    get aborted() { return this.ctrl.signal.aborted; }

    emit(phase, extra) {
      if (!this.onUpdate || this.aborted) return;
      try { this.onUpdate(Object.assign({ phase, session: this }, extra || {})); } catch (e) { console.error(e); }
    }

    async start() {
      const signal = this.ctrl.signal;
      this.intent = this.legacy
        ? EB.intent.free(this.query)
        : await EB.intent.resolve(this.query, { pin: this.pin, signal }).catch(() => EB.intent.free(this.query));
      this.timing.intent = Date.now() - this.t0;
      this.matcher = EB.rank.buildMatcher(this.intent);
      this.emit('intent');

      if (!this.legacy) {
        const p = EB.intent.enrich(this.intent, { signal }).then(() => {
          this.matcher = EB.rank.buildMatcher(this.intent);
          this.emit('enriched');
        });
        this.enriched = U.within(p, 5000, null);
      }
      await Promise.all(this.sources.map(k =>
        this.fetchPage(k, 1).then(() => this.emit('source', { source: k }))));
      await this.enriched;
      this.timing.done = Date.now() - this.t0;
      this.emit('done');
      return this;
    }

    async fetchPage(key, page) {
      const p = this.pager[key] || (this.pager[key] = { page: 0, done: false, state: {}, count: 0, status: 'loading' });
      if (p.done || this.aborted) return [];
      p.page = page;
      p.status = 'loading';
      const adapter = EB.sources.ADAPTERS[key];
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      this.ctrl.signal.addEventListener('abort', onAbort, { once: true });
      const ms = SOURCE_TIMEOUT[key] || DEFAULT_TIMEOUT;
      let timer;
      try {
        const res = await Promise.race([
          adapter.search({ intent: this.intent, page, state: p.state, signal: ctrl.signal, enriched: this.enriched, legacy: this.legacy }),
          new Promise((_, rej) => { timer = setTimeout(() => { ctrl.abort(); rej(new Error('timed out')); }, ms); }),
        ]);
        p.done = !!res.done || !res.items.length;
        const fresh = [];
        for (const it of res.items) {
          if (this.items.has(it.id)) continue;
          it.page = page;
          this.items.set(it.id, it);
          fresh.push(it);
        }
        p.count += fresh.length;
        p.status = 'ok';
        p.error = null;
        return fresh;
      } catch (e) {
        p.done = true;
        p.status = this.aborted ? 'aborted' : 'error';
        p.error = e.message || 'failed';
        return [];
      } finally {
        clearTimeout(timer);
        this.ctrl.signal.removeEventListener('abort', onAbort);
      }
    }

    rank(items) {
      const pool = EB.rank.dedupe(items);
      if (this.legacy) return { strong: EB.rank.interleave(pool), weak: [] };
      return EB.rank.order(pool, this.matcher);
    }

    // Full ranking of everything loaded so far; marks it as displayed.
    view() {
      const v = this.rank([...this.items.values()]);
      this.displayed = new Set(v.strong.concat(v.weak).map(it => it.id));
      return v;
    }

    // Ranking of new arrivals only, minus duplicates of what is on screen.
    drain() {
      const fresh = [...this.items.values()].filter(it => !this.displayed.has(it.id));
      const shown = new Set();
      for (const id of this.displayed) { const it = this.items.get(id); if (it) EB.rank.keysOf(it).forEach(k => shown.add(k)); }
      const v = this.rank(fresh.filter(it => !EB.rank.keysOf(it).some(k => shown.has(k))));
      fresh.forEach(it => this.displayed.add(it.id));
      return v;
    }

    hasMore() { return this.sources.some(k => this.pager[k] && !this.pager[k].done); }

    async loadMore() {
      const active = this.sources.filter(k => this.pager[k] && !this.pager[k].done);
      await Promise.all(active.map(k => this.fetchPage(k, this.pager[k].page + 1)));
      return this.drain();
    }

    status() {
      return this.sources.map(k => {
        const p = this.pager[k] || {};
        return { key: k, status: p.status || 'loading', count: p.count || 0, error: p.error || null, done: !!p.done };
      });
    }
  }

  EB.Session = Session;
  EB.search = (query, opts) => new Session(query, opts).start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
