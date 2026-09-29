/* A fake network for offline tests: every museum API and Wikidata,
   answering in the real response shapes. Each source mixes relevant
   and irrelevant records in its own order (like the live APIs do),
   so tests prove the ranking, not the fixtures.
   install(EB, { failWikidata }) swaps Embusca.util.http.fetch and
   returns the list of requested URLs. */
'use strict';

const IMG = n => 'https://images.example.org/' + n + '.jpg';
const FP = f => 'http://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------------- Wikidata entities ---------------- */
const ENT = {
  Q5582: { en: 'Vincent van Gogh', pt: 'Vincent van Gogh', desc: 'Dutch painter (1853–1890)', aliases: { en: ['Van Gogh', 'Vincent Willem van Gogh'] }, sl: 250, types: ['Q5'], occs: ['Q1028181', 'Q15296811'], wiki: { en: 'Vincent van Gogh', pt: 'Vincent van Gogh' } },
  Q900101: { en: 'Theo van Gogh', desc: 'Dutch art dealer (1857–1891)', aliases: { en: ['Theodorus van Gogh'] }, sl: 40, types: ['Q5'], occs: ['Q173950'] },
  Q224124: { en: 'Van Gogh Museum', desc: 'art museum in Amsterdam, Netherlands', sl: 80, types: ['Q33506'] },
  Q296: { en: 'Claude Monet', pt: 'Claude Monet', desc: 'French painter (1840–1926)', aliases: { en: ['Monet', 'Oscar-Claude Monet'] }, sl: 200, types: ['Q5'], occs: ['Q1028181'] },
  Q146: { en: 'cat', pt: 'gato', da: 'kat', desc: 'small domesticated carnivorous mammal', aliases: { en: ['domestic cat', 'house cat'], pt: ['gato doméstico'] }, sl: 300, types: ['Q55983715'], wiki: { en: 'Cat', pt: 'Gato' } },
  Q900102: { en: 'Cats', desc: 'musical by Andrew Lloyd Webber', sl: 60, types: ['Q2743'] },
  Q900103: { en: 'Gatos', pt: 'Gatos', desc: '2013 film', sl: 5, types: ['Q11424'] },
  Q40415: { en: 'Impressionism', pt: 'impressionismo', da: 'impressionisme', desc: 'art movement', aliases: { en: ['impressionist'] }, sl: 150, types: ['Q968159'], wiki: { en: 'Impressionism', pt: 'Impressionismo' } },
  Q506: { en: 'flower', pt: 'flor', da: 'blomst', desc: 'reproductive structure in flowering plants', sl: 200, types: ['Q900199'] },
  Q900104: { en: 'Flores', pt: 'Flores', desc: 'island in Indonesia', sl: 100, types: ['Q23442'] },
};
const MOVEMENT_ARTISTS = [['Q296', 'Claude Monet', 220], ['Q39931', 'Pierre-Auguste Renoir', 190], ['Q46373', 'Edgar Degas', 180], ['Q134741', 'Camille Pissarro', 120], ['Q173223', 'Mary Cassatt', 110]];

function searchable(e, lang) {
  const out = [];
  [e[lang], e.en].forEach(v => v && out.push(v));
  ((e.aliases || {})[lang] || []).concat((e.aliases || {}).en || []).forEach(v => out.push(v));
  return out;
}

function wbsearch(u) {
  const s = norm(u.searchParams.get('search')), lang = u.searchParams.get('language');
  const hits = [];
  for (const [id, e] of Object.entries(ENT)) {
    const m = searchable(e, lang).find(x => norm(x).startsWith(s));
    if (m) hits.push({ id, e, m, exact: norm(m) === s });
  }
  hits.sort((a, b) => (b.exact - a.exact) || (b.e.sl - a.e.sl));
  return { search: hits.slice(0, 8).map(h => ({ id: h.id, label: h.e[lang] || h.e.en, description: h.e.desc, match: { type: 'label', language: lang, text: h.m } })) };
}

