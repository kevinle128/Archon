/**
 * Frontend-specific types for the Archon Web UI.
 * SSE event types match what the Web adapter emits.
 */

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';
export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting';
export type ArtifactType = 'pr' | 'commit' | 'file_created' | 'file_modified' | 'branch';
export type RuntimeModelReasoningEffort = string;
export type RuntimeEffortLevel = string;

export type RuntimeThinkingMetadata =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' };

export interface RuntimeNodeMetadata {
  provider?: string;
  model?: string;
  tier?: string;
  modelReasoningEffort?: RuntimeModelReasoningEffort;
  effort?: RuntimeEffortLevel;
  thinking?: RuntimeThinkingMetadata;
}

/**
 * Framework category the server attaches to a message it emitted itself (as
 * opposed to the agent's own prose). Mirrors `MessageMetadata['category']` in
 * `@archon/core` — `@archon/web` is a client package and cannot import from a
 * server package, so the union is restated here.
 *
 * An unrecognized value is a wider server, not an error: TypeScript does not
 * narrow at runtime, and every consumer asks a predicate ("is this a workflow
 * status?") rather than switching exhaustively, so a new category degrades to
 * ordinary prose.
 */
export type MessageCategory =
  | 'tool_call_formatted'
  | 'workflow_status'
  | 'workflow_dispatch_status'
  | 'isolation_context'
  | 'workflow_result';

// Base SSE event
interface BaseSSEEvent {
  type: string;
  timestamp: number;
}

// Text streaming
export interface TextEvent extends BaseSSEEvent {
  type: 'text';
  content: string;
  isComplete: boolean;
  /** Present only on server-emitted framework messages; absent for agent prose. */
  category?: MessageCategory;
  /** Present only on `workflow_result` messages — identifies the finished run. */
  workflowResult?: { workflowName: string; runId: string };
}

/**
 * The non-text fields of a `text` SSE event, as handed to an `onText` handler.
 * `useSSE` batches text over a 50 ms window, so this describes the flushed
 * segment rather than any single event.
 */
export type TextEventMeta = Pick<TextEvent, 'category' | 'workflowResult'>;

// Tool call started
export interface ToolCallEvent extends BaseSSEEvent {
  type: 'tool_call';
  toolCallId?: string;
  name: string;
  input: Record<string, unknown>;
}

// Tool call completed
export interface ToolResultEvent extends BaseSSEEvent {
  type: 'tool_result';
  toolCallId?: string;
  name: string;
  output: string;
  duration: number;
  /** Provider-reported outcome. Absent when the provider reports none. */
  outcome?: ChatToolResultOutcome;
  exitCode?: number;
}

export type ChatToolResultOutcome = 'success' | 'error' | 'interrupted' | 'unknown';

// Session metadata
export interface SessionInfoEvent extends BaseSSEEvent {
  type: 'session_info';
  sessionId: string;
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
}

// Conversation lock status
export interface ConversationLockEvent extends BaseSSEEvent {
  type: 'conversation_lock';
  conversationId: string;
  locked: boolean;
  queuePosition?: number;
}

// Error with classification
export interface ErrorEvent extends BaseSSEEvent {
  type: 'error';
  message: string;
  classification?: 'transient' | 'fatal';
  suggestedActions?: string[];
}

// Warning (non-fatal, informational)
export interface WarningEvent extends BaseSSEEvent {
  type: 'warning';
  message: string;
}

// Keep-alive
export interface HeartbeatEvent extends BaseSSEEvent {
  type: 'heartbeat';
}

/** SSE events only carry active run statuses — 'pending' is excluded because
 *  the server never emits a status event for a run that hasn't started yet. */
export type ActiveWorkflowRunStatus = Exclude<WorkflowRunStatus, 'pending'>;

// Workflow run status
export interface WorkflowStatusEvent extends BaseSSEEvent {
  type: 'workflow_status';
  runId: string;
  workflowName: string;
  status: ActiveWorkflowRunStatus;
  error?: string;
  approval?: { nodeId: string; message: string };
}

