import { test, expect } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

// The "All" filter's "No runs yet." empty state only renders on the global
// "All projects" overview (RunsPage: draftProject is non-null for every
// project-scoped URL, which always routes to a "Start a new run" card
// instead — there is no project-scoped route that reaches this copy). That
// overview aggregates every run on the server with no project filter, so
// this assertion depends on the server having recorded zero runs anywhere —
// a genuine invariant only when this file owns its worker exclusively.
// Every spec file that omits `idleAwaitMs` shares one worker (and one
// Archon server + SQLite database) for the whole `bun run test:ui`
// invocation; asserting "no runs yet" against that shared history is
// order-dependent, not a property of this UI. Request a dedicated worker by
// giving `idleAwaitMs` a value distinct from every other file's default
// (`undefined`) — Playwright provisions a new worker (fresh server, fresh
// empty database) whenever a worker-scoped fixture's requested value
// changes between files. The production steering idle-await default
// (`STEERING_IDLE_AWAIT_INACTIVITY_MS`, packages/workflows/src/steering-registry.ts)
// keeps this file's own runtime behavior identical to every other file's
// effective default; this file never exercises idle-await behavior at all,
// so only the worker-identity side effect matters here.
test.use({ idleAwaitMs: 30 * 60_000 });

test('[P1] [V:console.shell] Console project rail and empty run filters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/console');
  await expect(page).toHaveURL(/\/console\/?$/);
  const rail = page.getByRole('navigation', { name: 'Projects' });
  await expect(rail).toBeVisible({ timeout: T.medium });
  await expect(rail.getByText('Archon', { exact: true })).toBeVisible();
  await expect(rail.getByText('console', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All projects', level: 1 })).toBeVisible();
  await expect(page.getByText('Every run, across every project.')).toBeVisible();
  await expect(page.getByText('Pick a project on the left to start a run.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All projects', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing running right now.')).toBeVisible();
  await page.getByRole('button', { name: /^All \d+$/ }).click();
  await expect(page.getByText('No runs yet.')).toBeVisible();
});

test('[P1] [V:console.settings] Console Settings navigation and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/console');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/settings\/?$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();
});
