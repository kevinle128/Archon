/**
 * WorkflowStore adapter — bridges @archon/core DB modules to the
 * IWorkflowStore trait defined in @archon/workflows.
 */
import type { IWorkflowStore } from '@archon/workflows/store';
import type { WorkflowConfig, WorkflowDeps } from '@archon/workflows/deps';
import { createWorkflowUsageRecorder } from './usage-recorder';
import type { WorkflowRun, WorkflowRunStatus } from '@archon/workflows/schemas/workflow-run';
import type { MergedConfig } from '../config/config-types';
import * as workflowDb from '../db/workflows';
import * as workflowEventDb from '../db/workflow-events';
import * as workflowEventOutboxDb from '../db/workflow-event-outbox';
import * as workflowNodeSessionDb from '../db/workflow-node-sessions';
import * as workflowNodeMessageDb from '../db/workflow-node-messages';
import * as workflowPendingInteractionDb from '../db/workflow-pending-interactions';
import * as workflowSteeringDb from '../db/workflow-steering';
import * as workflowCheckpointDb from '../db/workflow-checkpoints';
import * as codebaseDb from '../db/codebases';
import * as envVarDb from '../db/env-vars';
import { resolveEventRoute, type NotRoutableReason } from '../events/binding-router';
import {
  buildWorkflowEventEnvelope,
  type ExternalWorkflowEventType,
} from '../events/workflow-event-envelope';
import {
  transformWorkflowEventBody,
  isProviderBindingTransformError,
  normalizeProviderBindingTransform,
} from '../events/provider-binding-transform';
import { externalWorkflowEventTypeSchema } from '../schemas/workflow-event';
import { getAgentProvider } from '@archon/providers';
import { loadConfig as loadMergedConfig } from '../config/config-loader';
import { createLogger } from '@archon/paths';
import type { IGitHubAppAuthProvider } from '../github-auth';
import { isPerUserGitHubEnabled } from '../github-auth/config';
import { getDecryptedAccessToken } from '../db/user-github-token-store';
import { isPerUserProviderKeysEnabled } from '../credentials/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  deliverCredential,
  buildPiAuthJson,
  PI_AUTH_JSON_RELATIVE_PATH,
  PI_AUTH_PATH_ENV,
} from '../credentials/delivery';
import { listDecryptedUserProviderCredentials } from '../db/user-provider-key-store';
import { getUserAiPrefs, type UserAiPrefs } from '../db/user-ai-prefs-store';
import { captureRunEndGitSnapshot } from './git-snapshot';

// Compile-time assertion: MergedConfig must remain a structural subtype of WorkflowConfig.
// If MergedConfig drifts from WorkflowConfig, this line becomes a type error.
const assertConfigCompat: WorkflowConfig = {} as MergedConfig;
void assertConfigCompat;

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.store-adapter');
  return cachedLog;
}

const INTERNAL_EVENT_TYPE_MAP = new Map<string, ExternalWorkflowEventType>([
  ['workflow_started', 'workflow.run.started'],
  ['workflow_completed', 'workflow.run.completed'],
  ['approval_requested', 'workflow.approval.requested'],
]);