// Loop iteration info (per-iteration state stored in DagNodeState)
export interface LoopIterationInfo {
  iteration: number;
  status: 'running' | 'completed' | 'failed';
  duration?: number;
}

// Loop iteration SSE event (emitted as 'workflow_step' by the bridge)
export interface LoopIterationEvent extends BaseSSEEvent {
  type: 'workflow_step';
  runId: string;
  nodeId?: string;
  step: number;
  total: number;
  name: string;
  status: 'running' | 'completed' | 'failed';
  iteration: number;
  duration?: number;
}

export type RouteLoopOutcome = 'positive' | 'negative' | 'exhausted';

export interface RouteLoopDecisionData extends Record<string, unknown> {
  sources: string[];
  outcome: RouteLoopOutcome;
  to: string;
  condition: string;
  condition_result: boolean;
  negative_count: number;
  max_iterations: number;
  attempt: number;
  execution_seq: number;
}

// DAG node status (emitted during DAG workflow execution)
export interface DagNodeEvent extends BaseSSEEvent {
  type: 'dag_node';
  runId: string;
  nodeId: string;
  name: string;
  status: WorkflowStepStatus;
  duration?: number;
  error?: string;
  reason?: 'when_condition' | 'trigger_rule';
  routeDecision?: RouteLoopDecisionData | Record<string, unknown>;
  provider?: string;
  model?: string;
  tier?: string;
  modelReasoningEffort?: RuntimeModelReasoningEffort;
  effort?: RuntimeEffortLevel;
  thinking?: RuntimeThinkingMetadata;
  /** Bounded display-only loop-progress projection (on node_completed): sets the
   *  target loop node's expected iteration total. Never affects control flow. */
  loopProgress?: { targetNodeId: string; expectedIterations: number };
}

// Workflow tool activity (tool_started / tool_completed from executor)
export interface WorkflowToolActivityEvent extends BaseSSEEvent {
  type: 'workflow_tool_activity';
  runId: string;
  toolName: string;
  stepName: string;
  status: 'started' | 'completed';
  durationMs?: number;
}

export interface WorkflowTaskUsage {
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
}

export type WorkflowTaskActivity = 'started' | 'progress' | 'completed' | 'failed' | 'stopped';

// Subagent task activity emitted by workflow DAG execution.
export interface WorkflowTaskActivityEvent extends BaseSSEEvent {
  type: 'workflow_task_activity';
  runId: string;
  nodeId: string;
  taskId: string;
  activity: WorkflowTaskActivity;
  description?: string;
  summary?: string;
  usage?: WorkflowTaskUsage;
  lastToolName?: string;
  taskType?: string;
}

export type WorkflowHookActivity = 'started' | 'response';
export type WorkflowHookOutcome = 'success' | 'error' | 'cancelled';

// Hook callback activity emitted by workflow DAG execution.
export interface WorkflowHookActivityEvent extends BaseSSEEvent {
  type: 'workflow_hook_activity';
  runId: string;
  nodeId: string;
  hookId: string;
  hookName: string;
  hookEvent: string;
  activity: WorkflowHookActivity;
  outcome?: WorkflowHookOutcome;
  exitCode?: number;
}

// Workflow artifact
export interface WorkflowArtifactEvent extends BaseSSEEvent {
  type: 'workflow_artifact';
  runId: string;
  artifactType: ArtifactType;
  label: string;
  url?: string;
  path?: string;
}

// Background workflow dispatch
export interface WorkflowDispatchEvent extends BaseSSEEvent {
  type: 'workflow_dispatch';
  workerConversationId: string;
  workflowName: string;
}

// Background workflow output preview
export interface WorkflowOutputPreviewEvent extends BaseSSEEvent {
  type: 'workflow_output_preview';
  runId: string;
  lines: string[];
}

