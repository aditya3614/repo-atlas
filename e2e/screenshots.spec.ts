import { test, expect } from '@playwright/test';

const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x700', width: 1024, height: 700 },
] as const;
const THEMES = ['night', 'paper'] as const;

for (const theme of THEMES) {
  for (const size of SIZES) {
    test(`landing ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.addInitScript((t) => localStorage.setItem('atlas.theme', t), theme);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The landing animates in on a stagger: the headline, then the panel,
      // then the columns rise one after another. Wait for it to settle, or
      // every screenshot catches the page half-built.
      await page.waitForTimeout(3600);
      await page.screenshot({ path: `shots/landing-${theme}-${size.name}.png` });

      await page.getByRole('button', { name: 'Use your repo' }).click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `shots/steps-${theme}-${size.name}.png` });
    });
  }
}

test('error state renders with a line number', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.setInputFiles('#atlas-file', {
    name: 'wrong.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('commit 9f2c\nAuthor: Ada\n'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/error-night-1440x900.png' });
});

test('nothing is sent anywhere after load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const origin = new URL(page.url()).origin;
  const offsite: string[] = [];
  const local: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(origin)) local.push(new URL(url).pathname);
    else offsite.push(url);
    // Nothing may ever leave the tab, whatever the origin.
    expect(['GET'], `${r.method()} ${url}`).toContain(r.method());
  });

  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.getByRole('button', { name: 'Copy' }).click();
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1000);

  // Third-party requests are forbidden outright. Same-origin requests are
  // allowed only for the app's own static files: fonts, chunks, demo data.
  expect(offsite, `third-party requests: ${offsite.join(', ')}`).toEqual([]);
  const unexpected = local.filter((p) => !/\.(woff2?|js|css|txt)$/.test(p));
  expect(unexpected, `unexpected same-origin requests: ${unexpected.join(', ')}`).toEqual([]);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

for (const theme of THEMES) {
  for (const size of SIZES) {
    test(`main view ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.addInitScript((t) => localStorage.setItem('atlas.theme', t), theme);
      await page.goto('/');
      await page.getByRole('button', { name: 'Try the demo' }).click();
      await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `shots/main-${theme}-${size.name}.png` });
    });
  }
}

test('reduced motion: the globe holds still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const shot = () => page.locator('canvas.globe').screenshot();
  const a = await shot();
  await page.waitForTimeout(1200);
  const b = await shot();
  expect(Buffer.compare(a, b), 'the globe moved under prefers-reduced-motion').toBe(0);

  await page.screenshot({ path: 'shots/landing-night-reduced-1440x900.png' });
});
