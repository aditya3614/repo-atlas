import { test, expect, type Page } from '@playwright/test';

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.fact-card').first()).toBeVisible({ timeout: 15_000 });
}

test('story cards are real sentences that jump somewhere', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  const cards = page.locator('.fact-card');
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(6);
  expect(n).toBeLessThanOrEqual(9);

  // Spot-checks verified by hand against the axios clone.
  await expect(page.locator('.facts-list')).toContainText('2026 was the busiest year, with 386 commits.');
  await expect(page.locator('.facts-list')).toContainText('18 Aug 2014');
  await expect(page.locator('.facts-list')).toContainText('Matt Zabriskie');
  await expect(page.locator('.facts-list')).toContainText('139 days');
  await expect(page.locator('.facts-list')).toContainText('refactor: bump minors package versions');

  await page.screenshot({ path: 'shots/story-night-1440x900.png' });

  // Clicking a card moves the playhead to that commit.
  const before = await page.locator('.now-commit').innerText();
  await page.getByText('It began on 18 Aug 2014').click();
  await page.waitForTimeout(600);
  const after = await page.locator('.now-commit').innerText();
  expect(after).not.toBe(before);
  expect(after).toContain('commit 1 of');

  expect(errors, errors.join(' | ')).toEqual([]);
});

test('hotspots rank files and name single-owner folders', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);
  await page.getByRole('tab', { name: 'Hotspots' }).click();

  const spots = page.locator('.spot');
  await expect(spots.first()).toBeVisible();
  expect(await spots.count()).toBeGreaterThan(4);
  // Every reason states the window and the people, not just a number.
  await expect(spots.first()).toContainText(/changed \d+ times? in \d+ months? by \d+ (person|people)/);
  await expect(page.locator('.owners')).toContainText('bus factor 1');
  await page.screenshot({ path: 'shots/hotspots-night-1440x900.png' });

  // Clicking a hotspot selects that file.
  await spots.first().click();
  await expect(page.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.sel-name')).not.toBeEmpty();
});

test('the selection panel shows authors, commits and a sparkline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);
  await page.getByRole('tab', { name: 'Hotspots' }).click();
  await page.locator('.spot').first().click();

  await expect(page.locator('.sel-name')).toBeVisible();
  await expect(page.locator('.authors .author').first()).toBeVisible();
  await expect(page.locator('.commits .commit-row').first()).toBeVisible();
  await expect(page.locator('canvas.spark')).toBeVisible();
  await expect(page.locator('.panel-body')).toContainText('Estimated from line counts');
  await page.screenshot({ path: 'shots/selection-night-1440x900.png' });

  // A commit row jumps the playhead there.
  const before = await page.locator('.now-commit').innerText();
  await page.locator('.commits .commit-row').first().click();
  await page.waitForTimeout(500);
  expect(await page.locator('.now-commit').innerText()).not.toBe(before);
});

test('search finds a file and dims the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  const before = await page.locator('.map-canvas').first().screenshot();
  await page.keyboard.press('/');
  await expect(page.locator('.search-input')).toBeFocused();
  await page.keyboard.type('adapters/http');
  await expect(page.locator('.search-hit').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.search-hits')).toContainText('http');
  await page.waitForTimeout(500);
  const after = await page.locator('.map-canvas').first().screenshot();
  expect(Buffer.compare(before, after), 'search should dim the map').not.toBe(0);
  await page.screenshot({ path: 'shots/search-night-1440x900.png' });

  // Enter selects the best match; Esc closes without leaving the map dimmed.
  await page.keyboard.press('Enter');
  await expect(page.locator('.search')).toHaveCount(0);
  await expect(page.locator('.sel-name')).toContainText('http');
});

test('search finds a person and analyses their whole history', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  await page.keyboard.press('/');
  await page.keyboard.type('zabriskie');
  await expect(page.locator('.search-person').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.search-people')).toContainText('Matt Zabriskie');
  await page.keyboard.press('Enter');

  // The Person tab opens on them, with the numbers a reader would ask for.
  await expect(page.locator('.search')).toHaveCount(0);
  await expect(page.locator('.person-title')).toContainText('Matt Zabriskie', { timeout: 5000 });
  for (const label of ['Commits', 'Lines added', 'Files touched', 'First commit', 'Latest commit', 'Busiest day']) {
    await expect(page.locator('.person')).toContainText(label, { ignoreCase: true });
  }
  // Dates are shown in the reader's own timezone, so the day may differ by one.
  await expect(page.locator('.rows')).toContainText(/\d+ Aug 2014/);
  await page.screenshot({ path: 'shots/person-night-1440x900.png' });

  // Each commit opens to the files it changed.
  await page.locator('.commit-head').first().click();
  await expect(page.locator('.commit-file').first()).toBeVisible({ timeout: 5000 });

  // Esc closes the profile and hands the panel back to the story.
  await page.keyboard.press('Escape');
  await expect(page.locator('.person')).toHaveCount(0);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('the logo takes you back to the landing page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);
  await page.getByRole('button', { name: /back to the home page/i }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Watch your codebase');
  await expect(page.locator('.map-wrap')).toHaveCount(0);
});

for (const theme of ['night', 'paper'] as const) {
  test(`panels look right in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => localStorage.setItem('atlas.theme', t), theme);
    await loadDemo(page);
    await page.screenshot({ path: `shots/story-${theme}-1440x900.png` });
    await page.getByRole('tab', { name: 'Hotspots' }).click();
    await expect(page.locator('.spot').first()).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/hotspots-${theme}-1440x900.png` });
  });
}
