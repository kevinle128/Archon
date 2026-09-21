/**
 * API client functions for the Archon Web UI.
 * Uses relative URLs - Vite proxy handles routing in dev.
 * SSE streams bypass the proxy in dev mode (Vite proxy buffers SSE responses).
 */
import type { WorkflowRunStatus } from '@/lib/types';
import type { components } from '@/lib/api.generated';
import { STEERING_INTERRUPT_FAILED_MESSAGE, toSteeringRequestError } from '@/lib/steering-dock';

export type WorkflowDefinition = components['schemas']['WorkflowDefinition'];
type GeneratedDagNode = components['schemas']['DagNode'];

export const ROUTE_LOOP_OUTCOMES = ['positive', 'negative', 'exhausted'] as const;

export type RouteLoopOutcome = (typeof ROUTE_LOOP_OUTCOMES)[number];
export type RouteLoopRoutes = Record<RouteLoopOutcome, string>;

export interface RouteLoopConfig {
  condition: string;
  max_iterations: number;
  routes: RouteLoopRoutes;
}

export type RouteLoopDagNode = GeneratedDagNode & {
  route_loop: RouteLoopConfig;
};

export type DagNode = GeneratedDagNode & {
  route_loop?: RouteLoopConfig;
};
export type { RouteLoopDecisionData } from '@/lib/types';

/**
 * Base URL for SSE streams. In dev, bypasses Vite proxy by connecting directly
 * to the backend server. In production, uses relative URLs (same origin).
 * Uses the page hostname so it works from any network interface.
 */
const apiPort = (import.meta.env.VITE_API_PORT as string | undefined) ?? '3090';
export const SSE_BASE_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:${apiPort}`
  : '';

export { getCodebaseInput } from '@/lib/codebase-input';

export type ConversationResponse = components['schemas']['Conversation'];
export type CodebaseResponse = components['schemas']['Codebase'];

export interface HealthResponse {
  status: string;
  adapter: string;
  concurrency: {
    active: number;
    queuedTotal: number;
    maxConcurrent: number;
  };
  runningWorkflows: number;
  version?: string;
  is_docker: boolean;
  is_wsl: boolean;
  /** WSL distribution name (e.g. "Ubuntu") — only present when is_wsl is true. */
  wsl_distro?: string;
  activePlatforms?: string[];
}

async function assertApiResponseOk(response: Response, url: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text();
    const truncated = body.length > 200 ? body.slice(0, 200) + '...' : body;
    const path = new URL(url, window.location.origin).pathname;
    throw Object.assign(new Error(`API error ${response.status} (${path}): ${truncated}`), {
      status: response.status,
    });
  }
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await (options === undefined ? fetch(url) : fetch(url, options));
  await assertApiResponseOk(res, url);
  return res.json() as Promise<T>;
}

// Providers
export interface ProviderInfo {
  id: string;
  displayName: string;
  // Derived from the OpenAPI spec so the string-union `structuredOutput`
  // ('enforced' | 'best-effort' | false) is typed honestly rather than widened
  // to boolean. `Partial` because SettingsPage synthesizes placeholder entries
  // for config-only providers with unknown capabilities ({}); the web never
  // reads individual capability fields, only the API populates the full shape.
  capabilities: Partial<components['schemas']['ProviderCapabilities']>;
  builtIn: boolean;
}

export type ProviderDefaults = Record<string, unknown>;

export type SafeConfigResponse = components['schemas']['SafeConfig'];
export type UpdateAssistantConfigBody = components['schemas']['UpdateAssistantConfigBody'];

export async function listProviders(): Promise<ProviderInfo[]> {
  const data = await fetchJSON<{ providers: ProviderInfo[] }>('/api/providers');
  return data.providers;
}

// Web auth status (opt-in). Drives the login gate: when `enabled` is false the
// UI renders exactly as before (no login). `signup` reports the invite posture:
//   - 'allowlist' — invite-only (allowlisted emails)
//   - 'open'      — anyone may register
//   - 'disabled'  — self-serve signup is off (login only); hide signup UI
export interface AuthStatus {
  enabled: boolean;
  signup: 'allowlist' | 'open' | 'disabled';
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return fetchJSON<AuthStatus>('/api/auth/status');
}

// GitHub device-flow connect
export interface GithubDeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export interface GithubDevicePoll {
  status: 'pending' | 'connected' | 'expired' | 'denied' | 'error';
  githubLogin?: string;
  detail?: string;
}

export interface GithubConnectionStatus {
  connected: boolean;
  githubLogin: string | null;
}

export async function getGithubConnection(): Promise<GithubConnectionStatus> {
  return fetchJSON<GithubConnectionStatus>('/api/auth/github');
}

export async function startGithubDeviceFlow(): Promise<GithubDeviceStart> {
  return fetchJSON<GithubDeviceStart>('/api/auth/github/device/start', { method: 'POST' });
}

export async function pollGithubDeviceFlow(deviceCode: string): Promise<GithubDevicePoll> {
  return fetchJSON<GithubDevicePoll>('/api/auth/github/device/poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
  });
}

export async function disconnectGithub(): Promise<{ success: boolean }> {
  return fetchJSON<{ success: boolean }>('/api/auth/github', { method: 'DELETE' });
}

// Conversations
export async function listConversations(codebaseId?: string): Promise<ConversationResponse[]> {
  const params = new URLSearchParams();
  if (codebaseId) params.set('codebaseId', codebaseId);
  const qs = params.toString();
  return fetchJSON<ConversationResponse[]>(`/api/conversations${qs ? `?${qs}` : ''}`);
}

export async function createConversation(
  codebaseId?: string,
  message?: string
): Promise<{ conversationId: string; id: string; dispatched?: boolean }> {
  const body: Record<string, string> = {};
  if (codebaseId) body.codebaseId = codebaseId;
  if (message) body.message = message;

  return fetchJSON('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getConversation(id: string): Promise<ConversationResponse> {
  return fetchJSON<ConversationResponse>(`/api/conversations/${encodeURIComponent(id)}`);
}

export async function updateConversation(
  id: string,
  updates: { title?: string }
): Promise<{ success: boolean }> {
  return fetchJSON(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
  return fetchJSON(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function sendMessage(
  conversationId: string,
  message: string,
  files?: File[]
): Promise<{ accepted: boolean; status: string }> {
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/message`;

  if (!files || files.length === 0) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  const form = new FormData();
  form.append('message', message);
  for (const file of files) {
    form.append('files', file, file.name);
  }
  // No Content-Type header — browser sets multipart/form-data with boundary automatically
  return fetchJSON(url, { method: 'POST', body: form });
}

