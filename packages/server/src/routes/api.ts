/**
 * REST API routes for the Archon Web UI.
 * Provides conversation, codebase, and SSE streaming endpoints.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  formatSafeZodIssueDetail,
  steeringValidationErrorHook,
  workflowEnvValidationErrorHook,
} from './openapi-defaults';
import { streamSSE } from 'hono/streaming';
import { cors } from 'hono/cors';
import type { WebAdapter } from '../adapters/web';
import { boundMetadataToolOutputs, truncateToolOutput } from '../adapters/web/truncate';
import { rm, readFile, writeFile, unlink, mkdir, readdir, stat } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { normalize, join, sep, basename, dirname, resolve } from 'path';
import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import { requestLogPath } from '../request-log-path';
import type {
  ConversationLockManager,
  AttachedFile,
  HandleMessageContext,
  GlobalConfig,
  TiersPatch,
  UserRole,
  SchemaVersionInfo,
  UserAiPrefs,
} from '@archon/core';
import {
  handleMessage,
  getDatabaseType,
  getSchemaVersion,
  loadConfig,
  loadRepoConfig,
  toSafeConfig,
  updateGlobalConfig,
  cloneRepository,
  registerRepository,
  registerFolder,
  ConversationNotFoundError,
  generateAndSetTitle,
  resolveTitleRequest,
  isPerUserGitHubEnabled,
  loadDeviceFlowConfig,
  startDeviceFlow,
  pollDeviceFlowOnce,
  persistGithubConnection,
  DeviceFlowError,
  GithubIdentityConflictError,
  getUserGithubTokenRecord,
  deleteUserGithubToken,
  isPerUserProviderKeysEnabled,
  persistProviderApiKey,
  InvalidProviderKeyError,
  listUserProviderKeys,
  deleteUserProviderKey,
  listConnectableVendors,
  buildAgentCredentialMatrix,
  normalizeCredentialVendor,
  SUBSCRIPTION_PROVIDERS,
  startOAuth,
  pollOAuth,
  OAuthCallbackPortBusyError,
  getUserAiPrefs,
  setUserTiers,
  setUserAliases,
  setUserDefault,
} from '@archon/core';
import type { UserTiersPatch, UserAliasesPatch, AliasesPatch } from '@archon/core';
import { findRepoRoot, removeWorktree, toRepoPath, toWorktreePath } from '@archon/git';
import {
  createLogger,
  getWorkflowFolderSearchPaths,
  getCommandFolderSearchPaths,
  getDefaultCommandsPath,
  getDefaultWorkflowsPath,
  getArchonWorkspacesPath,
  getHomeCommandsPath,
  getHomeWorkflowsPath,
  resolveProjectStorageKey,
  getRunArtifactsDirForKey,
  getRunArtifactsDirForRoot,
  isInsideArchonHome,
  getArchonHome,
  isDocker,
  isWSL,
  getWSLDistroName,
  checkForUpdate,
  BUNDLED_IS_BINARY,
  BUNDLED_VERSION,
} from '@archon/paths';
import {
  discoverWorkflowsWithConfig,
  isValidWorkflowFolderSegment,
} from '@archon/workflows/workflow-discovery';
import { parseWorkflow } from '@archon/workflows/loader';
import { resolveWorkflowName } from '@archon/workflows/router';
import { isValidCommandName, isValidWorkflowName } from '@archon/workflows/command-validation';
import { projectLatestEffectiveNodeStates } from '@archon/workflows/retry-state';
import { getSteeringRegistry } from '@archon/workflows/steering-registry';
import type { SteeringSubState } from '@archon/workflows/steering-registry';
import { projectWorkflowExecutionHistory } from './workflow-execution-history';
import { BUNDLED_WORKFLOWS, BUNDLED_COMMANDS, isBinaryBuild } from '@archon/workflows/defaults';
import {
  applyEnvOverlay,
  EnvOverlayError,
  listEnvOverlayTargets,
} from '@archon/workflows/env-overlay';
import {
  assistantModelDefaults,
  buildResolvedRequestMetadata,
  resolveWorkflowModelScope,
} from '@archon/workflows/node-model-resolution';
import { buildAiProfile } from '@archon/workflows/model-validation';
import {
  envPatchesSchema,
  type EnvOverlayCandidate,
  type EnvPatches,
} from '@archon/workflows/schemas/env-overlay';
import {
  workflowEnvWorkflowNameSchema,
  type WorkflowEnvRow,
  type WorkflowEnvSummary,
} from '@archon/core/schemas/workflow-env';
import {
  RETRYABLE_WORKFLOW_STATUSES,
  TERMINAL_WORKFLOW_STATUSES,
  isApprovalContext,
  isGateResolved,
} from '@archon/workflows/schemas/workflow-run';
import type {
  NodeState,
  WorkflowRun,
  WorkflowRunStatus,
} from '@archon/workflows/schemas/workflow-run';
import type { ThinkingConfig } from '@archon/workflows/schemas/dag-node';
import type { WorkflowDefinition } from '@archon/workflows/schemas/workflow';
import type { NodeMessage } from '@archon/workflows/schemas/node-message';
import type { MessageRow } from '@archon/core/schemas/message';
import type { DashboardWorkflowRun } from '@archon/core/schemas/workflow-run';
import type { WorkflowEventRow } from '@archon/core/schemas/workflow-event';
import { findMarkdownFilesRecursive } from '@archon/core/utils/commands';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

interface ApiWorkflowNodeState {
  nodeId: string;
  name: string;
  status: NodeState;
  retryEpoch: number;
  duration?: number;
  error?: string;
  reason?: string;
  provider?: string;
  model?: string;
  tier?: string;
  modelReasoningEffort?: string;
  effort?: string;
  thinking?: ThinkingConfig;
  steeringSubState?: SteeringSubState;
}

function isThinkingConfig(value: unknown): value is ThinkingConfig {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type !== 'adaptive' && record.type !== 'enabled' && record.type !== 'disabled') {
    return false;
  }
  return record.budgetTokens === undefined || typeof record.budgetTokens === 'number';
}

function projectRuntimeNodeMetadata(data: Record<string, unknown>): Partial<ApiWorkflowNodeState> {
  return {
    ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    ...(typeof data.tier === 'string' ? { tier: data.tier } : {}),
    ...(typeof data.modelReasoningEffort === 'string' && data.modelReasoningEffort.length > 0
      ? { modelReasoningEffort: data.modelReasoningEffort }
      : {}),
    ...(typeof data.effort === 'string' && data.effort.length > 0 ? { effort: data.effort } : {}),
    ...(isThinkingConfig(data.thinking) ? { thinking: data.thinking } : {}),
  };
}

function projectApiWorkflowNodeStates(
  events: readonly WorkflowEventRow[],
  pending?: readonly { node_id: string; status: string }[]
): ApiWorkflowNodeState[] {
  const projected = projectLatestEffectiveNodeStates(events, pending);
  const latestLifecycleData = new Map<string, Record<string, unknown>>();
  const runtimeMetadata = new Map<string, Partial<ApiWorkflowNodeState>>();
  for (const event of events) {
    const nodeId =
      typeof event.data.node_id === 'string'
        ? event.data.node_id
        : typeof event.step_name === 'string'
          ? event.step_name
          : undefined;
    if (!nodeId) continue;
    if (
      event.event_type === 'node_started' ||
      event.event_type === 'node_completed' ||
      event.event_type === 'node_failed' ||
      event.event_type === 'node_skipped' ||
      event.event_type === 'node_skipped_prior_success'
    ) {
      latestLifecycleData.set(nodeId, event.data);
      runtimeMetadata.set(nodeId, {
        ...(runtimeMetadata.get(nodeId) ?? {}),
        ...projectRuntimeNodeMetadata(event.data),
      });
    }
  }

  return [...projected.values()].map(state => {
    const data = latestLifecycleData.get(state.node_id) ?? {};
    const duration = data.duration_ms;
    return {
      nodeId: state.node_id,
      name: state.node_id,
      status: state.state,
      retryEpoch: state.retry_epoch,
      ...(runtimeMetadata.get(state.node_id) ?? {}),
      ...(typeof duration === 'number' ? { duration } : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(state.reason ? { reason: state.reason } : {}),
    };
  });
}

function terminalApiNodeStatus(status: WorkflowRunStatus): ApiWorkflowNodeState['status'] {
  return status === 'completed' ? 'completed' : 'failed';
}

/** Node statuses that make a steering target finished (issue #181 → 409). */
const TERMINAL_API_NODE_STATUSES: readonly NodeState[] = ['completed', 'failed', 'skipped'];

function terminalApiNodeError(status: WorkflowRunStatus): string | undefined {
  if (status === 'cancelled') return 'Cancelled by user';
  if (status === 'failed') return 'Workflow stopped';
  return undefined;
}

function settleApiWorkflowNodeStatesForRunStatus(
  status: WorkflowRunStatus,
  nodeStates: ApiWorkflowNodeState[]
): ApiWorkflowNodeState[] {
  if (!TERMINAL_WORKFLOW_STATUSES.includes(status)) return nodeStates;

  const nextStatus = terminalApiNodeStatus(status);
  const fallbackError = terminalApiNodeError(status);
  let changed = false;
  const nextNodeStates = nodeStates.map(nodeState => {
    if (nodeState.status !== 'running') return nodeState;
    changed = true;
    return {
      ...nodeState,
      status: nextStatus,
      ...(fallbackError && !nodeState.error ? { error: fallbackError } : {}),
    };
  });

  return changed ? nextNodeStates : nodeStates;
}

/**
 * Join the live in-process steering sub-state onto still-running node states
 * (#183) by the exact (runId, nodeId) key — the registry key IS the namespaced
 * node id used by loop-group bodies and transcript routes. Runs AFTER
 * terminal-settling persisted states so a stale live handle can never project
 * onto a terminal node. `snapshot().subState` is already gated: only live
 * interrupt-capable handles project one, so queue-only providers, parked
 * asks, discarded runs, and absent handles all yield `undefined` and the
 * field stays absent. Never persisted, never synthesized from transcript rows.
 */
function joinSteeringSubStates(
  runId: string,
  nodeStates: ApiWorkflowNodeState[]
): ApiWorkflowNodeState[] {
  const registry = getSteeringRegistry();
  let changed = false;
  const nextNodeStates = nodeStates.map(nodeState => {
    if (nodeState.status !== 'running') return nodeState;
    const subState = registry.get(runId, nodeState.nodeId)?.snapshot().subState;
    if (subState === undefined) return nodeState;
    changed = true;
    return { ...nodeState, steeringSubState: subState };
  });
  return changed ? nextNodeStates : nodeStates;
}

interface RawWorkflowFile {
  absolutePath: string;
  filename: string;
  packaged: boolean;
  parsed: ReturnType<typeof parseWorkflow>;
}

