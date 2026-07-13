# embusca

One search across the open collections of seven museums and archives —
The Metropolitan Museum of Art, the Art Institute of Chicago, the Cleveland
Museum of Art, the Victoria & Albert Museum, SMK (National Gallery of
Denmark), Wikimedia Commons, and the Wellcome Collection.

High-resolution public-domain artworks, merged and deduplicated into a
single grid, with infinite scroll and metadata-based suggestions.

## Run it

It is a single static file — no build, no dependencies, no API keys.

- Open `index.html` directly in a browser, **or**
- serve it with anything static (`python -m http.server`, nginx, GitHub Pages), **or**
- on Windows without Python/Node: `powershell -ExecutionPolicy Bypass -File serve.ps1`

## Notes

- All artwork data and images come live from each institution's public
  open-access API (public domain / CC0 collections).
- Some networks are refused by the Art Institute of Chicago's image CDN
  (Cloudflare bot protection); embusca detects this and shows those works
  as metadata-only cards.
- A built-in test harness (`?autotest=1` or the "run diagnostics" link)
  measures per-source results, image load success, and suggestion coverage.
