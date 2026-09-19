import { requestJson } from '../lib/http';
import { toRun, type Run } from '../primitives/run';
import { toRunEvent, type RunEvent } from '../primitives/event';
import type { RunStatus } from '../lib/run-status';
import { toSteeringRequestError } from '@/lib/steering-dock';
import type { components } from '@/lib/api.generated';

export interface ListRunsOptions {
  codebaseId?: string;
  status?: RunStatus;
  limit?: number;
}

export interface RunCounts {
  all: number;
  running: number;
  paused: number;
  failed: number;
  completed: number;
  cancelled: number;
  pending: number;
}

interface DashboardRunsResponse {
  runs: Parameters<typeof toRun>[0][];
  total: number;
  counts: Partial<RunCounts>;
}

function normalizeCounts(c: Partial<RunCounts>): RunCounts {
  return {
    all: c.all ?? 0,
    running: c.running ?? 0,
    paused: c.paused ?? 0,
    failed: c.failed ?? 0,
    completed: c.completed ?? 0,
    cancelled: c.cancelled ?? 0,
    pending: c.pending ?? 0,
  };
}

export async function listRuns(
  opts: ListRunsOptions = {}
): Promise<{ runs: Run[]; counts: RunCounts; total: number }> {
  const qs = new URLSearchParams();
  if (opts.codebaseId !== undefined) qs.set('codebaseId', opts.codebaseId);
  if (opts.status !== undefined) qs.set('status', opts.status);
  if (opts.limit !== undefined) qs.set('limit', opts.limit.toString());
  const url = `/api/dashboard/runs${qs.size > 0 ? `?${qs.toString()}` : ''}`;
  const res = await requestJson<DashboardRunsResponse>(url);
  return {
    runs: res.runs.map(toRun),
    counts: normalizeCounts(res.counts),
    total: res.total,
  };
}

export async function listGlobalCounts(): Promise<RunCounts> {
  // Counts without any codebase filter — used by top chrome pill.
  const res = await requestJson<DashboardRunsResponse>('/api/dashboard/runs?limit=1');
  return normalizeCounts(res.counts);
}

/** GET /api/workflows/runs/:id — retains generated `usage` (nullable report). */
export type RunDetailResponse = components['schemas']['WorkflowRunDetail'];
export type WorkflowEvent = components['schemas']['WorkflowEvent'];
export type WorkflowNodeState = components['schemas']['WorkflowNodeState'];
export type WorkflowNodeMessage = components['schemas']['WorkflowNodeMessage'];
export type WorkflowNodeMessagesResponse = components['schemas']['WorkflowNodeMessagesResponse'];
export type NodeExecution = components['schemas']['NodeExecution'];

export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];

export interface ConsoleRunDetail {
  run: Run;
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  approval: unknown;
  usage: RunDetailResponse['usage'];
  pendingInteractions: PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  runError: string | null;
  nodeExecutions?: NodeExecution[];
  parentPlatformId: string | null;
}

export async function getRun(id: string): Promise<ConsoleRunDetail> {
  const res = await requestJson<RunDetailResponse>(`/api/workflows/runs/${encodeURIComponent(id)}`);
  const approval = res.run.metadata.approval ?? null;
  const metadataError = res.run.metadata.error;
  return {
    run: toRun(res.run),
    events: res.events.map(toRunEvent),
    rawEvents: res.events,
    nodeStates: res.nodeStates,
    approval,
    usage: res.usage,
    parentPlatformId: res.run.parent_platform_id ?? null,
    pendingInteractions: res.pending_interactions ?? [],
    // OpenAPI types this as boolean; === true still maps missing runtime values to false.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- US-001 locked mapping
    viewerIsStarter: res.viewer_is_starter === true,
    starterDisplayName: res.starter_display_name,
    runError: typeof metadataError === 'string' ? metadataError : null,
    nodeExecutions: res.nodeExecutions,
  };
}