function wbget(u) {
  const out = {};
  for (const id of u.searchParams.get('ids').split('|')) {
    const e = ENT[id];
    if (!e) continue;
    const labels = {}, aliases = {}, sitelinks = {};
    ['en', 'pt', 'da'].forEach(l => { if (e[l]) labels[l] = { language: l, value: e[l] }; });
    Object.entries(e.aliases || {}).forEach(([l, list]) => { aliases[l] = list.map(v => ({ language: l, value: v })); });
    for (let i = 0; i < e.sl; i++) sitelinks['wiki' + i] = { site: 'wiki' + i, title: e.en };
    if (e.wiki) { sitelinks.enwiki = { site: 'enwiki', title: e.wiki.en }; if (e.wiki.pt) sitelinks.ptwiki = { site: 'ptwiki', title: e.wiki.pt }; }
    out[id] = { id, labels, descriptions: { en: { language: 'en', value: e.desc } }, aliases, sitelinks };
  }
  return { entities: out };
}

const uri = q => ({ type: 'uri', value: 'http://www.wikidata.org/entity/' + q });
const lit = v => ({ type: 'literal', value: String(v) });

function wdWork(qid, label, file, creator, creatorLabel, coll, sl, via, year) {
  const b = { item: uri(qid), image: { type: 'uri', value: FP(file) }, label: lit(label), sl: lit(sl), via: lit(via) };
  if (creator) { b.creator = uri(creator); b.creatorL = lit(creatorLabel); }
  if (coll) b.collL = lit(coll);
  if (year) b.inception = lit('+' + year + '-01-01T00:00:00Z');
  return b;
}

const WORKS = {
  artistQ5582: [
    wdWork('Q45585', 'The Starry Night', 'Van Gogh - Starry Night.jpg', 'Q5582', 'Vincent van Gogh', 'Museum of Modern Art', 120, 'artist', 1889),
    wdWork('Q151047', 'Sunflowers', 'Vincent Willem van Gogh 127.jpg', 'Q5582', 'Vincent van Gogh', 'National Gallery', 90, 'artist', 1888),
    wdWork('Q717347', 'The Potato Eaters', 'Van-willem-vincent-gogh-die-kartoffelesser.jpg', 'Q5582', 'Vincent van Gogh', 'Van Gogh Museum', 70, 'artist', 1885),
    wdWork('Q900201', 'Café Terrace at Night', 'Gogh4.jpg', 'Q5582', 'Vincent van Gogh', 'Kröller-Müller Museum', 60, 'artist', 1888),
    wdWork('Q900202', 'Wheat Field with Cypresses', 'Wheat-Field-with-Cypresses.jpg', 'Q5582', 'Vincent van Gogh', 'Metropolitan Museum of Art', 30, 'artist', 1889),
  ],
  subjectQ146: [
    wdWork('Q900301', 'Girl with a Kitten', 'Girl kitten.jpg', 'Q900390', 'Jean-Baptiste Perronneau', 'Louvre', 12, 'depicts', 1745),
    wdWork('Q900302', 'The Cat’s Lunch', 'Cats lunch.jpg', 'Q900391', 'Marguerite Gérard', 'Musée Fragonard', 8, 'depicts', 1800),
    wdWork('Q900303', 'Cat Catching a Bird', 'Picasso cat.jpg', 'Q900392', 'Henriëtte Ronner-Knip', 'Rijksmuseum', 6, 'depicts', 1880),
    wdWork('Q900304', 'Two Cats', 'Two cats.jpg', 'Q900393', 'Franz Marc', 'Kunstmuseum Basel', 9, 'depicts', 1912),
  ],
  movementQ40415: [
    wdWork('Q900401', 'Impression, Sunrise', 'Monet - Impression, Sunrise.jpg', 'Q296', 'Claude Monet', 'Musée Marmottan Monet', 110, 'style', 1872),
    wdWork('Q900402', 'Bal du moulin de la Galette', 'Renoir moulin.jpg', 'Q39931', 'Pierre-Auguste Renoir', "Musée d'Orsay", 80, 'style', 1876),
    wdWork('Q900403', 'The Dance Class', 'Degas dance class.jpg', 'Q46373', 'Edgar Degas', "Musée d'Orsay", 50, 'artist', 1874),
    wdWork('Q900404', 'Boulevard Montmartre at Night', 'Pissarro boulevard.jpg', 'Q134741', 'Camille Pissarro', 'National Gallery', 30, 'artist', 1897),
  ],
};

