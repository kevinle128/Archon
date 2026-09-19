/**
 * Zod schemas for workflow API endpoints.
 */
import { z } from '@hono/zod-openapi';
import { workflowDefinitionSchema as engineWorkflowDefinitionSchema } from '@archon/workflows/schemas/workflow';
import { effortLevelSchema, thinkingConfigSchema } from '@archon/workflows/schemas/dag-node';
import {
  nodeStateSchema,
  reviewFeedbackTextSchema,
  workflowRunSchema as engineWorkflowRunSchema,
} from '@archon/workflows/schemas/workflow-run';
import {
  workflowEventRowSchema,
  routeLoopDecisionEventDataSchema,
} from '@archon/core/schemas/workflow-event';
import { dashboardWorkflowRunSchema as coreDashboardWorkflowRunSchema } from '@archon/core/schemas/workflow-run';
import {
  askAnswerBodySchema,
  pendingInteractionSchema,
  permissionConfirmBodySchema,
} from '@archon/workflows/schemas/pending-interaction';
import {
  nodeMessageTextSchema,
  nodeMessageToolSchema,
  nodeMessageStatusSchema,
} from '@archon/workflows/schemas/node-message';
import { nodeExecutionSchema } from '@archon/workflows/schemas/node-execution';
import { nullableUsageReportResponseSchema } from './usage.schemas';

/** Workflow definition schema — derived from engine schema via direct subpath import. */
export const workflowDefinitionSchema =
  engineWorkflowDefinitionSchema.openapi('WorkflowDefinition');

/** A workflow load error entry returned in GET /api/workflows `errors` field. */
export const workflowLoadErrorSchema = z
  .object({
    filename: z.string(),
    error: z.string(),
    errorType: z.enum(['read_error', 'parse_error', 'validation_error']),
  })
  .openapi('WorkflowLoadError');

/**
 * Workflow source — project-defined, bundled default, or home-scoped (global).
 * Precedence for same-named entries: `bundled` < `global` < `project`.
 */
export const workflowSourceSchema = z
  .enum(['project', 'bundled', 'global'])
  .openapi('WorkflowSource');

/** A workflow entry in the list response, including its source. */
export const workflowListEntrySchema = z
  .object({
    workflow: workflowDefinitionSchema,
    source: workflowSourceSchema,
    /**
     * Non-fatal warnings raised while parsing this workflow's YAML — today, keys
     * the engine silently drops (#2213). The workflow still loads and runs;
     * these tell the author what was ignored. Omitted when there are none.
     */
    parseWarnings: z.array(z.string()).optional(),
  })
  .openapi('WorkflowListEntry');

/** GET /api/workflows response. */
export const workflowListResponseSchema = z
  .object({
    workflows: z.array(workflowListEntrySchema),
    /**
     * Repo-owner-curated workflow names from `.archon/config.yaml`
     * `recommendedWorkflows`, filtered to names present in `workflows` and
     * preserved in declared order. Empty when no project context or no key.
     */
    recommended: z.array(z.string()),
    errors: z.array(workflowLoadErrorSchema).optional(),
  })
  .openapi('WorkflowListResponse');

/** GET /api/workflows/:name response. */
export const getWorkflowResponseSchema = z
  .object({
    workflow: workflowDefinitionSchema,
    filename: z.string(),
    source: workflowSourceSchema,
  })
  .openapi('GetWorkflowResponse');

/** Request body for workflow definition endpoints (PUT and POST /validate). */
const definitionBodySchema = z.object({ definition: z.record(z.string(), z.unknown()) });

/** PUT /api/workflows/:name request body. */
export const saveWorkflowBodySchema = definitionBodySchema.openapi('SaveWorkflowBody');

/** POST /api/workflows/validate request body. */
export const validateWorkflowBodySchema = definitionBodySchema.openapi('ValidateWorkflowBody');

/** POST /api/workflows/validate response. */
export const validateWorkflowResponseSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(z.string()).optional(),
  })
  .openapi('ValidateWorkflowResponse');

/** DELETE /api/workflows/:name response. */
export const deleteWorkflowResponseSchema = z
  .object({ deleted: z.boolean(), name: z.string() })
  .openapi('DeleteWorkflowResponse');

