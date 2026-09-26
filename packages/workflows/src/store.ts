/**
 * IWorkflowStore - trait interface for workflow database operations.
 *
 * Mirrors the IIsolationStore pattern from @archon/isolation.
 * Implementations live in @archon/core (backed by the real DB);
 * the workflow engine depends only on this narrow interface.
 */
import type {
  WorkflowRun,
  WorkflowRunStatus,
  ApprovalContext,
  WorkflowNodeSession,
  EnvOverlaySnapshot,
  ReviewFeedbackSubmission,
} from './schemas';
import type { AppendNodeMessageInput, NodeMessage } from './schemas/node-message';
import type {
  InsertPendingInteractionInput,
  PendingInteraction,
  ResolvePendingInteractionInput,
  ResolvePendingInteractionResult,
} from './schemas/pending-interaction';
import type {
  ClaimedSteeringMessage,
  EnqueueSteeringMessageInput,
  EnqueueSteeringMessageResult,
  SteeringDraft,
  SteeringDraftKey,
  SteeringNodeSettings,
  SteeringQueueEntry,
  UpsertSteeringDraftInput,
  UpsertSteeringNodeSettingsInput,
} from './schemas/steering';

export interface PersistRouteDecisionTransitionInput {
  workflow_run_id: string;
  expected_execution_seq: number;
  metadata: Record<string, unknown>;
  event: {
    step_name: string;
    data: Record<string, unknown>;
    step_index?: number;
  };
  completed_event: {
    step_name: string;
    data: Record<string, unknown>;
    step_index?: number;
  };
}

export type { WorkflowNodeSession } from './schemas';

export interface DagResumeSnapshot {
  completedNodeOutputs: Map<string, string>;
  tokens: {
    input: number;
    output: number;
  };
}

/** Composite primary key identifying a single persisted node session row. */
export interface WorkflowNodeSessionKey {
  workflow_name: string;
  node_id: string;
  scope_key: string;
  provider: string;
}

export interface WorkflowNodeCheckpoint {
  workflow_run_id: string;
  node_id: string;
  retry_epoch: number;
  checkpoint_ref: string;
  commit_sha: string;
  created_commit: boolean;
  fallback_from_node_id: string | null;
  created_at: Date | string;
}

export type WorkflowNodeCheckpointInput = Omit<WorkflowNodeCheckpoint, 'created_at'>;

export interface LatestWorkflowNodeCheckpointQuery {
  workflow_run_id: string;
  node_id: string;
  retry_epoch?: number;
}

/**
 * One row of git evidence bracketing a single node execution attempt. A node
 * can execute more than once within a run (a loop body, a reactivated route
 * target, a retried node) — each attempt gets its own row rather than sharing
 * a key, so no attempt's evidence is ever overwritten by another.
 */
export interface WorkflowNodeExecutionEvidence {
  id: string;
  workflow_run_id: string;
  node_id: string;
  retry_epoch: number;
  start_checkpoint_ref: string;
  start_commit_sha: string;
  started_at: Date | string;
  end_checkpoint_ref: string | null;
  end_commit_sha: string | null;
  ended_at: Date | string | null;
}

/**
 * `id` is minted by the caller (not the database) because it is also used to
 * namespace the start/end git refs, which must exist before the database row
 * does.
 */
export type WorkflowNodeExecutionEvidenceStartInput = Omit<
  WorkflowNodeExecutionEvidence,
  'started_at' | 'end_checkpoint_ref' | 'end_commit_sha' | 'ended_at'
>;

export interface WorkflowNodeExecutionEvidenceEndInput {
  id: string;
  end_checkpoint_ref: string;
  end_commit_sha: string;
}

export interface WorkflowRetryContext {
  targetNodeId: string;
  retryEpoch: number;
  invalidatedNodeIds: readonly string[];
}