function sparql(u) {
  const q = u.searchParams.get('query');
  let m;
  const bind = rows => ({ head: { vars: [] }, results: { bindings: rows } });
  if (/OPTIONAL \{ \?item wdt:P31 \?t \}/.test(q)) {
    const ids = (q.match(/VALUES \?item \{([^}]*)\}/)[1].match(/Q\d+/g)) || [];
    const rows = [];
    ids.forEach(id => {
      const e = ENT[id];
      if (!e) return;
      (e.types || []).forEach(t => (e.occs && e.occs.length ? e.occs : [null]).forEach(o => {
        const row = { item: uri(id), t: uri(t) };
        if (o) row.o = uri(o);
        rows.push(row);
      }));
    });
    return bind(rows);
  }
  if (/wdt:P135 \?m/.test(q)) {
    return bind(/Q5582/.test(q) ? [{ m: uri('Q166713'), mL: lit('Post-Impressionism'), b: lit('+1853-03-30T00:00:00Z'), d: lit('+1890-07-29T00:00:00Z') }] : []);
  }
  if ((m = q.match(/\?a wdt:P135 wd:(Q\d+) ; wdt:P31 wd:Q5/))) {
    return bind(m[1] === 'Q40415' ? MOVEMENT_ARTISTS.map(([id, n, sl]) => ({ a: uri(id), aL: lit(n), sl: lit(sl) })) : []);
  }
  if (/wdt:P580/.test(q)) return bind(/Q40415/.test(q) ? [{ s: lit('+1860-01-01T00:00:00Z'), e: lit('+1900-01-01T00:00:00Z') }] : []);
  if (/wdt:P1549/.test(q)) return bind([]);
  if (/\?item wdt:P18 \?image/.test(q)) {
    const offset = +((q.match(/OFFSET (\d+)/) || [0, 0])[1]);
    let rows = [];
    if ((m = q.match(/\?item wdt:P170 wd:(Q\d+) \. BIND\("artist"/))) rows = WORKS['artist' + m[1]] || [];
    else if ((m = q.match(/\?item wdt:P180 wd:(Q\d+)/))) rows = WORKS['subject' + m[1]] || [];
    else if ((m = q.match(/\?item wdt:P135 wd:(Q\d+) ; wdt:P31 \?type/))) rows = WORKS['movement' + m[1]] || [];
    return bind(rows.slice(offset));
  }
  return bind([]);
}

/* ---------------- museums ---------------- */
function metObj(id, title, artist, o = {}) {
  return Object.assign({
    objectID: id, title, artistDisplayName: artist, artistDisplayBio: o.bio || '', artistPrefix: o.prefix || '',
    artistWikidata_URL: o.artistQid ? 'https://www.wikidata.org/wiki/' + o.artistQid : '',
    objectWikidata_URL: o.qid ? 'https://www.wikidata.org/wiki/' + o.qid : '',
    objectDate: o.date || '', objectBeginDate: o.y || 0, objectEndDate: o.y || 0,
    medium: o.medium || 'Oil on canvas', classification: o.cls || 'Paintings', objectName: o.cls === 'Prints' ? 'Print' : 'Painting',
    department: o.dept || 'European Paintings', culture: '', country: '', artistNationality: o.nat || '',
    tags: (o.tags || []).map(([term, q]) => ({ term, AAT_URL: '', Wikidata_URL: q ? 'https://www.wikidata.org/wiki/' + q : '' })),
    isHighlight: !!o.hl, primaryImageSmall: IMG('met' + id), primaryImage: IMG('met' + id + 'L'),
    objectURL: 'https://www.metmuseum.org/art/collection/search/' + id,
  }, o.extra || {});
}