interface ExternalWorkflowEventInput {
  workflow_run_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

function toExternalEventType(value: string): ExternalWorkflowEventType | null {
  const result = externalWorkflowEventTypeSchema.safeParse(value);
  return result.success ? result.data : null;
}

function bindingAllowsEvent(
  eventTypes: readonly ExternalWorkflowEventType[],
  eventType: ExternalWorkflowEventType
): boolean {
  return eventTypes.length === 0 || eventTypes.includes(eventType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireHttpUrl(value: string, source: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${source} must be a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${source} must use HTTP or HTTPS`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${source} must not include credentials`);
  }
  return url;
}

function enrichApprovalPayload(
  eventType: ExternalWorkflowEventType,
  payload: Record<string, unknown>,
  run: Pick<WorkflowRun, 'id' | 'codebase_id' | 'user_message'>
): Record<string, unknown> {
  if (eventType !== 'workflow.approval.requested') return payload;
  if (!isRecord(payload.approval)) return payload;

  const approval = payload.approval;
  let reviewUrl: string;
  if (approval.gateType === 'plannotator_gate') {
    if (typeof approval.reviewUrl !== 'string') {
      throw new Error('Plannotator approval event is missing reviewUrl');
    }
    requireHttpUrl(approval.reviewUrl, 'Plannotator reviewUrl');
    reviewUrl = approval.reviewUrl;
  } else {
    if (!run.codebase_id) throw new Error('Approval event is missing codebase_id');
    const configured = process.env.ARCHON_PUBLIC_URL?.trim();
    if (!configured) throw new Error('ARCHON_PUBLIC_URL is required for approval callbacks');
    const url = requireHttpUrl(configured, 'ARCHON_PUBLIC_URL');
    url.pathname = `/console/p/${encodeURIComponent(run.codebase_id)}/r/${encodeURIComponent(run.id)}`;
    url.search = '';
    url.hash = '';
    reviewUrl = url.toString();
  }

  return {
    ...payload,
    approval: {
      ...approval,
      userPrompt: run.user_message,
      reviewUrl,
    },
  };
}

function buildInternalEventPayload(input: {
  runId: string;
  eventType: ExternalWorkflowEventType;
  occurredAt: string;
  stepName?: string;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  if (input.eventType === 'workflow.run.started') {
    return { state: 'running', startedAt: input.occurredAt };
  }
  if (input.eventType === 'workflow.run.completed') {
    return {
      state: 'completed',
      result: {
        outcome: 'accepted',
        completedAt: input.occurredAt,
        ...(input.data ?? {}),
      },
    };
  }
  if (input.eventType === 'workflow.run.failed') {
    return {
      state: 'failed',
      failure: {
        code: 'WORKFLOW_FAILED',
        category: 'workflow_failure',
        retryable: false,
        details: input.data ?? {},
      },
    };
  }
  if (input.eventType === 'workflow.approval.requested') {
    return {
      state: 'waiting-for-approval',
      approval: {
        requestId: `approval:${input.runId}:${input.stepName ?? 'workflow'}`,
        requestedAction: 'approve-or-reject',
        phase: input.stepName ?? 'approval',
        ...(input.data ?? {}),
      },
    };
  }
  return input.data ?? {};
}

function buildNotRoutableBody(input: {
  eventId: string;
  eventType: ExternalWorkflowEventType;
  occurredAt: string;
  idempotencyKey: string;
  reason: NotRoutableReason;
  payload: Record<string, unknown>;
}): string {
  return JSON.stringify({
    schemaVersion: 'workflow-event-envelope.v1',
    provider: 'archon',
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey,
    notRoutableReason: input.reason,
    payload: input.payload,
  });
}

async function enqueueExternalWorkflowEvent(input: ExternalWorkflowEventInput): Promise<void> {
  try {
    const eventType = toExternalEventType(input.event_type);
    if (!eventType) {
      getLog().warn(
        { eventType: input.event_type, runId: input.workflow_run_id },
        'workflow_event_outbox_unsupported_event_type'
      );
      return;
    }

    const run = await workflowDb.getWorkflowRun(input.workflow_run_id);
    if (!run) {
      getLog().warn({ runId: input.workflow_run_id }, 'workflow_event_outbox_run_missing');
      return;
    }

    const eventId = `evt_${randomUUID()}`;
    const codebaseId = run.codebase_id;
    if (!codebaseId) {
      if (eventType === 'workflow.approval.requested') {
        throw new Error('Approval event is missing codebase_id');
      }
      const reason: NotRoutableReason = 'missing-codebase';
      const idempotencyKey = `archon:not-routable:${eventId}`;
      await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
        event_id: eventId,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        workflow_run_id: run.id,
        event_body: buildNotRoutableBody({
          eventId,
          eventType,
          occurredAt: input.occurred_at,
          idempotencyKey,
          reason,
          payload: input.payload,
        }),
        status: 'not-routable',
        not_routable_reason: reason,
      });
      return;
    }

    const resolution = await resolveEventRoute(codebaseId);
    if (resolution.binding && !bindingAllowsEvent(resolution.binding.event_types, eventType)) {
      getLog().debug(
        { eventType, runId: run.id, bindingId: resolution.binding.id },
        'workflow_event_outbox_filtered_by_binding'
      );
      return;
    }
    const enrichedPayload = enrichApprovalPayload(eventType, input.payload, run);
    if (!resolution.routable) {
      const idempotencyKey = resolution.binding
        ? `archon:${resolution.binding.name}:${eventId}`
        : `archon:not-routable:${eventId}`;
      const eventBody =
        resolution.codebase && resolution.binding
          ? JSON.stringify(
              buildWorkflowEventEnvelope({
                eventId,
                eventType,
                occurredAt: input.occurred_at,
                run,
                codebase: resolution.codebase,
                binding: resolution.binding,
                payload: enrichedPayload,
              })
            )
          : buildNotRoutableBody({
              eventId,
              eventType,
              occurredAt: input.occurred_at,
              idempotencyKey,
              reason: resolution.reason,
              payload: enrichedPayload,
            });
      await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
        event_id: eventId,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        workflow_run_id: run.id,
        codebase_id: resolution.codebase?.id ?? codebaseId,
        binding_id: resolution.binding?.id ?? null,
        event_body: eventBody,
        status: 'not-routable',
        not_routable_reason: resolution.reason,
      });
      return;
    }

    const envelope = buildWorkflowEventEnvelope({
      eventId,
      eventType,
      occurredAt: input.occurred_at,
      run,
      codebase: resolution.codebase,
      binding: resolution.binding,
      payload: enrichedPayload,
    });
    const transformStartedAt = Date.now();
    try {
      const transform =
        resolution.binding.transform === undefined || resolution.binding.transform === null
          ? null
          : normalizeProviderBindingTransform(resolution.binding.transform);
      const transformed = await transformWorkflowEventBody(envelope, transform);
      getLog().debug(
        {
          bindingId: resolution.binding.id,
          eventType: envelope.eventType,
          engine: transformed.engine,
          durationMs: transformed.durationMs,
          outputBytes: transformed.outputBytes,
        },
        'workflow_event_outbox_transform_completed'
      );
      await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
        event_id: envelope.eventId,
        idempotency_key: envelope.idempotencyKey,
        event_type: envelope.eventType,
        workflow_run_id: run.id,
        codebase_id: resolution.codebase.id,
        binding_id: resolution.binding.id,
        event_route: resolution.route,
        event_body: transformed.body,
        status: 'pending',
        next_attempt_at: input.occurred_at,
      });
    } catch (error) {
      if (!isProviderBindingTransformError(error)) throw error;
      getLog().warn(
        {
          bindingId: resolution.binding.id,
          eventType: envelope.eventType,
          engine: resolution.binding.transform == null ? 'identity' : 'jsonata',
          durationMs: Math.max(0, Date.now() - transformStartedAt),
          errorCode: error.code,
        },
        'workflow_event_outbox_transform_failed'
      );
      await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
        event_id: envelope.eventId,
        idempotency_key: envelope.idempotencyKey,
        event_type: envelope.eventType,
        workflow_run_id: run.id,
        codebase_id: resolution.codebase.id,
        binding_id: resolution.binding.id,
        event_body: JSON.stringify(envelope),
        status: 'not-routable',
        not_routable_reason: 'transform-failed',
        last_error: error.code,
        next_attempt_at: null,
      });
    }
  } catch (err) {
    getLog().error(
      { err: err as Error, eventType: input.event_type, runId: input.workflow_run_id },
      'workflow_event_outbox_enqueue_unexpected_throw'
    );
  }
}

