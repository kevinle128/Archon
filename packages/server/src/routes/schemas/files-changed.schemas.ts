import { z } from '@hono/zod-openapi';

import { gitChangedFileStatusSchema, gitEmptyReasonSchema } from './git.schemas';

export const attributedNodeExecutionSchema = z
  .object({
    nodeId: z.string().min(1),
    retryEpoch: z.number().int().nonnegative(),
    startedAt: z.string(),
    endedAt: z.string(),
  })
  .openapi('AttributedNodeExecution');
export type AttributedNodeExecutionResponse = z.infer<typeof attributedNodeExecutionSchema>;

export const filesChangedPathSchema = z
  .object({
    path: z.string().min(1),
    status: gitChangedFileStatusSchema,
    /**
     * Node executions proven, by non-overlapping git evidence, to have
     * touched this path, in stable chronological order. Empty means the
     * path changed but no execution's evidence explains it — never guessed.
     */
    executions: z.array(attributedNodeExecutionSchema),
  })
  .openapi('FilesChangedPath');
export type FilesChangedPathResponse = z.infer<typeof filesChangedPathSchema>;

const filesChangedReadyResponseSchema = z.object({
  files: z.array(filesChangedPathSchema),
});

const filesChangedEmptyResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
  files: z.array(filesChangedPathSchema).max(0),
});

export const filesChangedResponseSchema = z
  .union([filesChangedReadyResponseSchema, filesChangedEmptyResponseSchema])
  .openapi('FilesChangedResponse');
export type FilesChangedResponse = z.infer<typeof filesChangedResponseSchema>;
