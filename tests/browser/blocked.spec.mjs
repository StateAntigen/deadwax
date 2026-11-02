import { test, expect } from '@playwright/test';
import { mockNative } from './helpers/native.mjs';

/**
 * Settings opens a page of its own for what this computer ignores, and the page's
 * whole job is to let somebody change their mind.
 */
test('Blocked Content lists what is ignored and lets it back in', async ({ page }) => {
  await mockNative(page, { app: 'napstr' });
  await page.addInitScript(() => {
    window.blockedContent = {
      pubkeys: [{ key: 'd'.repeat(64), label: 'Loud Publisher', reason: 'Blocked by user', createdAt: '2026-10-30T10:00:00Z' }],
      covers: [{ key: 'deep purple|machine head', label: 'Machine Head · Deep Purple', reason: 'Blocked by user', createdAt: '2026-10-29T10:00:00Z' }],
      files: [{ key: 'e'.repeat(64), label: 'A track somebody shared', reason: 'Blocked by user', createdAt: '2026-10-28T10:00:00Z' }]
    };
  });
  await page.goto('http://127.0.0.1:15173');
  await page.locator('.tool-button', { hasText: 'Settings' }).click();
  await page.getByRole('button', { name: 'Open Blocked Content' }).click();

  await expect(page.locator('.blocked-card')).toHaveCount(3);
  // Each kind is named, counted, and shown by the name it was blocked under.
  await expect(page.locator('.blocked-card').nth(0)).toContainText('Publishers');
  await expect(page.locator('.blocked-card').nth(0)).toContainText('Loud Publisher');
  await expect(page.locator('.blocked-card').nth(1)).toContainText('Machine Head · Deep Purple');
  await expect(page.locator('.blocked-card').nth(2)).toContainText('A track somebody shared');

  await page.locator('.blocked-card').nth(1).getByRole('button', { name: 'Unblock' }).click();
  await expect
    .poll(async () => page.evaluate(() => window.calls.filter((call) => call.cmd === 'unblock').at(-1)?.args))
    .toEqual({ kind: 'cover', key: 'deep purple|machine head' });
  // The row is gone, and the other two are untouched.
  await expect(page.locator('.blocked-card').nth(1)).toContainText('No album cover is hidden.');
  await expect(page.locator('.blocked-card').nth(0)).toContainText('Loud Publisher');

  // And back to Settings, which is where it is opened from.
  await page.locator('.blocked-tools').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Open Blocked Content' })).toBeVisible();
});
