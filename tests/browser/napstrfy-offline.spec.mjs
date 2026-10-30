import { test, expect } from '@playwright/test';
import { mockNative, serveAudio } from './helpers/native.mjs';

/**
 * Offline mode: what this phone does when nothing can be reached.
 *
 * It has three reasons, and the tests name each one separately because they are
 * not the same thing. Wi-Fi can be off, which only Android can see. A computer
 * can be away while the phone has a perfectly good network. And the person can
 * choose it, because they know they are about to lose signal.
 *
 * What the mode buys is a screen that never waits on anybody: the library is the
 * cache, a track that is not here says so at once instead of holding the app for
 * a tunnel timeout, and a search reads the cache instead of the network.
 */

const id = (letter) => letter.repeat(64);

/** The smallest real picture, for the tiles that have to load one to keep it. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

const track = (letter, title, artist, album, local = true) => ({
  fileId: id(letter),
  filename: `${title}.mp3`,
  title,
  artist,
  album,
  format: 'MP3',
  mime: 'audio/mpeg',
  size: 4_000_000,
  tags: '',
  local,
  sources: [],
  bitrateKbps: 128,
  sampleRateHz: 44_100,
  channels: 2,
  lossless: false,
  durationMs: 200_000
});

// On this phone: the file's bytes are in the cache, and the route that matters is
// the phone badge rather than the computer's.
const caliber = track('a', '.44 Caliber Love Letter', 'Alexisonfire', 'Alexisonfire');
const cached = track('b', 'Pulmonary Archery', 'Alexisonfire', 'Alexisonfire', true);
// On the computer only. Offline this is the file that cannot be had, and the row
// whose badge has to stop promising that it can.
const elsewhere = track('c', 'Numb', 'Linkin Park', 'Meteora', true);

const full = { browse: true, fetch: true, control: true, download: true, privileged: true };

// A playlist this phone has been shown and remembers: the list row and the members
// both come off it once the computer cannot be asked.
const campingSummary = {
  playlistId: 'camping',
  title: 'Camping',
  author: '',
  displayName: '',
  image: '',
  firstFileId: caliber.fileId,
  trackCount: 1,
  private: false,
  published: false,
  updatedAt: 1
};
const camping = {
  playlistId: 'camping',
  title: 'Camping',
  author: '',
  displayName: '',
  artist: '',
  mbid: '',
  image: '',
  tags: '',
  private: false,
  published: false,
  updatedAt: 1,
  total: 1,
  tracks: [{ position: 1, fileId: caliber.fileId, title: caliber.title, artist: caliber.artist, album: caliber.album }]
};

async function openApp(
  page,
  {
    library = [caliber, cached, elsewhere],
    cache = [caliber, cached],
    liked = [],
    unreachable = false,
    wifi = false,
    connecting = false,
    playlists = [],
    art = []
  } = {}
) {
  await mockNative(page, { platform: 'android' });
  await page.route('**/fixture.wav', serveAudio);
  await page.addInitScript(
    ({ library, cache, liked, unreachable, wifi, connecting, playlists, art }) => {
      window.desktopReachable = !unreachable;
      window.remoteHosts = [
        {
          endpointId: 'endpoint',
          desktopName: 'My Deadwax',
          rights: { browse: true, fetch: true, control: true, download: true, privileged: true },
          home: true,
          included: true,
          online: !unreachable,
          mayDownload: true
        }
      ];
      window.remoteLibrary = library;
      // What this phone holds itself, which offline is the whole library.
      window.cachedLibrary = cache;
      // The hardware back button, the way Android drives it: the page is handed a
      // press only while it advertises a destination.
      window.backAvailable = null;
      window.appExits = 0;
      window.NapstrfyBack = {
        setBackAvailable: (available) => { window.backAvailable = available; },
        setDrawerOpen: (open) => { window.backAvailable = open; }
      };
      // Pictures this phone holds, by album, as `[coverKey, hash]`. Its own side
      // serves them out of its own disk, so they are drawn with the computer out of
      // reach - which is what makes the member a playlist row is drawn from matter.
      if (art.length > 0) {
        window.heldArt = {};
        for (const [coverKey, hash] of art) {
          window.heldArt[hash] = `http://127.0.0.1:15174/held/${hash}.jpg`;
          window.localStorage.setItem(
            `napstrfy-cover:v3:${coverKey}`,
            JSON.stringify({
              at: Date.now(),
              cover: {
                key: coverKey,
                artist: '',
                album: '',
                coverFileId: '',
                artHash: hash,
                thumbHash: hash,
                knows: { full: true, thumb: true }
              },
              held: { full: hash, thumb: hash }
            })
          );
        }
      }
      if (liked.length > 0) window.localStorage.setItem('napstrfy-liked-music', JSON.stringify(liked));
      if (playlists.length > 0) {
        // The list a playlist screen was last given, and the copies of the ones
        // that have been opened - which is all an offline phone has to draw from.
        window.localStorage.setItem(
          'napstrfy-playlist-list',
          JSON.stringify(playlists.map((row) => row.summary))
        );
        window.localStorage.setItem(
          'napstrfy-playlist-members',
          JSON.stringify(
            Object.fromEntries(
              playlists.map((row) => [`${row.summary.author}|${row.summary.playlistId}`, { at: 1, playlist: row.playlist }])
            )
          )
        );
      }
      // Android saying there is no network at all. The bridge is the only thing
      // that can see this, so a test that wants it has to stand in for it.
      if (wifi) window.NapstrfyNetwork = { kind: () => 'offline', metered: () => false };
      // The phone never stops trying to reach a computer, so the status it is given
      // says it is connecting - which is true of the app and false of the phone.
      if (wifi || connecting) window.statusConnecting = true;
    },
    { library, cache, liked, unreachable, wifi, connecting, playlists, art }
  );
  await page.goto('http://127.0.0.1:15174');
}