const MET_OBJ = {};
[
  metObj(436532, 'Self-Portrait with a Straw Hat', 'Vincent van Gogh', { artistQid: 'Q5582', hl: 1, y: 1887, nat: 'Dutch' }),
  metObj(436535, 'Wheat Field with Cypresses', 'Vincent van Gogh', { artistQid: 'Q5582', hl: 1, y: 1889, qid: 'Q900202' }),
  metObj(437984, 'Irises', 'Vincent van Gogh', { artistQid: 'Q5582', hl: 1, y: 1890 }),
  metObj(436528, 'Cypresses', 'Vincent van Gogh', { artistQid: 'Q5582', y: 1889 }),
  metObj(436529, 'Shoes', 'Vincent van Gogh', { artistQid: 'Q5582', y: 1888 }),
  metObj(436530, 'Oleanders', 'Vincent van Gogh', { artistQid: 'Q5582', y: 1888 }),
  metObj(900001, 'Photograph of the house in Zundert', '', { cls: 'Photographs', medium: 'Albumen silver print', y: 1900, extra: { title: 'The van Gogh family house, Zundert' } }),
  metObj(900002, 'Still Life with Sunflowers on an Armchair', 'Paul Gauguin', { y: 1901 }),
  metObj(900003, "The Bedroom (copy)", 'Vincent van Gogh', { prefix: 'Copy after', y: 1920 }),
  metObj(1001, 'Cat Watching a Spider', 'Oide Tōkō', { cls: 'Prints', medium: 'Woodblock print', hl: 1, tags: [['Cats', 'Q146'], ['Spiders', 'Q1357']] }),
  metObj(1002, 'Cat and Butterfly', 'Utagawa Hiroshige', { cls: 'Prints', medium: 'Woodblock print', tags: [['Cats', 'Q146'], ['Butterflies', 'Q11946']] }),
  metObj(1003, 'Girl with a Cat', 'Unknown', { tags: [['Cats', 'Q146'], ['Girls', 'Q3031']] }),
  metObj(1004, 'Kitten in a Basket', 'John Henry Dolph', { tags: [['Cats', 'Q146']] }),
  metObj(2001, 'Bridge over a Pond of Water Lilies', 'Claude Monet', { artistQid: 'Q296', hl: 1, y: 1899, tags: [['Bridges', ''], ['Water Lilies', '']] }),
  metObj(2002, 'Madame Georges Charpentier and Her Children', 'Auguste Renoir', { artistQid: 'Q39931', hl: 1, y: 1878 }),
  metObj(2003, 'The Dance Class', 'Edgar Degas', { artistQid: 'Q46373', hl: 1, y: 1874, qid: 'Q900403' }),
  metObj(2004, 'Photograph of an exhibition gallery', 'Unknown', { cls: 'Photographs', medium: 'Gelatin silver print', y: 1950 }),
  metObj(2005, 'The Manneporte (Étretat)', 'Claude Monet', { artistQid: 'Q296', y: 1883 }),
].forEach(o => { MET_OBJ[o.objectID] = o; });

const MET_SEARCH = [
  // [q, flags, ids]
  ['Vincent van Gogh', { isHighlight: 1 }, [436532, 436535, 437984]],
  ['Vincent van Gogh', {}, [900001, 436528, 900002, 436529, 436530, 900003, 436532, 436535, 437984]],
  ['van gogh', {}, [900001, 436528, 900002, 436529, 436530, 900003, 436532, 436535, 437984]],
  ['cat', { tags: 1, isHighlight: 1 }, [1001]],
  ['cat', { tags: 1 }, [1002, 1003, 1004, 1001]],
  ['gatos', {}, []],
  ['Impressionism', { isHighlight: 1 }, []],
  ['Impressionism', {}, [2004, 2005]],
  ['impressionismo', {}, []],
  ['Claude Monet', { isHighlight: 1 }, [2001]],
  ['Pierre-Auguste Renoir', { isHighlight: 1 }, [2002]],
  ['Edgar Degas', { isHighlight: 1 }, [2003]],
];

function met(u) {
  if (/\/v1\/objects\//.test(u.pathname)) {
    const o = MET_OBJ[u.pathname.split('/').pop()];
    if (!o) return { status: 404 };
    return o;
  }
  if (/\/v1\/search$/.test(u.pathname)) return { status: 410 };   // retired endpoint
  const q = u.searchParams.get('q'), hl = u.searchParams.get('isHighlight') === 'true', tags = u.searchParams.get('tags') === 'true';
  if (u.searchParams.get('artistOrCulture')) return { total: 0, objectIDs: null };  // broken upstream
  const row = MET_SEARCH.find(([rq, f]) => rq === q && !!f.isHighlight === hl && !!f.tags === tags);
  const ids = row ? row[2] : [];
  const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 100;
  const page = ids.slice(off, off + lim);
  return { total: ids.length, objectIDs: page.length ? page : null };
}

