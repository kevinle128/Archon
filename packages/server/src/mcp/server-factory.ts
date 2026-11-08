/**
 * MCP server for Archon (protocol revision 2026-07-28, modern era only).
 *
 * A fresh `McpServer` is built per HTTP request (the SDK contract). It
 * advertises the tasks and events extensions, serves three tools, and
 * hand-written `tasks/get`, `tasks/update`, `tasks/cancel` handlers. The events
 * methods are served by `events.ts`, in front of this handler (see `route.ts`).
 *
 * Every Archon read or write goes through `archon-api.ts`, i.e. through the
 * real REST routes with the caller's identity headers.
 */
import { randomUUID } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import {
  ProtocolError,
  createMcpHandler,
  McpServer,
  type CallToolResult,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { createLogger } from '@archon/paths';
import { BUNDLED_VERSION } from '@archon/paths/bundled-build';

import { ArchonApiError, type ApiCodebase, type ArchonApi, type RunDetail } from './archon-api';
import {
  buildDetailedTask,
  buildRunSummary,
  inputRequestKey,
  isRunId,
  runUrl,
  taskBase,
  taskStatusOf,
  toText,
  type RunSnapshot,
} from './run-task';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('mcp.server');
  return cachedLog;
}

export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
export const EVENTS_EXTENSION_ID = 'io.modelcontextprotocol/events';

const RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'] as const;
const LIST_RUNS_DEFAULT_LIMIT = 20;
const LIST_RUNS_MAX_LIMIT = 100;
/** `GET /api/workflows/runs` cap; the workflow filter is applied over this window. */
const LIST_RUNS_FETCH_WINDOW = 200;
const DETAIL_CONCURRENCY = 5;
const REJECT_REASON_DEFAULT = 'Rejected through MCP';

/**
 * How long `run_workflow` waits for the run row. The row is created after
 * worktree isolation, which includes a git fetch and can take well over 30 s.
 */
export const RUN_ROW_TIMEOUT_MS = 120_000;

export interface McpServerDeps {
  /** Archon REST client bound to the identity of this HTTP request. */
  apiFor(request: Request): ArchonApi;
  /** Web UI base URL for links in results. */
  baseUrlFor(request: Request): string;
  /** How long `run_workflow` waits for the run row before it reports an error. */
  runRowTimeoutMs?: number;
  /** Interval between run-row checks. */
  runRowPollMs?: number;
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

function plainResult(structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: toText(structured) }], structuredContent: structured };
}

function normalizeRepoUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^[^@/]+@/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

/**
 * Resolve the `codebase` tool argument: an exact id, else a case-insensitive
 * name, else a repository URL such as `github.com/<owner>/<repo>` (scheme and
 * `.git` optional). Never fuzzy.
 */
export function resolveCodebase(
  codebases: readonly ApiCodebase[],
  ref: string
): { ok: true; codebase: ApiCodebase } | { ok: false; error: string } {
  const wanted = ref.trim();
  const byId = codebases.filter(c => c.id === wanted);
  const byName = codebases.filter(c => c.name.toLowerCase() === wanted.toLowerCase());
  const normalized = normalizeRepoUrl(wanted);
  const byUrl = codebases.filter(
    c => typeof c.repository_url === 'string' && normalizeRepoUrl(c.repository_url) === normalized
  );
  for (const matches of [byId, byName, byUrl]) {
    if (matches.length === 1 && matches[0]) return { ok: true, codebase: matches[0] };
    if (matches.length > 1) {
      return {
        ok: false,
        error: `Codebase '${ref}' is ambiguous. Candidates: ${matches.map(c => `${c.name} (${c.id})`).join(', ')}`,
      };
    }
  }
  const known = codebases.map(c => c.name).join(', ') || '(none registered)';
  return { ok: false, error: `Codebase '${ref}' not found. Registered codebases: ${known}` };
}

function missingTasksCapability(): ProtocolError {
  return new ProtocolError(-32021, 'Missing required client capability', {
    requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } },
  });
}

function taskNotFound(taskId: string): ProtocolError {
  return new ProtocolError(-32602, `Failed to retrieve task: Task not found (${taskId})`);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const elicitationResponseSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z
    .object({ decision: z.enum(['approve', 'reject']), comment: z.string().optional() })
    .loose()
    .optional(),
});

/** Resolve the workflow's `returns:` node for a completed or failed run (best-effort). */
async function returnsNodeFor(api: ArchonApi, detail: RunDetail): Promise<string | undefined> {
  if (detail.run.status !== 'completed' && detail.run.status !== 'failed') return undefined;
  if (!detail.codebaseId) return undefined;
  try {
    const codebase = await api.getCodebase(detail.codebaseId);
    if (!codebase) return undefined;
    const workflows = await api.listWorkflows(codebase.default_cwd);
    return workflows.find(w => w.name === detail.run.workflow_name)?.returns;
  } catch (error) {
    // The result still resolves from the last completed node; log and continue.
    getLog().warn({ err: error as Error, runId: detail.run.id }, 'mcp.returns_node_lookup_failed');
    return undefined;
  }
}