/** The calls the phone made, by command name. */
const calls = (page, cmd) => page.evaluate((name) => window.calls.filter((call) => call.cmd === name).map((call) => call.args), cmd);

/** The same count, for a poll: `calls` is a promise, so `.length` on it is not one. */
const callCount = async (page, cmd) => (await calls(page, cmd)).length;

const rows = (page) => page.locator('.track-row .track-copy strong');

/** The chips row lives on the search tab, so the tab has to be opened first. */
async function openLiked(page) {
  await page.locator('button[data-tab="search"]').click();
  await page.locator('.chips button', { hasText: 'Liked' }).click();
}

test('Wi-Fi being off is enough on its own: the library becomes what this phone holds', async ({ page }) => {
  // The computer is perfectly reachable here. The phone has no network, which is
  // the one thing the app cannot find out by asking, so it has to be told.
  await openApp(page, { wifi: true });
  await expect(page.locator('.header-count')).toContainText('cached track');
  // Two of the three are here, so two rows - and never the one that is not.
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page)).not.toContainText(['Numb']);
  // And the computer's own list was never put in front of it.
  await expect.poll(() => callCount(page, 'remote_library')).toBe(0);
});

test('a phone with no network says Offline rather than Connecting for ever', async ({ page }) => {
  // The state the device was found in: Wi-Fi off, the app still trying to reach a
  // computer every poll, and the chip claiming to be connecting for the whole
  // session. Nothing is being waited for, so nothing is what it should say.
  await openApp(page, { wifi: true, unreachable: true });
  await expect(page.locator('.status-chip')).toContainText('Offline');
});

test('a computer that never answers stops being Connecting once the attempt has had its time', async ({ page }) => {
  // The device's other half, found by hand: Android did NOT call it offline - a VPN
  // interface is present, so there is a "network" and no way to reach anything - and
  // the app keeps a tunnel attempt in the background, so `connecting` is true more
  // often than not. The chip has to stop saying it.
  await page.clock.install();
  await openApp(page, { unreachable: true, connecting: true });
  await expect(page.locator('.status-chip')).toContainText('Connecting…');
  await page.clock.fastForward(60_000);
  await expect(page.locator('.status-chip')).toContainText('Offline');
});