const aicRow = (id, title, artist, o = {}) => Object.assign({
  id, title, artist_title: artist, artist_display: artist + (o.nat ? '\n' + o.nat : ''), artist_titles: artist ? [artist] : [],
  date_display: String(o.y || ''), date_start: o.y || null, date_end: o.y || null, place_of_origin: o.place || '',
  image_id: 'img-' + id, medium_display: o.medium || 'Oil on canvas', classification_title: o.cls || 'painting',
  classification_titles: [o.cls || 'painting'], style_title: (o.styles || [])[0] || null, style_titles: o.styles || [],
  subject_titles: o.subjects || [], term_titles: o.terms || [], theme_titles: [], artwork_type_title: o.type || 'Painting',
  thumbnail: { alt_text: o.alt || '' }, is_boosted: !!o.boosted,
}, o.extra || {});

const AIC = {
  'Vincent van Gogh': [
    aicRow(28560, 'The Bedroom', 'Vincent van Gogh', { y: 1889, boosted: 1 }),
    aicRow(999, 'Portrait of a Man', 'Paul Gauguin', { y: 1890 }),
    aicRow(80607, 'Self-Portrait', 'Vincent van Gogh', { y: 1887 }),
    aicRow(111, 'Weeping Tree', 'Vincent van Gogh', { y: 1889, cls: 'drawing', type: 'Drawing and Watercolor', medium: 'Reed pen and ink' }),
  ],
  'van gogh': [
    aicRow(999, 'Portrait of a Man', 'Paul Gauguin', { y: 1890 }),
    aicRow(28560, 'The Bedroom', 'Vincent van Gogh', { y: 1889, boosted: 1 }),
    aicRow(80607, 'Self-Portrait', 'Vincent van Gogh', { y: 1887 }),
  ],
  'cat': [
    aicRow(3001, 'Catskill Mountains', 'Thomas Cole', { y: 1833, subjects: ['landscapes', 'mountains'] }),
    aicRow(3002, 'Cat and Kittens', 'Unknown', { y: 1872, subjects: ['cats', 'animals'] }),
    aicRow(3003, 'Young Woman with a Cat', 'Pierre-Auguste Renoir', { y: 1880, subjects: ['women', 'cats'] }),
  ],
  'gatos': [aicRow(3009, 'Los Gatos Creek', 'Unknown', { y: 1900, subjects: ['rivers'] })],
  'Impressionism': [
    aicRow(3010, 'Impression of a City', 'Unknown', { y: 1950, styles: ['Modernism'] }),
    aicRow(16568, 'Water Lilies', 'Claude Monet', { y: 1906, styles: ['Impressionism'] }),
    aicRow(20684, 'Paris Street; Rainy Day', 'Gustave Caillebotte', { y: 1877, styles: ['Impressionism'] }),
  ],
  'impressionismo': [],
};

const cmaRow = (id, title, creator, o = {}) => ({
  id, title, creators: creator ? [{ description: creator }] : [], creation_date: String(o.y || ''), creation_date_earliest: o.y || null,
  creation_date_latest: o.y || null, culture: o.culture ? [o.culture] : [], technique: o.technique || 'oil on canvas', type: o.type || 'Painting',
  department: o.dept || 'European Painting and Sculpture', description: o.desc || '',
  images: { web: { url: IMG('cma' + id) }, print: { url: IMG('cma' + id + 'P') } }, url: 'https://clevelandart.org/art/' + id, accession_number: 'CMA.' + id,
});

const CMA = {
  'artists:Vincent van Gogh': [cmaRow(4001, 'The Large Plane Trees', 'Vincent van Gogh (Dutch, 1853–1890)', { y: 1889 }), cmaRow(4002, 'Adeline Ravoux', 'Vincent van Gogh (Dutch, 1853–1890)', { y: 1890 })],
  'q:van gogh': [cmaRow(4003, 'Catalogue of the Van Gogh exhibition', '', { type: 'Book', technique: 'print' }), cmaRow(4001, 'The Large Plane Trees', 'Vincent van Gogh (Dutch, 1853–1890)', { y: 1889 })],
  'q:cat': [cmaRow(4010, 'Catalogue cover', '', { type: 'Book', technique: 'offset' }), cmaRow(4011, 'Two Cats', 'Théophile-Alexandre Steinlen (Swiss, 1859–1923)', { y: 1894, type: 'Print', technique: 'lithograph' })],
  'q:gatos': [],
  'q:Impressionism': [cmaRow(4020, 'The Red Kerchief', 'Claude Monet (French, 1840–1926)', { y: 1869, desc: 'An Impressionist portrait of Camille in the snow.' }), cmaRow(4021, 'Landscape', 'Unknown', { y: 1700, desc: 'A Dutch landscape.' })],
  'q:impressionismo': [],
};