export async function getNodeMessages(
  runId: string,
  nodeId: string,
  options?: {
    afterSeq?: number;
    limit?: number;
    occurrenceId?: string;
    attemptId?: string;
    signal?: AbortSignal;
  }
): Promise<WorkflowNodeMessagesResponse> {
  const { signal, ...queryFields } = options ?? {};
  const qs = new URLSearchParams();
  if (queryFields.afterSeq !== undefined) qs.set('afterSeq', String(queryFields.afterSeq));
  if (queryFields.limit !== undefined) qs.set('limit', String(queryFields.limit));
  if (queryFields.occurrenceId !== undefined) qs.set('occurrenceId', queryFields.occurrenceId);
  if (queryFields.attemptId !== undefined) qs.set('attemptId', queryFields.attemptId);
  const query = qs.size > 0 ? `?${qs.toString()}` : '';
  return requestJson<WorkflowNodeMessagesResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/messages${query}`,
    signal === undefined ? undefined : { signal }
  );
}

export const listNodeMessages = getNodeMessages;

export async function getNodeMessage(
  runId: string,
  nodeId: string,
  messageId: string,
  options?: { signal?: AbortSignal }
): Promise<WorkflowNodeMessage> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages/' +
    encodeURIComponent(messageId);
  return requestJson<WorkflowNodeMessage>(
    url,
    options?.signal === undefined ? undefined : { signal: options.signal }
  );
}

export type SendWorkflowNodeBody = components['schemas']['SendWorkflowNodeBody'];
export type SendWorkflowNodeResponse = components['schemas']['SendWorkflowNodeResponse'];

/**
 * POST /api/workflows/runs/:runId/nodes/:nodeId/send — Story 2.1 queue send.
 * Refusals surface as SteeringRequestError carrying the nested {code,message}
 * so the dock can distinguish a canonical 422 `not_steerable_here` from other
 * failures. No auto-retry and no message logging — the caller owns
 * `message_id` reuse for ambiguous failures.
 */
export async function sendNodeGuidance(
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
): Promise<SendWorkflowNodeResponse> {
  try {
    return await requestJson<SendWorkflowNodeResponse>(
      `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  } catch (error) {
    throw toSteeringRequestError(error);
  }
}

export type InterruptWorkflowNodeResponse = components['schemas']['InterruptWorkflowNodeResponse'];

/**
 * POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt — Story 2.3 turn
 * interrupt. The awaited response is the ACTUAL settled sub-state —
 * `idle-after-interrupt` or `generating` — and terminal refusals surface as
 * SteeringRequestError (409 `node_finished`, 422 `not_steerable_here`).
 */
export async function interruptNode(
  runId: string,
  nodeId: string
): Promise<InterruptWorkflowNodeResponse> {
  try {
    return await requestJson<InterruptWorkflowNodeResponse>(
      `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/interrupt`,
      { method: 'POST' }
    );
  } catch (error) {
    throw toSteeringRequestError(error);
  }
}

export async function cancelRun(id: string): Promise<void> {
  await requestJson(`/api/workflows/runs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function approveRun(id: string, comment?: string): Promise<void> {
  await requestJson(`/api/workflows/runs/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify(comment !== undefined ? { comment } : {}),
  });
}

export async function rejectRun(id: string, reason: string): Promise<void> {
  await requestJson(`/api/workflows/runs/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function resumeRun(id: string): Promise<void> {
  await requestJson(`/api/workflows/runs/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function abandonRun(id: string): Promise<void> {
  await requestJson(`/api/workflows/runs/${encodeURIComponent(id)}/abandon`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse> {
  return requestJson<WorkflowRunActionResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

export type ReviewFeedbackRequest = components['schemas']['ReviewFeedbackBody'];
export type ReviewFeedbackResponse = components['schemas']['ReviewFeedbackResponse'];

export async function submitRunReviewFeedback(
  runId: string,
  body: ReviewFeedbackRequest
): Promise<ReviewFeedbackResponse> {
  return requestJson<ReviewFeedbackResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/review-feedback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

/**
 * Re-exported from the generated OpenAPI types so the console doesn't drift
 * from the server contract. Schema lives in
 * packages/server/src/routes/schemas/workflow.schemas.ts.
 */
export type ArtifactFile = components['schemas']['ArtifactFile'];
type ListArtifactsResponse = components['schemas']['ListArtifactsResponse'];

export async function listRunArtifacts(runId: string): Promise<ArtifactFile[]> {
  const res = await requestJson<ListArtifactsResponse>(
    `/api/runs/${encodeURIComponent(runId)}/artifacts`
  );
  return res.files;
}

/** Fetch a single artifact file as text (markdown or plain). */
export async function fetchArtifact(runId: string, path: string): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`/api/artifacts/${encodeURIComponent(runId)}/${encodedPath}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to fetch artifact: ${res.status.toString()}`);
  }
  return res.text();
}
