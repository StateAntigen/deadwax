# Website

The static site for deadwax.rip: five pages in ten languages, built from one
template and plain HTML fragments.

Run `npm run website:build` at the repository root, then serve `website/dist`.

- `content/*.html` — page bodies. Every text node, `alt`, `title` and
  `aria-label` here is extracted for translation, so keep sentences whole.
- `template.mjs` — the shared shell: sticky header, language menu, footer,
  canonical/OG/Twitter metadata, and the `pages` table (title + description).
- `styles.css` — the whole design system. Dark, fluid width, logical
  properties throughout so Arabic and Urdu mirror correctly.
- `assets/` — logo, favicon, share cards and the placeholder captures. The
  `shot-*.svg` and `promo-poster.svg` files stand in for real screenshots;
  see `ASSETS-TODO.md` for what to capture.
- `build.mjs` — renders every locale, copies assets and writes
  `sitemap.xml`/`robots.txt`.
- `social-cards.mjs` — regenerates the two 1200×630 share images. It needs a
  browser; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to reuse a local one.

Existing `.html` addresses stay valid. Copy lives in `shared/i18n/locales/`:
`npm run i18n:extract` rewrites the English catalogue from the markup, and
`npm run i18n:check` proves all ten catalogues are complete and match the
markup exactly.
