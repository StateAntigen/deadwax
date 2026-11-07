import { test, expect } from '@playwright/test';
import { mockNative } from './helpers/native.mjs';

/**
 * The Folders page: what this computer shares, folder by folder, and the reason
 * for everything it does not.
 *
 * The page's whole job is that nothing on it is a guess. A folder says whether it
 * is shared or why not, a file says the same, and stopping the sharing of either
 * is one press that records the person's own words beside it.
 */
async function openFolders(page) {
  await mockNative(page, { app: 'napstr' });
  await page.addInitScript(() => {
    window.library = {
      sources: [
        { id: 1, name: 'Music', path: '/music/Aristotle', state: 'active', reachable: true, files: 2, bytes: 40_000_000, folders: 2 },
        { id: 2, name: 'Audiobooks', path: '/audiobooks', state: 'parked', reachable: true, files: 0, bytes: 0, folders: 0 }
      ],
      tree: {
        '': [{ sourceId: 1, key: 'Music', name: 'Music', path: '/music/Aristotle', depth: 0, files: 2, shared: true, reason: '', expandable: true }],
        '1|Music': [
          { sourceId: 1, key: 'Music/Muse', name: 'Muse', path: '/music/Aristotle/Muse', depth: 1, files: 2, shared: true, reason: '', expandable: false },
          { sourceId: 1, key: 'Music/Podcasts', name: 'Podcasts', path: '/music/Aristotle/Podcasts', depth: 1, files: 0, shared: false, reason: 'not music, kept off the network', expandable: false }
        ]
      },
      contents: {
        '1|Music': {
          sourceId: 1, key: 'Music', name: 'Music', path: '/music/Aristotle',
          rows: [
            { name: '01 - Intro.mp3', size: 4_000_000, status: 'shared', reason: '', detail: '', fileId: 'a'.repeat(64), key: 'Music/01 - Intro.mp3' },
            { name: '02 - Interlude.mp3', size: 2_000_000, status: 'shared', reason: '', detail: '', fileId: 'b'.repeat(64), key: 'Music/02 - Interlude.mp3' },
            { name: '07 - Hysteria.m4a', size: 8_000_000, status: 'notShared', reason: 'unsupportedFormat', detail: 'M4A', fileId: '', key: 'Music/07 - Hysteria.m4a' },
            { name: 'cover.jpg', size: 180_000, status: 'ignored', reason: 'notAudio', detail: '', fileId: '', key: 'Music/cover.jpg' }
          ],
          audio: 2, shared: 2, unsupported: 1, folders: 2, parked: false
        }
      }
    };
  });
  await page.goto('http://127.0.0.1:15173');
  // It is reached from the page whose folders it describes, not from the rail.
  await page.locator('.rail .tool-button').filter({ hasText: 'Shared' }).click();
  await page.locator('.actionbar').getByRole('button', { name: 'Folders' }).click();
  await expect(page.locator('.folders-view')).toBeVisible();
}

const lastCall = (page, cmd) =>
  page.evaluate((name) => window.calls.filter((call) => call.cmd === name).at(-1)?.args ?? null, cmd);

test('every source says whether it is on the network, and every folder says why it is not', async ({ page }) => {
  await openFolders(page);

  // The sources: two of them, one shared and one parked.
  const sources = page.locator('.source-row');
  await expect(sources).toHaveCount(2);
  await expect(sources.nth(0)).toContainText('Music');
  await expect(sources.nth(0)).toContainText('/music/Aristotle');
  await expect(sources.nth(0)).toContainText('Shared');
  await expect(sources.nth(1)).toContainText('Audiobooks');
  await expect(sources.nth(1)).toContainText('Parked');

  // The tree under the active source: the folder that is shared, and the one
  // that is not, with the person's own reason beside it.
  const nodes = page.locator('.folder-node');
  await expect(nodes).toHaveCount(3);
  await expect(nodes.nth(0)).toContainText('Music');
  await expect(nodes.nth(1)).toContainText('Muse');
  await expect(nodes.nth(1)).toHaveClass(/folder-node/);
  await expect(nodes.nth(2)).toContainText('Podcasts');
  await expect(nodes.nth(2)).toContainText('not music, kept off the network');
  await expect(nodes.nth(2)).toHaveClass(/excluded/);
  await expect(nodes.nth(2).locator('.folder-tick')).toHaveText('☐');
  await expect(nodes.nth(1).locator('.folder-tick')).toHaveText('✓');
});

