import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { filesChangedResponseSchema } from '../schemas/files-changed.schemas';

export const filesChangedRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/files-changed',
  tags: ['Workflows'],
  summary: "List a run's changed files with node execution attribution",
  request: {
    params: z.object({ runId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: filesChangedResponseSchema } },
      description: 'Changed files with known node executions, or a CAP-6 empty envelope',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Workflow run not found',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
