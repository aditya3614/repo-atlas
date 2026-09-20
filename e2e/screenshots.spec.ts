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
      await page.waitForTimeout(600);
      await page.screenshot({ path: `shots/landing-${theme}-${size.name}.png` });

      await page.getByRole('button', { name: 'Use your repo' }).click();
      await page.waitForTimeout(600);
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

test('no network requests after load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Principle 1 allows self-hosted font files and nothing else.
  const origin = new URL(page.url()).origin;
  const late: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    const sameOriginFont = url.startsWith(origin) && /\.woff2?(\?|$)/.test(url);
    if (!sameOriginFont) late.push(url);
  });
  await page.getByRole('button', { name: 'Use your repo' }).click();
  await page.getByRole('button', { name: 'Copy' }).click();
  await page.waitForTimeout(1500);

  expect(late, `unexpected requests: ${late.join(', ')}`).toEqual([]);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
