import { test, expect, type Page } from '@playwright/test';

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.fact-card').first()).toBeVisible({ timeout: 15_000 });
  // The hints cover part of the map; they appear a beat after the map does,
  // so wait for them rather than racing them, then dismiss.
  const got = page.getByRole('button', { name: 'Got it' });
  await got.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  if (await got.isVisible().catch(() => false)) await got.click();
  await expect(page.getByRole('note')).toHaveCount(0);
}

test('the map exports as a PNG with a title and a date', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /PNG/ }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^repo-atlas-axios.*\.png$/);
  const path = await download.path();
  expect(path).toBeTruthy();

  // A real image, taller than the map because of the title and footer.
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(bytes.length).toBeGreaterThan(20_000);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(1000);
  expect(height).toBeGreaterThan(600);
});

test('the playback records as a WebM', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /WebM/ }).click();

  // Recording starts playback from the beginning.
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('.now-commit')).not.toContainText('commit 1 of');

  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Stop recording' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.webm$/);

  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync((await download.path())!);
  expect(bytes.length, 'the recording should contain video').toBeGreaterThan(5_000);
  // EBML magic, i.e. a real Matroska/WebM container.
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
});

test('the table view carries the same information as text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  await page.keyboard.press('t');
  const view = page.getByRole('dialog', { name: 'The map as a table' });
  await expect(view).toBeVisible();

  // Four real tables, each with proper headers and a caption.
  const tables = view.locator('table.data');
  await expect(tables).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(tables.nth(i).locator('caption')).not.toBeEmpty();
    expect(await tables.nth(i).locator('thead th').count()).toBeGreaterThan(1);
  }

  await expect(view).toContainText('2026 was the busiest year');
  await expect(view).toContainText('bus factor');
  await expect(view).toContainText('single owner');
  await expect(view).toContainText('estimates');
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'shots/table-night-1440x900.png' });

  // A row can take you back to the map.
  await view.locator('tbody .link-btn').first().click();
  await expect(view).toHaveCount(0);
});

test('the help sheet lists every shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();

  for (const key of ['Space', '← →', 'Shift + ← →', 'Home / End', '[ ]', '1 – 5', 'c', '/', 't', '?']) {
    await expect(sheet.locator('kbd', { hasText: key }).first()).toBeVisible();
  }
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'shots/help-night-1440x900.png' });

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('first-run hints appear once and stay dismissed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });

  const hints = page.getByRole('note');
  await expect(hints).toBeVisible();
  await expect(hints).toContainText('Space');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(hints).toHaveCount(0);

  // Reload: they must not come back.
  await page.reload();
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await expect(page.getByRole('note')).toHaveCount(0);
});

test('reduced motion still plays, but without tweening', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  // Playback still works; it simply snaps between layouts.
  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  await expect(page.locator('.now-commit')).not.toContainText('commit 1 of');
  await page.keyboard.press('Space');

  // Drilling in is instant rather than animated: two frames a moment apart
  // must be identical, because nothing should still be moving.
  // Not every hotspot lives in a folder — the top one is often at the root,
  // which has no crumbs to click. Take the first that is nested. Selecting one
  // switches the panel to Selection, so the list has to be reopened each time.
  for (let i = 0; i < 6; i++) {
    await page.getByRole('tab', { name: 'Hotspots' }).click();
    await page.locator('.spot').nth(i).click();
    if ((await page.locator('.sel-crumb').count()) > 0) break;
  }
  await page.locator('.sel-crumb').first().click();
  await page.waitForTimeout(500);
  const a = await page.locator('.map-canvas').first().screenshot();
  await page.waitForTimeout(400);
  const b = await page.locator('.map-canvas').first().screenshot();
  expect(Buffer.compare(a, b), 'the map should be still under reduced motion').toBe(0);
  await page.screenshot({ path: 'shots/reduced-night-1440x900.png' });
});

test('nothing leaves the tab, even while exporting', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const origin = new URL(page.url()).origin;
  const offsite: string[] = [];
  const local: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(origin)) local.push(new URL(url).pathname);
    else if (!url.startsWith('blob:') && !url.startsWith('data:')) offsite.push(url);
    expect(['GET'], `${r.method()} ${url}`).toContain(r.method());
  });

  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  const got = page.getByRole('button', { name: 'Got it' });
  await got.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  if (await got.isVisible().catch(() => false)) await got.click();

  // Exercise the features most likely to phone home, if any did.
  await page.keyboard.press('t');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.keyboard.press('Escape');
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /PNG/ }).click();
  await downloadPromise;
  await page.waitForTimeout(800);

  expect(offsite, `third-party requests: ${offsite.join(', ')}`).toEqual([]);
  const unexpected = local.filter((p) => !/\.(woff2?|js|css|txt)$/.test(p));
  expect(unexpected, `unexpected same-origin requests: ${unexpected.join(', ')}`).toEqual([]);
});