export function createWorkflowStore(): IWorkflowStore {
  return {
    createWorkflowRun: workflowDb.createWorkflowRun,
    getWorkflowRun: workflowDb.getWorkflowRun,
    findChildRuns: workflowDb.findChildRuns,
    getRunAncestry: workflowDb.getRunAncestry,
    getActiveWorkflowRunByPath: workflowDb.getActiveWorkflowRunByPath,
    findResumableRun: workflowDb.findResumableRun,
    failOrphanedRuns: workflowDb.failOrphanedRuns,
    resumeWorkflowRun: workflowDb.resumeWorkflowRun,
    resumeApprovedGate: workflowDb.resumeApprovedGate,
    updateWorkflowRun: workflowDb.updateWorkflowRun,
    setWorkflowRunEnvOverlay: workflowDb.setWorkflowRunEnvOverlay,
    resolveApprovalGate: workflowDb.resolveApprovalGate,
    transitionPlannotatorGate: workflowDb.transitionPlannotatorGate,
    submitReviewFeedback: workflowDb.submitReviewFeedback,
    claimGateDecision: workflowDb.claimGateDecision,
    updateWorkflowActivity: workflowDb.updateWorkflowActivity,
    // DB returns string | null; IWorkflowStore declares WorkflowRunStatus | null.
    // The remote_agent_workflow_runs.status column is constrained to valid enum values
    // in SQL, so this cast is safe as long as the column constraint matches WorkflowRunStatus.
    getWorkflowRunStatus: id =>
      workflowDb.getWorkflowRunStatus(id) as Promise<WorkflowRunStatus | null>,
    completeWorkflowRun: workflowDb.completeWorkflowRun,
    failWorkflowRun: workflowDb.failWorkflowRun,
    pauseWorkflowRun: workflowDb.pauseWorkflowRun,
    claimWriteback: workflowDb.claimWriteback,
    releaseWritebackClaim: workflowDb.releaseWritebackClaim,
    cancelWorkflowRun: workflowDb.cancelWorkflowRun,
    persistRouteDecisionTransition: workflowDb.persistRouteDecisionTransition,
    createWorkflowEvent: async (data): Promise<void> => {
      try {
        await workflowEventDb.createWorkflowEvent(data);
        const eventType = INTERNAL_EVENT_TYPE_MAP.get(data.event_type);
        if (eventType) {
          const occurredAt = new Date().toISOString();
          await enqueueExternalWorkflowEvent({
            workflow_run_id: data.workflow_run_id,
            event_type: eventType,
            occurred_at: occurredAt,
            payload: buildInternalEventPayload({
              runId: data.workflow_run_id,
              eventType,
              occurredAt,
              stepName: data.step_name,
              data: data.data,
            }),
          });
        }
      } catch (err) {
        // Belt-and-suspenders: workflowEventDb.createWorkflowEvent already catches internally,
        // but this wrapper guarantees the IWorkflowStore non-throwing contract at the boundary.
        getLog().error(
          { err: err as Error, eventType: data.event_type, runId: data.workflow_run_id },
          'workflow_event_create_unexpected_throw'
        );
      }
    },
    enqueueExternalWorkflowEvent,
    upsertWorkflowNodeCheckpoint: workflowCheckpointDb.upsertWorkflowNodeCheckpoint,
    getLatestWorkflowNodeCheckpoint: workflowCheckpointDb.getLatestWorkflowNodeCheckpoint,
    getDagResumeSnapshot: workflowEventDb.getDagResumeSnapshot,
    getCodebase: codebaseDb.getCodebase,
    getCodebaseEnvVars: envVarDb.getCodebaseEnvVars,
    getWorkflowNodeSession: workflowNodeSessionDb.getWorkflowNodeSession,
    upsertWorkflowNodeSession: workflowNodeSessionDb.upsertWorkflowNodeSession,
    deleteWorkflowNodeSessions: workflowNodeSessionDb.deleteWorkflowNodeSessions,
    appendNodeMessage: input => workflowNodeMessageDb.appendNodeMessage(input),
    listNodeMessages: (workflowRunId, nodeId) =>
      workflowNodeMessageDb.listNodeMessages(workflowRunId, nodeId),
    insertPendingInteraction: input => workflowPendingInteractionDb.insertPendingInteraction(input),
    listPendingInteractions: workflowRunId =>
      workflowPendingInteractionDb.listPendingInteractions(workflowRunId),
    resolvePendingInteraction: input =>
      workflowPendingInteractionDb.resolvePendingInteraction(input),
    getSteeringDraft: key => workflowSteeringDb.getSteeringDraft(key),
    upsertSteeringDraft: input => workflowSteeringDb.upsertSteeringDraft(input),
    clearSteeringDraft: key => workflowSteeringDb.clearSteeringDraft(key),
    getSteeringNodeSettings: (workflowRunId, nodeId) =>
      workflowSteeringDb.getSteeringNodeSettings(workflowRunId, nodeId),
    upsertSteeringNodeSettings: input => workflowSteeringDb.upsertSteeringNodeSettings(input),
    enqueueSteeringMessage: input => workflowSteeringDb.enqueueSteeringMessage(input),
    withdrawSteeringMessage: (workflowRunId, nodeId, messageId) =>
      workflowSteeringDb.withdrawSteeringMessage(workflowRunId, nodeId, messageId),
    listSteeringQueue: (workflowRunId, nodeId) =>
      workflowSteeringDb.listSteeringQueue(workflowRunId, nodeId),
    claimSteeringQueue: (workflowRunId, nodeId, limit) =>
      workflowSteeringDb.claimSteeringQueue(workflowRunId, nodeId, limit),
    markSteeringMessagesSent: (workflowRunId, nodeId, messageIds) =>
      workflowSteeringDb.markSteeringMessagesSent(workflowRunId, nodeId, messageIds),
    claimSteeringMessageForSoftInjection: (workflowRunId, nodeId, messageId) =>
      workflowSteeringDb.claimSteeringMessageForSoftInjection(workflowRunId, nodeId, messageId),
    reconcileNeverSentSteeringMessages: (workflowRunId, nodeId) =>
      workflowSteeringDb.reconcileNeverSentSteeringMessages(workflowRunId, nodeId),
  };
}