// Messages
export type MessageResponse = components['schemas']['Message'];

export async function getMessages(conversationId: string, limit = 200): Promise<MessageResponse[]> {
  return fetchJSON<MessageResponse[]>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=${String(limit)}`
  );
}

// Codebases
export async function listCodebases(): Promise<CodebaseResponse[]> {
  return fetchJSON<CodebaseResponse[]>('/api/codebases');
}

export async function getCodebase(id: string): Promise<CodebaseResponse> {
  return fetchJSON<CodebaseResponse>(`/api/codebases/${id}`);
}

export async function addCodebase(
  input: { url: string } | { path: string }
): Promise<CodebaseResponse> {
  return fetchJSON<CodebaseResponse>('/api/codebases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteCodebase(id: string): Promise<{ success: boolean }> {
  return fetchJSON<{ success: boolean }>(`/api/codebases/${id}`, { method: 'DELETE' });
}

export type WorkflowRunResponse = components['schemas']['WorkflowRun'];
export type WorkflowEventResponse = components['schemas']['WorkflowEvent'];
export type RetryWorkflowNodeCheckoutStrategy = 'checkpoint' | 'current';
export type RetryWorkflowNodeResponse = components['schemas']['RetryWorkflowNodeResponse'] & {
  checkoutStrategy: RetryWorkflowNodeCheckoutStrategy;
};

export interface RetryWorkflowNodePreviewResponse {
  runId: string;
  workflowName: string;
  nodeId: string;
  retryEpoch: number;
  invalidatedNodes: string[];
  resetSkipped: boolean;
  checkpointRef?: string;
  checkpointCommitSha?: string;
  currentHeadSha?: string;
  hasNewerHead: boolean;
  requiresCommitChoice: boolean;
}

export type WorkflowListEntry = components['schemas']['WorkflowListEntry'];

export interface WorkflowListResult {
  workflows: WorkflowListEntry[];
  /** Repo-owner-curated names from `.archon/config.yaml`, declared order. */
  recommended: string[];
}

export async function listWorkflows(cwd?: string): Promise<WorkflowListResult> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const result = await fetchJSON<{
    workflows: WorkflowListEntry[];
    recommended: string[];
  }>(`/api/workflows${params}`);
  return { workflows: result.workflows, recommended: result.recommended ?? [] };
}

export async function runWorkflow(
  name: string,
  conversationId: string,
  message: string
): Promise<{ accepted: boolean; status: string }> {
  return fetchJSON(`/api/workflows/${encodeURIComponent(name)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message }),
  });
}

