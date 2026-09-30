import { test, expect } from '../lib/playwright/suite';
import { E2E_WORKFLOW_NAME } from '../lib/playwright/archon-runtime';
import { T } from '../lib/playwright/timeouts';

/**
 * Per-run workflow ENV overlays in the redesigned workflows library.
 *
 * An operator opens a workflow, creates a named overlay from the Environments
 * section, picks it next to the Run button and starts a run. The whole app is
 * real (web UI, API, database); only the AI provider is the env-gated
 * `e2e-fake` provider. The run record must carry the frozen overlay with the
 * resolved model the overlay patched onto the node.
 */
const OVERLAY_NAME = 'e2e-overlay';
const OVERLAY_MODEL = 'e2e-overlay-model';

interface RunListEntry {
  id?: string;
  workflow_name?: string;
}

interface RunDetail {
  run?: {
    status?: string;
    metadata?: {
      envOverlay?: {
        envName?: string;
        resolved?: Record<string, { model?: string }> | { nodeId?: string; model?: string }[];
      };
    };
  };
}

test('[P0] a workflow run started with an ENV overlay records the frozen overlay', async ({
  page,
  archon,
}) => {
  // Overlay preview and editing need a project cwd; register the isolated
  // non-git workdir as a folder project.
  const registered = await archon.starterFetch('/api/codebases', {
    method: 'POST',
    body: JSON.stringify({ path: archon.workdir }),
  });
  expect(registered.ok).toBe(true);
  const codebase = (await registered.json()) as { id: string };

  const listRunIds = async (): Promise<string[]> => {
    const res = await archon.starterFetch('/api/workflows/runs?limit=50');
    const body = (await res.json()) as { runs?: RunListEntry[] };
    return (body.runs ?? [])
      .filter(run => run.workflow_name === E2E_WORKFLOW_NAME && run.id !== undefined)
      .map(run => run.id as string);
  };
  const knownRunIds = new Set(await listRunIds());

  // 1. Open the workflow in the library and choose the project.
  await page.goto('/workflows');
  await page.locator(`button[title="${E2E_WORKFLOW_NAME}"]`).click();
  await page.locator('#workflow-run-project').selectOption(codebase.id);

  // 2. Create a named overlay that patches the model of the workflow's node.
  const environments = page.getByTestId('workflow-envs-section');
  await environments.getByRole('button', { name: 'New environment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('env-editor-name').fill(OVERLAY_NAME);
  await dialog.getByRole('button', { name: 'Node' }).click();
  await dialog.getByTestId('env-node-select').selectOption({ index: 1 });
  await dialog.getByTestId('env-field-model').fill(OVERLAY_MODEL);
  await dialog.getByTestId('env-editor-submit').click();
  await expect(dialog.getByTestId('env-summary-list')).toContainText(OVERLAY_NAME, {
    timeout: T.medium,
  });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(environments.getByTestId('workflow-env-rows')).toContainText(OVERLAY_NAME);

  // 3. Pick the overlay next to Run: the preview shows the patched model.
  await page.locator('#workflow-run-env').selectOption({ label: OVERLAY_NAME });
  await expect(page.getByText(OVERLAY_MODEL).first()).toBeVisible({ timeout: T.medium });

  // 4. Start the run with the overlay.
  await page.locator('#workflow-run-message').fill('run with overlay');
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  // 5. The run record carries the overlay name and the resolved patched model.
  let runId: string | undefined;
  await expect
    .poll(
      async () => {
        runId = (await listRunIds()).find(id => !knownRunIds.has(id));
        return runId;
      },
      { timeout: T.long }
    )
    .toBeDefined();
  if (runId === undefined) throw new Error('run id was not observed');
  await archon.waitForRunStatus(runId, 'completed', T.xlong);

  const detailRes = await archon.starterFetch(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  const detail = (await detailRes.json()) as RunDetail;
  const overlay = detail.run?.metadata?.envOverlay;
  expect(overlay?.envName).toBe(OVERLAY_NAME);
  expect(JSON.stringify(overlay?.resolved ?? null)).toContain(OVERLAY_MODEL);
});

test('[P1] deleting an ENV overlay from the manage dialog removes it after inline confirmation', async ({
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
  await page.locator(`button[title="${E2E_WORKFLOW_NAME}"]`).click();
  await page.locator('#workflow-run-project').selectOption(codebase.id);

  const environments = page.getByTestId('workflow-envs-section');
  await environments.getByRole('button', { name: 'New environment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('env-editor-name').fill('to-delete');
  await dialog.getByTestId('env-editor-submit').click();
  await expect(dialog.getByTestId('env-summary-list')).toContainText('to-delete', {
    timeout: T.medium,
  });

  await dialog.getByRole('button', { name: 'Delete to-delete' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByTestId('env-summary-list')).not.toContainText('to-delete', {
    timeout: T.medium,
  });
});