test('a file that is not on the network says why, in words rather than in a code', async ({ page }) => {
  await openFolders(page);
  const rows = page.locator('.folder-table tbody tr');
  await expect(rows).toHaveCount(4);

  await expect(rows.nth(0)).toContainText('01 - Intro.mp3');
  await expect(rows.nth(0).locator('.folder-pill')).toHaveText('Shared');
  await expect(rows.nth(0).locator('.folder-reason-cell')).toHaveText('');

  // A format this computer will not offer, and a file that is not audio at all:
  // both say which, rather than looking like a broken share.
  await expect(rows.nth(2).locator('.folder-pill')).toHaveText('Not shared');
  await expect(rows.nth(2).locator('.folder-reason-cell')).toHaveText('M4A audio is not a shared format');
  await expect(rows.nth(3).locator('.folder-pill')).toHaveText('Ignored');
  await expect(rows.nth(3).locator('.folder-reason-cell')).toHaveText('not audio');

  // The summary counts what could be shared against what is.
  const summary = page.locator('.folder-summary');
  await expect(summary).toContainText('2 of 2 audio files shared');
  await expect(summary).toContainText('1 file in no shared format');
  await expect(summary).toContainText('2 folders');
});

test('stopping the sharing of a track records the reason and puts it back on request', async ({ page }) => {
  await openFolders(page);
  const rows = page.locator('.folder-table tbody tr');
  const interlude = rows.nth(1);

  await interlude.getByRole('button', { name: 'Stop sharing' }).click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toContainText('Stop sharing 02 - Interlude.mp3?');
  await dialog.getByPlaceholder('Optional, for example: the rip is silent').fill('the rip is silent');
  await dialog.locator('.dialog-actions .classic-button.primary').click();

  // The reason travels with the exclusion, and the key is the file's own path
  // inside its source - not the name on screen, which is not unique.
  await expect
    .poll(() => lastCall(page, 'exclude_shared'))
    .toEqual({ sourceId: 1, kind: 'file', key: 'Music/02 - Interlude.mp3', reason: 'the rip is silent' });

  // The row is drawn as what it now is, with the words that were typed.
  await expect(rows.nth(1).locator('.folder-pill')).toHaveText('Excluded');
  await expect(rows.nth(1).locator('.folder-reason-cell')).toHaveText('the rip is silent');
  await expect(page.locator('.folder-summary')).toContainText('1 of 2 audio files shared');

  // And sharing it again is one press, which asks the host to walk the folder.
  await rows.nth(1).getByRole('button', { name: 'Share again' }).click();
  await expect
    .poll(() => lastCall(page, 'include_shared'))
    .toEqual({ sourceId: 1, kind: 'file', key: 'Music/02 - Interlude.mp3' });
  await expect(rows.nth(1).locator('.folder-pill')).toHaveText('Shared');
});

test('a folder is shared and unshared from its own tick, and a source is parked the same way', async ({ page }) => {
  await openFolders(page);
  const podcasts = page.locator('.folder-node', { hasText: 'Podcasts' });

  // The tick on an excluded folder puts it back, and the walk follows.
  await podcasts.locator('.folder-tick').click();
  await expect
    .poll(() => lastCall(page, 'include_shared'))
    .toEqual({ sourceId: 1, kind: 'folder', key: 'Music/Podcasts' });

  // A source's tick is its state: a parked one comes back on the network.
  const audiobooks = page.locator('.source-row', { hasText: 'Audiobooks' });
  await audiobooks.locator('.folder-tick').click();
  await expect.poll(() => lastCall(page, 'set_library_source_state')).toEqual({ id: 2, status: 'active' });
  await expect(audiobooks).toContainText('Shared');
});

