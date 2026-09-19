import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ModelUsageEntry,
  NativeTool,
  ProviderCapabilities,
  SendQueryOptions,
  UsageBreakdown,
} from '../types';

import { E2E_FAKE_CAPABILITIES } from './capabilities';

const log = createLogger('provider.e2e-fake');

const DIRECTIVE_OPEN = '<<E2E_USAGE>>';
const DIRECTIVE_CLOSE = '<</E2E_USAGE>>';
const SCENARIO_OPEN = '<<E2E_SCENARIO>>';
const SCENARIO_CLOSE = '<</E2E_SCENARIO>>';

/** Deterministic tool card content for HITL e2e assertions. */
export const E2E_FAKE_TOOL_NAME = 'Read';
export const E2E_FAKE_TOOL_INPUT = { path: 'HITL_TOOL_INPUT.txt' } as const;
export const E2E_FAKE_TOOL_OUTPUT = 'HITL_TOOL_OUTPUT_VISIBLE';
export const E2E_FAKE_LOOP_DONE = 'E2E_LOOP_DONE';
export const E2E_FAKE_TOOL_PASS_TEXT = '[e2e-fake] tool pass';

/**
 * Deterministic task-dispatch payloads for the node-room e2e proof. The OMP
 * batch mirrors the OMP `Task` tool input (`{context?, tasks:[{name, agent,
 * task}]}`); the Claude single mirrors the Claude `Agent` tool input
 * (`{description, prompt}` — `subagent_type` intentionally absent to exercise
 * the nullable-agent path). The markdown context carries emphasis, a list, an
 * image URL, and a `javascript:` link so the renderer's safe-markdown path is
 * exercised; the image host is reserved-invalid so a real request always fails.
 */
export const E2E_FAKE_TASK_TOOL_NAME = 'Task';
export const E2E_FAKE_AGENT_TOOL_NAME = 'Agent';
export const E2E_FAKE_TASK_OMP_IMAGE_URL = 'https://e2e.invalid/task-dispatch-diagram.png';
export const E2E_FAKE_TASK_OMP_INPUT = {
  context: [
    'Dispatch **two** review passes over the staged diff:',
    '',
    '- correctness of every new code path',
    '- security of every new code path',
    '',
    `![dispatch diagram](${E2E_FAKE_TASK_OMP_IMAGE_URL})`,
    '[release notes](javascript:alert(1))',
  ].join('\n'),
  tasks: [
    {
      name: 'correctness-review',
      agent: 'reviewer',
      task: 'Review the staged diff for correctness.\nCheck boundary conditions and error paths.\nReport each finding on its own line.',
    },
    {
      name: 'security-review',
      agent: 'auditor',
      task: 'Audit the staged diff for security issues.\nFocus on injection, secrets, and unsafe calls.\nReport each finding on its own line.',
    },
  ],
} as const;
export const E2E_FAKE_AGENT_INPUT = {
  description: 'Summarize the staged diff',
  prompt:
    'Summarize the staged diff.\nList each changed file and its purpose.\nKeep it under ten lines.',
} as const;

/**
 * Deterministic todo-call sequence for the pinned-strip e2e fixture. Folding
 * the four calls yields 12 items across `Research`/`Implement` exercising all
 * five statuses: `Read the spec` completed, `Map the message path`
 * auto-promoted to in progress, `Run the suite` blocked, `Review output`
 * abandoned, and eight pending.
 */
export const E2E_FAKE_TODO_TOOL_NAME = 'todo';
export const E2E_FAKE_TODO_OUTPUT = '[e2e-fake] todo updated';
export const E2E_FAKE_TODO_INPUTS: readonly Record<string, unknown>[] = [
  {
    op: 'init',
    list: [
      {
        phase: 'Research',
        items: [
          'Read the spec',
          'Map the message path',
          'Check contract conflicts',
          'Inspect the mockups',
          'Confirm the tokens',
          'Define acceptance cases',
        ],
      },
      {
        phase: 'Implement',
        items: [
          'Add the fold',
          'Wire Legacy',
          'Wire Console',
          'Add the tests',
          'Run the suite',
          'Review output',
        ],
      },
    ],
  },
  { op: 'done', task: 'Read the spec' },
  { op: 'block', task: 'Run the suite', reason: 'CI has one build job' },
  { op: 'drop', task: 'Review output' },
];