export type DashboardRunResponse = components['schemas']['DashboardWorkflowRun'];
export type DashboardCounts = components['schemas']['DashboardRunsResponse']['counts'];
export type DashboardRunsResult = components['schemas']['DashboardRunsResponse'];

export async function listDashboardRuns(options?: {
  status?: WorkflowRunStatus;
  codebaseId?: string;
  search?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}): Promise<DashboardRunsResult> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.codebaseId) params.set('codebaseId', options.codebaseId);
  if (options?.search) params.set('search', options.search);
  if (options?.after) params.set('after', options.after);
  if (options?.before) params.set('before', options.before);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const qs = params.toString();
  return fetchJSON<DashboardRunsResult>(`/api/dashboard/runs${qs ? `?${qs}` : ''}`);
}

export async function cancelWorkflowRun(
  runId: string
): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });
}

export async function resumeWorkflowRun(
  runId: string
): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
  });
}

export async function retryWorkflowNode(
  runId: string,
  nodeId: string,
  options?: { checkoutStrategy?: RetryWorkflowNodeCheckoutStrategy }
): Promise<RetryWorkflowNodeResponse> {
  const body = options?.checkoutStrategy
    ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutStrategy: options.checkoutStrategy }),
      }
    : {};
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/retry`,
    { method: 'POST', ...body }
  );
}

export async function previewRetryWorkflowNode(
  runId: string,
  nodeId: string
): Promise<RetryWorkflowNodePreviewResponse> {
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/retry/preview`
  );
}

export async function abandonWorkflowRun(
  runId: string
): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/abandon`, {
    method: 'POST',
  });
}

export async function deleteWorkflowRun(
  runId: string
): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
}

export async function approveWorkflowRun(
  runId: string,
  comment?: string
): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
}

export async function rejectWorkflowRun(
  runId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function listWorkflowRuns(options?: {
  conversationId?: string;
  status?: WorkflowRunStatus;
  limit?: number;
  codebaseId?: string;
}): Promise<WorkflowRunResponse[]> {
  const params = new URLSearchParams();
  if (options?.conversationId) params.set('conversationId', options.conversationId);
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.codebaseId) params.set('codebaseId', options.codebaseId);
  const qs = params.toString();
  const result = await fetchJSON<{ runs: WorkflowRunResponse[] }>(
    `/api/workflows/runs${qs ? `?${qs}` : ''}`
  );
  return result.runs;
}

export async function getWorkflowRun(
  runId: string
): Promise<components['schemas']['WorkflowRunDetail']> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}`);
}

export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];

export function getApiErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  if (!('status' in error)) {
    return null;
  }
  const status = error.status;
  return typeof status === 'number' ? status : null;
}

