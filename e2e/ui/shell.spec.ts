import { test, expect } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

test.use({ idleAwaitMs: 30 * 60_000 });

test('[P1] [V:shell.navigation] Sidebar navigation reaches every main page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat\/?$/, { timeout: T.medium });
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible({ timeout: T.medium });

  await nav.getByRole('link', { name: /^Dashboard/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

  await nav.getByRole('link', { name: /^Workflows/ }).click();
  await expect(page).toHaveURL(/\/workflows\/?$/);

  await nav.getByRole('link', { name: /^Chat/ }).click();
  await expect(page).toHaveURL(/\/chat\/?$/);
});

test('[P1] [V:shell.settings] Settings sections and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Settings/ })
    .click();
  await expect(page).toHaveURL(/\/settings\/?$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  // AI providers and GitHub need a web identity and are hidden without one, so
  // they are not asserted on this identity-free install.
  await expect(sections.getByRole('button', { name: 'Projects' })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Model tiers' })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Usage and cost' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});