/** A single command entry returned by GET /api/commands. */
export const commandEntrySchema = z
  .object({
    name: z.string(),
    source: workflowSourceSchema,
  })
  .openapi('CommandEntry');

/** GET /api/commands response. */
export const commandListResponseSchema = z
  .object({ commands: z.array(commandEntrySchema) })
  .openapi('CommandListResponse');

// =========================================================================
// Workflow run schemas
// =========================================================================

/** Workflow run status values. */
export const workflowRunStatusSchema = z
  .enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'])
  .openapi('WorkflowRunStatus');

/** A workflow run record (wire shape with ISO string dates). */
export const workflowRunSchema = engineWorkflowRunSchema
  .extend({
    started_at: z.string(),
    completed_at: z.string().nullable(),
    last_activity_at: z.string().nullable(),
  })
  .openapi('WorkflowRun');

/** GET /api/workflows/runs response. */
export const workflowRunListResponseSchema = z
  .object({ runs: z.array(workflowRunSchema) })
  .openapi('WorkflowRunListResponse');

/** A workflow event record (wire shape). */
const workflowEventBaseSchema = workflowEventRowSchema.safeExtend({
  created_at: z.string().datetime(),
});

const routeLoopWorkflowEventSchema = workflowEventBaseSchema.safeExtend({
  event_type: z.literal('node_routed'),
  data: routeLoopDecisionEventDataSchema,
});

export const workflowEventSchema = z
  .union([routeLoopWorkflowEventSchema, workflowEventBaseSchema])
  .openapi('WorkflowEvent');

export const workflowNodeStateSchema = z
  .object({
    nodeId: z.string(),
    name: z.string(),
    status: nodeStateSchema,
    retryEpoch: z.number().int().nonnegative(),
    duration: z.number().optional(),
    error: z.string().optional(),
    reason: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    tier: z.string().optional(),
    modelReasoningEffort: z.string().min(1).optional(),
    effort: effortLevelSchema.optional(),
    thinking: thinkingConfigSchema.optional(),
  })
  .openapi('WorkflowNodeState');

export const pendingInteractionResponseSchema = pendingInteractionSchema
  .safeExtend({
    created_at: z.string(),
    resolved_at: z.string().nullable(),
  })
  .openapi('PendingInteraction');

const nodeMessageWireShape = { created_at: z.string() };
export const workflowNodeMessageTextResponseSchema = nodeMessageTextSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend(nodeMessageWireShape);
export const workflowNodeMessageToolResponseSchema = nodeMessageToolSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend(nodeMessageWireShape);
export const workflowNodeMessageStatusResponseSchema = nodeMessageStatusSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend(nodeMessageWireShape);
export const workflowNodeMessageResponseSchema = z
  .discriminatedUnion('kind', [
    workflowNodeMessageTextResponseSchema,
    workflowNodeMessageToolResponseSchema,
    workflowNodeMessageStatusResponseSchema,
  ])
  .openapi('WorkflowNodeMessage');

export const workflowNodeMessagesParamsSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
});
export const workflowNodeMessagesQuerySchema = z
  .object({
    afterSeq: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    occurrenceId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
  })
  .strict()
  .openapi('WorkflowNodeMessagesQuery');
export const workflowNodeMessagesResponseSchema = z
  .object({
    messages: z.array(workflowNodeMessageResponseSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
    highWatermark: z.number().int().nonnegative().optional(),
  })
  .strict()
  .openapi('WorkflowNodeMessagesResponse');

export const workflowNodeMessageDetailParamsSchema = z
  .object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
    messageId: z.string().min(1),
  })
  .openapi('WorkflowNodeMessageDetailParams');

export const nodeExecutionResponseSchema = nodeExecutionSchema.openapi('NodeExecution');

/** GET /api/workflows/runs/:runId response. */
export const workflowRunDetailSchema = z
  .object({
    run: workflowRunSchema.extend({
      worker_platform_id: z.string().optional(),
      parent_platform_id: z.string().optional(),
      conversation_platform_id: z.string().nullable(),
    }),
    events: z.array(workflowEventSchema),
    nodeStates: z.array(workflowNodeStateSchema),
    pending_interactions: z.array(pendingInteractionResponseSchema),
    /**
     * Direct-run usage grouped by node. Null when the usage query fails;
     * empty coverage (`hasRecordedUsage: false`) when the run has no usage events.
     * Never includes child-run charges.
     *
     * Uses `nullableUsageReportResponseSchema` (own OpenAPI identity) — never
     * `usageReportResponseSchema.nullable()`, which would contaminate the shared
     * non-null `UsageReport` component used by GET /api/usage.
     */
    usage: nullableUsageReportResponseSchema,
    viewer_is_starter: z.boolean(),
    starter_display_name: z.string().nullable(),
    nodeExecutions: z.array(nodeExecutionResponseSchema).optional(),
  })
  .openapi('WorkflowRunDetail');