export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse> {
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

export type GitChangesResponse = components['schemas']['GitChangesResponse'];
export type GitChangedFile = components['schemas']['GitChangedFile'];
export type GitEmptyReason = components['schemas']['GitEmptyReason'];
export type GitLogResponse = components['schemas']['GitLogResponse'];
export type GitLogCommit = components['schemas']['GitLogCommit'];
export type GitDiffResponse = components['schemas']['GitDiffResponse'];
export type GitReadyDiffResponse = Exclude<GitDiffResponse, { emptyReason: GitEmptyReason }>;
export type GitDiffHunk = components['schemas']['GitDiffHunk'];
export type GitDiffChange = components['schemas']['GitDiffChange'];
const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function assertCommitRef(ref: string): string {
  if (!FULL_GIT_OBJECT_ID_RE.test(ref)) throw new Error('Invalid commit ref');
  return ref;
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- locked GitFileSource contract
export type GitFileSource = 'worktree' | 'head' | string;
export type GitFileClientResult =
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | {
      kind: 'text';
      text: string;
      contentHash: string;
      truncated: boolean;
      cursor: string;
      byteLength: number;
    }
  | {
      kind: 'image';
      bytes: Uint8Array;
      contentHash: string;
      mediaType: string;
      byteLength: number;
    }
  | { kind: 'hex'; bytes: Uint8Array; contentHash: string; byteLength: number }
  | { kind: 'download'; contentHash: string; byteLength: number };

const GIT_FILE_PRESENTATIONS = ['text', 'image', 'hex', 'download'] as const;
type GitFilePresentation = (typeof GIT_FILE_PRESENTATIONS)[number];

function isGitFilePresentation(value: string): value is GitFilePresentation {
  return (GIT_FILE_PRESENTATIONS as readonly string[]).includes(value);
}

function invalidGitFileResponse(): never {
  throw new Error('Invalid git file response');
}

function parseNonNegativeInteger(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}

function parseExactBoolean(value: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export async function getWorkflowRunGitChanges(
  runId: string,
  options?: { ref?: string; signal?: AbortSignal }
): Promise<GitChangesResponse> {
  const params = new URLSearchParams();
  if (options?.ref !== undefined) params.set('ref', assertCommitRef(options.ref));
  const query = params.toString();
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/changes${query ? `?${query}` : ''}`,
    options?.signal ? { signal: options.signal } : undefined
  );
}

export async function getWorkflowRunGitLog(
  runId: string,
  options?: { signal?: AbortSignal }
): Promise<GitLogResponse> {
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/log`,
    options?.signal ? { signal: options.signal } : undefined
  );
}

export async function getWorkflowRunGitDiff(
  runId: string,
  path: string,
  options?: { cursor?: string; ref?: string; signal?: AbortSignal }
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path });
  if (options?.ref !== undefined) params.set('ref', assertCommitRef(options.ref));
  if (options?.cursor) params.set('cursor', options.cursor);
  return fetchJSON(
    '/api/workflows/runs/' + encodeURIComponent(runId) + '/git/diff?' + params.toString(),
    options?.signal ? { signal: options.signal } : undefined
  );
}

export function gitFileUrl(
  runId: string,
  path: string,
  source: GitFileSource,
  options?: { cursor?: string; download?: boolean }
): string {
  const encodedPath = path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  const resolvedSource =
    source === 'worktree' || source === 'head' ? source : assertCommitRef(source);
  const params = new URLSearchParams({ source: resolvedSource });
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.download) params.set('download', '1');
  return (
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/git/file/' +
    encodedPath +
    '?' +
    params.toString()
  );
}

function contentHashFromEtag(response: Response): string {
  const etag = response.headers.get('ETag') ?? '';
  const match = /^(?:"([a-f0-9]{64})"|([a-f0-9]{64}))$/.exec(etag);
  const contentHash = match?.[1] ?? match?.[2];
  if (!contentHash) invalidGitFileResponse();
  return contentHash;
}