test('an album with nothing on this phone leaves the shelves, and Last played goes with it', async ({ page }) => {
  await openApp(page, { wifi: true });
  // Meteora is on the computer and holds nothing here, so it is not an album this
  // phone can play and has no place on a shelf that promises a sound.
  await expect(page.locator('.album-shelves')).not.toContainText('Meteora');
  await expect(page.locator('.album-shelves')).toContainText('Alexisonfire');
});

test('a track that is not here says so at once, and nothing is asked for', async ({ page }) => {
  // The liked list is this phone's own and holds a track it does not have, which
  // is exactly the case: the row is drawn, and pressing it must not hold the app
  // for a tunnel timeout while it finds out what it already knows.
  await openApp(page, { wifi: true, liked: [caliber, elsewhere] });
  await openLiked(page);
  await expect(rows(page)).toHaveCount(2);
  await page.locator('.track-row', { hasText: 'Numb' }).locator('.track-open').click();
  await expect(page.locator('.toast')).toContainText('Numb is not on this phone');
  // The ask that would have hung: not made at all.
  expect(await calls(page, 'remote_download')).toEqual([]);
  // And the app is still answering: a row that IS here plays.
  await page.locator('.track-row', { hasText: 'Caliber' }).locator('.track-open').click();
  await expect.poll(() => callCount(page, 'cache_remote_audio')).toBe(1);
});

test('a computer badge is dashed when that computer cannot be reached', async ({ page }) => {
  await openApp(page, { unreachable: true, liked: [caliber, elsewhere] });
  // A file the computer holds but this phone does not: the badge used to be a
  // solid promise that it could be had from there, which is not true right now.
  await openLiked(page);
  await expect(page.locator('.track-row', { hasText: 'Numb' }).locator('.track-badge.computer')).toHaveClass(/away/);
  // The one that is here keeps its own mark, which is not about any computer.
  await expect(page.locator('.track-row', { hasText: 'Caliber' }).locator('.track-badge.phone')).toHaveCount(1);
});

test('offline search finds a track by its artist, which the network search never could', async ({ page }) => {
  await openApp(page, { wifi: true });
  await page.locator('button[data-tab="search"]').click();
  const field = page.getByRole('textbox', { name: 'Search tracks', exact: true });
  await field.fill('alexisonfire');
  await field.press('Enter');
  await expect(rows(page)).toHaveCount(2);
  // The words were answered here, not asked of a computer.
  expect(await calls(page, 'search_cached_library')).toEqual([{ query: 'alexisonfire' }]);
  expect(await calls(page, 'remote_search')).toEqual([]);
});

test('the search is not a lookup of titles: a word from the album is enough', async ({ page }) => {
  await openApp(page, { wifi: true });
  await page.locator('button[data-tab="search"]').click();
  const field = page.getByRole('textbox', { name: 'Search tracks', exact: true });
  await field.fill('pulmonary');
  await field.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText(['Pulmonary Archery']);
});

