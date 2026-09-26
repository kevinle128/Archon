/**
 * Zod schemas for the workflow engine.
 *
 * All schemas are re-exported from this index.
 * Types are derived from schemas via `z.infer<typeof Schema>` (WorkflowDefinition
 * uses `Omit<z.infer<...>, 'nodes'>` because node parsing happens per-node in loader.ts).
 *
 * Import `z` from `@hono/zod-openapi` in all schema files (project convention).
 */

// Retry configuration
export { stepRetryConfigSchema } from './retry';
export type { StepRetryConfig } from './retry';

// Loop node configuration
export { loopNodeConfigSchema, loopControlSchema } from './loop';
export type { LoopNodeConfig, LoopControl } from './loop';

// Route-loop controller configuration
export {
  safeNodeIdSchema,
  routeOutcomeSchema,
  routeLoopRoutesSchema,
  routeLoopConfigSchema,
} from './route-loop';
export type { SafeNodeId, RouteOutcome, RouteLoopRoutes, RouteLoopConfig } from './route-loop';

// Hooks
export {
  workflowHookEventSchema,
  workflowHookMatcherSchema,
  workflowNodeHooksSchema,
  WORKFLOW_HOOK_EVENTS,
} from './hooks';
export type { WorkflowHookEvent, WorkflowHookMatcher, WorkflowNodeHooks } from './hooks';

// DAG node types
export {
  triggerRuleSchema,
  TRIGGER_RULES,
  dagNodeBaseSchema,
  commandNodeSchema,
  promptNodeSchema,
  bashNodeSchema,
  loopNodeSchema,
  routeLoopNodeSchema,
  loopGroupNodeSchema,
  loopGroupNodeConfigSchema,
  approvalNodeSchema,
  approvalOnRejectSchema,
  plannotatorGatePrepareConfigSchema,
  plannotatorGateConfigSchema,
  plannotatorGateNodeSchema,
  cancelNodeSchema,
  scriptNodeSchema,
  includeNodeSchema,
  workflowNodeSchema,
  fanOutConfigSchema,
  dagNodeSchema,
  INPUT_NAME_SOURCE,
  inputEnvKey,
  isCommandNode,
  isPromptNode,
  isBashNode,
  isLoopNode,
  isRouteLoopNode,
  isLoopGroupNode,
  isApprovalNode,
  isPlannotatorGateNode,
  isCancelNode,
  isScriptNode,
  isIncludeNode,
  isWorkflowNode,
  isPersistableNode,
  isTriggerRule,
  BASH_NODE_AI_FIELDS,
  SCRIPT_NODE_AI_FIELDS,
  LOOP_NODE_AI_FIELDS,
  LOOP_GROUP_NODE_AI_FIELDS,
  INCLUDE_NODE_IGNORED_FIELDS,
  WORKFLOW_NODE_IGNORED_FIELDS,
  KNOWN_DAG_NODE_KEYS,
  KNOWN_NODE_NESTED_KEYS,
  approvalConfigSchema,
  dagNodeFlatSchema,
  effortLevelSchema,
  thinkingConfigSchema,
  sandboxSettingsSchema,
  agentDefinitionSchema,
  piNodeConfigSchema,
} from './dag-node';
export type {
  TriggerRule,
  DagNodeBase,
  CommandNode,
  PromptNode,
  BashNode,
  LoopNode,
  RouteLoopNode,
  LoopGroupNode,
  LoopGroupNodeConfig,
  ApprovalNode,
  ApprovalOnReject,
  PlannotatorGatePrepareConfig,
  PlannotatorGateNode,
  PlannotatorGateConfig,
  CancelNode,
  ScriptNode,
  IncludeNode,
  WorkflowNode,
  FanOutConfig,
  DagNode,
  EffortLevel,
  ThinkingConfig,
  SandboxSettings,
  AgentDefinition,
  PiNodeConfig,
  NestedKeySpec,
} from './dag-node';

// Workflow definition
export {
  modelReasoningEffortSchema,
  webSearchModeSchema,
  workflowRequirementSchema,
  workflowEvidencePolicySchema,
  workflowInputSpecSchema,
  workflowBaseSchema,
  workflowDefinitionSchema,
  KNOWN_WORKFLOW_KEYS,
  KNOWN_WORKFLOW_NESTED_KEYS,
  WORKFLOW_ONLY_KEYS,
} from './workflow';
export type {
  ModelReasoningEffort,
  WebSearchMode,
  WorkflowRequirement,
  WorkflowEvidencePolicy,
  WorkflowInputSpec,
  WorkflowBase,
  WorkflowDefinition,
} from './workflow';

