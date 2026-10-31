# Assets to capture

Everything below is currently a wireframe placeholder. Each one is deliberately
obvious so it cannot ship by accident.

## 1. Hero capture — the money shot

- **File:** `assets/shot-library.png`, replace `src="assets/shot-library.svg"` in `content/index.html`
- **Size:** 1600 × 1000 (16:10). Export at 2× if you like; it is shown ~500–620 px wide.
- **Framing:** the whole Deadwax window, tight crop, no desktop wallpaper showing.
- **Content:** search field filled with something plausible, a result list with a
  few rows, and the selected-track panel visible. A transfer in progress in the
  bottom strip sells the app better than an idle window.
- **Before you shoot:** no real IP addresses, no personal file paths, no user
  names you would not publish. Artwork must be copyleft, your own, or replaced
  with a neutral cover.

## 2. Gallery captures — three, same window, same theme

- **Files:** `assets/shot-1.png`, `assets/shot-2.png`, `assets/shot-3.png`
  (swap the `.svg` references in the "Look inside" section)
- **Size:** 1200 × 800 each.
- **Shots:**
  1. Now playing — artwork, waveform, transport controls, a track that is clearly mid-song.
  2. Transfers — two or three downloads at different progress, one nearly done.
  3. Search — several results for one album or artist, with the seeder count visible.
- Keep the same window size, zoom level and accent for all three so the row reads as one film strip.

## 3. Promo film

- **File:** `assets/deadwax-promo.mp4`
- **Format:** H.264 MP4, 16:9, 1280 × 720 or 1920 × 1080, **under 6 MB**, 45–60 seconds.
- **No narration needed** — screen capture plus on-screen text is enough, and it
  keeps the page silent until the viewer presses play.
- **Poster:** export one frame as `assets/promo-poster.png` (1280 × 720).
- **To publish:** in `content/index.html`, replace the poster `<img>` inside
  `.promo-shot` with the `<video>` shown in the comment above it, and delete the
  `.promo-play` overlay.

## 4. Optional extras

- **Social cards:** if you change the headline, rerun
  `node website/social-cards.mjs` (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local
  Chrome or Edge) so the 1200 × 630 images match.
- **Mobile page:** a phone-sized capture (1170 × 2532 or similar) would let the
  Mobile page drop its plain download grid for a device mock-up later.

## House rules

- Dark theme only; the site is black and mint, a light screenshot will look pasted on.
- No browser chrome, no cursor, no notification pop-ups.
- Nothing that identifies a person, a network or a machine.
- Copyleft music only, same rule the app itself asks of users.
