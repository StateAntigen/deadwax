import { test, expect } from '@playwright/test';
import { mockNative } from './helpers/native.mjs';

// The Downloads page is two halves now: what came in, and what went out. The second
// half exists because the host had no memory at all of a file it had served - a
// transfer that completed left no trace, so "who has taken something from me" was
// unanswerable from the window.

/** Open the page with a seeded transfer and a seeded upload history. */
async function openDownloads(page, uploads = []) {
  await mockNative(page, { app: 'napstr' });
  await page.addInitScript((rows) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.uploads = rows;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'uploads') return window.uploads;
      return invoke(cmd, args);
    };
  }, uploads);
  await page.goto('http://127.0.0.1:15173');
  await expect(page.locator('.search-button')).toBeEnabled({ timeout: 20_000 });
  await page.locator('.tool-button', { hasText: 'Downloads' }).click();
  await expect(page.locator('.downloads-view')).toBeVisible();
}

test('the page is two halves, and the queue is called Downloads', async ({ page }) => {
  await openDownloads(page);

  // The old column header said "Download order", which named the ordering of a
  // list rather than the list.
  const queue = page.locator('.download-queue');
  await expect(queue.locator('thead th').first()).toHaveText('Downloads');

  // The other half is its own column with its own head.
  const uploads = page.locator('.upload-queue');
  await expect(uploads).toBeVisible();
  await expect(uploads.locator('.queue-column-head')).toContainText('Uploads');
  await expect(uploads.locator('thead th')).toHaveText(['File', 'Who', 'Size', 'When']);

  // Side by side, not stacked: each half owns its scroll, so neither can push the
  // other off the page.
  const queueBox = await queue.boundingBox();
  const uploadBox = await uploads.boundingBox();
  expect(uploadBox.x).toBeGreaterThan(queueBox.x + queueBox.width - 1);
  expect(Math.abs(uploadBox.y - queueBox.y)).toBeLessThan(4);
});

test('a file somebody took is listed with who took it and when', async ({ page }) => {
  await openDownloads(page, [
    {
      id: 7,
      fileId: 'b'.repeat(64),
      filename: 'Ruby Soho.flac',
      size: 8_400_000,
      requester: 'npub1' + 'q'.repeat(58),
      createdAt: '2026-11-01T20:14:00+00:00'
    }
  ]);

  const row = page.locator('.upload-queue tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Ruby Soho.flac');
  // A key is shortened rather than printed: a full npub would push the date off
  // the row, and the whole value is in the tooltip.
  await expect(row.locator('.upload-who')).toHaveText('npub1qqqqqqq…');
  await expect(row.locator('.upload-who')).toHaveAttribute('title', 'npub1' + 'q'.repeat(58));
  await expect(row).toContainText(/8\.\d MB/);
  // The date is part of the stamp, not just the time: this list covers weeks.
  await expect(row).toContainText('Nov');
});

test('nothing taken yet says so rather than looking broken', async ({ page }) => {
  await openDownloads(page);
  await expect(page.locator('.upload-queue')).toContainText(
    'Nothing has been downloaded from this computer yet.'
  );
});
