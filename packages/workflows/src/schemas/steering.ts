/**
 * Durable steering records: composer drafts, the node guidance queue, and
 * per-node steering settings (auto-send, resolved provider id).
 *
 * These are the durable control plane. The volatile execution plane (the live
 * provider turn handle and its per-turn interrupt controller) stays in
 * `steering-registry.ts` and is never persisted here.
 *
 * Types are derived with `z.infer`. Import `z` from `@hono/zod-openapi`.
 */
import { z } from '@hono/zod-openapi';

/**
 * Delivery state for one durable queue entry. Open-ended by design (engine
 * integration lists "at least" these outcomes), so the set is enforced here
 * in application code rather than a database CHECK constraint — extending it
 * is a code change, not a migration.
 *
 * - `queued` / `awaiting_send_now` — accepted, not yet claimed. The two
 *   differ only in which sub-state accepted them (generating vs
 *   idle-after-interrupt); both are equally eligible for claim.
 * - `dispatching` — claimed by the executor for the next turn; not yet
 *   confirmed delivered.
 * - `sent` — a transcript receipt exists (or a verified soft injection
 *   landed) but the provider has not echoed a verified acknowledgement.
 * - `delivered` — the provider echoed a verified acknowledgement for this
 *   message id.
 * - `delivery_unknown` — claimed, then the process was lost before delivery
 *   could be proven; never resent automatically.
 * - `withdrawn` — removed by the operator before being claimed.
 * - `never_sent` — terminal reconciliation found no matching delivery
 *   evidence when the node reached a terminal state.
 */
export const STEERING_QUEUE_STATES = [
  'queued',
  'awaiting_send_now',
  'dispatching',
  'sent',
  'delivered',
  'delivery_unknown',
  'withdrawn',
  'never_sent',
] as const;

export type SteeringQueueState = (typeof STEERING_QUEUE_STATES)[number];

/** States still eligible for claim, withdrawal, or per-item soft injection. */
export const STEERING_QUEUE_CLAIMABLE_STATES = ['queued', 'awaiting_send_now'] as const;

/** States a queue-read exposes to a caller (everything except `withdrawn`, which is dropped like a delete). */
export const STEERING_QUEUE_VISIBLE_STATES = STEERING_QUEUE_STATES.filter(
  state => state !== 'withdrawn'
) as readonly Exclude<SteeringQueueState, 'withdrawn'>[];

/**
 * Which attempt claimed an entry that a retryable dispatch failure then
 * reverted to `queued`: `automatic` is the executor's own wake-and-claim
 * after a natural turn boundary; `send_now` is an operator-triggered claim
 * (blank or typed). Recorded alongside `last_error` so the dock's failure
 * copy names the attempt that actually failed, never assuming automatic.
 */
export const STEERING_DISPATCH_FAILURE_KINDS = ['automatic', 'send_now'] as const;

export type SteeringDispatchFailureKind = (typeof STEERING_DISPATCH_FAILURE_KINDS)[number];

const nullableOperatorUserIdSchema = z.string().min(1).nullable();

export const steeringDraftSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    operator_user_id: nullableOperatorUserIdSchema,
    message: z.string(),
    updated_at: z.union([z.date(), z.string()]),
  })
  .strict();

export type SteeringDraft = z.infer<typeof steeringDraftSchema>;

export const upsertSteeringDraftInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    operator_user_id: nullableOperatorUserIdSchema,
    message: z.string(),
  })
  .strict();

export type UpsertSteeringDraftInput = z.infer<typeof upsertSteeringDraftInputSchema>;

export const steeringDraftKeySchema = upsertSteeringDraftInputSchema.omit({ message: true });

export type SteeringDraftKey = z.infer<typeof steeringDraftKeySchema>;

export const steeringQueueEntrySchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    message_id: z.string().min(1),
    message: z.string(),
    operator_user_id: nullableOperatorUserIdSchema,
    fifo_position: z.number().int().min(1),
    state: z.enum(STEERING_QUEUE_STATES),
    /**
     * Failure evidence for an entry a retryable automatic-dispatch failure
     * reverted to `queued`, or that terminal reconciliation later marked
     * `never_sent`; null otherwise. A retryable failure keeps the entry
     * `queued` (not a distinct terminal state) so it stays re-claimable —
     * the same `queued` FIFO claim SQL, ordered by the entry's existing
     * (unchanged) `fifo_position`, already puts it back at the front.
     */
    last_error: z.string().nullable(),
    /** Count of retryable automatic-dispatch failures this entry has been reverted from; never caps a retry. */
    dispatch_failure_count: z.number().int().min(0),
    /** Attempt kind behind the most recent `last_error`; null until the first failure. */
    last_failure_kind: z.enum(STEERING_DISPATCH_FAILURE_KINDS).nullable(),
    created_at: z.union([z.date(), z.string()]),
    updated_at: z.union([z.date(), z.string()]),
  })
  .strict();

export type SteeringQueueEntry = z.infer<typeof steeringQueueEntrySchema>;

export const enqueueSteeringMessageInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    message_id: z.string().min(1),
    message: z.string().refine(value => value.trim().length > 0, {
      message: 'must not be blank',
    }),
    operator_user_id: nullableOperatorUserIdSchema,
    initial_state: z.enum(['queued', 'awaiting_send_now']),
  })
  .strict();

export type EnqueueSteeringMessageInput = z.infer<typeof enqueueSteeringMessageInputSchema>;

export const enqueueSteeringMessageResultSchema = z
  .object({
    entry: steeringQueueEntrySchema,
    duplicate: z.boolean(),
  })
  .strict();

export type EnqueueSteeringMessageResult = z.infer<typeof enqueueSteeringMessageResultSchema>;

export const steeringNodeSettingsSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    auto_send_enabled: z.boolean(),
    updated_by_user_id: nullableOperatorUserIdSchema,
    provider_id: z.string().min(1).nullable(),
    updated_at: z.union([z.date(), z.string()]),
  })
  .strict();

export type SteeringNodeSettings = z.infer<typeof steeringNodeSettingsSchema>;

/**
 * Partial upsert — only the provided fields change. The executor stamps
 * `provider_id` at registration; the auto-send route sets `auto_send_enabled`
 * and `updated_by_user_id`. Neither caller overwrites the other's field.
 */
export const upsertSteeringNodeSettingsInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    auto_send_enabled: z.boolean().optional(),
    updated_by_user_id: nullableOperatorUserIdSchema.optional(),
    provider_id: z.string().min(1).optional(),
  })
  .strict();

export type UpsertSteeringNodeSettingsInput = z.infer<typeof upsertSteeringNodeSettingsInputSchema>;

/**
 * One claimed queue entry, returned to the executor in FIFO order for the
 * next provider turn's guidance.
 */
export const claimedSteeringMessageSchema = z
  .object({
    message_id: z.string().min(1),
    message: z.string(),
    operator_user_id: nullableOperatorUserIdSchema,
  })
  .strict();

export type ClaimedSteeringMessage = z.infer<typeof claimedSteeringMessageSchema>;