// Workflow run state
export {
  workflowRunStatusSchema,
  workflowStepStatusSchema,
  nodeStateSchema,
  nodeOutputSchema,
  routeLoopMetadataOutcomeSchema,
  routeActivationSchema,
  routeLoopRuntimeMetadataSchema,
  workflowRunMetadataSchema,
  workflowRunSchema,
  artifactTypeSchema,
  TERMINAL_WORKFLOW_STATUSES,
  RESUMABLE_WORKFLOW_STATUSES,
  RETRYABLE_WORKFLOW_STATUSES,
  isApprovalContext,
  isRunBlockedOnChild,
  SUBRUN_METADATA_KEYS,
  readSubrunMetadata,
  reviewFeedbackReceiptStatusSchema,
  reviewFeedbackSubmissionSchema,
  reviewFeedbackTextSchema,
} from './workflow-run';
export type {
  WorkflowRunStatus,
  WorkflowStepStatus,
  NodeState,
  NodeOutput,
  RouteLoopMetadataOutcome,
  RouteActivation,
  RouteLoopRuntimeMetadata,
  WorkflowRunMetadata,
  WorkflowRun,
  ArtifactType,
  ApprovalContext,
  LoopGateRunMetadata,
  ReviewFeedbackReceiptStatus,
  ReviewFeedbackSubmission,
} from './workflow-run';

// Per-node persisted provider sessions
export { workflowNodeSessionSchema } from './workflow-node-session';
export type { WorkflowNodeSession } from './workflow-node-session';

// Node typed-output artifacts (output_type metadata)
export { nodeArtifactSchema } from './node-artifact';
export type { NodeArtifact } from './node-artifact';

// Workflow ENV overlay (invocation/storage patches)
export {
  ENV_OVERLAY_MAX_TARGETS,
  ENV_OVERLAY_MAX_BYTES,
  ENV_OVERLAY_PATCH_FIELDS,
  envPatchTargetKeySchema,
  envNodePatchSchema,
  envPatchesSchema,
  nodeExecutionMetadataSchema,
  envOverlayCandidateSchema,
  appliedEnvOverlaySchema,
  envOverlaySnapshotSchema,
  storedEnvOverlaySchema,
} from './env-overlay';
export type {
  EnvOverlayPatchField,
  EnvPatchTargetKey,
  EnvNodePatch,
  EnvPatches,
  NodeExecutionMetadata,
  EnvOverlayCandidate,
  AppliedEnvOverlay,
  EnvOverlaySnapshot,
  StoredEnvOverlay,
} from './env-overlay';

// Provider usage breakdown + node_usage_recorded event payload
export {
  modelSourceSchema,
  modelUsageEntrySchema,
  usageBreakdownSchema,
  modelUsageEntryPersistedSchema,
  nodeUsageRecordedEventDataSchema,
  toPersistedUsageEntry,
  buildNodeUsageRecordedEventData,
  validateProviderUsageAtBoundary,
} from './usage-breakdown';
export type {
  ModelSource,
  ModelUsageEntry,
  UsageBreakdown,
  ModelUsageEntryPersisted,
  NodeUsageRecordedEventData,
  BuildNodeUsageRecordedEventDataInput,
  UsageEntryRejection,
  ValidateProviderUsageResult,
} from './usage-breakdown';

// Result types (non-schema hand-written types)
export type {
  LoadCommandResult,
  WorkflowExecutionResult,
  WorkflowLoadError,
  WorkflowLoadResult,
  WorkflowSource,
  WorkflowWithSource,
  DeclaredWorkflowConfig,
} from './workflow';

// DagWorkflow — alias kept for backward compatibility
export type { WorkflowDefinition as DagWorkflow } from './workflow';

// Per-node transcript rows + pending-interaction embed contract
export * from './node-message';
export * from './node-execution';
export * from './pending-interaction';

// Durable steering records (drafts, guidance queue, per-node settings)
export * from './steering';