async function tryReadWorkflowAt(dir: string, name: string): Promise<RawWorkflowFile | null> {
  const acceptedNames = new Set(name.includes('/') ? [name, basename(name)] : [name]);
  for (const ext of ['yaml', 'yml']) {
    const filename = `${name}.${ext}`;
    const absolutePath = join(dir, filename);
    try {
      const content = await readFile(absolutePath, 'utf-8');
      const parsed = parseWorkflow(content, filename);
      if (parsed.workflow !== null && !acceptedNames.has(parsed.workflow.name)) continue;
      return { absolutePath, filename, packaged: false, parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function findPackagedWorkflowAt(
  workflowsRoot: string,
  name: string
): Promise<RawWorkflowFile | null> {
  let packs: string[];
  try {
    packs = await readdir(workflowsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let match: RawWorkflowFile | null = null;
  for (const pack of packs.sort((a, b) => a.localeCompare(b))) {
    if (!isValidWorkflowFolderSegment(pack)) continue;
    const packPath = join(workflowsRoot, pack);
    try {
      if (!(await stat(packPath)).isDirectory()) continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    let workflowFolders: string[];
    try {
      workflowFolders = await readdir(packPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const workflowFolder of workflowFolders.sort((a, b) => a.localeCompare(b))) {
      if (!isValidWorkflowFolderSegment(workflowFolder)) continue;
      const workflowPath = join(packPath, workflowFolder);
      try {
        if (!(await stat(workflowPath)).isDirectory()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      let workflowEntries: string[];
      try {
        workflowEntries = await readdir(workflowPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const yamlFiles = workflowEntries
        .filter(entry => entry.endsWith('.yaml') || entry.endsWith('.yml'))
        .sort((a, b) => a.localeCompare(b));
      if (yamlFiles.length !== 1) continue;

      const yamlFilename = yamlFiles[0];
      const absolutePath = join(workflowPath, yamlFilename);
      let content: string;
      try {
        content = await readFile(absolutePath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const parsed = parseWorkflow(content, yamlFilename);
      const yamlStem = yamlFilename.replace(/\.ya?ml$/, '');
      const isMalformedTarget =
        parsed.workflow === null && (yamlStem === name || workflowFolder === name);
      if (parsed.workflow?.name !== name && !isMalformedTarget) continue;
      if (match !== null) {
        throw new Error(`Multiple packaged workflows declare the name '${name}'`);
      }
      match = {
        absolutePath,
        filename: `${pack}/${workflowFolder}/${yamlFilename}`,
        packaged: true,
        parsed,
      };
    }
  }
  return match;
}

async function findWorkflowAt(
  workflowsRoot: string,
  name: string
): Promise<RawWorkflowFile | null> {
  return (
    (await tryReadWorkflowAt(workflowsRoot, name)) ??
    (await findPackagedWorkflowAt(workflowsRoot, name))
  );
}

function isBundledWorkflowsRoot(workflowsRoot: string): boolean {
  return resolve(workflowsRoot) === resolve(dirname(getDefaultWorkflowsPath()));
}

function findBundledWorkflow(
  name: string
): { filename: string; parsed: ReturnType<typeof parseWorkflow> } | null {
  const direct = BUNDLED_WORKFLOWS[name];
  if (direct !== undefined) {
    const filename = `${name}.yaml`;
    const parsed = parseWorkflow(direct, filename);
    if (parsed.error !== null || parsed.workflow?.name === name) {
      return { filename, parsed };
    }
  }

  let match: {
    filename: string;
    parsed: ReturnType<typeof parseWorkflow>;
  } | null = null;
  for (const [filenameStem, content] of Object.entries(BUNDLED_WORKFLOWS)) {
    if (filenameStem === name) continue;
    const filename = `${filenameStem}.yaml`;
    const parsed = parseWorkflow(content, filename);
    if (parsed.workflow?.name !== name) continue;
    if (match !== null) throw new Error(`Multiple bundled workflows declare the name '${name}'`);
    match = { filename, parsed };
  }
  return match;
}
import * as conversationDb from '@archon/core/db/conversations';
import * as codebaseDb from '@archon/core/db/codebases';
import * as envVarDb from '@archon/core/db/env-vars';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as workflowDb from '@archon/core/db/workflows';
import * as workflowEventDb from '@archon/core/db/workflow-events';
import { queryUsageReport, UsageReportQueryError } from '@archon/core/db/usage-report';
import type { UsageReport } from '@archon/core/schemas/usage-report';
import * as messageDb from '@archon/core/db/messages';
import * as userDb from '@archon/core/db/users';
import * as workflowEnvDb from '@archon/core/db/workflow-envs';
import * as workflowNodeMessageDb from '@archon/core/db/workflow-node-messages';
import * as workflowPendingInteractionDb from '@archon/core/db/workflow-pending-interactions';
import {
  abandonWorkflow,
  answerAskHuman,
  approveWorkflow,
  AskHumanRunNotFoundError,
  confirmPermission,
  PermissionAuthenticationRequiredError,
  PermissionForbiddenError,
  PermissionRunNotFoundError,
  reviewOpenWorkflow,
  rejectWorkflow,
  resumeWorkflow,
  resetWorkflowNodeSessions,
} from '@archon/core/operations/workflow-operations';
import { getAuth, isWebAuthEnabled, getSignupMode, isApiGateEnabled } from '../auth';
import { errorSchema } from './schemas/common.schemas';
import { updateCheckResponseSchema } from './schemas/system.schemas';
import {
  workflowListResponseSchema,
  validateWorkflowBodySchema,
  validateWorkflowResponseSchema,
  getWorkflowResponseSchema,
  saveWorkflowBodySchema,
  deleteWorkflowResponseSchema,
  commandListResponseSchema,
  workflowRunListResponseSchema,
  workflowRunDetailSchema,
  workflowRunByWorkerResponseSchema,
  cancelWorkflowRunResponseSchema,
  workflowRunActionResponseSchema,
  testWorkflowRunCallbackResponseSchema,
  retryWorkflowNodeParamsSchema,
  retryWorkflowNodeBodySchema,
  retryWorkflowNodePreviewResponseSchema,
  retryWorkflowNodeResponseSchema,
  workflowNodeMessagesParamsSchema,
  workflowNodeMessagesQuerySchema,
  workflowNodeMessagesResponseSchema,
  workflowNodeMessageResponseSchema,
  workflowNodeMessageDetailParamsSchema,
  dashboardRunsResponseSchema,
  dashboardRunsQuerySchema,
  workflowRunsQuerySchema,
  approveWorkflowRunBodySchema,
  askAnswerRequestSchema,
  permissionConfirmRequestSchema,
  rejectWorkflowRunBodySchema,
  resetWorkflowNodeSessionsParamsSchema,
  resetWorkflowNodeSessionsQuerySchema,
  resetWorkflowNodeSessionsResponseSchema,
  listArtifactsResponseSchema,
  reviewFeedbackBodySchema,
  reviewFeedbackResponseSchema,
  sendWorkflowNodeBodySchema,
  sendWorkflowNodeResponseSchema,
  interruptWorkflowNodeResponseSchema,
  steeringErrorSchema,
  readWorkflowNodeQueueParamsSchema,
  readWorkflowNodeQueueResponseSchema,
  withdrawWorkflowNodeParamsSchema,
  withdrawWorkflowNodeResponseSchema,
} from './schemas/workflow.schemas';
import {
  workflowEnvWorkflowParamsSchema,
  workflowEnvParamsSchema,
  workflowEnvErrorSchema,
  workflowEnvListResponseSchema,
  workflowEnvDetailResponseSchema,
  createWorkflowEnvBodySchema,
  updateWorkflowEnvBodySchema,
  deleteWorkflowEnvResponseSchema,
  workflowEnvPreviewQuerySchema,
  workflowEnvPreviewResponseSchema,
} from './schemas/workflow-env.schemas';
import { usageQuerySchema, usageReportResponseSchema } from './schemas/usage.schemas';
import {
  conversationListResponseSchema,
  listConversationsQuerySchema,
  conversationIdParamsSchema,
  conversationSchema,
  createConversationBodySchema,
  createConversationResponseSchema,
  updateConversationBodySchema,
  successResponseSchema,
  messageListResponseSchema,
  listMessagesQuerySchema,
  dispatchResponseSchema,
} from './schemas/conversation.schemas';
import {
  codebaseListResponseSchema,
  codebaseSchema,
  codebaseIdParamsSchema,
  addCodebaseBodySchema,
  deleteCodebaseResponseSchema,
  codebaseEnvVarsResponseSchema,
  setEnvVarBodySchema,
  codebaseEnvVarParamsSchema,
  envVarMutationResponseSchema,
} from './schemas/codebase.schemas';
import {
  updateAssistantConfigBodySchema,
  updateAssistantConfigResponseSchema,
  configResponseSchema,
  updateTiersBodySchema,
  updateAliasesBodySchema,
  codebaseEnvironmentsResponseSchema,
} from './schemas/config.schemas';
import { TIER_NAMES } from '@archon/workflows/model-validation';
import {
  providerListResponseSchema,
  piModelListResponseSchema,
  opencodeCredentialListResponseSchema,
} from './schemas/provider.schemas';
import {
  authStatusResponseSchema,
  deviceStartResponseSchema,
  devicePollBodySchema,
  devicePollResponseSchema,
  githubConnectionStatusSchema,
  githubDisconnectResponseSchema,
} from './schemas/auth.schemas';
import {
  providerKeyListResponseSchema,
  providerKeyParamsSchema,
  providerKeySetBodySchema,
  providerKeySetResponseSchema,
  providerKeyDeleteResponseSchema,
  providerOAuthStartResponseSchema,
  providerOAuthPollBodySchema,
  providerOAuthPollResponseSchema,
} from './schemas/provider-key.schemas';
import {
  userAiPrefsResponseSchema,
  updateUserTiersBodySchema,
  updateUserAliasesBodySchema,
  updateUserDefaultBodySchema,
} from './schemas/user-ai-prefs.schemas';
import { mapDeviceFlowErrorToPollStatus } from './auth-poll-status';
import {
  getProviderInfoList,
  isRegisteredProvider,
  listPiModels,
  introspectOpencodeCredentials,
} from '@archon/providers';
import { messageSchema } from './schemas/conversation.schemas';
import {
  workflowRunSchema,
  dashboardWorkflowRunSchema,
  workflowRunStatusSchema,
} from './schemas/workflow.schemas';
import { gitChangesRoute } from './git/changes-route';
import { handleGitChanges } from './git/changes-handler';
import { gitLogRoute } from './git/log-route';
import { handleGitLog } from './git/log-handler';
import { gitDiffRoute } from './git/diff-route';
import { handleGitDiff } from './git/diff-handler';
import { handleGitFile } from './git/file-handler';

// Read app version: use build-time constant in binary, package.json in dev
let appVersion = 'unknown';
if (BUNDLED_IS_BINARY) {
  appVersion = BUNDLED_VERSION;
} else {
  try {
    const pkgContent = readFileSync(join(import.meta.dir, '../../../../package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent) as { version?: string };
    appVersion = pkg.version ?? 'unknown';
  } catch (err) {
    getLog().debug(
      { err, path: join(import.meta.dir, '../../../../package.json') },
      'api.version_read_failed'
    );
  }
}

type WorkflowSource = 'project' | 'bundled' | 'global';

/**
 * Resolve the on-disk artifact directory for a run, for EVERY project kind
 * (#2200).
 *
 * Both artifact routes previously did `parseOwnerRepo(codebase.name)` alone,
 * which returns null for a folder project (display name, no slash) and for a
 * no-remote local repo (bare basename) — so artifact browsing was silently dead
 * for two of the three project kinds Archon can register.
 *
 * Order mirrors the executor: a persisted `output_root` wins outright (a
 * codebase renamed since the run must not orphan its artifacts, #1192);
 * otherwise the shared `resolveProjectStorageKey` derives the key. Returns null
 * only when there is no codebase row to derive from at all — callers surface
 * that as an explicit 404 rather than an empty success.
 *
 * The `cwd` argument is `codebase.default_cwd` here, while the executor passes
 * the RUN's cwd (which inside a worktree is the worktree path). That only
 * differs for the `{ kind: 'cwd' }` fallback, and every run since #2200
 * persists `output_root`, so this path never re-derives for a modern run.
 */
function resolveRunArtifactDir(
  run: { output_root?: string | null },
  codebase: { kind?: string | null; name: string; default_cwd: string } | null,
  runId: string
): string | null {
  // The containment check belongs INSIDE this branch, not after it. A persisted
  // root is a cache of where the run wrote, not an authority: move ARCHON_HOME
  // (machine migration, restored backup, the documented ARCHON_DATA split) and
  // every stamped root is suddenly out-of-tree. Guarding after the fact would
  // hard-400 every historical run even when its artifacts sit re-derivable and
  // physically present under the new home — and `output_root` is write-once via
  // COALESCE, so the app could never clear the column to recover. Falling
  // through to re-derivation keeps the tree relocatable, which is how it behaved
  // before the column existed. Matches `continue.ts`.
  if (run.output_root && isInsideArchonHome(run.output_root)) {
    return getRunArtifactsDirForRoot(run.output_root, runId);
  }
  if (!codebase?.name) return null;
  return getRunArtifactsDirForKey(resolveProjectStorageKey(codebase, codebase.default_cwd), runId);
}

// =========================================================================
// OpenAPI route configs (module-scope — pure config, no runtime dependencies)
// =========================================================================

/** Helper to build a JSON error response entry for createRoute configs. */
function jsonError(description: string): {
  content: { 'application/json': { schema: typeof errorSchema } };
  description: string;
} {
  return { content: { 'application/json': { schema: errorSchema } }, description };
}

/**
 * Steering-route JSON error entry (issue #181): the nested
 * `{ success: false, error: { code, message } }` contract, never the flat
 * `errorSchema` shape used by legacy routes.
 */
function steeringJsonError(description: string): {
  content: { 'application/json': { schema: typeof steeringErrorSchema } };
  description: string;
} {
  return { content: { 'application/json': { schema: steeringErrorSchema } }, description };
}

const cwdQuerySchema = z.object({ cwd: z.string().optional() });
const workflowTargetQuerySchema = cwdQuerySchema.extend({
  source: z.enum(['project', 'global']).optional(),
});

const getWorkflowsRoute = createRoute({
  method: 'get',
  path: '/api/workflows',
  tags: ['Workflows'],
  summary: 'List available workflows',
  request: { query: cwdQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowListResponseSchema } },
      description: 'OK',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const validateWorkflowRoute = createRoute({
  method: 'post',
  path: '/api/workflows/validate',
  tags: ['Workflows'],
  summary: 'Validate a workflow definition without saving',
  request: {
    body: {
      content: { 'application/json': { schema: validateWorkflowBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: validateWorkflowResponseSchema } },
      description: 'Validation result',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const getWorkflowRoute = createRoute({
  method: 'get',
  path: '/api/workflows/{name}',
  tags: ['Workflows'],
  summary: 'Fetch a single workflow definition',
  request: {
    params: z.object({ name: z.string() }),
    query: cwdQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: getWorkflowResponseSchema } },
      description: 'Workflow definition',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const saveWorkflowRoute = createRoute({
  method: 'put',
  path: '/api/workflows/{name}',
  tags: ['Workflows'],
  summary: 'Save (create or update) a workflow',
  request: {
    params: z.object({ name: z.string() }),
    query: workflowTargetQuerySchema,
    body: { content: { 'application/json': { schema: saveWorkflowBodySchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: getWorkflowResponseSchema } },
      description: 'Saved workflow',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const deleteWorkflowRoute = createRoute({
  method: 'delete',
  path: '/api/workflows/{name}',
  tags: ['Workflows'],
  summary: 'Delete a user-defined workflow',
  request: {
    params: z.object({ name: z.string() }),
    query: workflowTargetQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: deleteWorkflowResponseSchema } },
      description: 'Deleted',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const getCommandsRoute = createRoute({
  method: 'get',
  path: '/api/commands',
  tags: ['Commands'],
  summary: 'List available command names for the workflow node palette',
  request: { query: cwdQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: commandListResponseSchema } },
      description: 'OK',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

/** Helper for ENV error responses that include optional safe detail. */
function jsonEnvError(description: string): {
  content: { 'application/json': { schema: typeof workflowEnvErrorSchema } };
  description: string;
} {
  return {
    content: { 'application/json': { schema: workflowEnvErrorSchema } },
    description,
  };
}

const listWorkflowEnvsRoute = createRoute({
  method: 'get',
  path: '/api/workflows/{name}/envs',
  tags: ['Workflow Envs'],
  summary: 'List named ENV overlays for a workflow',
  request: { params: workflowEnvWorkflowParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowEnvListResponseSchema } },
      description: 'ENV summaries without patches',
    },
    400: jsonEnvError('Invalid workflow name'),
    500: jsonEnvError('Server error'),
  },
});

const getWorkflowEnvRoute = createRoute({
  method: 'get',
  path: '/api/workflows/{name}/envs/{envId}',
  tags: ['Workflow Envs'],
  summary: 'Fetch a single workflow ENV overlay',
  request: { params: workflowEnvParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowEnvDetailResponseSchema } },
      description: 'Full ENV row',
    },
    400: jsonEnvError('Invalid path'),
    404: jsonEnvError('ENV not found'),
    500: jsonEnvError('Server error'),
  },
});

const createWorkflowEnvRoute = createRoute({
  method: 'post',
  path: '/api/workflows/{name}/envs',
  tags: ['Workflow Envs'],
  summary: 'Create a named workflow ENV overlay',
  request: {
    params: workflowEnvWorkflowParamsSchema,
    body: {
      content: { 'application/json': { schema: createWorkflowEnvBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: workflowEnvDetailResponseSchema } },
      description: 'Created ENV',
    },
    400: jsonEnvError('Invalid request'),
    409: jsonEnvError('ENV name conflict'),
    500: jsonEnvError('Server error'),
  },
});

const updateWorkflowEnvRoute = createRoute({
  method: 'patch',
  path: '/api/workflows/{name}/envs/{envId}',
  tags: ['Workflow Envs'],
  summary: 'Update a workflow ENV overlay (whole-document patches replace)',
  request: {
    params: workflowEnvParamsSchema,
    body: {
      content: { 'application/json': { schema: updateWorkflowEnvBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowEnvDetailResponseSchema } },
      description: 'Updated ENV',
    },
    400: jsonEnvError('Invalid request'),
    404: jsonEnvError('ENV not found'),
    409: jsonEnvError('ENV name conflict'),
    500: jsonEnvError('Server error'),
  },
});

const deleteWorkflowEnvRoute = createRoute({
  method: 'delete',
  path: '/api/workflows/{name}/envs/{envId}',
  tags: ['Workflow Envs'],
  summary: 'Delete a workflow ENV overlay',
  request: { params: workflowEnvParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: deleteWorkflowEnvResponseSchema } },
      description: 'Delete result',
    },
    400: jsonEnvError('Invalid path'),
    500: jsonEnvError('Server error'),
  },
});

const previewWorkflowEnvRoute = createRoute({
  method: 'get',
  path: '/api/workflows/{name}/env-preview',
  tags: ['Workflow Envs'],
  summary: 'Preview ENV overlay targets and resolved request metadata',
  request: {
    params: workflowEnvWorkflowParamsSchema,
    query: workflowEnvPreviewQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowEnvPreviewResponseSchema } },
      description: 'Non-authoritative preview',
    },
    400: jsonEnvError('Invalid request or overlay'),
    404: jsonEnvError('Workflow not found'),
    500: jsonEnvError('Server error'),
  },
});

// =========================================================================
// Conversation route configs
// =========================================================================

const getConversationsRoute = createRoute({
  method: 'get',
  path: '/api/conversations',
  tags: ['Conversations'],
  summary: 'List conversations',
  request: { query: listConversationsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: conversationListResponseSchema } },
      description: 'OK',
    },
    500: jsonError('Server error'),
  },
});

const getConversationRoute = createRoute({
  method: 'get',
  path: '/api/conversations/{id}',
  tags: ['Conversations'],
  summary: 'Get a conversation by platform conversation ID',
  request: { params: conversationIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: conversationSchema } },
      description: 'Conversation',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const createConversationRoute = createRoute({
  method: 'post',
  path: '/api/conversations',
  tags: ['Conversations'],
  summary: 'Create a new conversation',
  request: {
    body: {
      content: { 'application/json': { schema: createConversationBodySchema } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: createConversationResponseSchema } },
      description: 'Created conversation',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const updateConversationRoute = createRoute({
  method: 'patch',
  path: '/api/conversations/{id}',
  tags: ['Conversations'],
  summary: 'Update a conversation (title)',
  request: {
    params: conversationIdParamsSchema,
    body: {
      content: { 'application/json': { schema: updateConversationBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: successResponseSchema } },
      description: 'Updated',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const deleteConversationRoute = createRoute({
  method: 'delete',
  path: '/api/conversations/{id}',
  tags: ['Conversations'],
  summary: 'Soft-delete a conversation',
  request: { params: conversationIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: successResponseSchema } },
      description: 'Deleted',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/api/conversations/{id}/messages',
  tags: ['Conversations'],
  summary: 'List message history for a conversation',
  request: {
    params: conversationIdParamsSchema,
    query: listMessagesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: messageListResponseSchema } },
      description: 'Message list',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

// Body validation is handled manually in the handler (multipart vs JSON branching).
// Declaring both content types in the OpenAPI route causes @hono/zod-openapi to
// validate JSON bodies against the multipart schema. We keep `request.body` empty
// and document the schemas via the OpenAPI spec comments instead.
const sendMessageRoute = createRoute({
  method: 'post',
  path: '/api/conversations/{id}/message',
  tags: ['Conversations'],
  summary: 'Send a message (JSON or multipart with file uploads)',
  description:
    'Accepts `application/json` with `{ message: string }` or `multipart/form-data` ' +
    'with a `message` field and optional file attachments (max 5 files, 10 MB each).',
  request: {
    params: conversationIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: dispatchResponseSchema } },
      description: 'Accepted',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

// =========================================================================
// Codebase route configs
// =========================================================================

const listCodebasesRoute = createRoute({
  method: 'get',
  path: '/api/codebases',
  tags: ['Codebases'],
  summary: 'List registered codebases',
  responses: {
    200: {
      content: { 'application/json': { schema: codebaseListResponseSchema } },
      description: 'OK',
    },
    500: jsonError('Server error'),
  },
});

const getCodebaseRoute = createRoute({
  method: 'get',
  path: '/api/codebases/{id}',
  tags: ['Codebases'],
  summary: 'Get a codebase by ID',
  request: { params: codebaseIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: codebaseSchema } },
      description: 'Codebase',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const addCodebaseRoute = createRoute({
  method: 'post',
  path: '/api/codebases',
  tags: ['Codebases'],
  summary: 'Register a codebase (clone from URL or register local path)',
  request: {
    body: {
      content: { 'application/json': { schema: addCodebaseBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: codebaseSchema } },
      description: 'Codebase already existed',
    },
    201: {
      content: { 'application/json': { schema: codebaseSchema } },
      description: 'Codebase created',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const deleteCodebaseRoute = createRoute({
  method: 'delete',
  path: '/api/codebases/{id}',
  tags: ['Codebases'],
  summary: 'Delete a codebase and clean up associated resources',
  request: { params: codebaseIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: deleteCodebaseResponseSchema } },
      description: 'Deleted',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

// =========================================================================
// Codebase env var route configs
// =========================================================================

const listEnvVarsRoute = createRoute({
  method: 'get',
  path: '/api/codebases/{id}/env',
  tags: ['Codebases'],
  summary: 'List env vars for a codebase',
  request: { params: codebaseIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: codebaseEnvVarsResponseSchema } },
      description: 'Env vars for codebase',
    },
    404: jsonError('Codebase not found'),
  },
});

const setEnvVarRoute = createRoute({
  method: 'put',
  path: '/api/codebases/{id}/env',
  tags: ['Codebases'],
  summary: 'Set (upsert) an env var for a codebase',
  request: {
    params: codebaseIdParamsSchema,
    body: { content: { 'application/json': { schema: setEnvVarBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: envVarMutationResponseSchema } },
      description: 'Env var set',
    },
    404: jsonError('Codebase not found'),
  },
});

const deleteEnvVarRoute = createRoute({
  method: 'delete',
  path: '/api/codebases/{id}/env/{key}',
  tags: ['Codebases'],
  summary: 'Delete an env var from a codebase',
  request: { params: codebaseEnvVarParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: envVarMutationResponseSchema } },
      description: 'Env var deleted',
    },
    404: jsonError('Codebase not found'),
  },
});

// =========================================================================
// Workflow run route configs
// =========================================================================

// Body validation is handled manually in the handler (multipart vs JSON
// branching), mirroring sendMessageRoute. The OpenAPI spec describes the
// shapes via the description; declaring `request.body` would force JSON
// validation to run on multipart payloads and reject them.
const runWorkflowRoute = createRoute({
  method: 'post',
  path: '/api/workflows/{name}/run',
  tags: ['Workflows'],
  summary: 'Run a workflow via the orchestrator (JSON or multipart with file uploads)',
  description:
    'Accepts `application/json` with `{ conversationId, message, inputs?, envId? }` or ' +
    '`multipart/form-data` with `conversationId`, `message`, an optional `inputs` field ' +
    'holding the same map JSON-encoded, an optional plain `envId` string, and optional ' +
    'file attachments (max 5 files, 10 MB each). `inputs` supplies values for the ' +
    "workflow's declared `inputs:` (#2554); it is validated against the declaration " +
    'before any worktree, clone, or AI cost, so a missing required input or an ' +
    'undeclared key is refused up front. An omitted or empty `envId` means YAML-only; ' +
    'present non-string values (including JSON `null` and duplicated multipart fields) ' +
    "→ `400 { error: 'invalid_env_id' }` with no ENV lookup. A non-empty string `envId` " +
    'freezes the ENV row (id/name/workflow/patches) after request parse and before file ' +
    'or run-start message persistence, then hands the candidate to the orchestrator ' +
    'out-of-band. Missing id → `env_not_found`; workflow mismatch → `env_workflow_mismatch`. ' +
    'Compatibility/provider/profile/graph errors still travel through the dispatch/SSE ' +
    'path, not as synchronous Start 400s.',
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: dispatchResponseSchema } },
      description: 'Accepted',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const listRunArtifactsRoute = createRoute({
  method: 'get',
  path: '/api/runs/{runId}/artifacts',
  tags: ['Workflows'],
  summary: "List a run's artifact files",
  description:
    "Walks the run's artifact directory and returns relative file paths with size + " +
    'mtime. Drives the console Artifacts tab. Resolves for every project kind — ' +
    "`owner/repo`, `_local/<basename>`, and `_folder/<slug>` — preferring the run's " +
    'persisted `output_root` and re-deriving from the codebase when it is absent or ' +
    'no longer inside ARCHON_HOME. Returns `{ files: [] }` only when the location ' +
    'resolved and the run genuinely wrote nothing; returns 404 when the output ' +
    'location cannot be resolved at all.',
  request: {
    params: z.object({ runId: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listArtifactsResponseSchema } },
      description: 'OK',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const getDashboardRunsRoute = createRoute({
  method: 'get',
  path: '/api/dashboard/runs',
  tags: ['Workflows'],
  summary: 'List enriched workflow runs for the Command Center dashboard',
  request: { query: dashboardRunsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: dashboardRunsResponseSchema } },
      description: 'OK',
    },
    500: jsonError('Server error'),
  },
});

const getWorkflowRunByWorkerRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/by-worker/{platformId}',
  tags: ['Workflows'],
  summary: 'Look up a workflow run by its worker conversation platform ID',
  request: { params: z.object({ platformId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunByWorkerResponseSchema } },
      description: 'Workflow run',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const listWorkflowRunsRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs',
  tags: ['Workflows'],
  summary: 'List workflow runs',
  request: { query: workflowRunsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunListResponseSchema } },
      description: 'OK',
    },
    500: jsonError('Server error'),
  },
});

const cancelWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/cancel',
  tags: ['Workflows'],
  summary: 'Cancel a workflow run',
  request: { params: z.object({ runId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: cancelWorkflowRunResponseSchema } },
      description: 'Cancelled',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const testWorkflowRunCallbackRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/callback/test',
  tags: ['Workflows'],
  summary: 'Queue a test callback for an existing workflow run',
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: {
    202: {
      content: { 'application/json': { schema: testWorkflowRunCallbackResponseSchema } },
      description: 'Test callback accepted',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const resumeWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/resume',
  tags: ['Workflows'],
  summary: 'Resume a failed workflow run (dispatches resume on the parent web conversation)',
  request: { params: z.object({ runId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunActionResponseSchema } },
      description: 'Resumed',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const retryWorkflowNodePreviewRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/retry/preview',
  tags: ['Workflows'],
  summary: 'Preview checkout state before retrying one DAG node',
  request: { params: retryWorkflowNodeParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: retryWorkflowNodePreviewResponseSchema } },
      description: 'Retry preview',
    },
    400: jsonError('Bad request'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});

const retryWorkflowNodeRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/retry',
  tags: ['Workflows'],
  summary: 'Retry one DAG node and its descendants for a failed, cancelled, or completed run',
  request: {
    params: retryWorkflowNodeParamsSchema,
    body: {
      content: { 'application/json': { schema: retryWorkflowNodeBodySchema } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: retryWorkflowNodeResponseSchema } },
      description: 'Retry accepted and dispatched',
    },
    400: jsonError('Bad request'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});

const getWorkflowNodeMessagesRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/messages',
  tags: ['Workflows'],
  summary: 'List one workflow node transcript',
  request: {
    params: workflowNodeMessagesParamsSchema,
    query: workflowNodeMessagesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowNodeMessagesResponseSchema } },
      description: 'Workflow node transcript in sequence order',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const getWorkflowNodeMessageDetailRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/messages/{messageId}',
  tags: ['Workflows'],
  summary: 'Read one retained workflow node transcript message',
  request: { params: workflowNodeMessageDetailParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowNodeMessageResponseSchema } },
      description: 'Full retained transcript row',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const abandonWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/abandon',
  tags: ['Workflows'],
  summary: 'Abandon a workflow run (mark as cancelled)',
  request: { params: z.object({ runId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunActionResponseSchema } },
      description: 'Abandoned',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const approveWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/approve',
  tags: ['Workflows'],
  summary: 'Approve a paused workflow run',
  request: {
    params: z.object({ runId: z.string() }),
    body: { content: { 'application/json': { schema: approveWorkflowRunBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunActionResponseSchema } },
      description: 'Approved',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const reviewOpenWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/review-open',
  tags: ['Workflows'],
  summary: 'Re-open a paused plannotator_gate review surface',
  request: {
    params: z.object({ runId: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            document: z.string(),
            nodeId: z.string(),
            phase: z.literal('opening'),
            continuation: z.literal('caller_resume'),
            message: z.string(),
          }),
        },
      },
      description: 'Review re-open requested',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const rejectWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/reject',
  tags: ['Workflows'],
  summary: 'Reject a paused workflow run',
  request: {
    params: z.object({ runId: z.string() }),
    body: { content: { 'application/json': { schema: rejectWorkflowRunBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunActionResponseSchema } },
      description: 'Rejected',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const answerAskHumanRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/ask/{requestId}/answer',
  tags: ['Workflows'],
  summary: 'Answer or decline a pending AskHuman interaction',
  request: {
    params: z.object({
      runId: z.string().min(1),
      requestId: z.string().min(1),
    }),
    body: {
      content: {
        'application/json': { schema: askAnswerRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: workflowRunActionResponseSchema },
      },
      description: 'AskHuman answer accepted',
    },
    400: jsonError('Invalid AskHuman answer'),
    401: jsonError('Authentication required'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});

const confirmPermissionRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/permissions/{callId}/confirm',
  tags: ['Workflows'],
  summary: 'Confirm a pending permission interaction',
  request: {
    params: z.object({
      runId: z.string().min(1),
      callId: z.string().min(1),
    }),
    body: {
      content: {
        'application/json': { schema: permissionConfirmRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: workflowRunActionResponseSchema },
      },
      description: 'Permission confirmation accepted',
    },
    400: jsonError('Invalid permission confirmation'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});

const sendWorkflowNodeRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/send',
  tags: ['Workflows'],
  summary: 'Queue operator guidance for a running workflow node',
  description:
    'Accepts operator guidance for a live in-process agent node without interrupting ' +
    'the current provider turn. Queued messages drain at the next natural ' +
    'provider-turn boundary on the same provider session; `intent: "send_now"` ' +
    'queues identically until an idle-after-interrupt state exists. Idempotent on ' +
    '`message_id` — a duplicate replays the original receipt. Rejections leave the ' +
    'run, queue, and transcript unchanged.',
  request: {
    params: z.object({
      runId: z.string().min(1),
      nodeId: z.string().min(1),
    }),
    body: {
      content: { 'application/json': { schema: sendWorkflowNodeBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: sendWorkflowNodeResponseSchema } },
      description: 'Guidance accepted onto the steering queue',
    },
    400: steeringJsonError('Malformed or schema-invalid payload'),
    401: steeringJsonError('Authentication required'),
    403: steeringJsonError('Forbidden'),
    404: steeringJsonError('Unknown run or node'),
    409: steeringJsonError('Node no longer running'),
    422: steeringJsonError('No live steering session in this process'),
  },
});

const interruptWorkflowNodeRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/interrupt',
  tags: ['Workflows'],
  summary: 'Interrupt the current provider turn of a running workflow node',
  description:
    'Stops the live provider turn of an interrupt-capable in-process agent node ' +
    'without cancelling the run. The request awaits the engine classification ' +
    'and returns the ACTUAL settled sub-state: `idle-after-interrupt` (the turn ' +
    'stopped and the node awaits Send now on the same provider session) or ' +
    '`generating` (the turn already ended naturally or queued guidance drained ' +
    'it before Stop took effect). Terminal outcomes map to the steering error ' +
    'shape — 409 `node_finished`, 422 `not_steerable_here`. Has no request body.',
  request: {
    params: z.object({
      runId: z.string().min(1),
      nodeId: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: interruptWorkflowNodeResponseSchema } },
      description: 'Interrupt settled — the classified sub-state',
    },
    401: steeringJsonError('Authentication required'),
    403: steeringJsonError('Forbidden'),
    404: steeringJsonError('Unknown run or node'),
    409: steeringJsonError('Node no longer running'),
    422: steeringJsonError('No live steering session in this process'),
    500: steeringJsonError('Server error'),
  },
});

const withdrawWorkflowNodeRoute = createRoute({
  method: 'delete',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}',
  tags: ['Workflows'],
  summary: 'Withdraw a queued guidance message from a running workflow node',
  description:
    "Removes one still-pending operator message from the node's in-process " +
    'steering queue. Bodyless; idempotent on `messageId` — a repeat, ' +
    'already-drained, or never-seen id returns the same success receipt. ' +
    'Rejections leave the run, queue, and transcript unchanged.',
  request: {
    params: withdrawWorkflowNodeParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: withdrawWorkflowNodeResponseSchema } },
      description: 'Message withdrawn or already absent from the queue',
    },
    400: steeringJsonError('Malformed or schema-invalid request'),
    401: steeringJsonError('Authentication required'),
    403: steeringJsonError('Forbidden'),
    404: steeringJsonError('Unknown run or node'),
    409: steeringJsonError('Node no longer running'),
    422: steeringJsonError('No live steering session in this process'),
    500: steeringJsonError('Server error'),
  },
});

const readWorkflowNodeQueueRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/nodes/{nodeId}/queue',
  tags: ['Workflows'],
  summary: "Read a running workflow node's queued guidance snapshot",
  description:
    "Returns the node's in-process steering queue — only still-pending " +
    'operator messages, in receipt order. Bodyless and mutation-free: no ' +
    'request body, no query parameters, and the read never changes the run, ' +
    'queue, or transcript. Every outcome carries `Cache-Control: no-store`. ' +
    'Live and parked handles read normally; a closed handle or terminal ' +
    'run/node is 409, and a known non-terminal node with no in-process ' +
    'handle is 422.',
  request: {
    params: readWorkflowNodeQueueParamsSchema,
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: readWorkflowNodeQueueResponseSchema },
      },
      description: 'Still-pending queued guidance in receipt order',
    },
    400: steeringJsonError('Malformed or schema-invalid request'),
    401: steeringJsonError('Authentication required'),
    403: steeringJsonError('Forbidden'),
    404: steeringJsonError('Unknown run or node'),
    409: steeringJsonError('Node no longer running'),
    422: steeringJsonError('No live steering session in this process'),
    500: steeringJsonError('Server error'),
  },
});

const deleteWorkflowRunRoute = createRoute({
  method: 'delete',
  path: '/api/workflows/runs/{runId}',
  tags: ['Workflows'],
  summary: 'Delete a workflow run and its events',
  request: { params: z.object({ runId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunActionResponseSchema } },
      description: 'Deleted',
    },
    400: jsonError('Bad request'),
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const reviewFeedbackWorkflowRunRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/review-feedback',
  tags: ['Workflows'],
  summary: 'Submit inline Plannotator review feedback',
  request: {
    params: z.object({ runId: z.string() }),
    body: { content: { 'application/json': { schema: reviewFeedbackBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: reviewFeedbackResponseSchema } },
      description: 'Feedback accepted or idempotent duplicate',
    },
    400: jsonError('Bad request — wrong gate, session, or run state'),
    404: jsonError('Workflow run not found'),
    409: jsonError('Conflict — another submission already pending, or changed-body retry'),
    500: jsonError('Server error'),
  },
});

const resetWorkflowNodeSessionsRoute = createRoute({
  method: 'delete',
  path: '/api/workflows/{name}/node-sessions',
  tags: ['Workflows'],
  summary:
    'Reset persisted per-node provider sessions for a workflow. Optional scope and node filters narrow the deletion.',
  request: {
    params: resetWorkflowNodeSessionsParamsSchema,
    query: resetWorkflowNodeSessionsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: resetWorkflowNodeSessionsResponseSchema } },
      description: 'Sessions deleted (deleted count may be 0)',
    },
    400: jsonError('Bad request'),
    500: jsonError('Server error'),
  },
});

const getWorkflowRunRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}',
  tags: ['Workflows'],
  summary: 'Get workflow run details with events',
  request: { params: z.object({ runId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: workflowRunDetailSchema } },
      description: 'Workflow run detail',
    },
    404: jsonError('Not found'),
    500: jsonError('Server error'),
  },
});

const getUsageRoute = createRoute({
  method: 'get',
  path: '/api/usage',
  tags: ['Usage'],
  summary: 'Query workflow usage and cost aggregates',
  description:
    'Returns direct-run ledger aggregates for the installation. Half-open UTC ' +
    'range [from, to). With neither dates nor runId, defaults to the current UTC ' +
    'calendar month; with runId and no dates, queries the entire direct run. ' +
    'Cross-run ranges cannot exceed 366 days. At most 500 groups (overflow is a ' +
    '400 narrowing error, never silent truncation). Coverage is ledger-integrity ' +
    'only under date/project/run/node filters — it cannot detect provider passes ' +
    'that never emitted a usage event (`historicalBackfill` is always false). ' +
    'Child runs appear as their own direct-use rows; parents never include copied ' +
    'child charges. Uses the installation API auth gate (single-tenant visibility).',
  request: { query: usageQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: usageReportResponseSchema } },
      description: 'Usage report',
    },
    400: jsonError('Invalid filters, date range, or group overflow'),
    500: jsonError('Server error'),
  },
});

// =========================================================================
// Config / health route configs
// =========================================================================

const getConfigRoute = createRoute({
  method: 'get',
  path: '/api/config',
  tags: ['System'],
  summary: 'Get read-only configuration (safe subset)',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: configResponseSchema,
        },
      },
      description: 'Configuration',
    },
    500: jsonError('Server error'),
  },
});

const patchAssistantConfigRoute = createRoute({
  method: 'patch',
  path: '/api/config/assistants',
  tags: ['System'],
  summary: 'Update assistant configuration',
  request: {
    body: {
      content: { 'application/json': { schema: updateAssistantConfigBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: updateAssistantConfigResponseSchema } },
      description: 'Updated configuration',
    },
    400: jsonError('Invalid request body'),
    500: jsonError('Server error'),
  },
});

const patchTiersConfigRoute = createRoute({
  method: 'patch',
  path: '/api/config/tiers',
  tags: ['System'],
  summary: 'Update model-tier presets (small/medium/large)',
  description:
    'Writes the `tiers:` config to ~/.archon/config.yaml. Ungated (works on solo ' +
    'installs). Per-tier merge; a `null` tier value unsets it.',
  request: {
    body: {
      content: { 'application/json': { schema: updateTiersBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: configResponseSchema } },
      description: 'Updated configuration',
    },
    400: jsonError('Invalid request body'),
    500: jsonError('Server error'),
  },
});

const patchAliasesConfigRoute = createRoute({
  method: 'patch',
  path: '/api/config/aliases',
  tags: ['System'],
  summary: 'Update @custom model aliases',
  description:
    'Writes the `aliases:` config to ~/.archon/config.yaml. Ungated (works on solo ' +
    'installs). Per-alias merge; a `null` alias value unsets it.',
  request: {
    body: {
      content: { 'application/json': { schema: updateAliasesBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: configResponseSchema } },
      description: 'Updated configuration',
    },
    400: jsonError('Invalid alias name, unknown provider, or empty effort'),
    500: jsonError('Server error'),
  },
});

const getPiModelsRoute = createRoute({
  method: 'get',
  path: '/api/providers/pi/models',
  tags: ['System'],
  summary: "List Pi's model catalog (cost/reasoning metadata for the tier picker)",
  description:
    'Best-effort hint surface: returns `{ models: [] }` when the Pi catalog ' +
    'cannot be loaded, never an error — tier/alias saves must not depend on it.',
  responses: {
    200: {
      content: { 'application/json': { schema: piModelListResponseSchema } },
      description: 'Pi model catalog (metadata only)',
    },
  },
});

const getProvidersRoute = createRoute({
  method: 'get',
  path: '/api/providers',
  tags: ['System'],
  summary: 'List registered AI providers',
  responses: {
    200: {
      content: { 'application/json': { schema: providerListResponseSchema } },
      description: 'List of registered providers',
    },
  },
});

const getOpencodeCredentialsRoute = createRoute({
  method: 'get',
  path: '/api/providers/opencode/credentials',
  tags: ['System'],
  summary: "Introspect OpenCode's backend providers and auth state",
  description:
    "Proxies the embedded OpenCode server's provider introspection (catalog, " +
    'env var names, install-wide connected state). Heavyweight: starts the ' +
    'embedded server when not already running — call on demand from the ' +
    'settings card, never on passive page load (#1955).',
  responses: {
    200: {
      content: { 'application/json': { schema: opencodeCredentialListResponseSchema } },
      description: 'OpenCode backend providers (metadata only, no secrets)',
    },
    503: jsonError('Embedded OpenCode runtime unavailable'),
  },
});

const authStatusRoute = createRoute({
  method: 'get',
  path: '/api/auth/status',
  tags: ['Auth'],
  summary: 'Web auth availability + signup posture (no auth required)',
  responses: {
    200: {
      content: { 'application/json': { schema: authStatusResponseSchema } },
      description: 'Auth status',
    },
  },
});

const githubDeviceStartRoute = createRoute({
  method: 'post',
  path: '/api/auth/github/device/start',
  tags: ['Auth'],
  summary: 'Start the GitHub device flow for the current web user',
  responses: {
    200: {
      content: { 'application/json': { schema: deviceStartResponseSchema } },
      description: 'Device + user codes',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
    500: jsonError('Device flow not configured or failed'),
  },
});

const githubDevicePollRoute = createRoute({
  method: 'post',
  path: '/api/auth/github/device/poll',
  tags: ['Auth'],
  summary: 'Poll the GitHub device flow once for the current web user',
  request: {
    body: { content: { 'application/json': { schema: devicePollBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: devicePollResponseSchema } },
      description: 'Poll status',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
    500: jsonError('Device flow not configured or failed'),
  },
});

const githubConnectionStatusRoute = createRoute({
  method: 'get',
  path: '/api/auth/github',
  tags: ['Auth'],
  summary: 'GitHub connection status for the current web user',
  responses: {
    200: {
      content: { 'application/json': { schema: githubConnectionStatusSchema } },
      description: 'Connection status',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
  },
});

const githubDisconnectRoute = createRoute({
  method: 'delete',
  path: '/api/auth/github',
  tags: ['Auth'],
  summary: 'Disconnect the current web user’s GitHub identity',
  responses: {
    200: {
      content: { 'application/json': { schema: githubDisconnectResponseSchema } },
      description: 'Disconnected',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
  },
});

// ---- Per-user AI-provider credential (API-key) connect endpoints ----
const providerKeyListRoute = createRoute({
  method: 'get',
  path: '/api/auth/providers',
  tags: ['Auth'],
  summary: 'List the current web user’s connected AI-provider keys',
  responses: {
    200: {
      content: { 'application/json': { schema: providerKeyListResponseSchema } },
      description: 'Connections (metadata only) + connectable provider catalog',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
  },
});

const providerKeySetRoute = createRoute({
  method: 'put',
  path: '/api/auth/providers/{provider}',
  tags: ['Auth'],
  summary: 'Connect (upsert) an API key for a provider for the current web user',
  request: {
    params: providerKeyParamsSchema,
    body: { content: { 'application/json': { schema: providerKeySetBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: providerKeySetResponseSchema } },
      description: 'Key stored (encrypted); response carries no secret value',
    },
    400: jsonError('Unknown provider or empty key'),
    401: jsonError('Web auth required (X-Archon-User header missing)'),
    404: jsonError('Per-user provider keys not enabled on this install'),
  },
});

const providerKeyDeleteRoute = createRoute({
  method: 'delete',
  path: '/api/auth/providers/{provider}',
  tags: ['Auth'],
  summary: 'Disconnect the current web user’s key for a provider',
  request: { params: providerKeyParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: providerKeyDeleteResponseSchema } },
      description: 'Disconnected (idempotent)',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
    404: jsonError('Per-user provider keys not enabled on this install'),
  },
});

const providerOAuthStartRoute = createRoute({
  method: 'post',
  path: '/api/auth/providers/{provider}/oauth/start',
  tags: ['Auth'],
  summary: 'Begin a subscription (OAuth) login for the current web user',
  request: { params: providerKeyParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: providerOAuthStartResponseSchema } },
      description: 'Login session started (mode + URL/user-code)',
    },
    400: jsonError('Provider does not support subscription login'),
    401: jsonError('Web auth required (X-Archon-User header missing)'),
    404: jsonError('Per-user provider keys not enabled on this install'),
    503: jsonError('OAuth callback port still held by a previous login attempt — retry shortly'),
  },
});

const providerOAuthPollRoute = createRoute({
  method: 'post',
  path: '/api/auth/providers/{provider}/oauth/poll',
  tags: ['Auth'],
  summary: 'Poll a subscription login session (submit pasted code for manual flows)',
  request: {
    params: providerKeyParamsSchema,
    body: { content: { 'application/json': { schema: providerOAuthPollBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: providerOAuthPollResponseSchema } },
      description: 'Poll status',
    },
    401: jsonError('Web auth required (X-Archon-User header missing)'),
    404: jsonError('Per-user provider keys not enabled on this install'),
  },
});

const userAiPrefsGetRoute = createRoute({
  method: 'get',
  path: '/api/auth/me/ai-prefs',
  tags: ['Auth'],
  summary: 'Get the current web user’s AI preferences (tiers/aliases/default assistant)',
  responses: {
    200: {
      content: { 'application/json': { schema: userAiPrefsResponseSchema } },
      description: 'The user’s stored prefs (raw per-user layer, not merged with config)',
    },
    401: jsonError('Web auth required'),
    500: jsonError('Server error'),
  },
});

const userAiPrefsTiersRoute = createRoute({
  method: 'patch',
  path: '/api/auth/me/ai-prefs/tiers',
  tags: ['Auth'],
  summary: 'Update the current web user’s model-tier presets (per-key merge; null unsets)',
  request: {
    body: {
      content: { 'application/json': { schema: updateUserTiersBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: userAiPrefsResponseSchema } },
      description: 'Updated prefs',
    },
    400: jsonError('Unknown provider or empty effort'),
    401: jsonError('Web auth required'),
    500: jsonError('Server error'),
  },
});

const userAiPrefsAliasesRoute = createRoute({
  method: 'patch',
  path: '/api/auth/me/ai-prefs/aliases',
  tags: ['Auth'],
  summary: 'Update the current web user’s @custom aliases (per-key merge; null unsets)',
  request: {
    body: {
      content: { 'application/json': { schema: updateUserAliasesBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: userAiPrefsResponseSchema } },
      description: 'Updated prefs',
    },
    400: jsonError('Invalid alias name, unknown provider, or empty effort'),
    401: jsonError('Web auth required'),
    500: jsonError('Server error'),
  },
});

