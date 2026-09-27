import type { Context } from 'hono';

import { listWorkflowNodeExecutionEvidenceForRun } from '@archon/core/db/workflow-node-execution-evidence';
import { diffCommitRange, isCommitAncestorOfHead } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { FilesChangedResponse } from '../schemas/files-changed.schemas';
import { computeFileAttribution, selectRunBaselineCommit } from './execution-attribution';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

export async function handleFilesChanged(
  c: Context,
  apiError: (c: Context, status: 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.files_changed_started');

  try {
    const gate = await loadRunCheckout(runId);

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.files_changed_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      const body: FilesChangedResponse = { emptyReason: gate.emptyReason, files: [] };
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.files_changed_completed');
      return c.json(body);
    }

    const evidence = await listWorkflowNodeExecutionEvidenceForRun(runId);
    const isAncestorOfHead = (commitSha: string): Promise<boolean> =>
      isCommitAncestorOfHead(gate.workingPath, commitSha);
    const baseline = await selectRunBaselineCommit(evidence, isAncestorOfHead);
    if (baseline === undefined) {
      // No node execution ever proved a checkout snapshot for this run — there
      // is nothing to compare against, so there is nothing provably changed.
      const body: FilesChangedResponse = { files: [] };
      getLog().info({ runId, fileCount: 0 }, 'git.files_changed_completed');
      return c.json(body);
    }

    const files = await diffCommitRange(gate.workingPath, baseline, 'HEAD');
    const attributed = await computeFileAttribution({
      files,
      evidence,
      diffCommitRange: (from, to) => diffCommitRange(gate.workingPath, from, to),
      isAncestorOfHead,
    });

    const body: FilesChangedResponse = { files: attributed };
    getLog().info({ runId, fileCount: attributed.length }, 'git.files_changed_completed');
    return c.json(body);
  } catch (error) {
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.files_changed_failed'
    );
    return apiError(c, 500, 'Could not read changed files');
  }
}