test('a track feeds the editor, and saving writes its tags', async ({ page }) => {
  await openFolders(page);
  // Only the row the snapshot holds a library entry for can be edited; the
  // others are files, not tracks this computer publishes.
  await page.locator('.folder-table tbody tr').nth(0).click();

  const editor = page.locator('.folders-editor');
  await expect(editor).toContainText('01 - Intro.mp3');
  // Format, bitrate and size are facts beside the name, not fields.
  await expect(editor.locator('.folder-facts')).toContainText('WAV');
  await expect(editor.getByLabel('Title')).toHaveValue('Search');
  await expect(editor.getByLabel('Album')).toHaveValue('User album');
  // The file's own genre and year, which the index now keeps.
  await expect(editor.getByLabel('Genre')).toHaveValue('Shoegaze');
  await expect(editor.getByLabel('Year')).toHaveValue('1997');

  await editor.getByLabel('Title').fill('Intro (Remastered)');
  await editor.getByLabel('Genre').fill('Shoegaze');
  await editor.getByLabel('Year').fill('1997');
  await editor.getByLabel('Track').fill('1');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();

  await expect
    .poll(() => page.evaluate(() => window.savedMetadata ?? null))
    .toEqual({
      fileId: 'a'.repeat(64),
      title: 'Intro (Remastered)',
      artist: 'Settings',
      album: 'User album',
      genre: 'Shoegaze',
      year: 1997,
      trackNumber: 1,
      discNumber: 0
    });
  // The answer is read again, and the row being edited is the one chosen.
  await expect(editor.getByLabel('Title')).toHaveValue('Intro (Remastered)');
});

test('the genre box offers the words this library already uses', async ({ page }) => {
  // A suggestion list rather than a free box: a library that has already said
  // "Shoegaze" should not be asked to spell it again, and the curated list is
  // there for the case where nothing has been said yet.
  await openFolders(page);
  await page.locator('.folder-table tbody tr').nth(0).click();

  const choices = await page.locator('#folder-genre-choices option').evaluateAll((options) =>
    options.map((option) => option.value)
  );
  expect(choices).toContain('Shoegaze');
  expect(choices).toContain('Rock');
  // One entry per spelling, not one per file.
  expect(new Set(choices).size).toBe(choices.length);
});

test('a track right-clicked offers playing it and searching for its artist', async ({ page }) => {
  await openFolders(page);
  await page.locator('.folder-table tbody tr').nth(0).click({ button: 'right' });

  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Play track');
  await expect(menu).toContainText('Search for artist');
  await expect(menu).toContainText('Search for album');
  await expect(menu).toContainText('Stop sharing');

  // The artist is the one the library holds, and searching for it leaves this page.
  await menu.getByRole('menuitem', { name: 'Search for artist' }).click();
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await expect(page.locator('#search-query')).toHaveValue('Settings');
  await expect(page.locator('.search-results-table')).toBeVisible();
});

test('a folder right-clicked offers playing it, and opening it in the file manager', async ({ page }) => {
  await openFolders(page);
  await page.locator('.folder-node', { hasText: 'Muse' }).locator('.folder-open').click({ button: 'right' });

  const menu = page.locator('.context-menu');
  await expect(menu).toContainText('Play folder');
  await expect(menu).toContainText('Open folder');
  await menu.getByRole('menuitem', { name: 'Open folder' }).click();
  await expect
    .poll(() => page.evaluate(() => window.calls.filter((call) => call.cmd === 'open_library_folder').at(-1)?.args))
    .toEqual({ sourceId: 1, folder: 'Music/Muse' });
});