const userAiPrefsDefaultRoute = createRoute({
  method: 'patch',
  path: '/api/auth/me/ai-prefs/default',
  tags: ['Auth'],
  summary:
    'Set (or clear with null) the current web user’s default assistant + default chat model (written atomically; omitted model clears any pin)',
  request: {
    body: {
      content: { 'application/json': { schema: updateUserDefaultBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: userAiPrefsResponseSchema } },
      description: 'Updated prefs',
    },
    400: jsonError('Unknown provider'),
    401: jsonError('Web auth required'),
    500: jsonError('Server error'),
  },
});

const getCodebaseEnvironmentsRoute = createRoute({
  method: 'get',
  path: '/api/codebases/{id}/environments',
  tags: ['Codebases'],
  summary: 'List isolation environments for a codebase',
  request: { params: codebaseIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: codebaseEnvironmentsResponseSchema } },
      description: 'List of isolation environments',
    },
    404: jsonError('Codebase not found'),
    500: jsonError('Server error'),
  },
});

const getHealthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  summary: 'Health check',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              status: z.string(),
              adapter: z.string(),
              concurrency: z.record(z.string(), z.unknown()),
              runningWorkflows: z.number(),
              version: z.string().optional(),
              is_docker: z.boolean(),
              is_wsl: z.boolean(),
              wsl_distro: z.string().optional(),
              activePlatforms: z.array(z.string()).optional(),
              // Schema vintage (#2316) so a bug report can state which Archon build
              // created this database and which last applied schema to it. Omitted
              // when unrecorded or unreadable — health must answer regardless.
              schema: z
                .object({
                  createdAppVersion: z.string().nullable(),
                  appVersion: z.string(),
                  appliedAt: z.string().nullable(),
                })
                .optional(),
            })
            .openapi('HealthResponse'),
        },
      },
      description: 'Health status',
    },
  },
});

const getUpdateCheckRoute = createRoute({
  method: 'get',
  path: '/api/update-check',
  tags: ['System'],
  summary: 'Check for available updates',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: updateCheckResponseSchema,
        },
      },
      description: 'Update check result',
    },
  },
});

/**
 * Register all /api/* routes on the Hono app.
 */
