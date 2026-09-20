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

export const nodeTranscriptMetadataSchema = z
  .object({
    execution: transcriptExecutionScopeSchema.optional(),
    stream_id: z.string().min(1).optional(),
    message_id: z.string().min(1).optional(),
    origin: z.literal('operator').optional(),
    operator_user_id: z.string().min(1).nullable().optional(),
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
export type NodeTranscriptToolPhase = z.infer<typeof nodeTranscriptToolPhaseSchema>;
export type NodeTranscriptTextMode = z.infer<typeof nodeTranscriptTextModeSchema>;
export type NodeExecution = z.infer<typeof nodeExecutionSchema>;
