/**
 * Typed execution-scope and transcript-metadata contracts.
 *
 * Occurrence / attempt identity is server-generated UUID data, not timestamps
 * or process-global counters. Old rows omit these fields (`optional` + `nullable`).
 */
import { z } from '@hono/zod-openapi';

export const loopAncestryEntrySchema = z
  .object({
    node_id: z.string().min(1),
    iteration: z.number().int().positive(),
  })
  .strict();

export const transcriptExecutionScopeSchema = z
  .object({
    occurrence_id: z.string().uuid(),
    attempt_id: z.string().uuid(),
    retry_epoch: z.number().int().nonnegative().optional(),
    loop_ancestry: z.array(loopAncestryEntrySchema).optional(),
    route_activation_seq: z.number().int().nonnegative().optional(),
  })
  .strict();

export const nodeTranscriptToolPhaseSchema = z.enum(['call', 'result']);
export const nodeTranscriptTextModeSchema = z.enum(['complete', 'delta', 'snapshot']);

/**
 * Where a `kind: 'text'` row came from. `operator` is the redirect-turn receipt
 * (CAP-11). The three added here reuse the same additive-metadata pattern
 * instead of a new `kind`, which the table's CHECK constraint forbids without
 * a SQLite rebuild:
 * - `thinking` — provider reasoning explicitly marked displayable.
 * - `prompt` — the exact text that triggered an agent turn.
 * - `advisor` — a notification from a consulted advisor model.
 */
export const nodeTranscriptOriginSchema = z.enum(['operator', 'thinking', 'prompt', 'advisor']);

/**
 * Why a `prompt`-origin row exists. `node_prompt` and `command_file` cover a
 * turn's first pass (inline `prompt:` vs a loaded `command:` file); `reask`
 * covers a structured-output validation retry. A redirect (guidance) turn's
 * pass zero is deliberately absent from this enum: its triggering text is the
 * operator message already persisted as an `operator`-origin row (CAP-11), so
 * recording it again under `prompt` would duplicate the same text twice.
 */
export const promptTranscriptSourceSchema = z.enum(['node_prompt', 'command_file', 'reask']);

export const nodeTranscriptMetadataSchema = z
  .object({
    execution: transcriptExecutionScopeSchema.optional(),
    stream_id: z.string().min(1).optional(),
    message_id: z.string().min(1).optional(),
    origin: nodeTranscriptOriginSchema.optional(),
    operator_user_id: z.string().min(1).nullable().optional(),
    /** `prompt`-origin only: who started the run, or the redirecting operator for a reask inside a guidance turn. Null when no user is attributed. */
    actor_user_id: z.string().min(1).nullable().optional(),
    /** `prompt`-origin only: which of the three triggering-prompt cases produced this row. */
    prompt_source: promptTranscriptSourceSchema.optional(),
    /** `advisor`-origin only: the advisor model Archon configured, when known. Omitted when Archon did not set it. */
    advisor_model: z.string().min(1).optional(),
    block_id: z.string().min(1).optional(),
    text_mode: nodeTranscriptTextModeSchema.optional(),
    tool_phase: nodeTranscriptToolPhaseSchema.optional(),
    truncated: z.boolean().optional(),
    output_state: z.enum(['full', 'truncated', 'missing', 'unknown']).optional(),
    full_output_available: z.boolean().optional(),
    outcome: z.enum(['success', 'error', 'interrupted', 'unknown']).optional(),
    exit_code: z.number().int().optional(),
  })
  .strict();

export const nodeExecutionSchema = z
  .object({
    node_id: z.string().min(1),
    node_type: z.string().optional(),
    status: z.string().min(1),
    occurrence_id: z.string().uuid().optional(),
    attempt_id: z.string().uuid().optional(),
    retry_epoch: z.number().int().nonnegative().optional(),
    loop_ancestry: z.array(loopAncestryEntrySchema).optional(),
    route_activation_seq: z.number().int().nonnegative().optional(),
    started_at: z.string().optional(),
    ended_at: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
    start_offset_ms: z.number().nonnegative().optional(),
    error: z.string().optional(),
    unknown_scope: z.boolean().optional(),
    unknown_reason: z.string().optional(),
  })
  .strict();

export type LoopAncestryEntry = z.infer<typeof loopAncestryEntrySchema>;
export type TranscriptExecutionScope = z.infer<typeof transcriptExecutionScopeSchema>;
export type NodeTranscriptMetadata = z.infer<typeof nodeTranscriptMetadataSchema>;
export type NodeTranscriptOrigin = z.infer<typeof nodeTranscriptOriginSchema>;
export type PromptTranscriptSource = z.infer<typeof promptTranscriptSourceSchema>;
export type NodeTranscriptToolPhase = z.infer<typeof nodeTranscriptToolPhaseSchema>;
export type NodeTranscriptTextMode = z.infer<typeof nodeTranscriptTextModeSchema>;
export type NodeExecution = z.infer<typeof nodeExecutionSchema>;
