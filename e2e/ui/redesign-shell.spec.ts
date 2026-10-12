import { test, expect } from '../lib/playwright/suite';
import { HITL_INSPECT_NODE } from '../lib/playwright/archon-runtime';
import { T } from '../lib/playwright/timeouts';

test('[P1] [V:shell.redesign-nav] Top bar names every screen and each screen renders its heading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/runs(?:\/|\?|$)/, { timeout: T.medium });
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Runs', 'Workflows', 'Chat', 'Builder', 'Settings']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }

  const screens = [
    { link: 'Runs', heading: 'Runs' },
    { link: 'Workflows', heading: 'Workflows' },
    { link: 'Chat', heading: 'Chat' },
    { link: 'Builder', heading: 'Builder' },
    { link: 'Settings', heading: 'Settings' },
  ] as const;
  for (const screen of screens) {
    await nav.getByRole('link', { name: screen.link, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: screen.heading, level: 1, exact: true })
    ).toBeVisible({
      timeout: T.medium,
    });
    await expect(nav.getByRole('link', { name: screen.link, exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
  }
});

test('[P1] [V:shell.redesign-project-filter] Project filter persists across a reload', async ({
  page,
  archon,
}) => {
  const registered = await archon.starterFetch('/api/codebases', {
    method: 'POST',
    body: JSON.stringify({ path: archon.workdir }),
  });
  expect(registered.ok).toBe(true);
  const codebase = (await registered.json()) as { id: string };

  await page.goto('/workflows');
  const filter = page.getByRole('banner').locator('select');
  await filter.selectOption(codebase.id);
  await page.reload();
  await expect(page.getByRole('banner').locator('select')).toHaveValue(codebase.id, {
    timeout: T.medium,
  });

  await filter.selectOption('');
  await page.reload();
  await expect(page.getByRole('banner').locator('select')).toHaveValue('');
});

test('[P1] [V:shell.redesign-redirects] Old links and the Needs you button open the Runs workspace', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/runs(?:\/|\?|$)/, { timeout: T.medium });

  await page.goto(`/workflows/runs/${started.runId}?node=${HITL_INSPECT_NODE}`);
  await expect(page).toHaveURL(new RegExp(`/runs/${started.runId}/${HITL_INSPECT_NODE}(?:\\?|$)`), {
    timeout: T.medium,
  });
  await expect(page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` })).toBeVisible({
    timeout: T.medium,
  });

  // The fixture run waits on an Ask, so Needs you counts it.
  const needsYou = page.getByRole('button', { name: /needs? you/ });
  await expect(needsYou).toHaveAttribute('data-waiting', 'true', { timeout: T.medium });
  await needsYou.click();
  await expect(page).toHaveURL(/filter=needs/, { timeout: T.medium });
  await expect(page.getByRole('tab', { name: /^Needs you/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});

test('[P1] [V:shell.redesign-theme] Theme control switches the page to dark and back', async ({
  page,
}) => {
  await page.goto('/runs');
  const theme = page.getByRole('button', { name: /^Theme:/ });
  const html = page.locator('html');
  for (let step = 0; step < 3; step += 1) {
    const label = (await theme.getAttribute('aria-label')) ?? '';
    if (label === 'Theme: light') break;
    await theme.click();
  }
  await expect(theme).toHaveAttribute('aria-label', 'Theme: light');
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await theme.click();
  await expect(theme).toHaveAttribute('aria-label', 'Theme: dark');
  await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
});