const ASK_HUMAN_TOOL_NAME = 'AskHuman';

const DEFAULT_ASK_QUESTIONS = [
  {
    id: 'proceed',
    prompt: 'Should the HITL fixture continue?',
    selection: 'single' as const,
    options: ['yes', 'no'],
    allowOther: true,
  },
];

const scenarioSchema = z
  .object({
    emitTool: z.boolean().optional(),
    emitTodo: z.boolean().optional(),
    askHuman: z.boolean().optional(),
    delayMs: z.number().int().nonnegative().optional(),
    doneWhenPromptIncludes: z.string().min(1).optional(),
    repeatTool: z.number().int().min(1).max(200).optional(),
    largeLastToolOutput: z.boolean().optional(),
    taskDispatch: z.enum(['omp', 'claude']).optional(),
    echoPrompt: z.boolean().optional(),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    if (scenario.taskDispatch === undefined) return;
    // taskDispatch emits its own fixed tool pair; the emitTool family of keys
    // would be dead or contradictory config, so the combination is invalid.
    for (const key of ['emitTool', 'repeatTool', 'largeLastToolOutput'] as const) {
      if (scenario[key] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `task_dispatch_mutually_exclusive_with_${key}`,
        });
      }
    }
  });

type E2eScenario = z.infer<typeof scenarioSchema>;

// ---------------------------------------------------------------------------
// Usage directive schema
//
// Faithful mirror of `modelUsageEntrySchema`
// (packages/workflows/src/schemas/usage-breakdown.ts). @archon/providers is
// UPSTREAM of @archon/workflows, so the canonical schema cannot be imported
// here. Two guards keep this honest:
//   1. The `ExactMatch` type assertion below fails the build if the entry's
//      inferred TYPE drifts from the provider contract (`ModelUsageEntry`).
//   2. The refinements are replicated so a directive that this fake accepts is
//      one the downstream recorder also accepts — a directive typo THROWS here
//      instead of silently producing zero ledger rows (which would be
//      indistinguishable from the intentional "no usage" scenario, where the
//      directive block is simply absent).
// ---------------------------------------------------------------------------

const nonNegativeSafeIntegerSchema = z
  .number()
  .refine(n => Number.isSafeInteger(n) && n >= 0, 'must be a non-negative safe integer');

const positiveSafeIntegerSchema = z
  .number()
  .refine(n => Number.isSafeInteger(n) && n > 0, 'must be a positive safe integer');

const finiteNonNegativeSchema = z
  .number()
  .refine(n => Number.isFinite(n) && n >= 0, 'must be a finite non-negative number');

const usageEntrySchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().nullable(),
    modelSource: z.enum(['reported', 'requested', 'unknown']),
    inputTokens: nonNegativeSafeIntegerSchema.optional(),
    outputTokens: nonNegativeSafeIntegerSchema.optional(),
    reasoningTokens: nonNegativeSafeIntegerSchema.optional(),
    cacheReadTokens: nonNegativeSafeIntegerSchema.optional(),
    cacheWriteTokens: nonNegativeSafeIntegerSchema.optional(),
    requests: positiveSafeIntegerSchema.optional(),
    costUsd: finiteNonNegativeSchema.optional(),
    kind: z.enum(['advisor', 'subagent']).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.modelSource === 'unknown') {
      if (entry.model !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['model'],
          message: 'model_source_unknown_requires_null_model',
        });
      }
    } else if (typeof entry.model !== 'string' || entry.model.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'model_required_for_known_source',
      });
    } else if (entry.model !== entry.model.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'model_untrimmed' });
    }

    if (entry.provider !== entry.provider.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'provider_untrimmed',
      });
    }

    if (
      entry.reasoningTokens !== undefined &&
      entry.outputTokens !== undefined &&
      entry.reasoningTokens > entry.outputTokens
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasoningTokens'],
        message: 'reasoning_exceeds_output',
      });
    }

    const hasMeasure =
      entry.inputTokens !== undefined ||
      entry.outputTokens !== undefined ||
      entry.reasoningTokens !== undefined ||
      entry.cacheReadTokens !== undefined ||
      entry.cacheWriteTokens !== undefined ||
      entry.requests !== undefined ||
      entry.costUsd !== undefined;

    if (!hasMeasure) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'missing_numeric_measure' });
    }
  });

const usageBreakdownSchema = z.array(usageEntrySchema).min(1);