export function registerApiRoutes(
  app: OpenAPIHono,
  webAdapter: WebAdapter,
  lockManager: ConversationLockManager,
  activePlatforms?: readonly string[]
): void {
  function apiError(
    c: Context,
    status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
    message: string,
    detail?: string
  ): Response {
    return c.json({ error: message, ...(detail ? { detail } : {}) }, status);
  }

  /**
   * Steering-route error body (issue #181 contract):
   * `{ success: false, error: { code, message } }` — consumers classify by
   * `code`, never prose. Operator message content is never included.
   */
  function steeringError(
    c: Context,
    status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    code: string,
    message: string
  ): Response {
    return c.json({ success: false as const, error: { code, message } }, status);
  }

  /**
   * Validate a run request's declared-inputs map (#2554): a flat object whose every
   * value is a string, which is exactly the shape `readSubrunMetadata` will accept back
   * off the run row. Refuse anything else here rather than let it be persisted into a
   * shape the engine silently reads as absent.
   *
   * An empty object resolves to `undefined` so a caller sending `{}` is treated as
   * having supplied nothing, taking every declared default.
   */
  function parseRunInputsField(
    raw: unknown
  ): { ok: true; inputs?: Record<string, string> } | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'inputs must be an object mapping input names to strings' };
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    const badKey = entries.find(([, value]) => typeof value !== 'string')?.[0];
    if (badKey !== undefined) {
      return { ok: false, error: `inputs value for '${badKey}' must be a string` };
    }
    return {
      ok: true,
      inputs: entries.length > 0 ? (raw as Record<string, string>) : undefined,
    };
  }

  /**
   * Optional Start `envId` (US-022 / US-008). Only absence (`undefined`) or an
   * empty/whitespace string means YAML-only. Present non-strings — including
   * JSON `null`, numbers, objects, and multipart duplicates (arrays under
   * `parseBody({ all: true })`) — are `invalid_env_id`. Never treat JSON null
   * as omission.
   */
  function parseOptionalEnvIdField(
    raw: unknown
  ): { ok: true; envId?: string } | { ok: false; error: 'invalid_env_id' } {
    if (raw === undefined) return { ok: true };
    if (Array.isArray(raw)) {
      return { ok: false, error: 'invalid_env_id' };
    }
    if (raw === null || typeof raw !== 'string') {
      return { ok: false, error: 'invalid_env_id' };
    }
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: true };
    return { ok: true, envId: trimmed };
  }

  /**
   * Validate that a caller-supplied `cwd` is rooted at a registered codebase path.
   * This prevents path traversal — callers cannot read/write outside known project roots.
   */
  async function validateCwd(cwd: string): Promise<boolean> {
    const codebases = await codebaseDb.listCodebases();
    const normalizedCwd = normalize(cwd);
    return codebases.some(cb => {
      const base = normalize(cb.default_cwd);
      return normalizedCwd === base || normalizedCwd.startsWith(base + sep);
    });
  }

  // CORS for Web UI — allow-all is fine for a single-developer tool.
  // Override with WEB_UI_ORIGIN env var to restrict if exposing publicly.
  app.use('/api/*', cors({ origin: process.env.WEB_UI_ORIGIN || '*' }));

  // Steering withdraw authentication must run before the install-wide API
  // gate as well as before OpenAPI parameter validation. Otherwise a default
  // gated install would return the generic API 401 shape before this route can
  // provide the nested steering error contract. DELETE-only and bodyless —
  // the send middleware stays POST-only and nothing here parses a body.
  app.use('/api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId', async (c, next) => {
    if (c.req.method !== 'DELETE') return next();
    if (isWebAuthEnabled() || isApiGateEnabled()) {
      const requester = await resolveAuthContext(c);
      if (!requester) {
        return steeringError(c, 401, 'unauthenticated', 'Authentication required');
      }
    }
    return next();
  });

  // Steering queue-read authentication + no-store run before the install-wide
  // API gate and before OpenAPI parameter validation, so a gated
  // unauthenticated caller receives the nested steering 401 rather than the
  // generic API gate shape. `Cache-Control: no-store` is set before either
  // the early 401 or the handler runs, so EVERY route outcome (200/401/404/
  // 409/422/500) carries it — snapshots of a live queue must never be served
  // from a shared cache. GET-only and bodyless: this middleware pattern also
  // matches the withdraw path's /queue/:messageId shape, so the method guard
  // is what keeps DELETE requests (and their responses) unaffected.
  app.use('/api/workflows/runs/:runId/nodes/:nodeId/queue', async (c, next) => {
    if (c.req.method !== 'GET') return next();
    c.header('Cache-Control', 'no-store');
    if (isWebAuthEnabled() || isApiGateEnabled()) {
      const requester = await resolveAuthContext(c);
      if (!requester) {
        return steeringError(c, 401, 'unauthenticated', 'Authentication required');
      }
    }
    return next();
  });

  // Server-side access gate: when web auth is enabled (and not opted out via
  // ARCHON_WEB_AUTH_REQUIRED=false), every /api/* request must resolve to an
  // identity or get 401 — this is what makes Better Auth the real access
  // boundary so a reverse-proxy auth sidecar can retire. Public exceptions:
  //   - /api/auth/* — the login/status/device-flow surface (can't gate login)
  //   - /api/health* — the Docker/uptime healthcheck MUST stay reachable
  // /webhooks/* (HMAC-verified) and /internal/* (loopback-guarded) are outside
  // /api/* and untouched. No-op when web auth is disabled (solo/local unchanged).
  // `resolveAuthContext`/`apiError` are function declarations below → hoisted.
  //
  // SECURITY: resolveAuthContext also accepts the trusted reverse-proxy header
  // (ARCHON_WEB_AUTH_HEADER, default `X-Archon-User`) as an identity. That header
  // is only safe to trust when the app is reachable solely through a proxy that
  // STRIPS it from inbound requests (or the app binds 127.0.0.1). If you retire
  // the proxy auth sidecar, the proxy MUST still strip that header — otherwise a
  // client can forge it and walk straight through this gate.
  const PUBLIC_API_GATE_PREFIXES = ['/api/auth/', '/api/health'];
  app.use('/api/*', async (c, next) => {
    if (!isApiGateEnabled()) return next();
    const path = c.req.path;
    if (PUBLIC_API_GATE_PREFIXES.some(p => path === p || path.startsWith(p))) return next();
    const ctx = await resolveAuthContext(c);
    if (!ctx) return apiError(c, 401, 'Authentication required');
    return next();
  });

  /**
   * Resolve the per-request auth context: `{ userId, role }`, or undefined when
   * no identity is present. This is the single chokepoint generalised from the
   * old header-only seam. Resolution order:
   *   1. Better Auth session (when web auth is enabled) → canonical
   *      remote_agent_users row via the 'web' platform identity.
   *   2. Trusted reverse-proxy header (ARCHON_WEB_AUTH_HEADER, default
   *      `X-Archon-User`) — kept for proxy deploys and the auth-service sidecar.
   *   3. undefined → NULL attribution, never elevated.
   *
   * `role` rides along on the canonical user row (defaults 'admin'); it is the
   * durable seam future per-resource scoping hooks into. Visibility stays open.
   *
   * SECURITY: header trust is only safe when Archon is reachable solely through
   * a reverse proxy (bind 127.0.0.1). The server logs a startup warning otherwise.
   */
  async function resolveAuthContext(
    c: Context
  ): Promise<{ userId: string; role: UserRole } | undefined> {
    // 1. Better Auth session first (no-op when web auth is disabled).
    const auth = getAuth();
    if (auth) {
      try {
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (session?.user) {
          const user = await userDb.findOrCreateUserByPlatformIdentity(
            'web',
            session.user.id,
            session.user.name ?? session.user.email ?? undefined
          );
          return { userId: user.id, role: user.role };
        }
      } catch (err) {
        // Session lookup failed (e.g. DB outage). Fall through to the header so a
        // proxy-authenticated deploy still resolves; absent that → undefined
        // (NULL attribution). warn (not error): this is the soft attribution seam
        // — it returns undefined rather than throwing. The /api/* gate maps that
        // undefined to a 401 (fail-closed); requireWebUser is the strict variant
        // that distinguishes a backend 503 from a missing identity.
        getLog().warn(
          { err: err as Error, path: requestLogPath(c.req.path) },
          'web.session_resolve_failed'
        );
      }
    }

    // 2. Trusted reverse-proxy header.
    const headerName = process.env.ARCHON_WEB_AUTH_HEADER || 'X-Archon-User';
    const headerVal = c.req.header(headerName)?.trim();
    if (!headerVal) return undefined;
    try {
      const user = await userDb.findOrCreateUserByPlatformIdentity('web', headerVal, headerVal);
      return { userId: user.id, role: user.role };
    } catch (err) {
      // Best-effort attribution: the header WAS present, but identity resolution
      // failed (e.g. DB outage). Fall back to NULL attribution rather than
      // failing the request. headerPresent distinguishes this from "no header".
      getLog().warn(
        { err: err as Error, headerPresent: true, path: requestLogPath(c.req.path) },
        'web.user_resolve_failed'
      );
      return undefined;
    }
  }

  /** Soft attribution: call sites that only need the user id, not the role. */
  async function resolveWebUserId(c: Context): Promise<string | undefined> {
    return (await resolveAuthContext(c))?.userId;
  }

  /**
   * Strict variant for endpoints that REQUIRE a web identity (connect/disconnect).
   * Session-first then header, mirroring resolveAuthContext, but distinguishing a
   * missing identity (401) from a backend failure resolving it (503) — a DB
   * outage must not masquerade as "authentication required". Returns the resolved
   * context, or the HTTP error Response the caller should return verbatim.
   */
  async function requireWebUser(
    c: Context,
    failMessage = 'Web authentication required'
  ): Promise<{ userId: string; role: UserRole } | { error: Response }> {
    // 1. Better Auth session.
    const auth = getAuth();
    if (auth) {
      let session: Awaited<ReturnType<typeof auth.api.getSession>> | undefined;
      try {
        session = await auth.api.getSession({ headers: c.req.raw.headers });
      } catch (err) {
        getLog().error({ err: err as Error }, 'web.session_resolve_failed');
        return { error: apiError(c, 503, 'Could not verify session — backend unavailable') };
      }
      if (session?.user) {
        try {
          const user = await userDb.findOrCreateUserByPlatformIdentity(
            'web',
            session.user.id,
            session.user.name ?? session.user.email ?? undefined
          );
          return { userId: user.id, role: user.role };
        } catch (err) {
          getLog().error({ err: err as Error }, 'web.user_resolve_failed');
          return { error: apiError(c, 503, 'Could not verify web identity — backend unavailable') };
        }
      }
    }

    // 2. Trusted reverse-proxy header.
    const headerName = process.env.ARCHON_WEB_AUTH_HEADER || 'X-Archon-User';
    const headerVal = c.req.header(headerName)?.trim();
    if (!headerVal) return { error: apiError(c, 401, failMessage) };
    try {
      const user = await userDb.findOrCreateUserByPlatformIdentity('web', headerVal, headerVal);
      return { userId: user.id, role: user.role };
    } catch (err) {
      getLog().error({ err: err as Error, headerPresent: true }, 'web.user_resolve_failed');
      return { error: apiError(c, 503, 'Could not verify web identity — backend unavailable') };
    }
  }

  // GET /api/auth/status - web auth availability + signup posture.
  // Public (no identity required): the web UI calls this before login to decide
  // whether to render the login gate at all. When web auth is enabled the
  // /api/auth/* mount explicitly next()s Archon-owned paths (this one included)
  // before Better Auth's handler runs, so the request reaches here untouched
  // (see isArchonOwnedAuthPath in index.ts).
  registerOpenApiRoute(authStatusRoute, c => {
    return c.json({ enabled: isWebAuthEnabled(), signup: getSignupMode() });
  });

  // ---- GitHub device-flow connect endpoints ----
  registerOpenApiRoute(githubDeviceStartRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to connect GitHub');
    if ('error' in web) return web.error;
    if (!isPerUserGitHubEnabled()) {
      return apiError(c, 500, 'Per-user GitHub is not enabled on this install');
    }
    try {
      const { clientId } = loadDeviceFlowConfig();
      const device = await startDeviceFlow(clientId);
      return c.json({
        device_code: device.device_code,
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        interval: device.interval,
        expires_in: device.expires_in,
      });
    } catch (err) {
      getLog().error({ err: err as Error }, 'auth.github_device_start_failed');
      return apiError(c, 500, 'Failed to start GitHub device flow');
    }
  });

  registerOpenApiRoute(githubDevicePollRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to connect GitHub');
    if ('error' in web) return web.error;
    if (!isPerUserGitHubEnabled()) {
      return apiError(c, 500, 'Per-user GitHub is not enabled on this install');
    }
    const { device_code: deviceCode } = getValidatedBody(c, devicePollBodySchema);
    try {
      const { clientId } = loadDeviceFlowConfig();
      const result = await pollDeviceFlowOnce(clientId, deviceCode);
      if (result.status === 'pending' || result.status === 'slow_down') {
        return c.json({ status: 'pending' as const });
      }
      if (result.status === 'error') {
        // Terminal device-flow codes → client-visible status (testable helper).
        return c.json({ status: mapDeviceFlowErrorToPollStatus(result.code), detail: result.code });
      }
      // authorized
      const { githubLogin } = await persistGithubConnection(web.userId, result.token);
      return c.json({ status: 'connected' as const, githubLogin });
    } catch (err) {
      if (err instanceof GithubIdentityConflictError) {
        return c.json({ status: 'error' as const, detail: err.message });
      }
      if (err instanceof DeviceFlowError) {
        return c.json({ status: 'error' as const, detail: err.code });
      }
      getLog().error({ err: err as Error }, 'auth.github_device_poll_failed');
      return apiError(c, 500, 'Failed to poll GitHub device flow');
    }
  });

  registerOpenApiRoute(githubConnectionStatusRoute, async c => {
    const web = await requireWebUser(c);
    if ('error' in web) return web.error;
    try {
      const record = await getUserGithubTokenRecord(web.userId);
      return c.json({ connected: record !== null, githubLogin: record?.github_login ?? null });
    } catch (err) {
      getLog().error({ err: err as Error, userId: web.userId }, 'auth.github_status_failed');
      return apiError(c, 500, 'Failed to read GitHub connection status');
    }
  });

  registerOpenApiRoute(githubDisconnectRoute, async c => {
    const web = await requireWebUser(c);
    if ('error' in web) return web.error;
    try {
      await deleteUserGithubToken(web.userId);
      return c.json({ success: true });
    } catch (err) {
      getLog().error({ err: err as Error, userId: web.userId }, 'auth.github_disconnect_failed');
      return apiError(c, 500, 'Failed to disconnect GitHub');
    }
  });

  // ---- Per-user AI-provider credential (API-key) connect endpoints ----
  // Gated on isPerUserProviderKeysEnabled() (TOKEN_ENCRYPTION_KEY). No response
  // carries a secret value: list/set return provider/kind/label only, delete
  // returns { success }.
  registerOpenApiRoute(providerKeyListRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to manage provider keys');
    if ('error' in web) return web.error;
    const available = listConnectableVendors();
    const subscriptionAvailable = [...SUBSCRIPTION_PROVIDERS].sort();
    if (!isPerUserProviderKeysEnabled()) {
      // Gate off: the console hides connect affordances on `enabled:false`;
      // the agents matrix still reports install-env/ambient readiness.
      return c.json({
        enabled: false,
        connections: [],
        available,
        subscriptionAvailable,
        agents: buildAgentCredentialMatrix([]),
      });
    }
    try {
      const connections = await listUserProviderKeys(web.userId);
      return c.json({
        enabled: true,
        connections,
        available,
        subscriptionAvailable,
        agents: buildAgentCredentialMatrix(connections),
      });
    } catch (err) {
      getLog().error({ err: err as Error, userId: web.userId }, 'auth.provider_keys_list_failed');
      return apiError(c, 500, 'Failed to list provider keys');
    }
  });

  registerOpenApiRoute(providerKeySetRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to manage provider keys');
    if ('error' in web) return web.error;
    if (!isPerUserProviderKeysEnabled()) {
      return apiError(c, 404, 'Per-user provider keys are not enabled on this install');
    }
    const provider = c.req.param('provider') ?? '';
    const { apiKey, label } = getValidatedBody(c, providerKeySetBodySchema);
    try {
      const result = await persistProviderApiKey(web.userId, provider, apiKey, label);
      return c.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof InvalidProviderKeyError) {
        // Caller error (unknown provider / blank key) — the validation message is
        // safe to surface and carries no secret.
        return apiError(c, 400, err.message);
      }
      // Encryption / DB failure — opaque 500, never echo the internal message.
      getLog().error(
        { err: err as Error, userId: web.userId, provider },
        'auth.provider_key_set_failed'
      );
      return apiError(c, 500, 'Failed to store provider key');
    }
  });

  registerOpenApiRoute(providerKeyDeleteRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to manage provider keys');
    if ('error' in web) return web.error;
    if (!isPerUserProviderKeysEnabled()) {
      return apiError(c, 404, 'Per-user provider keys are not enabled on this install');
    }
    const provider = normalizeCredentialVendor(c.req.param('provider') ?? '');
    // No catalog check here (unlike PUT): delete is an idempotent no-op, so an
    // unknown/misspelled vendor id simply removes nothing and returns ok.
    // Legacy agent-keyed ids normalize so `DELETE .../claude` removes the
    // migrated `anthropic` row.
    try {
      await deleteUserProviderKey(web.userId, provider);
      return c.json({ success: true });
    } catch (err) {
      getLog().error(
        { err: err as Error, userId: web.userId, provider },
        'auth.provider_key_delete_failed'
      );
      return apiError(c, 500, 'Failed to disconnect provider key');
    }
  });

  // ---- Subscription (OAuth) connect: start + poll ----
  // The bridge holds Pi's in-flight login() server-side; start returns the URL/
  // user-code, poll(code?) feeds a pasted code (manual flows) and reports status.
  // No response carries a secret. Paths are under /api/auth/providers/ so they're
  // already exempt from the Better Auth catch-all (isArchonOwnedAuthPath).
  registerOpenApiRoute(providerOAuthStartRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to connect a subscription');
    if ('error' in web) return web.error;
    if (!isPerUserProviderKeysEnabled()) {
      return apiError(c, 404, 'Per-user provider keys are not enabled on this install');
    }
    // Normalize legacy agent-keyed ids ('claude' → 'anthropic') like every
    // other credential entry point — SUBSCRIPTION_PROVIDERS is vendor-keyed.
    const provider = normalizeCredentialVendor(c.req.param('provider') ?? '');
    if (!SUBSCRIPTION_PROVIDERS.has(provider)) {
      return apiError(
        c,
        400,
        `Provider '${provider}' does not support subscription login. ` +
          `Subscription providers: ${[...SUBSCRIPTION_PROVIDERS].sort().join(', ')}.`
      );
    }
    try {
      const start = await startOAuth(web.userId, provider);
      return c.json(start);
    } catch (err) {
      // A leaked callback port from a previous attempt is an expected,
      // retryable condition — log it at warn under its own event (an
      // error-level `…_failed` would pollute error dashboards on multi-user
      // installs) and surface the actionable message as a 503 instead of an
      // opaque 500 (#1963).
      if (err instanceof OAuthCallbackPortBusyError) {
        getLog().warn({ userId: web.userId, provider }, 'auth.provider_oauth_start_port_busy');
        return apiError(c, 503, err.message);
      }
      getLog().error(
        { err: err as Error, userId: web.userId, provider },
        'auth.provider_oauth_start_failed'
      );
      return apiError(c, 500, 'Failed to start subscription login');
    }
  });

  registerOpenApiRoute(providerOAuthPollRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to connect a subscription');
    if ('error' in web) return web.error;
    if (!isPerUserProviderKeysEnabled()) {
      return apiError(c, 404, 'Per-user provider keys are not enabled on this install');
    }
    // The `:provider` path segment only keeps the OAuth routes under one prefix
    // (so they're exempt from the Better Auth catch-all); poll itself keys off
    // sessionId + userId.
    const { sessionId, code } = getValidatedBody(c, providerOAuthPollBodySchema);
    // pollOAuth is bound to the session's userId, so a stranger's sessionId resolves
    // to an error status rather than another user's login.
    const result = pollOAuth(sessionId, web.userId, code);
    return c.json(result);
  });

  // ---- Per-user AI preferences (Phase 3) ----
  // Identity-gated (requireWebUser) but NOT gated on TOKEN_ENCRYPTION_KEY —
  // prefs are model names, not secrets. Highest-precedence resolver layer.

  /** Validate a tier/alias entry's provider. Effort shape is enforced by Zod. */
  function validatePresetEntry(
    label: string,
    entry: { provider: string; model: string; effort?: string }
  ): string | null {
    if (!isRegisteredProvider(entry.provider)) {
      return `Unknown provider '${entry.provider}' for ${label}. Available: ${getProviderInfoList()
        .map(p => p.id)
        .join(', ')}`;
    }
    return null;
  }

  /** Validate a custom alias name: must start with '@' and not shadow a tier keyword. */
  function validateAliasName(name: string): string | null {
    if ((TIER_NAMES as readonly string[]).includes(name)) {
      return `Alias name '${name}' is reserved (small/medium/large are tier keywords). Use a different name.`;
    }
    if (!name.startsWith('@')) {
      return `Alias name '${name}' must start with '@' (e.g. '@${name}').`;
    }
    return null;
  }

  /** Clean a validated entry — drop `thinking` (no UI/CLI surface), keep effort. */
  function toCleanEntry(entry: { provider: string; model: string; effort?: string }): {
    provider: string;
    model: string;
    effort?: string;
  } {
    return {
      provider: entry.provider,
      model: entry.model,
      ...(entry.effort !== undefined ? { effort: entry.effort } : {}),
    };
  }

  registerOpenApiRoute(userAiPrefsGetRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to read AI preferences');
    if ('error' in web) return web.error;
    try {
      return c.json(await getUserAiPrefs(web.userId));
    } catch (err) {
      getLog().error({ err: err as Error, userId: web.userId }, 'auth.user_ai_prefs_get_failed');
      return apiError(c, 500, 'Failed to read AI preferences');
    }
  });

  registerOpenApiRoute(userAiPrefsTiersRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to update AI preferences');
    if ('error' in web) return web.error;
    const body = getValidatedBody(c, updateUserTiersBodySchema);
    const patch: UserTiersPatch = {};
    for (const tier of TIER_NAMES) {
      const entry = body.tiers[tier];
      if (entry === undefined) continue;
      if (entry === null) {
        patch[tier] = null;
        continue;
      }
      const errMsg = validatePresetEntry(`tier '${tier}'`, entry);
      if (errMsg) return apiError(c, 400, errMsg);
      patch[tier] = toCleanEntry(entry);
    }
    try {
      await setUserTiers(web.userId, patch);
      return c.json(await getUserAiPrefs(web.userId));
    } catch (err) {
      getLog().error({ err: err as Error, userId: web.userId }, 'auth.user_ai_prefs_tiers_failed');
      return apiError(c, 500, 'Failed to update AI tier preferences');
    }
  });

  registerOpenApiRoute(userAiPrefsAliasesRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to update AI preferences');
    if ('error' in web) return web.error;
    const body = getValidatedBody(c, updateUserAliasesBodySchema);
    const patch: UserAliasesPatch = {};
    for (const [name, entry] of Object.entries(body.aliases)) {
      const nameErr = validateAliasName(name);
      if (nameErr) return apiError(c, 400, nameErr);
      if (entry === null) {
        patch[name] = null;
        continue;
      }
      const errMsg = validatePresetEntry(`alias '${name}'`, entry);
      if (errMsg) return apiError(c, 400, errMsg);
      patch[name] = toCleanEntry(entry);
    }
    try {
      await setUserAliases(web.userId, patch);
      return c.json(await getUserAiPrefs(web.userId));
    } catch (err) {
      getLog().error(
        { err: err as Error, userId: web.userId },
        'auth.user_ai_prefs_aliases_failed'
      );
      return apiError(c, 500, 'Failed to update AI alias preferences');
    }
  });

  registerOpenApiRoute(userAiPrefsDefaultRoute, async c => {
    const web = await requireWebUser(c, 'Web authentication required to update AI preferences');
    if ('error' in web) return web.error;
    const { provider, model } = getValidatedBody(c, updateUserDefaultBodySchema);
    if (provider !== null && !isRegisteredProvider(provider)) {
      return apiError(
        c,
        400,
        `Unknown provider '${provider}'. Available: ${getProviderInfoList()
          .map(p => p.id)
          .join(', ')}`
      );
    }
    if (provider === null && typeof model === 'string') {
      return apiError(c, 400, 'Cannot set a default model without a default provider');
    }
    try {
      // Atomic write: provider + model always land together — an omitted
      // model clears any previous pin so it can't ride a provider switch.
      await setUserDefault(web.userId, provider, model ?? null);
      return c.json(await getUserAiPrefs(web.userId));
    } catch (err) {
      getLog().error(
        { err: err as Error, userId: web.userId },
        'auth.user_ai_prefs_default_failed'
      );
      return apiError(c, 500, 'Failed to update default assistant preference');
    }
  });

  // Shared lock/dispatch/error handling for message and workflow endpoints
  /** Maximum allowed upload size per file (10 MB) */
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  /** Maximum number of files per message (enforced server-side) */
  const MAX_FILES_PER_MESSAGE = 5;
  /**
   * Binary (non-text) MIME types explicitly allowed for upload.
   * All text/* types are accepted separately via isAllowedUploadType().
   */
  const ALLOWED_UPLOAD_BINARY_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    // application/json is a structured text type browsers may report for .json files
    'application/json',
  ]);

  /** Extensions accepted when browser reports an empty MIME type (code/config files). */
  const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.csv',
    '.xml',
    '.html',
    '.htm',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.env',
    '.log',
    '.css',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.py',
    '.rb',
    '.go',
    '.java',
    '.c',
    '.cpp',
    '.cc',
    '.cxx',
    '.h',
    '.hpp',
    '.cs',
    '.php',
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.rs',
    '.swift',
    '.kt',
    '.scala',
    '.r',
    '.sql',
  ]);

  /** Returns true if the MIME type is allowed for upload. */
  function isAllowedUploadType(mimeType: string, fileName: string): boolean {
    // All text/* types are acceptable (covers .md, .py, .rs, .go, .sh, .yaml, etc.)
    if (mimeType.startsWith('text/')) return true;
    if (ALLOWED_UPLOAD_BINARY_MIME_TYPES.has(mimeType)) return true;
    // Browsers assign empty MIME types to many code/config extensions — fall back to extension
    if (!mimeType) {
      const dotIndex = fileName.lastIndexOf('.');
      if (dotIndex !== -1) {
        return ALLOWED_UPLOAD_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
      }
    }
    return false;
  }

  /**
   * Persist multipart-uploaded files to the conversation's upload directory.
   * Called from /api/workflows/:name/run; /api/conversations/:id/message still
   * inlines the same validate-write-rollback logic and could migrate to this
   * helper as a separate hygiene pass.
   *
   * Returns either { ok: true, savedFiles, uploadDir } or a structured error
   * the caller forwards via apiError; on the success path the caller passes
   * savedFiles + uploadDir to dispatchToOrchestrator so cleanup happens
   * inside the lock handler.
   */
  async function persistUploadedFiles(
    conversationId: string,
    fileEntries: File[]
  ): Promise<
    | { ok: true; savedFiles: AttachedFile[]; uploadDir: string }
    | { ok: false; status: 400 | 500; error: string }
  > {
    if (fileEntries.length > MAX_FILES_PER_MESSAGE) {
      return {
        ok: false,
        status: 400,
        error: `Maximum ${MAX_FILES_PER_MESSAGE.toString()} files per message`,
      };
    }

    const archonHome = getArchonHome();
    const uploadDir = join(archonHome, 'artifacts', 'uploads', conversationId);
    if (!uploadDir.startsWith(archonHome + sep)) {
      return { ok: false, status: 400, error: 'Invalid conversation ID' };
    }

    // Validate all files before writing any to disk.
    for (const entry of fileEntries) {
      const displayName = basename(entry.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!isAllowedUploadType(entry.type, entry.name)) {
        return {
          ok: false,
          status: 400,
          error: `File "${displayName}" has an unsupported type: ${entry.type}`,
        };
      }
      if (entry.size > MAX_UPLOAD_BYTES) {
        return {
          ok: false,
          status: 400,
          error: `File "${displayName}" exceeds the 10 MB size limit`,
        };
      }
    }

    const savedFiles: AttachedFile[] = [];
    try {
      await mkdir(uploadDir, { recursive: true });
      for (const entry of fileEntries) {
        const fileId = randomUUID();
        const safeName = basename(entry.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = join(uploadDir, `${fileId}_${safeName}`);
        await writeFile(filePath, Buffer.from(await entry.arrayBuffer()));
        const normalizedMime =
          entry.type.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
        savedFiles.push({
          path: filePath,
          name: safeName || fileId,
          mimeType: normalizedMime,
          size: entry.size,
        });
      }
    } catch (writeErr: unknown) {
      for (const f of savedFiles) {
        await unlink(f.path).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') {
            getLog().warn({ err, filePath: f.path, conversationId }, 'upload.rollback_failed');
          }
        });
      }
      getLog().error({ err: writeErr, conversationId }, 'upload.write_failed');
      return {
        ok: false,
        status: 500,
        error: 'Failed to save uploaded file. Check available disk space.',
      };
    }

    return { ok: true, savedFiles, uploadDir };
  }

  async function dispatchToOrchestrator(
    conversationId: string,
    message: string,
    extraContext?: Omit<HandleMessageContext, 'isolationHints'>,
    filesToCleanup?: { files: AttachedFile[]; uploadDir: string }
  ): Promise<{ accepted: boolean; status: string }> {
    const result = await lockManager.acquireLock(conversationId, async () => {
      // Emit lock:true at handler start so the UI knows processing has begun.
      // Fire-and-forget — if no SSE stream is connected yet, the event is buffered.
      webAdapter.emitLockEvent(conversationId, true);
      try {
        await handleMessage(webAdapter, conversationId, message, {
          isolationHints: { workflowType: 'thread', workflowId: conversationId },
          ...extraContext,
        });
      } catch (error) {
        getLog().error({ err: error, conversationId }, 'handle_message_failed');
        try {
          await webAdapter.emitSSE(
            conversationId,
            JSON.stringify({
              type: 'error',
              message: `Failed to process message: ${(error as Error).message ?? 'unknown error'}. Try /reset if the problem persists.`,
              classification: 'transient',
              timestamp: Date.now(),
            })
          );
        } catch (sseError) {
          getLog().error({ err: sseError, conversationId }, 'sse_error_emit_failed');
        }
      } finally {
        await webAdapter.emitLockEvent(conversationId, false);
        // Clean up uploaded files AFTER handleMessage completes so the AI subprocess
        // has had a chance to read them. Doing this in the HTTP handler's finally block
        // would delete files while the fire-and-forget lock handler is still running.
        if (filesToCleanup) {
          for (const f of filesToCleanup.files) {
            await unlink(f.path).catch((err: NodeJS.ErrnoException) => {
              if (err.code !== 'ENOENT') {
                getLog().warn({ err, filePath: f.path, conversationId }, 'upload.cleanup_failed');
              }
            });
          }
          // Remove the now-empty upload directory for this conversation.
          await rm(filesToCleanup.uploadDir, { recursive: true, force: true }).catch(
            (err: NodeJS.ErrnoException) => {
              if (err.code !== 'ENOENT') {
                getLog().warn(
                  { err, uploadDir: filesToCleanup.uploadDir, conversationId },
                  'upload.dir_cleanup_failed'
                );
              }
            }
          );
        }
      }
    });

    if (result.status === 'queued-conversation' || result.status === 'queued-capacity') {
      // Intentionally fire-and-forget: the lock-acquire signal (locked: true) is sent
      // optimistically so the UI shows a queued state immediately. It is not awaited
      // because we want the HTTP response to return before the SSE write completes.
      // The lock-release signal (locked: false) IS awaited inside the task callback
      // above to guarantee ordering — all tool results and flush must precede the
      // release event on the SSE stream.
      webAdapter.emitLockEvent(conversationId, true);
    }

    return { accepted: true, status: result.status };
  }

  /**
   * Re-enter the orchestrator after a paused approval gate is resolved, so a
   * web-dispatched workflow continues (approve) or runs its on_reject prompt
   * (reject) without the user having to re-run the workflow command. The CLI's
   * `workflowApproveCommand` / `workflowRejectCommand` already auto-resume via
   * `workflowRunCommand({ resume: true })`; this is the web-side equivalent.
   *
   * Returns `true` when a resume dispatch was initiated, `false` otherwise (no
   * parent conversation on the run, parent conversation deleted, parent was on
   * a non-web platform, or dispatch threw). Failures are non-fatal: the gate
   * decision is recorded regardless; when this returns `false` the response
   * text instructs the user to re-run the workflow command.
   *
   * **Cross-adapter guard**: only web-sourced parents qualify.
   * `dispatchToOrchestrator` is wired to the web adapter + its lock manager,
   * so a Slack / Telegram / GitHub / Discord run being approved from the
   * dashboard must not route through it — the Slack thread would never see
   * the resumed output. Non-web parents skip auto-resume and the originating
   * platform's own re-run flow applies.
   */
  async function tryAutoResumeAfterGate(
    run: WorkflowRun,
    action: 'approve' | 'reject' | 'review-open' | 'ask-answer',
    // Identity of the user who approved/rejected the gate. The resumed chat
    // turn executes as THIS user (sender-first, #1976/#1982) — without it the
    // dispatch would fall back to the conversation creator's prefs/credentials.
    // Undefined on solo installs (no web identity) → creator fallback applies.
    gateActorUserId?: string
  ): Promise<boolean> {
    if (!run.parent_conversation_id) return false;
    // Literal event names per action — greppable for ops tooling. Keeping the
    // branch explicit rather than templating avoids the earlier 3-segment
    // `api.workflow_*.dispatched` shape that broke `{domain}.{action}_{state}`.
    const events =
      action === 'approve'
        ? {
            dispatched: 'api.workflow_approve_auto_resume_dispatched' as const,
            skippedNoPlatformConv:
              'api.workflow_approve_auto_resume_skipped_no_platform_conv' as const,
            skippedNonWebParent: 'api.workflow_approve_auto_resume_skipped_non_web_parent' as const,
            failed: 'api.workflow_approve_auto_resume_failed' as const,
          }
        : action === 'reject'
          ? {
              dispatched: 'api.workflow_reject_auto_resume_dispatched' as const,
              skippedNoPlatformConv:
                'api.workflow_reject_auto_resume_skipped_no_platform_conv' as const,
              skippedNonWebParent:
                'api.workflow_reject_auto_resume_skipped_non_web_parent' as const,
              failed: 'api.workflow_reject_auto_resume_failed' as const,
            }
          : action === 'review-open'
            ? {
                dispatched: 'api.workflow_review_open_auto_resume_dispatched' as const,
                skippedNoPlatformConv:
                  'api.workflow_review_open_auto_resume_skipped_no_platform_conv' as const,
                skippedNonWebParent:
                  'api.workflow_review_open_auto_resume_skipped_non_web_parent' as const,
                failed: 'api.workflow_review_open_auto_resume_failed' as const,
              }
            : {
                dispatched: 'api.workflow_ask_answer_auto_resume_dispatched' as const,
                skippedNoPlatformConv:
                  'api.workflow_ask_answer_auto_resume_skipped_no_platform_conv' as const,
                skippedNonWebParent:
                  'api.workflow_ask_answer_auto_resume_skipped_non_web_parent' as const,
                failed: 'api.workflow_ask_answer_auto_resume_failed' as const,
              };
    try {
      const parentConv = await conversationDb.getConversationById(run.parent_conversation_id);
      const platformConvId = parentConv?.platform_conversation_id;
      if (!platformConvId) {
        // parentConv === null is a data-integrity signal (the parent
        // conversation was deleted while the run was paused) — worth
        // surfacing at info level so operators notice. Missing
        // platform_conversation_id on an existing row shouldn't happen and
        // stays at debug.
        const logFn =
          parentConv === null ? getLog().info.bind(getLog()) : getLog().debug.bind(getLog());
        logFn(
          {
            runId: run.id,
            parentConversationId: run.parent_conversation_id,
            parentDeleted: parentConv === null,
          },
          events.skippedNoPlatformConv
        );
        return false;
      }
      if (parentConv.platform_type !== 'web') {
        getLog().debug(
          {
            runId: run.id,
            parentConversationId: run.parent_conversation_id,
            platformType: parentConv.platform_type,
          },
          events.skippedNonWebParent
        );
        return false;
      }
      // Explicit resume targeting: `/workflow resume <id>` routes through the
      // command handler's resume path, which validates the run and hands the
      // orchestrator an explicit resumeRun. A bare `/workflow run <name>` would
      // instead rely on implicit resume detection and collide with the
      // ambiguity guard for any non-paused resumable state (#2075).
      const resumeMessage = `/workflow resume ${run.id}`;
      await dispatchToOrchestrator(platformConvId, resumeMessage, { userId: gateActorUserId });
      getLog().info(
        { runId: run.id, workflowName: run.workflow_name, platformConvId },
        events.dispatched
      );
      return true;
    } catch (err) {
      getLog().warn({ err: err as Error, runId: run.id }, events.failed);
      return false;
    }
  }

  type RetryAuthDecision =
    | { requesterUserId: string; authorizationBasis: string }
    | { error: Response };

  async function authorizeWorkflowNodeRetry(
    c: Context,
    run: WorkflowRun
  ): Promise<RetryAuthDecision> {
    const requester = await resolveAuthContext(c);

    if (run.user_id) {
      if (!requester) {
        return { error: apiError(c, 401, 'Authentication required to retry this workflow run') };
      }
      if (requester.userId === run.user_id) {
        return { requesterUserId: requester.userId, authorizationBasis: 'owner' };
      }
      if (requester.role === 'admin') {
        return { requesterUserId: requester.userId, authorizationBasis: 'admin' };
      }
      return { error: apiError(c, 403, 'Only the run owner or an admin can retry this node') };
    }

    if (isWebAuthEnabled() || isApiGateEnabled()) {
      if (!requester) {
        return { error: apiError(c, 401, 'Authentication required to retry this workflow run') };
      }
      if (requester.role !== 'admin') {
        return { error: apiError(c, 403, 'Only admins can retry unowned workflow runs') };
      }
      return { requesterUserId: requester.userId, authorizationBasis: 'admin' };
    }

    return {
      requesterUserId: requester?.userId ?? 'unavailable',
      authorizationBasis: requester?.role === 'admin' ? 'admin' : 'solo',
    };
  }

  interface RetryWorkflowLookup {
    workflow: WorkflowDefinition;
    source: WorkflowSource;
    discoveryCwd: string;
    baseBranch?: string;
  }

  async function loadWorkflowForRetryRun(run: WorkflowRun): Promise<RetryWorkflowLookup> {
    let discoveryCwd = run.working_path ?? undefined;
    let baseBranch: string | undefined;

    if (run.codebase_id) {
      const codebase = await codebaseDb.getCodebase(run.codebase_id);
      if (codebase) {
        discoveryCwd = codebase.default_cwd;
        baseBranch = codebase.default_branch?.trim() || undefined;
      }
    }

    if (!discoveryCwd) {
      throw new Error(
        `Cannot retry workflow '${run.workflow_name}': missing workflow discovery path`
      );
    }

    const result = await discoverWorkflowsWithConfig(discoveryCwd, loadConfig);
    const workflowEntries = result.workflows;
    const workflow = resolveWorkflowName(
      run.workflow_name,
      workflowEntries.map(entry => entry.workflow)
    );
    if (!workflow) {
      const loadError = result.errors.find(
        error =>
          error.filename.replace(/\.ya?ml$/, '') === run.workflow_name ||
          error.filename === `${run.workflow_name}.yaml` ||
          error.filename === `${run.workflow_name}.yml`
      );
      const suffix = loadError ? `: ${loadError.error}` : '';
      throw new Error(`Workflow '${run.workflow_name}' could not be loaded${suffix}`);
    }

    return {
      workflow,
      source: workflowEntries.find(entry => entry.workflow === workflow)?.source ?? 'project',
      discoveryCwd,
      baseBranch,
    };
  }

  function getRetryErrorStatus(error: unknown): 400 | 404 | 409 | 500 {
    const code = (error as { code?: unknown }).code;

    switch (code) {
      case 'run_not_found':
        return 404;
      case 'cas_miss':
      case 'path_in_use':
      case 'checkout_strategy_required':
        return 409;
      case 'run_not_retryable':
      case 'node_not_found':
      case 'node_not_retryable':
      case 'checkpoint_unavailable':
      case 'git_reset_failed':
        return 400;
      default:
        return 500;
    }
  }

  async function restoreRunAfterRetryDispatchFailure(runId: string, error: Error): Promise<void> {
    await workflowDb
      .updateWorkflowRun(runId, {
        status: 'failed',
        metadata: { retry_dispatch_error: error.message },
      })
      .catch((updateError: Error) => {
        getLog().error(
          { err: updateError, runId, originalError: error.message },
          'api.workflow_retry_dispatch_restore_failed'
        );
      });
  }

  async function dispatchPreparedWebRetry(input: {
    run: WorkflowRun;
    workflow: WorkflowDefinition;
    source: WorkflowSource;
    workerPlatformId: string;
    parentPlatformId: string;
    workingPath: string;
    targetNodeId: string;
    prepared: {
      preCreatedRun: WorkflowRun;
      preservedCompletedOutputs: Map<string, string>;
      retryEpoch: number;
      invalidatedNodeIds: string[];
    };
    baseBranch?: string;
  }): Promise<{ accepted: boolean; status: string }> {
    const [{ executeWorkflow }, { createWorkflowDeps }] = await Promise.all([
      import('@archon/workflows/executor'),
      import('@archon/core/workflows/store-adapter'),
    ]);
    const deps = createWorkflowDeps();
    const result = await lockManager.acquireLock(input.workerPlatformId, async () => {
      webAdapter.emitLockEvent(input.workerPlatformId, true);
      try {
        const executionResult = await executeWorkflow(
          deps,
          webAdapter,
          input.workerPlatformId,
          input.workingPath,
          input.workflow,
          input.run.user_message ?? '',
          input.run.conversation_id,
          {
            codebaseId: input.run.codebase_id ?? undefined,
            source: input.source,
            baseBranch: input.baseBranch,
            preCreatedRun: input.prepared.preCreatedRun,
            priorCompletedNodes: input.prepared.preservedCompletedOutputs,
            retryContext: {
              targetNodeId: input.targetNodeId,
              retryEpoch: input.prepared.retryEpoch,
              invalidatedNodeIds: input.prepared.invalidatedNodeIds,
            },
          }
        );

        if ('paused' in executionResult) {
          return;
        }

        if (executionResult.success && executionResult.summary) {
          await webAdapter.sendMessage(input.parentPlatformId, executionResult.summary, {
            category: 'workflow_result',
            segment: 'new',
            workflowResult: {
              workflowName: input.workflow.name,
              runId: executionResult.workflowRunId,
            },
          });
        } else if (!executionResult.success && executionResult.workflowRunId) {
          await webAdapter.sendMessage(
            input.parentPlatformId,
            `Workflow **${input.workflow.name}** retry failed: ${executionResult.error}`,
            {
              category: 'workflow_result',
              segment: 'new',
              workflowResult: {
                workflowName: input.workflow.name,
                runId: executionResult.workflowRunId,
              },
            }
          );
        }
      } catch (error) {
        const err = error as Error;
        getLog().error({ err, runId: input.run.id }, 'api.workflow_retry_execute_failed');
        await restoreRunAfterRetryDispatchFailure(input.run.id, err);
        await webAdapter
          .sendMessage(input.parentPlatformId, `Workflow retry failed: ${err.message}`, {
            category: 'workflow_result',
            segment: 'new',
            workflowResult: {
              workflowName: input.workflow.name,
              runId: input.run.id,
            },
          })
          .catch((notifyError: unknown) => {
            getLog().warn(
              { err: notifyError as Error, runId: input.run.id },
              'api.workflow_retry_failure_notify_failed'
            );
          });
      } finally {
        await webAdapter.emitLockEvent(input.workerPlatformId, false);
      }
    });

    if (result.status === 'queued-conversation' || result.status === 'queued-capacity') {
      void webAdapter.emitLockEvent(input.workerPlatformId, true);
    }

    return { accepted: true, status: result.status };
  }

  // ---------------------------------------------------------------------------
  // API transform helpers (Date → ISO string for wire shape)
  // ---------------------------------------------------------------------------

  type ApiConversation = z.infer<typeof conversationSchema>;
  type ApiCodebase = z.infer<typeof codebaseSchema>;
  type ApiMessage = z.infer<typeof messageSchema>;
  type ApiWorkflowRun = z.infer<typeof workflowRunSchema>;
  type ApiDashboardWorkflowRun = z.infer<typeof dashboardWorkflowRunSchema>;

  function toISOString(val: Date | string): string;
  function toISOString(val: Date | string | null | undefined): string | null;
  function toISOString(val: Date | string | null | undefined): string | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val;
    try {
      return val.toISOString();
    } catch (e) {
      getLog().error({ err: e as Error, invalidDate: val }, 'api.invalid_date_transform');
      return null;
    }
  }

  function toWorkflowEnvSummaryResponse(row: WorkflowEnvSummary): {
    id: string;
    workflowName: string;
    name: string;
    updatedAt: string;
  } {
    return {
      id: row.id,
      workflowName: row.workflow_name,
      name: row.name,
      updatedAt: toISOString(row.updated_at),
    };
  }

  function toWorkflowEnvResponse(row: WorkflowEnvRow): {
    id: string;
    workflowName: string;
    name: string;
    updatedAt: string;
    patches: EnvPatches;
    createdAt: string;
    createdByUserId: string | null;
  } {
    return {
      ...toWorkflowEnvSummaryResponse(row),
      patches: row.patches,
      createdAt: toISOString(row.created_at),
      createdByUserId: row.created_by_user_id,
    };
  }

  function parseWorkflowEnvPathName(
    name: string
  ): { ok: true; name: string } | { ok: false; detail: string } {
    const parsed = workflowEnvWorkflowNameSchema.safeParse(name);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? 'invalid workflow name';
      return { ok: false, detail };
    }
    return { ok: true, name: parsed.data };
  }

  function toApiConversation(row: import('@archon/core').Conversation): ApiConversation {
    return {
      ...row,
      created_at: toISOString(row.created_at),
      updated_at: toISOString(row.updated_at),
      deleted_at: toISOString(row.deleted_at),
      last_activity_at: toISOString(row.last_activity_at),
    };
  }

  function toApiCodebase(row: import('@archon/core').Codebase): ApiCodebase {
    let commands = row.commands;
    if (typeof commands === 'string') {
      try {
        commands = JSON.parse(commands) as Record<string, { path: string; description: string }>;
      } catch (parseErr) {
        getLog().error({ err: parseErr as Error, codebaseId: row.id }, 'corrupted_commands_json');
        // Fallback: empty map keeps the API response valid and prevents the endpoint
        // from crashing. The corruption is already logged above for operator attention.
        commands = {};
      }
    }
    return {
      ...row,
      commands,
      created_at: toISOString(row.created_at),
      updated_at: toISOString(row.updated_at),
    };
  }

  function toApiMessage(row: MessageRow): ApiMessage {
    let metadata = row.metadata;
    if (typeof metadata !== 'string') {
      try {
        metadata = JSON.stringify(metadata);
      } catch (e) {
        getLog().error(
          { err: e as Error, messageId: row.id },
          'api.message_metadata_serialize_failed'
        );
        metadata = '{}';
      }
    }
    // Bound tool_result outputs in hydration responses — the DB keeps the full
    // value; only the browser-bound payload is capped (see #2236).
    return { ...row, metadata: boundMetadataToolOutputs(metadata) };
  }

  function toApiWorkflowRun(row: WorkflowRun): ApiWorkflowRun {
    return {
      ...row,
      started_at: toISOString(row.started_at),
      completed_at: toISOString(row.completed_at),
      last_activity_at: toISOString(row.last_activity_at),
    };
  }

  function toApiDashboardWorkflowRun(row: DashboardWorkflowRun): ApiDashboardWorkflowRun {
    return {
      ...row,
      started_at: toISOString(row.started_at),
      completed_at: toISOString(row.completed_at),
      last_activity_at: toISOString(row.last_activity_at),
    };
  }

  // GET /api/conversations - List conversations
  registerOpenApiRoute(getConversationsRoute, async c => {
    try {
      const platformType = c.req.query('platform') ?? undefined;
      const codebaseId = c.req.query('codebaseId') ?? undefined;
      // Non-enforcing "mine" filter: only narrows when an identity resolves.
      // Default visibility stays open (everyone sees everyone's conversations).
      const mine = c.req.query('mine') === 'true';
      const userId = mine ? (await resolveAuthContext(c))?.userId : undefined;
      if (mine && !userId && getAuth()) {
        // Narrowing was requested but no identity resolved on an install with
        // web auth configured — the list silently degrades to ALL conversations
        // (documented non-enforcing posture). Without web auth (solo installs,
        // where the console always sends mine=true) this is the normal path
        // and stays silent.
        getLog().warn({ route: 'GET /api/conversations' }, 'api.mine_filter_identity_unresolved');
      }
      const conversations = await conversationDb.listConversations(
        50,
        platformType,
        codebaseId,
        true,
        userId
      );
      return c.json(conversations.map(toApiConversation));
    } catch (error) {
      getLog().error({ err: error }, 'list_conversations_failed');
      return apiError(c, 500, 'Failed to list conversations');
    }
  });

  // GET /api/conversations/:id - Get single conversation by platform conversation ID
  registerOpenApiRoute(getConversationRoute, async c => {
    const platformId = c.req.param('id') ?? '';
    try {
      const conv = await conversationDb.findConversationByPlatformId(platformId);
      if (!conv) {
        return apiError(c, 404, 'Conversation not found');
      }
      return c.json(toApiConversation(conv));
    } catch (error) {
      getLog().error({ err: error, platformId }, 'get_conversation_failed');
      return apiError(c, 500, 'Failed to get conversation');
    }
  });

  // POST /api/conversations - Create new conversation
  // Accepts optional `message` field for atomic create+send (avoids ghost "Untitled" entries)
  registerOpenApiRoute(createConversationRoute, async c => {
    try {
      const { codebaseId, message } = getValidatedBody(c, createConversationBodySchema);
      const userId = await resolveWebUserId(c);

      // Validate codebase exists if provided
      if (codebaseId) {
        const codebase = await codebaseDb.getCodebase(codebaseId);
        if (!codebase) {
          return apiError(c, 400, 'Codebase not found', `No codebase with id "${codebaseId}"`);
        }
      }

      const conversationId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const conversation = await conversationDb.getOrCreateConversation(
        'web',
        conversationId,
        codebaseId,
        undefined,
        userId
      );
      webAdapter.setConversationDbId(conversation.platform_conversation_id, conversation.id);

      // If message provided, dispatch it atomically (avoids ghost "Untitled" conversations)
      if (message) {
        try {
          await messageDb.addMessage(conversation.id, 'user', message, undefined, userId);
        } catch (e: unknown) {
          // Log only (no SSE warning) — the SSE stream isn't connected yet for new conversations.
          // The existing /message endpoint emits a warning because the stream is guaranteed to be active.
          getLog().error({ err: e, conversationId: conversation.id }, 'message_persistence_failed');
        }

        // Set placeholder title immediately so the sidebar never shows "Untitled conversation"
        const placeholderTitle = message.length > 60 ? message.slice(0, 60) + '...' : message;
        await conversationDb.updateConversationTitle(conversation.id, placeholderTitle);

        // Generate proper AI title for non-command messages (fire-and-forget, overwrites placeholder).
        // Resolve the `small` tier (config tiers + per-user prefs) instead of the raw
        // assistant default — the config-default Codex model may not be usable on the
        // active account (e.g. ChatGPT-plan accounts, #1855). Both calls never throw.
        if (!message.startsWith('/')) {
          void resolveTitleRequest(conversation.ai_assistant_type, userId).then(titleRequest =>
            generateAndSetTitle(
              conversation.id,
              message,
              titleRequest.provider,
              getArchonWorkspacesPath(),
              undefined,
              titleRequest.options.assistantConfig,
              titleRequest.options
            )
          );
        }

        const result = await dispatchToOrchestrator(
          conversation.platform_conversation_id,
          message,
          { userId }
        );

        return c.json({
          conversationId: conversation.platform_conversation_id,
          id: conversation.id,
          dispatched: true,
          ...result,
        });
      }

      return c.json({ conversationId: conversation.platform_conversation_id, id: conversation.id });
    } catch (error) {
      getLog().error({ err: error }, 'create_conversation_failed');
      return apiError(c, 500, 'Failed to create conversation');
    }
  });

  // PATCH /api/conversations/:id - Update conversation (title)
  registerOpenApiRoute(updateConversationRoute, async c => {
    const platformId = c.req.param('id') ?? '';
    const { title } = getValidatedBody(c, updateConversationBodySchema);
    try {
      const conv = await conversationDb.findConversationByPlatformId(platformId);
      if (!conv) {
        return apiError(c, 404, 'Conversation not found');
      }
      if (title !== undefined) {
        await conversationDb.updateConversationTitle(conv.id, title.slice(0, 255));
      }
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        return apiError(c, 404, 'Conversation not found');
      }
      getLog().error({ err: error }, 'update_conversation_failed');
      return apiError(c, 500, 'Failed to update conversation');
    }
  });

  // DELETE /api/conversations/:id - Soft delete
  registerOpenApiRoute(deleteConversationRoute, async c => {
    const platformId = c.req.param('id') ?? '';
    try {
      const conv = await conversationDb.findConversationByPlatformId(platformId);
      if (!conv) {
        return apiError(c, 404, 'Conversation not found');
      }
      await conversationDb.softDeleteConversation(conv.id);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        return apiError(c, 404, 'Conversation not found');
      }
      getLog().error({ err: error }, 'delete_conversation_failed');
      return apiError(c, 500, 'Failed to delete conversation');
    }
  });

  // GET /api/conversations/:id/messages - Message history
  registerOpenApiRoute(listMessagesRoute, async c => {
    const platformConversationId = c.req.param('id') ?? '';
    const limit = Math.min(Number(c.req.query('limit') ?? '200'), 500);
    try {
      const conv = await conversationDb.findConversationByPlatformId(platformConversationId);
      if (!conv) {
        return apiError(c, 404, 'Conversation not found');
      }
      const messages = await messageDb.listMessages(conv.id, limit);
      return c.json(messages.map(toApiMessage));
    } catch (error) {
      getLog().error({ err: error }, 'list_messages_failed');
      return apiError(c, 500, 'Failed to list messages');
    }
  });

  // POST /api/conversations/:id/message - Send message
  // Manual body parsing: multipart uses parseBody(), JSON uses req.json().
  registerOpenApiRoute(sendMessageRoute, async c => {
    const conversationId = c.req.param('id') ?? '';
    const userId = await resolveWebUserId(c);

    // Reject conversation IDs that could be used for path traversal when building
    // the upload directory. Web conversation IDs are alphanumeric with hyphens only.
    if (!/^[\w-]+$/.test(conversationId)) {
      return c.json({ error: 'Invalid conversation ID' }, 400);
    }

    let message: string;
    let savedFiles: AttachedFile[] = [];
    let uploadDir = '';

    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      let body: Record<string, string | File | (string | File)[]>;
      try {
        body = await c.req.parseBody({ all: true });
      } catch (parseErr: unknown) {
        getLog().warn({ err: parseErr, conversationId }, 'upload.parse_failed');
        return c.json({ error: 'Invalid multipart form data' }, 400);
      }

      const rawMessage = body.message;
      if (typeof rawMessage !== 'string' || !rawMessage) {
        return c.json({ error: 'message must be a non-empty string' }, 400);
      }
      message = rawMessage;

      const rawFiles = body.files;
      let fileList: (string | File)[];
      if (Array.isArray(rawFiles)) {
        fileList = rawFiles;
      } else if (rawFiles !== undefined) {
        fileList = [rawFiles];
      } else {
        fileList = [];
      }

      const fileEntries = fileList.filter((e): e is File => e instanceof File);
      if (fileEntries.length > 0) {
        const result = await persistUploadedFiles(conversationId, fileEntries);
        if (!result.ok) {
          return c.json({ error: result.error }, result.status);
        }
        savedFiles = result.savedFiles;
        uploadDir = result.uploadDir;
        getLog().info({ conversationId, fileCount: savedFiles.length }, 'message.files_uploaded');
      }
    } else {
      let body: { message?: unknown };
      try {
        body = await c.req.json();
      } catch (parseErr: unknown) {
        getLog().warn({ err: parseErr, conversationId }, 'message.json_parse_failed');
        return c.json({ error: 'Invalid JSON in request body' }, 400);
      }

      if (typeof body.message !== 'string' || !body.message) {
        return c.json({ error: 'message must be a non-empty string' }, 400);
      }
      message = body.message;
    }

    // Look up conversation for message persistence
    let conv: Awaited<ReturnType<typeof conversationDb.findConversationByPlatformId>> = null;
    try {
      conv = await conversationDb.findConversationByPlatformId(conversationId);
    } catch (e: unknown) {
      getLog().error({ err: e, conversationId }, 'conversation_lookup_failed');
    }

    // Persist user message and pass DB ID to adapter for assistant message persistence
    if (conv) {
      // Omit path from persisted metadata — the on-disk file is ephemeral and will be
      // deleted after the AI processes it; storing stale paths would confuse future readers.
      const meta =
        savedFiles.length > 0
          ? { files: savedFiles.map(f => ({ name: f.name, mimeType: f.mimeType, size: f.size })) }
          : undefined;
      try {
        await messageDb.addMessage(conv.id, 'user', message, meta, userId);
      } catch (e: unknown) {
        getLog().error({ err: e, conversationId: conv.id }, 'message_persistence_failed');
        try {
          await webAdapter.emitSSE(
            conversationId,
            JSON.stringify({
              type: 'warning',
              message: 'Message could not be saved to history',
              timestamp: Date.now(),
            })
          );
        } catch (sseErr: unknown) {
          getLog().error({ err: sseErr, conversationId: conv?.id }, 'sse_warning_double_failure');
        }
      }
      webAdapter.setConversationDbId(conversationId, conv.id);
    }

    // Pass savedFiles to dispatchToOrchestrator so cleanup happens inside the lock handler,
    // AFTER handleMessage completes — not in the HTTP handler's finally block where the
    // fire-and-forget lock callback may still be running and the AI has not yet read the files.
    const extraContext: Omit<HandleMessageContext, 'isolationHints'> =
      savedFiles.length > 0 ? { userId, attachedFiles: savedFiles } : { userId };
    let filesToCleanup: { files: AttachedFile[]; uploadDir: string } | undefined;
    if (savedFiles.length > 0) {
      filesToCleanup = { files: savedFiles, uploadDir };
    }
    const result = await dispatchToOrchestrator(
      conversationId,
      message,
      extraContext,
      filesToCleanup
    );
    return c.json(result);
  });

  // GET /api/stream/__dashboard__ — multiplexed dashboard SSE (all workflow events)
  // IMPORTANT: Must be registered before /api/stream/:conversationId to avoid param capture.
  app.get('/api/stream/__dashboard__', async c => {
    return streamSSE(c, async stream => {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }),
      });

      webAdapter.registerStream('__dashboard__', stream);
      getLog().debug({ streamId: '__dashboard__' }, 'dashboard_sse_opened');

      stream.onAbort(() => {
        getLog().debug({ streamId: '__dashboard__' }, 'dashboard_sse_disconnected');
        webAdapter.removeStream('__dashboard__', stream);
      });

      try {
        while (true) {
          await stream.sleep(30000);
          if (!stream.closed) {
            await stream.writeSSE({
              data: JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }),
            });
          }
        }
      } catch (e: unknown) {
        const msg = (e as Error).message ?? '';
        if (!msg.includes('aborted') && !msg.includes('closed') && !msg.includes('cancel')) {
          getLog().warn({ err: e as Error }, 'dashboard_sse_heartbeat_error');
        }
      } finally {
        webAdapter.removeStream('__dashboard__', stream);
        getLog().debug({ streamId: '__dashboard__' }, 'dashboard_sse_closed');
      }
    });
  });

  // GET /api/stream/:conversationId - SSE streaming
  app.get('/api/stream/:conversationId', async c => {
    const conversationId = c.req.param('conversationId');

    return streamSSE(c, async stream => {
      // Send initial heartbeat immediately to flush HTTP headers.
      // Without this, EventSource stays in CONNECTING state until the first write.
      await stream.writeSSE({
        data: JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }),
      });

      webAdapter.registerStream(conversationId, stream);
      getLog().debug({ conversationId }, 'sse_stream_opened');

      stream.onAbort(() => {
        getLog().debug({ conversationId }, 'sse_client_disconnected');
        webAdapter.removeStream(conversationId, stream);
      });

      try {
        while (true) {
          await stream.sleep(30000);
          if (!stream.closed) {
            await stream.writeSSE({
              data: JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }),
            });
          }
        }
      } catch (e: unknown) {
        // stream.sleep() throws when client disconnects — expected behavior.
        // Log unexpected errors for debugging.
        const msg = (e as Error).message ?? '';
        if (!msg.includes('aborted') && !msg.includes('closed') && !msg.includes('cancel')) {
          getLog().warn({ err: e as Error, conversationId }, 'sse_heartbeat_error');
        }
      } finally {
        webAdapter.removeStream(conversationId, stream);
        getLog().debug({ conversationId }, 'sse_stream_closed');
      }
    });
  });

  // GET /api/codebases - List codebases
  registerOpenApiRoute(listCodebasesRoute, async c => {
    try {
      const codebases = await codebaseDb.listCodebases();

      // Deduplicate by repository_url (keep most recently updated)
      const normalizeUrl = (url: string): string => url.replace(/\.git$/, '');
      const seen = new Map<string, (typeof codebases)[number]>();
      const deduped: (typeof codebases)[number][] = [];
      for (const cb of codebases) {
        if (!cb.repository_url) {
          deduped.push(cb);
          continue;
        }
        const key = normalizeUrl(cb.repository_url);
        const existing = seen.get(key);
        if (!existing || cb.updated_at > existing.updated_at) {
          seen.set(key, cb);
        }
      }
      deduped.push(...seen.values());
      deduped.sort((a, b) => a.name.localeCompare(b.name));

      return c.json(deduped.map(toApiCodebase));
    } catch (error) {
      getLog().error({ err: error }, 'list_codebases_failed');
      return apiError(c, 500, 'Failed to list codebases');
    }
  });

  // GET /api/codebases/:id - Codebase detail
  registerOpenApiRoute(getCodebaseRoute, async c => {
    try {
      const codebase = await codebaseDb.getCodebase(c.req.param('id') ?? '');
      if (!codebase) {
        return apiError(c, 404, 'Codebase not found');
      }
      return c.json(toApiCodebase(codebase));
    } catch (error) {
      getLog().error({ err: error }, 'get_codebase_failed');
      return apiError(c, 500, 'Failed to get codebase');
    }
  });

  // POST /api/codebases - Add a project (clone from URL or register local path)
  registerOpenApiRoute(addCodebaseRoute, async c => {
    const body = getValidatedBody(c, addCodebaseBodySchema);

    try {
      // .refine() guarantees exactly one of url/path is present.
      // For a local path, detect git-ness: a non-git directory registers as a
      // folder project (kind: 'folder') instead of being rejected. Folder-ness
      // is detected here, not declared in the request body, so the web form
      // needs no new field.
      let result;
      if (body.url) {
        result = await cloneRepository(body.url);
      } else {
        const localPath = body.path ?? '';
        // Detect git-ness. A resolvable repo root → register as a repo project;
        // a definitive null ("not a git repository") → folder project. A THROW
        // is ambiguous: findRepoRoot throws both for a nonexistent path (benign
        // — fall through so registerFolder's own existence check produces the
        // clean error) and for a genuine git failure (git missing, timeout,
        // permission) on a path that DOES exist. The latter must NOT register:
        // it would permanently misclassify a real repo as kind:'folder'.
        let repoRoot: string | null = null;
        try {
          repoRoot = await findRepoRoot(localPath);
        } catch (err) {
          getLog().warn({ err, path: localPath }, 'api.add_codebase_repo_detect_failed');
          if (existsSync(localPath)) {
            return apiError(
              c,
              500,
              'Could not determine whether the path is a git repository (git failed — is git installed and the path readable?). Nothing was registered; retry once the underlying issue is resolved.'
            );
          }
        }
        result = repoRoot ? await registerRepository(localPath) : await registerFolder(localPath);
      }

      // Fetch the full codebase record for a consistent response
      const codebase = await codebaseDb.getCodebase(result.codebaseId);
      if (!codebase) {
        return apiError(c, 500, 'Codebase created but not found');
      }

      return c.json(toApiCodebase(codebase), result.alreadyExisted ? 200 : 201);
    } catch (error) {
      getLog().error({ err: error }, 'add_codebase_failed');
      return apiError(
        c,
        500,
        `Failed to add codebase: ${(error as Error).message ?? 'unknown error'}`
      );
    }
  });

  // DELETE /api/codebases/:id - Delete a project and clean up
  registerOpenApiRoute(deleteCodebaseRoute, async c => {
    const id = c.req.param('id') ?? '';
    try {
      const codebase = await codebaseDb.getCodebase(id);
      if (!codebase) {
        return apiError(c, 404, 'Codebase not found');
      }

      // Clean up isolation environments (worktrees)
      const environments = await isolationEnvDb.listByCodebase(id);
      for (const env of environments) {
        try {
          await removeWorktree(toRepoPath(codebase.default_cwd), toWorktreePath(env.working_path));
          getLog().info({ path: env.working_path }, 'worktree_removed');
        } catch (wtErr) {
          // Worktree may already be gone — log but continue
          getLog().warn({ err: wtErr, path: env.working_path }, 'worktree_remove_failed');
        }
        await isolationEnvDb.updateStatus(env.id, 'destroyed');
      }

      // Delete from database (unlinks conversations and sessions)
      await codebaseDb.deleteCodebase(id);

      // Remove workspace directory from disk — only for Archon-managed repos
      const workspacesRoot = normalize(getArchonWorkspacesPath());
      const normalizedCwd = normalize(codebase.default_cwd);
      if (
        normalizedCwd.startsWith(workspacesRoot + '/') ||
        normalizedCwd.startsWith(workspacesRoot + '\\')
      ) {
        try {
          await rm(normalizedCwd, { recursive: true, force: true });
          getLog().info({ path: normalizedCwd }, 'workspace_removed');
        } catch (rmErr) {
          // Directory may not exist — log but don't fail
          getLog().warn({ err: rmErr, path: codebase.default_cwd }, 'workspace_remove_failed');
        }
      } else {
        getLog().info({ path: codebase.default_cwd }, 'external_repo_skip_deletion');
      }

      return c.json({ success: true });
    } catch (error) {
      getLog().error({ err: error }, 'delete_codebase_failed');
      return apiError(c, 500, 'Failed to delete codebase');
    }
  });

  // GET /api/codebases/:id/env - List env var keys for a codebase (values never returned)
  registerOpenApiRoute(listEnvVarsRoute, async c => {
    const id = c.req.param('id') ?? '';
    try {
      const codebase = await codebaseDb.getCodebase(id);
      if (!codebase) return apiError(c, 404, 'Codebase not found');
      const envVars = await envVarDb.getCodebaseEnvVars(id);
      return c.json({ keys: Object.keys(envVars) });
    } catch (error) {
      getLog().error({ err: error, codebaseId: id }, 'list_env_vars_failed');
      return apiError(c, 500, 'Failed to list env vars');
    }
  });

  // PUT /api/codebases/:id/env - Set (upsert) an env var
  registerOpenApiRoute(setEnvVarRoute, async c => {
    const id = c.req.param('id') ?? '';
    try {
      const body = getValidatedBody(c, setEnvVarBodySchema);
      const codebase = await codebaseDb.getCodebase(id);
      if (!codebase) return apiError(c, 404, 'Codebase not found');
      await envVarDb.setCodebaseEnvVar(id, body.key, body.value);
      return c.json({ success: true });
    } catch (error) {
      getLog().error({ err: error, codebaseId: id }, 'set_env_var_failed');
      return apiError(c, 500, 'Failed to set env var');
    }
  });

  // DELETE /api/codebases/:id/env/:key - Delete an env var
  registerOpenApiRoute(deleteEnvVarRoute, async c => {
    const id = c.req.param('id') ?? '';
    const key = c.req.param('key') ?? '';
    try {
      const codebase = await codebaseDb.getCodebase(id);
      if (!codebase) return apiError(c, 404, 'Codebase not found');
      await envVarDb.deleteCodebaseEnvVar(id, key);
      return c.json({ success: true });
    } catch (error) {
      getLog().error({ err: error, codebaseId: id, key }, 'delete_env_var_failed');
      return apiError(c, 500, 'Failed to delete env var');
    }
  });

  /**
   * Register a route with OpenAPI spec generation and input validation.
   * Zod validates inputs (query, params, body) at runtime via defaultHook
   * unless a route-scoped `hook` is supplied (Workflow ENV uses a stable
   * `invalid_env_request` body — US-023).
   * Response schemas are used for OpenAPI spec generation only — output is not
   * validated at runtime. The `as never` cast bypasses TypedResponse constraints.
   */
  function registerOpenApiRoute(
    route: ReturnType<typeof createRoute>,
    handler: (c: Context) => Response | Promise<Response>,
    hook?: typeof workflowEnvValidationErrorHook
  ): void {
    if (hook) {
      app.openapi(route, handler as never, hook);
      return;
    }
    app.openapi(route, handler as never);
  }

  /** Access Zod-validated query from a handler registered via registerOpenApiRoute. */
  function getValidatedQuery<T>(c: Context, _schema: z.ZodType<T>): T {
    return (c.req as unknown as { valid(k: 'query'): T }).valid('query');
  }

  /** Access Zod-validated body from a handler registered via registerOpenApiRoute. */
  function getValidatedBody<T>(c: Context, _schema: z.ZodType<T>): T {
    return (c.req as unknown as { valid(k: 'json'): T }).valid('json');
  }

  /** Access an optional Zod-validated body without forcing legacy no-body callers to send JSON. */
  function getOptionalValidatedBody<T>(c: Context, _schema: z.ZodType<T>): T | undefined {
    return (c.req as unknown as { valid(k: 'json'): T | undefined }).valid('json');
  }

  // Serve OpenAPI spec
  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Archon API', version: '1.0.0' },
  });

  // =========================================================================
  // Workflow endpoints
  // =========================================================================

  // GET /api/workflows - Discover available workflows
  registerOpenApiRoute(getWorkflowsRoute, async c => {
    try {
      const cwd = c.req.query('cwd');
      let workingDir: string | undefined = cwd;

      // Validate caller-supplied cwd against registered codebase paths
      if (cwd) {
        if (!(await validateCwd(cwd))) {
          return apiError(c, 400, 'Invalid cwd: must match a registered codebase path');
        }
      } else {
        // Fallback to first codebase's default_cwd
        const codebases = await codebaseDb.listCodebases();
        if (codebases.length > 0) {
          workingDir = codebases[0].default_cwd;
        }
      }

      // No project context (no cwd query param and no registered codebases) —
      // pass null to discovery so it returns bundled + home-scoped workflows.
      // This avoids a misleading empty state on first run, before any project
      // is registered, when bundled defaults are present
      const result = await discoverWorkflowsWithConfig(workingDir ?? null, loadConfig);

      // Resolve repo-owner-curated recommended list (per-project only).
      // Filter to names present in the discovered set; preserve declared order.
      // Stale names are silently ignored (advisory).
      const recommended: string[] = [];
      if (workingDir) {
        const repoConfig = await loadRepoConfig(workingDir);
        const declared = repoConfig.recommendedWorkflows ?? [];
        if (declared.length > 0) {
          const discoveredNames = new Set(result.workflows.map(ws => ws.workflow.name));
          const seen = new Set<string>();
          for (const name of declared) {
            if (discoveredNames.has(name) && !seen.has(name)) {
              recommended.push(name);
              seen.add(name);
            } else if (!discoveredNames.has(name)) {
              getLog().debug({ workingDir, name }, 'workflows.recommended_workflow_not_found');
            }
          }
        }
      }

      return c.json({
        workflows: result.workflows.map(ws => ({
          // Display shows what the AUTHOR wrote. Composition collapses workflow-level
          // node config onto the nodes and removes it (#1764), so the declared values are
          // layered back over the definition for this listing only — the console reads
          // `workflow.provider` to label a card, and execution never reads this response.
          workflow: { ...ws.workflow, ...ws.declared },
          source: ws.source,
          // Keys the engine dropped from this YAML (#2213) — the console is the
          // surface most authors edit workflows on, so it has to carry them.
          ...(ws.parseWarnings && ws.parseWarnings.length > 0
            ? { parseWarnings: [...ws.parseWarnings] }
            : {}),
        })),
        recommended,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      // Workflow discovery can fail if cwd is stale or deleted — return empty with warning
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err }, 'workflow_discovery_failed');
      return apiError(c, 500, `Workflow discovery failed: ${err.message}`);
    }
  });

  // POST /api/workflows/:name/run - Run a workflow via the orchestrator
  //
  // Accepts either:
  //   - application/json: { conversationId, message }
  //   - multipart/form-data: conversationId + message + files[] (≤5, ≤10MB each)
  //
  // Multipart matches /api/conversations/:id/message so the console's draft
  // run input can attach screenshots / stack traces / paste-blobs the same
  // way a freeform chat message can.
  registerOpenApiRoute(runWorkflowRoute, async c => {
    const workflowName = c.req.param('name') ?? '';
    const userId = await resolveWebUserId(c);
    if (!isValidWorkflowName(workflowName)) {
      return apiError(c, 400, 'Invalid workflow name');
    }

    let message: string;
    let conversationId: string;
    let workflowInputs: Record<string, string> | undefined;
    let envId: string | undefined;
    let pendingFileEntries: File[] = [];
    let savedFiles: AttachedFile[] = [];
    let uploadDir = '';

    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      let body: Record<string, string | File | (string | File)[]>;
      try {
        body = await c.req.parseBody({ all: true });
      } catch (parseErr: unknown) {
        getLog().warn({ err: parseErr }, 'run_workflow.multipart_parse_failed');
        return apiError(c, 400, 'Invalid multipart form data');
      }

      const rawMessage = body.message;
      const rawConv = body.conversationId;
      if (typeof rawMessage !== 'string' || !rawMessage) {
        return apiError(c, 400, 'message must be a non-empty string');
      }
      if (typeof rawConv !== 'string' || !rawConv || !/^[\w-]+$/.test(rawConv)) {
        return apiError(c, 400, 'conversationId must be a non-empty alphanumeric string');
      }
      message = rawMessage;
      conversationId = rawConv;

      // Declared inputs (#2554). A form field can only be a string, so the map travels
      // JSON-encoded. A malformed field is refused rather than ignored — silently
      // dropping it would start the run without the values the caller thought it sent.
      const rawInputs = body.inputs;
      if (rawInputs !== undefined) {
        if (typeof rawInputs !== 'string') {
          return apiError(c, 400, 'inputs must be a JSON-encoded object of string values');
        }
        let decoded: unknown;
        try {
          decoded = JSON.parse(rawInputs);
        } catch (parseErr: unknown) {
          getLog().warn({ err: parseErr, workflowName }, 'run_workflow.inputs_parse_failed');
          return apiError(c, 400, 'inputs must be a JSON-encoded object of string values');
        }
        const parsed = parseRunInputsField(decoded);
        if (!parsed.ok) return apiError(c, 400, parsed.error);
        workflowInputs = parsed.inputs;
      }

      const envIdParsed = parseOptionalEnvIdField(body.envId);
      if (!envIdParsed.ok) return apiError(c, 400, envIdParsed.error);
      envId = envIdParsed.envId;

      // Collect files only — persistence waits until ENV identity succeeds so a
      // missing/mismatched/corrupt envId never leaves upload side effects.
      const rawFiles = body.files;
      const fileList: (string | File)[] = Array.isArray(rawFiles)
        ? rawFiles
        : rawFiles !== undefined
          ? [rawFiles]
          : [];
      pendingFileEntries = fileList.filter((e): e is File => e instanceof File);
    } else {
      let body: {
        conversationId?: unknown;
        message?: unknown;
        inputs?: unknown;
        envId?: unknown;
      };
      try {
        body = await c.req.json();
      } catch (parseErr: unknown) {
        getLog().warn({ err: parseErr }, 'run_workflow.json_parse_failed');
        return apiError(c, 400, 'Invalid JSON in request body');
      }
      if (typeof body.conversationId !== 'string' || !body.conversationId) {
        return apiError(c, 400, 'conversationId must be a non-empty string');
      }
      if (typeof body.message !== 'string' || !body.message) {
        return apiError(c, 400, 'message must be a non-empty string');
      }
      const parsed = parseRunInputsField(body.inputs);
      if (!parsed.ok) return apiError(c, 400, parsed.error);
      workflowInputs = parsed.inputs;
      conversationId = body.conversationId;
      message = body.message;

      const envIdParsed = parseOptionalEnvIdField(body.envId);
      if (!envIdParsed.ok) return apiError(c, 400, envIdParsed.error);
      envId = envIdParsed.envId;
    }

    // Freeze the selected ENV row before any Start side effect (files / message).
    // Do not discover or apply YAML here — compatibility errors stay on the
    // orchestrator/SSE path (US-008).
    let envOverlay: EnvOverlayCandidate | undefined;
    if (envId !== undefined) {
      let row: WorkflowEnvRow | null;
      try {
        row = await workflowEnvDb.getWorkflowEnvById(envId);
      } catch (error) {
        if (error instanceof workflowEnvDb.WorkflowEnvCorruptRowError) {
          getLog().error({ envId: error.envId }, 'run_workflow.env_corrupt_row');
          return apiError(c, 500, 'env_store_corrupt');
        }
        getLog().error({ err: error, envId }, 'run_workflow.env_lookup_failed');
        return apiError(c, 500, 'Failed to run workflow');
      }
      if (!row) {
        return apiError(c, 400, 'env_not_found');
      }
      // Start identity-checks the decoded route parameter only (no discovery).
      if (row.workflow_name !== workflowName) {
        return apiError(c, 400, 'env_workflow_mismatch');
      }

      // Newly allocated patches tree — never retain the live row/patches reference.
      let patches: EnvPatches;
      try {
        patches = envPatchesSchema.parse(structuredClone(row.patches));
      } catch (error) {
        getLog().error(
          {
            envId: row.id,
            err: error instanceof Error ? error.message : String(error),
          },
          'run_workflow.env_patches_reparse_failed'
        );
        return apiError(c, 500, 'env_store_corrupt');
      }

      envOverlay = Object.freeze({
        envId: row.id,
        envName: row.name,
        workflowName: row.workflow_name,
        patches,
      });
    }

    if (pendingFileEntries.length > 0) {
      const result = await persistUploadedFiles(conversationId, pendingFileEntries);
      if (!result.ok) {
        return apiError(c, result.status, result.error);
      }
      savedFiles = result.savedFiles;
      uploadDir = result.uploadDir;
      getLog().info(
        { conversationId, fileCount: savedFiles.length, workflowName },
        'run_workflow.files_uploaded'
      );
    }

    try {
      // Persist user message and register DB ID (same as message endpoint).
      // File metadata (name/mime/size — no path, since the on-disk file is
      // ephemeral) goes into message metadata when present.
      let conv: Awaited<ReturnType<typeof conversationDb.findConversationByPlatformId>> = null;
      try {
        conv = await conversationDb.findConversationByPlatformId(conversationId);
      } catch (e: unknown) {
        getLog().error({ err: e, conversationId }, 'conversation_lookup_failed');
      }
      if (conv) {
        try {
          const meta =
            savedFiles.length > 0
              ? {
                  files: savedFiles.map(f => ({
                    name: f.name,
                    mimeType: f.mimeType,
                    size: f.size,
                  })),
                }
              : undefined;
          await messageDb.addMessage(conv.id, 'user', message, meta, userId);
        } catch (e: unknown) {
          getLog().error({ err: e, conversationId: conv.id }, 'message_persistence_failed');
        }
        webAdapter.setConversationDbId(conversationId, conv.id);
        if (!conv.title) {
          // Resolve the `small` tier (config tiers + per-user prefs) instead of the raw
          // assistant default (#1855). Both calls never throw.
          void resolveTitleRequest(conv.ai_assistant_type, userId).then(titleRequest =>
            generateAndSetTitle(
              conv.id,
              message,
              titleRequest.provider,
              getArchonWorkspacesPath(),
              workflowName,
              titleRequest.options.assistantConfig,
              titleRequest.options
            )
          );
        }
      }

      // Declared inputs and the frozen ENV candidate ride the context, never
      // `fullMessage` — embedding either would invent a chat grammar and would
      // make supplied values confusable with $ARGUMENTS (#2554/#2555/US-008).
      const fullMessage = `/workflow run ${workflowName} ${message}`;
      const extraContext: Omit<HandleMessageContext, 'isolationHints'> = {
        userId,
        ...(savedFiles.length > 0 ? { attachedFiles: savedFiles } : {}),
        ...(workflowInputs ? { workflowInputs } : {}),
        ...(envOverlay ? { envOverlay } : {}),
      };
      const filesToCleanup = savedFiles.length > 0 ? { files: savedFiles, uploadDir } : undefined;
      const result = await dispatchToOrchestrator(
        conversationId,
        fullMessage,
        extraContext,
        filesToCleanup
      );
      return c.json(result);
    } catch (error) {
      getLog().error({ err: error }, 'run_workflow_failed');
      return apiError(c, 500, 'Failed to run workflow');
    }
  });

  // GET /api/dashboard/runs - Enriched workflow runs for Command Center
  // Supports server-side search, status/date filtering, and offset pagination.
  registerOpenApiRoute(getDashboardRunsRoute, async c => {
    try {
      const rawStatus = c.req.query('status');
      const validStatuses = workflowRunStatusSchema.options;
      type DashboardRunStatus = (typeof validStatuses)[number];
      const status: DashboardRunStatus | undefined =
        rawStatus && (validStatuses as readonly string[]).includes(rawStatus)
          ? (rawStatus as DashboardRunStatus)
          : undefined;
      const codebaseId = c.req.query('codebaseId') ?? undefined;
      const search = c.req.query('search')?.trim() || undefined;
      const after = c.req.query('after') ?? undefined;
      const before = c.req.query('before') ?? undefined;
      const limitRaw = Number(c.req.query('limit'));
      const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(1, limitRaw), 200);
      const offsetRaw = Number(c.req.query('offset'));
      const offset = Number.isNaN(offsetRaw) ? 0 : Math.max(0, offsetRaw);

      const result = await workflowDb.listDashboardRuns({
        status,
        codebaseId,
        search,
        after,
        before,
        limit,
        offset,
      });
      return c.json({
        ...result,
        runs: result.runs.map(toApiDashboardWorkflowRun),
      });
    } catch (error) {
      getLog().error({ err: error }, 'list_dashboard_runs_failed');
      return apiError(c, 500, 'Failed to list dashboard runs');
    }
  });

  // POST /api/workflows/runs/:runId/cancel - Cancel a workflow run
  registerOpenApiRoute(cancelWorkflowRunRoute, async c => {
    try {
      const runId = c.req.param('runId') ?? '';
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (run.status !== 'running' && run.status !== 'pending' && run.status !== 'paused') {
        return apiError(c, 400, `Cannot cancel workflow in '${run.status}' status`);
      }
      const { cancelled } = await workflowDb.cancelWorkflowRun(runId);
      return c.json({
        success: true,
        message: cancelled
          ? `Cancelled workflow: ${run.workflow_name}`
          : `Workflow ${run.workflow_name} already finished — nothing to cancel.`,
      });
    } catch (error) {
      getLog().error({ err: error }, 'cancel_workflow_run_api_failed');
      return apiError(c, 500, 'Failed to cancel workflow run');
    }
  });

  // POST /api/workflows/runs/:runId/callback/test - Exercise the real callback outbox.
  registerOpenApiRoute(testWorkflowRunCallbackRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) return apiError(c, 404, 'Workflow run not found');
      if (!run.codebase_id) return apiError(c, 400, 'Workflow run has no codebase');

      const occurredAt = new Date().toISOString();
      const { createWorkflowStore } = await import('@archon/core/workflows/store-adapter');
      await createWorkflowStore().enqueueExternalWorkflowEvent({
        workflow_run_id: runId,
        event_type: 'workflow.run.completed',
        occurred_at: occurredAt,
        payload: {
          state: 'completed',
          result: { outcome: 'manual-test', completedAt: occurredAt },
        },
      });
      return c.json(
        { accepted: true as const, runId, eventType: 'workflow.run.completed' as const },
        202
      );
    } catch (error) {
      getLog().error({ err: error, runId }, 'test_workflow_callback_failed');
      return apiError(c, 500, 'Failed to queue test callback');
    }
  });

  // POST /api/workflows/runs/:runId/resume - Resume a workflow run
  registerOpenApiRoute(resumeWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await resumeWorkflow(runId);
      // Dispatch resume by sending `/workflow resume <id>` to the parent web
      // conversation; the command handler validates the run and hands the
      // orchestrator an explicit resumeRun to hydrate. Explicit targeting (not
      // a bare `/workflow run <name>`) so a genuinely-failed run resumes
      // directly instead of hitting the disambiguation prompt (#2075).
      // Mirrors the approve/reject auto-resume path.
      if (!run.parent_conversation_id) {
        return apiError(
          c,
          400,
          `This run was created outside the web UI. Use \`archon workflow resume ${runId}\` from the CLI to resume it.`
        );
      }
      const parentConv = await conversationDb.getConversationById(run.parent_conversation_id);
      if (!parentConv?.platform_conversation_id || parentConv.platform_type !== 'web') {
        return apiError(
          c,
          400,
          `Cannot resume from web UI: the run's parent conversation is not a web conversation. Use \`archon workflow resume ${runId}\` from the CLI.`
        );
      }
      const resumeMessage = `/workflow resume ${run.id}`;
      // Resume executes as the user who clicked resume (sender-first, #1982),
      // not the conversation creator. Undefined on solo installs → fallback.
      await dispatchToOrchestrator(parentConv.platform_conversation_id, resumeMessage, {
        userId: await resolveWebUserId(c),
      });
      getLog().info(
        {
          runId,
          workflowName: run.workflow_name,
          platformConvId: parentConv.platform_conversation_id,
        },
        'api.workflow_run_resume_dispatched'
      );
      return c.json({
        success: true,
        message: `Resuming workflow: ${run.workflow_name}`,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Workflow run not found:')) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (
        error instanceof Error &&
        (error.message.startsWith('Answer or decline the Ask before resuming run ') ||
          error.message.startsWith('Cannot resume run with status '))
      ) {
        return apiError(c, 400, error.message);
      }
      getLog().error({ err: error, runId }, 'api.workflow_run_resume_failed');
      return apiError(c, 500, 'Failed to resume workflow run');
    }
  });

  // GET /api/workflows/runs/:runId/nodes/:nodeId/retry/preview - Preview retry checkout choice
  registerOpenApiRoute(retryWorkflowNodePreviewRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const nodeId = c.req.param('nodeId') ?? '';
    if (!runId || !nodeId) {
      return apiError(c, 400, 'runId and nodeId are required');
    }

    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (!RETRYABLE_WORKFLOW_STATUSES.includes(run.status)) {
        return apiError(
          c,
          400,
          `Cannot retry workflow in '${run.status}' status. Only failed, cancelled, or completed runs can be retried.`
        );
      }

      const auth = await authorizeWorkflowNodeRetry(c, run);
      if ('error' in auth) return auth.error;

      if (!run.parent_conversation_id) {
        return apiError(
          c,
          400,
          `This run was created outside the web UI. Use \`archon workflow retry-node ${runId} ${nodeId}\` from the CLI to retry it.`
        );
      }

      const parentConv = await conversationDb.getConversationById(run.parent_conversation_id);
      if (!parentConv?.platform_conversation_id || parentConv.platform_type !== 'web') {
        return apiError(
          c,
          400,
          `Cannot retry from web UI: the run's parent conversation is not a web conversation. Use \`archon workflow retry-node ${runId} ${nodeId}\` from the CLI.`
        );
      }
      if (!run.working_path) {
        return apiError(c, 400, 'Cannot retry: workflow run has no working path');
      }

      let lookup: RetryWorkflowLookup;
      try {
        lookup = await loadWorkflowForRetryRun(run);
      } catch (error) {
        const err = error as Error;
        return apiError(c, 400, err.message);
      }

      const { getWorkflowNodeRetryPreview } =
        await import('@archon/core/operations/workflow-retry');
      try {
        const preview = await getWorkflowNodeRetryPreview({
          runId,
          nodeId,
          workflow: lookup.workflow,
        });
        return c.json({
          runId,
          workflowName: preview.workflowName,
          nodeId,
          retryEpoch: preview.retryEpoch,
          invalidatedNodes: preview.invalidatedNodeIds,
          resetSkipped: preview.resetSkipped,
          ...(preview.checkpointRef ? { checkpointRef: preview.checkpointRef } : {}),
          ...(preview.checkpointCommitSha
            ? { checkpointCommitSha: preview.checkpointCommitSha }
            : {}),
          ...(preview.currentHeadSha ? { currentHeadSha: preview.currentHeadSha } : {}),
          hasNewerHead: preview.hasNewerHead,
          requiresCommitChoice: preview.requiresCommitChoice,
        });
      } catch (error) {
        const err = error as Error;
        return apiError(c, getRetryErrorStatus(error), err.message);
      }
    } catch (error) {
      getLog().error({ err: error, runId, nodeId }, 'api.workflow_retry_preview_failed');
      return apiError(c, 500, 'Failed to preview workflow node retry');
    }
  });

  // POST /api/workflows/runs/:runId/nodes/:nodeId/retry - Retry a failed DAG node
  registerOpenApiRoute(retryWorkflowNodeRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const nodeId = c.req.param('nodeId') ?? '';
    if (!runId || !nodeId) {
      return apiError(c, 400, 'runId and nodeId are required');
    }

    try {
      const body = getOptionalValidatedBody(c, retryWorkflowNodeBodySchema) ?? {};
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (!RETRYABLE_WORKFLOW_STATUSES.includes(run.status)) {
        return apiError(
          c,
          400,
          `Cannot retry workflow in '${run.status}' status. Only failed, cancelled, or completed runs can be retried.`
        );
      }

      const auth = await authorizeWorkflowNodeRetry(c, run);
      if ('error' in auth) return auth.error;

      if (!run.parent_conversation_id) {
        return apiError(
          c,
          400,
          `This run was created outside the web UI. Use \`archon workflow retry-node ${runId} ${nodeId}\` from the CLI to retry it.`
        );
      }

      const parentConv = await conversationDb.getConversationById(run.parent_conversation_id);
      if (!parentConv?.platform_conversation_id || parentConv.platform_type !== 'web') {
        return apiError(
          c,
          400,
          `Cannot retry from web UI: the run's parent conversation is not a web conversation. Use \`archon workflow retry-node ${runId} ${nodeId}\` from the CLI.`
        );
      }

      const workerConv = await conversationDb.getConversationById(run.conversation_id);
      if (!workerConv?.platform_conversation_id) {
        return apiError(c, 400, 'Cannot retry: worker conversation is missing');
      }
      if (!run.working_path) {
        return apiError(c, 400, 'Cannot retry: workflow run has no working path');
      }

      let lookup: RetryWorkflowLookup;
      try {
        lookup = await loadWorkflowForRetryRun(run);
      } catch (error) {
        const err = error as Error;
        return apiError(c, 400, err.message);
      }

      const { prepareWorkflowNodeRetry } = await import('@archon/core/operations/workflow-retry');
      let prepared: Awaited<ReturnType<typeof prepareWorkflowNodeRetry>>;
      try {
        prepared = await prepareWorkflowNodeRetry({
          runId,
          nodeId,
          workflow: lookup.workflow,
          requesterSurface: 'web',
          requesterUserId: auth.requesterUserId,
          authorizationBasis: auth.authorizationBasis,
          checkoutStrategy: body.checkoutStrategy,
        });
      } catch (error) {
        const err = error as Error;
        return apiError(c, getRetryErrorStatus(error), err.message);
      }

      try {
        await dispatchPreparedWebRetry({
          run,
          workflow: lookup.workflow,
          source: lookup.source,
          workerPlatformId: workerConv.platform_conversation_id,
          parentPlatformId: parentConv.platform_conversation_id,
          workingPath: run.working_path,
          targetNodeId: nodeId,
          prepared,
          baseBranch: lookup.baseBranch,
        });
      } catch (error) {
        const err = error as Error;
        await restoreRunAfterRetryDispatchFailure(runId, err);
        getLog().error({ err, runId, nodeId }, 'api.workflow_retry_dispatch_failed');
        return apiError(c, 500, `Failed to dispatch retry: ${err.message}`);
      }

      const downstreamCount = Math.max(0, prepared.invalidatedNodeIds.length - 1);
      return c.json({
        success: true,
        message: `Retrying node ${nodeId} and ${String(downstreamCount)} downstream node(s).`,
        runId,
        nodeId,
        retryEpoch: prepared.retryEpoch,
        invalidatedNodes: prepared.invalidatedNodeIds,
        ...(prepared.safetyCommitSha ? { safetyCommitSha: prepared.safetyCommitSha } : {}),
        checkoutStrategy: prepared.checkoutStrategy,
      });
    } catch (error) {
      getLog().error({ err: error as Error, runId, nodeId }, 'api.workflow_retry_failed');
      return apiError(c, 500, 'Failed to retry workflow node');
    }
  });

  // POST /api/workflows/runs/:runId/abandon - Abandon a workflow run
  registerOpenApiRoute(abandonWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      // A `failed` run is terminal per TERMINAL_WORKFLOW_STATUSES but remains
      // resumable, so the user must be able to discard it — only the two
      // non-resumable terminal states are blocked (the 400 mapping lives here;
      // abandonWorkflow re-validates).
      if (run.status === 'completed' || run.status === 'cancelled') {
        return apiError(
          c,
          400,
          `Cannot abandon run with status '${run.status}'. Only running, paused, or failed runs can be abandoned.`
        );
      }
      // Delegate to the SHARED op — a raw cancelWorkflowRun here previously skipped
      // the sub-run cascade cancel AND the container reclaim (M2), so a web abandon
      // orphaned children that CLI/chat abandons cleaned up.
      const { cascadeFailures, blockedParentRunId } = await abandonWorkflow(runId);
      let message = `Abandoned workflow: ${run.workflow_name}`;
      if (cascadeFailures > 0) {
        message += ` — warning: ${String(cascadeFailures)} sub-run(s) could not be cancelled and may still be running`;
      }
      if (blockedParentRunId) {
        message += ` — parent run ${blockedParentRunId} was blocked on this sub-run and stays paused; resume it to fail the node cleanly or abandon it too`;
      }
      return c.json({ success: true, message });
    } catch (error) {
      getLog().error({ err: error, runId }, 'api.workflow_run_abandon_failed');
      return apiError(c, 500, 'Failed to abandon workflow run');
    }
  });

  // POST /api/workflows/runs/:runId/review-open — re-open plannotator_gate surface
  registerOpenApiRoute(reviewOpenWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      const result = await reviewOpenWorkflow(runId);
      const autoResumed = await tryAutoResumeAfterGate(
        run,
        'review-open',
        await resolveWebUserId(c)
      );
      return c.json({
        success: true,
        document: result.document,
        nodeId: result.nodeId,
        phase: result.phase,
        continuation: result.continuation,
        message: autoResumed
          ? `Review takeover recorded for ${run.workflow_name}. Resuming workflow.`
          : `Review takeover recorded for ${run.workflow_name}. Run \`archon workflow resume ${runId}\` from the CLI to start the replacement, or send a new message in the originating conversation.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found') || message.includes('Not found')) {
        return apiError(c, 404, message);
      }
      if (
        message.includes('Cannot review-open') ||
        message.includes('not paused at a plannotator_gate') ||
        message.includes('already') ||
        message.includes('no document') ||
        message.includes('no gate ownership token') ||
        message.includes('ownership changed') ||
        message.includes('stopped with status')
      ) {
        return apiError(c, 400, message);
      }
      getLog().error({ err: error, runId }, 'api.workflow_run_review_open_failed');
      return apiError(c, 500, 'Failed to review-open workflow run');
    }
  });

  // POST /api/workflows/runs/:runId/review-feedback - Submit inline Plannotator review feedback
  registerOpenApiRoute(reviewFeedbackWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const body = getValidatedBody(c, reviewFeedbackBodySchema);
    try {
      const result = await workflowDb.submitReviewFeedback({
        runId,
        nodeId: body.nodeId,
        gateId: body.gateId,
        reviewSessionId: body.reviewSessionId,
        requestId: body.requestId,
        feedback: body.feedback,
      });
      if (result.outcome === 'rejected') {
        return apiError(c, result.statusCode as 400 | 404, result.reason);
      }
      if (result.outcome === 'conflict') {
        return apiError(c, 409, result.reason);
      }
      const { receipt } = result;
      return c.json({
        requestId: receipt.requestId,
        reviewSessionId: receipt.reviewSessionId,
        status: receipt.status,
        submittedAt: receipt.submittedAt,
      });
    } catch (error) {
      getLog().error({ err: error, runId }, 'api.workflow_run_review_feedback_failed');
      return apiError(c, 500, 'Failed to submit review feedback');
    }
  });

  // POST /api/workflows/runs/:runId/approve - Approve a paused workflow run
  registerOpenApiRoute(approveWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (run.status !== 'paused') {
        return apiError(c, 400, `Cannot approve workflow in '${run.status}' status`);
      }
      const approvalRaw = run.metadata.approval;
      const approval = isApprovalContext(approvalRaw) ? approvalRaw : undefined;
      if (!approval?.nodeId) {
        return apiError(c, 400, 'Workflow run is paused but missing approval context');
      }
      if (approval.type === 'child_workflow') {
        // Not an approvable gate — the parent resumes automatically when the child
        // completes. approveWorkflow throws the same redirect; map it to a 400
        // here so the console gets the message instead of an opaque 500.
        return apiError(
          c,
          400,
          `Run is paused waiting on sub-run ${approval.childRunId ?? '<unknown>'}. Approve or reject the child run instead.`
        );
      }
      if (isGateResolved(approval)) {
        // Post-#2075 the run stays 'paused' after approval, so status alone no
        // longer distinguishes "awaiting the human" from "awaiting resume".
        return apiError(
          c,
          400,
          `Workflow run was already ${String(approval.resolved)} — resume in progress`
        );
      }
      // Distinguish "no body sent" (legitimate bare approve) from "body sent but
      // unparseable" (client bug). Since #2074 a bare approve FINALIZES a
      // signal-bearing loop gate, so silently coercing a malformed body to {}
      // would discard intended feedback and finalize undiagnosed — reject it.
      const rawBody = await c.req.text();
      let body: { comment?: string } = {};
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody) as { comment?: string };
        } catch (parseError) {
          getLog().warn({ err: parseError, runId }, 'api.approve_body_parse_failed');
          return apiError(
            c,
            400,
            'Request body is not valid JSON — send {"comment": "..."} or no body'
          );
        }
      }
      // Shared gate logic (events, telemetry, metadata staging) — the run stays
      // 'paused' with metadata.approval.resolved = 'approved' (#2075). The
      // pre-checks above map the common error cases to 400s; approveWorkflow
      // re-validates and anything it throws past them is a 500.
      // The raw (possibly undefined) comment is passed through — approveWorkflow
      // defaults the recorded comment internally, but "no feedback" must survive
      // so a signal-bearing interactive-loop gate finalizes instead of re-running
      // (#2074, loop_feedback_given).
      const approvalResult = await approveWorkflow(runId, body.comment);

      if (approvalResult.continuation === 'live_plannotator_supervisor') {
        return c.json({
          success: true,
          message: `Workflow approved: ${run.workflow_name}. The live Plannotator supervisor will continue this workflow.`,
        });
      }

      // Auto-resume: dispatch to the orchestrator so the workflow continues
      // without requiring the user to re-run the workflow command. Mirrors
      // what `workflowApproveCommand` does in the CLI. Requires
      // `parent_conversation_id` on the run (set by orchestrator-agent for any
      // web-dispatched workflow — foreground, interactive, and background via
      // the pre-created run) and a web-platform parent (guarded in the helper).
      const autoResumed = await tryAutoResumeAfterGate(run, 'approve', await resolveWebUserId(c));

      return c.json({
        success: true,
        message: autoResumed
          ? `Workflow approved: ${run.workflow_name}. Resuming workflow.`
          : `Workflow approved: ${run.workflow_name}. Run \`archon workflow resume ${runId}\` from the CLI to continue, or resume it from the originating conversation.`,
      });
    } catch (error) {
      getLog().error({ err: error, runId }, 'api.workflow_run_approve_failed');
      return apiError(c, 500, 'Failed to approve workflow run');
    }
  });

  // POST /api/workflows/runs/:runId/reject - Reject a paused workflow run
  registerOpenApiRoute(rejectWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (run.status !== 'paused') {
        return apiError(c, 400, `Cannot reject workflow in '${run.status}' status`);
      }
      const approvalRaw = run.metadata.approval;
      const approval = isApprovalContext(approvalRaw) ? approvalRaw : undefined;
      if (approval?.type === 'child_workflow') {
        // Mirror of the approve route's guard — rejectWorkflow throws the same
        // redirect; map it to a 400 with the child pointer.
        return apiError(
          c,
          400,
          `Run is paused waiting on sub-run ${approval.childRunId ?? '<unknown>'}. Reject the child run instead, or abandon this run to discard the whole tree.`
        );
      }
      if (approval && isGateResolved(approval)) {
        return apiError(
          c,
          400,
          `Workflow run was already ${String(approval.resolved)} — resume in progress`
        );
      }
      // Mirror of the approve route's malformed-body guard: a swallowed parse
      // failure would silently drop the reviewer's reason.
      const rawBody = await c.req.text();
      let body: { reason?: string } = {};
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody) as { reason?: string };
        } catch (parseError) {
          getLog().warn({ err: parseError, runId }, 'api.reject_body_parse_failed');
          return apiError(
            c,
            400,
            'Request body is not valid JSON — send {"reason": "..."} or no body'
          );
        }
      }
      const reason = body.reason ?? 'Rejected';
      // Shared gate logic (events, telemetry, staging/cancel decision). When an
      // on_reject rework is staged the run stays 'paused' with
      // metadata.approval.resolved = 'rejected' (#2075).
      const result = await rejectWorkflow(runId, reason);

      if (result.cancelled) {
        return c.json({
          success: true,
          message: result.maxAttemptsReached
            ? `Workflow rejected and cancelled (max attempts reached): ${run.workflow_name}`
            : `Workflow rejected: ${run.workflow_name}`,
        });
      }

      // Auto-resume: dispatch to the orchestrator so the on_reject prompt runs
      // without requiring the user to re-run the workflow command. Mirrors
      // what `workflowRejectCommand` does in the CLI. Same cross-adapter
      // guard as approve — only web parents auto-resume.
      const autoResumed = await tryAutoResumeAfterGate(run, 'reject', await resolveWebUserId(c));

      return c.json({
        success: true,
        message: autoResumed
          ? `Workflow rejected: ${run.workflow_name}. Running on-reject prompt.`
          : `Workflow rejected: ${run.workflow_name}. On-reject prompt will run when the run resumes — run \`archon workflow resume ${runId}\` from the CLI to trigger it.`,
      });
    } catch (error) {
      getLog().error({ err: error, runId }, 'api.workflow_run_reject_failed');
      return apiError(c, 500, 'Failed to reject workflow run');
    }
  });

  // When web auth / the API gate is on, require an identity before OpenAPI
  // body validation. Solo installs record answers as `admin`.
  app.use('/api/workflows/runs/:runId/ask/:requestId/answer', async (c, next) => {
    if (c.req.method !== 'POST') return next();
    if (!isWebAuthEnabled() && !isApiGateEnabled()) return next();
    const requester = await resolveAuthContext(c);
    if (!requester) return apiError(c, 401, 'Authentication required');
    return next();
  });

  // POST /api/workflows/runs/:runId/ask/:requestId/answer - Answer or decline AskHuman
  registerOpenApiRoute(answerAskHumanRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const requestId = c.req.param('requestId') ?? '';
    try {
      const requester = await resolveAuthContext(c);
      if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
        return apiError(c, 401, 'Authentication required');
      }
      const body = getValidatedBody(c, askAnswerRequestSchema);
      const result = await answerAskHuman({
        runId,
        requestId,
        body,
        actorUserId: requester?.userId,
      });

      if (!result.resumed) {
        return c.json({
          success: true,
          message: `AskHuman answer accepted: ${result.run.workflow_name}. Other interactions remain.`,
        });
      }

      const autoResumed = await tryAutoResumeAfterGate(result.run, 'ask-answer', requester?.userId);
      return c.json({
        success: true,
        message: autoResumed
          ? `AskHuman answer accepted: ${result.run.workflow_name}. Resuming workflow.`
          : `AskHuman answer accepted: ${result.run.workflow_name}. Run \`archon workflow resume ${runId}\` from the CLI to continue, or resume it from the originating conversation.`,
      });
    } catch (error) {
      if (
        error instanceof AskHumanRunNotFoundError ||
        error instanceof workflowPendingInteractionDb.PendingInteractionNotFoundError
      ) {
        return apiError(c, 404, error.message);
      }
      if (
        error instanceof workflowPendingInteractionDb.PendingInteractionAlreadyResolvedError ||
        error instanceof workflowPendingInteractionDb.PendingInteractionRunNotPausedError
      ) {
        return apiError(c, 409, error.message);
      }
      if (error instanceof workflowPendingInteractionDb.PendingInteractionValidationError) {
        return apiError(c, 400, error.message);
      }
      getLog().error({ err: error, runId, requestId }, 'api.workflow_ask_answer_failed');
      return apiError(c, 500, 'Failed to answer AskHuman');
    }
  });

  // Enforce Permission confirm auth before OpenAPI body validation so
  // unauthenticated callers receive 401 even when the install-wide API gate
  // is disabled.
  app.use('/api/workflows/runs/:runId/permissions/:callId/confirm', async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const requester = await resolveAuthContext(c);
    if (!requester) return apiError(c, 401, 'Authentication required');
    return next();
  });

  // POST /api/workflows/runs/:runId/permissions/:callId/confirm
  registerOpenApiRoute(confirmPermissionRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const callId = c.req.param('callId') ?? '';
    try {
      const requester = await resolveAuthContext(c);
      if (!requester) return apiError(c, 401, 'Authentication required');
      const body = getValidatedBody(c, permissionConfirmRequestSchema);
      const result = await confirmPermission({
        runId,
        callId,
        body,
        actorUserId: requester.userId,
      });
      return c.json({
        success: true,
        message:
          result.remainingPending > 0
            ? `Permission confirmation accepted: ${result.run.workflow_name}. Other interactions remain.`
            : `Permission confirmation accepted: ${result.run.workflow_name}.`,
      });
    } catch (error) {
      if (error instanceof PermissionAuthenticationRequiredError) {
        return apiError(c, 401, error.message);
      }
      if (error instanceof PermissionForbiddenError) {
        return apiError(c, 403, error.message);
      }
      if (
        error instanceof PermissionRunNotFoundError ||
        error instanceof workflowPendingInteractionDb.PendingInteractionNotFoundError
      ) {
        return apiError(c, 404, error.message);
      }
      if (
        error instanceof workflowPendingInteractionDb.PendingInteractionAlreadyResolvedError ||
        error instanceof workflowPendingInteractionDb.PendingInteractionRunNotPausedError
      ) {
        return apiError(c, 409, error.message);
      }
      if (error instanceof workflowPendingInteractionDb.PendingInteractionValidationError) {
        return apiError(c, 400, error.message);
      }
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      getLog().error({ errorName, runId, callId }, 'api.workflow_permission_confirm_failed');
      return apiError(c, 500, 'Failed to confirm permission');
    }
  });

  // Steering send (issue #181): the auth check runs before OpenAPI body
  // validation so a gated unauthenticated caller receives 401 even with a
  // malformed body. The JSON pre-parse maps malformed bodies onto the nested
  // steering error shape — Hono's validator otherwise throws an HTTPException
  // that compose's onError swallows before the route-scoped Zod hook runs;
  // the cached text body feeds the downstream validator unchanged.
  app.use('/api/workflows/runs/:runId/nodes/:nodeId/send', async (c, next) => {
    if (c.req.method !== 'POST') return next();
    if (isWebAuthEnabled() || isApiGateEnabled()) {
      const requester = await resolveAuthContext(c);
      if (!requester) {
        return steeringError(c, 401, 'unauthenticated', 'Authentication required');
      }
    }
    const contentType = c.req.header('Content-Type');
    if (contentType !== undefined && /^application\/([a-z-.]+\+)?json/i.test(contentType)) {
      try {
        await c.req.json();
      } catch {
        return steeringError(c, 400, 'invalid_request', 'Malformed request body');
      }
    }
    return next();
  });

  // POST /api/workflows/runs/:runId/nodes/:nodeId/send - Queue operator guidance
  registerOpenApiRoute(
    sendWorkflowNodeRoute,
    async c => {
      const runId = c.req.param('runId') ?? '';
      const nodeId = c.req.param('nodeId') ?? '';
      try {
        const requester = await resolveAuthContext(c);
        if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
          return steeringError(c, 401, 'unauthenticated', 'Authentication required');
        }
        const body = getValidatedBody(c, sendWorkflowNodeBodySchema);

        const run = await workflowDb.getWorkflowRun(runId);
        if (!run) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }

        // Project the effective node state and inspect the registry handle to
        // establish the target. The projection is authoritative for lifecycle —
        // a stale live handle can never beat a terminal run/node.
        const events = await workflowEventDb.listWorkflowEvents(runId);
        const pendingInteractions =
          await workflowPendingInteractionDb.listPendingInteractions(runId);
        const nodeState = projectApiWorkflowNodeStates(events, pendingInteractions).find(
          state => state.nodeId === nodeId
        );
        const handle = getSteeringRegistry().get(runId, nodeId);

        if (nodeState === undefined && handle === undefined) {
          return steeringError(c, 404, 'not_found', 'Workflow node not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }
        if (nodeState !== undefined && TERMINAL_API_NODE_STATUSES.includes(nodeState.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        if (handle?.snapshot().phase === 'closed') {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        if (handle === undefined) {
          return steeringError(
            c,
            422,
            'not_steerable_here',
            'No live steering session for this node in this process'
          );
        }

        // Final gate: a concurrent terminal transition wins. enqueue() is
        // synchronous — no await runs between this read and the mutation.
        const latestRun = await workflowDb.getWorkflowRun(runId);
        if (latestRun === null) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(latestRun.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }

        // The registry owns the atomic mutation: receipt acceptance, the idle
        // check, and the send_now release happen in ONE synchronous step — the
        // route never performs "read sub-state, then send now" as two
        // operations, and no await sits between the final gate and accept.
        const result = handle.accept(
          {
            messageId: body.message_id,
            message: body.message,
            operatorUserId: requester?.userId ?? null,
            receivedAt: new Date().toISOString(),
          },
          body.intent
        );
        if (!result.ok) {
          return result.reason === 'closed'
            ? steeringError(c, 409, 'node_finished', 'Workflow node is finished')
            : steeringError(
                c,
                422,
                'not_steerable_here',
                'No live steering session for this node in this process'
              );
        }
        // The receipt is immutable and idempotent: `queued` while generating/
        // interrupting, `awaiting_send_now` while idle — including the very
        // message whose send_now released the batch.
        return c.json(
          {
            success: true as const,
            message_id: result.receipt.messageId,
            state: result.receipt.state,
          },
          200
        );
      } catch (error) {
        getLog().error({ err: error, runId, nodeId }, 'api.workflow_node_send_failed');
        return steeringError(c, 500, 'internal_error', 'Failed to queue guidance');
      }
    },
    steeringValidationErrorHook
  );

  // POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt - Stop the live turn
  //
  // No body → no send-route-style middleware needed: param validation cannot
  // fail on a matched route, so the in-handler auth check still runs before any
  // rejection a gated caller could hit. Sequencing mirrors send: persisted
  // lifecycle outranks a stale handle, the final run-status re-read is the last
  // await, then handle.interrupt() runs SYNCHRONOUSLY (no-torn-controller
  // boundary — a caller disconnect after this point does not undo the abort)
  // and the response maps the engine's classified settlement, never a guess.
  registerOpenApiRoute(
    interruptWorkflowNodeRoute,
    async c => {
      const runId = c.req.param('runId') ?? '';
      const nodeId = c.req.param('nodeId') ?? '';
      try {
        const requester = await resolveAuthContext(c);
        if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
          return steeringError(c, 401, 'unauthenticated', 'Authentication required');
        }

        const run = await workflowDb.getWorkflowRun(runId);
        if (!run) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }

        const events = await workflowEventDb.listWorkflowEvents(runId);
        const pendingInteractions =
          await workflowPendingInteractionDb.listPendingInteractions(runId);
        const nodeState = projectApiWorkflowNodeStates(events, pendingInteractions).find(
          state => state.nodeId === nodeId
        );
        const handle = getSteeringRegistry().get(runId, nodeId);

        if (nodeState === undefined && handle === undefined) {
          return steeringError(c, 404, 'not_found', 'Workflow node not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }
        if (nodeState !== undefined && TERMINAL_API_NODE_STATUSES.includes(nodeState.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        if (handle?.snapshot().phase === 'closed') {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        if (handle === undefined) {
          return steeringError(
            c,
            422,
            'not_steerable_here',
            'No live steering session for this node in this process'
          );
        }

        // Final async gate: a concurrent terminal transition wins. Everything
        // below is synchronous until the settlement await — interrupt() aborts
        // the stored turn controller at call time, so no await may sit between
        // this read and the call.
        const latestRun = await workflowDb.getWorkflowRun(runId);
        if (latestRun === null) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(latestRun.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }

        const settlement = await handle.interrupt();
        switch (settlement) {
          case 'idle-after-interrupt':
            return c.json(
              { success: true as const, sub_state: 'idle-after-interrupt' as const },
              200
            );
          case 'generating':
            return c.json({ success: true as const, sub_state: 'generating' as const }, 200);
          case 'node_finished':
            return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
          case 'not_steerable_here':
            return steeringError(
              c,
              422,
              'not_steerable_here',
              'No live steering session for this node in this process'
            );
        }
      } catch (error) {
        getLog().error({ err: error, runId, nodeId }, 'api.workflow_node_interrupt_failed');
        return steeringError(c, 500, 'internal_error', 'Failed to interrupt node');
      }
    },
    steeringValidationErrorHook
  );

  // DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId - Withdraw queued guidance
  registerOpenApiRoute(
    withdrawWorkflowNodeRoute,
    async c => {
      const runId = c.req.param('runId') ?? '';
      const nodeId = c.req.param('nodeId') ?? '';
      const messageId = c.req.param('messageId') ?? '';
      try {
        const requester = await resolveAuthContext(c);
        if ((isWebAuthEnabled() || isApiGateEnabled()) && !requester) {
          return steeringError(c, 401, 'unauthenticated', 'Authentication required');
        }

        const run = await workflowDb.getWorkflowRun(runId);
        if (!run) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }

        // Project the effective node state and inspect the registry handle to
        // establish the target — the same precedence ladder as send. The
        // projection is authoritative for lifecycle: a stale live handle can
        // never beat a terminal run/node. A parked handle is intentionally
        // allowed — withdraw manages the queue, not the provider session.
        const events = await workflowEventDb.listWorkflowEvents(runId);
        const pendingInteractions =
          await workflowPendingInteractionDb.listPendingInteractions(runId);
        const nodeState = projectApiWorkflowNodeStates(events, pendingInteractions).find(
          state => state.nodeId === nodeId
        );
        const handle = getSteeringRegistry().get(runId, nodeId);

        if (nodeState === undefined && handle === undefined) {
          return steeringError(c, 404, 'not_found', 'Workflow node not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }
        if (nodeState !== undefined && TERMINAL_API_NODE_STATUSES.includes(nodeState.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        if (handle?.snapshot().phase === 'closed') {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        if (handle === undefined) {
          return steeringError(
            c,
            422,
            'not_steerable_here',
            'No live steering session for this node in this process'
          );
        }

        // Final gate: a concurrent terminal transition wins. withdraw() is
        // synchronous — no await runs between the post-await phase recheck
        // and the mutation.
        const latestRun = await workflowDb.getWorkflowRun(runId);
        if (latestRun === null) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(latestRun.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }

        // The run re-read awaited — the handle may have closed during that gap
        // (the executor's teardown gate). Recheck before mutating: withdraw()
        // alone cannot distinguish "closed" from "id not found" by boolean.
        if (handle.snapshot().phase === 'closed') {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }

        const removed = handle.withdraw(messageId);
        getLog().info(
          {
            runId,
            nodeId,
            messageId,
            operatorUserId: requester?.userId ?? null,
            removed,
          },
          'api.workflow_node_withdraw_completed'
        );
        return c.json({ success: true as const, message_id: messageId }, 200);
      } catch (error) {
        getLog().error(
          { err: error, runId, nodeId, messageId },
          'api.workflow_node_withdraw_failed'
        );
        return steeringError(c, 500, 'internal_error', 'Failed to withdraw guidance');
      }
    },
    steeringValidationErrorHook
  );

  // GET /api/workflows/runs/:runId/nodes/:nodeId/queue - Read queued guidance
  // Authentication was already enforced by the pre-gate middleware above —
  // the read needs no requester (no attribution), so it is not resolved again.
  registerOpenApiRoute(
    readWorkflowNodeQueueRoute,
    async c => {
      const runId = c.req.param('runId') ?? '';
      const nodeId = c.req.param('nodeId') ?? '';
      try {
        const run = await workflowDb.getWorkflowRun(runId);
        if (!run) {
          return steeringError(c, 404, 'not_found', 'Workflow run not found');
        }
        if (TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow run is finished');
        }

        // Hot path: one synchronous registry get + one snapshot() in the same
        // tick — deliberately NO workflow-event, message, or pending-
        // interaction reads. The executor seals a direct-node handle before
        // the first awaited terminal write (dag-executor.ts ~3290-3568; loop
        // registration/drain/cleanup ~5669-5674 and ~6868-7119), so a live or
        // parked handle's pending list is already truthful. Do not
        // reintroduce per-poll event-history reads here.
        const handle = getSteeringRegistry().get(runId, nodeId);
        if (handle !== undefined) {
          const snapshot = handle.snapshot();
          if (snapshot.phase === 'closed') {
            return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
          }
          return c.json(
            {
              success: true as const,
              queued: snapshot.queued.map(item => ({
                message_id: item.messageId,
                message: item.message,
              })),
            },
            200
          );
        }

        // Cold path: no in-process handle — classify the node from the event
        // projection alone (no pending-interaction read; this route never
        // steers, so ask/permission state is irrelevant to the snapshot).
        const events = await workflowEventDb.listWorkflowEvents(runId);
        const nodeState = projectApiWorkflowNodeStates(events).find(
          state => state.nodeId === nodeId
        );
        if (nodeState === undefined) {
          return steeringError(c, 404, 'not_found', 'Workflow node not found');
        }
        if (TERMINAL_API_NODE_STATUSES.includes(nodeState.status)) {
          return steeringError(c, 409, 'node_finished', 'Workflow node is finished');
        }
        return steeringError(
          c,
          422,
          'not_steerable_here',
          'No live steering session for this node in this process'
        );
      } catch (error) {
        // Content-free: the err object carries no queued-message text.
        getLog().error({ err: error, runId, nodeId }, 'api.workflow_node_queue_read_failed');
        return steeringError(c, 500, 'internal_error', 'Failed to read queued guidance');
      }
    },
    steeringValidationErrorHook
  );

  // DELETE /api/workflows/runs/:runId - Delete a workflow run
  registerOpenApiRoute(deleteWorkflowRunRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      if (!TERMINAL_WORKFLOW_STATUSES.includes(run.status)) {
        return apiError(
          c,
          400,
          `Cannot delete workflow in '${run.status}' status — cancel it first`
        );
      }
      await workflowDb.deleteWorkflowRun(runId);
      return c.json({ success: true, message: `Deleted workflow run: ${run.workflow_name}` });
    } catch (error) {
      getLog().error({ err: error, runId }, 'api.workflow_run_delete_failed');
      return apiError(c, 500, 'Failed to delete workflow run');
    }
  });

  // DELETE /api/workflows/:name/node-sessions - Reset persisted per-node provider sessions
  registerOpenApiRoute(resetWorkflowNodeSessionsRoute, async c => {
    const workflowName = c.req.param('name') ?? '';
    if (!workflowName) {
      return apiError(c, 400, 'Workflow name is required');
    }
    const scope = c.req.query('scope') ?? undefined;
    const node = c.req.query('node') ?? undefined;
    const confirm = c.req.query('confirm') ?? undefined;
    // Cross-scope reset (no scope) is destructive — require explicit confirmation so a
    // dropped `scope` param can't silently wipe every conversation's sessions. Mirrors
    // the CLI `--yes` guard.
    if (scope === undefined && confirm !== 'all-scopes') {
      return apiError(
        c,
        400,
        'Refusing to reset sessions across all scopes without confirmation. Pass ?scope=<key> to narrow, or ?confirm=all-scopes to confirm.'
      );
    }
    try {
      const { deleted } = await resetWorkflowNodeSessions({
        workflow_name: workflowName,
        scope_key: scope,
        node_id: node,
      });
      return c.json({ success: true, deleted });
    } catch (error) {
      getLog().error(
        { err: error, workflowName, scope, node },
        'api.workflow_reset_node_sessions_failed'
      );
      return apiError(c, 500, 'Failed to reset workflow node sessions');
    }
  });

  // GET /api/workflows/runs - List workflow runs
  registerOpenApiRoute(listWorkflowRunsRoute, async c => {
    try {
      const conversationId = c.req.query('conversationId') ?? undefined;
      const rawStatus = c.req.query('status');
      const validStatuses = workflowRunStatusSchema.options;
      type WorkflowRunStatus = (typeof validStatuses)[number];
      const status: WorkflowRunStatus | undefined =
        rawStatus && (validStatuses as readonly string[]).includes(rawStatus)
          ? (rawStatus as WorkflowRunStatus)
          : undefined;
      const codebaseId = c.req.query('codebaseId') ?? undefined;
      const limitRaw = Number(c.req.query('limit'));
      const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(1, limitRaw), 200);
      // Non-enforcing "mine" filter: only narrows when an identity resolves.
      // Default visibility stays open (everyone sees everyone's runs).
      const mine = c.req.query('mine') === 'true';
      const userId = mine ? (await resolveAuthContext(c))?.userId : undefined;

      const runs = await workflowDb.listWorkflowRuns({
        conversationId,
        status,
        limit,
        codebaseId,
        userId,
      });
      return c.json({ runs: runs.map(toApiWorkflowRun) });
    } catch (error) {
      getLog().error({ err: error }, 'list_workflow_runs_failed');
      return apiError(c, 500, 'Failed to list workflow runs');
    }
  });

  // GET /api/workflows/runs/by-worker/:platformId - Look up run by worker conversation
  // Must be registered before :runId to avoid "by-worker" matching as a runId
  registerOpenApiRoute(getWorkflowRunByWorkerRoute, async c => {
    try {
      const platformId = c.req.param('platformId') ?? '';
      const run = await workflowDb.getWorkflowRunByWorkerPlatformId(platformId);
      if (!run) {
        return apiError(c, 404, 'No workflow run found for this worker');
      }
      return c.json({ run: toApiWorkflowRun(run) });
    } catch (error) {
      getLog().error({ err: error }, 'workflow_run_by_worker_lookup_failed');
      return apiError(c, 500, 'Failed to look up workflow run');
    }
  });

  function nodeMessageMetadata(
    metadata: NodeMessage['metadata']
  ): { metadata: NonNullable<NodeMessage['metadata']> } | Record<string, never> {
    return metadata !== undefined && metadata !== null ? { metadata } : {};
  }

  function isOperatorTextRow(row: NodeMessage): boolean {
    return row.kind === 'text' && row.metadata?.origin === 'operator';
  }

  function operatorSenderId(row: NodeMessage): string | null {
    const senderId = row.metadata?.operator_user_id;
    return typeof senderId === 'string' ? senderId : null;
  }

  function resolveOperatorDisplayName(
    senderId: string | null,
    nameById: ReadonlyMap<string, string | null>
  ): string | null {
    if (senderId === null) {
      return null;
    }
    const storedName = nameById.get(senderId);
    if (typeof storedName === 'string') {
      const trimmed = storedName.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return senderId.slice(0, 8);
  }

  async function buildOperatorDisplayNameById(
    rows: readonly NodeMessage[],
    context: { runId: string; nodeId: string }
  ): Promise<ReadonlyMap<string, string | null>> {
    const senderIds: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!isOperatorTextRow(row)) {
        continue;
      }
      const senderId = operatorSenderId(row);
      if (senderId === null || seen.has(senderId)) {
        continue;
      }
      seen.add(senderId);
      senderIds.push(senderId);
    }

    if (senderIds.length === 0) {
      return new Map();
    }

    try {
      const users = await userDb.getUserDisplayNamesByIds(senderIds);
      const map = new Map<string, string | null>();
      for (const senderId of senderIds) {
        map.set(senderId, null);
      }
      for (const user of users) {
        map.set(user.id, user.display_name);
      }
      return map;
    } catch (error) {
      getLog().warn(
        {
          runId: context.runId,
          nodeId: context.nodeId,
          distinctSenderCount: senderIds.length,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        'workflow_node_operator_names_lookup_failed'
      );
      const map = new Map<string, string | null>();
      for (const senderId of senderIds) {
        map.set(senderId, null);
      }
      return map;
    }
  }

  function toWorkflowNodeMessageResponse(
    row: NodeMessage,
    truncateOutput: boolean,
    operatorDisplayNameById: ReadonlyMap<string, string | null> = new Map()
  ): z.infer<typeof workflowNodeMessageResponseSchema> {
    const createdAt = toISOString(row.created_at);
    if (row.kind === 'tool') {
      if (truncateOutput && typeof row.payload.output === 'string') {
        const output = truncateToolOutput(row.payload.output);
        const metadata =
          output !== row.payload.output
            ? {
                ...(row.metadata ?? {}),
                truncated: true,
                output_state: 'truncated' as const,
                full_output_available: true,
              }
            : row.metadata;
        return {
          id: row.id,
          seq: row.seq,
          kind: row.kind,
          payload: { ...row.payload, output },
          created_at: createdAt,
          ...nodeMessageMetadata(metadata),
        };
      }
      return {
        id: row.id,
        seq: row.seq,
        kind: row.kind,
        payload: row.payload,
        created_at: createdAt,
        ...nodeMessageMetadata(row.metadata),
      };
    }
    if (row.kind === 'text') {
      const base = {
        id: row.id,
        seq: row.seq,
        kind: row.kind,
        payload: row.payload,
        created_at: createdAt,
        ...nodeMessageMetadata(row.metadata),
      };
      if (row.metadata?.origin === 'operator') {
        return {
          ...base,
          operator_display_name: resolveOperatorDisplayName(
            operatorSenderId(row),
            operatorDisplayNameById
          ),
        };
      }
      return base;
    }
    return {
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      payload: row.payload,
      created_at: createdAt,
      ...nodeMessageMetadata(row.metadata),
    };
  }

  // GET /api/workflows/runs/:runId/nodes/:nodeId/messages - One node transcript
  registerOpenApiRoute(getWorkflowNodeMessagesRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const nodeId = c.req.param('nodeId') ?? '';
    const query = getValidatedQuery(c, workflowNodeMessagesQuerySchema);
    const cursorMode =
      query.afterSeq !== undefined ||
      query.limit !== undefined ||
      query.occurrenceId !== undefined ||
      query.attemptId !== undefined;
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) return apiError(c, 404, 'Workflow run not found');
      if (!cursorMode) {
        const rows = await workflowNodeMessageDb.listNodeMessages(runId, nodeId);
        const operatorDisplayNameById = await buildOperatorDisplayNameById(rows, {
          runId,
          nodeId,
        });
        return c.json({
          messages: rows.map(row =>
            toWorkflowNodeMessageResponse(row, false, operatorDisplayNameById)
          ),
        });
      }
      const limit = query.limit ?? 100;
      const highWatermark = await workflowNodeMessageDb.getNodeMessageHighWatermark(runId, nodeId, {
        ...(query.occurrenceId !== undefined ? { occurrenceId: query.occurrenceId } : {}),
        ...(query.attemptId !== undefined ? { attemptId: query.attemptId } : {}),
      });
      const rows = await workflowNodeMessageDb.listNodeMessages(runId, nodeId, {
        ...(query.afterSeq !== undefined ? { afterSeq: query.afterSeq } : {}),
        limit: limit + 1,
        throughSeq: highWatermark,
        ...(query.occurrenceId !== undefined ? { occurrenceId: query.occurrenceId } : {}),
        ...(query.attemptId !== undefined ? { attemptId: query.attemptId } : {}),
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const operatorDisplayNameById = await buildOperatorDisplayNameById(page, {
        runId,
        nodeId,
      });
      return c.json({
        messages: page.map(row =>
          toWorkflowNodeMessageResponse(row, true, operatorDisplayNameById)
        ),
        ...(last !== undefined ? { nextCursor: String(last.seq) } : {}),
        hasMore,
        highWatermark,
      });
    } catch (error) {
      getLog().error(
        {
          runId,
          nodeId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        'workflow_node_messages_list_failed'
      );
      return apiError(c, 500, 'Failed to list workflow node messages');
    }
  });

  registerOpenApiRoute(getWorkflowNodeMessageDetailRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    const nodeId = c.req.param('nodeId') ?? '';
    const messageId = c.req.param('messageId') ?? '';
    try {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) return apiError(c, 404, 'Workflow run not found');
      const row = await workflowNodeMessageDb.getNodeMessage(runId, nodeId, messageId);
      if (!row) return apiError(c, 404, 'Workflow node message not found');
      const operatorDisplayNameById = await buildOperatorDisplayNameById([row], {
        runId,
        nodeId,
      });
      return c.json(toWorkflowNodeMessageResponse(row, false, operatorDisplayNameById));
    } catch (error) {
      getLog().error(
        {
          runId,
          nodeId,
          messageId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        'workflow_node_message_detail_failed'
      );
      return apiError(c, 500, 'Failed to read workflow node message');
    }
  });

  // GET /api/workflows/runs/:runId - Get run details with events
  registerOpenApiRoute(getWorkflowRunRoute, async c => {
    try {
      const runId = c.req.param('runId') ?? '';
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) {
        return apiError(c, 404, 'Workflow run not found');
      }
      const events = await workflowEventDb.listWorkflowEvents(runId);
      const pendingInteractions = await workflowPendingInteractionDb.listPendingInteractions(runId);

      // Look up the run's conversation platform ID.
      // For web runs (parent_conversation_id set): conversation_id is the worker conversation → set worker_platform_id
      // For CLI runs (no parent): conversation_id is the single conversation → set conversation_platform_id only
      let workerPlatformId: string | undefined;
      let conversationPlatformId: string | undefined;
      if (run.conversation_id) {
        const conv = await conversationDb.getConversationById(run.conversation_id);
        if (run.parent_conversation_id) {
          // Web run: conversation_id points to the worker conversation
          workerPlatformId = conv?.platform_conversation_id;
        } else {
          // CLI run: conversation_id is the only conversation (no worker/parent split)
          conversationPlatformId = conv?.platform_conversation_id;
        }
      }

      // Look up parent conversation to get its platform_conversation_id for navigation
      let parentPlatformId: string | undefined;
      if (run.parent_conversation_id) {
        const parentConv = await conversationDb.getConversationById(run.parent_conversation_id);
        parentPlatformId = parentConv?.platform_conversation_id;
      }

      // Direct-run usage only (groupBy node). Fail soft — never 500 the detail.
      let usage: UsageReport | null = null;
      try {
        usage = await queryUsageReport({ runId, groupBy: 'node' });
      } catch (usageError) {
        getLog().error(
          {
            err: usageError instanceof Error ? usageError : new Error(String(usageError)),
            runId,
          },
          'get_workflow_run_usage_failed'
        );
        usage = null;
      }

      const requester = await resolveAuthContext(c);
      const viewerIsStarter =
        requester !== undefined &&
        requester.userId.length > 0 &&
        run.user_id !== null &&
        requester.userId === run.user_id;
      const starter = run.user_id === null ? null : await userDb.getUserById(run.user_id);
      const starterDisplayName = starter?.display_name?.trim() || run.user_id;

      return c.json({
        run: {
          ...toApiWorkflowRun(run),
          worker_platform_id: workerPlatformId,
          parent_platform_id: parentPlatformId,
          conversation_platform_id: conversationPlatformId ?? null,
        },
        events,
        nodeStates: joinSteeringSubStates(
          runId,
          settleApiWorkflowNodeStatesForRunStatus(
            run.status,
            projectApiWorkflowNodeStates(events, pendingInteractions)
          )
        ),
        pending_interactions: pendingInteractions.map(row => ({
          ...row,
          created_at: toISOString(row.created_at),
          resolved_at: row.resolved_at ? toISOString(row.resolved_at) : null,
        })),
        usage,
        viewer_is_starter: viewerIsStarter,
        starter_display_name: starterDisplayName,
        nodeExecutions: projectWorkflowExecutionHistory({
          events,
          pendingInteractions,
          runStartedAt: toISOString(run.started_at) ?? undefined,
        }),
      });
    } catch (error) {
      getLog().error({ err: error }, 'get_workflow_run_failed');
      return apiError(c, 500, 'Failed to get workflow run');
    }
  });

  // GET /api/workflows/runs/:runId/git/changes - Now-or-commit files for a run
  registerOpenApiRoute(gitChangesRoute, async c => {
    return handleGitChanges(c, apiError);
  });

  // GET /api/workflows/runs/:runId/git/log - Commit history for a run checkout
  registerOpenApiRoute(gitLogRoute, async c => {
    return handleGitLog(c, apiError);
  });

  // GET /api/workflows/runs/:runId/git/diff - Now-or-commit hunks for a modified file
  registerOpenApiRoute(gitDiffRoute, async c => {
    return handleGitDiff(c, apiError);
  });

  // GET /api/workflows/runs/:runId/git/file/*
  // The wildcard carries a server-issued git-relative path and is decoded exactly once.
  // NUL, absolute paths, and any slash or backslash ".." segment are rejected after decoding.
  // OpenAPI 3.0 cannot represent this wildcard, and successful responses are raw bytes.
  app.get('/api/workflows/runs/:runId/git/file/*', async c => {
    return handleGitFile(c, apiError);
  });

  // GET /api/usage - Installation usage/cost report (direct runs only)
  registerOpenApiRoute(getUsageRoute, async c => {
    try {
      const from = c.req.query('from') ?? undefined;
      const to = c.req.query('to') ?? undefined;
      const codebaseId = c.req.query('codebaseId') ?? undefined;
      const agentProvider = c.req.query('agentProvider') ?? undefined;
      const provider = c.req.query('provider') ?? undefined;
      const model = c.req.query('model') ?? undefined;
      const kindRaw = c.req.query('kind') ?? undefined;
      const runId = c.req.query('runId') ?? undefined;
      const nodeId = c.req.query('nodeId') ?? undefined;
      const groupByRaw = c.req.query('groupBy') ?? undefined;

      // OpenAPI already enum-checked kind/groupBy when present; pass through for core.
      const kind =
        kindRaw === 'unclassified' || kindRaw === 'advisor' || kindRaw === 'subagent'
          ? kindRaw
          : undefined;
      const groupBy =
        groupByRaw === 'agent' ||
        groupByRaw === 'provider' ||
        groupByRaw === 'model' ||
        groupByRaw === 'project' ||
        groupByRaw === 'run' ||
        groupByRaw === 'day' ||
        groupByRaw === 'node'
          ? groupByRaw
          : undefined;

      const report = await queryUsageReport({
        from,
        to,
        codebaseId,
        agentProvider,
        provider,
        model,
        kind,
        runId,
        nodeId,
        groupBy,
      });
      return c.json(report);
    } catch (error) {
      if (error instanceof UsageReportQueryError) {
        if (error.code === 'validation' || error.code === 'overflow') {
          return apiError(c, 400, error.message);
        }
        getLog().error({ err: error, code: error.code }, 'usage.query_failed');
        return apiError(c, 500, error.message);
      }
      getLog().error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        'usage.query_failed'
      );
      return apiError(c, 500, 'Failed to query usage');
    }
  });

  // POST /api/workflows/validate - Validate a workflow definition without saving
  // MUST be registered before GET /api/workflows/:name so "validate" is not treated as :name
  registerOpenApiRoute(validateWorkflowRoute, async c => {
    const { definition } = getValidatedBody(c, validateWorkflowBodySchema);

    let yamlContent: string;
    try {
      yamlContent = Bun.YAML.stringify(definition);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err }, 'workflow.serialize_failed');
      return apiError(c, 400, 'Failed to serialize workflow definition');
    }

    try {
      const result = parseWorkflow(yamlContent, 'validate-input.yaml');

      if (result.error) {
        return c.json({ valid: false, errors: [result.error.error] });
      }
      return c.json({ valid: true });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err }, 'workflow.validate_failed');
      return apiError(c, 500, 'Failed to validate workflow');
    }
  });

  // GET /api/workflows/:name - Fetch a single workflow definition
  registerOpenApiRoute(getWorkflowRoute, async c => {
    const name = c.req.param('name') ?? '';
    if (!isValidWorkflowName(name)) {
      return apiError(c, 400, 'Invalid workflow name');
    }

    try {
      const cwd = c.req.query('cwd');
      let workingDir = cwd;
      if (cwd) {
        if (!(await validateCwd(cwd))) {
          return apiError(c, 400, 'Invalid cwd: must match a registered codebase path');
        }
      } else {
        const codebases = await codebaseDb.listCodebases();
        if (codebases.length > 0) workingDir = codebases[0].default_cwd;
      }

      // 1. Try user-defined workflow in cwd.
      if (workingDir) {
        const [workflowFolder] = getWorkflowFolderSearchPaths();
        const projectWorkflowsRoot = join(workingDir, workflowFolder);
        try {
          const hit = await findWorkflowAt(projectWorkflowsRoot, name);
          const isSourceBundledPackage =
            hit?.packaged === true && isBundledWorkflowsRoot(projectWorkflowsRoot);
          if (hit && !isSourceBundledPackage) {
            const result = hit.parsed;
            if (result.error) {
              return apiError(c, 500, `Workflow file is invalid: ${result.error.error}`);
            }
            return c.json({
              workflow: result.workflow,
              filename: hit.filename,
              source: 'project' as WorkflowSource,
            });
          }
        } catch (err) {
          getLog().error({ err, name }, 'workflow.fetch_failed');
          return apiError(c, 500, 'Failed to read workflow');
        }
      }

      // 2. Fall back to home-scoped workflow (`~/.archon/workflows/`).
      // Mirrors the discovery order in `discoverWorkflowsWithConfig`.
      try {
        const hit = await findWorkflowAt(getHomeWorkflowsPath(), name);
        if (hit) {
          const result = hit.parsed;
          if (result.error) {
            return apiError(c, 500, `Home workflow file is invalid: ${result.error.error}`);
          }
          return c.json({
            workflow: result.workflow,
            filename: hit.filename,
            source: 'global' as WorkflowSource,
          });
        }
      } catch (err) {
        getLog().error({ err, name }, 'workflow.fetch_home_failed');
        return apiError(c, 500, 'Failed to read home-scoped workflow');
      }

      // 3. Fall back to bundled defaults.
      const bundled = findBundledWorkflow(name);
      if (bundled !== null) {
        const result = bundled.parsed;
        if (result.error) {
          return apiError(c, 500, `Bundled workflow is invalid: ${result.error.error}`);
        }
        return c.json({
          workflow: result.workflow,
          filename: bundled.filename,
          source: 'bundled' as WorkflowSource,
        });
      }

      if (!isBinaryBuild()) {
        try {
          const hit =
            (await tryReadWorkflowAt(getDefaultWorkflowsPath(), name)) ??
            (await findPackagedWorkflowAt(dirname(getDefaultWorkflowsPath()), name));
          if (hit) {
            const result = hit.parsed;
            if (result.error) {
              return apiError(c, 500, `Default workflow is invalid: ${result.error.error}`);
            }
            return c.json({
              workflow: result.workflow,
              filename: hit.filename,
              source: 'bundled' as WorkflowSource,
            });
          }
        } catch (err) {
          getLog().error({ err, name }, 'workflow.fetch_default_failed');
          return apiError(c, 500, 'Failed to read default workflow');
        }
      }

      return apiError(c, 404, `Workflow not found: ${name}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err, name }, 'workflow.get_failed');
      return apiError(c, 500, 'Failed to get workflow');
    }
  });

  // PUT /api/workflows/:name - Save (create or update) a workflow
  registerOpenApiRoute(saveWorkflowRoute, async c => {
    const name = c.req.param('name') ?? '';
    if (!isValidCommandName(name)) {
      return apiError(c, 400, 'Invalid workflow name');
    }

    const targetSource = c.req.query('source');
    if (targetSource && targetSource !== 'project' && targetSource !== 'global') {
      return apiError(c, 400, 'Invalid workflow source');
    }

    const cwd = c.req.query('cwd');
    let workingDir = cwd;
    if (targetSource === 'global') {
      workingDir = undefined;
    } else if (cwd) {
      if (!(await validateCwd(cwd))) {
        return apiError(c, 400, 'Invalid cwd: must match a registered codebase path');
      }
    } else {
      const codebases = await codebaseDb.listCodebases();
      if (codebases.length > 0) workingDir = codebases[0].default_cwd;
    }
    if (!workingDir) {
      workingDir = getArchonHome();
    }

    const { definition } = getValidatedBody(c, saveWorkflowBodySchema);

    // Serialize and validate before writing
    let yamlContent: string;
    try {
      yamlContent = Bun.YAML.stringify(definition);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err, name }, 'workflow.serialize_failed');
      return apiError(c, 400, 'Failed to serialize workflow definition');
    }

    const parsed = parseWorkflow(yamlContent, `${name}.yaml`);
    if (parsed.error) {
      return apiError(c, 400, 'Workflow definition is invalid', parsed.error.error);
    }

    try {
      const source: WorkflowSource = targetSource === 'global' ? 'global' : 'project';
      const dirPath =
        source === 'global'
          ? getHomeWorkflowsPath()
          : join(workingDir, getWorkflowFolderSearchPaths()[0]);
      await mkdir(dirPath, { recursive: true });
      const existing = await findWorkflowAt(dirPath, name);
      if (existing?.packaged === true && isBundledWorkflowsRoot(dirPath)) {
        return apiError(c, 400, `Cannot overwrite bundled default workflow: ${name}`);
      }
      const filePath = existing?.absolutePath ?? join(dirPath, `${name}.yaml`);
      const filename = existing?.filename ?? `${name}.yaml`;
      await writeFile(filePath, yamlContent, 'utf-8');
      return c.json({
        workflow: parsed.workflow,
        filename,
        source,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err, name }, 'workflow.save_failed');
      return apiError(c, 500, 'Failed to save workflow');
    }
  });

  // DELETE /api/workflows/:name - Delete a user-defined workflow
  registerOpenApiRoute(deleteWorkflowRoute, async c => {
    const name = c.req.param('name') ?? '';
    if (!isValidCommandName(name)) {
      return apiError(c, 400, 'Invalid workflow name');
    }

    const targetSource = c.req.query('source');
    if (targetSource && targetSource !== 'project' && targetSource !== 'global') {
      return apiError(c, 400, 'Invalid workflow source');
    }

    const cwd = c.req.query('cwd');
    let workingDir = cwd;
    if (targetSource === 'global') {
      workingDir = undefined;
    } else if (cwd) {
      if (!(await validateCwd(cwd))) {
        return apiError(c, 400, 'Invalid cwd: must match a registered codebase path');
      }
    } else {
      const codebases = await codebaseDb.listCodebases();
      if (codebases.length > 0) workingDir = codebases[0].default_cwd;
    }
    if (!workingDir) {
      workingDir = getArchonHome();
    }

    const dir =
      targetSource === 'global'
        ? getHomeWorkflowsPath()
        : join(workingDir, getWorkflowFolderSearchPaths()[0]);

    try {
      const packaged = await findPackagedWorkflowAt(dir, name);
      if (packaged !== null) {
        if (isBundledWorkflowsRoot(dir)) {
          return apiError(c, 400, `Cannot delete bundled default workflow: ${name}`);
        }
        await rm(dirname(packaged.absolutePath), { recursive: true });
        return c.json({ deleted: true, name });
      }
    } catch (err) {
      getLog().error({ err, name }, 'workflow.delete_failed');
      return apiError(c, 500, 'Failed to delete workflow');
    }

    // Remove both `.yaml` and `.yml` variants (discovery accepts either), so a
    // twin file can't stay active after a reported deletion.
    let deleted = false;
    for (const ext of ['yaml', 'yml']) {
      const filePath = join(dir, `${name}.${ext}`);
      try {
        await unlink(filePath);
        deleted = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        getLog().error({ err, name }, 'workflow.delete_failed');
        return apiError(c, 500, 'Failed to delete workflow');
      }
    }
    if (deleted) {
      return c.json({ deleted: true, name });
    }
    if (targetSource !== 'global') {
      try {
        if (findBundledWorkflow(name) !== null) {
          return apiError(c, 400, `Cannot delete bundled default workflow: ${name}`);
        }
      } catch (err) {
        getLog().error({ err, name }, 'workflow.delete_failed');
        return apiError(c, 500, 'Failed to delete workflow');
      }
    }
    return apiError(c, 404, `Workflow not found: ${name}`);
  });

  // =========================================================================
  // Workflow ENV endpoints (install-wide overlays — no cwd required for CRUD)
  // =========================================================================

  // GET /api/workflows/{name}/envs
  registerOpenApiRoute(
    listWorkflowEnvsRoute,
    async c => {
      const pathName = parseWorkflowEnvPathName(c.req.param('name') ?? '');
      if (!pathName.ok) {
        return apiError(c, 400, 'invalid_workflow_name', pathName.detail);
      }
      try {
        const rows = await workflowEnvDb.listWorkflowEnvSummaries(pathName.name);
        return c.json({ envs: rows.map(toWorkflowEnvSummaryResponse) });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return apiError(
            c,
            400,
            'invalid_workflow_name',
            error.issues[0]?.message ?? 'invalid workflow name'
          );
        }
        getLog().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            workflowName: pathName.name,
          },
          'workflow_env.list_failed'
        );
        return apiError(c, 500, 'Failed to list workflow ENVs');
      }
    },
    workflowEnvValidationErrorHook
  );

  // GET /api/workflows/{name}/envs/{envId}
  registerOpenApiRoute(
    getWorkflowEnvRoute,
    async c => {
      const pathName = parseWorkflowEnvPathName(c.req.param('name') ?? '');
      if (!pathName.ok) {
        return apiError(c, 400, 'invalid_workflow_name', pathName.detail);
      }
      const envId = c.req.param('envId') ?? '';
      if (!envId) {
        return apiError(c, 400, 'invalid_env_id', 'env id is required');
      }
      try {
        const row = await workflowEnvDb.getWorkflowEnvById(envId);
        if (row?.workflow_name !== pathName.name) {
          return apiError(c, 404, 'env_not_found');
        }
        return c.json({ env: toWorkflowEnvResponse(row) });
      } catch (error) {
        if (error instanceof workflowEnvDb.WorkflowEnvCorruptRowError) {
          getLog().error({ envId: error.envId }, 'workflow_env.corrupt_row');
          return apiError(c, 500, 'env_store_corrupt');
        }
        getLog().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            workflowName: pathName.name,
            envId,
          },
          'workflow_env.get_failed'
        );
        return apiError(c, 500, 'Failed to get workflow ENV');
      }
    },
    workflowEnvValidationErrorHook
  );

  // POST /api/workflows/{name}/envs
  registerOpenApiRoute(
    createWorkflowEnvRoute,
    async c => {
      const pathName = parseWorkflowEnvPathName(c.req.param('name') ?? '');
      if (!pathName.ok) {
        return apiError(c, 400, 'invalid_workflow_name', pathName.detail);
      }
      const body = getValidatedBody(c, createWorkflowEnvBodySchema);
      try {
        const userId = await resolveWebUserId(c);
        const row = await workflowEnvDb.createWorkflowEnv({
          workflow_name: pathName.name,
          name: body.name,
          patches: body.patches,
          created_by_user_id: userId ?? null,
        });
        return c.json({ env: toWorkflowEnvResponse(row) }, 201);
      } catch (error) {
        if (error instanceof workflowEnvDb.WorkflowEnvNameConflictError) {
          return apiError(c, 409, 'env_name_conflict');
        }
        if (error instanceof z.ZodError) {
          return apiError(c, 400, 'invalid_env_request', formatSafeZodIssueDetail(error));
        }
        getLog().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            workflowName: pathName.name,
          },
          'workflow_env.create_failed'
        );
        return apiError(c, 500, 'Failed to create workflow ENV');
      }
    },
    workflowEnvValidationErrorHook
  );

  // PATCH /api/workflows/{name}/envs/{envId}
  registerOpenApiRoute(
    updateWorkflowEnvRoute,
    async c => {
      const pathName = parseWorkflowEnvPathName(c.req.param('name') ?? '');
      if (!pathName.ok) {
        return apiError(c, 400, 'invalid_workflow_name', pathName.detail);
      }
      const envId = c.req.param('envId') ?? '';
      if (!envId) {
        return apiError(c, 400, 'invalid_env_id', 'env id is required');
      }
      const body = getValidatedBody(c, updateWorkflowEnvBodySchema);
      try {
        const row = await workflowEnvDb.updateWorkflowEnv(pathName.name, envId, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.patches !== undefined ? { patches: body.patches } : {}),
        });
        if (!row) {
          return apiError(c, 404, 'env_not_found');
        }
        return c.json({ env: toWorkflowEnvResponse(row) });
      } catch (error) {
        if (error instanceof workflowEnvDb.WorkflowEnvNameConflictError) {
          return apiError(c, 409, 'env_name_conflict');
        }
        if (error instanceof workflowEnvDb.WorkflowEnvCorruptRowError) {
          getLog().error({ envId: error.envId }, 'workflow_env.corrupt_row');
          return apiError(c, 500, 'env_store_corrupt');
        }
        if (error instanceof z.ZodError) {
          return apiError(c, 400, 'invalid_env_request', formatSafeZodIssueDetail(error));
        }
        if (
          error instanceof Error &&
          /requires at least one of name or patches/i.test(error.message)
        ) {
          return apiError(c, 400, 'invalid_env_request', error.message);
        }
        getLog().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            workflowName: pathName.name,
            envId,
          },
          'workflow_env.update_failed'
        );
        return apiError(c, 500, 'Failed to update workflow ENV');
      }
    },
    workflowEnvValidationErrorHook
  );

  // DELETE /api/workflows/{name}/envs/{envId}
  registerOpenApiRoute(
    deleteWorkflowEnvRoute,
    async c => {
      const pathName = parseWorkflowEnvPathName(c.req.param('name') ?? '');
      if (!pathName.ok) {
        return apiError(c, 400, 'invalid_workflow_name', pathName.detail);
      }
      const envId = c.req.param('envId') ?? '';
      if (!envId) {
        return apiError(c, 400, 'invalid_env_id', 'env id is required');
      }
      try {
        const deleted = await workflowEnvDb.deleteWorkflowEnv(pathName.name, envId);
        return c.json({ deleted });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return apiError(
            c,
            400,
            'invalid_workflow_name',
            error.issues[0]?.message ?? 'invalid workflow name'
          );
        }
        getLog().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            workflowName: pathName.name,
            envId,
          },
          'workflow_env.delete_failed'
        );
        return apiError(c, 500, 'Failed to delete workflow ENV');
      }
    },
    workflowEnvValidationErrorHook
  );

  // GET /api/workflows/{name}/env-preview
  registerOpenApiRoute(
    previewWorkflowEnvRoute,
    async c => {
      const pathName = parseWorkflowEnvPathName(c.req.param('name') ?? '');
      if (!pathName.ok) {
        return apiError(c, 400, 'invalid_workflow_name', pathName.detail);
      }

      const cwd = c.req.query('cwd') ?? '';
      if (!cwd) {
        return apiError(c, 400, 'invalid_cwd', 'cwd is required');
      }
      if (!(await validateCwd(cwd))) {
        return apiError(c, 400, 'invalid_cwd', 'cwd must match a registered codebase path');
      }

      const envIdQuery = c.req.query('envId');
      const envId =
        envIdQuery !== undefined && envIdQuery.trim() !== '' ? envIdQuery.trim() : undefined;

      try {
        const discovery = await discoverWorkflowsWithConfig(cwd, loadConfig);
        let workflow: WorkflowDefinition | undefined;
        try {
          workflow = resolveWorkflowName(
            pathName.name,
            discovery.workflows.map(entry => entry.workflow)
          );
        } catch (resolveErr) {
          const detail =
            resolveErr instanceof Error ? resolveErr.message : 'ambiguous workflow name';
          return apiError(c, 400, 'ambiguous_workflow_name', detail);
        }
        if (!workflow) {
          return apiError(c, 404, 'workflow_not_found', `Workflow not found: ${pathName.name}`);
        }

        const canonicalName = workflow.name;
        let workingWorkflow = workflow;
        let skippedNodeIds: string[] = [];
        let responseEnvId: string | null = null;
        let responseEnvName: string | null = null;

        if (envId !== undefined) {
          let row: WorkflowEnvRow | null;
          try {
            row = await workflowEnvDb.getWorkflowEnvById(envId);
          } catch (error) {
            if (error instanceof workflowEnvDb.WorkflowEnvCorruptRowError) {
              getLog().error({ envId: error.envId }, 'workflow_env.corrupt_row');
              return apiError(c, 500, 'env_store_corrupt');
            }
            throw error;
          }
          if (!row) {
            return apiError(c, 400, 'env_not_found');
          }
          if (row.workflow_name !== pathName.name || row.workflow_name !== canonicalName) {
            return apiError(c, 400, 'env_workflow_mismatch');
          }

          try {
            const applied = applyEnvOverlay(workingWorkflow, row.patches);
            workingWorkflow = applied.workflow;
            skippedNodeIds = applied.missingNodeIds;
          } catch (error) {
            if (error instanceof EnvOverlayError) {
              getLog().warn(
                {
                  envId: row.id,
                  envName: row.name,
                  code: error.code,
                  nodeId: error.nodeId,
                  field: error.field,
                },
                'workflow_env.preview_apply_failed'
              );
              return apiError(c, 400, error.code, error.message);
            }
            throw error;
          }

          responseEnvId = row.id;
          responseEnvName = row.name;
        }

        const targets = listEnvOverlayTargets(workflow);

        // Mirror executor profile resolution: user prefs highest precedence,
        // corrupt stored prefs degrade to config-only.
        const config = await loadConfig(cwd);
        let userAiPrefs: UserAiPrefs = {};
        const webUserId = await resolveWebUserId(c);
        if (webUserId) {
          try {
            userAiPrefs = await getUserAiPrefs(webUserId);
          } catch (prefsErr) {
            getLog().warn(
              {
                err: prefsErr instanceof Error ? prefsErr : new Error(String(prefsErr)),
                userId: webUserId,
              },
              'workflow_env.preview_user_prefs_failed'
            );
          }
        }

        let aiProfile;
        try {
          aiProfile = buildAiProfile(userAiPrefs.defaultProvider ?? config.assistant, {
            repoTiers: config.tiers,
            repoAliases: config.aliases,
            userTiers: userAiPrefs.tiers,
            userAliases: userAiPrefs.aliases,
          });
        } catch (profileErr) {
          getLog().error(
            {
              err: profileErr instanceof Error ? profileErr : new Error(String(profileErr)),
              userId: webUserId,
            },
            'workflow_env.preview_user_prefs_invalid'
          );
          aiProfile = buildAiProfile(config.assistant, {
            repoTiers: config.tiers,
            repoAliases: config.aliases,
          });
        }

        const assistantModels = assistantModelDefaults(config);
        const scope = resolveWorkflowModelScope(
          workingWorkflow,
          config.assistant,
          assistantModels,
          aiProfile
        );

        let resolvedMap;
        try {
          resolvedMap = buildResolvedRequestMetadata(
            workingWorkflow.nodes,
            scope,
            assistantModels,
            {
              aiProfile,
              // Mirror executor snapshot + resolveNodeProviderAndModel: legacy assistant
              // modelReasoningEffort fallback and workflow-level thinking must not be dropped
              // when Preview approximates from { aiProfile } alone.
              assistants: config.assistants,
              workflowThinking: workingWorkflow.thinking,
            }
          );
        } catch (resolveErr) {
          const detail =
            resolveErr instanceof Error ? resolveErr.message : 'request metadata resolution failed';
          // Never echo prompt/bash bodies — resolution errors are provider/effort messages.
          getLog().warn(
            {
              err: resolveErr instanceof Error ? resolveErr : new Error(String(resolveErr)),
              workflowName: canonicalName,
              envId: responseEnvId,
            },
            'workflow_env.preview_resolution_failed'
          );
          return apiError(c, 400, 'env_preview_resolution_failed', detail);
        }

        const resolved = Object.entries(resolvedMap).map(([nodeId, meta]) => ({
          nodeId,
          ...meta,
        }));

        return c.json({
          preview: true as const,
          authoritative: false as const,
          workflowName: canonicalName,
          envId: responseEnvId,
          envName: responseEnvName,
          skippedNodeIds,
          targets,
          resolved,
        });
      } catch (error) {
        if (error instanceof workflowEnvDb.WorkflowEnvCorruptRowError) {
          getLog().error({ envId: error.envId }, 'workflow_env.corrupt_row');
          return apiError(c, 500, 'env_store_corrupt');
        }
        getLog().error(
          {
            err: error instanceof Error ? error : new Error(String(error)),
            workflowName: pathName.name,
          },
          'workflow_env.preview_failed'
        );
        return apiError(c, 500, 'Failed to preview workflow ENV');
      }
    },
    workflowEnvValidationErrorHook
  );

  // GET /api/commands - List available command names for the workflow node palette
  registerOpenApiRoute(getCommandsRoute, async c => {
    try {
      const cwd = c.req.query('cwd');
      let workingDir = cwd;
      if (cwd) {
        if (!(await validateCwd(cwd))) {
          return apiError(c, 400, 'Invalid cwd: must match a registered codebase path');
        }
      } else {
        const codebases = await codebaseDb.listCodebases();
        if (codebases.length > 0) workingDir = codebases[0].default_cwd;
      }

      // Collect commands: precedence bundled < global < project (repo-defined wins).
      const commandMap = new Map<string, WorkflowSource>();

      // 1. Seed with bundled defaults
      for (const name of Object.keys(BUNDLED_COMMANDS)) {
        commandMap.set(name, 'bundled');
      }

      // maxDepth: 1 matches the executor's resolver (resolveCommand /
      // loadCommandPrompt) — without this cap, the UI palette would surface
      // commands buried in deep subfolders that the executor silently can't
      // resolve at runtime.
      const COMMAND_LIST_DEPTH = { maxDepth: 1 };

      // 2. If not binary build, also check filesystem defaults
      if (!isBinaryBuild()) {
        try {
          const defaultsPath = getDefaultCommandsPath();
          const files = await findMarkdownFilesRecursive(defaultsPath, '', COMMAND_LIST_DEPTH);
          for (const { commandName } of files) {
            commandMap.set(commandName, 'bundled');
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            getLog().error({ err }, 'commands.list_defaults_failed');
          }
          // ENOENT: defaults path missing — not an error
        }
      }

      // 3. Home-scoped commands (~/.archon/commands/) override bundled
      try {
        const homeCommandsPath = getHomeCommandsPath();
        const files = await findMarkdownFilesRecursive(homeCommandsPath, '', COMMAND_LIST_DEPTH);
        for (const { commandName } of files) {
          commandMap.set(commandName, 'global');
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          getLog().error({ err }, 'commands.list_home_failed');
        }
        // ENOENT: home commands dir not created yet — not an error
      }

      // 4. Project-defined commands override bundled AND global
      if (workingDir) {
        const searchPaths = getCommandFolderSearchPaths();
        for (const folder of searchPaths) {
          const dirPath = join(workingDir, folder);
          try {
            const files = await findMarkdownFilesRecursive(dirPath, '', COMMAND_LIST_DEPTH);
            for (const { commandName } of files) {
              commandMap.set(commandName, 'project');
            }
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              getLog().error({ err, dirPath }, 'commands.list_project_failed');
            }
            // ENOENT: folder doesn't exist — skip
          }
        }
      }

      const commands = Array.from(commandMap.entries()).map(([name, source]) => ({ name, source }));
      return c.json({ commands });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error({ err }, 'commands.list_failed');
      return apiError(c, 500, 'Failed to list commands');
    }
  });

  // GET /api/runs/:runId/artifacts - List artifact files for a run.
  // Walks the run's artifact directory and returns relative file paths with
  // size + mtime. Used by the console's Artifacts tab; the existing
  // `workflow_artifact` event stream is too sparse (bash/script nodes write
  // straight to $ARTIFACTS_DIR without emitting an event) to drive a file
  // browser on its own.
  registerOpenApiRoute(listRunArtifactsRoute, async c => {
    const runId = c.req.param('runId') ?? '';
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      return apiError(c, 400, 'Invalid run id');
    }

    let run: Awaited<ReturnType<typeof workflowDb.getWorkflowRun>>;
    try {
      run = await workflowDb.getWorkflowRun(runId);
    } catch (error) {
      getLog().error({ err: error, runId }, 'artifacts.run_lookup_failed');
      return apiError(c, 500, 'Failed to look up workflow run');
    }
    if (!run) return apiError(c, 404, 'Workflow run not found');

    let codebase: Awaited<ReturnType<typeof codebaseDb.getCodebase>> | null = null;
    if (run.codebase_id) {
      try {
        codebase = await codebaseDb.getCodebase(run.codebase_id);
      } catch (error) {
        getLog().error(
          { err: error, runId, codebaseId: run.codebase_id },
          'artifacts.codebase_lookup_failed'
        );
        return apiError(c, 500, 'Failed to look up codebase');
      }
    }
    // An empty 200 here is indistinguishable from "the run produced nothing",
    // so an unresolvable output location is an explicit 404 (Fail Fast).
    const artifactDir = resolveRunArtifactDir(run, codebase, runId);
    if (!artifactDir) {
      getLog().warn({ runId, codebaseId: run.codebase_id }, 'artifacts.output_location_unresolved');
      return apiError(
        c,
        404,
        'Artifacts not available: could not resolve this run’s output location'
      );
    }
    if (!isInsideArchonHome(artifactDir)) {
      getLog().warn(
        { runId, artifactDir, archonHome: getArchonHome() },
        'artifacts.path_escape_blocked'
      );
      return apiError(c, 400, 'Invalid artifact path');
    }

    interface FileEntry {
      path: string;
      size: number;
      modifiedAt: string;
    }
    const files: FileEntry[] = [];

    async function walk(dir: string, rel: string): Promise<void> {
      let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        // Skip dotfiles — they're workflow-internal scratch (.pr-number, etc.)
        if (entry.name.startsWith('.')) continue;
        const child = join(dir, entry.name);
        const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(child, childRel);
        } else if (entry.isFile()) {
          try {
            const s = await stat(child);
            files.push({
              path: childRel,
              size: s.size,
              modifiedAt: s.mtime.toISOString(),
            });
          } catch (err) {
            // Race with deletion / permission flips: skip ENOENT / EACCES
            // silently, surface anything else so we don't return a half-list
            // with no diagnostic.
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'EACCES') continue;
            throw err;
          }
        }
      }
    }

    try {
      await walk(artifactDir, '');
    } catch (error) {
      getLog().error({ err: error, runId, artifactDir }, 'artifacts.walk_failed');
      return apiError(c, 500, 'Failed to list artifacts');
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return c.json({ files });
  });

  // GET /api/artifacts/:runId/* - Serve workflow artifact file contents
  // The wildcard captures the filename (e.g. "plan.md", "subdir/report.md").
  // Path traversal is blocked: any segment containing ".." is rejected.
  // NOTE: Uses app.get() instead of registerOpenApiRoute because:
  //  1. Wildcard path params (*) are not representable in OpenAPI 3.0
  //  2. Response is raw text/markdown, not JSON
  app.get('/api/artifacts/:runId/*', async c => {
    const runId = c.req.param('runId');
    // Hono wildcards match but don't capture — extract filename from the URL path.
    // c.req.path is NOT percent-decoded, so we decode it manually.
    const prefix = `/api/artifacts/${runId}/`;
    const rawEncoded = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
    let rawFilename: string;
    try {
      rawFilename = decodeURIComponent(rawEncoded);
    } catch {
      return apiError(c, 400, 'Invalid filename');
    }

    // Block path traversal: reject if any segment is ".." or contains null bytes
    if (
      !rawFilename ||
      rawFilename.includes('\0') ||
      rawFilename.split('/').some(s => s === '..')
    ) {
      return apiError(c, 400, 'Invalid filename');
    }

    // Normalize and ensure relative (no leading slash)
    const filename = normalize(rawFilename).replace(/^[/\\]+/, '');
    if (!filename) {
      return apiError(c, 400, 'Invalid filename');
    }

    let run: Awaited<ReturnType<typeof workflowDb.getWorkflowRun>>;
    try {
      run = await workflowDb.getWorkflowRun(runId);
    } catch (error) {
      getLog().error({ err: error, runId }, 'artifacts.run_lookup_failed');
      return apiError(c, 500, 'Failed to look up workflow run');
    }

    if (!run) {
      return apiError(c, 404, 'Workflow run not found');
    }

    // Resolve the run's output tree for every project kind — a persisted
    // output_root first, else the shared identity→paths resolver (#2200).
    const codebase = run.codebase_id ? await codebaseDb.getCodebase(run.codebase_id) : null;
    const artifactDir = resolveRunArtifactDir(run, codebase, runId);
    if (!artifactDir) {
      getLog().error(
        { runId, codebaseId: run.codebase_id },
        'artifacts.output_location_unresolved'
      );
      return apiError(
        c,
        404,
        'Artifact not available: could not resolve this run’s output location'
      );
    }
    if (!isInsideArchonHome(artifactDir)) {
      getLog().warn(
        { runId, artifactDir, archonHome: getArchonHome() },
        'artifacts.path_escape_blocked'
      );
      return apiError(c, 400, 'Invalid artifact path');
    }
    const filePath = join(artifactDir, filename);

    // Final safety check: ensure resolved path stays within artifact directory
    if (
      !normalize(filePath).startsWith(normalize(artifactDir) + sep) &&
      normalize(filePath) !== normalize(artifactDir)
    ) {
      getLog().warn({ runId, filename, filePath, artifactDir }, 'artifacts.path_escape_blocked');
      return apiError(c, 400, 'Invalid filename');
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return apiError(c, 404, 'Artifact file not found');
      }
      getLog().error({ err, runId, filename }, 'artifacts.read_failed');
      return apiError(c, 500, 'Failed to read artifact file');
    }

    const contentType = filename.endsWith('.md')
      ? 'text/markdown; charset=utf-8'
      : 'text/plain; charset=utf-8';
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': contentType },
    });
  });

  // GET /api/config - Read-only configuration (safe subset only — no filesystem paths)
  registerOpenApiRoute(getConfigRoute, async c => {
    try {
      const config = await loadConfig();
      return c.json({
        config: toSafeConfig(config),
        database: getDatabaseType(),
      });
    } catch (error) {
      getLog().error({ err: error }, 'get_config_failed');
      return apiError(c, 500, 'Failed to get config');
    }
  });

  // PATCH /api/config/assistants - Update assistant configuration
  registerOpenApiRoute(patchAssistantConfigRoute, async c => {
    try {
      const body = getValidatedBody(c, updateAssistantConfigBodySchema);

      const updates: Partial<GlobalConfig> = {};
      if (body.assistant !== undefined) {
        if (!isRegisteredProvider(body.assistant)) {
          return apiError(
            c,
            400,
            `Unknown provider '${body.assistant}'. Available: ${getProviderInfoList()
              .map(p => p.id)
              .join(', ')}`
          );
        }
        updates.defaultAssistant = body.assistant;
      }
      if (body.assistants !== undefined) {
        const unknownProviders = Object.keys(body.assistants).filter(
          id => !isRegisteredProvider(id)
        );
        if (unknownProviders.length > 0) {
          return apiError(
            c,
            400,
            `Unknown provider(s) in assistants: ${unknownProviders.join(', ')}. Available: ${getProviderInfoList()
              .map(p => p.id)
              .join(', ')}`
          );
        }
        for (const [providerId, defaults] of Object.entries(body.assistants)) {
          const effort = defaults.modelReasoningEffort;
          if (effort !== undefined && (typeof effort !== 'string' || effort.length === 0)) {
            return apiError(
              c,
              400,
              `Invalid assistants.${providerId}.modelReasoningEffort: expected a non-empty string.`
            );
          }
        }
        updates.assistants = body.assistants;
      }

      await updateGlobalConfig(updates);

      const config = await loadConfig();
      return c.json({
        config: toSafeConfig(config),
        database: getDatabaseType(),
      });
    } catch (error) {
      getLog().error({ err: error }, 'config.assistants_update_failed');
      return apiError(c, 500, 'Failed to update assistant configuration');
    }
  });

  // PATCH /api/config/tiers - Update model-tier presets (ungated — solo-OK, like /assistants)
  registerOpenApiRoute(patchTiersConfigRoute, async c => {
    try {
      const body = getValidatedBody(c, updateTiersBodySchema);

      // Validate the provider of each tier we're SETTING (null = unset, skip).
      const tiers: TiersPatch = {};
      for (const tier of TIER_NAMES) {
        const entry = body.tiers[tier];
        if (entry === undefined) continue;
        if (entry === null) {
          tiers[tier] = null;
          continue;
        }
        const errMsg = validatePresetEntry(`tier '${tier}'`, entry);
        if (errMsg) return apiError(c, 400, errMsg);
        // Clean RawAliasEntry — drops `thinking` (no UI/CLI surface yet).
        tiers[tier] = toCleanEntry(entry);
      }

      await updateGlobalConfig({ tiers });

      const config = await loadConfig();
      return c.json({
        config: toSafeConfig(config),
        database: getDatabaseType(),
      });
    } catch (error) {
      getLog().error({ err: error }, 'config.tiers_update_failed');
      return apiError(c, 500, 'Failed to update tier configuration');
    }
  });

  // PATCH /api/config/aliases - Update @custom aliases (ungated — solo-OK, like /tiers)
  registerOpenApiRoute(patchAliasesConfigRoute, async c => {
    try {
      const body = getValidatedBody(c, updateAliasesBodySchema);
      const aliases: AliasesPatch = {};
      for (const [name, entry] of Object.entries(body.aliases)) {
        const nameErr = validateAliasName(name);
        if (nameErr) return apiError(c, 400, nameErr);
        if (entry === null) {
          aliases[name] = null;
          continue;
        }
        const errMsg = validatePresetEntry(`alias '${name}'`, entry);
        if (errMsg) return apiError(c, 400, errMsg);
        aliases[name] = toCleanEntry(entry);
      }

      await updateGlobalConfig({ aliases });

      const config = await loadConfig();
      return c.json({
        config: toSafeConfig(config),
        database: getDatabaseType(),
      });
    } catch (error) {
      getLog().error({ err: error }, 'config.aliases_update_failed');
      return apiError(c, 500, 'Failed to update alias configuration');
    }
  });

  // GET /api/providers - List registered AI providers
  registerOpenApiRoute(getProvidersRoute, c => {
    return c.json({ providers: getProviderInfoList() });
  });

  // GET /api/providers/pi/models - Pi model catalog (best-effort hint; [] on failure)
  registerOpenApiRoute(getPiModelsRoute, async c => {
    try {
      return c.json({ models: await listPiModels() });
    } catch (error) {
      // listPiModels already degrades internally; this belt-and-suspenders
      // keeps the documented "never errors" contract at the route boundary.
      getLog().warn({ err: error }, 'providers.pi_models_list_failed');
      return c.json({ models: [] });
    }
  });

  // GET /api/providers/opencode/credentials - OpenCode backend introspection
  // (on-demand; starts the embedded runtime). 503 on failure — never a silent [].
  registerOpenApiRoute(getOpencodeCredentialsRoute, async c => {
    try {
      const result = await introspectOpencodeCredentials();
      return c.json(result);
    } catch (error) {
      getLog().error({ err: error }, 'providers.opencode_credentials_introspect_failed');
      return apiError(c, 503, 'Embedded OpenCode runtime unavailable');
    }
  });

  // GET /api/codebases/:id/environments - List isolation environments for a codebase
  registerOpenApiRoute(getCodebaseEnvironmentsRoute, async c => {
    try {
      const { id } = c.req.param();
      const codebase = await codebaseDb.getCodebase(id);
      if (!codebase) {
        return apiError(c, 404, 'Codebase not found');
      }

      const environments = await isolationEnvDb.listByCodebaseWithAge(id);
      return c.json({ environments });
    } catch (error) {
      getLog().error({ err: error }, 'codebases.environments_list_failed');
      return apiError(c, 500, 'Failed to list environments');
    }
  });

  // GET /api/health - Health check with web adapter info
  registerOpenApiRoute(getHealthRoute, async c => {
    const stats = lockManager.getStats();
    const runningWorkflowRows = await workflowDb.getRunningWorkflows();

    // Merge lock-based and DB-based active tracking.
    // Background workflows bypass the lock manager, so we combine both sources.
    const lockActiveSet = new Set(stats.activeConversationIds);
    const backgroundConversationIds = runningWorkflowRows
      .map(r => r.conversation_id)
      .filter(id => !lockActiveSet.has(id));
    const allActiveIds = [...stats.activeConversationIds, ...backgroundConversationIds];
    const wslDistro = getWSLDistroName();

    // Health is public (PUBLIC_API_GATE_PREFIXES) and must stay answerable when the
    // database is degraded, so a failed vintage read is logged and the key omitted
    // rather than turning the healthcheck into a 500. `createdAt` is deliberately not
    // exposed — the two version strings plus applied_at are what a bug report needs.
    let schema:
      | Pick<SchemaVersionInfo, 'createdAppVersion' | 'appVersion' | 'appliedAt'>
      | undefined;
    try {
      const info = await getSchemaVersion();
      if (info) {
        schema = {
          createdAppVersion: info.createdAppVersion,
          appVersion: info.appVersion,
          appliedAt: info.appliedAt,
        };
      }
    } catch (err) {
      getLog().warn({ err }, 'api.schema_version_read_failed');
    }

    return c.json({
      status: 'ok',
      adapter: 'web',
      concurrency: {
        ...stats,
        active: allActiveIds.length,
        activeConversationIds: allActiveIds,
      },
      runningWorkflows: runningWorkflowRows.length,
      version: appVersion,
      is_docker: isDocker(),
      is_wsl: isWSL(),
      ...(wslDistro ? { wsl_distro: wslDistro } : {}),
      activePlatforms: activePlatforms ? [...activePlatforms] : ['Web'],
      ...(schema ? { schema } : {}),
    });
  });

  registerOpenApiRoute(getUpdateCheckRoute, async c => {
    const noUpdate = {
      updateAvailable: false,
      currentVersion: appVersion,
      latestVersion: appVersion,
      releaseUrl: '',
    };
    if (!BUNDLED_IS_BINARY) return c.json(noUpdate);
    const result = await checkForUpdate(appVersion);
    return c.json(result ?? noUpdate);
  });
}