/**
 * Module-singleton registration for the GitHub App auth provider. Set by the
 * server bootstrap (`registerGitHubAppAuthProvider(provider)`) when App mode
 * is active; remains null in PAT mode and during CLI execution. The
 * workflow-deps factory reads this to decide whether to expose
 * `resolveBotGitHubToken` to the engine.
 *
 * Singleton because the provider is itself a process-singleton (one cache
 * shared by the GitHub adapter, the workflow executor, and the internal
 * credential-helper endpoint). Threading it through every createWorkflowDeps
 * caller would just smuggle a singleton through more arguments.
 */
let registeredGitHubAppAuthProvider: IGitHubAppAuthProvider | null = null;

export function registerGitHubAppAuthProvider(provider: IGitHubAppAuthProvider | null): void {
  registeredGitHubAppAuthProvider = provider;
}

/**
 * Create the canonical WorkflowDeps for the workflow engine.
 * Single construction point — avoids duplicating the wiring across callers.
 */
export function createWorkflowDeps(): WorkflowDeps {
  const provider = registeredGitHubAppAuthProvider;
  return {
    store: createWorkflowStore(),
    usageRecorder: createWorkflowUsageRecorder(),
    getAgentProvider,
    loadConfig: loadMergedConfig,
    // App mode: resolve fresh installation tokens for subprocess env. PAT mode:
    // undefined → engine falls back to env inheritance, preserving legacy
    // behaviour for solo installs.
    resolveBotGitHubToken: provider
      ? async (owner: string, repo: string): Promise<string | undefined> => {
          try {
            return await provider.getInstallationToken(owner, repo);
          } catch (err) {
            getLog().warn(
              { err: err as Error, owner, repo },
              'workflow_deps.bot_token_resolve_failed'
            );
            return undefined;
          }
        }
      : undefined,
    // Per-user token policy (PR-C): when per-user mode is on, route a run's
    // gh/git through the originating user's personal token (decrypted, refreshed
    // on read), or scrub the org/bot token when they haven't connected.
    isPerUserGitHubEnabled: () => isPerUserGitHubEnabled(),
    getUserGithubToken: async (userId: string): Promise<string | undefined> => {
      try {
        return (await getDecryptedAccessToken(userId)) ?? undefined;
      } catch (err) {
        getLog().warn({ err: err as Error, userId }, 'workflow_deps.user_token_resolve_failed');
        return undefined;
      }
    },
    // Per-user AI-provider credentials (Phase 2): list the user's decrypted
    // credentials and translate each through the delivery map into an env bag
    // (and optional file deliveries) for the run. Engine-facing contract is
    // env+files only — the delivery map is owned here, not in @archon/workflows,
    // so the workflow engine stays free of provider-specific knowledge.
    isPerUserProviderKeysEnabled: () => isPerUserProviderKeysEnabled(),
    getUserProviderEnv: async (
      userId: string,
      artifactsDir: string
    ): Promise<{
      env: Record<string, string>;
      files: { path: string; contents: string }[];
    }> => {
      try {
        const creds = await listDecryptedUserProviderCredentials(userId);
        const env: Record<string, string> = {};
        const files: { path: string; contents: string }[] = [];
        for (const { provider, cred } of creds) {
          try {
            const result = deliverCredential(provider, cred, { artifactsDir });
            Object.assign(env, result.env);
            if (result.files) files.push(...result.files);
          } catch (err) {
            // Unknown provider / shape mismatch — log at ERROR (no per-credential
            // user-facing skip event yet) and skip this credential rather than
            // abort all delivery.
            getLog().error(
              { err: err as Error, userId, provider },
              'workflow_deps.provider_creds_deliver_failed'
            );
          }
        }
        // Aggregate Pi auth.json (the user's keys + subscriptions) so a `pi` node
        // consumes them via AuthStorage(authPath) without moving Pi's home. Needs
        // a real artifactsDir (file delivery); the chat path is env-only.
        if (artifactsDir) {
          const piAuthJson = buildPiAuthJson(creds);
          if (piAuthJson) {
            const piAuthPath = join(artifactsDir, PI_AUTH_JSON_RELATIVE_PATH);
            files.push({ path: piAuthPath, contents: piAuthJson });
            env[PI_AUTH_PATH_ENV] = piAuthPath;
          }
        }
        return { env, files };
      } catch (err) {
        getLog().warn({ err: err as Error, userId }, 'workflow_deps.provider_creds_resolve_failed');
        return { env: {}, files: [] };
      }
    },
    // Per-user AI prefs (Phase 3): personal tiers/aliases/default-provider,
    // folded into buildAiProfile as the highest-precedence layer. Non-throwing —
    // a DB failure means the run falls back to install-wide config.
    getUserAiPrefs: async (userId: string): Promise<UserAiPrefs> => {
      try {
        return await getUserAiPrefs(userId);
      } catch (err) {
        getLog().warn({ err: err as Error, userId }, 'workflow_deps.user_ai_prefs_resolve_failed');
        return {};
      }
    },
    onRunEndGitSnapshot: captureRunEndGitSnapshot,
  };
}