const vamRec = (sys, title, maker, o = {}) => ({
  systemNumber: sys, _primaryTitle: title, _primaryMaker: { name: maker, association: o.assoc || 'artist' }, _primaryDate: o.date || '',
  _primaryPlace: o.place || '', objectType: o.type || 'Print', _images: { _iiif_image_base_url: 'https://framemark.vam.ac.uk/collections/' + sys + '/' },
});
const VAM = {
  'q_actor:Vincent van Gogh': [],
  'q:Vincent van Gogh': [vamRec('O1', 'Poster for a Van Gogh exhibition', 'Unknown', { type: 'Poster', date: '1955' })],
  'q:van gogh': [vamRec('O1', 'Poster for a Van Gogh exhibition', 'Unknown', { type: 'Poster', date: '1955' })],
  'q:cat': [vamRec('O2', 'Catherine of Aragon', 'Unknown', { type: 'Painting', date: '1530' }), vamRec('O3', 'Cat', 'Unknown', { type: 'Figure', date: '1750' })],
  'q:gatos': [],
  'q:Impressionism': [vamRec('O4', 'Poster', 'Unknown', { type: 'Poster', date: '1970' })],
  'q:impressionismo': [],
};

const smkItem = (num, da, en, artist, o = {}) => ({
  object_number: num, titles: [{ title: da, language: 'dansk' }].concat(en ? [{ title: en, language: 'engelsk' }] : []),
  artist: artist ? [artist] : [], production: [{ creator_nationality: o.nat || 'dansk' }],
  production_date: [{ period: String(o.y || ''), start: o.y ? o.y + '-01-01T00:00:00.000Z' : null, end: o.y ? o.y + '-12-31T00:00:00.000Z' : null }],
  techniques: [o.tech || 'Olie på lærred'], object_names: [{ name: o.type || 'Maleri' }],
  image_thumbnail: 'https://iip.smk.dk/iiif/jp2/' + num + '.tif.jp2/full/!1024,/0/default.jpg', frontend_url: 'https://open.smk.dk/artwork/image/' + num,
});
const SMK = {
  'Vincent van Gogh': [smkItem('KMS1', 'Portræt af en ung mand', 'Portrait of a young man', 'Jan van Gogh', { y: 1650 })],
  'van gogh': [smkItem('KMS1', 'Portræt af en ung mand', 'Portrait of a young man', 'Jan van Gogh', { y: 1650 })],
  'kat': [smkItem('KMS2', 'En kat', 'A Cat', 'Henriëtte Ronner-Knip', { y: 1870, nat: 'hollandsk' }), smkItem('KMS3', 'Katten på trappen', '', 'Unknown', { y: 1900 })],
  'gatos': [],
  'impressionisme': [smkItem('KMS4', 'Kvinde i have', 'Woman in a garden', 'Berthe Morisot', { y: 1883, nat: 'fransk' })],
  'impressionismo': [],
  'Impressionism': [smkItem('KMS4', 'Kvinde i have', 'Woman in a garden', 'Berthe Morisot', { y: 1883, nat: 'fransk' })],
};

const welWork = (id, title, who, o = {}) => ({
  id, title, contributors: who ? [{ agent: { label: who } }] : [], production: [{ label: o.prod || '', dates: o.date ? [{ label: o.date }] : [] }],
  subjects: (o.subjects || []).map(label => ({ label })), genres: (o.genres || []).map(label => ({ label })),
  thumbnail: { url: 'https://iiif.wellcomecollection.org/image/' + id + '/full/300,/0/default.jpg' }, workType: { label: 'Pictures' },
});
const WEL = {
  'Vincent van Gogh': [welWork('w1', 'Vincent van Gogh, portrait. Photograph after a painting', 'Wellcome Library', { date: '1930' })],
  'van gogh': [welWork('w1', 'Vincent van Gogh, portrait. Photograph after a painting', 'Wellcome Library', { date: '1930' })],
  'cat': [welWork('w2', 'Catarrh remedy advertisement', 'Unknown', { date: '1890', subjects: ['Advertising'] }), welWork('w3', 'A cat seated on a cushion', 'Louis Wain', { date: '1900', subjects: ['Cats'] })],
  'gatos': [],
  'Impressionism': [welWork('w4', 'Nervous impressions of a patient', 'Unknown', { date: '1880', subjects: ['Neurology'] })],
  'impressionismo': [],
};

