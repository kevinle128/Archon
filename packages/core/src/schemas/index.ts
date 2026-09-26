/**
 * Core Zod schemas and derived types.
 *
 * All data-shape types are derived from schemas via `z.infer<typeof schema>`.
 * Import `z` from `@hono/zod-openapi` in all schema files (project convention).
 */

// Conversation
export { conversationRowSchema, identityPlatformSchema } from './conversation';
export type { Conversation, IdentityPlatform } from './conversation';

// Message
export { messageRowSchema } from './message';
export type { MessageRow } from './message';

// User
export { userRowSchema, userIdentityRowSchema, userRoleSchema } from './user';
export type { User, UserIdentity, UserRole } from './user';
export { userGithubTokenRowSchema } from './user-github-token-row';
export type { UserGithubTokenRow } from './user-github-token-row';
export { userAiPrefsRowSchema } from './user-ai-prefs-row';
export type { UserAiPrefsRow } from './user-ai-prefs-row';

// Codebase
export { codebaseRowSchema } from './codebase';
export type { Codebase } from './codebase';

// Session
export { sessionRowSchema, sessionMetadataSchema } from './session';
export type { Session, SessionMetadata } from './session';

// WorkflowEvent
export {
  externalWorkflowEventTypeSchema,
  workflowEventRowSchema,
  routeLoopDecisionEventDataSchema,
  nodeRetryRequestedEventDataSchema,
  nodeRetryResetEventDataSchema,
  nodeRetryFailedEventDataSchema,
} from './workflow-event';
export type {
  ExternalWorkflowEventType,
  WorkflowEventRow,
  RouteLoopDecisionEventData,
  NodeRetryRequestedEventData,
  NodeRetryResetEventData,
  NodeRetryFailedEventData,
} from './workflow-event';

// WorkflowCheckpoint
export { workflowCheckpointRowSchema } from './workflow-checkpoint';
export type { WorkflowCheckpointRow } from './workflow-checkpoint';

// EnvVar
export { codebaseEnvVarSchema } from './env-var';
export type { CodebaseEnvVar } from './env-var';

// WorkflowRun (dashboard types)
export {
  dashboardWorkflowRunSchema,
  listDashboardRunsOptionsSchema,
  dashboardRunsResultSchema,
  routeLoopRuntimeMetadataSchema,
  workflowRunMetadataSchema,
} from './workflow-run';
export type {
  DashboardWorkflowRun,
  ListDashboardRunsOptions,
  DashboardRunsResult,
  RouteLoopRuntimeMetadata,
  WorkflowRunMetadata,
} from './workflow-run';

// WorkflowProviderBinding
export {
  workflowProviderBindingSchema,
  workflowProviderBindingStateSchema,
} from './workflow-provider-binding';
export type { WorkflowProviderBinding } from './workflow-provider-binding';

// ProviderBindingTransform
export {
  JSONATA_EXPRESSION_MAX_BYTES,
  jsonataProviderBindingTransformSchema,
  providerBindingTransformSchema,
} from './provider-binding-transform';
export type { ProviderBindingTransform } from './provider-binding-transform';

// WorkflowEventOutbox
export {
  workflowEventOutboxRowSchema,
  workflowEventOutboxStatusSchema,
} from './workflow-event-outbox';
export type { WorkflowEventOutboxRow, WorkflowEventOutboxStatus } from './workflow-event-outbox';

// WorkflowEventDeliveryAttempt
export {
  workflowEventDeliveryAttemptOutcomeSchema,
  workflowEventDeliveryAttemptRowSchema,
} from './workflow-event-delivery-attempt';
export type {
  WorkflowEventDeliveryAttemptOutcome,
  WorkflowEventDeliveryAttemptRow,
} from './workflow-event-delivery-attempt';

// UsageLedger
export {
  usageLedgerKindSchema,
  usageLedgerModelSourceSchema,
  usageLedgerPricingSourceSchema,
  usageLedgerRowSchema,
} from './usage-ledger';
export type {
  UsageLedgerKind,
  UsageLedgerModelSource,
  UsageLedgerPricingSource,
  UsageLedgerRow,
} from './usage-ledger';

// WorkflowEnv
export {
  workflowEnvNameSchema,
  workflowEnvRowSchema,
  workflowEnvSummarySchema,
  workflowEnvWorkflowNameSchema,
} from './workflow-env';
export type { EnvPatches, WorkflowEnvRow, WorkflowEnvSummary } from './workflow-env';

// WorkflowNodeMessage
export { workflowNodeMessageRowSchema } from './workflow-node-message';
export type { WorkflowNodeMessageRow } from './workflow-node-message';

// PendingInteraction
export { pendingInteractionSchema, insertPendingInteractionSchema } from './pending-interaction';
export type { PendingInteraction, InsertPendingInteractionInput } from './pending-interaction';

// Durable steering (drafts, guidance queue, per-node settings)
export {
  steeringDraftSchema,
  steeringDraftKeySchema,
  upsertSteeringDraftInputSchema,
  steeringQueueEntrySchema,
  enqueueSteeringMessageInputSchema,
  enqueueSteeringMessageResultSchema,
  steeringNodeSettingsSchema,
  upsertSteeringNodeSettingsInputSchema,
  claimedSteeringMessageSchema,
  STEERING_QUEUE_STATES,
  STEERING_QUEUE_CLAIMABLE_STATES,
  STEERING_QUEUE_VISIBLE_STATES,
} from './workflow-steering';
export type {
  SteeringDraft,
  SteeringDraftKey,
  UpsertSteeringDraftInput,
  SteeringQueueEntry,
  SteeringQueueState,
  EnqueueSteeringMessageInput,
  EnqueueSteeringMessageResult,
  SteeringNodeSettings,
  UpsertSteeringNodeSettingsInput,
  ClaimedSteeringMessage,
} from './workflow-steering';

// UsageReport
export {
  usageDimensionsSchema,
  usageGroupBySchema,
  usageKindFilterSchema,
  usageLedgerCoverageSchema,
  usageMetricsSchema,
  usageReportGroupSchema,
  usageReportSchema,
  usageReportScopeSchema,
} from './usage-report';
export type {
  UsageDimensions,
  UsageGroupBy,
  UsageKindFilter,
  UsageLedgerCoverage,
  UsageMetrics,
  UsageReport,
  UsageReportGroup,
  UsageReportScope,
} from './usage-report';