// Drift guard: the fake's entry output type must match the provider contract
// both ways. `ExactMatch` returns `false` (not `never`) on mismatch — a
// never-based assert would silently accept drift. `AssertTrue<false>` violates
// its `extends true` bound, so a divergence is a compile error.
type ExactMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
type EntryTypeMatchesContract = AssertTrue<
  ExactMatch<z.infer<typeof usageEntrySchema>, ModelUsageEntry>
>;
// Exported so `noUnusedLocals` cannot drop the assertion silently.
export type E2eFakeContractChecks = [EntryTypeMatchesContract];

function extractDelimitedBlock(
  prompt: string,
  open: string,
  close: string,
  label: string
): string | undefined {
  const start = prompt.indexOf(open);
  if (start === -1) return undefined;
  const from = start + open.length;
  const end = prompt.indexOf(close, from);
  if (end === -1) {
    throw new Error(`e2e-fake: found ${open} without a closing ${close} in the ${label}`);
  }
  return prompt.slice(from, end).trim();
}

/** Drop a delimited directive so its JSON body cannot satisfy `doneWhenPromptIncludes`. */
function stripDelimitedBlock(prompt: string, open: string, close: string): string {
  const start = prompt.indexOf(open);
  if (start === -1) return prompt;
  const from = start + open.length;
  const end = prompt.indexOf(close, from);
  if (end === -1) return prompt;
  return prompt.slice(0, start) + prompt.slice(end + close.length);
}

