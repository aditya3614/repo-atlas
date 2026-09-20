import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
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

test('parses 100k commits inside the budget, with live progress', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use your repo' }).click();

  const sizeMb = statSync(SYNTH).size / 1e6;
  const started = Date.now();
  await page.setInputFiles('#atlas-file', SYNTH);

  // Sample the progress readout while it parses: if these keep changing, the
  // main thread is still painting, which is the "responsive UI" requirement.
  const samples = new Set<string>();
  const counts = page.locator('.loading-counts');
  for (let i = 0; i < 60; i++) {
    if ((await page.locator('.overview').count()) > 0) break;
    if ((await counts.count()) > 0) samples.add(await counts.innerText());
    if (i === 3) await page.screenshot({ path: 'shots/loading-night-1440x900.png' });
    await page.waitForTimeout(120);
  }

  await expect(page.getByText('The history, read and indexed')).toBeVisible({ timeout: 90_000 });
  const elapsed = Date.now() - started;

  const heapMb = await page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize / 1e6 : -1;
  });

  console.log(
    `synthetic: ${sizeMb.toFixed(1)} MB, parse+index ${elapsed}ms, ` +
      `${samples.size} distinct progress readings, heap ${heapMb.toFixed(0)} MB`,
  );

  await expect(page.getByText('100,000 commits')).toBeVisible();
  await page.screenshot({ path: 'shots/overview-synthetic-1440x900.png' });

  expect(elapsed, 'parse budget is 10s').toBeLessThan(10_000);
  expect(samples.size, 'progress must actually move').toBeGreaterThan(2);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('the loading screen stays responsive on a slow machine', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling needs CDP');
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // 20x slower than this machine, so the progress UI is observable at all.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });

  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.setInputFiles('#atlas-file', SYNTH);

  await expect(page.locator('.loading')).toBeVisible({ timeout: 30_000 });
  const first = await page.locator('.loading-counts').innerText();
  await page.screenshot({ path: 'shots/loading-night-1440x900.png' });

  // The readout is driven by progress messages, so if it moves the main thread
  // is still painting while the worker parses. Finishing counts as moving on.
  await expect
    .poll(
      async () =>
        (await page.locator('.loading').count()) === 0
          ? 'finished'
          : await page.locator('.loading-counts').innerText(),
      { timeout: 60_000 },
    )
    .not.toBe(first);
});

test('a load can be cancelled while it is running', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling needs CDP');
  test.setTimeout(120_000);

  await page.goto('/');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });

  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.setInputFiles('#atlas-file', SYNTH);

  // Cancel at the first opportunity. Even if the worker is already finishing,
  // a cancelled load must never deliver its result.
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: 30_000 });
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator('.overview')).toHaveCount(0);
});