/** GET /api/workflows/runs/by-worker/:platformId response. */
export const workflowRunByWorkerResponseSchema = z
  .object({ run: workflowRunSchema })
  .openapi('WorkflowRunByWorkerResponse');

/** POST /api/workflows/runs/:runId/cancel response. */
export const cancelWorkflowRunResponseSchema = z
  .object({ success: z.boolean(), message: z.string() })
  .openapi('CancelWorkflowRunResponse');

/** Generic workflow run action response (resume, abandon, delete). */
export const workflowRunActionResponseSchema = z
  .object({ success: z.boolean(), message: z.string() })
  .openapi('WorkflowRunActionResponse');

/** POST /api/workflows/runs/:runId/callback/test response. */
export const testWorkflowRunCallbackResponseSchema = z
  .object({
    accepted: z.literal(true),
    runId: z.string(),
    eventType: z.literal('workflow.run.completed'),
  })
  .openapi('TestWorkflowRunCallbackResponse');

/** POST /api/workflows/runs/:runId/nodes/:nodeId/retry path params. */
export const retryWorkflowNodeParamsSchema = z
  .object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .openapi('RetryWorkflowNodeParams');

export const retryWorkflowNodeCheckoutStrategySchema = z
  .enum(['checkpoint', 'current'])
  .openapi('RetryWorkflowNodeCheckoutStrategy');

/** POST /api/workflows/runs/:runId/nodes/:nodeId/retry request body. */
export const retryWorkflowNodeBodySchema = z
  .object({
    checkoutStrategy: retryWorkflowNodeCheckoutStrategySchema.optional(),
  })
  .openapi('RetryWorkflowNodeBody');

/** GET /api/workflows/runs/:runId/nodes/:nodeId/retry/preview response. */
export const retryWorkflowNodePreviewResponseSchema = z
  .object({
    runId: z.string(),
    workflowName: z.string(),
    nodeId: z.string(),
    retryEpoch: z.number().int().nonnegative(),
    invalidatedNodes: z.array(z.string()),
    resetSkipped: z.boolean(),
    checkpointRef: z.string().optional(),
    checkpointCommitSha: z.string().optional(),
    currentHeadSha: z.string().optional(),
    hasNewerHead: z.boolean(),
    requiresCommitChoice: z.boolean(),
  })
  .openapi('RetryWorkflowNodePreviewResponse');

/** POST /api/workflows/runs/:runId/nodes/:nodeId/retry response. */
export const retryWorkflowNodeResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
    runId: z.string(),
    nodeId: z.string(),
    retryEpoch: z.number().int().nonnegative(),
    invalidatedNodes: z.array(z.string()),
    safetyCommitSha: z.string().optional(),
    checkoutStrategy: retryWorkflowNodeCheckoutStrategySchema,
  })
  .openapi('RetryWorkflowNodeResponse');

/** POST /api/workflows/runs/:runId/ask/:requestId/answer request body. */
export const askAnswerRequestSchema = askAnswerBodySchema.openapi('AskAnswerBody');

/** POST /api/workflows/runs/:runId/permissions/:callId/confirm request body. */
export const permissionConfirmRequestSchema =
  permissionConfirmBodySchema.openapi('PermissionConfirmBody');

/** POST /api/workflows/runs/:runId/approve request body. */
export const approveWorkflowRunBodySchema = z
  .object({ comment: z.string().optional() })
  .openapi('ApproveWorkflowRunBody');

/** POST /api/workflows/runs/:runId/reject request body. */
export const rejectWorkflowRunBodySchema = z
  .object({ reason: z.string().optional() })
  .openapi('RejectWorkflowRunBody');

