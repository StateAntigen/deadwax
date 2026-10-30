import { test, expect } from '@playwright/test';
import { mockNative } from './helpers/native.mjs';

// The Covers tab had no test at all, which is how it grew into a wall of prose
// nobody had looked at. This plays a busy host so the tab can be looked at, and
// pins the shape it is supposed to have: one panel open at a time, a summary line
// that is always there, and the explanations in tooltips rather than on screen.
const key = (index) => `artist ${index}|album ${index}`;

async function openCovers(page, { status = {}, gaps = [], queue = [], log = [] } = {}) {
  await mockNative(page);
  await page.route('**/fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: '' }));
  await page.addInitScript(({ status, gaps, queue, log }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      switch (cmd) {
        case 'cover_status':
          return {
            lookupExternal: true,
            publishClaims: true,
            running: true,
            current: 'Bicep — Glue',
            pending: 412,
            remaining: 96,
            published: 318,
            resolved: 74,
            alreadyCovered: 12,
            noArt: 8,
            failed: 2,
            backedOff: 1,
            stopped: false,
            allowedArtHosts: 'coverartarchive.org\narchive.org\nmzstatic.com',
            artCached: 1240,
            artBytes: 196_083_712,
            artPending: 96,
            artPaused: false,
            message: '318 published · 74 resolved here',
            ...status
          };
        case 'cover_candidates':
          return queue;
        case 'cover_missing':
          return gaps;
        case 'cover_lookup_log':
          return log;
        default:
          return invoke(cmd, args);
      }
    };
  }, { status, gaps, queue, log });
  await page.goto('http://127.0.0.1:15173');
  await page.locator('.tool-button', { hasText: 'Covers' }).click();
  await expect(page.locator('.cover-summary')).toBeVisible();
}

test('a picture this computer holds is drawn from the disk, not asked of the publisher', async ({ page }) => {
  const drawn = await openArtwork(page);
  const tile = page.locator('.result-grid .cover-art img').first();
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('src', /^http:\/\/asset\.localhost\//);
  await expect(tile).toHaveAttribute('src', /thumb\.jpg/);
  // And the bytes really came from this computer, which is the whole point: the
  // address the claim named is not asked for at all while a copy is held.
  expect(drawn.length).toBeGreaterThan(0);
});

test('a copy that cannot be read falls back to the address the claim named', async ({ page }) => {
  await openArtwork(page, { localFails: true });
  const tile = page.locator('.result-grid .cover-art img').first();
  // Evicted, or the directory emptied under a running window. The publisher's
  // address is the fallback, so the tile is not simply left blank.
  await expect(tile).toHaveAttribute('src', /^https:\/\/coverartarchive\.org\//);
});

/**
 * The covers the window asks about, each with a copy on this computer *and* the
 * address a claim named — which is both of the things a real answer carries.
 *
 * The asset protocol is intercepted rather than served, because what is being
 * pinned is which address the tile asks for, not that a picture arrived.
 */
async function openArtwork(page, { localFails = false } = {}) {
  await mockNative(page);
  await page.route('**/fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: '' }));
  await page.addInitScript(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      if (cmd === 'cover_art') {
        return args.keys.map((key) => ({
          key,
          art: 'https://coverartarchive.org/release/aaaaaaaa/1-1200.jpg',
          thumb: 'https://coverartarchive.org/release/aaaaaaaa/1-250.jpg',
          localArt: '/tmp/napstr-art/full.jpg',
          localThumb: '/tmp/napstr-art/thumb.jpg',
          mbid: '',
          year: '',
          genre: '',
          collection: '',
          source: 'musicbrainz',
          coverFileId: '',
          mime: 'image/jpeg',
          author: '',
          eventId: '',
          createdAt: 0,
          seeder: false
        }));
      }
      return invoke(cmd, args);
    };
  });
  const drawn = [];
  await page.route('http://asset.localhost/**', (route) => {
    drawn.push(route.request().url());
    return localFails
      ? route.abort()
      : route.fulfill({ contentType: 'image/png', body: PIXEL });
  });
  await page.goto('http://127.0.0.1:15173');
  // The results pane draws a picture per album as thumbnails, and the boot's own
  // search fills it, so this is a tile the window would show a person.
  await page.locator('button.view-toggle', { hasText: '▦' }).click();
  return drawn;
}

/** A 1x1 PNG: a tile only proves it drew something when the bytes are real. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const busy = {
  queue: Array.from({ length: 12 }, (_, index) => ({
    key: key(index),
    artist: `Artist ${index}`,
    album: `Album ${index}`,
    trackCount: (index % 4) + 6,
    source: index % 3 === 0 ? 'library' : 'browsed'
  })),
  gaps: [
    { key: 'a|failed', artist: 'A', album: 'A record whose lookup fell over', tracks: 11, state: 'failed', source: 'library', note: 'MusicBrainz did not answer in 45 seconds; this is back-pressure, not a missing record' },
    { key: 'b|none', artist: 'B', album: 'A record nobody has scanned', tracks: 9, state: 'no_art', source: 'library', note: '' },
    { key: 'c|here', artist: 'C', album: 'A record resolved here and not signed', tracks: 4, state: 'resolved_here', source: 'library', note: '' },
    { key: 'd|never', artist: 'D', album: 'A record never looked up', tracks: 2, state: 'not_looked_up', source: 'library', note: '' }
  ],
  log: Array.from({ length: 8 }, (_, index) => ({
    at: new Date(Date.UTC(2026, 8, 27, 17, index)).toISOString(),
    key: key(index),
    artist: `Artist ${index}`,
    album: `Album ${index}`,
    outcome: ['published', 'resolved', 'no_art', 'throttled', 'failed', 'slow'][index % 6],
    source: 'musicbrainz',
    message: index % 3 === 0 ? 'Album not found in MusicBrainz; try the release group' : ''
  }))
};

test('the Covers tab is a summary line and one list, sorted five ways', async ({ page }) => {
  await openCovers(page, busy);
  // The numbers somebody actually came for are together, in one line, and each
  // one says what it counts: a pass position, the pictures held and what they
  // take, the albums still to fetch, and the albums of this computer's own music
  // with nothing to show for them.
  const summary = page.locator('.cover-summary');
  await expect(summary).toContainText('96 of 412 this pass');
  await expect(summary).toContainText('1,240 pictures');
  await expect(summary).toContainText('187.0 MB');
  await expect(summary).toContainText('96 albums to fetch');
  await expect(summary).toContainText('4 albums without a claim');

  // Every album this computer knows about is one paged list, and the five sorts
  // are the questions a person actually has of it.
  await expect(page.locator('.cover-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.cover-table')).toContainText('Machine Head');
  await expect(page.locator('.cover-table')).toContainText('Held here');
  await expect(page.locator('.cover-table')).toContainText('Lookup failed');
  await expect(page.locator('.cover-subtab')).toHaveText([
    'Missing art',
    'Art held here',
    'Signed by somebody',
    'Lookups that failed',
    'A–Z',
  ]);
  // The pass's own log is underneath it, always, rather than behind a tab.
  await expect(page.locator('.cover-log-list')).toBeVisible();
  // Nothing in the tab is a paragraph any more: every explanation is a title on
  // the thing it explains, which is what the tab was asked for.
  await expect(page.locator('.cover-scan-view .privacy-note')).toHaveCount(0);
  // And the settings that used to live here are in Settings, where the rest of
  // what this computer may do lives.
  await expect(page.locator('#cover-art-hosts')).toHaveCount(0);
  await page.locator('.tool-button', { hasText: 'Settings' }).click();
  await expect(page.locator('#cover-art-hosts')).toBeVisible();
});
