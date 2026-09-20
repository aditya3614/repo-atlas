import { test, expect, type Page } from '@playwright/test';

const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x700', width: 1024, height: 700 },
] as const;

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.crumbs')).toBeVisible();
  await page.waitForTimeout(600);
}

/** Pointer at the centre of the map, which always lands on a cell. */
async function hoverMap(page: Page, fx = 0.5, fy = 0.5) {
  const box = (await page.locator('.map-wrap').boundingBox())!;
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  return box;
}

test('the map draws, hovers, selects and drills down', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  // Hover: a tooltip with a real path and an estimate that says it is one.
  await hoverMap(page);
  await expect(page.locator('.tip')).toBeVisible();
  await expect(page.locator('.tip-foot')).toContainText('estimated');
  const hoveredPath = await page.locator('.tip-path').innerText();
  expect(hoveredPath.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'shots/map-hover-night-1440x900.png' });

  // Click: the Selection tab opens with that file.
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByRole('tab', { name: 'Selection' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.sel-name')).toHaveText(hoveredPath.split('/').pop()!);

  // Drill down through the selected file's folder, then back out with Esc.
  const crumbCount = await page.locator('.sel-crumb').count();
  if (crumbCount > 0) {
    const folder = await page.locator('.sel-crumb').first().innerText();
    await page.locator('.sel-crumb').first().click();
    await expect(page.locator('.crumbs')).toContainText(folder);
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'shots/map-drilled-night-1440x900.png' });

    // Esc clears the selection first, and only then zooms back out.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Selection' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await expect(page.locator('.crumbs .crumb').first()).toHaveAttribute('aria-current', 'page');
  }

  expect(errors, errors.join(' | ')).toEqual([]);
});

test('colour modes switch by keyboard and each has a legend', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page);

  for (const [key, name, legend] of [
    ['2', 'Author', 'added the most lines'],
    ['3', 'Age', 'first appeared'],
    ['4', 'Churn', 'added plus deleted'],
    ['5', 'Type', 'extension'],
    ['1', 'Activity', 'decays'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.legend-hint')).toContainText(legend);
    await page.waitForTimeout(220);
    await page.screenshot({ path: `shots/map-mode-${name.toLowerCase()}-1440x900.png` });
  }
});

for (const size of SIZES) {
  for (const theme of ['night', 'paper'] as const) {
    test(`map ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.addInitScript((t) => localStorage.setItem('atlas.theme', t), theme);
      await loadDemo(page);
      await page.screenshot({ path: `shots/map-${theme}-${size.name}.png` });
    });
  }
}

test('the map is crisp on a retina display', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await loadDemo(page);
  const px = await page.evaluate(() => {
    const c = document.querySelector('.map-canvas') as HTMLCanvasElement;
    return { css: c.clientWidth, backing: c.width };
  });
  expect(px.backing).toBe(px.css * 2);
  await page.screenshot({ path: 'shots/map-retina-1440x900.png' });
  await ctx.close();
});
