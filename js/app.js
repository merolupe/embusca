/* ============================================================
   embusca — page UI: results grid, context panel (feature 1),
   timeline (feature 2), detail view, infinite scroll, shareable
   URLs and the diagnostics panel. All search logic lives in the
   engine files; this file only renders Sessions.
   ============================================================ */
(function () {
  'use strict';
  const EB = window.Embusca;
  const U = EB.util, META = EB.sources.META, esc = U.esc;
  const $ = id => document.getElementById(id);

  const DEFAULT_QUERY = 'impressionist painting';

  /* ---------- country flags ---------- */
  // Word boundaries matter: "Toledo" is not Edo (Japan), "Perugia" is not Peru.
  const FLAG_MAP = [
    [/\bbrazil|\bbrasil/, 'br'],
    [/\bfrance\b|\bfrench\b|\bfransk|\bparis\b/, 'fr'],
    [/netherlands|\bdutch\b|\bholland|amsterdam|nederland/, 'nl'],
    [/\bjapan|\btokyo\b|\bkyoto\b|\bedo\b/, 'jp'],
    [/united states|\bamerican\b|amerikansk|new york|boston|philadelphia/, 'us'],
    [/\bital(y|ian)\b|italiensk|\brome\b|venice|florence|milan/, 'it'],
    [/\bspain\b|\bspanish\b|spansk|madrid|catalan|catalonia/, 'es'],
    [/\bgerman|\btysk|munich|berlin|bavaria|nuremberg/, 'de'],
    [/britain|british|england|english|engelsk|united kingdom|london|scotland|wales/, 'gb'],
    [/denmark|danish|\bdansk|copenhagen|kobenhavn/, 'dk'],
    [/\bbelgi|flemish|flamsk|antwerp|bruges|brussels/, 'be'],
    [/austria|ostrigsk|vienna/, 'at'],
    [/greece|\bgreek\b|graesk|athens/, 'gr'],
    [/\bchina\b|chinese|kinesisk|beijing|canton/, 'cn'],
    [/\begypt|cairo/, 'eg'],
    [/\bindia\b|\bindian\b|delhi|mumbai/, 'in'],
    [/\biran\b|persia/, 'ir'],
    [/russia|russisk|moscow/, 'ru'],
    [/norway|norwegian|\bnorsk|\boslo\b/, 'no'],
    [/sweden|swedish|svensk|stockholm/, 'se'],
    [/switzerland|swiss|schweizisk|geneva|zurich/, 'ch'],
    [/mexic/, 'mx'],
    [/korea/, 'kr'],
    [/\bturk|istanbul|ottoman/, 'tr'],
    [/portug|lisbon/, 'pt'],
    [/poland|polish|polsk/, 'pl'],
    [/czech|bohemia|prague/, 'cz'],
    [/hungar|ungarsk/, 'hu'],
    [/ireland|irish|dublin/, 'ie'],
    [/canad/, 'ca'],
    [/\bperu\b|peruvian/, 'pe'],
  ];

  function countryFlag(country) {
    if (!country || country === '—') return null;
    // continental / ambiguous phrases get no flag rather than a wrong one
    const c = U.fold(country).replace(/(latin|south|central|native|north) american|american indian|indian ocean/g, ' ');
    for (const [re, code] of FLAG_MAP) if (re.test(c)) return code;
    return null;
  }

  function flagHtml(it, cls) {
    const code = countryFlag(it.country);
    if (!code) return '';
    return '<img class="' + cls + '" src="https://flagcdn.com/w40/' + code + '.png" alt="' + esc(it.country) + '" title="' + esc(it.country) + '">';
  }

  /* ---------- image CDN refusal (AIC's www.artic.edu vs some networks) ---------- */
  // api.artic.edu may answer while its image CDN 403s whole regions; detected
  // once so those works degrade to metadata-only cards.
  const hostBlocked = { aic: null };
  let blockCheck = null;

  function probeImage(url, timeoutMs) {
    return new Promise(resolve => {
      const img = new Image();
      const t = setTimeout(() => { img.src = ''; resolve({ ok: false, reason: 'timeout' }); }, timeoutMs || 15000);
      img.onload = () => { clearTimeout(t); resolve({ ok: true }); };
      img.onerror = () => { clearTimeout(t); resolve({ ok: false, reason: 'load error' }); };
      img.src = url;
    });
  }

  function detectBlockedHosts() {
    if (!blockCheck) {
      blockCheck = probeImage('https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/200,/0/default.jpg', 9000)
        .then(p => { hostBlocked.aic = !p.ok; renderStatus(); });
    }
    return blockCheck;
  }

  const isImageBlocked = it => it.source === 'aic' && hostBlocked.aic === true;

  /* ---------- state ---------- */
  const S = {
    session: null, query: '', pin: null,
    strong: [], weak: [], byId: new Map(), cards: new Map(),
    pristine: true, done: false, view: 'grid', summary: null,
    loadingMore: false, dryLoads: 0,
  };

  const grid = $('grid'), weakGrid = $('weakGrid'), timeline = $('timeline');
  const moreBtn = $('moreBtn'), qInput = $('q');

  const enabledSources = () => Object.keys(EB.sources.ADAPTERS).filter(k => $('src-' + k).checked);

  /* ---------- cards ---------- */
  const NOIMG_HTML = '<div class="thumb-wrap noimg"><div>Image unavailable —<br>the museum’s image server refused this network.<br>Details and museum link still available.</div></div>';

  const museumLabel = it => (it.source === 'wmc' && it.museum && it.museum !== META.wmc.name) ? it.museum : META[it.source].short;

  function cardHtml(it) {
    const thumb = isImageBlocked(it) ? NOIMG_HTML
      : '<div class="thumb-wrap"><img loading="lazy" src="' + esc(it.thumb) + '" alt="' + esc(it.title) + '"></div>';
    return '<div class="card" tabindex="0" role="button" data-k="' + esc(it.id) + '" title="' + esc(it.title) + '" aria-label="' + esc(it.title + ' — ' + it.artist) + '">'
      + thumb
      + '<div class="card-info"><div class="ci-left">'
      + '<div class="card-title">' + esc(it.title) + '</div>'
      + '<div class="card-artist">' + esc(it.artist) + '</div>'
      + '<div class="card-year">' + esc(it.date) + '</div>'
      + '</div><div class="ci-right">' + flagHtml(it, 'flag')
      + '<div class="card-museum">' + esc(museumLabel(it)) + '</div>'
      + '</div></div></div>';
  }

  // One DOM node per item, reused across re-rankings so loaded images stay put.
  function cardEl(it) {
    let el = S.cards.get(it.id);
    if (!el) {
      const t = document.createElement('template');
      t.innerHTML = cardHtml(it);
      el = t.content.firstElementChild;
      S.cards.set(it.id, el);
    }
    return el;
  }

  function fill(container, list) {
    const frag = document.createDocumentFragment();
    list.forEach(it => frag.appendChild(cardEl(it)));
    container.replaceChildren(frag);
  }

  function append(container, list) {
    const frag = document.createDocumentFragment();
    list.forEach(it => frag.appendChild(cardEl(it)));
    container.appendChild(frag);
  }

  /* ---------- status + toolbar ---------- */
  function renderStatus() {
    const s = S.session;
    if (!s) return;
    const rel = {};
    S.strong.forEach(it => { rel[it.source] = (rel[it.source] || 0) + 1; });
    $('status').innerHTML = s.status().map(st => {
      let text, err = false;
      if (st.status === 'loading' && !st.count) text = 'searching…';
      else if (st.status === 'error' && !st.count) { text = 'unavailable (' + st.error + ')'; err = true; }
      else text = st.count + (st.count === 1 ? ' work' : ' works') + (S.done ? ' · ' + (rel[st.key] || 0) + ' relevant' : '');
      if (st.key === 'aic' && hostBlocked.aic === true && st.count) { text += ' (previews blocked on your network — details only)'; err = true; }
      return '<span class="src-chip' + (err ? ' err' : '') + '"><b>' + esc(META[st.key].short) + '</b> — ' + esc(text) + '</span>';
    }).join('');
  }

  function renderToolbar() {
    const bar = $('toolbar');
    if (!S.strong.length && !S.weak.length) { bar.hidden = true; return; }
    bar.hidden = false;
    $('count').textContent = S.strong.length + ' relevant work' + (S.strong.length === 1 ? '' : 's')
      + (S.weak.length ? ' · ' + S.weak.length + ' less related' : '')
      + (S.done ? '' : ' · still searching…');
  }

  function updateMore() {
    const s = S.session;
    moreBtn.hidden = !(s && S.done && s.hasMore() && (S.strong.length || S.weak.length));
  }

  /* ---------- results ---------- */
  function renderResults() {
    const hasAny = S.strong.length || S.weak.length;
    if (!S.strong.length) {
      if (!S.done) {
        grid.innerHTML = '<div class="loading-box"><div class="loading-bar"></div>Searching ' + S.session.sources.length + ' collections…</div>';
      } else {
        grid.innerHTML = '<div class="empty">' + (hasAny
          ? 'No closely matching artworks — the looser matches are below.'
          : 'No artworks found. Try an artist (“Van Gogh”), a subject (“gatos”, “water lilies”) or a movement (“impressionismo”).') + '</div>';
      }
    } else {
      fill(grid, S.strong);
    }
    fill(weakGrid, S.weak);
    $('weakCount').textContent = S.weak.length;
    $('weak').hidden = !S.weak.length || S.view === 'timeline';
    if (S.done && !S.strong.length && S.weak.length) $('weak').open = true;
    if (S.view === 'timeline') renderTimeline();
  }

  function appendResults(d) {
    if (!d.strong.length && !d.weak.length) return;
    d.strong.concat(d.weak).forEach(it => S.byId.set(it.id, it));
    if (d.strong.length) {
      if (!S.strong.length) grid.replaceChildren();
      S.strong = S.strong.concat(d.strong);
      append(grid, d.strong);
    }
    if (d.weak.length) {
      S.weak = S.weak.concat(d.weak);
      append(weakGrid, d.weak);
      $('weakCount').textContent = S.weak.length;
      $('weak').hidden = S.view === 'timeline';
    }
    if (S.view === 'timeline') renderTimeline();
  }

  // While the user hasn't scrolled or opened anything, every update
  // re-ranks the whole first page; afterwards new items are only appended.
  function refresh(session) {
    if (S.pristine) {
      const v = session.view();
      S.strong = v.strong;
      S.weak = v.weak;
      S.byId = new Map(S.strong.concat(S.weak).map(it => [it.id, it]));
      renderResults();
    } else {
      appendResults(session.drain());
    }
    renderStatus();
    renderToolbar();
    updateMore();
  }

  /* ---------- feature 1: context panel ---------- */
  const KIND_LABEL = { artist: 'Artist', movement: 'Movement · style', genre: 'Genre', subject: 'Subject', person: 'Person, as a subject', place: 'Place', artwork: 'Artwork', free: 'Keywords' };

  const chip = (label, sub, q, pin) => '<button type="button" class="chip" data-q="' + esc(q) + '"' + (pin ? ' data-pin="' + esc(pin) + '"' : '') + '>'
    + esc(label) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</button>';

  function exploreChips(i) {
    if (i.kind === 'artist') return (i.movements || []).slice(0, 3).map(m => chip(m.label, '', m.label, m.qid));
    if (i.kind === 'movement') return (i.artists || []).slice(0, 8).map(a => chip(a.name, '', a.name, a.qid));
    if (i.kind === 'artwork' && i.creator && i.creator.name) return [chip('More by ' + i.creator.name, '', i.creator.name, i.creator.qid)];
    return [];
  }

  function renderContext() {
    const s = S.session, i = s && s.intent, box = $('context');
    const hide = () => { box.hidden = true; box.replaceChildren(); };
    if (!i) return hide();
    const alts = (i.alternatives || []).map(a => chip(a.label, a.description, S.query, a.qid));
    if (i.kind !== 'free') alts.push(chip('Search the exact words instead', '', S.query, 'none'));
    else if (S.pin === 'none') alts.push(chip('Interpret “' + S.query + '” instead', '', S.query, null));
    if (i.kind === 'free' && !alts.length) return hide();

    const pt = i.lang === 'pt';
    const title = i.kind === 'free' ? '“' + i.core + '”' : i.label;
    const sub = [];
    if (pt && i.labels && i.labels.pt && U.norm(i.labels.pt) !== U.norm(i.label)) sub.push(i.labels.pt);
    if (i.kind === 'artist' && i.lifespan && (i.lifespan.start || i.lifespan.end)) sub.push((i.lifespan.start || '?') + '–' + (i.lifespan.end || ''));
    if (i.kind === 'movement' && i.years) sub.push(i.years.start + '–' + i.years.end);
    const desc = i.kind === 'free'
      ? (S.pin === 'none' ? 'Searching for these exact words.' : 'No specific artist, style or subject recognised — searching for these words.')
      : ((pt && i.descriptionPt) || i.description || '');
    const sum = S.summary;
    const src = i.qid ? ' · <a href="https://www.wikidata.org/wiki/' + esc(i.qid) + '" target="_blank" rel="noopener">Wikidata ' + esc(i.qid) + '</a>'
      : (i.source === 'lexicon' ? ' · built-in vocabulary' : '');
    const explore = exploreChips(i);

    box.innerHTML = (sum && sum.thumb ? '<div class="ctx-media"><img src="' + esc(sum.thumb) + '" alt=""></div>' : '')
      + '<div class="ctx-main">'
      + '<div class="ctx-kind">' + esc(KIND_LABEL[i.kind] || i.kind) + src + (i.medium ? ' · ' + esc(i.medium) + 's first' : '') + '</div>'
      + '<h2 class="ctx-title">' + esc(title) + (sub.length ? '<span class="ctx-sub">' + esc(sub.join(' · ')) + '</span>' : '') + '</h2>'
      + (desc ? '<p class="ctx-desc">' + esc(desc) + '</p>' : '')
      + (sum ? '<p class="ctx-summary">' + esc(sum.text) + ' <a href="' + esc(sum.url) + '" target="_blank" rel="noopener">Wikipedia ↗</a></p>' : '')
      + (explore.length ? '<div class="ctx-row"><span class="ctx-lbl">Explore</span>' + explore.join('') + '</div>' : '')
      + (alts.length ? '<div class="ctx-row"><span class="ctx-lbl">' + (i.kind === 'free' ? 'Did you mean' : 'Not what you meant?') + '</span>' + alts.join('') + '</div>' : '')
      + '</div>';
    box.classList.toggle('noimg', !(sum && sum.thumb));
    box.hidden = false;
    const img = box.querySelector('.ctx-media img');
    if (img) img.addEventListener('error', () => { img.parentNode.remove(); box.classList.add('noimg'); }, { once: true });
  }

  $('context').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (c) runSearch(c.dataset.q, { pin: c.dataset.pin || null });
  });

  /* ---------- feature 2: timeline ---------- */
  const mid = it => (it.years.start + (it.years.end != null ? it.years.end : it.years.start)) / 2;
  const fmtYear = y => y < 0 ? (-y) + ' BCE' : String(y);

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function bucketLabel(b, size) {
    if (size === 1) return fmtYear(b);
    if (size === 10) return b < 0 ? (-b) + 's BCE' : b + 's';
    if (size === 5 || size === 25) return fmtYear(b) + '–' + fmtYear(b + size - 1);
    return b >= 0 ? ordinal(Math.floor(b / 100) + 1) + ' century' : ordinal(Math.floor(-b / 100)) + ' century BCE';
  }

  // Years for a short career (Van Gogh: 1881–1890), five-year spans or
  // decades for longer ones, quarter-centuries for a movement, centuries
  // for broad themes — chosen from the spread of the results.
  function timelineGroups(list) {
    const dated = [], undated = [];
    list.forEach(it => ((it.years && isFinite(it.years.start)) ? dated : undated).push(it));
    if (!dated.length) return { groups: [], undated };
    const mids = dated.map(mid);
    const span = Math.max(...mids) - Math.min(...mids);
    const size = span <= 15 ? 1 : span <= 40 ? 5 : span <= 100 ? 10 : span <= 400 ? 25 : 100;
    const map = new Map();
    dated.slice().sort((a, b) => mid(a) - mid(b)).forEach(it => {
      const b = Math.floor(mid(it) / size) * size;
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(it);
    });
    return { size, undated, groups: [...map.entries()].sort((a, b) => a[0] - b[0]).map(([b, items]) => ({ label: bucketLabel(b, size), items })) };
  }

  function tlGroupHtml(label, items) {
    return '<section class="tl-group"><h3 class="tl-label"><span>' + esc(label) + '</span><small>' + items.length + ' work' + (items.length === 1 ? '' : 's') + '</small></h3>'
      + '<div class="tl-strip">' + items.map(it => '<div class="tl-card" tabindex="0" role="button" data-k="' + esc(it.id) + '" aria-label="' + esc(it.title + ', ' + it.date) + '">'
        + '<div class="tl-im">' + (isImageBlocked(it) ? '' : '<img loading="lazy" src="' + esc(it.thumb) + '" alt="">') + '</div>'
        + '<div class="tl-cap"><b>' + esc(it.title) + '</b><span>' + esc(it.date) + '</span></div></div>').join('')
      + '</div></section>';
  }

  function renderTimeline() {
    const t = timelineGroups(S.strong);
    if (!t.groups.length && !t.undated.length) { timeline.innerHTML = '<div class="empty">Nothing to place on a timeline yet.</div>'; return; }
    timeline.innerHTML = '<div class="tl">' + t.groups.map(g => tlGroupHtml(g.label, g.items)).join('')
      + (t.undated.length ? tlGroupHtml('Undated', t.undated) : '') + '</div>';
  }

  function setView(view) {
    S.view = view;
    document.querySelectorAll('.toggle button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    grid.hidden = view !== 'grid';
    timeline.hidden = view !== 'timeline';
    $('weak').hidden = view === 'timeline' || !S.weak.length;
    if (view === 'timeline') renderTimeline();
  }

  document.querySelectorAll('.toggle button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  /* ---------- detail view ---------- */
  const overlay = $('overlay'), modalBody = $('modalBody');
  let lastFocus = null;

  function similar(it, max) {
    const f = EB.rank.fields(it);
    const kw = new Set(f.kw.filter(t => t.length > 3));
    const key = U.nameKey(it.artist).sort().join(' ');
    const known = key && !/unknown/.test(key);
    const score = o => {
      const g = EB.rank.fields(o);
      let s = 0;
      if ((it.artistQid && it.artistQid === o.artistQid) || (known && U.nameKey(o.artist).sort().join(' ') === key)) s += 4;
      s += Math.min(2, g.kw.filter(t => kw.has(t)).length * 0.5);
      if (it.years && o.years && Math.abs(it.years.start - o.years.start) <= 10) s += 1;
      if (o.source === it.source) s += 0.3;
      return s + (o.rel || 0);
    };
    return S.strong.concat(S.weak)
      .filter(o => o !== it && !isImageBlocked(o))
      .map(o => [score(o), o]).filter(x => x[0] > 1).sort((a, b) => b[0] - a[0]).slice(0, max || 6).map(x => x[1]);
  }

  function openModal(id) {
    const it = S.byId.get(id);
    if (!it) return;
    S.pristine = false;
    if (!overlay.classList.contains('open')) lastFocus = document.activeElement;
    const viaWd = it.source === 'wmc' && it.museum !== META.wmc.name;
    const facts = [
      ['Title', esc(it.title)],
      ['Artist', esc(it.artistFull || it.artist)],
      ['Date', esc(it.date)],
      ['Medium', esc(it.medium)],
      ['Country', flagHtml(it, 'flag') + esc(it.country)],
      ['Museum', esc(it.museum) + (viaWd ? ' <small>(via Wikidata)</small>' : '')],
    ];
    const blocked = isImageBlocked(it);
    const sugg = similar(it, 6);
    modalBody.innerHTML =
        '<div class="modal-img">'
      + (blocked ? '<div class="noimg">Image unavailable — the museum’s image server refused this network.<br>Details and museum link below.</div>'
                 : '<img src="' + esc(it.thumb) + '" alt="' + esc(it.title) + '"><span class="imgnote">loading high resolution…</span>')
      + '</div>'
      + '<div class="modal-info">'
      + '<h2 id="modalTitle">' + esc(it.title) + '</h2>'
      + '<div class="modal-artist">' + esc(it.artist) + '</div>'
      + '<div class="facts">'
      + facts.map(f => '<div class="fact"><div class="k">' + f[0] + '</div><div class="v">' + f[1] + '</div></div>').join('')
      + (it.why ? '<div class="fact why"><div class="k">Why shown</div><div class="v">' + esc(it.why) + '</div></div>' : '')
      + '</div>'
      + '<div class="modal-actions">'
      + '<a href="' + esc(it.hires) + '" target="_blank" rel="noopener">Full-size image ↗</a>'
      + '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">View at ' + esc(it.source === 'wmc' ? 'Wikimedia' : META[it.source].short) + ' ↗</a>'
      + '</div>'
      + (sugg.length
          ? '<div class="suggest"><div class="sg-label">More like this</div><div class="sg-row">'
            + sugg.map(o => '<div class="sg-item" tabindex="0" role="button" data-k="' + esc(o.id) + '" aria-label="' + esc(o.title) + '">'
              + '<div class="sg-im"><img loading="lazy" src="' + esc(o.thumb) + '" alt=""></div>'
              + '<div class="sg-cap">' + esc(o.title) + '</div></div>').join('')
            + '</div></div>'
          : '')
      + '</div>';

    // Swap to high resolution once (and only if) it loads; the thumbnail
    // always stays as the guaranteed fallback.
    const imgEl = modalBody.querySelector('.modal-img img');
    const note = modalBody.querySelector('.imgnote');
    if (!blocked && imgEl) {
      if (it.hires && it.hires !== it.thumb) {
        const hi = new Image();
        hi.onload = () => { imgEl.src = it.hires; note.textContent = 'high resolution'; };
        hi.onerror = () => { note.textContent = 'high resolution unavailable — showing preview'; };
        hi.src = it.hires;
      } else {
        note.textContent = 'highest resolution provided by the source';
      }
    }
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    overlay.scrollTop = 0;
    $('modalClose').focus();
  }

  function closeModal() {
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    modalBody.innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- activation (click + keyboard) on any result tile ---------- */
  function activate(e) {
    const el = e.target.closest('[data-k]');
    if (el && !el.classList.contains('chip')) openModal(el.dataset.k);
  }
  [grid, weakGrid, timeline, modalBody].forEach(c => {
    c.addEventListener('click', activate);
    c.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-k]')) { e.preventDefault(); activate(e); } });
    // Broken thumbnails get a placeholder; broken flags disappear.
    // (capture phase — <img> error events don't bubble)
    c.addEventListener('error', e => {
      const img = e.target;
      if (img.tagName !== 'IMG') return;
      if (img.classList.contains('flag')) { img.remove(); return; }
      const wrap = img.closest('.thumb-wrap');
      if (wrap) wrap.outerHTML = NOIMG_HTML;
      else if (img.parentNode) img.parentNode.classList.add('noimg');
    }, true);
  });

  /* ---------- search flow ---------- */
  function pushUrl(q, pin) {
    try {
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      if (pin) u.searchParams.set('pin', pin); else u.searchParams.delete('pin');
      u.searchParams.delete('autotest');
      history.pushState({ q, pin }, '', u);
    } catch (e) { /* file:// pages cannot rewrite their URL */ }
  }

  function onUpdate(session, ev) {
    if (session !== S.session) return;
    if (ev.phase === 'intent') {
      renderContext();
      const i = session.intent;
      if (i.kind !== 'free' && i.wiki && (i.wiki.en || i.wiki.pt)) {
        EB.intent.summary(i).then(sum => { if (session === S.session && sum) { S.summary = sum; renderContext(); } });
      }
      return;
    }
    if (ev.phase === 'enriched') {
      renderContext();
      if (S.byId.size) refresh(session);
      return;
    }
    if (ev.phase === 'done') S.done = true;
    refresh(session);
  }

  function runSearch(q, opts) {
    opts = opts || {};
    q = (q || '').trim();
    if (!q) return;
    const sources = enabledSources();
    if (!sources.length) { grid.innerHTML = '<div class="empty">Select at least one collection above.</div>'; return; }
    if (S.session) S.session.abort();
    closeModal();
    qInput.value = q;
    Object.assign(S, {
      query: q, pin: opts.pin || null, strong: [], weak: [], byId: new Map(), cards: new Map(),
      pristine: true, done: false, summary: null, loadingMore: false, dryLoads: 0,
    });
    if (!opts.noUrl) pushUrl(q, S.pin);
    grid.innerHTML = '<div class="loading-box"><div class="loading-bar"></div>Understanding “' + esc(q) + '”…</div>';
    weakGrid.replaceChildren();
    $('weak').hidden = true;
    $('weak').open = false;
    $('context').hidden = true;
    $('context').replaceChildren();
    $('toolbar').hidden = true;
    moreBtn.hidden = true;
    if (S.view === 'timeline') timeline.innerHTML = '';
    detectBlockedHosts();
    const session = new EB.Session(q, { sources, pin: S.pin, onUpdate: ev => onUpdate(session, ev) });
    S.session = session;
    renderStatus();
    session.start().catch(err => {
      if (session !== S.session) return;
      grid.innerHTML = '<div class="empty">Search failed: ' + esc(err.message) + '</div>';
    });
  }

  /* ---------- pagination + infinite scroll ---------- */
  async function loadMore(manual) {
    const s = S.session;
    if (!s || !S.done || S.loadingMore || !s.hasMore()) return;
    if (!manual && S.dryLoads >= 2) return;   // stop auto-loading pages that bring nothing relevant
    S.loadingMore = true;
    S.pristine = false;
    moreBtn.classList.add('loading');
    moreBtn.textContent = 'Loading…';
    const d = await s.loadMore();
    moreBtn.classList.remove('loading');
    moreBtn.textContent = 'Load more';
    S.loadingMore = false;
    if (s !== S.session) return;
    S.dryLoads = d.strong.length ? 0 : S.dryLoads + 1;
    appendResults(d);
    renderStatus();
    renderToolbar();
    updateMore();
    if (d.strong.length && s.hasMore()) setTimeout(maybeAutoLoad, 400);
  }

  // IntersectionObserver only fires on visibility changes, so a sentinel that
  // is still on screen after a load is re-checked manually.
  function sentinelVisible() { return $('sentinel').getBoundingClientRect().top < window.innerHeight + 900; }
  function maybeAutoLoad() { if (sentinelVisible()) loadMore(false); }

  new IntersectionObserver(entries => { if (entries.some(en => en.isIntersecting)) loadMore(false); }, { rootMargin: '900px' })
    .observe($('sentinel'));
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) S.pristine = false;
    if (!S.loadingMore && sentinelVisible()) loadMore(false);
  }, { passive: true });
  // some environments throttle observers — a light poll as a fallback
  setInterval(() => { if (S.done && !S.loadingMore && sentinelVisible()) loadMore(false); }, 3000);

  /* ---------- diagnostics: the relevance suite, in the real browser ---------- */
  function verdictCls(v) { return v === 'PASS' ? 'oklbl' : v === 'WARN' ? 'warn' : 'fail'; }

  function diagTable(results) {
    return '<table><tr><th>Query</th><th>Type</th><th>Understood as</th><th>First 6</th><th>Relevant</th><th>Less related</th><th>Images</th><th>Time</th><th>Verdict</th></tr>'
      + results.map(r => '<tr><td>' + esc(r.q) + '</td><td>' + esc(r.cat) + '</td>'
        + '<td>' + esc((r.kind || '—') + (r.label && r.kind !== 'free' ? ': ' + r.label : '')) + (r.qid ? ' <small>' + esc(r.qid) + '</small>' : '') + '</td>'
        + '<td class="' + ((r.p6 === 6) ? 'oklbl' : 'fail') + '">' + (r.p6 != null ? r.p6 + ' / 6' : '—') + '</td>'
        + '<td>' + (r.relevantStrong != null ? r.relevantStrong + ' of ' + r.strong : '—') + '</td>'
        + '<td>' + (r.weak != null ? r.weak : '—') + '</td>'
        + '<td>' + (r.thumbs ? r.thumbs.ok + ' / ' + r.thumbs.n : '—') + '</td>'
        + '<td>' + (r.ms ? (r.ms / 1000).toFixed(1) + ' s' : '—') + '</td>'
        + '<td class="' + verdictCls(r.verdict) + '"><b>' + esc(r.verdict) + '</b>' + (r.error ? ' ' + esc(r.error) : '') + '</td></tr>').join('')
      + '</table>';
  }

  async function runDiagnostics() {
    const diag = $('diag'), body = $('diag-body');
    diag.classList.add('show');
    diag.scrollIntoView({ block: 'start' });
    await detectBlockedHosts();
    const done = [];
    body.innerHTML = '<em>Running the relevance suite (author, theme, style — English and Portuguese). This takes a few minutes…</em>';
    const results = await EB.suite.run({
      sources: enabledSources(), pauseMs: 1200, keepView: true,
      onProgress: p => { body.innerHTML = '<em>Testing “' + esc(p.entry.q) + '” (' + (p.index + 1) + ' of ' + p.total + ')…</em>' + (done.length ? diagTable(done) : ''); },
      onResult: r => done.push(r),
    });
    for (const r of results) {   // image health: can the first six actually be seen?
      const top = r.view ? r.view.strong.slice(0, 6).filter(it => !isImageBlocked(it)) : [];
      const probes = await U.mapLimit(top, 6, it => probeImage(it.thumb, 12000));
      r.thumbs = { ok: probes.filter(p => p.ok).length, n: probes.length };
      delete r.view;
    }
    const sum = EB.suite.summarize(results);
    const failing = results.filter(r => r.verdict !== 'PASS');
    window.__TEST_REPORT__ = results;
    body.innerHTML = '<strong>' + sum.pass + ' of ' + sum.n + ' queries pass</strong> (first 6 all relevant and ≥ 6 relevant found)'
      + ' · warn ' + sum.warn + ' · fail ' + sum.fail + ' · mean relevant in first 6: ' + sum.meanP6.toFixed(2)
      + (hostBlocked.aic ? '<p style="margin-top:8px"><em>The Art Institute of Chicago image server refuses this network; its works show as metadata-only cards.</em></p>' : '')
      + diagTable(results)
      + (failing.length ? '<p class="fail" style="margin-top:10px"><strong>Irrelevant items in the first 12:</strong></p><ul>'
        + failing.map(r => '<li><b>' + esc(r.q) + '</b>: ' + (r.misses || []).map(m => esc(m.title + ' — ' + m.artist + ' [' + m.source + ']')).join('; ') + '</li>').join('') + '</ul>' : '');
    return results;
  }

  window.runDiagnostics = runDiagnostics;
  window.embusca = { runSearch, state: S };

  /* ---------- events + startup ---------- */
  $('goBtn').addEventListener('click', () => runSearch(qInput.value));
  qInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(qInput.value); });
  moreBtn.addEventListener('click', () => loadMore(true));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  $('modalClose').addEventListener('click', closeModal);
  $('diagBtn').addEventListener('click', runDiagnostics);
  $('diagClose').addEventListener('click', () => $('diag').classList.remove('show'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === '/' && document.activeElement !== qInput && !overlay.classList.contains('open')) { e.preventDefault(); qInput.focus(); qInput.select(); }
  });
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(location.search);
    runSearch(p.get('q') || DEFAULT_QUERY, { pin: p.get('pin'), noUrl: true });
  });

  const params = new URLSearchParams(location.search);
  if (params.get('autotest') === '1') runDiagnostics();
  else runSearch(params.get('q') || DEFAULT_QUERY, { pin: params.get('pin'), noUrl: true });
})();
