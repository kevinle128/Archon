/**
 * Workflow ENV overlay API — install-wide named patches for a workflow.
 *
 * Types are derived only from the generated OpenAPI contract. List responses
 * omit patch bodies; detail is fetched only when editing. Preview is
 * non-authoritative: Start freezes the selected ENV row server-side.
 */
import { requestJson } from '@/lib/settings/http';
import type { components, paths } from '@/lib/api.generated';

// ---------------------------------------------------------------------------
// Generated operation / schema anchors
// ---------------------------------------------------------------------------

type EnvsListOperation = paths['/api/workflows/{name}/envs']['get'];
type EnvsListResponse = EnvsListOperation['responses'][200]['content']['application/json'];

type EnvDetailOperation = paths['/api/workflows/{name}/envs/{envId}']['get'];
type EnvDetailResponse = EnvDetailOperation['responses'][200]['content']['application/json'];

type EnvCreateOperation = paths['/api/workflows/{name}/envs']['post'];
type EnvCreateBody = NonNullable<EnvCreateOperation['requestBody']>['content']['application/json'];
type EnvCreateResponse = EnvCreateOperation['responses'][201]['content']['application/json'];

type EnvUpdateOperation = paths['/api/workflows/{name}/envs/{envId}']['patch'];
type EnvUpdateBody = NonNullable<EnvUpdateOperation['requestBody']>['content']['application/json'];
type EnvUpdateResponse = EnvUpdateOperation['responses'][200]['content']['application/json'];

type EnvDeleteOperation = paths['/api/workflows/{name}/envs/{envId}']['delete'];
type EnvDeleteResponse = EnvDeleteOperation['responses'][200]['content']['application/json'];

type EnvPreviewOperation = paths['/api/workflows/{name}/env-preview']['get'];
type EnvPreviewResponse = EnvPreviewOperation['responses'][200]['content']['application/json'];
type EnvPreviewQuery = NonNullable<EnvPreviewOperation['parameters']['query']>;

type GeneratedSummary = components['schemas']['WorkflowEnvSummaryResponse'];
type GeneratedEnv = components['schemas']['WorkflowEnvResponse'];
type GeneratedPreview = components['schemas']['WorkflowEnvPreviewResponse'];
type GeneratedPreviewTarget = components['schemas']['WorkflowEnvPreviewTarget'];
type GeneratedPreviewResolved = components['schemas']['WorkflowEnvPreviewResolved'];
type GeneratedCreateBody = components['schemas']['CreateWorkflowEnvBody'];
type GeneratedUpdateBody = components['schemas']['UpdateWorkflowEnvBody'];
type GeneratedListResponse = components['schemas']['WorkflowEnvListResponse'];
type GeneratedDetailResponse = components['schemas']['WorkflowEnvDetailResponse'];
type GeneratedDeleteResponse = components['schemas']['DeleteWorkflowEnvResponse'];

// ---------------------------------------------------------------------------
// Public aliases — generated contracts only
// ---------------------------------------------------------------------------

export type WorkflowEnvSummary = GeneratedSummary;
export type WorkflowEnv = GeneratedEnv;
export type WorkflowEnvPreview = GeneratedPreview;
export type WorkflowEnvPreviewTarget = GeneratedPreviewTarget;
export type WorkflowEnvPreviewResolved = GeneratedPreviewResolved;
export type CreateWorkflowEnvBody = GeneratedCreateBody;
export type UpdateWorkflowEnvBody = GeneratedUpdateBody;

// ---------------------------------------------------------------------------
// Compile-time drift guards
// ---------------------------------------------------------------------------

type ExactMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

type ListResponseTied = AssertTrue<ExactMatch<EnvsListResponse, GeneratedListResponse>>;
type DetailResponseTied = AssertTrue<ExactMatch<EnvDetailResponse, GeneratedDetailResponse>>;
type CreateBodyTied = AssertTrue<ExactMatch<EnvCreateBody, GeneratedCreateBody>>;
type CreateResponseTied = AssertTrue<ExactMatch<EnvCreateResponse, GeneratedDetailResponse>>;
type UpdateBodyTied = AssertTrue<ExactMatch<EnvUpdateBody, GeneratedUpdateBody>>;
type UpdateResponseTied = AssertTrue<ExactMatch<EnvUpdateResponse, GeneratedDetailResponse>>;
type DeleteResponseTied = AssertTrue<ExactMatch<EnvDeleteResponse, GeneratedDeleteResponse>>;
type PreviewResponseTied = AssertTrue<ExactMatch<EnvPreviewResponse, GeneratedPreview>>;
type PreviewQueryHasCwd = AssertTrue<ExactMatch<EnvPreviewQuery['cwd'], string>>;
type SummaryHasNoPatches = AssertTrue<ExactMatch<keyof WorkflowEnvSummary & 'patches', never>>;