export function createMcpServerHandler(deps: McpServerDeps): McpHttpHandler {
  const runRowTimeoutMs = deps.runRowTimeoutMs ?? RUN_ROW_TIMEOUT_MS;
  const runRowPollMs = deps.runRowPollMs ?? 250;

  return createMcpHandler(
    ctx => {
      const request = ctx.requestInfo;
      if (!request) throw new Error('MCP handler invoked without the HTTP request');
      const api = deps.apiFor(request);
      const baseUrl = deps.baseUrlFor(request);

      const server = new McpServer(
        { name: 'archon', version: BUNDLED_VERSION },
        { capabilities: { tools: {} } }
      );
      server.server.registerCapabilities({
        extensions: { [TASKS_EXTENSION_ID]: {}, [EVENTS_EXTENSION_ID]: {} },
      });

      const clientDeclared = (extensionOrCapability: 'tasks' | 'elicitation'): boolean => {
        const caps = server.server.getClientCapabilities();
        if (extensionOrCapability === 'elicitation') return caps?.elicitation !== undefined;
        return caps?.extensions?.[TASKS_EXTENSION_ID] !== undefined;
      };

      async function waitForRunRow(runId: string): Promise<RunDetail | null> {
        const deadline = Date.now() + runRowTimeoutMs;
        for (;;) {
          const detail = await api.getRunDetail(runId);
          if (detail) return detail;
          if (Date.now() >= deadline) return null;
          await sleep(runRowPollMs);
        }
      }

      async function summarize(run: RunSnapshot): Promise<Record<string, unknown>> {
        const detail = await api.getRunDetail(run.id);
        return { ...buildRunSummary(detail?.run ?? run, detail?.events ?? [], { baseUrl }) };
      }

      server.registerTool(
        'run_workflow',
        {
          description:
            'Start an Archon workflow run on a registered codebase. With the tasks extension ' +
            'declared, returns a task whose id is the Archon run id; otherwise returns run_id and url.',
          inputSchema: z.object({
            workflow: z.string().min(1).describe('Workflow name'),
            codebase: z
              .string()
              .min(1)
              .describe('Codebase id, name, or repository URL such as github.com/<owner>/<repo>'),
            message: z.string().min(1).describe('Message passed to the workflow as $ARGUMENTS'),
          }),
        },
        async ({ workflow, codebase, message }) => {
          try {
            const resolved = resolveCodebase(await api.listCodebases(), codebase);
            if (!resolved.ok) return toolError(resolved.error);
            const target = resolved.codebase;

            const workflows = await api.listWorkflows(target.default_cwd);
            if (!workflows.some(w => w.name === workflow)) {
              return toolError(
                `Workflow '${workflow}' not found for codebase ${target.name}. Available: ${workflows.map(w => w.name).join(', ')}`
              );
            }

            const { conversationId } = await api.createConversation(target.id);
            const runId = randomUUID();
            const dispatch = await api.startRun(workflow, { conversationId, message, runId });
            getLog().info(
              { runId, workflow, codebaseId: target.id, lockStatus: dispatch.status },
              'mcp.run_workflow_dispatched'
            );

            const detail = await waitForRunRow(runId);
            if (!detail) {
              const messages = await api.getConversationMessages(conversationId).catch(() => []);
              const last = messages.filter(m => m.role === 'assistant').at(-1)?.content;
              const queued =
                dispatch.status === 'queued-capacity' ? ' All run slots were busy.' : '';
              getLog().warn(
                { runId, workflow, lockStatus: dispatch.status },
                'mcp.run_row_missing'
              );
              return toolError(
                `The run did not start within ${String(Math.round(runRowTimeoutMs / 1000))} s (run id ${runId}); ` +
                  'the run may still start with this run id; poll get_run or tasks/get.' +
                  queued +
                  (last ? ` Last message: ${last}` : '')
              );
            }

            if (clientDeclared('tasks')) {
              // The tasks extension's flat CreateTaskResult. The SDK passes it through
              // unchanged on the wire, but its tool callback type only names
              // CallToolResult, so the narrow cast is the documented escape here.
              const created = {
                resultType: 'task',
                ...taskBase(detail.run, detail.events),
                status: 'working',
              };
              return created as unknown as CallToolResult;
            }
            return plainResult({ run_id: runId, url: runUrl(baseUrl, runId) });
          } catch (error) {
            getLog().error({ err: error as Error, workflow }, 'mcp.run_workflow_failed');
            return toolError(`run_workflow failed: ${(error as Error).message}`);
          }
        }
      );

      server.registerTool(
        'get_run',
        {
          description: 'Get the status of one Archon workflow run.',
          inputSchema: z.object({ run_id: z.string().min(1).describe('Archon run id') }),
        },
        async ({ run_id }) => {
          try {
            if (!isRunId(run_id)) return toolError(`Invalid run id: ${run_id}`);
            const detail = await api.getRunDetail(run_id);
            if (!detail) return toolError(`Run '${run_id}' not found`);
            return plainResult({ ...buildRunSummary(detail.run, detail.events, { baseUrl }) });
          } catch (error) {
            getLog().error({ err: error as Error, runId: run_id }, 'mcp.get_run_failed');
            return toolError(`get_run failed: ${(error as Error).message}`);
          }
        }
      );

      server.registerTool(
        'list_runs',
        {
          description:
            'List Archon workflow runs, newest first. The workflow filter applies to the newest 200 runs.',
          inputSchema: z.object({
            workflow: z.string().min(1).optional(),
            status: z.enum(RUN_STATUSES).optional(),
            limit: z.number().int().min(1).max(LIST_RUNS_MAX_LIMIT).optional(),
          }),
        },
        async ({ workflow, status, limit }) => {
          try {
            const wanted = limit ?? LIST_RUNS_DEFAULT_LIMIT;
            const runs = await api.listRuns({
              ...(status ? { status } : {}),
              limit: workflow ? LIST_RUNS_FETCH_WINDOW : wanted,
            });
            const selected = runs
              .filter(r => workflow === undefined || r.workflow_name === workflow)
              .slice(0, wanted);
            const summaries = await mapLimit(selected, DETAIL_CONCURRENCY, summarize);
            return plainResult({ runs: summaries });
          } catch (error) {
            getLog().error({ err: error as Error }, 'mcp.list_runs_failed');
            return toolError(`list_runs failed: ${(error as Error).message}`);
          }
        }
      );

      const taskIdParams = z.object({ taskId: z.string().min(1) }).loose();

      server.server.setRequestHandler('tasks/get', { params: taskIdParams }, async ({ taskId }) => {
        if (!clientDeclared('tasks')) throw missingTasksCapability();
        if (!isRunId(taskId)) throw taskNotFound(taskId);
        const detail = await api.getRunDetail(taskId);
        if (!detail) throw taskNotFound(taskId);
        const returnsNodeId = await returnsNodeFor(api, detail);
        const task = buildDetailedTask(detail.run, detail.events, {
          baseUrl,
          elicitation: clientDeclared('elicitation'),
          ...(returnsNodeId ? { returnsNodeId } : {}),
        });
        // DetailedTask is a hand-written shape; the custom-method handler has no result schema.
        return task as unknown as Record<string, unknown>;
      });

      server.server.setRequestHandler(
        'tasks/update',
        { params: taskIdParams },
        async ({ taskId }, handlerCtx) => {
          if (!clientDeclared('tasks')) throw missingTasksCapability();
          if (!isRunId(taskId)) throw taskNotFound(taskId);
          const detail = await api.getRunDetail(taskId);
          if (!detail) throw taskNotFound(taskId);
          const key = inputRequestKey(detail.run, detail.events);
          const responses = handlerCtx.mcpReq.inputResponses ?? {};
          const raw = key !== undefined ? responses[key] : undefined;
          if (key === undefined || raw === undefined) {
            // Stale or unknown keys are ignored: keys are unique over the task's life.
            getLog().info(
              { runId: taskId, currentKey: key, receivedKeys: Object.keys(responses) },
              'mcp.task_update_ignored'
            );
            return {};
          }
          const parsed = elicitationResponseSchema.safeParse(raw);
          if (!parsed.success || parsed.data.action !== 'accept' || !parsed.data.content) {
            getLog().info({ runId: taskId, key }, 'mcp.task_update_declined');
            return {};
          }
          const { decision, comment } = parsed.data.content;
          try {
            if (decision === 'approve') {
              await api.approve(taskId, comment);
            } else {
              await api.reject(
                taskId,
                comment && comment.length > 0 ? comment : REJECT_REASON_DEFAULT
              );
            }
          } catch (error) {
            if (error instanceof ArchonApiError) throw new ProtocolError(-32602, error.message);
            throw error;
          }
          getLog().info({ runId: taskId, key, decision }, 'mcp.task_update_applied');
          return {};
        }
      );

      server.server.setRequestHandler(
        'tasks/cancel',
        { params: taskIdParams },
        async ({ taskId }) => {
          if (!clientDeclared('tasks')) throw missingTasksCapability();
          if (!isRunId(taskId)) throw taskNotFound(taskId);
          const detail = await api.getRunDetail(taskId);
          if (!detail) throw taskNotFound(taskId);
          const status = taskStatusOf(detail.run);
          if (status === 'working') {
            try {
              await api.cancel(taskId);
            } catch (error) {
              // Cancellation is cooperative; a run that finished meanwhile is not an error.
              if (!(error instanceof ArchonApiError && error.status === 400)) throw error;
            }
            getLog().info({ runId: taskId }, 'mcp.task_cancel_applied');
          } else {
            // A run paused for a human answer stays paused: the person can still answer
            // it in Archon. Terminal runs have nothing to cancel.
            getLog().info({ runId: taskId, taskStatus: status }, 'mcp.task_cancel_acknowledged');
          }
          return {};
        }
      );

      return server;
    },
    {
      legacy: 'reject',
      onerror: error => {
        getLog().warn({ err: error }, 'mcp.sdk_error');
      },
    }
  );
}