async function parsePresentedGitFile(response: Response): Promise<GitFileClientResult> {
  const presentationRaw = response.headers.get('X-Archon-Git-Presentation') ?? '';
  if (!isGitFilePresentation(presentationRaw)) invalidGitFileResponse();
  const contentHash = contentHashFromEtag(response);
  const byteLength = parseNonNegativeInteger(
    response.headers.get('X-Archon-Git-Byte-Length') ?? ''
  );
  if (byteLength === undefined) invalidGitFileResponse();
  const truncated = parseExactBoolean(response.headers.get('X-Archon-Git-Truncated') ?? '');
  if (truncated === undefined) invalidGitFileResponse();
  const cursor = response.headers.get('X-Archon-Git-Cursor') ?? '';
  const mediaType = response.headers.get('X-Archon-Git-Media-Type') ?? '';
  const contentType = response.headers.get('Content-Type') ?? '';

  if (presentationRaw === 'text') {
    if (truncated !== (cursor !== '')) invalidGitFileResponse();
    if (mediaType !== '' || !contentType.includes('text/plain')) invalidGitFileResponse();
    return {
      kind: 'text',
      text: await response.text(),
      contentHash,
      truncated,
      cursor,
      byteLength,
    };
  }
  if (truncated || cursor !== '') invalidGitFileResponse();
  if (presentationRaw === 'image') {
    if (mediaType === '' || !contentType.includes(mediaType)) invalidGitFileResponse();
    return {
      kind: 'image',
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentHash,
      mediaType,
      byteLength,
    };
  }
  if (mediaType !== '' || !contentType.includes('application/octet-stream')) {
    invalidGitFileResponse();
  }
  if (presentationRaw === 'hex') {
    return {
      kind: 'hex',
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentHash,
      byteLength,
    };
  }
  await response.body?.cancel();
  return { kind: 'download', contentHash, byteLength };
}

async function parseLegacyGitFile(response: Response): Promise<GitFileClientResult> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'emptyReason' in body &&
      (body.emptyReason === 'container' || body.emptyReason === 'no_checkout')
    ) {
      return { kind: 'empty', emptyReason: body.emptyReason };
    }
    invalidGitFileResponse();
  }
  const contentHash = contentHashFromEtag(response);
  if (contentType.includes('application/octet-stream')) {
    const headerLength = parseNonNegativeInteger(response.headers.get('Content-Length') ?? '');
    await response.body?.cancel();
    return { kind: 'download', contentHash, byteLength: headerLength ?? 0 };
  }
  if (contentType.includes('text/plain')) {
    const text = await response.text();
    const headerLength = parseNonNegativeInteger(response.headers.get('Content-Length') ?? '');
    return {
      kind: 'text',
      text,
      contentHash,
      truncated: false,
      cursor: '',
      byteLength: headerLength ?? new TextEncoder().encode(text).byteLength,
    };
  }
  invalidGitFileResponse();
}

export async function getWorkflowRunGitFile(
  runId: string,
  path: string,
  source: GitFileSource,
  options?: { cursor?: string; signal?: AbortSignal }
): Promise<GitFileClientResult> {
  const url = gitFileUrl(runId, path, source, { cursor: options?.cursor });
  const response = await (options?.signal ? fetch(url, { signal: options.signal }) : fetch(url));
  await assertApiResponseOk(response, url);
  if (response.headers.get('X-Archon-Git-Presentation') !== null) {
    return parsePresentedGitFile(response);
  }
  return parseLegacyGitFile(response);
}

export type WorkflowNodeStateResponse = components['schemas']['WorkflowNodeState'];
export type WorkflowNodeMessageResponse = components['schemas']['WorkflowNodeMessage'];
export type WorkflowNodeMessagesResponse = components['schemas']['WorkflowNodeMessagesResponse'];
export type NodeExecution = components['schemas']['NodeExecution'];

export async function getWorkflowNodeMessages(
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
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages' +
    query;
  return fetchJSON(url, signal === undefined ? undefined : { signal });
}

export async function getWorkflowNodeMessage(
  runId: string,
  nodeId: string,
  messageId: string,
  options?: { signal?: AbortSignal }
): Promise<WorkflowNodeMessageResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages/' +
    encodeURIComponent(messageId);
  return fetchJSON(url, options?.signal === undefined ? undefined : { signal: options.signal });
}

export type SendWorkflowNodeBody = components['schemas']['SendWorkflowNodeBody'];
export type SendWorkflowNodeResponse = components['schemas']['SendWorkflowNodeResponse'];
export type WithdrawWorkflowNodeResponse = components['schemas']['WithdrawWorkflowNodeResponse'];
export type ReadWorkflowNodeQueueResponse = components['schemas']['ReadWorkflowNodeQueueResponse'];