export const WORKFLOW_EVENT_TYPES = [
  'workflow_started',
  'workflow_completed',
  'workflow_failed',
  // #2348 — written by the resume CAS ONLY when it clears a non-empty
  // `metadata.error`, carrying that error in `data.error`. It is the audit
  // record for a failure that resume would otherwise erase (the CLI's SIGTERM
  // handler records a failure in metadata and nowhere else), NOT a general
  // "a resume happened" marker: its absence never means the run wasn't resumed.
  'workflow_resumed',
  'node_started',
  'node_completed',
  'node_failed',
  'node_skipped',
  'node_skipped_prior_success',
  'node_always_run_reset',
  'node_routed',
  'loop_iteration_started',
  'loop_iteration_completed',
  'loop_iteration_failed',
  'tool_called',
  'tool_completed',
  'ralph_story_started',
  'ralph_story_completed',
  'approval_requested',
  'approval_received',
  'workflow_cancelled',
  'workflow_artifact',
  'node_session_resumed',
  'node_retry_requested',
  'node_retry_reset',
  'node_retry_failed',
  // Phase 2 of #975 — subagent task lifecycle (aggregated from provider
  // task_started / task_progress / task_notification chunks). Stored
  // alongside other workflow_events for the timeline view; the SSE bridge
  // fans out task_activity / hook_activity to live Web UI subscribers.
  'task_activity',
  'hook_activity',
  // Container isolation backend lifecycle (folder-project container runs).
  // `container_created`/`container_destroyed` bracket the run; `container_stopped`/
  // `container_resumed` bracket a suspend/resume across a pause (Phase C).
  'container_created',
  'container_stopped',
  'container_resumed',
  'container_destroyed',
  // Container write-back gate (Phase C): the finished run's overlay diff is
  // requested (paused for approval), then applied to / discarded from the live root.
  'writeback_requested',
  'writeback_applied',
  'writeback_discarded',
  // Evidence gate (#2230): `evidence_policy.required` was set but
  // `$ARTIFACTS_DIR/evidence.json` was absent at completion time — the run was
  // refused terminal `completed` and marked failed. Data carries the expected path.
  'evidence_validation_failed',
  // #2213 — keys the engine dropped from this run's workflow YAML. Written by the
  // executor at run start for EVERY run that has them, whatever surface started
  // it, so the record does not depend on a chat/console notification being
  // deliverable. `data.warnings` is the message list. Absence means the YAML was
  // clean OR the run predates this event type — never that delivery failed.
  'workflow_parse_warnings',
  // Per AI stream-pass usage observation (#node-cost-tracking). Append-only
  // internal audit event; not mapped to external outbox or dashboard SSE sources.
  // Payload schema: packages/workflows/src/schemas/usage-breakdown.ts.
  'node_usage_recorded',
  // AskHuman pause (Story 6.2). `interaction_resolved` is reserved for Story 6.3;
  // do not map it to SSE in this story.
  'node_awaiting',
  'interaction_resolved',
  // Inline review-feedback submission audit receipt. Written inside the submit
  // transaction so the event is atomic with the metadata update. NOT an approval
  // event — the receipt must not be misread by old UI as a gate resolution.
  'review_feedback',
] as const;

export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];

export interface ApprovalGateIdentity {
  nodeId: string;
  gateId?: string;
}

/** Exact identity required to resume a resolved Plannotator gate. */
export interface PlannotatorGateIdentity {
  nodeId: string;
  gateId: string;
}

/** Audit event committed in the same transaction as a winning gate resolution. */
export interface GateResolutionEvent {
  event_type: WorkflowEventType;
  step_name: string;
  data: Record<string, unknown>;
}

export interface PlannotatorGateTransitionInput {
  runId: string;
  nodeId: string;
  expectedGateId: string;
  nextGateId?: string;
  document: string;
  phase: NonNullable<ApprovalContext['phase']>;
  reviewUrl?: string | null;
}

export type PlannotatorGateTransitionResult =
  | { outcome: 'updated'; approval: ApprovalContext }
  | { outcome: 'resolved'; resolved: 'approved' | 'rejected' }
  | { outcome: 'superseded' }
  | { outcome: 'stopped'; status: WorkflowRunStatus };