/** DELETE /api/workflows/:name/node-sessions path params. */
export const resetWorkflowNodeSessionsParamsSchema = z
  .object({ name: z.string().min(1) })
  .openapi('ResetWorkflowNodeSessionsParams');

/**
 * DELETE /api/workflows/:name/node-sessions query params.
 *
 * `scope` and `node` narrow the deletion. Omitting `scope` wipes every scope for the
 * workflow — a destructive cross-scope reset that requires `confirm=all-scopes`
 * (mirrors the CLI's `--yes` guard) so it can't happen by an accidentally-dropped param.
 */
export const resetWorkflowNodeSessionsQuerySchema = z
  .object({
    scope: z.string().optional(),
    node: z.string().optional(),
    confirm: z.enum(['all-scopes']).optional(),
  })
  .openapi('ResetWorkflowNodeSessionsQuery');

/** DELETE /api/workflows/:name/node-sessions response. */
export const resetWorkflowNodeSessionsResponseSchema = z
  .object({
    success: z.boolean(),
    deleted: z.number().int().nonnegative(),
  })
  .openapi('ResetWorkflowNodeSessionsResponse');

/** Dashboard enriched workflow run (wire shape with ISO string dates). */
export const dashboardWorkflowRunSchema = coreDashboardWorkflowRunSchema
  .extend({
    started_at: z.string(),
    completed_at: z.string().nullable(),
    last_activity_at: z.string().nullable(),
  })
  .openapi('DashboardWorkflowRun');

/** GET /api/dashboard/runs response. */
export const dashboardRunsResponseSchema = z
  .object({
    runs: z.array(dashboardWorkflowRunSchema),
    total: z.number(),
    counts: z.object({
      all: z.number(),
      running: z.number(),
      completed: z.number(),
      failed: z.number(),
      cancelled: z.number(),
      pending: z.number(),
      paused: z.number(),
    }),
  })
  .openapi('DashboardRunsResponse');

/**
 * POST /api/workflows/:name/run request body.
 *
 * NOT WIRED, and deliberately so: `runWorkflowRoute` omits `request.body` because this
 * route also accepts `multipart/form-data`, which Zod would reject against a JSON schema
 * (the documented multipart-or-JSON exception in AGENTS.md). Nothing references this
 * schema, so it contributes nothing to `/api/openapi.json` — `RunWorkflowBody` does not
 * appear in the generated spec or in `api.generated.d.ts`. The route's real contract is
 * the hand-written validation in the handler plus the route `description` string; those
 * are what a caller and the generated client actually see.
 *
 * It is kept as the declared shape of the JSON body for a reader, and must be updated
 * alongside the handler — but do not add a field here believing that publishes it.
 */
export const runWorkflowBodySchema = z
  .object({
    conversationId: z.string(),
    message: z.string(),
    /**
     * Values for the workflow's declared `inputs:` (#2554), keyed by input name.
     * Validated against the declaration before any worktree, clone, or AI cost; a
     * missing required input or an undeclared key is refused. Omit for a workflow that
     * declares no inputs, or to take every declared default.
     *
     * In a `multipart/form-data` request the same map travels as a single `inputs` form
     * field holding this object JSON-encoded (form fields can only be strings).
     */
    inputs: z.record(z.string(), z.string()).optional(),
    /**
     * Optional Workflow ENV id to freeze at Start (US-008/US-022). Omitted or
     * empty string means YAML-only. Present non-strings (including JSON null)
     * are rejected as `invalid_env_id` by the manual Start parser — this
     * OpenAPI schema documents the happy-path string field only; Start retains
     * the multipart/manual-parse exception. Multipart sends the same plain
     * string field (duplicates rejected).
     */
    envId: z.string().optional(),
  })
  .openapi('RunWorkflowBody');

/** A single artifact file listed by GET /api/runs/:runId/artifacts. */
export const artifactFileSchema = z
  .object({
    path: z.string(),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string(),
  })
  .openapi('ArtifactFile');

/** GET /api/runs/:runId/artifacts response. */
export const listArtifactsResponseSchema = z
  .object({
    files: z.array(artifactFileSchema),
  })
  .openapi('ListArtifactsResponse');

