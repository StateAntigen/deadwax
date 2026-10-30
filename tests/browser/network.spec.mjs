import { test, expect } from '@playwright/test';
import { mockNative } from './helpers/native.mjs';

/**
 * The Network page is this computer's own view: the mirror's announcements, the
 * heartbeats still live, and the library beside them. These tests pin the two
 * things that would make it lie — an ungrouped figure, and a search index that is
 * behind the table it is derived from being drawn as if it were fine.
 */
test('the Network page reports what this computer can see', async ({ page }) => {
  await mockNative(page, { app: 'napstr' });
  await page.goto('http://127.0.0.1:15173');
  await page.locator('.tool-button').filter({ hasText: 'Network' }).click();

  const kpis = page.locator('.net-kpi');
  await expect(kpis).toHaveCount(4);
  await expect(kpis.nth(0)).toContainText('Playable now');
  await expect(kpis.nth(0)).toContainText('22,322');
  await expect(kpis.nth(0)).toContainText('5 publishers saying so');
  await expect(kpis.nth(1)).toContainText('75,698');
  await expect(kpis.nth(1)).toContainText('75,698 indexed');
  await expect(kpis.nth(2)).toContainText('118');
  await expect(kpis.nth(3)).toContainText('3,189');

  // The live figure is the only one allowed an accent colour.
  const live = await kpis.nth(0).locator('.net-value').evaluate((element) => getComputedStyle(element).color);
  const quiet = await kpis.nth(3).locator('.net-value').evaluate((element) => getComputedStyle(element).color);
  expect(live).not.toBe(quiet);

  await expect(page.locator('.net-warn')).toHaveCount(0);
  await expect(page.locator('.net-bar-row')).toHaveCount(5);
  const publishers = page.locator('.net-publishers tbody tr');
  await expect(publishers).toHaveCount(2);
  await expect(publishers.first()).toContainText('25,630');
  await expect(publishers.nth(1).locator('td.num').nth(1)).toHaveText('0');
  await expect(page.locator('.net-foot')).toContainText('Last mirror write');
  await expect(page.locator('.net-foot')).toContainText("not the network's totals");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('network.png'), fullPage: true });
});

test('an index behind the mirror is called out rather than drawn as fine', async ({ page }) => {
  await mockNative(page, { app: 'napstr' });
  await page.addInitScript(() => {
    window.catalogueStats = { announced: 1000, indexed: 10 };
  });
  await page.goto('http://127.0.0.1:15173');
  await page.locator('.tool-button').filter({ hasText: 'Network' }).click();

  await expect(page.locator('.net-warn')).toContainText('index is behind the mirror');
  await expect(page.locator('.net-kpi').nth(1)).toContainText('10 indexed');
});

test('a catalogue with nothing live says so instead of drawing empty lists', async ({ page }) => {
  await mockNative(page, { app: 'napstr' });
  await page.addInitScript(() => {
    window.catalogueStats = { liveFiles: 0, livePeers: 0, describedLive: 0, formats: [], artists: [], publishersTop: [] };
  });
  await page.goto('http://127.0.0.1:15173');
  await page.locator('.tool-button').filter({ hasText: 'Network' }).click();

  await expect(page.locator('.net-empty')).toHaveCount(2);
  await expect(page.locator('.net-empty').first()).toHaveText('Nothing is playable right now.');
});