/**
 * Run-tree navigation (#2121 Phase 2) — a narrow, distinct concern (walking the
 * `parent_run_id` graph) kept out of the fat `IWorkflowStore` per the project's ISP
 * rule. `IWorkflowStore` extends it so existing consumers don't churn, but a caller
 * that only needs run-tree reads can depend on this alone.
 */
export interface IRunTreeStore {
  /**
   * Find every run whose `parent_run_id` is `parentRunId`. Used by a `workflow:`
   * node's re-entry logic to locate its child (filtered further by
   * `metadata.parent_node_id`) and by the abandon cascade to cancel children.
   */
  findChildRuns(parentRunId: string): Promise<WorkflowRun[]>;
  /**
   * Walk the `parent_run_id` chain from `runId` UP to the root, returning the
   * ancestors (nearest parent first), depth-capped. Used by the runtime cycle
   * guard (reject a child whose target name is already an ancestor) and to build
   * the path-lock exclusion set.
   */
  getRunAncestry(runId: string): Promise<WorkflowRun[]>;
}

/**
 * Narrow run-owned ENV overlay persistence. Inherited by `IWorkflowStore` so the
 * engine dependency object stays one seam, without treating overlay writes as a
 * generic metadata merge API (SQLite `json_patch` deep-merges nested objects).
 */
export interface IWorkflowEnvOverlayStore {
  /**
   * Atomically replace `metadata.envOverlay` with `snapshot` and return the
   * complete run row. Sibling metadata keys are preserved; nested overlay keys
   * are not deep-merged. Throws when the run id is missing.
   */
  setWorkflowRunEnvOverlay(runId: string, snapshot: EnvOverlaySnapshot): Promise<WorkflowRun>;
}

/**
 * Immutable per-node transcript persistence. Inherited by `IWorkflowStore` so
 * the engine dependency object stays one seam; callers that only append or
 * list transcript rows can depend on this capability alone.
 */
export interface IWorkflowNodeMessageStore {
  appendNodeMessage(input: AppendNodeMessageInput): Promise<NodeMessage>;
  listNodeMessages(workflowRunId: string, nodeId: string): Promise<NodeMessage[]>;
}

/**
 * Pending AskHuman / permission row persistence. Inherited by `IWorkflowStore`
 * so the engine dependency object stays one seam; callers that only insert,
 * list, or resolve pending rows can depend on this capability alone.
 */
export interface IWorkflowPendingInteractionStore {
  insertPendingInteraction(input: InsertPendingInteractionInput): Promise<PendingInteraction>;
  listPendingInteractions(workflowRunId: string): Promise<PendingInteraction[]>;
  resolvePendingInteraction(
    input: ResolvePendingInteractionInput
  ): Promise<ResolvePendingInteractionResult>;
}

/**
 * Durable steering persistence: drafts, the node guidance queue, and per-node
 * settings. Inherited by `IWorkflowStore` so the engine dependency object
 * stays one seam. This is the control plane only — the live provider turn
 * handle and its per-turn interrupt controller stay in the volatile
 * `SteeringRegistry` and are never persisted through this interface.
 */
export interface IWorkflowSteeringStore {
  getSteeringDraft(key: SteeringDraftKey): Promise<SteeringDraft | null>;
  upsertSteeringDraft(input: UpsertSteeringDraftInput): Promise<SteeringDraft>;
  clearSteeringDraft(key: SteeringDraftKey): Promise<void>;

  getSteeringNodeSettings(
    workflowRunId: string,
    nodeId: string
  ): Promise<SteeringNodeSettings | null>;
  /** Partial merge — only the fields present on `input` change. */
  upsertSteeringNodeSettings(input: UpsertSteeringNodeSettingsInput): Promise<SteeringNodeSettings>;