function parseScenarioDirective(directive: string): E2eScenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(directive);
  } catch (err) {
    throw new Error(
      `e2e-fake: scenario directive is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const result = scenarioSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`e2e-fake: scenario directive failed validation: ${result.error.message}`);
  }
  return result.data;
}

function findAskHumanTool(nativeTools: NativeTool[] | undefined): NativeTool {
  const tool = nativeTools?.find(candidate => candidate.name === ASK_HUMAN_TOOL_NAME);
  if (!tool) {
    throw new Error(
      'e2e-fake: askHuman scenario requires the registered AskHuman native tool on sendQuery options'
    );
  }
  return tool;
}

async function waitUnlessAborted(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error('Query aborted'));
      return;
    }
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Query aborted'));
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseUsageDirective(directive: string): UsageBreakdown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(directive);
  } catch (err) {
    throw new Error(
      `e2e-fake: usage directive is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const result = usageBreakdownSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`e2e-fake: usage directive failed validation: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Env-gated fake agent provider for end-to-end tests.
 *
 * Usage still comes only from `<<E2E_USAGE>>` (unchanged contract). Optional
 * `<<E2E_SCENARIO>>` JSON drives typed tool / AskHuman / delay / loop-done
 * behavior by calling the real native-tool handler and emitting `tool` +
 * `tool_result` chunks. Registered ONLY when `ARCHON_E2E_FAKE_PROVIDER` is set.
 */
export class E2eFakeProvider implements IAgentProvider {
  getType(): string {
    return 'e2e-fake';
  }

  getCapabilities(): ProviderCapabilities {
    return E2E_FAKE_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    _cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');

    const usageDirective = extractDelimitedBlock(
      prompt,
      DIRECTIVE_OPEN,
      DIRECTIVE_CLOSE,
      'usage directive'
    );
    const scenarioDirective = extractDelimitedBlock(
      prompt,
      SCENARIO_OPEN,
      SCENARIO_CLOSE,
      'scenario directive'
    );
    const scenario: E2eScenario =
      scenarioDirective === undefined ? {} : parseScenarioDirective(scenarioDirective);
    const sessionId = resumeSessionId ?? `e2e-fake-${randomUUID()}`;
    const resumed = resumeSessionId !== undefined ? true : undefined;

    await waitUnlessAborted(scenario.delayMs ?? 0, requestOptions?.abortSignal);
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');

    const usageBreakdown =
      usageDirective === undefined ? undefined : parseUsageDirective(usageDirective);

    const resumeInteractions = requestOptions?.resumeInteractions;
    if (resumeInteractions !== undefined && resumeInteractions.length > 0) {
      const first = resumeInteractions[0];
      const resumeText = first.declined
        ? '[e2e-fake] ask declined'
        : `[e2e-fake] ask answered ${JSON.stringify(first.payload)}`;
      yield { type: 'assistant', content: resumeText };
      log.info({ sessionId, resumed: true }, 'e2e-fake.query_completed_resume');
      yield {
        type: 'result',
        sessionId,
        ...(usageBreakdown !== undefined ? { usageBreakdown } : {}),
        resumed: true,
      };
      return;
    }

    if (scenario.emitTodo === true) {
      for (const [index, input] of E2E_FAKE_TODO_INPUTS.entries()) {
        const toolCallId = `e2e-fake-todo-${sessionId}-${String(index + 1)}`;
        yield {
          type: 'tool',
          toolName: E2E_FAKE_TODO_TOOL_NAME,
          toolInput: { ...input },
          toolCallId,
        };
        yield {
          type: 'tool_result',
          toolName: E2E_FAKE_TODO_TOOL_NAME,
          toolOutput: E2E_FAKE_TODO_OUTPUT,
          toolCallId,
          toolOutcome: 'success',
        };
      }
    }

    if (scenario.emitTool === true) {
      const repeat = scenario.repeatTool ?? 1;
      yield { type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT };
      for (let index = 0; index < repeat; index += 1) {
        const toolCallId =
          scenario.repeatTool === undefined
            ? `e2e-fake-tool-${sessionId}`
            : `e2e-fake-tool-${sessionId}-${String(index + 1)}`;
        yield {
          type: 'tool',
          toolName: E2E_FAKE_TOOL_NAME,
          toolInput: { ...E2E_FAKE_TOOL_INPUT },
          toolCallId,
        };
        const toolOutput =
          scenario.largeLastToolOutput === true && index === repeat - 1
            ? `${E2E_FAKE_TOOL_OUTPUT}\n${'x'.repeat(20_000)}\n[e2e-fake] full output tail`
            : E2E_FAKE_TOOL_OUTPUT;
        yield {
          type: 'tool_result',
          toolName: E2E_FAKE_TOOL_NAME,
          toolOutput,
          toolCallId,
          toolOutcome: 'success',
        };
      }
    } else if (scenario.taskDispatch !== undefined) {
      const toolName =
        scenario.taskDispatch === 'omp' ? E2E_FAKE_TASK_TOOL_NAME : E2E_FAKE_AGENT_TOOL_NAME;
      const toolInput =
        scenario.taskDispatch === 'omp' ? E2E_FAKE_TASK_OMP_INPUT : E2E_FAKE_AGENT_INPUT;
      const toolCallId = `e2e-fake-tool-${sessionId}`;
      yield { type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT };
      yield { type: 'tool', toolName, toolInput: structuredClone(toolInput), toolCallId };
      yield {
        type: 'tool_result',
        toolName,
        toolOutput: E2E_FAKE_TOOL_OUTPUT,
        toolCallId,
        toolOutcome: 'success',
      };
    } else {
      yield { type: 'assistant', content: '[e2e-fake] deterministic response' };
    }

    const promptOutsideDirectives = stripDelimitedBlock(
      stripDelimitedBlock(prompt, SCENARIO_OPEN, SCENARIO_CLOSE),
      DIRECTIVE_OPEN,
      DIRECTIVE_CLOSE
    );
    if (scenario.echoPrompt === true) {
      const prefix =
        resumeSessionId === undefined ? '[e2e-fake] echo:' : '[e2e-fake] resumed echo:';
      yield { type: 'assistant', content: `${prefix} ${promptOutsideDirectives}` };
    }
    if (
      scenario.doneWhenPromptIncludes !== undefined &&
      promptOutsideDirectives.includes(scenario.doneWhenPromptIncludes)
    ) {
      yield { type: 'assistant', content: E2E_FAKE_LOOP_DONE };
    }

    if (scenario.askHuman === true) {
      const askTool = findAskHumanTool(requestOptions?.nativeTools);
      const toolUseId = `e2e-fake-ask-${sessionId}`;
      await askTool.handler({ questions: DEFAULT_ASK_QUESTIONS }, { toolUseId, sessionId });
      throw new Error('e2e-fake: AskHuman handler returned without pausing the run');
    }

    if (usageBreakdown === undefined) {
      log.info({ sessionId }, 'e2e-fake.query_completed_no_usage');
      yield { type: 'result', sessionId, resumed };
      return;
    }

    log.info({ sessionId, entries: usageBreakdown.length }, 'e2e-fake.query_completed');
    yield { type: 'result', sessionId, usageBreakdown, resumed };
  }
}
