// Draws the deadwax mark and renders every asset the two front ends and the
// site need, from one parametric source. Run with: node <this file> <repo-root>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

const root = process.argv[2];
const BG = '#06080b';
const ACCENT = '#43e5a0';
const WARN = '#f2a93b';

// A spiral that leaves the disc: radius grows faster than the angle, and each
// short segment is thinner and fainter than the one before, so the groove reads
// as running off the edge rather than as a decorative swirl.
function trail({ cx, cy, from, to, turns, startAngle, width, colour }) {
  const parts = [];
  const steps = 140;
  for (let index = 0; index < steps; index += 1) {
    const t0 = index / steps;
    const t1 = (index + 1) / steps;
    const point = (t) => {
      const radius = from + (to - from) * t ** 1.5;
      const angle = startAngle + turns * Math.PI * 2 * t;
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    };
    const [x0, y0] = point(t0);
    const [x1, y1] = point(t1);
    parts.push(
      `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} L${x1.toFixed(2)} ${y1.toFixed(2)}" ` +
      `stroke="${colour}" stroke-width="${(width * (1 - t0) ** 0.9 + 0.6).toFixed(2)}" ` +
      `stroke-opacity="${(1 - t0 ** 1.4).toFixed(3)}" stroke-linecap="round"/>`
    );
  }
  return parts.join('\n    ');
}

function grooves({ cx, cy, from, to, step }) {
  // Unbroken rings: a record's grooves do not have corners, and a gap in every
  // one of them accumulates into a wedge that looks like a printing fault.
  const rings = [];
  for (let radius = from; radius <= to; radius += step) {
    const faded = 0.5 + 0.4 * ((radius - from) / (to - from));
    rings.push(`<circle cx="${cx}" cy="${cy}" r="${radius.toFixed(2)}" stroke-opacity="${faded.toFixed(2)}"/>`);
  }
  return `<g fill="none" stroke="#26333d" stroke-width="1.6">\n    ${rings.join('\n    ')}\n  </g>`;
}

export function mark({ size = 512, grid = true } = {}) {
  const c = size / 2;
  const rim = size * 0.343;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="disc" cx="36%" cy="30%" r="82%">
      <stop offset="0" stop-color="#182129"/>
      <stop offset="52%" stop-color="#0a1015"/>
      <stop offset="100%" stop-color="#04070a"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.07"/>
    </linearGradient>
    <clipPath id="rim"><circle cx="${c}" cy="${c}" r="${rim}"/></clipPath>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.219}" fill="${BG}"/>
  ${grid ? `<g stroke="#ffffff" stroke-opacity="0.02" stroke-width="1">
    ${Array.from({ length: 7 }, (_, index) => {
      const offset = size * 0.125 * (index + 1);
      return `<path d="M0 ${offset} H${size} M${offset} 0 V${size}"/>`;
    }).join('')}
  </g>` : ''}
  <circle cx="${c}" cy="${c}" r="${rim}" fill="url(#disc)"/>
  <circle cx="${c}" cy="${c}" r="${rim - 1}" fill="url(#sheen)"/>
  <circle cx="${c}" cy="${c}" r="${rim}" fill="none" stroke="#2f3f4a" stroke-width="${size * 0.006}"/>
  <g clip-path="url(#rim)">
    ${grooves({ cx: c, cy: c, from: rim * 0.42, to: rim * 0.93, step: rim * 0.058 })}
  </g>
  ${trail({ cx: c, cy: c, from: rim * 0.88, to: rim * 1.16, turns: 0.92, startAngle: 0.45, width: size * 0.011, colour: ACCENT })}
  <circle cx="${c}" cy="${c}" r="${size * 0.128}" fill="#0b1714"/>
  <circle cx="${c}" cy="${c}" r="${size * 0.128}" fill="none" stroke="${ACCENT}" stroke-opacity="0.4" stroke-width="${size * 0.006}"/>
  <circle cx="${c}" cy="${c}" r="${size * 0.016}" fill="${BG}"/>
  <circle cx="${c}" cy="${c}" r="${size * 0.016}" fill="none" stroke="${ACCENT}" stroke-opacity="0.55" stroke-width="${size * 0.004}"/>
  <!-- The caret is the run-out groove: the one place the needle stops. -->
  <rect x="${c + size * 0.043}" y="${c - size * 0.041}" width="${size * 0.0115}" height="${size * 0.082}" rx="${size * 0.0058}" fill="${WARN}"/>
</svg>
`;
}

function wordmark({ width = 760, height = 200, fill = '#e9edf4' } = {}) {
  const textSize = height * 0.62;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <text x="0" y="${height * 0.74}" font-family="'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace" font-size="${textSize}" font-weight="700" letter-spacing="${-textSize * 0.045}" fill="${fill}">deadwax</text>
  <rect x="${width * 0.702}" y="${height * 0.34}" width="${height * 0.085}" height="${height * 0.44}" fill="${ACCENT}"/>
</svg>
`;
}

async function render(browser, svg, width, height, path, transparent) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${width}px;height:${height}px;background:${transparent ? 'transparent' : BG};}
    svg{display:block;width:${width}px;height:${height}px;}
  </style>${svg}`);
  await page.screenshot({ path, omitBackground: transparent });
  await page.close();
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
try {
  const icon = mark();
  writeFileSync(join(root, 'src-tauri/icons/icon.svg'), icon);
  const word = wordmark();
  const siteWord = wordmark({ fill: '#17174b' });
  // The icon family (.ico, .icns, every Windows tile, the Android mipmaps) is
  // made from this one square by `npx tauri icon`; it is not kept in the tree.
  const square = join(tmpdir(), 'deadwax-icon-1024.png');
  await render(browser, icon, 1024, 1024, square, false);
  await render(browser, icon, 512, 512, join(root, 'static/deadwax-logo-mark.png'), true);
  await render(browser, icon, 64, 64, join(root, 'static/deadwax-logo-small.png'), true);
  await render(browser, icon, 64, 64, join(root, 'static/favicon.png'), false);
  await render(browser, icon, 64, 64, join(root, 'website/assets/favicon.png'), false);
  await render(browser, word, 760, 200, join(root, 'static/deadwax-logo.png'), true);
  await render(browser, siteWord, 760, 200, join(root, 'website/assets/deadwax-logo.png'), true);
  console.log('mark written');
  console.log(`then: npx tauri icon "${square}"  (and again from android/)`);
} finally {
  await browser.close();
}