/**
 * POST /api/workflows/runs/:runId/nodes/:nodeId/send — Story 2.1 queue send:
 * operator guidance for a live in-process agent node, drained at the next
 * natural provider-turn boundary. Refusals surface as SteeringRequestError
 * carrying the nested {code,message} so callers can distinguish a canonical
 * 422 `not_steerable_here` from other failures. No auto-retry and no message
 * logging — the caller owns `message_id` reuse for ambiguous failures.
 */
export async function sendNodeGuidance(
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
): Promise<SendWorkflowNodeResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/send';
  try {
    return await fetchJSON<SendWorkflowNodeResponse>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw toSteeringRequestError(error);
  }
}

export type InterruptWorkflowNodeResponse = components['schemas']['InterruptWorkflowNodeResponse'];

/**
 * POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt — Story 2.3 turn
 * interrupt: stops the live provider turn of an interrupt-capable node
 * without cancelling the run. The awaited response is the ACTUAL settled
 * sub-state — `idle-after-interrupt` or `generating` — and terminal
 * refusals surface as SteeringRequestError (409 `node_finished`, 422
 * `not_steerable_here`). No request body, no auto-retry.
 */
export async function interruptNode(
  runId: string,
  nodeId: string
): Promise<InterruptWorkflowNodeResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/interrupt';
  try {
    return await fetchJSON<InterruptWorkflowNodeResponse>(url, { method: 'POST' });
  } catch (error) {
    throw toSteeringRequestError(error, STEERING_INTERRUPT_FAILED_MESSAGE);
  }
}

export type KeepaliveWorkflowNodeResponse = components['schemas']['KeepaliveWorkflowNodeResponse'];

/**
 * POST /api/workflows/runs/:runId/nodes/:nodeId/keepalive — Story 2.12 bodyless
 * idle-await re-arm. No request body and no synthetic JSON content type; no
 * auto-retry. Failures normalize through SteeringRequestError so callers keep
 * the same refusal surface as interrupt/send.
 */
export async function keepaliveNode(
  runId: string,
  nodeId: string
): Promise<KeepaliveWorkflowNodeResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/keepalive';
  try {
    return await fetchJSON<KeepaliveWorkflowNodeResponse>(url, { method: 'POST' });
  } catch (error) {
    throw toSteeringRequestError(error);
  }
}

/**
 * DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId — withdraw
 * a still-queued guidance message. Bodyless: no request body and
 * no synthetic JSON content type, no auto-retry. Refusals normalize through
 * the same SteeringRequestError surface as the send helper so callers keep
 * using `toSteeringRefusal`.
 */
export async function withdrawNodeGuidance(
  runId: string,
  nodeId: string,
  messageId: string
): Promise<WithdrawWorkflowNodeResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/queue/' +
    encodeURIComponent(messageId);
  try {
    return await fetchJSON<WithdrawWorkflowNodeResponse>(url, { method: 'DELETE' });
  } catch (error) {
    throw toSteeringRequestError(error);
  }
}

/**
 * GET /api/workflows/runs/:runId/nodes/:nodeId/queue — read the node's
 * still-pending queue snapshot so a mounted dock converges on the shared
 * registry queue. Bodyless GET with `cache: 'no-store'`, optional
 * AbortSignal, no auto-retry — failures normalize through the same
 * SteeringRequestError surface as the send/withdraw helpers.
 */
export async function readNodeGuidanceQueue(
  runId: string,
  nodeId: string,
  options?: { signal?: AbortSignal }
): Promise<ReadWorkflowNodeQueueResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/queue';
  try {
    return await fetchJSON<ReadWorkflowNodeQueueResponse>(url, {
      method: 'GET',
      cache: 'no-store',
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    throw toSteeringRequestError(error);
  }
}

export async function getWorkflowRunByWorker(
  workerPlatformId: string
): Promise<components['schemas']['WorkflowRunByWorkerResponse'] | null> {
  try {
    return await fetchJSON(`/api/workflows/runs/by-worker/${encodeURIComponent(workerPlatformId)}`);
  } catch (e: unknown) {
    // 404 means no run exists yet — expected during dispatch
    if ((e as Error & { status?: number }).status === 404) {
      return null;
    }
    throw e;
  }
}

export type WorkflowSource = components['schemas']['WorkflowSource'];

export interface GetWorkflowResponse {
  workflow: WorkflowDefinition;
  filename: string;
  source: WorkflowSource;
}

export async function getWorkflow(name: string, cwd?: string): Promise<GetWorkflowResponse> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  return fetchJSON(`/api/workflows/${encodeURIComponent(name)}${params}`);
}