const COMMONS = {
  'van gogh painting': [{ pageid: 71, title: 'File:Van Gogh museum entrance.jpg', artist: 'Photographer X', cats: 'Van Gogh Museum|Buildings in Amsterdam' }, { pageid: 72, title: 'File:Van Gogh - Starry Night.jpg', artist: 'Vincent van Gogh', cats: 'The Starry Night' }],
  'gatos painting': [{ pageid: 73, title: 'File:Gatos map.jpg', artist: 'Cartographer', cats: 'Maps of Los Gatos' }],
  'impressionismo painting': [],
};

function commons(u) {
  const q = u.searchParams.get('gsrsearch').replace(/ filetype:bitmap$/, '');
  const off = +u.searchParams.get('gsroffset') || 0;
  const list = (COMMONS[q] || []).slice(off);
  const pages = {};
  list.forEach((p, i) => {
    pages[p.pageid] = {
      pageid: p.pageid, title: p.title, index: i + 1,
      imageinfo: [{ thumburl: IMG('c' + p.pageid), url: IMG('c' + p.pageid + 'full'), descriptionurl: 'https://commons.wikimedia.org/wiki/' + p.title,
        extmetadata: { Artist: { value: p.artist }, Categories: { value: p.cats }, ObjectName: { value: p.title.replace(/^File:|\.jpg$/g, '') } } }],
    };
  });
  return list.length ? { query: { pages } } : {};
}

/* ---------------- router ---------------- */
function route(url, opts) {
  const u = new URL(url);
  const h = u.hostname;
  if (h === 'www.wikidata.org' || h === 'query.wikidata.org' || /wikipedia\.org$/.test(h)) {
    if (opts.failWikidata) return { status: 503 };
    if (h === 'query.wikidata.org') return opts.failSparql ? { status: 500 } : sparql(u);
    if (/wikipedia\.org$/.test(h)) return { query: { pages: { 1: { title: u.searchParams.get('titles'), extract: 'Summary of ' + u.searchParams.get('titles') + '.' } } } };
    const action = u.searchParams.get('action');
    if (action === 'wbsearchentities') return wbsearch(u);
    if (action === 'wbgetentities') return wbget(u);
  }
  if (h === 'collectionapi.metmuseum.org') return met(u);
  if (h === 'api.artic.edu') {
    const q = u.searchParams.get('q');
    const page = +u.searchParams.get('page') || 1;
    const data = page === 1 ? (AIC[q] || []) : [];
    return { pagination: { total: data.length, total_pages: 1, current_page: page }, data };
  }
  if (h === 'openaccess-api.clevelandart.org') {
    const key = u.searchParams.get('artists') ? 'artists:' + u.searchParams.get('artists') : 'q:' + u.searchParams.get('q');
    const data = +u.searchParams.get('skip') ? [] : (CMA[key] || []);
    return { info: { total: data.length }, data };
  }
  if (h === 'api.vam.ac.uk') {
    const key = u.searchParams.get('q_actor') ? 'q_actor:' + u.searchParams.get('q_actor') : 'q:' + u.searchParams.get('q');
    const records = (+u.searchParams.get('page') || 1) > 1 ? [] : (VAM[key] || []);
    return { info: { record_count: records.length, pages: 1 }, records };
  }
  if (h === 'api.smk.dk') {
    const items = +u.searchParams.get('offset') ? [] : (SMK[u.searchParams.get('keys')] || []);
    return { found: items.length, items };
  }
  if (h === 'api.wellcomecollection.org') {
    const results = (+u.searchParams.get('page') || 1) > 1 ? [] : (WEL[u.searchParams.get('query')] || []);
    return { totalPages: 1, totalResults: results.length, results };
  }
  if (h === 'commons.wikimedia.org') return commons(u);
  return { status: 404 };
}

function install(EB, opts = {}) {
  const log = [];
  EB.util._memCache.clear();
  EB.util.http.fetch = async url => {
    log.push(url);
    const body = route(url, opts);
    const status = body && body.status && Object.keys(body).length === 1 ? body.status : 200;
    return { ok: status === 200, status, json: async () => body };
  };
  return log;
}

module.exports = { install, route, ENT };