/** GET /api/dashboard/runs query params. */
export const dashboardRunsQuerySchema = z.object({
  // z.string() — handler validates the enum value and ignores invalid values
  status: z.string().optional(),
  codebaseId: z.string().optional(),
  search: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

/** GET /api/workflows/runs query params. */
export const workflowRunsQuerySchema = z.object({
  conversationId: z.string().optional(),
  // z.string() — handler validates the enum value and ignores invalid values
  status: z.string().optional(),
  codebaseId: z.string().optional(),
  limit: z.string().optional(),
  // Non-enforcing "mine" filter: 'true' restricts to the caller's own runs
  // when an identity resolves. Default lists everything. Enum makes the boolean
  // contract explicit (the handler treats only 'true' as on).
  mine: z.enum(['true', 'false']).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/workflows/runs/:runId/review-feedback
// ---------------------------------------------------------------------------

/**
 * Request body for inline Plannotator review feedback submission.
 * strict() rejects unknown keys so callers cannot accidentally omit or
 * add fields while believing they submitted successfully.
 */
export const reviewFeedbackBodySchema = z
  .object({
    nodeId: z.string().min(1),
    gateId: z.string().min(1),
    reviewSessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    feedback: reviewFeedbackTextSchema,
  })
  .strict()
  .openapi('ReviewFeedbackBody');

export type ReviewFeedbackBody = z.infer<typeof reviewFeedbackBodySchema>;

/** HTTP 200 response: submission accepted/pending or idempotent duplicate. */
export const reviewFeedbackResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    reviewSessionId: z.string().uuid(),
    status: z.enum(['accepted', 'claimed', 'processed', 'superseded', 'failed']),
    submittedAt: z.string(),
  })
  .openapi('ReviewFeedbackResponse');

// ---------------------------------------------------------------------------
// POST /api/workflows/runs/:runId/nodes/:nodeId/send (steering contract, #181)
// ---------------------------------------------------------------------------

/**
 * Request body for operator steering guidance.
 *
 * `message` is refined for non-blank content but NEVER transformed — the
 * operator's original characters (leading/trailing whitespace included) are
 * queued verbatim. `message_id` is the caller-stamped correlation key for
 * idempotent replay and terminal reconciliation. `intent: 'send_now'` is
 * already public; until an idle-after-interrupt state exists it queues
 * identically to `queue`.
 */
export const sendWorkflowNodeBodySchema = z
  .object({
    message: z.string().refine(value => value.trim().length > 0, {
      message: 'must not be blank',
    }),
    message_id: z.string().uuid(),
    intent: z.enum(['queue', 'send_now']),
  })
  .strict()
  .openapi('SendWorkflowNodeBody');

export type SendWorkflowNodeBody = z.infer<typeof sendWorkflowNodeBodySchema>;

/**
 * Send success receipt. `queued` — accepted onto the registry queue to drain
 * at the next natural provider-turn boundary; `awaiting_send_now` — accepted
 * into an idle-after-interrupt node's queue awaiting Send now.
 */
export const sendWorkflowNodeResponseSchema = z
  .object({
    success: z.literal(true),
    message_id: z.string().uuid(),
    state: z.enum(['queued', 'awaiting_send_now']),
  })
  .strict()
  .openapi('SendWorkflowNodeResponse');

export type SendWorkflowNodeResponse = z.infer<typeof sendWorkflowNodeResponseSchema>;

/**
 * Shared steering-route error shape — consumers classify by `error.code`,
 * never by prose.
 */
export const steeringErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict()
  .openapi('SteeringError');

export type SteeringError = z.infer<typeof steeringErrorSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId (steering)
// ---------------------------------------------------------------------------

/**
 * Path params for the withdraw route. `messageId` carries the same UUID
 * validator as send's `message_id` — the caller-stamped correlation key.
 */
export const withdrawWorkflowNodeParamsSchema = z
  .object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
    messageId: z.string().uuid(),
  })
  .strict();

/**
 * Withdraw success receipt. Identical for a removed, already-drained, or
 * never-seen id — the wire never reveals the drain-race winner.
 */
export const withdrawWorkflowNodeResponseSchema = z
  .object({
    success: z.literal(true),
    message_id: z.string().uuid(),
  })
  .strict()
  .openapi('WithdrawWorkflowNodeResponse');

export type WithdrawWorkflowNodeResponse = z.infer<typeof withdrawWorkflowNodeResponseSchema>;