test('the cache screen says what is kept and takes a new size', async ({ page }) => {
  await openApp(page, { wifi: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-row', { hasText: 'Audio cache' }).click();
  await expect(page.locator('.cache-total')).toContainText('2 tracks');
  await expect(page.locator('.cache-total')).toContainText('1 MB');
  // The size is a choice rather than a number to type, and the write is the
  // answer: the store the screen draws is the one it was just told to keep.
  await page.locator('.preload-chip', { hasText: '4 GB' }).click();
  await expect.poll(() => calls(page, 'set_audio_cache_budget')).toEqual([
    { bytes: 4 * 1024 * 1024 * 1024, protectedFileIds: [] }
  ]);
  await expect(page.locator('.preload-chip', { hasText: '4 GB' })).toHaveClass(/on/);
});

test('the cache screen is closed by a back press before Settings is', async ({ page }) => {
  await openApp(page, { wifi: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-row', { hasText: 'Audio cache' }).click();
  await expect(page.locator('.cache-total')).toBeVisible();
  // Android drives the press, and it is only offered one while the page says it
  // has somewhere to go - which the sheet opened over Settings has to keep saying.
  expect(await page.evaluate(() => window.backAvailable)).toBe(true);
  await page.locator('[aria-label="Close"]').click();
  await expect(page.locator('.cache-total')).toHaveCount(0);
  await expect(page.locator('.settings-scroll')).toBeVisible();
});

test('the settings toggle turns the mode on with a computer that answers', async ({ page }) => {
  await openApp(page, { cache: [caliber, cached] });
  // Nothing is wrong here: the phone has a network and the computer is up, so the
  // library is the computer's own.
  await expect(page.locator('.header-count')).toContainText('hosted track');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = page.locator('.settings-row', { hasText: 'Offline mode' });
  await expect(toggle).toContainText('Off: use the computers when they answer');
  await toggle.click();
  await expect(toggle).toContainText('On: only what this phone holds');
  expect(await page.evaluate(() => window.localStorage.getItem('napstrfy-offline-mode'))).toBe('true');
  // And the choice reaches the library behind the sheet.
  await page.locator('[aria-label="Close settings"]').click();
  await expect(page.locator('.header-count')).toContainText('cached track');
});

test('the shelves stop claiming things about a computer that is not there', async ({ page }) => {
  await openApp(page, { unreachable: true, playlists: [{ summary: campingSummary, playlist: camping }] });
  // Names this phone remembers, not names on a computer it cannot reach.
  const shelf = page.locator('.section-label', { hasText: 'Playlists' });
  await expect(shelf).toContainText('remembered');
  await expect(shelf).not.toContainText('on your computer');
  // And the card draws its cover rather than the music-note placeholder. The file a
  // playlist opens with is one this phone holds, so the art is resolved through the
  // library this phone has - the card used to sit on the placeholder while the cover
  // for that very album was on the phone.
  await expect(
    page.locator('.album-card', { hasText: 'Camping' }).locator('.card-art-empty')
  ).toHaveCount(0);
  // And the album count says what it is counting. It is drawn from the tracks this
  // phone has loaded - two of them - not from a library it has not finished
  // reading, which is what "in this library" claimed.
  await expect(page.locator('.section-label', { hasText: 'Discover albums' })).toContainText('in 2 tracks');
});

test('a playlist row is drawn from the first member whose art this phone holds', async ({ page }) => {
  // The pictures themselves, so a tile can load what it is given: a tile that
  // cannot load its picture drops it and shows the placeholder instead.
  await page.route('**/held/*.jpg', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: ONE_PIXEL_PNG
    })
  );
  // Three playlists whose opening file is not here: the list carries only a file
  // id, and the library is what turns that into an artist and an album to look art
  // up by - so a row whose opening file cannot be resolved used to be left on the
  // music note while the cover for that very album was on the phone. What this
  // phone remembers of a playlist carries its members and their tags, which is
  // enough to find art it already holds.
  const member = (position, audio, title, artist, album) => ({ position, fileId: audio, title, artist, album });
  const remembered = (playlistId, title, opening, tracks) => ({
    summary: { ...campingSummary, playlistId, title, firstFileId: opening },
    playlist: { ...camping, playlistId, title, tracks, total: tracks.length }
  });
  // On this phone, and an album whose picture is not: the library answers for the
  // file, and the answer is still no art.
  const sundown = track('g', 'Sundown', 'Gordon Lightfoot', 'Sundown');
  await openApp(page, {
    unreachable: true,
    cache: [caliber, cached, sundown],
    art: [
      ['alexisonfire|alexisonfire', 'aa11'],
      ['linkin park|meteora', 'bb22']
    ],
    // Each opens with a file this phone is not holding, which is what leaves the
    // library with nothing to say about its album.
    playlists: [
      // The opening member's art is here, so it is the one drawn: what a playlist
      // looks like is the record it opens with.
      remembered('opener', 'Opener', id('d'), [
        member(1, id('d'), 'Pulmonary Archery', 'Alexisonfire', 'Alexisonfire'),
        member(2, id('c'), 'Numb', 'Linkin Park', 'Meteora')
      ]),
      // The opening member's art is not here, and the second member's is: the row
      // takes the second rather than nothing, because a playlist is a list of
      // records and the first one with a picture is a better face for it.
      remembered('second', 'Second', id('e'), [
        member(1, id('e'), 'Ghost Town', 'The Specials', 'More Specials'),
        member(2, id('c'), 'Numb', 'Linkin Park', 'Meteora')
      ]),
      // The library does answer for this one, and it still answers with an album
      // whose picture is not here.
      remembered('opened', 'Opened', sundown.fileId, [
        member(1, sundown.fileId, sundown.title, sundown.artist, sundown.album),
        member(2, id('c'), 'Numb', 'Linkin Park', 'Meteora')
      ]),
      // Nothing here for any of it, which is the one case that is honestly a note.
      remembered('nothing', 'Nothing', id('f'), [
        member(1, id('f'), 'Ghost Town', 'The Specials', 'More Specials')
      ])
    ]
  });
  const card = (title) => page.locator('.album-card', { hasText: title });
  const drawn = (title) => card(title).locator('.artwork img');

  await expect(card('Opener').locator('.card-art-empty')).toHaveCount(0);
  await expect.poll(() => drawn('Opener').getAttribute('src')).toContain('/held/aa11.jpg');

  await expect(card('Second').locator('.card-art-empty')).toHaveCount(0);
  await expect.poll(() => drawn('Second').getAttribute('src')).toContain('/held/bb22.jpg');

  await expect(card('Opened').locator('.card-art-empty')).toHaveCount(0);
  await expect.poll(() => drawn('Opened').getAttribute('src')).toContain('/held/bb22.jpg');

  await expect(card('Nothing').locator('.card-art-empty')).toHaveCount(1);

  // And the page a card opens is drawn from the same member rather than from its
  // first: seen on the device, where a card with a cover opened a page with a note.
  await card('Second').locator('button.album-open').click();
  await expect.poll(() => page.locator('.album-art-backdrop').getAttribute('src')).toContain('/held/bb22.jpg');

  // The one album anything asked about is the one no row drew from: 'Sundown' is on
  // this phone without its picture, so the shelf that lists it asks. Not one ask came
  // from a row that had a picture of its own to draw, which is the point.
  const asked = (await calls(page, 'remote_covers')).flatMap((call) => call.keys).sort();
  expect(asked).toEqual(['gordon lightfoot|sundown']);
});

test('the discussion card says it needs a connection rather than opening on nothing', async ({ page }) => {
  await openApp(page, { unreachable: true });
  await page.locator('.track-row', { hasText: 'Caliber' }).locator('.track-open').click();
  await expect.poll(() => callCount(page, 'cache_remote_audio')).toBe(1);
  await page.locator('.now-open').click();
  const card = page.locator('.sheet-card');
  // Nothing is cached from a public thread - it lives on relays and the computer
  // fetches it - so the card says so instead of offering a composer that refuses.
  await expect(card).toContainText('Needs a connection');
  await card.click();
  await expect(page.locator('.toast')).toContainText('Track discussion needs a connection');
  expect(await calls(page, 'remote_track_discussion')).toEqual([]);
});

test('a playlist opens from what this phone already has, without asking anybody', async ({ page }) => {
  // A computer that is away, rather than a phone with no network: the mock host
  // still answers while the phone is offline, and an answer replaces the list this
  // phone was holding - which is correct, and not the case under test.
  await openApp(page, { unreachable: true, playlists: [{ summary: campingSummary, playlist: camping }] });
  await page.locator('button[data-tab="playlists"]').click();
  await expect(page.locator('.playlist-row', { hasText: 'Camping' })).toBeVisible();
  // Nothing claims to be asking anybody. Seen on the device: the list drew from
  // memory and then sat under "Asking Deadwax…" for the best part of a minute.
  await expect(page.locator('.loading-list')).toHaveCount(0);
  await page.locator('.playlist-row', { hasText: 'Camping' }).click();
  // Opened at once from the copy this phone was last shown, rather than after a
  // minute of waiting for a computer that is not going to answer.
  await expect(page.locator('.playlist-sheet')).toBeVisible({ timeout: 3000 });
  expect(await calls(page, 'remote_playlist')).toEqual([]);
});