export async function saveWorkflow(
  name: string,
  definition: WorkflowDefinition,
  cwd?: string,
  source?: WorkflowSource
): Promise<GetWorkflowResponse> {
  const query = new URLSearchParams();
  if (cwd) query.set('cwd', cwd);
  if (source === 'global') query.set('source', source);
  const params = query.toString() ? `?${query.toString()}` : '';
  return fetchJSON(`/api/workflows/${encodeURIComponent(name)}${params}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition }),
  });
}

export async function deleteWorkflow(
  name: string,
  cwd?: string,
  source?: WorkflowSource
): Promise<{ deleted: boolean; name: string }> {
  const query = new URLSearchParams();
  if (cwd) query.set('cwd', cwd);
  if (source === 'global') query.set('source', source);
  const params = query.toString() ? `?${query.toString()}` : '';
  return fetchJSON(`/api/workflows/${encodeURIComponent(name)}${params}`, {
    method: 'DELETE',
  });
}

export async function validateWorkflow(
  definition: WorkflowDefinition
): Promise<{ valid: boolean; errors?: string[] }> {
  return fetchJSON('/api/workflows/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition }),
  });
}

export interface CommandEntry {
  name: string;
  source: WorkflowSource;
}

export async function listCommands(cwd?: string): Promise<CommandEntry[]> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const result = await fetchJSON<{ commands: CommandEntry[] }>(`/api/commands${params}`);
  return result.commands;
}

export async function getConfig(): Promise<{ config: SafeConfigResponse; database: string }> {
  return fetchJSON('/api/config');
}

export async function updateAssistantConfig(
  body: UpdateAssistantConfigBody
): Promise<{ config: SafeConfigResponse; database: string }> {
  return fetchJSON('/api/config/assistants', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export type IsolationEnvironment = components['schemas']['IsolationEnvironment'];

export async function getCodebaseEnvironments(codebaseId: string): Promise<IsolationEnvironment[]> {
  const result = await fetchJSON<{ environments: IsolationEnvironment[] }>(
    `/api/codebases/${encodeURIComponent(codebaseId)}/environments`
  );
  return result.environments;
}

// Codebase env vars
export async function getCodebaseEnvVars(codebaseId: string): Promise<string[]> {
  const result = await fetchJSON<{ keys: string[] }>(
    `/api/codebases/${encodeURIComponent(codebaseId)}/env`
  );
  return result.keys;
}

export async function setCodebaseEnvVar(
  codebaseId: string,
  data: { key: string; value: string }
): Promise<{ success: boolean }> {
  return fetchJSON<{ success: boolean }>(`/api/codebases/${encodeURIComponent(codebaseId)}/env`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteCodebaseEnvVar(
  codebaseId: string,
  key: string
): Promise<{ success: boolean }> {
  return fetchJSON<{ success: boolean }>(
    `/api/codebases/${encodeURIComponent(codebaseId)}/env/${encodeURIComponent(key)}`,
    { method: 'DELETE' }
  );
}

export type ReviewFeedbackRequest = components['schemas']['ReviewFeedbackBody'];
export type ReviewFeedbackResponse = components['schemas']['ReviewFeedbackResponse'];

export async function submitWorkflowRunReviewFeedback(
  runId: string,
  body: ReviewFeedbackRequest
): Promise<ReviewFeedbackResponse> {
  return fetchJSON<ReviewFeedbackResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/review-feedback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

// System
export async function getHealth(): Promise<HealthResponse> {
  return fetchJSON<HealthResponse>('/api/health');
}

export type UpdateCheckResult = components['schemas']['UpdateCheckResponse'];

export async function getUpdateCheck(): Promise<UpdateCheckResult> {
  return fetchJSON<UpdateCheckResult>('/api/update-check');
}
