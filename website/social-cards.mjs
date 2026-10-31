// Run manually with node website/social-cards.mjs after changing the branding.
// PNGs are committed assets; normal website builds do not need a browser.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ACCENT = '#43e5a0';
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const client of ['desktop', 'companion']) {
    const companion = client === 'companion';
    const headline = companion ? 'Your music, on your phone.' : 'Own your music again.';
    const subline = companion ? 'Your library · Connected by Iroh' : 'Direct from people · Verified · Tor';
    await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body {
        margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative;
        background: #05070a; color: #e9eff5;
        font-family: "Segoe UI", -apple-system, Arial, sans-serif;
      }
      .glow {
        position: absolute; inset: -20%;
        background:
          radial-gradient(55% 50% at 12% -4%, rgba(67, 229, 160, .20), transparent 62%),
          radial-gradient(45% 45% at 96% 6%, rgba(96, 126, 255, .16), transparent 70%);
      }
      .scan {
        position: absolute; inset: 0;
        background: repeating-linear-gradient(to bottom, rgba(255,255,255,.03) 0 1px, transparent 1px 4px);
      }
      .frame { position: relative; height: 100%; padding: 58px 66px 46px; display: flex; flex-direction: column; }
      .top { display: flex; align-items: center; gap: 14px; }
      .disc {
        width: 34px; height: 34px; border-radius: 50%; border: 1px solid #24313d;
        background: repeating-radial-gradient(circle at 50% 50%, #16202a 0 1px, #0a1116 1px 3px);
      }
      .word {
        font-family: Consolas, "Cascadia Mono", monospace;
        font-size: 34px; font-weight: 700; letter-spacing: -1.6px; line-height: 1;
      }
      .word::after {
        content: ""; display: inline-block; width: 8px; height: 30px; margin-left: 7px;
        background: ${ACCENT}; vertical-align: -4px;
      }
      h1 {
        margin: auto 0 0; max-width: 15ch;
        font-size: 78px; line-height: 1.02; letter-spacing: -3px; font-weight: 800;
      }
      .bottom {
        margin-top: 34px; padding-top: 24px; display: flex; align-items: center; justify-content: space-between;
        border-top: 1px solid rgba(214, 232, 245, .16);
        font-family: Consolas, "Cascadia Mono", monospace;
        font-size: 19px; letter-spacing: .14em; text-transform: uppercase; color: #97a6b5;
      }
      .url { color: ${ACCENT}; }
    </style><body><div class="glow"></div><div class="scan"></div><div class="frame">
      <div class="top"><span class="disc"></span><span class="word">deadwax</span></div>
      <h1>${headline}</h1>
      <div class="bottom"><span>${subline}</span><span class="url">deadwax.rip</span></div>
    </div></body></html>`);
    await page.locator('.word').evaluate((element) => document.fonts.ready.then(() => element.getBoundingClientRect()));
    await page.screenshot({ path: fileURLToPath(new URL(`./assets/${client}-share.png`, import.meta.url)) });
  }
} finally { await browser.close(); }
