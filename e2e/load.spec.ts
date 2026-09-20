import { test, expect } from '@playwright/test';

test('demo loads to the overview and reports honest numbers', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const clicked = Date.now();
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('The history, read and indexed')).toBeVisible({ timeout: 15_000 });
  const elapsed = Date.now() - clicked;

  await expect(page.getByText('1,987 commits')).toBeVisible();
  await expect(page.getByText('axios', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'shots/overview-night-1440x900.png' });

  expect(errors, errors.join(' | ')).toEqual([]);
  // The budget is 2s from click to first map; the overview stands in for it here.
  console.log(`demo click -> overview: ${elapsed}ms`);
  expect(elapsed).toBeLessThan(2000);
});