export type WorkflowEnvOpenApiContractChecks = [
  ListResponseTied,
  DetailResponseTied,
  CreateBodyTied,
  CreateResponseTied,
  UpdateBodyTied,
  UpdateResponseTied,
  DeleteResponseTied,
  PreviewResponseTied,
  PreviewQueryHasCwd,
  SummaryHasNoPatches,
];

// ---------------------------------------------------------------------------
// Path / query builders (pure — unit-tested)
// ---------------------------------------------------------------------------

/** Base path for a workflow's ENV collection. */
export function buildWorkflowEnvsPath(workflowName: string): string {
  return `/api/workflows/${encodeURIComponent(workflowName)}/envs`;
}

/** Path for one ENV row. */
export function buildWorkflowEnvPath(workflowName: string, envId: string): string {
  return `${buildWorkflowEnvsPath(workflowName)}/${encodeURIComponent(envId)}`;
}

/** Preview path with required cwd and optional envId. */
export function buildWorkflowEnvPreviewPath(
  workflowName: string,
  cwd: string,
  envId?: string | null
): string {
  const qs = new URLSearchParams();
  qs.set('cwd', cwd);
  if (envId !== undefined && envId !== null && envId.length > 0) {
    qs.set('envId', envId);
  }
  return `/api/workflows/${encodeURIComponent(workflowName)}/env-preview?${qs.toString()}`;
}

// ---------------------------------------------------------------------------
// Request functions
// ---------------------------------------------------------------------------

/** List ENV summaries for a workflow (no patch bodies). */
export async function listWorkflowEnvs(workflowName: string): Promise<WorkflowEnvSummary[]> {
  const res = await requestJson<EnvsListResponse>(buildWorkflowEnvsPath(workflowName));
  return res.envs;
}

/** Full ENV row (includes patches). Fetch only when opening an editor. */
export async function getWorkflowEnv(workflowName: string, envId: string): Promise<WorkflowEnv> {
  const res = await requestJson<EnvDetailResponse>(buildWorkflowEnvPath(workflowName, envId));
  return res.env;
}

/** Create a named ENV overlay. */
export async function createWorkflowEnv(
  workflowName: string,
  body: CreateWorkflowEnvBody
): Promise<WorkflowEnv> {
  const res = await requestJson<EnvCreateResponse>(buildWorkflowEnvsPath(workflowName), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.env;
}

/** Replace name and/or the complete patch map (not a deep delta). */
export async function updateWorkflowEnv(
  workflowName: string,
  envId: string,
  body: UpdateWorkflowEnvBody
): Promise<WorkflowEnv> {
  const res = await requestJson<EnvUpdateResponse>(buildWorkflowEnvPath(workflowName, envId), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.env;
}

/** Delete an ENV overlay. */
export async function deleteWorkflowEnv(
  workflowName: string,
  envId: string
): Promise<EnvDeleteResponse> {
  return requestJson<EnvDeleteResponse>(buildWorkflowEnvPath(workflowName, envId), {
    method: 'DELETE',
  });
}

/**
 * Server-authoritative preview for None (YAML) or a selected ENV.
 * Pass `envId: null`/`undefined` for the baseline (no overlay).
 */
export async function previewWorkflowEnv(
  workflowName: string,
  cwd: string,
  envId?: string | null
): Promise<WorkflowEnvPreview> {
  return requestJson<EnvPreviewResponse>(buildWorkflowEnvPreviewPath(workflowName, cwd, envId));
}

/**
 * Start a workflow run under a named ENV overlay. The server freezes the ENV row
 * before dispatch; a missing id or a workflow mismatch is a synchronous 400.
 * Runs without an overlay keep using `runWorkflow` from `@/lib/api`.
 */
export async function runWorkflowWithEnv(
  workflowName: string,
  conversationId: string,
  message: string,
  envId: string
): Promise<{ accepted: boolean; status: string }> {
  return requestJson<{ accepted: boolean; status: string }>(
    `/api/workflows/${encodeURIComponent(workflowName)}/run`,
    { method: 'POST', body: JSON.stringify({ conversationId, message, envId }) }
  );
}
