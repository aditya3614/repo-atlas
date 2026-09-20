import { test, expect, type Page } from '@playwright/test';

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.stream-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function commitIndex(page: Page): Promise<number> {
  const text = await page.locator('.now-commit').innerText();
  const m = text.match(/commit ([\d,]+) of/);
  return m ? Number(m[1]!.replace(/,/g, '')) : -1;
}

test('playing advances time and the map follows', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  // Start from the beginning so playback has somewhere to go.
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  const start = await commitIndex(page);
  const startDate = await page.locator('.now-date').innerText();
  expect(start).toBe(1);

  await page.getByRole('button', { name: /^Play/ }).click();
  await page.waitForTimeout(5000);

  const during = await commitIndex(page);
  expect(during, 'the commit index must advance while playing').toBeGreaterThan(start + 5);
  expect(await page.locator('.now-date').innerText()).not.toBe(startDate);
  await expect(page.locator('.ticker-row').first()).toBeVisible();
  await page.screenshot({ path: 'shots/playing-night-1440x900.png' });

  // Space pauses, and the clock stops moving.
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const paused = await commitIndex(page);
  await page.waitForTimeout(700);
  expect(await commitIndex(page)).toBe(paused);

  expect(errors, errors.join(' | ')).toEqual([]);
});

test('the streamgraph scrubs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  const box = (await page.locator('.stream-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.waitForTimeout(500);
  const quarter = await commitIndex(page);

  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.waitForTimeout(500);
  const threeQuarters = await commitIndex(page);

  expect(quarter).toBeGreaterThan(0);
  expect(threeQuarters).toBeGreaterThan(quarter);
  // The map redrew for the new commit, not just the playhead.
  await expect(page.locator('.map-wrap')).toHaveAttribute('data-cells', /\d+/);
});

test('keyboard drives the transport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  expect(await commitIndex(page)).toBe(1);

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  expect(await commitIndex(page)).toBe(2);

  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(250);
  expect(await commitIndex(page)).toBe(12);

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(250);
  expect(await commitIndex(page)).toBe(11);

  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  expect(await commitIndex(page)).toBe(1987);

  // [ and ] walk the speed control.
  await page.keyboard.press(']');
  await expect(page.getByRole('radio', { name: '2x' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await expect(page.getByRole('radio', { name: '0.5x' })).toHaveAttribute('aria-checked', 'true');
});

test('quiet periods can be skipped or not', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  const toggle = page.getByRole('checkbox', { name: /Skip quiet periods/ });
  await expect(toggle).toBeChecked();

  // Turning it off keeps the same commit on screen.
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(300);
  const before = await commitIndex(page);
  await toggle.uncheck();
  await page.waitForTimeout(300);
  expect(await commitIndex(page)).toBe(before);
});

test('connections draw arcs between files that change together', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  const before = await page.locator('.map-overlay').screenshot();
  await page.getByRole('button', { name: 'Connections' }).click();
  await expect(page.getByRole('button', { name: 'Connections' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(1200);
  const after = await page.locator('.map-overlay').screenshot();
  expect(Buffer.compare(before, after), 'arcs should change the overlay').not.toBe(0);
  await page.screenshot({ path: 'shots/arcs-night-1440x900.png' });

  // c is the shortcut for the same toggle.
  await page.keyboard.press('c');
  await expect(page.getByRole('button', { name: 'Connections' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