  /**
   * Insert a queue entry with a transactionally assigned FIFO position.
   * Idempotent on `message_id`: a repeat returns the existing row with
   * `duplicate: true` instead of inserting a second entry.
   */
  enqueueSteeringMessage(input: EnqueueSteeringMessageInput): Promise<EnqueueSteeringMessageResult>;
  /** Idempotent: removes a still-claimable entry; a no-op otherwise. */
  withdrawSteeringMessage(
    workflowRunId: string,
    nodeId: string,
    messageId: string
  ): Promise<{ removed: boolean }>;
  /** Every visible entry (everything but `withdrawn`) in FIFO order. */
  listSteeringQueue(workflowRunId: string, nodeId: string): Promise<SteeringQueueEntry[]>;

  /**
   * Atomically claim up to `limit` of the oldest claimable entries for the
   * next provider turn, transitioning them to `dispatching`. `'all'` claims
   * every claimable entry (the default natural-boundary continuation);
   * a number claims at most that many (auto-send claims exactly one).
   */
  claimSteeringQueue(
    workflowRunId: string,
    nodeId: string,
    limit: number | 'all'
  ): Promise<ClaimedSteeringMessage[]>;
  /** `dispatching` -> `sent`, once a transcript receipt exists for these ids. */
  markSteeringMessagesSent(
    workflowRunId: string,
    nodeId: string,
    messageIds: readonly string[]
  ): Promise<void>;
  /**
   * Claim exactly one still-queued entry by id for soft injection into the
   * active turn (moves it straight to `sent`, skipping `dispatching` — there
   * is no follow-up provider turn to await). Returns `null` when the id is
   * not currently claimable.
   */
  claimSteeringMessageForSoftInjection(
    workflowRunId: string,
    nodeId: string,
    messageId: string
  ): Promise<ClaimedSteeringMessage | null>;
  /**
   * Terminal reconciliation: every entry still in `queued`, `awaiting_send_now`,
   * or `dispatching` becomes `never_sent`. Idempotent — a second call finds
   * nothing left to convert.
   */
  reconcileNeverSentSteeringMessages(
    workflowRunId: string,
    nodeId: string
  ): Promise<{ count: number }>;
}