// Retract previously streamed text (workflow routing detected)
export interface RetractEvent extends BaseSSEEvent {
  type: 'retract';
}

// System status (e.g., workspace sync result)
export interface SystemStatusEvent extends BaseSSEEvent {
  type: 'system_status';
  content: string;
}

/**
 * Discriminated union of all SSE event types emitted by the Web adapter.
 * Parsed from JSON with no runtime validation — the server is trusted.
 */
export type SSEEvent =
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionInfoEvent
  | ConversationLockEvent
  | ErrorEvent
  | WarningEvent
  | HeartbeatEvent
  | WorkflowStatusEvent
  | DagNodeEvent
  | LoopIterationEvent
  | WorkflowToolActivityEvent
  | WorkflowTaskActivityEvent
  | WorkflowHookActivityEvent
  | WorkflowArtifactEvent
  | WorkflowDispatchEvent
  | WorkflowOutputPreviewEvent
  | RetractEvent
  | SystemStatusEvent;

// UI State types

/**
 * UI state for a single chat message. Mixes display state (isStreaming, isExpanded)
 * with persisted data (content, toolCalls). When loading from the API, display
 * fields default to their inactive states.
 */
export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallDisplay[];
  error?: ErrorDisplay;
  timestamp: number;
  isStreaming?: boolean;
  files?: FileAttachment[];
  /**
   * Category of the `text` event that opened this message. Retained so the next
   * event can test the *previous* segment's category, the same way
   * `BufferedSegment.category` works server-side in the web adapter's
   * `MessagePersistence`.
   */
  category?: MessageCategory;
  workflowDispatch?: {
    workerConversationId: string;
    workflowName: string;
  };
  workflowResult?: {
    workflowName: string;
    runId: string;
  };
}

export interface ToolCallDisplay {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  duration?: number;
  outcome?: ChatToolResultOutcome;
  exitCode?: number;
  status?: 'cancelled' | 'stopped';
  startedAt: number;
  isExpanded: boolean;
}

export interface ErrorDisplay {
  message: string;
  classification: 'transient' | 'fatal';
  suggestedActions: string[];
}

// Workflow UI State types

export interface DagTaskInfo {
  taskId: string;
  activity: WorkflowTaskActivity;
  startedAt: number;
  updatedAt: number;
  description?: string;
  summary?: string;
  usage?: WorkflowTaskUsage;
  lastToolName?: string;
  taskType?: string;
}

export interface DagHookInfo {
  hookId: string;
  hookName: string;
  hookEvent: string;
  activity: WorkflowHookActivity;
  startedAt: number;
  updatedAt: number;
  outcome?: WorkflowHookOutcome;
  exitCode?: number;
}

export interface DagNodeState {
  nodeId: string;
  name: string;
  status: WorkflowStepStatus;
  duration?: number;
  error?: string;
  reason?: 'when_condition' | 'trigger_rule';
  provider?: string;
  model?: string;
  tier?: string;
  modelReasoningEffort?: RuntimeModelReasoningEffort;
  effort?: RuntimeEffortLevel;
  thinking?: RuntimeThinkingMetadata;
  currentIteration?: number;
  maxIterations?: number;
  expectedIterations?: number;
  iterations?: LoopIterationInfo[];
  tasks?: DagTaskInfo[];
  hooks?: DagHookInfo[];
  routeDecision?: RouteLoopDecisionData | Record<string, unknown>;
}

export interface WorkflowArtifact {
  type: ArtifactType;
  label: string;
  url?: string;
  path?: string;
}

export interface WorkflowState {
  runId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  dagNodes: DagNodeState[];
  artifacts: WorkflowArtifact[];
  currentIteration?: number;
  maxIterations?: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  stale?: boolean;
  approval?: { nodeId: string; message: string };
  currentTool?: {
    name: string;
    status: 'running' | 'completed';
    durationMs?: number;
  } | null;
}
