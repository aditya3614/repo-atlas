import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SYNTH = resolve('.cache/synthetic.txt');

test.beforeAll(() => {
  if (!existsSync(SYNTH)) {
    mkdirSync('.cache', { recursive: true });
    execFileSync('node', ['scripts/make-synthetic.mjs', '--commits=100000', '--files=20000', SYNTH], {
      stdio: 'inherit',
    });
  }
});

/** Inter-frame gaps while the page is animating, in milliseconds. */
async function recordFrames(page: Page, ms: number): Promise<void> {
  await page.evaluate((duration) => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    let last = performance.now();
    const stop = last + duration;
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (t < stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function frameStats(page: Page) {
  return page.evaluate(() => {
    const f = (window as unknown as { __frames: number[] }).__frames.slice(1);
    f.sort((a, b) => a - b);
    const at = (q: number) => f[Math.min(f.length - 1, Math.floor(f.length * q))] ?? 0;
    return { n: f.length, median: at(0.5), p95: at(0.95), worst: f[f.length - 1] ?? 0 };
  });
}

test('a 20k-file map renders and interacts inside the frame budget', async ({ page }) => {
  test.setTimeout(180_000);
  // dpr is 1 in headless, so this measures the pixel count of a 1440x900
  // display; the retina case is measured separately below.
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.setInputFiles('#atlas-file', SYNTH);

  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.map-wrap')).not.toHaveAttribute('data-layout-ms', '', {
    timeout: 60_000,
  });

  const cells = Number(await page.locator('.map-wrap').getAttribute('data-cells'));
  const layoutMs = Number(await page.locator('.map-wrap').getAttribute('data-layout-ms'));
  expect(cells, 'the synthetic history should fill the map').toBeGreaterThan(15_000);

  await page.screenshot({ path: 'shots/map-synthetic-1440x900.png' });

  // Drag the pointer across the map while sampling frames. Every move
  // invalidates the overlay, so this exercises hit testing plus a redraw.
  const box = (await page.locator('.map-wrap').boundingBox())!;
  await recordFrames(page, 2600);
  for (let i = 0; i < 90; i++) {
    const x = box.x + 20 + ((i * 37) % (box.width - 40));
    const y = box.y + 20 + ((i * 53) % (box.height - 40));
    await page.mouse.move(x, y);
  }
  await page.waitForTimeout(600);
  const hover = await frameStats(page);

  // Mode switches force a full base redraw of every cell.
  await recordFrames(page, 2600);
  for (const key of ['2', '3', '4', '5', '1', '2', '3', '4', '5', '1']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  const modes = await frameStats(page);

  console.log(
    `map: ${cells.toLocaleString()} cells | worker layout ${layoutMs}ms | ` +
      `hover frames median ${hover.median.toFixed(1)}ms p95 ${hover.p95.toFixed(1)}ms worst ${hover.worst.toFixed(1)}ms | ` +
      `mode-switch frames median ${modes.median.toFixed(1)}ms p95 ${modes.p95.toFixed(1)}ms worst ${modes.worst.toFixed(1)}ms`,
  );

  // 60fps is a 16.7ms budget; allow one slow frame at the tail.
  expect(hover.p95, 'hover must hold 60fps').toBeLessThan(17);
  expect(modes.p95, 'redrawing every cell must hold 60fps').toBeLessThan(17);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('the 20k-file map holds up at retina pixel density', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto('/');
  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.setInputFiles('#atlas-file', SYNTH);
  await expect(page.locator('.map-wrap')).not.toHaveAttribute('data-layout-ms', '', {
    timeout: 60_000,
  });

  const box = (await page.locator('.map-wrap').boundingBox())!;
  await recordFrames(page, 2600);
  for (let i = 0; i < 90; i++) {
    await page.mouse.move(
      box.x + 20 + ((i * 37) % (box.width - 40)),
      box.y + 20 + ((i * 53) % (box.height - 40)),
    );
  }
  for (const key of ['2', '3', '4', '5', '1']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(400);
  const stats = await frameStats(page);
  console.log(
    `retina (4x pixels): median ${stats.median.toFixed(1)}ms p95 ${stats.p95.toFixed(1)}ms ` +
      `worst ${stats.worst.toFixed(1)}ms over ${stats.n} frames`,
  );
  expect(stats.p95).toBeLessThan(17);
  await ctx.close();
});

test('playback and scrubbing hold 60fps on the synthetic history', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.setInputFiles('#atlas-file', SYNTH);
  await expect(page.locator('.stream-canvas')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/dock-synthetic-1440x900.png' });

  // --- playback, from the start, at 4x: the heaviest case ---
  await page.keyboard.press('Home');
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await page.waitForTimeout(400);
  await recordFrames(page, 6000);
  await page.keyboard.press('Space');
  await page.waitForTimeout(6200);
  const play = await frameStats(page);
  const advanced = await page.locator('.now-commit').innerText();
  await page.keyboard.press('Space');

  // --- scrubbing: drag the playhead across the whole timeline ---
  const box = (await page.locator('.stream-canvas').boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await recordFrames(page, 3000);
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(box.x + (box.width * i) / 60, box.y + box.height / 2);
  }
  await page.waitForTimeout(500);
  const scrub = await frameStats(page);
  await page.mouse.up();

  console.log(
    `playback 4x: median ${play.median.toFixed(1)}ms p95 ${play.p95.toFixed(1)}ms ` +
      `worst ${play.worst.toFixed(1)}ms (${advanced.trim()})\n` +
      `scrub: median ${scrub.median.toFixed(1)}ms p95 ${scrub.p95.toFixed(1)}ms ` +
      `worst ${scrub.worst.toFixed(1)}ms`,
  );

  expect(play.p95, 'playback must hold 60fps').toBeLessThan(17);
  expect(scrub.p95, 'scrubbing must hold 60fps').toBeLessThan(17);
  expect(errors, errors.join(' | ')).toEqual([]);
});