export interface IWorkflowStore
  extends
    IRunTreeStore,
    IWorkflowEnvOverlayStore,
    IWorkflowNodeMessageStore,
    IWorkflowPendingInteractionStore,
    IWorkflowSteeringStore {
  // Run lifecycle
  createWorkflowRun(data: {
    workflow_name: string;
    conversation_id: string;
    codebase_id?: string;
    user_message: string;
    metadata?: Record<string, unknown>;
    working_path?: string;
    parent_conversation_id?: string;
    /** Archon user UUID; populated via ExecuteWorkflowOptions.userId. */
    user_id?: string;
    /**
     * Run-tree parent (#2121 Phase 2). Set for a `workflow:` sub-run so its row
     * links back to the spawning parent run; omitted for top-level runs.
     */
    parent_run_id?: string;
  }): Promise<WorkflowRun>;
  getWorkflowRun(id: string): Promise<WorkflowRun | null>;
  /**
   * Find the workflow run currently holding the lock on `workingPath`.
   *
   * Pass `self` from the calling dispatch so:
   *   1. Self is never returned (excluded by `id != self.id`).
   *   2. Two near-simultaneous dispatches deterministically agree on which
   *      is "first" via the `(started_at, id)` tiebreaker — newer aborts.
   *
   * `id` and `startedAt` must travel together — the tiebreaker requires
   * both. Bundling them as a single optional struct makes the
   * paired-or-nothing invariant structural rather than a doc-only contract.
   *
   * Stale `pending` rows (older than ~5 minutes) are treated as orphaned
   * and ignored, so leaks from crashed dispatches don't permanently block
   * a path.
   *
   * `excludeRunIds` additionally drops those run ids from the active set. A
   * `workflow:` sub-run shares its parent's checkout (#2121 Phase 2), so the
   * child's path-lock must exclude its ancestor chain — otherwise the child
   * self-blocks against the parent's own `running`/`paused` row on that path.
   */
  getActiveWorkflowRunByPath(
    workingPath: string,
    self?: { id: string; startedAt: Date; excludeRunIds?: string[] }
  ): Promise<WorkflowRun | null>;
  findResumableRun(workflowName: string, workingPath: string): Promise<WorkflowRun | null>;
  failOrphanedRuns(): Promise<{ count: number }>;
  resumeWorkflowRun(id: string): Promise<WorkflowRun>;
  resumeApprovedGate(id: string, expected: PlannotatorGateIdentity): Promise<{ resumed: boolean }>;
  /**
   * `output_root` (#2200) is write-once: the executor sets it at run start only
   * when the persisted value is null. Re-writing it on resume would re-derive
   * the path from a possibly-renamed codebase and orphan the run's artifacts,
   * defeating the whole point of persisting it.
   */
  updateWorkflowRun(
    id: string,
    updates: Partial<Pick<WorkflowRun, 'status' | 'metadata' | 'output_root'>>
  ): Promise<void>;
  resolveApprovalGate(
    id: string,
    expected: ApprovalGateIdentity,
    metadata: Record<string, unknown>,
    events: GateResolutionEvent[]
  ): Promise<{ resolved: boolean }>;
  transitionPlannotatorGate(
    input: PlannotatorGateTransitionInput
  ): Promise<PlannotatorGateTransitionResult>;
  persistRouteDecisionTransition(input: PersistRouteDecisionTransitionInput): Promise<WorkflowRun>;
  updateWorkflowActivity(id: string): Promise<void>;
  getWorkflowRunStatus(id: string): Promise<WorkflowRunStatus | null>;
  completeWorkflowRun(id: string, metadata?: Record<string, unknown>): Promise<void>;
  failWorkflowRun(id: string, error: string): Promise<void>;
  /**
   * Pause a running run. When `approvalContext` is provided, stamp it (and optional
   * `extraMetadata`) into metadata in the SAME atomic write so there is never a
   * paused-without-marker window. When omitted (Ask pause), set status to paused
   * without touching metadata; already-paused is idempotent success.
   */
  pauseWorkflowRun(
    id: string,
    approvalContext?: ApprovalContext,
    extraMetadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Atomically CLAIM the container write-back apply before the live root is mutated
   * (retry-safe apply). Sets `metadata.writeback_apply_claimed` only while unset;
   * returns whether THIS caller won. Apply the overlay only when `claimed`.
   */
  claimWriteback(id: string): Promise<{ claimed: boolean }>;

  /**
   * Release a claimed write-back apply after the apply FAILED, so a later resume can
   * re-claim and retry. Best-effort (never throws in the caller's critical path).
   */
  releaseWritebackClaim(id: string): Promise<void>;

  /**
   * Submit inline review feedback for a plannotator_gate in `waiting_decision`
   * phase. Runs under the run lock; validates gate, session, and phase before
   * writing. Idempotent by requestId: an identical retry returns the existing
   * receipt; a changed-body retry returns conflict (409). Throws on unexpected
   * DB errors.
   */
  submitReviewFeedback(input: {
    runId: string;
    nodeId: string;
    gateId: string;
    reviewSessionId: string;
    requestId: string;
    feedback: string;
  }): Promise<
    | { outcome: 'accepted'; receipt: ReviewFeedbackSubmission }
    | { outcome: 'duplicate'; receipt: ReviewFeedbackSubmission }
    | { outcome: 'conflict'; reason: string }
    | { outcome: 'rejected'; reason: string; statusCode: number }
  >;

  /**
   * Atomically claim the current gate decision so only one source (inline or
   * native) can proceed. Uses the run lock; returns `{ claimed: true }` if this
   * caller won, `{ claimed: false }` if another source already claimed. Must be
   * called before mutating gate state on either path (native approval/annotation
   * or inline feedback rework).
   */
  claimGateDecision(input: {
    runId: string;
    nodeId: string;
    gateId: string;
    reviewSessionId: string;
    source: 'inline' | 'native';
    requestId?: string;
  }): Promise<{ claimed: boolean; receipt?: ReviewFeedbackSubmission }>;
  cancelWorkflowRun(id: string): Promise<{ cancelled: boolean }>;

  /**
   * Create a workflow event. Implementations MUST NOT throw — catch all errors
   * internally and log them. Callers treat this as observable-only: workflow
   * execution continues regardless of whether event persistence succeeds.
   */
  createWorkflowEvent(data: {
    workflow_run_id: string;
    event_type: WorkflowEventType;
    step_index?: number;
    step_name?: string;
    data?: Record<string, unknown>;
  }): Promise<void>;

  /**
   * Enqueue an external workflow event. Implementations MUST NOT throw — catch
   * all errors internally and log them. The workflow engine passes only primitive
   * data; codebase, binding, and routability resolution belong to the store
   * implementation.
   */
  enqueueExternalWorkflowEvent(data: {
    workflow_run_id: string;
    event_type: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  }): Promise<void>;

  /**
   * Return completed node outputs and cumulative token usage from a prior DAG
   * workflow run. Used for resume hydration so completed nodes are skipped and
   * the run-level token tally includes every execution of the run.
   *
   * Throws on DB error — caller (executor.ts) owns the degradation policy.
   */
  getDagResumeSnapshot(workflowRunId: string): Promise<DagResumeSnapshot>;

  /**
   * Persist a pre-node git checkpoint. Optional until checkpoint writing is
   * enabled by DAG execution; core's real store adapter implements it now.
   */
  upsertWorkflowNodeCheckpoint?(data: WorkflowNodeCheckpointInput): Promise<WorkflowNodeCheckpoint>;
  getLatestWorkflowNodeCheckpoint?(
    query: LatestWorkflowNodeCheckpointQuery
  ): Promise<WorkflowNodeCheckpoint | null>;

  /**
   * Record the start of one node execution's git evidence. Optional, mirroring
   * the checkpoint methods above; core's real store adapter implements it now.
   * Returns the generated row id, later passed to
   * `completeWorkflowNodeExecutionEvidence` to fill in end evidence.
   */
  startWorkflowNodeExecutionEvidence?(
    data: WorkflowNodeExecutionEvidenceStartInput
  ): Promise<WorkflowNodeExecutionEvidence>;
  completeWorkflowNodeExecutionEvidence?(
    data: WorkflowNodeExecutionEvidenceEndInput
  ): Promise<void>;

  // Per-codebase env vars for workflow node injection
  getCodebaseEnvVars(codebaseId: string): Promise<Record<string, string>>;

  // Codebase lookup (for path resolution)
  getCodebase(id: string): Promise<{
    id: string;
    name: string;
    repository_url: string | null;
    default_cwd: string;
    /** Project kind — 'folder' routes path resolution to _folder/<slug>/ storage. */
    kind: 'repo' | 'folder';
  } | null>;

  // Per-node provider sessions persisted across workflow re-runs (opt-in via
  // `persist_session: true` on a node, or `persist_sessions: true` at workflow root).
  // Distinct from `AgentRequestOptions.persistSession` (Claude SDK on-disk transcript).
  getWorkflowNodeSession(key: WorkflowNodeSessionKey): Promise<WorkflowNodeSession | null>;
  upsertWorkflowNodeSession(
    params: WorkflowNodeSessionKey & {
      provider_session_id: string;
      last_run_id: string | null;
    }
  ): Promise<void>;
  deleteWorkflowNodeSessions(filter: {
    workflow_name: string;
    scope_key?: string;
    node_id?: string;
    /**
     * Optional provider filter. The executor's stale-row cleanup (run finished with
     * no sessionId) sets this so switching providers between runs doesn't clobber
     * the prior provider's saved row. Reset surfaces (CLI/chat/REST) leave it
     * undefined so a reset wipes every provider for the given scope.
     */
    provider?: string;
  }): Promise<{ deleted: number }>;
}
