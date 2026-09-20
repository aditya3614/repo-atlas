import { test, expect } from '@playwright/test';

test('demo loads to the main view and reports honest numbers', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const clicked = Date.now();
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.locator('.map-wrap')).toBeVisible({ timeout: 15_000 });
  const elapsed = Date.now() - clicked;

  await expect(page.getByText('1,987 commits')).toBeVisible();
  await expect(page.locator('.repo-name')).toHaveText('axios');
  await page.screenshot({ path: 'shots/main-night-1440x900.png' });

  expect(errors, errors.join(' | ')).toEqual([]);
  // Section 10's budget: click to first map, under two seconds.
  console.log(`demo click -> first map: ${elapsed}ms`);
  expect(elapsed).toBeLessThan(2000);
});
