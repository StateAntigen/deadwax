import { test, expect } from '@playwright/test';
import { mockNative } from './helpers/native.mjs';

/**
 * Selecting rows in the results list, and the Group Albums view of it.
 *
 * The range used to be measured against the order the host answered in rather than
 * the order the pane draws, so a shift-click skipped rows that were plainly between
 * the two ends on screen, and Ctrl did nothing at all.
 */
const albums = ['Alpha', 'Alpha', 'Alpha', 'Beta', 'Beta', ''];

async function openResults(page) {
  await mockNative(page, { app: 'napstr' });
  await page.addInitScript((albumNames) => {
    window.localSearchResults = albumNames.map((album, index) => ({
      fileId: (index + 1).toString(16).padStart(64, '0'),
      filename: `Track ${index + 1}.mp3`,
      title: `Track ${index + 1}`,
      artist: album ? `Artist ${album}` : 'Loose Artist',
      album,
      format: 'MP3',
      mime: 'audio/mpeg',
      size: 1_000_000,
      bitrateKbps: 192,
      durationMs: 200_000,
      sources: [{ pubkey: 'd'.repeat(64), npub: 'npub1source', displayName: 'Source' }]
    }));
    window.networkSearchResults = window.localSearchResults;
  }, albums);
  await page.goto('http://127.0.0.1:15173');
  await page.locator('#search-query').fill('selection');
  await page.locator('.search-button').click();
  const rows = page.locator('.search-results-table tbody tr');
  await expect(rows).toHaveCount(6);
  return rows;
}

const selection = (page) => page.locator('.selected-file strong');

test('Ctrl-click adds one row at a time and Shift-click takes the rows between', async ({ page }) => {
  const rows = await openResults(page);

  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ['Control'] });
  await rows.nth(4).click({ modifiers: ['Control'] });
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(4)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false');
  await expect(selection(page)).toContainText('3');

  // Clicking a selected row with Ctrl takes it out again and keeps the rest.
  await rows.nth(2).click({ modifiers: ['Control'] });
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'false');
  await expect(selection(page)).toContainText('2');

  // A range is measured in the order the list is drawn in.
  await rows.nth(1).click();
  await rows.nth(4).click({ modifiers: ['Shift'] });
  for (const index of [1, 2, 3, 4]) await expect(rows.nth(index)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(rows.nth(5)).toHaveAttribute('aria-selected', 'false');
});

test('a range survives a sort, because the range is what is on screen', async ({ page }) => {
  const rows = await openResults(page);
  // Reverse the order first, so the drawn order and the answer's order disagree.
  await page.locator('.search-results-table thead th', { hasText: 'Name' }).locator('button').click();
  await expect(rows.first()).toContainText('Track 6');

  await rows.nth(0).click();
  await rows.nth(4).click({ modifiers: ['Shift'] });
  for (const index of [0, 1, 2, 3, 4]) await expect(rows.nth(index)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(5)).toHaveAttribute('aria-selected', 'false');
  await expect(selection(page)).toContainText('5');
});

test('Group Albums lists the records, and the one that is opened shows its tracks', async ({ page }) => {
  const rows = await openResults(page);
  await page.locator('.advanced-toggle').click();
  await page.getByLabel('Group Albums').check();

  // One entry per album: the tracks are no longer mixed into the list.
  const albums = page.locator('.album-row');
  await expect(albums).toHaveCount(3);
  await expect(albums.nth(0)).toContainText('Alpha');
  await expect(albums.nth(0)).toContainText('Artist Alpha');
  await expect(albums.nth(0)).toContainText('3 tracks');
  await expect(albums.nth(1)).toContainText('Beta');
  await expect(albums.nth(1)).toContainText('2 tracks');

  // Opening one puts its tracks in the pane beside it, in the order drawn.
  await albums.nth(0).click();
  const tracks = page.locator('.album-track');
  await expect(tracks).toHaveCount(3);
  await expect(tracks.nth(0)).toContainText('Track 1');
  await expect(tracks.nth(1)).toContainText('Track 2');
  await expect(tracks.nth(2)).toContainText('Track 3');

  // A track is selectable, and ctrl-click adds one to the selection.
  await tracks.nth(0).click();
  await expect(tracks.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await tracks.nth(2).click({ modifiers: ['Control'] });
  await expect(tracks.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(tracks.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(tracks.nth(1)).toHaveAttribute('aria-pressed', 'false');

  // The record is one press to fetch.
  await page.getByRole('button', { name: 'Download album' }).click();
  await expect
    .poll(async () => page.evaluate(() => window.calls.filter((call) => call.cmd === 'request_network_download').length))
    .toBe(3);
});
