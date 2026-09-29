# embusca

One search across the open collections of seven museums and archives —
The Metropolitan Museum of Art, the Art Institute of Chicago, the Cleveland
Museum of Art, the Victoria & Albert Museum, SMK (National Gallery of
Denmark), Wikimedia (Wikidata + Commons), and the Wellcome Collection.

Type an artist, a subject or a style — in English or Portuguese
(`van gogh`, `gatos`, `impressionismo`, `natureza morta`) — and embusca works
out what you mean, asks each museum in the way it answers best, and ranks
everything by evidence of relevance. High-resolution public-domain works,
deduplicated across collections, with infinite scroll.

## How the search works

1. **Understand the query** (`js/intent.js`, `js/lexicon.js`) — resolved
   against Wikidata into an artist, movement, genre, subject, place or artwork,
   with English, Portuguese and Danish labels. A built-in EN/PT/DA art
   vocabulary keeps it working offline.
2. **Ask each API precisely** (`js/sources.js`) — e.g. the Met's highlights and
   subject tags, Cleveland's `artists=`, the V&A's `q_actor=`, Danish terms for
   SMK, and Wikidata SPARQL for works whose *creator*, *movement*, *genre* or
   *depicted subject* is what you searched.
3. **Rank by evidence** (`js/rank.js`) — structured proof (Wikidata, Met tags)
   beats metadata beats text; loose matches go to a separate
   "Less related results" section instead of the top of the grid.

Two exploration features: a **context panel** (what embusca understood, a
Wikipedia summary, related movements/artists, and "not what you meant?"
alternatives) and a **timeline** view that groups results by year, decade or
century depending on their spread.

Details, the full specification and test results (in Portuguese):
[`docs/PLANO.md`](docs/PLANO.md) · [`docs/PROMPT.md`](docs/PROMPT.md) ·
[`docs/RELEVANCIA.md`](docs/RELEVANCIA.md).

## Run it

It is static — no build, no runtime dependencies, no API keys.

- Open `index.html` directly in a browser, **or**
- serve the folder with anything static (`python -m http.server`, nginx, GitHub Pages), **or**
- on Windows without Python/Node: `powershell -ExecutionPolicy Bypass -File serve.ps1`

Searches are shareable: `index.html?q=gatos` (add `&pin=Q146` to force a
specific Wikidata entity, `&pin=none` for plain keywords).

## Tests

Node 22+ (no packages needed for the first three):

| Command | What it does |
|---|---|
| `npm test` | offline unit + end-to-end tests over a simulated network |
| `npm run test:live` | the relevance suite (author / theme / style, EN + PT) against the real APIs |
| `npm run test:compare` | same suite, new engine vs. the old round-robin merge |
| `npm run test:ui` | drives the page in headless Chromium (needs Playwright) |

The same suite runs inside the page: "run diagnostics" in the footer, or
`index.html?autotest=1` (results in `window.__TEST_REPORT__`). The goal for
every query: the first 6 results are all relevant and at least 6 relevant
works are found.

## Notes

- All artwork data and images come live from each institution's public
  open-access API (public domain / CC0 collections).
- The Met's `/v1/search` endpoint is retired on 2026-10-01; embusca uses
  `/v1.1/search`.
- Wikidata queries use plain SPARQL 1.1 (no label service), so they keep
  working as the Wikidata Query Service moves from Blazegraph to QLever.
- Some networks are refused by the Art Institute of Chicago's image CDN
  (Cloudflare bot protection); embusca detects this and shows those works
  as metadata-only cards.
