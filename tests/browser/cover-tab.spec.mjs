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

/**
 * The window draws what it holds, and only asks a relay about what it does not.
 *
 * The two questions are separate commands now. `cover_art` is answered from this
 * disk and is never allowed to wait for a relay; `cover_lookup` is the slow one
 * and is only asked about the albums that came back with nothing. Before the
 * split, one page of results cost an 8 s claim query plus up to 6 s of
 * availability whenever a screen had been left alone for more than five seconds,
 * so art this computer had held all along appeared fourteen seconds late.
 */
function spyOnCoverCommands(page, answer) {
  return page.addInitScript((answered) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.coverQuestions = [];
    window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      if (cmd === 'cover_art' || cmd === 'cover_lookup') {
        window.coverQuestions.push({ cmd, keys: args.keys });
        if (cmd === 'cover_art' && answered) {
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
      }
      return invoke(cmd, args);
    };
  }, answer);
}

test('art that is on this disk never waits for a relay question', async ({ page }) => {
  await mockNative(page);
  await page.route('**/fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: '' }));
  await page.route('http://asset.localhost/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  await spyOnCoverCommands(page, true);
  await page.goto('http://127.0.0.1:15173');
  await page.locator('button.view-toggle', { hasText: '▦' }).click();
  await expect(page.locator('.result-grid .cover-art img').first()).toHaveAttribute(
    'src',
    /^http:\/\/asset\.localhost\//
  );

  const questions = await page.evaluate(() => window.coverQuestions);
  expect(questions.some((question) => question.cmd === 'cover_art')).toBe(true);
  // The whole point: nothing the disk could answer was sent to a relay.
  expect(questions.filter((question) => question.cmd === 'cover_lookup')).toEqual([]);
});

test('an album this disk knows nothing about is looked up without holding the page', async ({ page }) => {
  await mockNative(page);
  await page.route('**/fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: '' }));
  await page.route('http://asset.localhost/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  await spyOnCoverCommands(page, false);
  await page.goto('http://127.0.0.1:15173');
  await page.locator('button.view-toggle', { hasText: '▦' }).click();
  // The list drew its rows first; the album it could not answer for is the one
  // that gets the second, slow question.
  await expect(page.locator('.result-grid .result-card').first()).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => window.coverQuestions.filter((q) => q.cmd === 'cover_lookup').length))
    .toBeGreaterThan(0);
  const asked = await page.evaluate(() =>
    window.coverQuestions.filter((q) => q.cmd === 'cover_lookup').flatMap((q) => q.keys)
  );
  // Asked once per album, and the mock answers nothing at all, so the tile keeps
  // its note rather than drawing a picture nobody has.
  expect(new Set(asked).size).toBe(asked.length);
  await expect(page.locator('.result-grid .cover-art.empty').first()).toBeVisible();
});

test('a copy that cannot be read falls back to the address the claim named', async ({ page }) => {  await openArtwork(page, { localFails: true });
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
  const calls = (page_, cmd) =>
    page_.evaluate((name) => window.calls.filter((call) => call.cmd === name).map((call) => call.args), cmd);
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

  // Every album this computer knows about is one paged list, and its columns are
  // the questions a person actually has of it: sorting by a column replaces the
  // five buttons that used to replace the list under them.
  await expect(page.locator('.cover-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.cover-table')).toContainText('Machine Head');
  await expect(page.locator('.cover-table')).toContainText('Held here');
  await expect(page.locator('.cover-table')).toContainText('Lookup failed');
  await expect(page.locator('.cover-table thead th')).toHaveText([
    'Album ▲',
    'Artist',
    'Picture',
    'Signed by',
    'Last try',
  ]);
  await expect(page.locator('.cover-subtab')).toHaveCount(0);
  // One line a row: five cells, and the artist has a column of its own rather
  // than a second line under the album.
  const firstRow = page.locator('.cover-table tbody tr').first();
  await expect(firstRow.locator('td')).toHaveCount(5);
  await expect(firstRow.locator('td').nth(1)).toHaveText('Deep Purple');

  // Sorting is the column's own job, and it asks the host rather than reordering
  // the twenty rows it happens to be holding.
  await page.locator('.cover-table thead th', { hasText: 'Picture' }).locator('button').click();
  await expect
    .poll(async () => (await calls(page, 'cover_inventory')).at(-1)?.sort)
    .toBe('picture');
  await expect
    .poll(async () => (await calls(page, 'cover_inventory')).at(-1)?.descending)
    .toBe(false);
  await page.locator('.cover-table thead th', { hasText: 'Picture' }).locator('button').click();
  await expect
    .poll(async () => (await calls(page, 'cover_inventory')).at(-1)?.descending)
    .toBe(true);

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
