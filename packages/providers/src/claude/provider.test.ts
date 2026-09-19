import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockLogger } from '../test/mocks/logger';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

type CapturedMcpTool = {
  name: string;
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>;
};

const capturedMcpTools: CapturedMcpTool[] = [];

// Create mock query function
const mockQuery = mock(async function* () {
  // Empty generator by default
});

// Mock the claude-agent-sdk
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  tool: (
    name: string,
    _description: string,
    _inputSchema: unknown,
    handler: CapturedMcpTool['handler']
  ): CapturedMcpTool => {
    const def: CapturedMcpTool = { name, handler };
    capturedMcpTools.push(def);
    return def;
  },
  createSdkMcpServer: (config: unknown): unknown => config,
}));

import { ClaudeProvider, shouldPassNoEnvFile, buildClaudeAskResumePrompt } from './provider';
import * as claudeModule from './provider';
import * as binaryResolver from './binary-resolver';
import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  AskHumanPauseFailedError,
  type NativeTool,
  type NativeToolHandlerContext,
  type ResumeInteraction,
} from '../types';

describe('shouldPassNoEnvFile', () => {
  test('returns false when cliPath is undefined (dev mode — SDK 0.2.x resolves a native binary)', () => {
    // Pre-0.2.x the SDK shipped cli.js and dev mode = JS. Since 0.2.x the
    // SDK ships per-platform native binaries via optional deps. The flag
    // (a Bun runtime option) is meaningless to native binaries and gets
    // rejected as `error: unknown option '--no-env-file'`. CWD .env leak
    // protection comes from stripCwdEnv() at entry, not from this flag.
    expect(shouldPassNoEnvFile(undefined)).toBe(false);
  });

  test('returns true for an explicit cli.js path (legacy npm-installed cli.js, SDK spawns via Bun)', () => {
    expect(
      shouldPassNoEnvFile('/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js')
    ).toBe(true);
  });

  test('returns true for .mjs and .cjs paths (also Bun-runnable JS entry points)', () => {
    expect(shouldPassNoEnvFile('/path/to/cli.mjs')).toBe(true);
    expect(shouldPassNoEnvFile('/path/to/cli.cjs')).toBe(true);
  });

  test('returns false for non-Bun-runnable JS-adjacent extensions', () => {
    // `.ts`/`.tsx`/`.jsx` are deliberately excluded — the SDK never shipped
    // those as entry points, so accepting them would only widen misconfiguration.
    expect(shouldPassNoEnvFile('/path/to/cli.ts')).toBe(false);
    expect(shouldPassNoEnvFile('/path/to/cli.tsx')).toBe(false);
    expect(shouldPassNoEnvFile('/path/to/cli.jsx')).toBe(false);
  });

  test('returns false for a native binary path (curl installer, SDK execs directly)', () => {
    expect(shouldPassNoEnvFile('/Users/test/.local/bin/claude')).toBe(false);
  });

  test('returns false for a Windows native binary path', () => {
    expect(shouldPassNoEnvFile('C:\\Users\\test\\.local\\bin\\claude.exe')).toBe(false);
  });

  test('returns false for a Homebrew symlink path', () => {
    expect(shouldPassNoEnvFile('/opt/homebrew/bin/claude')).toBe(false);
  });

  test('extension match is suffix-only (paths ending in cli.js but not literally `.js` extension are still rejected)', () => {
    // Defensive: only string-suffix matches `.js` count as JS executables.
    expect(shouldPassNoEnvFile('/path/to/cli.json')).toBe(false);
    expect(shouldPassNoEnvFile('/path/to/cli.js.bak')).toBe(false);
  });
});

describe('ClaudeProvider', () => {
  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  describe('constructor', () => {
    test('throws when running as root (UID 0)', () => {
      const spy = spyOn(claudeModule, 'getProcessUid').mockReturnValue(0);
      // IS_SANDBOX=1 bypasses the root check; clear it so the guard can trigger
      const savedSandbox = process.env.IS_SANDBOX;
      delete process.env.IS_SANDBOX;
      try {
        expect(() => new ClaudeProvider()).toThrow(
          'does not support bypassPermissions when running as root'
        );
      } finally {
        if (savedSandbox !== undefined) process.env.IS_SANDBOX = savedSandbox;
        spy.mockRestore();
      }
    });

    test('does not throw for non-root user', () => {
      const spy = spyOn(claudeModule, 'getProcessUid').mockReturnValue(1000);
      expect(() => new ClaudeProvider()).not.toThrow();
      spy.mockRestore();
    });

    test('does not throw when process.getuid is unavailable (Windows)', () => {
      const spy = spyOn(claudeModule, 'getProcessUid').mockReturnValue(undefined);
      expect(() => new ClaudeProvider()).not.toThrow();
      spy.mockRestore();
    });
  });

  describe('getType', () => {
    test('returns claude', () => {
      expect(client.getType()).toBe('claude');
    });
  });

  describe('getCapabilities', () => {
    test('returns full capability set for Claude provider', () => {
      const caps = client.getCapabilities();
      expect(caps).toMatchObject({
        sessionResume: true,
        mcp: true,
        hooks: true,
        skills: true,
        agents: true,
        toolRestrictions: true,
        structuredOutput: 'enforced',
        envInjection: true,
        costControl: true,
        effortControl: true,
        thinkingControl: true,
        fallbackModel: true,
        sandbox: true,
        settingSources: true,
        nativeTools: true,
        askHuman: true,
        interrupt: 'native',
      });
    });

    test('declares a tool-name vocabulary for allowed/denied_tools validation (#2084)', () => {
      const caps = client.getCapabilities();
      // Current names present; renamed legacy names deliberately absent so
      // validation can flag them with a targeted rename hint.
      expect(caps.knownToolNames).toContain('Agent');
      expect(caps.knownToolNames).toContain('Bash');
      expect(caps.knownToolNames).not.toContain('Task');
      expect(caps.renamedTools).toMatchObject({ Task: 'Agent' });
    });
  });

  describe('sendQuery', () => {
    test('yields text events from assistant messages', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello, world!' }],
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test prompt', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'assistant',
        content: 'Hello, world!',
        textMode: 'complete',
      });
    });

    test('yields tool events from tool_use blocks', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'npm test' },
              },
            ],
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test prompt', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'tool',
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
      });
    });

    test('yields result event with session ID', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'result',
          session_id: 'session-123-abc',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test prompt', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'result', sessionId: 'session-123-abc' });
    });

    test('yields result with structuredOutput when SDK result has structured_output', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'result',
          session_id: 'sid-structured',
          structured_output: { type: 'BUG', severity: 'high' },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test prompt', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'result',
        sessionId: 'sid-structured',
        structuredOutput: { type: 'BUG', severity: 'high' },
      });
    });

    test('yields result with cost, stopReason, numTurns, and a resolved model when SDK provides them', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'result',
          session_id: 'sid-cost',
          total_cost_usd: 0.0042,
          stop_reason: 'end_turn',
          num_turns: 3,
          modelUsage: {
            'claude-sonnet-4-6': {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadInputTokens: 10,
            },
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: 'result',
        sessionId: 'sid-cost',
        cost: 0.0042,
        stopReason: 'end_turn',
        numTurns: 3,
        resolvedModel: { id: 'claude-sonnet-4-6' },
      });
      // Single-model usage is unambiguous — no ambiguity warning.
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('emits every multi-model usage row and omits resolvedModel without inventing a selection', async () => {
      // A subagent pinned via `agents:` (or a fallbackModel takeover) puts more
      // than one model in the record. Output volume is still a guess about the
      // main model — keep every observation and leave resolvedModel absent.
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'result',
          session_id: 'sid-multi-model',
          modelUsage: {
            'claude-haiku-4-5-20251001': {
              inputTokens: 400,
              outputTokens: 20,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD: 0.002,
            },
            'claude-sonnet-5': {
              inputTokens: 120,
              outputTokens: 900,
              cacheReadInputTokens: 10,
              cacheCreationInputTokens: 2,
              webSearchRequests: 0,
              costUSD: 0.04,
            },
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0]).not.toHaveProperty('resolvedModel');
      expect(chunks[0]).toMatchObject({
        usageBreakdown: [
          {
            provider: 'anthropic',
            model: 'claude-haiku-4-5-20251001',
            modelSource: 'reported',
            inputTokens: 400,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.002,
          },
          {
            provider: 'anthropic',
            model: 'claude-sonnet-5',
            modelSource: 'reported',
            inputTokens: 120,
            outputTokens: 900,
            cacheReadTokens: 10,
            cacheWriteTokens: 2,
            costUsd: 0.04,
          },
        ],
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5'],
        },
        'claude.resolved_model_ambiguous'
      );
      // Warning carries model ids only — no invented `selected` field.
      const warnCall = mockLogger.warn.mock.calls.find(
        (call: unknown[]) => call[1] === 'claude.resolved_model_ambiguous'
      );
      expect(warnCall?.[0]).not.toHaveProperty('selected');
    });

    test('omits resolvedModel when modelUsage is an empty record', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid-empty-usage', modelUsage: {} };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0]).not.toHaveProperty('resolvedModel');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('omits cost, stopReason, numTurns, and resolvedModel when SDK result has none', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid-bare' };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0]).not.toHaveProperty('cost');
      expect(chunks[0]).not.toHaveProperty('stopReason');
      expect(chunks[0]).not.toHaveProperty('numTurns');
      expect(chunks[0]).not.toHaveProperty('resolvedModel');
    });

    test('omits stopReason when stop_reason is null', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid-null-stop', stop_reason: null };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0]).not.toHaveProperty('stopReason');
    });

    test('yields rate_limit chunk and logs warn on rate_limit_event with info', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'rate_limit_event',
          rate_limit_info: { requests_remaining: 0, retry_after_ms: 5000 },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'rate_limit',
        rateLimitInfo: { requests_remaining: 0, retry_after_ms: 5000 },
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { rateLimitInfo: { requests_remaining: 0, retry_after_ms: 5000 } },
        'claude.rate_limit_event'
      );
    });

    test('yields rate_limit chunk with empty object when rate_limit_info absent', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'rate_limit_event' };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'rate_limit', rateLimitInfo: {} });
    });

    test('yields result without structuredOutput when SDK result has no structured_output', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'result',
          session_id: 'sid-plain',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test prompt', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ type: 'result', sessionId: 'sid-plain' });
      expect(chunks[0]).not.toHaveProperty('structuredOutput');
    });

    test('handles multiple content blocks in one message', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will run a command.' },
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
              { type: 'text', text: 'Command completed.' },
            ],
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test prompt', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({
        type: 'assistant',
        content: 'I will run a command.',
        textMode: 'complete',
      });
      expect(chunks[1]).toEqual({ type: 'tool', toolName: 'Bash', toolInput: { command: 'ls' } });
      expect(chunks[2]).toEqual({
        type: 'assistant',
        content: 'Command completed.',
        textMode: 'complete',
      });
    });

    test('passes correct options to SDK', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty generator
      });

      // Consume the generator
      for await (const _ of client.sendQuery('my prompt', '/my/workspace', undefined, {
        model: 'sonnet',
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'my prompt',
        options: expect.objectContaining({
          cwd: '/my/workspace',
          model: 'sonnet',
          permissionMode: 'bypassPermissions',
        }),
      });
    });

    test('omits persistSession from SDK options by default', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty generator
      });

      for await (const _ of client.sendQuery('test', '/workspace')) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options).not.toHaveProperty('persistSession');
    });

    test('passes persistSession: true when explicitly requested', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty generator
      });

      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        persistSession: true,
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({
          persistSession: true,
        }),
      });
    });

    test('passes resume option when resumeSessionId provided', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty generator
      });

      for await (const _ of client.sendQuery('prompt', '/workspace', 'session-to-resume')) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          cwd: '/workspace',
          resume: 'session-to-resume',
        }),
      });
    });

    test('result chunk carries resumed:true when resumeSessionId provided (resume-or-error)', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'resumed-sid' };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('prompt', '/workspace', 'session-to-resume')) {
        chunks.push(chunk);
      }

      expect(chunks.find(c => c.type === 'result')).toMatchObject({ resumed: true });
    });

    test('result chunk omits resumed when no resumeSessionId', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'fresh-sid' };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('prompt', '/workspace')) {
        chunks.push(chunk);
      }

      const result = chunks.find(c => c.type === 'result');
      expect(result).toBeDefined();
      // Contract is "omitted when no resume was requested", not "present-but-undefined".
      expect(result).not.toHaveProperty('resumed');
    });

    // --- Phase 1 of #975 — SDK task/hook lifecycle event handling -----

    test('yields task_started chunk from SDK system message', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'task_started',
          task_id: 't-1',
          description: 'Investigating the bug',
          task_type: 'general-purpose',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'task_started',
        taskId: 't-1',
        description: 'Investigating the bug',
        taskType: 'general-purpose',
      });
    });

    test('drops housekeeping task_started when SDK sets skip_transcript', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'task_started',
          task_id: 't-housekeeping',
          description: 'Ambient task',
          skip_transcript: true,
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    test('yields task_progress with summary + usage + lastToolName', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'task_progress',
          task_id: 't-1',
          description: 'Working on auth',
          summary: 'Reading auth module',
          usage: { total_tokens: 1234, tool_uses: 3, duration_ms: 28000 },
          last_tool_name: 'Read',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          type: 'task_progress',
          taskId: 't-1',
          description: 'Working on auth',
          summary: 'Reading auth module',
          usage: { total_tokens: 1234, tool_uses: 3, duration_ms: 28000 },
          lastToolName: 'Read',
        },
      ]);
    });

    test('yields task_notification with completed status', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'task_notification',
          task_id: 't-1',
          status: 'completed',
          output_file: '/tmp/task-output.json',
          summary: 'Plan ready',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          type: 'task_notification',
          taskId: 't-1',
          status: 'completed',
          summary: 'Plan ready',
          outputFile: '/tmp/task-output.json',
        },
      ]);
    });

    test('yields task_notification with failed status', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'task_notification',
          task_id: 't-2',
          status: 'failed',
          output_file: '/tmp/task-2.json',
          summary: 'Task failed',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toMatchObject({ type: 'task_notification', status: 'failed' });
    });

    // --- #2083 — background-task liveness (SDK 0.3.209 background_tasks_changed) ---

    test('yields background_tasks chunk from SDK background_tasks_changed', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [
            { task_id: 't-1', task_type: 'local_agent', description: 'Research problem A' },
            { task_id: 't-2', task_type: 'local_agent', description: 'Research problem B' },
          ],
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          type: 'background_tasks',
          tasks: [
            { taskId: 't-1', taskType: 'local_agent', description: 'Research problem A' },
            { taskId: 't-2', taskType: 'local_agent', description: 'Research problem B' },
          ],
        },
      ]);
    });

    test('forwards an EMPTY background_tasks_changed set (drain signal)', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'background_tasks_changed', tasks: [] };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      // An empty set means "all background work drained" — it must be forwarded,
      // not dropped, or the executor's wait gate would never release.
      expect(chunks).toEqual([{ type: 'background_tasks', tasks: [] }]);
    });

    test('keeps forwarding chunks that arrive AFTER the result (background-task wait window)', async () => {
      // Single-turn queries keep streaming after the turn-level result while
      // background tasks drain; streamClaudeMessages must not stop at result.
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [{ task_id: 't-1', task_type: 'local_agent', description: 'bg work' }],
        };
        yield { type: 'result', subtype: 'success', session_id: 's-1', is_error: false };
        yield {
          type: 'system',
          subtype: 'task_notification',
          task_id: 't-1',
          status: 'completed',
          output_file: '/tmp/t-1.md',
          summary: 'done',
        };
        yield { type: 'system', subtype: 'background_tasks_changed', tasks: [] };
        yield { type: 'result', subtype: 'success', session_id: 's-1', is_error: false };
      });

      const types = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        types.push(chunk.type);
      }

      expect(types).toEqual([
        'background_tasks',
        'result',
        'task_notification',
        'background_tasks',
        'result',
      ]);
    });

    test('yields hook_started chunk from SDK system message', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'hook_started',
          hook_id: 'h-1',
          hook_name: 'Bash',
          hook_event: 'PreToolUse',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          type: 'hook_started',
          hookId: 'h-1',
          hookName: 'Bash',
          hookEvent: 'PreToolUse',
        },
      ]);
    });

    test('yields hook_response chunk with outcome and exit code', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'hook_response',
          hook_id: 'h-1',
          hook_name: 'Bash',
          hook_event: 'PreToolUse',
          outcome: 'success',
          exit_code: 0,
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          type: 'hook_response',
          hookId: 'h-1',
          hookName: 'Bash',
          hookEvent: 'PreToolUse',
          outcome: 'success',
          exitCode: 0,
        },
      ]);
    });

    test('yields hook_response with error outcome and no exit_code', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'hook_response',
          hook_id: 'h-2',
          hook_name: 'Edit',
          hook_event: 'PreToolUse',
          outcome: 'error',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual({
        type: 'hook_response',
        hookId: 'h-2',
        hookName: 'Edit',
        hookEvent: 'PreToolUse',
        outcome: 'error',
      });
      expect(chunks[0]).not.toHaveProperty('exitCode');
    });

    test('emits complete task lifecycle in correct order', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'system',
          subtype: 'task_started',
          task_id: 't-1',
          description: 'Working on the bug',
        };
        yield {
          type: 'system',
          subtype: 'task_progress',
          task_id: 't-1',
          description: 'Working on the bug',
          summary: 'Reading stack trace',
        };
        yield {
          type: 'system',
          subtype: 'task_notification',
          task_id: 't-1',
          status: 'completed',
          output_file: '/tmp/t-1.json',
          summary: 'Done',
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks.map(c => c.type)).toEqual([
        'task_started',
        'task_progress',
        'task_notification',
      ]);
    });

    // --- Phase 4 of #975 — agentProgressSummaries enabled for workflow nodes -----

    test('enables agentProgressSummaries by default for workflow nodes', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty
      });

      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        nodeConfig: { nodeId: 'plan' },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options).toMatchObject({ agentProgressSummaries: true });
    });

    test('respects explicit agentProgressSummaries: false override', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty
      });

      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        nodeConfig: { nodeId: 'plan', agentProgressSummaries: false },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options).toMatchObject({ agentProgressSummaries: false });
    });

    test('does not set agentProgressSummaries for direct chat (no nodeConfig)', async () => {
      mockQuery.mockImplementation(async function* () {
        // Empty
      });

      for await (const _ of client.sendQuery('test', '/workspace')) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      // Phase 4 opt-in is for workflow nodes only. Direct chat keeps the
      // SDK default (false) so the chat surface is unchanged.
      expect(callArgs.options).not.toHaveProperty('agentProgressSummaries');
    });

    test('handles tool_use with empty input', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'SomeTool', input: undefined }],
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'tool',
        toolName: 'SomeTool',
        toolInput: {},
      });
    });

    test('ignores other message types', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'system', content: 'system message' };
        yield { type: 'thinking', content: 'thinking...' };
        yield { type: 'tool_result', content: 'result' };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Real response' }],
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      // Only the assistant message should be yielded
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'assistant',
        content: 'Real response',
        textMode: 'complete',
      });
    });

    test('enriches and logs error on SDK failure', async () => {
      const error = new Error('API connection failed');
      mockQuery.mockImplementation(async function* () {
        throw error;
      });

      const consumeGenerator = async () => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      // Error is enriched with classification prefix
      await expect(consumeGenerator()).rejects.toThrow(
        /Claude Code unknown: API connection failed/
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, errorClass: 'unknown' }),
        'query_error'
      );
    });

    test('subprocess env passes through all process.env keys (no allowlist filtering)', async () => {
      const originalKey = process.env.CUSTOM_USER_KEY;
      process.env.CUSTOM_USER_KEY = 'user-trusted-value';

      mockQuery.mockImplementation(async function* () {
        // Empty generator
      });

      for await (const _ of client.sendQuery('test', '/workspace')) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as {
        options: { env: NodeJS.ProcessEnv; executableArgs?: string[] };
      };
      // executableArgs is omitted when cliPath is undefined (dev mode, SDK
      // 0.2.x resolves a native binary). CWD .env leak protection comes
      // from stripCwdEnv() at entry, not from the --no-env-file flag.
      expect(callArgs.options.executableArgs).toBeUndefined();
      expect(callArgs.options.env.CUSTOM_USER_KEY).toBe('user-trusted-value');
      // Windows uses "Path" casing in spread objects and USERPROFILE instead of HOME
      const envPath = callArgs.options.env.PATH ?? callArgs.options.env.Path;
      const processPath = process.env.PATH ?? process.env.Path;
      expect(envPath).toBe(processPath);
      const envHome = callArgs.options.env.HOME ?? callArgs.options.env.USERPROFILE;
      const processHome = process.env.HOME ?? process.env.USERPROFILE;
      expect(envHome).toBe(processHome);

      // Cleanup
      if (originalKey !== undefined) process.env.CUSTOM_USER_KEY = originalKey;
      else delete process.env.CUSTOM_USER_KEY;
    });

    test('passes executableArgs: [--no-env-file] when cliPath ends in a Bun-runnable JS extension', async () => {
      // Belt-and-suspenders integration check: the dev-mode path is exercised
      // in the test above (executableArgs: undefined). This test exercises the
      // legacy explicit-cli.js path through the real buildBaseClaudeOptions
      // codepath, so a regression in the conditional spread would be caught.
      const spy = spyOn(binaryResolver, 'resolveClaudeBinaryPath').mockResolvedValue(
        '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'
      );

      mockQuery.mockImplementation(async function* () {
        // empty
      });

      for await (const _ of client.sendQuery('test', '/workspace')) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as {
        options: {
          executableArgs?: string[];
          pathToClaudeCodeExecutable?: string;
        };
      };
      expect(callArgs.options.executableArgs).toEqual(['--no-env-file']);
      expect(callArgs.options.pathToClaudeCodeExecutable).toBe(
        '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'
      );

      spy.mockRestore();
    });

    test('container run SKIPS host binary resolution (works when host Claude is absent)', async () => {
      // Simulate a compiled binary with no host Claude — resolveClaudeBinaryPath
      // would throw. A container run must NOT call it (Claude is baked into the
      // runner image; the SDK bypasses disk resolution via spawnClaudeCodeProcess).
      const spy = spyOn(binaryResolver, 'resolveClaudeBinaryPath').mockRejectedValue(
        new Error('Claude Code not found — set CLAUDE_BIN_PATH')
      );
      mockQuery.mockImplementation(async function* () {
        // empty
      });

      // Must not throw at resolution time.
      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        execContext: { kind: 'container', containerId: 'c-1' },
      })) {
        // consume
      }

      expect(spy).not.toHaveBeenCalled();
      const callArgs = mockQuery.mock.calls[0][0] as {
        options: { pathToClaudeCodeExecutable?: string; spawnClaudeCodeProcess?: unknown };
      };
      // SDK spawn hook is set; host disk path is omitted.
      expect(typeof callArgs.options.spawnClaudeCodeProcess).toBe('function');
      expect(callArgs.options.pathToClaudeCodeExecutable).toBeUndefined();

      spy.mockRestore();
    });

    test('classifies exit code errors as crash and retries up to 3 times', async () => {
      const error = new Error('process exited with code 1');
      mockQuery.mockImplementation(async function* () {
        throw error;
      });

      const consumeGenerator = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      // Crash errors get retried then enriched
      await expect(consumeGenerator()).rejects.toThrow(/Claude Code crash/);
      // Should have been called 4 times (initial + 3 retries)
      expect(mockQuery).toHaveBeenCalledTimes(4);
    }, 5_000);

    test('recovers from transient crash on retry', async () => {
      let callCount = 0;
      mockQuery.mockImplementation(async function* () {
        callCount++;
        if (callCount <= 2) {
          throw new Error('process exited with code 1');
        }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Recovered!' }] },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      // Should succeed on the 3rd attempt
      expect(callCount).toBe(3);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'assistant', content: 'Recovered!', textMode: 'complete' });
    }, 5_000);

    test('classifies auth errors as fatal (no retry)', async () => {
      const error = new Error('unauthorized');
      mockQuery.mockImplementation(async function* () {
        throw error;
      });

      const consumeGenerator = async () => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      await expect(consumeGenerator()).rejects.toThrow(/Claude Code auth error/);
      // Should NOT retry - verify single call
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('does not retry unknown errors', async () => {
      const error = new Error('something unexpected');
      mockQuery.mockImplementation(async function* () {
        throw error;
      });

      const consumeGenerator = async () => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      await expect(consumeGenerator()).rejects.toThrow(/Claude Code unknown/);
      // Unknown errors are not retried
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('classifies "Operation aborted" errors as crash and retries', async () => {
      const error = new Error('Operation aborted');
      mockQuery.mockImplementation(async function* () {
        throw error;
      });

      const consumeGenerator = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      // crash classification = retried up to 3 times -> 4 total calls
      await expect(consumeGenerator()).rejects.toThrow(/Claude Code crash/);
      expect(mockQuery).toHaveBeenCalledTimes(4);
    }, 5_000);

    test('classifies mixed-case "OPERATION ABORTED" errors as crash', async () => {
      const error = new Error('OPERATION ABORTED');
      mockQuery.mockImplementation(async function* () {
        throw error;
      });

      const consumeGenerator = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      await expect(consumeGenerator()).rejects.toThrow(/Claude Code crash/);
      expect(mockQuery).toHaveBeenCalledTimes(4);
    }, 5_000);

    test('captures all stderr output for diagnostics', async () => {
      mockQuery.mockImplementation(async function* (args: {
        options: { stderr?: (data: string) => void };
      }) {
        // Simulate non-error stderr output followed by crash
        if (args.options.stderr) {
          args.options.stderr('Spawning Claude Code process: node cli.js');
          args.options.stderr('AJV validation: schema loaded');
          args.options.stderr('startup diagnostic: ready');
        }
        throw new Error('process exited with code 1');
      });

      const consumeGenerator = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      };

      // Use rejects so assertions always execute
      const err = await consumeGenerator().catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      // The error should contain stderr context from ALL captured lines
      expect(err.message).toContain('stderr:');
      expect(err.message).toContain('AJV validation');
      expect(err.message).toContain('startup diagnostic');
    }, 5_000);

    test('passes settingSources from assistantConfig', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'test-session' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        assistantConfig: { settingSources: ['project', 'user'] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.settingSources).toEqual(['project', 'user']);
    });

    test('defaults settingSources to project + user when not provided', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'test-session' };
      });

      for await (const _ of client.sendQuery('test', '/tmp')) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.settingSources).toEqual(['project', 'user']);
    });

    test("honors explicit settingSources: ['project'] to opt out of user scope", async () => {
      // Locks in the contract: setting settingSources: ['project'] in
      // .archon/config.yaml must NOT be silently widened to the new default.
      // A future refactor that drops the `?? ['project', 'user']` guard would
      // expand skill/command/agent scope for every project-only deployment.
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'test-session' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        assistantConfig: { settingSources: ['project'] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.settingSources).toEqual(['project']);
    });

    test('honors assistant-level settingSources: [] without widening to defaults', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'test-session' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        assistantConfig: { settingSources: [] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.settingSources).toEqual([]);
    });

    test('per-node settingSources override wins over the assistant default', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'test-session' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { settingSources: ['project'] },
        assistantConfig: { settingSources: ['project', 'user'] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.settingSources).toEqual(['project']);
    });

    test('per-node settingSources applies when no assistant default is set', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'test-session' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { settingSources: [] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      // An explicit empty array is a valid opt-out of ALL setting sources —
      // it must not fall through to the ['project', 'user'] default.
      expect(callArgs.options.settingSources).toEqual([]);
    });

    test('passes env from requestOptions into SDK options', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        env: { MY_SECRET: 'abc123' },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      const env = callArgs.options.env as Record<string, string>;
      expect(env.MY_SECRET).toBe('abc123');
      // Verify process.env entries are still present (not fully replaced)
      // Windows uses 'Path' instead of 'PATH'
      expect(env.PATH ?? env.Path).toBeDefined();
    });

    test('requestOptions.env overrides buildSubprocessEnv values', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      // HOME is always in process.env -- override it to verify priority
      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        env: { HOME: '/custom/home' },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      const env = callArgs.options.env as Record<string, string>;
      expect(env.HOME).toBe('/custom/home');
    });

    describe('CLAUDE_API_KEY -> ANTHROPIC_API_KEY mapping', () => {
      const ENV_KEYS_UNDER_TEST = [
        'CLAUDE_API_KEY',
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ] as const;
      let savedEnv: Partial<Record<(typeof ENV_KEYS_UNDER_TEST)[number], string>>;

      beforeEach(() => {
        savedEnv = {};
        for (const key of ENV_KEYS_UNDER_TEST) savedEnv[key] = process.env[key];
      });

      afterEach(() => {
        for (const key of ENV_KEYS_UNDER_TEST) {
          const value = savedEnv[key];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });

      test('maps when only the API key is set', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        process.env.CLAUDE_API_KEY = 'sk-test';

        for await (const _ of client.sendQuery('test', '/tmp')) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.CLAUDE_API_KEY).toBe('sk-test');
        expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
        // Only the subprocess env copy is written — never process.env itself
        expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
      });

      test('does not clobber an explicit ANTHROPIC_API_KEY', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        process.env.CLAUDE_API_KEY = 'sk-a';
        process.env.ANTHROPIC_API_KEY = 'sk-b';

        for await (const _ of client.sendQuery('test', '/tmp')) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.ANTHROPIC_API_KEY).toBe('sk-b');
      });

      test('OAuth token wins — no injection', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.ANTHROPIC_API_KEY;
        process.env.CLAUDE_API_KEY = 'sk-a';
        process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-x';

        for await (const _ of client.sendQuery('test', '/tmp')) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      });

      test('no key, no injection', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.CLAUDE_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

        for await (const _ of client.sendQuery('test', '/tmp')) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      });

      test('requestOptions.env still wins over the mapping', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        process.env.CLAUDE_API_KEY = 'sk-a';

        for await (const _ of client.sendQuery('test', '/tmp', undefined, {
          env: { ANTHROPIC_API_KEY: 'sk-override' },
        })) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.ANTHROPIC_API_KEY).toBe('sk-override');
      });

      test('per-user subscription via requestOptions.env suppresses the mirror', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        process.env.CLAUDE_API_KEY = 'sk-install-fallback';

        // Exact shape produced by deliverCredential()'s anthropic oauth branch:
        // the delivered env carries OAuth tokens only, never ANTHROPIC_API_KEY.
        // The mirror must not inject the install key alongside the user's
        // subscription token (the CLI would prefer the API key and rebill).
        for await (const _ of client.sendQuery('test', '/tmp', undefined, {
          env: {
            CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-user',
            ANTHROPIC_OAUTH_TOKEN: 'sk-ant-oat01-user',
          },
        })) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-user');
      });

      test('treats an empty-string ANTHROPIC_API_KEY as missing', async () => {
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        process.env.CLAUDE_API_KEY = 'sk-test';
        process.env.ANTHROPIC_API_KEY = '';

        for await (const _ of client.sendQuery('test', '/tmp')) {
          // consume
        }

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        const env = callArgs.options.env as Record<string, string>;
        expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
      });
    });

    test('passes raw effort to SDK via nodeConfig unchanged', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { effort: '  future-claude  ' },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.effort).toBe('  future-claude  ');
    });

    test('rejects an explicitly empty effort before invoking the SDK', async () => {
      const consume = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/tmp', undefined, {
          nodeConfig: { effort: '' },
        })) {
          // consume
        }
      };

      await expect(consume()).rejects.toThrow('non-empty string');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('omits effort from SDK when not provided in nodeConfig', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp')) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options).not.toHaveProperty('effort');
    });

    test('passes raw effort values to the SDK', async () => {
      for (const declared of ['xhigh', 'minimal', 'max'] as const) {
        mockQuery.mockClear();
        mockQuery.mockImplementation(async function* () {
          yield { type: 'result', session_id: 'sid' };
        });

        for await (const _ of client.sendQuery('test', '/tmp', undefined, {
          nodeConfig: { effort: declared },
        })) {
          // consume
        }

        const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
        expect(callArgs.options.effort).toBe(declared);
      }
    });

    test('passes a future provider effort value to the SDK', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { effort: 'off' },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.effort).toBe('off');
    });

    test('passes thinking object to SDK via nodeConfig', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { thinking: { type: 'enabled', budgetTokens: 8000 } },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.thinking).toEqual({ type: 'enabled', budgetTokens: 8000 });
    });

    test('passes maxBudgetUsd to SDK', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, { maxBudgetUsd: 5.0 })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.maxBudgetUsd).toBe(5.0);
    });

    test('passes systemPrompt string to SDK overriding preset', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        systemPrompt: 'You are a security reviewer',
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.systemPrompt).toBe('You are a security reviewer');
    });

    test('uses claude_code preset systemPrompt when not overridden', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp')) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    });

    test('passes fallbackModel to SDK', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        fallbackModel: 'claude-haiku-4-5',
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.fallbackModel).toBe('claude-haiku-4-5');
    });

    test('passes betas array to SDK via nodeConfig', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { betas: ['context-1m-2025-08-07'] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.betas).toEqual(['context-1m-2025-08-07']);
    });

    test('passes sandbox object to SDK via nodeConfig', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      const sandbox = { enabled: true, network: { allowedDomains: [] } };

      for await (const _ of client.sendQuery('test', '/tmp', undefined, {
        nodeConfig: { sandbox },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.sandbox).toEqual(sandbox);
    });

    test('ignores empty text blocks', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: '' },
              { type: 'text', text: 'Real content' },
            ],
          },
        };
      });

      const chunks = [];
      for await (const chunk of client.sendQuery('test', '/workspace')) {
        chunks.push(chunk);
      }

      // Empty text should be filtered out
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'assistant',
        content: 'Real content',
        textMode: 'complete',
      });
    });
  });
});

describe('withFirstMessageTimeout', () => {
  const { withFirstMessageTimeout } = claudeModule;

  test('completes normally when first event arrives before timeout', async () => {
    async function* fastGen(): AsyncGenerator<string> {
      yield 'hello';
      yield 'world';
    }
    const controller = new AbortController();
    const gen = withFirstMessageTimeout(fastGen(), controller, 50, {});
    const first = await gen.next();
    expect(first.value).toBe('hello');
    const second = await gen.next();
    expect(second.value).toBe('world');
  });

  test('throws after timeout when generator never yields', async () => {
    async function* stuckGen(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }
    const controller = new AbortController();
    const gen = withFirstMessageTimeout(stuckGen(), controller, 50, {});
    await expect(gen.next()).rejects.toThrow('produced no output within 50ms');
  });

  test('timeout error mentions issue #1067 for discoverability', async () => {
    async function* stuckGen(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }
    const controller = new AbortController();
    const gen = withFirstMessageTimeout(stuckGen(), controller, 50, {});
    await expect(gen.next()).rejects.toThrow('1067');
  });

  test('aborts the controller when timeout fires', async () => {
    async function* stuckGen(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }
    const controller = new AbortController();
    const gen = withFirstMessageTimeout(stuckGen(), controller, 50, {});
    await expect(gen.next()).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
  });

  test('closes query when timeout fires before the first event', async () => {
    async function* stuckGen(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }
    const close = mock(() => {});
    const source = stuckGen() as AsyncGenerator<string> & { close: () => void };
    source.close = close;
    const controller = new AbortController();
    const gen = withFirstMessageTimeout(source, controller, 50, {});

    await expect(gen.next()).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('handles generator that completes immediately without yielding', async () => {
    async function* emptyGen(): AsyncGenerator<string> {
      return;
    }
    const controller = new AbortController();
    const gen = withFirstMessageTimeout(emptyGen(), controller, 50, {});
    const result = await gen.next();
    expect(result.done).toBe(true);
  });

  test('logs diagnostic payload with env keys and process state on timeout', async () => {
    async function* stuckGen(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }
    const controller = new AbortController();
    const diagnostics = {
      subprocessEnvKeys: ['PATH', 'HOME', 'CLAUDE_API_KEY'],
      parentClaudeKeys: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'],
      model: 'sonnet',
      platform: 'darwin',
    };
    const gen = withFirstMessageTimeout(stuckGen(), controller, 50, diagnostics);
    await expect(gen.next()).rejects.toThrow();

    // Verify the diagnostic dump was logged at error level
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        subprocessEnvKeys: ['PATH', 'HOME', 'CLAUDE_API_KEY'],
        parentClaudeKeys: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'],
        model: 'sonnet',
        platform: 'darwin',
        timeoutMs: 50,
      }),
      'claude.first_event_timeout'
    );
  });
});

// ─── Behavioral regression tests (black-box via sendQuery) ───────────────
// These cover specific fixes from the sendQuery decomposition review:
// timeout preservation, one-time warnings, abort forwarding, error enrichment.

describe('sendQuery decomposition behaviors', () => {
  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  test('preserves first-event timeout error instead of generic abort', async () => {
    // withFirstMessageTimeout aborts the controller then throws.
    // classifyAndEnrichError must preserve the timeout message, not "Query aborted".
    mockQuery.mockImplementation(async function* () {
      await new Promise(() => {}); // hang forever
      yield { type: 'result', session_id: 'never' };
    });

    const consumeGenerator = async (): Promise<void> => {
      // Use env var to set a short timeout for the test
      const original = process.env.ARCHON_CLAUDE_FIRST_EVENT_TIMEOUT_MS;
      process.env.ARCHON_CLAUDE_FIRST_EVENT_TIMEOUT_MS = '50';
      try {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      } finally {
        if (original !== undefined) process.env.ARCHON_CLAUDE_FIRST_EVENT_TIMEOUT_MS = original;
        else delete process.env.ARCHON_CLAUDE_FIRST_EVENT_TIMEOUT_MS;
      }
    };

    await expect(consumeGenerator()).rejects.toThrow('produced no output within');
    // Must NOT be "Query aborted"
    await expect(consumeGenerator()).rejects.not.toThrow('Query aborted');
  });

  test('emits nodeConfig warnings only once even when retries occur', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(async function* () {
      callCount++;
      if (callCount <= 2) {
        throw new Error('process exited with code 1'); // crash → retried
      }
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'ok' }] },
      };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
      nodeConfig: { effort: 'high' },
    })) {
      chunks.push(chunk);
    }

    // nodeConfig with effort doesn't produce warnings, but let's verify
    // no system chunks are duplicated. Use a nodeConfig that doesn't warn.
    // The point is: zero warning chunks means zero, not zero × 3 retries.
    const systemChunks = chunks.filter(c => c.type === 'system');
    expect(systemChunks).toHaveLength(0);
    expect(callCount).toBe(3); // Confirms retries happened
  }, 5_000);

  test('abort signal cancels query across retries without listener leak', async () => {
    const abortController = new AbortController();
    let callCount = 0;

    mockQuery.mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        // First attempt crashes → triggers retry. Abort during the retry delay
        // so the next iteration's abortSignal.aborted check catches it.
        setTimeout(() => abortController.abort(), 0);
        throw new Error('process exited with code 1');
      }
      // Should not reach here — abort fires before retry starts
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'should not reach' }] },
      };
    });

    const consumeGenerator = async (): Promise<void> => {
      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        abortSignal: abortController.signal,
      })) {
        // consume
      }
    };

    await expect(consumeGenerator()).rejects.toThrow('Query aborted');
    // Single abort listener registered (not per-retry)
    expect(callCount).toBe(1);
  }, 5_000);

  test('abort signal closes the active SDK query', async () => {
    const abortController = new AbortController();
    let resolvePendingNext: ((value: IteratorResult<unknown>) => void) | undefined;
    let nextCalls = 0;
    const close = mock(() => {
      resolvePendingNext?.({ done: true, value: undefined });
    });
    const source = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: mock(() => {
        nextCalls++;
        if (nextCalls === 1) {
          return Promise.resolve({
            done: false,
            value: {
              type: 'assistant',
              message: { content: [{ type: 'text', text: 'first' }] },
            },
          });
        }
        return new Promise<IteratorResult<unknown>>(resolve => {
          resolvePendingNext = resolve;
        });
      }),
      return: mock(async () => ({ done: true, value: undefined })),
      throw: mock(async (err?: unknown) => {
        throw err;
      }),
      close,
    };
    mockQuery.mockImplementation(() => source);

    const chunks = [];
    const consumeGenerator = async (): Promise<void> => {
      for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
        abortSignal: abortController.signal,
      })) {
        chunks.push(chunk);
      }
    };

    const consuming = consumeGenerator();
    for (let i = 0; i < 10 && chunks.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    abortController.abort();
    await consuming;

    expect(chunks).toEqual([{ type: 'assistant', content: 'first', textMode: 'complete' }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('enriched error (with stderr) is thrown at retry exhaustion, not raw error', async () => {
    mockQuery.mockImplementation(async function* (args: {
      options: { stderr?: (data: string) => void };
    }) {
      if (args.options.stderr) {
        args.options.stderr('diagnostic: something broke');
      }
      throw new Error('process exited with code 1');
    });

    const consumeGenerator = async (): Promise<void> => {
      for await (const _ of client.sendQuery('test', '/workspace')) {
        // consume
      }
    };

    const err = await consumeGenerator().catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    // Must contain stderr context, not just the raw error
    expect(err.message).toContain('stderr:');
    expect(err.message).toContain('diagnostic: something broke');
  }, 5_000);

  test('PostToolUse hooks preserve success, failure, and interruption outcomes', async () => {
    mockQuery.mockImplementation(async function* (args: {
      options: {
        hooks?: Record<string, Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }>>;
      };
    }) {
      const successHook = args.options.hooks?.PostToolUse?.[0]?.hooks?.[0];
      const failureHook = args.options.hooks?.PostToolUseFailure?.[0]?.hooks?.[0];
      await successHook?.({ tool_name: 'Read', tool_use_id: 'success-id', tool_response: 'ok' });
      await failureHook?.({
        tool_name: 'Bash',
        tool_use_id: 'error-id',
        error: 'exit 1',
        is_interrupt: false,
      });
      await failureHook?.({
        tool_name: 'Task',
        tool_use_id: 'interrupt-id',
        error: 'stopped',
        is_interrupt: true,
      });
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) chunks.push(chunk);

    expect(chunks.slice(0, 3)).toEqual([
      {
        type: 'tool_result',
        toolName: 'Read',
        toolOutput: 'ok',
        toolCallId: 'success-id',
        toolOutcome: 'success',
        outputState: 'full',
      },
      {
        type: 'tool_result',
        toolName: 'Bash',
        toolOutput: '❌ Error: exit 1',
        toolCallId: 'error-id',
        toolOutcome: 'error',
        outputState: 'full',
      },
      {
        type: 'tool_result',
        toolName: 'Task',
        toolOutput: '⚠️ Interrupted: stopped',
        toolCallId: 'interrupt-id',
        toolOutcome: 'interrupted',
        outputState: 'full',
      },
    ]);
  });

  test('terminal tool result queue drain preserves hook outcome', async () => {
    mockQuery.mockImplementation(async function* (args: {
      options: {
        hooks?: Record<string, Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }>>;
      };
    }) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };
      const successHook = args.options.hooks?.PostToolUse?.[0]?.hooks?.[0];
      await successHook?.({ tool_name: 'Read', tool_use_id: 'late-id', tool_response: 'ok' });
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) chunks.push(chunk);

    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'Read',
      toolOutput: 'ok',
      toolCallId: 'late-id',
      toolOutcome: 'success',
      outputState: 'full',
    });
  });

  test('PostToolUse hook handles circular reference without crashing', async () => {
    mockQuery.mockImplementation(async function* (args: {
      options: {
        hooks?: Record<string, Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }>>;
      };
    }) {
      // Simulate a tool use that triggers the PostToolUse hook with circular data
      const hooks = args.options.hooks?.PostToolUse;
      if (hooks?.[0]?.hooks?.[0]) {
        const circular: Record<string, unknown> = { key: 'val' };
        circular.self = circular; // circular reference
        await hooks[0].hooks[0]({
          tool_name: 'TestTool',
          tool_use_id: 'tc-circ',
          tool_response: circular,
        });
      }
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'done' }] },
      };
    });

    // Should not throw — the try/catch in PostToolUse should handle the circular ref
    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) {
      chunks.push(chunk);
    }

    // The assistant message should still come through
    expect(chunks.some(c => c.type === 'assistant')).toBe(true);
    // The error should be logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'claude.post_tool_use_hook_error'
    );
  });

  test('logs is_error result events at error level', async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'result',
        session_id: 'sid-err',
        is_error: true,
        subtype: 'max_turns',
      };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'max_turns',
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sid-err', errorSubtype: 'max_turns' }),
      'claude.result_is_error'
    );
  });

  test('treats is_error: true + subtype: success as clean success (stop_sequence)', async () => {
    // Claude Agent SDK's SDKResultSuccess explicitly types is_error as boolean
    // (not literal false). When a model is configured with stop sequences (e.g.
    // via output_format / json_schema enforcement) the SDK reports is_error:
    // true alongside subtype: 'success' and stop_reason: 'stop_sequence' — its
    // way of signalling "non-default termination, but not a failure".
    // Regression test for #1425.
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'result',
        session_id: 'sid-stop-seq',
        is_error: true,
        subtype: 'success',
        stop_reason: 'stop_sequence',
      };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'result',
      sessionId: 'sid-stop-seq',
      stopReason: 'stop_sequence',
    });
    expect(chunks[0]).not.toHaveProperty('isError');
    expect(chunks[0]).not.toHaveProperty('errorSubtype');
    expect(chunks[0]).not.toHaveProperty('errors');
    expect(mockLogger.error).not.toHaveBeenCalledWith(expect.anything(), 'claude.result_is_error');
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sid-stop-seq', stopReason: 'stop_sequence' }),
      'claude.result_success_validated'
    );
  });

  describe('inline agents (nodeConfig.agents)', () => {
    let workflowCwd: string;

    beforeEach(() => {
      workflowCwd = mkdtempSync(join(tmpdir(), 'archon-claude-workflow-'));
    });

    afterEach(() => {
      rmSync(workflowCwd, { recursive: true, force: true });
    });

    const stageClaudeSkill = (name: string): void => {
      const dir = join(workflowCwd, '.claude', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`);
    };

    test('passes inline agents map through to SDK options.agents', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      const agents = {
        'brief-gen': {
          description: 'Summarises issues',
          prompt: 'Be concise.',
          model: 'haiku',
          tools: ['Bash', 'Read'],
        },
      };

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: { nodeId: 'agent-node', agents },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.agents).toMatchObject(agents);
    });

    test('does not set options.agent when only inline agents are present', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: {
          nodeId: 'agent-node',
          agents: {
            'sub-a': { description: 'd', prompt: 'p' },
          },
        },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.agent).toBeUndefined();
      expect(callArgs.options.agents).toMatchObject({
        'sub-a': { description: 'd', prompt: 'p' },
      });
    });

    test('workflow omission selects no skills and enables strict MCP', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: { nodeId: 'closed-node' },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.agent).toBeUndefined();
      expect(callArgs.options.agents).toBeUndefined();
      expect(callArgs.options.allowedTools).toBeUndefined();
      expect(callArgs.options.skills).toEqual([]);
      expect(callArgs.options.strictMcpConfig).toBe(true);
      expect(callArgs.options.mcpServers).toBeUndefined();
    });

    test('passes exact native skill selection while preserving inline agents', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      stageClaudeSkill('my-skill');

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: {
          nodeId: 'skilled-node',
          skills: ['my-skill'],
          agents: {
            'extra-sub': { description: 'd', prompt: 'p' },
          },
        },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.skills).toEqual(['my-skill']);
      expect(callArgs.options.agent).toBeUndefined();
      expect(callArgs.options.agents).toEqual({
        'extra-sub': { description: 'd', prompt: 'p' },
      });
    });

    test('native skills without allowed_tools leave the SDK tool set unrestricted', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      stageClaudeSkill('agent-browser');
      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: {
          nodeId: 'skilled-node',
          skills: ['agent-browser'],
          // no allowed_tools → options.tools is undefined
        },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.skills).toEqual(['agent-browser']);
      expect(callArgs.options.tools).toBeUndefined();
    });

    test('skills with allowed_tools includes Skill in the tools list', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      stageClaudeSkill('agent-browser');
      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: {
          nodeId: 'skilled-node',
          skills: ['agent-browser'],
          allowed_tools: ['Bash', 'Read'],
        },
      })) {
        // consume
      }

      const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
      expect(callArgs.options.tools).toEqual(['Bash', 'Read', 'Skill']);
      expect(callArgs.options.allowedTools).toContain('Skill');
    });

    test('fails before querying when a declared skill is unavailable to Claude', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      const agentsOnly = join(workflowCwd, '.agents', 'skills', 'my-skill');
      mkdirSync(agentsOnly, { recursive: true });
      writeFileSync(join(agentsOnly, 'SKILL.md'), '# agents only\n');

      let error: unknown;
      try {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          nodeConfig: { nodeId: 'missing-skill', skills: ['my-skill'] },
        })) {
          // consume
        }
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('.claude/skills/');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('warns but still runs when a declared skill is on no root at all', async () => {
      // Claude's built-in skills and `plugin:skill` names resolve inside the SDK
      // and exist under no skills directory. Throwing on "absent from disk" made
      // every one of them undeclarable (PR #2535 review), so an unresolved name
      // warns and lets the SDK decide.
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      const chunks: string[] = [];
      for await (const chunk of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: { nodeId: 'builtin-skill', skills: ['dataviz'] },
      })) {
        if (chunk.type === 'system') chunks.push(chunk.content ?? '');
      }

      expect(mockQuery).toHaveBeenCalled();
      const callArgs = mockQuery.mock.calls[0]![0] as { options: Options };
      expect(callArgs.options.skills).toEqual(['dataviz']);
      expect(chunks.join('\n')).toContain('built-in');
    });

    test('names only the unreachable skill when a built-in is declared alongside it', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      const agentsOnly = join(workflowCwd, '.agents', 'skills', 'stranded-skill');
      mkdirSync(agentsOnly, { recursive: true });
      writeFileSync(join(agentsOnly, 'SKILL.md'), '# agents only\n');

      let error: unknown;
      try {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          nodeConfig: { nodeId: 'mixed', skills: ['dataviz', 'stranded-skill'] },
        })) {
          // consume
        }
      } catch (caught) {
        error = caught;
      }

      // 'dataviz' resolves nowhere on disk and may be a built-in, so it must not
      // be blamed in an error about a misplaced install.
      expect((error as Error).message).toContain('stranded-skill');
      expect((error as Error).message).not.toContain('dataviz');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('resolves user skills from the effective CLAUDE_CONFIG_DIR on host', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      const configDir = join(workflowCwd, 'custom-claude-config');
      const skillDir = join(configDir, 'skills', 'custom-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# custom\n');

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        env: { CLAUDE_CONFIG_DIR: configDir },
        nodeConfig: { nodeId: 'custom-config', skills: ['custom-skill'] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const options = (mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }).options;
      expect(options.skills).toEqual(['custom-skill']);
    });

    test('rejects a user-only skill when effective settingSources is project-only', async () => {
      const configDir = join(workflowCwd, 'project-only-config');
      const skillDir = join(configDir, 'skills', 'user-only');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# user only\n');

      const consume = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          env: { CLAUDE_CONFIG_DIR: configDir },
          assistantConfig: { settingSources: ['project'] },
          nodeConfig: { nodeId: 'project-only', skills: ['user-only'] },
        })) {
          // consume
        }
      };

      await expect(consume()).rejects.toThrow(/enabled Claude-native skill directory/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('rejects a project-only skill when per-node settingSources is user-only', async () => {
      stageClaudeSkill('project-only');

      const consume = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          nodeConfig: {
            nodeId: 'user-only',
            skills: ['project-only'],
            settingSources: ['user'],
          },
        })) {
          // consume
        }
      };

      await expect(consume()).rejects.toThrow(/enabled Claude-native skill directory/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('rejects every declared skill when effective settingSources is empty', async () => {
      stageClaudeSkill('disabled');

      const consume = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          assistantConfig: { settingSources: ['project', 'user'] },
          nodeConfig: { nodeId: 'no-sources', skills: ['disabled'], settingSources: [] },
        })) {
          // consume
        }
      };

      await expect(consume()).rejects.toThrow(/effective settingSources currently enables none/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('assistant-level empty settingSources rejects every declared workflow skill', async () => {
      stageClaudeSkill('assistant-disabled');

      const consume = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          assistantConfig: { settingSources: [] },
          nodeConfig: { nodeId: 'assistant-no-sources', skills: ['assistant-disabled'] },
        })) {
          // consume
        }
      };

      await expect(consume()).rejects.toThrow(/effective settingSources currently enables none/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('container workflows fail before spend for a host user-only skill', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      const configDir = join(workflowCwd, 'host-claude-config');
      const skillDir = join(configDir, 'skills', 'user-only');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# user only\n');

      let error: unknown;
      try {
        for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
          env: { CLAUDE_CONFIG_DIR: configDir },
          execContext: { kind: 'container', containerId: 'c-1' },
          nodeConfig: { nodeId: 'container-skill', skills: ['user-only'] },
        })) {
          // consume
        }
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Container workflows');
      expect((error as Error).message).toContain('project-local .claude/skills/');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('container workflows accept a declared project-local skill', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      stageClaudeSkill('container-project-skill');

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        execContext: { kind: 'container', containerId: 'c-1' },
        nodeConfig: { nodeId: 'container-project', skills: ['container-project-skill'] },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const options = (mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }).options;
      expect(options.skills).toEqual(['container-project-skill']);
      expect(options.strictMcpConfig).toBe(true);
    });

    test('retries preserve exact declared skill, MCP, and tool restrictions', async () => {
      let attempt = 0;
      mockQuery.mockImplementation(async function* () {
        attempt++;
        if (attempt === 1) throw new Error('process exited with code 1');
        yield { type: 'result', session_id: 'sid' };
      });
      stageClaudeSkill('retry-skill');
      const mcpPath = join(workflowCwd, 'retry-mcp.json');
      writeFileSync(mcpPath, JSON.stringify({ exact: { command: 'node', args: ['server.js'] } }));

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: {
          nodeId: 'retry-node',
          skills: ['retry-skill'],
          mcp: mcpPath,
          allowed_tools: ['Read'],
        },
      })) {
        // consume
      }

      expect(mockQuery).toHaveBeenCalledTimes(2);
      for (const call of mockQuery.mock.calls) {
        const options = (call[0] as { options: Record<string, unknown> }).options;
        expect(options.skills).toEqual(['retry-skill']);
        expect(options.strictMcpConfig).toBe(true);
        expect(options.mcpServers).toEqual({
          exact: { command: 'node', args: ['server.js'] },
        });
        expect(options.tools).toEqual(['Read', 'Skill']);
        expect(options.allowedTools).toHaveLength(2);
        expect(options.allowedTools).toEqual(expect.arrayContaining(['Skill', 'mcp__exact__*']));
      }
    });

    test('uses the same closed capability options when resuming', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for (const sessionId of [undefined, 'resume-me']) {
        for await (const _ of client.sendQuery('test', workflowCwd, sessionId, {
          nodeConfig: { nodeId: 'closed-node' },
        })) {
          // consume
        }
      }

      expect(mockQuery).toHaveBeenCalledTimes(2);
      for (const call of mockQuery.mock.calls) {
        const options = (call[0] as { options: Record<string, unknown> }).options;
        expect(options.skills).toEqual([]);
        expect(options.strictMcpConfig).toBe(true);
      }
      const resumedOptions = (mockQuery.mock.calls[1][0] as { options: Record<string, unknown> })
        .options;
      expect(resumedOptions.resume).toBe('resume-me');
    });

    test('strict MCP passes exactly the workflow-declared server map', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });
      const mcpPath = join(workflowCwd, 'mcp.json');
      writeFileSync(
        mcpPath,
        JSON.stringify({ declared: { command: 'node', args: ['server.mjs'] } })
      );

      for await (const _ of client.sendQuery('test', workflowCwd, undefined, {
        nodeConfig: { nodeId: 'mcp-node', mcp: mcpPath },
      })) {
        // consume
      }

      const options = (mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }).options;
      expect(options.strictMcpConfig).toBe(true);
      expect(Object.keys(options.mcpServers as Record<string, unknown>)).toEqual(['declared']);
      expect(options.allowedTools).toContain('mcp__declared__*');
    });

    test('keeps partial non-workflow nodeConfig on ambient defaults', async () => {
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('title', workflowCwd, undefined, {
        nodeConfig: { allowed_tools: [] },
      })) {
        // consume
      }

      const options = (mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }).options;
      expect(options.skills).toBeUndefined();
      expect(options.strictMcpConfig).toBeUndefined();
      expect(options.tools).toEqual([]);
    });

    test('does not grant Skill to a non-workflow call that carries skills', async () => {
      // The `options.skills` narrowing is gated on the workflow path. Granting
      // the Skill tool outside that gate would expose the whole ambient catalog
      // instead of a declared subset (PR #2535 review).
      mockQuery.mockImplementation(async function* () {
        yield { type: 'result', session_id: 'sid' };
      });

      for await (const _ of client.sendQuery('title', workflowCwd, undefined, {
        nodeConfig: { allowed_tools: ['Read'], skills: ['my-skill'] },
      })) {
        // consume
      }

      const options = (mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }).options;
      expect(options.skills).toBeUndefined();
      expect(options.tools).toEqual(['Read']);
      expect(options.allowedTools ?? []).not.toContain('Skill');
    });
  });
});

// ─── Turn interrupt (native seam) ────────────────────────────────────────
// Operator "Stop" ends only the current Claude turn via Query.interrupt();
// the workflow node stays running. interruptSignal is the turn-scoped signal;
// abortSignal remains the node-level Cancel that still aborts the SDK
// controller and closes the query.

/** Fake SDK Query: the test pushes events/results/errors, interrupt() and
 *  close() are observable mocks. Mirrors the streaming-input Query surface. */
class FakeQuery {
  private queue: Array<
    { kind: 'result'; value: IteratorResult<unknown> } | { kind: 'error'; error: unknown }
  > = [];
  private waiter:
    | {
        resolve: (value: IteratorResult<unknown>) => void;
        reject: (error: unknown) => void;
      }
    | undefined;
  interrupt = mock(async (): Promise<{ still_queued: string[] }> => ({ still_queued: [] }));
  close = mock((): void => {
    this.push({ done: true, value: undefined });
  });

  push(value: IteratorResult<unknown>): void {
    this.deliver({ kind: 'result', value });
  }
  pushError(error: unknown): void {
    this.deliver({ kind: 'error', error });
  }
  private deliver(
    item: { kind: 'result'; value: IteratorResult<unknown> } | { kind: 'error'; error: unknown }
  ): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) {
      if (item.kind === 'error') waiter.reject(item.error);
      else waiter.resolve(item.value);
    } else {
      this.queue.push(item);
    }
  }

  next = (): Promise<IteratorResult<unknown>> => {
    const item = this.queue.shift();
    if (item) {
      return item.kind === 'error' ? Promise.reject(item.error) : Promise.resolve(item.value);
    }
    return new Promise<IteratorResult<unknown>>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  };
  return = async (): Promise<IteratorResult<unknown>> => {
    this.push({ done: true, value: undefined });
    return { done: true, value: undefined };
  };
  throw = async (err?: unknown): Promise<IteratorResult<unknown>> => {
    throw err;
  };
  [Symbol.asyncIterator]() {
    return this;
  }
}

async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe('turn interrupt (native seam)', () => {
  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  test('without interruptSignal the SDK receives the existing string prompt', async () => {
    let capturedPrompt: unknown;
    mockQuery.mockImplementation((args: { prompt: unknown }) => {
      capturedPrompt = args.prompt;
      return (async function* () {
        yield { type: 'result', session_id: 'sid-string' };
      })();
    });

    for await (const _ of client.sendQuery('test prompt', '/workspace')) {
      // consume
    }

    expect(capturedPrompt).toBe('test prompt');
  });

  test('with interruptSignal the SDK receives a one-message AsyncIterable<SDKUserMessage> held open for the query lifetime', async () => {
    const interruptController = new AbortController();
    let capturedPrompt: unknown;
    let secondNextObservedPending = false;
    let inputIterator: AsyncIterator<unknown> | undefined;

    mockQuery.mockImplementation((args: { prompt: unknown }) => {
      capturedPrompt = args.prompt;
      inputIterator = (capturedPrompt as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const fake = new FakeQuery();
      // Simulate the SDK consuming the single user message, then check the
      // iterator stays open while the query is still live.
      void (async () => {
        await inputIterator!.next();
        const second = inputIterator!.next();
        secondNextObservedPending =
          (await Promise.race([second.then(() => 'settled'), Promise.resolve('pending')])) ===
          'pending';
      })();
      fake.push({ done: false, value: { type: 'result', session_id: 'sid-stream' } });
      fake.push({ done: true, value: undefined });
      return fake;
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test prompt', '/workspace', undefined, {
      interruptSignal: interruptController.signal,
    })) {
      chunks.push(chunk);
    }

    expect(typeof capturedPrompt).not.toBe('string');
    expect(chunks[0]).toMatchObject({ type: 'result', sessionId: 'sid-stream' });
    // Provider released the deferred gate in finally → iterator now completes.
    const tail = await inputIterator!.next();
    expect(tail).toEqual({ done: true, value: undefined });
    expect(secondNextObservedPending).toBe(true);
  });

  test('the streamed user message carries the typed SDKUserMessage shape', async () => {
    const interruptController = new AbortController();
    let inputIterator: AsyncIterator<unknown> | undefined;
    mockQuery.mockImplementation((args: { prompt: unknown }) => {
      inputIterator = (args.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const fake = new FakeQuery();
      fake.push({ done: true, value: undefined });
      return fake;
    });

    for await (const _ of client.sendQuery('test prompt', '/workspace', undefined, {
      interruptSignal: interruptController.signal,
    })) {
      // consume
    }

    const first = await inputIterator!.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      type: 'user',
      message: { role: 'user', content: 'test prompt' },
      parent_tool_use_id: null,
    });
  });

  test('interrupt abort calls native interrupt() exactly once and never aborts the SDK controller or closes the query', async () => {
    const interruptController = new AbortController();
    const fake = new FakeQuery();
    let sdkController: AbortController | undefined;
    mockQuery.mockImplementation((args: { options: { abortController: AbortController } }) => {
      sdkController = args.options.abortController;
      fake.push({
        done: false,
        value: { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      });
      return fake;
    });

    const chunks = [];
    const consuming = (async (): Promise<void> => {
      for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
        interruptSignal: interruptController.signal,
      })) {
        chunks.push(chunk);
      }
    })();
    for (let i = 0; i < 50 && chunks.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(chunks).toHaveLength(1);

    interruptController.abort();
    await flushMicrotasks();
    // Repeated abort notification must not invoke interrupt() again.
    interruptController.signal.dispatchEvent(new Event('abort'));
    await flushMicrotasks();

    expect(fake.interrupt).toHaveBeenCalledTimes(1);
    expect(sdkController?.signal.aborted).toBe(false);
    expect(fake.close).not.toHaveBeenCalled();

    fake.push({
      done: false,
      value: {
        type: 'result',
        session_id: 'sid-interrupted',
        subtype: 'success',
        is_error: false,
        terminal_reason: 'aborted_streaming',
      },
    });
    fake.push({ done: true, value: undefined });
    await consuming;

    expect(chunks[1]).toMatchObject({
      type: 'result',
      sessionId: 'sid-interrupted',
      terminalReason: 'aborted_streaming',
    });
    expect(chunks[1]).not.toHaveProperty('isError');
  });

  test('node Cancel still aborts the SDK controller and closes the query without calling native interrupt', async () => {
    const nodeCancel = new AbortController();
    const interruptController = new AbortController();
    const fake = new FakeQuery();
    let sdkController: AbortController | undefined;
    mockQuery.mockImplementation((args: { options: { abortController: AbortController } }) => {
      sdkController = args.options.abortController;
      fake.push({
        done: false,
        value: { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
      });
      return fake;
    });

    const chunks = [];
    const consuming = (async (): Promise<void> => {
      for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
        abortSignal: nodeCancel.signal,
        interruptSignal: interruptController.signal,
      })) {
        chunks.push(chunk);
      }
    })();
    for (let i = 0; i < 50 && chunks.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    nodeCancel.abort();
    await consuming;

    expect(chunks).toEqual([{ type: 'assistant', content: 'first', textMode: 'complete' }]);
    expect(sdkController?.signal.aborted).toBe(true);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.interrupt).not.toHaveBeenCalled();
  });

  test('an error-marked interrupted result preserves error/subtype/session/usage shape alongside terminalReason', async () => {
    const interruptController = new AbortController();
    const fake = new FakeQuery();
    mockQuery.mockImplementation(() => {
      fake.push({
        done: false,
        value: {
          type: 'result',
          session_id: 'sid-interrupted-err',
          is_error: true,
          subtype: 'error_during_execution',
          errors: ['turn aborted by operator'],
          terminal_reason: 'aborted_tools',
          usage: { input_tokens: 10, output_tokens: 20 },
          modelUsage: {
            'claude-haiku-4-5': {
              inputTokens: 10,
              outputTokens: 20,
            },
          },
        },
      });
      fake.push({ done: true, value: undefined });
      return fake;
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
      interruptSignal: interruptController.signal,
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({
      type: 'result',
      sessionId: 'sid-interrupted-err',
      isError: true,
      errorSubtype: 'error_during_execution',
      errors: ['turn aborted by operator'],
      terminalReason: 'aborted_tools',
      tokens: { input: 10, output: 20 },
    });
    expect(chunks[0]).toHaveProperty('usageBreakdown');
  });

  test('a pre-aborted interruptSignal starts no query', async () => {
    const interruptController = new AbortController();
    interruptController.abort();
    mockQuery.mockImplementation(() => new FakeQuery());

    await expect(
      (async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace', undefined, {
          interruptSignal: interruptController.signal,
        })) {
          // consume
        }
      })()
    ).rejects.toThrow('Query interrupted');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a rejected native interrupt promise is surfaced to the stream consumer', async () => {
    const interruptController = new AbortController();
    const fake = new FakeQuery();
    fake.interrupt = mock(async () => {
      throw new Error('interrupt control request failed');
    });
    mockQuery.mockImplementation(() => {
      fake.push({
        done: false,
        value: { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      });
      return fake;
    });

    const chunks = [];
    const consuming = (async (): Promise<void> => {
      for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
        interruptSignal: interruptController.signal,
      })) {
        chunks.push(chunk);
      }
    })();
    for (let i = 0; i < 50 && chunks.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    interruptController.abort();
    await expect(consuming).rejects.toThrow('interrupt control request failed');
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
  });

  test('a native interrupt rejection after the event stream ends is still surfaced', async () => {
    const interruptController = new AbortController();
    const fake = new FakeQuery();
    let rejectInterrupt: ((error: Error) => void) | undefined;
    fake.interrupt = mock(
      () =>
        new Promise<{ still_queued: string[] }>((_, reject) => {
          rejectInterrupt = reject;
        })
    );
    mockQuery.mockImplementation(() => {
      fake.push({
        done: false,
        value: { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      });
      return fake;
    });

    const chunks = [];
    let settled = false;
    const consuming = (async (): Promise<void> => {
      for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
        interruptSignal: interruptController.signal,
      })) {
        chunks.push(chunk);
      }
    })().finally(() => {
      settled = true;
    });
    for (let i = 0; i < 50 && chunks.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    interruptController.abort();
    await flushMicrotasks();
    expect(rejectInterrupt).toBeDefined();
    fake.push({ done: true, value: undefined });
    await flushMicrotasks();
    expect(settled).toBe(false);

    rejectInterrupt?.(new Error('late interrupt control failure'));
    await expect(consuming).rejects.toThrow('late interrupt control failure');
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
  });

  test('an interrupted attempt is never retried even when the stream throws a retryable error', async () => {
    const interruptController = new AbortController();
    let callCount = 0;
    const fake = new FakeQuery();
    mockQuery.mockImplementation(() => {
      callCount++;
      fake.push({
        done: false,
        value: { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      });
      return fake;
    });

    const chunks = [];
    const consuming = (async (): Promise<void> => {
      for await (const chunk of client.sendQuery('test', '/workspace', undefined, {
        interruptSignal: interruptController.signal,
      })) {
        chunks.push(chunk);
      }
    })();
    for (let i = 0; i < 50 && chunks.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    interruptController.abort();
    await flushMicrotasks();
    // A crash racing the operator's Stop must not restart the turn.
    fake.pushError(new Error('process exited with code 1'));
    await expect(consuming).rejects.toThrow('process exited with code 1');
    expect(callCount).toBe(1);
  });

  test('without interruptSignal a crash retains the existing retry behavior', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(async function* () {
      callCount++;
      throw new Error('process exited with code 1');
    });

    await expect(
      (async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace')) {
          // consume
        }
      })()
    ).rejects.toThrow('process exited with code 1');
    expect(callCount).toBe(4); // 1 initial + MAX_SUBPROCESS_RETRIES retries
  });

  test('early consumer return removes the interrupt listener and settles the input iterator', async () => {
    const interruptController = new AbortController();
    const removeListener = spyOn(interruptController.signal, 'removeEventListener');
    const fake = new FakeQuery();
    let inputIterator: AsyncIterator<unknown> | undefined;
    mockQuery.mockImplementation((args: { prompt: unknown }) => {
      inputIterator = (args.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      fake.push({
        done: false,
        value: { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
      });
      return fake;
    });

    try {
      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        interruptSignal: interruptController.signal,
      })) {
        break; // early consumer return
      }

      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
      // A later abort cannot reach the detached listener.
      interruptController.abort();
      await flushMicrotasks();
      expect(fake.interrupt).not.toHaveBeenCalled();
      // The provider-owned input gate was settled → after the single user
      // message, the iterator completes.
      await inputIterator!.next();
      expect(await inputIterator!.next()).toEqual({ done: true, value: undefined });
    } finally {
      removeListener.mockRestore();
    }
  });

  test('normal completion and error paths remove the interrupt listener', async () => {
    const interruptController = new AbortController();
    const removeListener = spyOn(interruptController.signal, 'removeEventListener');
    const fake = new FakeQuery();
    mockQuery.mockImplementation(() => {
      fake.push({ done: false, value: { type: 'result', session_id: 'sid-done' } });
      fake.push({ done: true, value: undefined });
      return fake;
    });

    try {
      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        interruptSignal: interruptController.signal,
      })) {
        // consume
      }
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      removeListener.mockRestore();
    }

    const interruptController2 = new AbortController();
    const removeListener2 = spyOn(interruptController2.signal, 'removeEventListener');
    const fake2 = new FakeQuery();
    mockQuery.mockImplementation(() => {
      fake2.pushError(new Error('unknown failure'));
      return fake2;
    });
    try {
      await expect(
        (async (): Promise<void> => {
          for await (const _ of client.sendQuery('test', '/workspace', undefined, {
            interruptSignal: interruptController2.signal,
          })) {
            // consume
          }
        })()
      ).rejects.toThrow('unknown failure');
      expect(removeListener2).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      removeListener2.mockRestore();
    }
  });

  test('an abort landing during per-attempt setup is delivered once the query binds', async () => {
    const interruptController = new AbortController();
    const fake = new FakeQuery();
    let queryCreated = false;
    mockQuery.mockImplementation(() => {
      queryCreated = true;
      return fake;
    });

    const it = client.sendQuery('test', '/workspace', undefined, {
      interruptSignal: interruptController.signal,
      // A workflow node declaring a skill that exists on no root emits a
      // warning chunk before the retry loop, so the first read parks the
      // generator before its listeners are attached and the second read parks
      // it at the per-attempt applyNodeConfig await — after the interrupt
      // listener is attached but before any query exists.
      nodeConfig: { nodeId: 'n1', skills: ['archon-test-no-such-skill-zzz'] },
    });

    const warning = await it.next();
    expect(warning.value).toMatchObject({ type: 'system' });
    expect(queryCreated).toBe(false);

    const nextChunk = it.next();
    // Abort while the generator is parked in per-attempt setup — the request
    // must be remembered and delivered to the query once it binds, not dropped.
    interruptController.abort();

    for (let i = 0; i < 50 && !queryCreated; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (let i = 0; i < 50 && fake.interrupt.mock.calls.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(fake.interrupt).toHaveBeenCalledTimes(1);

    fake.push({
      done: false,
      value: {
        type: 'result',
        session_id: 'sid-pending',
        terminal_reason: 'aborted_streaming',
      },
    });
    fake.push({ done: true, value: undefined });

    const chunk = await nextChunk;
    expect(chunk.value).toMatchObject({
      type: 'result',
      sessionId: 'sid-pending',
      terminalReason: 'aborted_streaming',
    });
    expect((await it.next()).done).toBe(true);
  });
});

// ─── API errors surfaced as text (#1797) ─────────────────────────────────
// The SDK does not throw on API-level failures (auth, billing, rate limit).
// It synthesizes an assistant message (model: '<synthetic>', wrapper
// `error` code) with the error prose, then emits a result with
// subtype: 'success' AND is_error: true — the same field pair as the
// legitimate stop-sequence carve-out (#1425). Shapes below are verbatim
// captures from claude CLI 2.1.210 (isolated config dir).

describe('API error surfaced as text (#1797)', () => {
  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  interface CollectedStream {
    chunks: Array<Record<string, unknown>>;
    error?: Error;
  }

  async function collect(gen: AsyncIterable<Record<string, unknown>>): Promise<CollectedStream> {
    const chunks: Array<Record<string, unknown>> = [];
    try {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    } catch (e) {
      return { chunks, error: e as Error };
    }
    return { chunks };
  }

  function syntheticAssistantMessage(errorCode: string, text: string): Record<string, unknown> {
    return {
      type: 'assistant',
      message: {
        model: '<synthetic>',
        stop_reason: 'stop_sequence',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      error: errorCode,
      session_id: 'sid-api-err',
    };
  }

  function apiErrorResult(text: string): Record<string, unknown> {
    return {
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: null,
      result: text,
      stop_reason: 'stop_sequence',
      terminal_reason: 'api_error',
      total_cost_usd: 0,
      session_id: 'sid-api-err',
    };
  }

  test('auth error (Not logged in) throws instead of completing with poisoned output', async () => {
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage('authentication_failed', 'Not logged in · Please run /login');
      yield apiErrorResult('Not logged in · Please run /login');
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));

    expect(error).toBeDefined();
    expect(error?.message).toContain('Claude API error (authentication_failed)');
    expect(error?.message).toContain('Not logged in');
    // The poison: no assistant chunk carrying the error prose, no result chunk
    expect(chunks.filter(c => c.type === 'assistant')).toHaveLength(0);
    expect(chunks.filter(c => c.type === 'result')).toHaveLength(0);
    // Auth errors are non-retryable — a single attempt only
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'authentication_failed' }),
      'claude.result_api_error'
    );
  });

  test('invalid API key (401) shape throws a non-retryable auth error', async () => {
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage(
        'authentication_failed',
        'Invalid API key · Fix external API key'
      );
      yield {
        ...apiErrorResult('Invalid API key · Fix external API key'),
        api_error_status: 401,
      };
    });

    const { error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error?.message).toContain('Claude API error (authentication_failed)');
    expect(error?.message).toContain('Invalid API key');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('api_error result without a preceding synthetic message still throws (belt-and-suspenders)', async () => {
    mockQuery.mockImplementation(async function* () {
      yield apiErrorResult('Something went wrong upstream');
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error?.message).toContain('Claude API error (unknown)');
    expect(error?.message).toContain('Something went wrong upstream');
    expect(chunks.filter(c => c.type === 'result')).toHaveLength(0);
  });

  test('synthetic rate_limit error retries per existing subprocess policy, then throws', async () => {
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage('rate_limit', 'Rate limited · Try again later');
      yield apiErrorResult('Rate limited · Try again later');
    });

    const { error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error?.message).toContain('Claude API error (rate_limit)');
    // MAX_SUBPROCESS_RETRIES = 3 → 4 attempts total
    expect(mockQuery).toHaveBeenCalledTimes(4);
  }, 5_000);

  test('400 tool-use-concurrency error with a catch-all code retries like a rate limit (#1341)', async () => {
    // The SDK types this transient 400 with a catch-all code ('unknown' here;
    // 'invalid_request' classifies identically), so code-only classification
    // would fail fast. The narrow text fallback must reclassify it as
    // rate_limit and drive the existing backoff.
    const text = 'API Error: 400 due to tool use concurrency issues.';
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage('unknown', text);
      yield { ...apiErrorResult(text), api_error_status: 400 };
    });

    const { error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error?.message).toContain('Claude API error (unknown)');
    expect(error?.message).toContain('tool use concurrency');
    // MAX_SUBPROCESS_RETRIES = 3 → 4 attempts total
    expect(mockQuery).toHaveBeenCalledTimes(4);
  }, 5_000);

  test('other catch-all-coded api errors stay non-retryable', async () => {
    // Guards the narrowness of the #1341 fallback: a genuine client error that
    // also lands on a catch-all code must NOT be retried.
    const text = 'Invalid request: max_tokens exceeds model limit';
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage('invalid_request', text);
      yield { ...apiErrorResult(text), api_error_status: 400 };
    });

    const { error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error?.message).toContain('Claude API error (invalid_request)');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('thrown subprocess error mentioning tool use concurrency retries as rate_limit (#1341)', async () => {
    mockQuery.mockImplementation(async function* () {
      throw new Error('API Error: 400 due to tool use concurrency issues.');
    });

    const consumeGenerator = async (): Promise<void> => {
      for await (const _ of client.sendQuery('test', '/workspace')) {
        // consume
      }
    };

    await expect(consumeGenerator()).rejects.toThrow(/Claude Code rate_limit/);
    expect(mockQuery).toHaveBeenCalledTimes(4);
  }, 5_000);

  test('legitimate output that merely mentions the error phrases is untouched', async () => {
    // A real model turn (real model id, no wrapper error field, clean result)
    // whose TEXT happens to discuss login errors — e.g. a node writing docs
    // about auth failures. Must flow through as a normal success.
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5',
          content: [
            {
              type: 'text',
              text: 'If auth fails you may see "Not logged in · Please run /login".',
            },
          ],
        },
        session_id: 'sid-legit',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sid-legit',
      };
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error).toBeUndefined();
    expect(
      chunks.some(c => typeof c.content === 'string' && c.content.includes('Not logged in'))
    ).toBe(true);
    const result = chunks.find(c => c.type === 'result');
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('isError');
  });

  test('#1425 stop-sequence carve-out is preserved (is_error + subtype success without API-error signals)', async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Rate limit guidance: back off exponentially.' }],
        },
        session_id: 'sid-stop-seq',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: true,
        stop_reason: 'stop_sequence',
        session_id: 'sid-stop-seq',
      };
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error).toBeUndefined();
    const result = chunks.find(c => c.type === 'result');
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('isError');
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sid-stop-seq' }),
      'claude.result_success_validated'
    );
  });

  test('real-model message carrying an error code (e.g. max_output_tokens) is not suppressed', async () => {
    // A REAL (non-synthetic) message can carry a wrapper error code alongside
    // genuine truncated output. Only '<synthetic>' content is SDK error prose.
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'partial output before truncation' }],
        },
        error: 'max_output_tokens',
        session_id: 'sid-trunc',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'sid-trunc',
      };
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error).toBeUndefined();
    expect(chunks.some(c => c.content === 'partial output before truncation')).toBe(true);
  });

  test('fail-safe: synthetic error contradicted by a clean result yields the withheld text late', async () => {
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage('server_error', 'Upstream hiccup');
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'sid-recovered',
      };
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error).toBeUndefined();
    expect(chunks.some(c => c.type === 'assistant' && c.content === 'Upstream hiccup')).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'server_error' }),
      'claude.synthetic_error_not_confirmed'
    );
  });

  test('stream ending after a synthetic error without a result throws', async () => {
    mockQuery.mockImplementation(async function* () {
      yield syntheticAssistantMessage('billing_error', 'Credit balance is too low');
      // stream ends abnormally — no result event
    });

    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error?.message).toContain('Claude API error (billing_error)');
    expect(error?.message).toContain('Credit balance is too low');
    expect(chunks.filter(c => c.type === 'assistant')).toHaveLength(0);
    // billing_error classifies as auth → non-retryable
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('usageBreakdown normalization (US-002)', () => {
  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  async function collect(gen: AsyncIterable<Record<string, unknown>>): Promise<{
    chunks: Array<Record<string, unknown>>;
    error?: Error;
  }> {
    const chunks: Array<Record<string, unknown>> = [];
    try {
      for await (const chunk of gen) chunks.push(chunk);
    } catch (e) {
      return { chunks, error: e as Error };
    }
    return { chunks };
  }

  test('maps every modelUsage entry with anthropic provider and cache/cost fields, omits requests', async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'result',
        session_id: 'sid-usage',
        total_cost_usd: 0.12,
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 10,
            cacheCreationInputTokens: 4,
            webSearchRequests: 3,
            costUSD: 0.11,
          },
          'claude-haiku-4-5': {
            inputTokens: 20,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.01,
          },
        },
      };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) chunks.push(chunk);
    expect(chunks[0]).toMatchObject({
      type: 'result',
      usageBreakdown: [
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          modelSource: 'reported',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 4,
          costUsd: 0.11,
        },
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          modelSource: 'reported',
          inputTokens: 20,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.01,
        },
      ],
    });
    expect(chunks[0]).not.toHaveProperty('modelUsage');
    expect(chunks[0].usageBreakdown?.[0]).not.toHaveProperty('requests');
  });

  test('preserves zero costUSD and yields no usage when modelUsage is absent', async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'result',
        session_id: 'sid-zero',
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 1,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0,
          },
        },
      };
    });
    const withZero = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) withZero.push(chunk);
    expect(withZero[0].usageBreakdown?.[0]).toMatchObject({ costUsd: 0, outputTokens: 0 });

    mockQuery.mockImplementation(async function* () {
      yield { type: 'result', session_id: 'sid-none' };
    });
    const without = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) without.push(chunk);
    expect(without[0]).not.toHaveProperty('usageBreakdown');
  });

  test('usage-bearing final typed API error yields isError result with usage', async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: {
          model: '<synthetic>',
          stop_reason: 'stop_sequence',
          content: [{ type: 'text', text: 'rate limited' }],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        error: 'rate_limit',
        session_id: 'sid-rl',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: true,
        terminal_reason: 'api_error',
        result: 'rate limited',
        stop_reason: 'stop_sequence',
        session_id: 'sid-rl',
        total_cost_usd: 0.002,
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 40,
            outputTokens: 2,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.002,
          },
        },
      };
    });

    // Exhaust retries for rate_limit (retryable). Force max by low delay.
    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error).toBeUndefined();
    const result = chunks.find(c => c.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'rate_limit',
    });
    // One observation per exhausted attempt (initial + MAX_SUBPROCESS_RETRIES).
    expect(result?.usageBreakdown).toHaveLength(4);
    expect(result?.usageBreakdown?.[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      modelSource: 'reported',
      inputTokens: 40,
      outputTokens: 2,
      costUsd: 0.002,
    });
    expect(mockQuery).toHaveBeenCalledTimes(4);
  }, 5_000);

  test('retry accumulation folds prior usage into the successful terminal result', async () => {
    let call = 0;
    mockQuery.mockImplementation(async function* () {
      call += 1;
      if (call === 1) {
        yield {
          type: 'assistant',
          message: {
            model: '<synthetic>',
            stop_reason: 'stop_sequence',
            content: [{ type: 'text', text: 'overloaded' }],
            usage: { input_tokens: 0, output_tokens: 0 },
          },
          error: 'overloaded',
          session_id: 'sid-acc',
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: true,
          terminal_reason: 'api_error',
          result: 'overloaded',
          session_id: 'sid-acc',
          modelUsage: {
            'claude-sonnet-4-6': {
              inputTokens: 10,
              outputTokens: 1,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD: 0.001,
            },
          },
        };
        return;
      }
      yield {
        type: 'result',
        session_id: 'sid-acc',
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 5,
            outputTokens: 2,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.0005,
          },
        },
      };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery('test', '/workspace')) chunks.push(chunk);
    expect(chunks[0].usageBreakdown).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSource: 'reported',
        inputTokens: 10,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSource: 'reported',
        inputTokens: 5,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.0005,
      },
    ]);
    expect(chunks[0]).not.toHaveProperty('isError');
  });

  test('does not synthesize usage when SDK throws without usage', async () => {
    mockQuery.mockImplementation(async function* () {
      throw new Error('process exited with code 1');
    });
    const { chunks, error } = await collect(client.sendQuery('test', '/workspace'));
    expect(error).toBeDefined();
    expect(chunks.filter(c => c.type === 'result')).toHaveLength(0);
  });
});

const ASK_HUMAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Ordered structured questions for a human operator.',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          selection: { type: 'string', enum: ['single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          allowOther: { type: 'boolean' },
        },
        required: ['id', 'prompt', 'selection', 'options', 'allowOther'],
      },
    },
  },
  required: ['questions'],
};

const VALID_QUESTIONS: Record<string, unknown> = {
  questions: [
    {
      id: 'q1',
      prompt: 'Which option?',
      selection: 'single',
      options: ['a', 'b'],
      allowOther: false,
    },
  ],
};

function askHumanTool(handler: NativeTool['handler']): NativeTool {
  return {
    name: 'AskHuman',
    description:
      'Ask a human operator one or more structured questions. Call this tool instead of asking in prose. Wait after calling; do not guess the answer.',
    inputSchema: ASK_HUMAN_INPUT_SCHEMA,
    handler,
  };
}

type ClaudeQueryCall = {
  options: {
    abortController: AbortController;
    hooks?: Record<
      string,
      Array<{
        matcher?: string;
        hooks: Array<(input: unknown, toolUseID?: string) => Promise<unknown>>;
      }>
    >;
  };
};

async function invokeAskHumanCallback(
  args: ClaudeQueryCall,
  toolUseId = 'toolu_real'
): Promise<void> {
  const preToolUse = args.options.hooks?.PreToolUse ?? [];
  for (const matcher of preToolUse) {
    for (const hook of matcher.hooks) {
      await hook({ tool_name: 'mcp__archon__AskHuman', tool_use_id: toolUseId }, toolUseId);
    }
  }
  const ask = capturedMcpTools.find(tool => tool.name === 'AskHuman');
  if (!ask) {
    throw new Error('AskHuman MCP tool was not registered');
  }
  await ask.handler(VALID_QUESTIONS);
}

describe('AskHuman control errors', () => {
  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    capturedMcpTools.length = 0;
  });

  async function consume(
    nativeHandler: NativeTool['handler'],
    queryImpl: (args: ClaudeQueryCall) => AsyncGenerator<Record<string, unknown>>
  ): Promise<unknown> {
    mockQuery.mockImplementation(queryImpl);
    try {
      for await (const _ of client.sendQuery('test', '/workspace', undefined, {
        nativeTools: [askHumanTool(nativeHandler)],
      })) {
        // consume
      }
      return undefined;
    } catch (error) {
      return error;
    }
  }

  function scriptedQuery(
    mode: 'abort' | 'swallow'
  ): (args: ClaudeQueryCall) => AsyncGenerator<Record<string, unknown>> {
    return async function* (args: ClaudeQueryCall): AsyncGenerator<Record<string, unknown>> {
      yield { type: 'assistant', session_id: '', message: { content: [] } };
      yield { type: 'assistant', session_id: 'sess-real', message: { content: [] } };
      try {
        await invokeAskHumanCallback(args);
      } catch (error) {
        if (mode === 'swallow') {
          return;
        }
        if (args.options.abortController.signal.aborted) {
          throw new Error('Operation aborted');
        }
        throw error;
      }
      yield { type: 'result', session_id: 'sess-real' };
    };
  }

  test('abort-rejection rethrows the same AskHumanAwaitingError without retry', async () => {
    const controlError = new AskHumanAwaitingError('toolu_real', 'review', 'run-1');
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    const error = await consume(async (_input, context): Promise<string> => {
      seen.push(context);
      throw controlError;
    }, scriptedQuery('abort'));

    expect(error).toBe(controlError);
    expect(seen).toEqual([{ toolUseId: 'toolu_real', sessionId: 'sess-real' }]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as ClaudeQueryCall | undefined;
    expect(call?.options.abortController.signal.aborted).toBe(true);
  });

  test('swallowed callback rejection still rejects sendQuery with the same AskHumanAwaitingError', async () => {
    const controlError = new AskHumanAwaitingError('toolu_real', 'review', 'run-1');
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    const error = await consume(async (_input, context): Promise<string> => {
      seen.push(context);
      throw controlError;
    }, scriptedQuery('swallow'));

    expect(error).toBe(controlError);
    expect(seen).toEqual([{ toolUseId: 'toolu_real', sessionId: 'sess-real' }]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as ClaudeQueryCall | undefined;
    expect(call?.options.abortController.signal.aborted).toBe(true);
  });

  test('abort-rejection rethrows the same AskHumanNoStarterError without retry', async () => {
    const controlError = new AskHumanNoStarterError('run-1');
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    const error = await consume(async (_input, context): Promise<string> => {
      seen.push(context);
      throw controlError;
    }, scriptedQuery('abort'));

    expect(error).toBe(controlError);
    expect(seen).toEqual([{ toolUseId: 'toolu_real', sessionId: 'sess-real' }]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as ClaudeQueryCall | undefined;
    expect(call?.options.abortController.signal.aborted).toBe(true);
  });

  test('abort-rejection rethrows the same AskHumanPauseFailedError without retry', async () => {
    const controlError = new AskHumanPauseFailedError(
      'toolu_real',
      'review',
      'run-1',
      'database busy'
    );
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    const error = await consume(async (_input, context): Promise<string> => {
      seen.push(context);
      throw controlError;
    }, scriptedQuery('abort'));

    expect(error).toBe(controlError);
    expect(seen).toEqual([{ toolUseId: 'toolu_real', sessionId: 'sess-real' }]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as ClaudeQueryCall | undefined;
    expect(call?.options.abortController.signal.aborted).toBe(true);
  });

  test('threads distinct tool-use ids through repeated AskHuman callbacks in one turn', async () => {
    const errors = [
      new AskHumanAwaitingError('toolu_one', 'review', 'run-1'),
      new AskHumanAwaitingError('toolu_two', 'review', 'run-1'),
    ];
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    let calls = 0;
    const error = await consume(
      async (_input, context): Promise<string> => {
        seen.push(context);
        const controlError = errors[calls];
        calls += 1;
        if (!controlError) throw new Error('unexpected AskHuman call');
        throw controlError;
      },
      async function* (args: ClaudeQueryCall): AsyncGenerator<Record<string, unknown>> {
        yield { type: 'assistant', session_id: 'sess-real', message: { content: [] } };
        await Promise.allSettled([
          invokeAskHumanCallback(args, 'toolu_one'),
          invokeAskHumanCallback(args, 'toolu_two'),
        ]);
        return;
      }
    );

    expect(error).toBe(errors[1]);
    expect(seen).toEqual([
      { toolUseId: 'toolu_one', sessionId: 'sess-real' },
      { toolUseId: 'toolu_two', sessionId: 'sess-real' },
    ]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as ClaudeQueryCall | undefined;
    expect(call?.options.abortController.signal.aborted).toBe(true);
  });

  test('keeps a pause failure ahead of later awaiting control errors', async () => {
    const failure = new AskHumanPauseFailedError('toolu_one', 'review', 'run-1', 'database busy');
    const sequence = [failure, new AskHumanAwaitingError('toolu_two', 'review', 'run-1')];
    let calls = 0;
    const error = await consume(
      async (): Promise<string> => {
        const controlError = sequence[calls];
        calls += 1;
        if (!controlError) throw new Error('unexpected AskHuman call');
        throw controlError;
      },
      async function* (args: ClaudeQueryCall): AsyncGenerator<Record<string, unknown>> {
        yield { type: 'assistant', session_id: 'sess-real', message: { content: [] } };
        await Promise.allSettled([
          invokeAskHumanCallback(args, 'toolu_one'),
          invokeAskHumanCallback(args, 'toolu_two'),
        ]);
        return;
      }
    );

    expect(error).toBe(failure);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('normal handler errors stay SDK tool errors and do not abort', async () => {
    const boom = new Error('tool failed');
    const error = await consume(async (): Promise<string> => {
      throw boom;
    }, scriptedQuery('swallow'));

    expect(error).toBeUndefined();
    expect(error).not.toBeInstanceOf(AskHumanAwaitingError);
    expect(error).not.toBeInstanceOf(AskHumanNoStarterError);
    expect(error).not.toBeInstanceOf(AskHumanPauseFailedError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as ClaudeQueryCall | undefined;
    expect(call?.options.abortController.signal.aborted).toBe(false);
  });
});

describe('buildClaudeAskResumePrompt', () => {
  test('formats ordered answer and decline blocks and ends with continuation instruction', () => {
    const interactions: ResumeInteraction[] = [
      {
        tool_use_id: 'toolu_answer_1',
        payload: [{ questionId: 'q1', value: 'SENTINEL_ANSWER_ZX9' }],
        declined: false,
      },
      {
        tool_use_id: 'toolu_decline_2',
        payload: 'declined',
        declined: true,
      },
    ];

    const prompt = buildClaudeAskResumePrompt(interactions);

    expect(prompt).toContain('AskHuman toolu_answer_1 answers:');
    expect(prompt).toContain(JSON.stringify(interactions[0]?.payload));
    expect(prompt).toContain('AskHuman toolu_decline_2 was declined.');
    expect(prompt).toContain(
      'Continue the task using these answers. Do not call AskHuman again for these tool_use_id values.'
    );
    expect(prompt.indexOf('toolu_answer_1')).toBeLessThan(prompt.indexOf('toolu_decline_2'));
    expect(prompt).not.toContain('was declined.\nAskHuman toolu_answer_1');
    expect(prompt).not.toContain('executor');
    expect(
      prompt.endsWith(
        'Continue the task using these answers. Do not call AskHuman again for these tool_use_id values.'
      )
    ).toBe(true);
  });
});

describe('AskHuman resume', () => {
  const ANSWER_SENTINEL = 'SENTINEL_ANSWER_ZX9';
  const STDERR_SENTINEL = 'SENTINEL_STDERR_ZX9';
  const EXECUTOR_PROMPT = 'executor prompt must not leak into the Claude resume query';
  const interactions: ResumeInteraction[] = [
    {
      tool_use_id: 'toolu_answer_1',
      payload: [{ questionId: 'q1', value: ANSWER_SENTINEL }],
      declined: false,
    },
    {
      tool_use_id: 'toolu_decline_2',
      payload: 'declined',
      declined: true,
    },
  ];

  let client: ClaudeProvider;

  beforeEach(() => {
    client = new ClaudeProvider({ retryBaseDelayMs: 1 });
    mockQuery.mockClear();
    capturedMcpTools.length = 0;
    mockLogger.fatal.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.trace.mockClear();
  });

  function loggerPayload(): string {
    return JSON.stringify([
      ...mockLogger.fatal.mock.calls,
      ...mockLogger.error.mock.calls,
      ...mockLogger.warn.mock.calls,
      ...mockLogger.info.mock.calls,
      ...mockLogger.debug.mock.calls,
      ...mockLogger.trace.mock.calls,
    ]);
  }

  test('requires resumeSessionId, forces forkSession false, and sends the builder prompt', async () => {
    mockQuery.mockImplementation(async function* () {
      yield { type: 'result', session_id: 'sess-ask' };
    });

    const expectedPrompt = buildClaudeAskResumePrompt(interactions);
    const chunks = [];
    for await (const chunk of client.sendQuery(EXECUTOR_PROMPT, '/workspace', 'sess-ask', {
      forkSession: true,
      nativeTools: [askHumanTool(async () => 'ok')],
      resumeInteractions: interactions,
    })) {
      chunks.push(chunk);
    }

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]?.[0] as {
      prompt: string;
      options: {
        resume?: string;
        forkSession?: boolean;
        mcpServers?: Record<string, unknown>;
      };
    };
    expect(call.prompt).toBe(expectedPrompt);
    expect(call.prompt).not.toContain(EXECUTOR_PROMPT);
    expect(call.options.resume).toBe('sess-ask');
    expect(call.options.forkSession).toBe(false);
    expect(call.options.mcpServers).toHaveProperty('archon');
    expect(capturedMcpTools.some(tool => tool.name === 'AskHuman')).toBe(true);
    expect(chunks.find(c => c.type === 'result')).toMatchObject({ resumed: true });
  });

  test('throws a safe error without retry when the SDK throws a sentinel and stderr leaks another', async () => {
    mockQuery.mockImplementation(async function* (args: {
      options: { stderr?: (data: string) => void };
    }) {
      args.options.stderr?.(`fatal: ${STDERR_SENTINEL}\n`);
      throw new Error(`process crashed: ${ANSWER_SENTINEL}`);
    });

    let thrown: unknown;
    try {
      for await (const _ of client.sendQuery(EXECUTOR_PROMPT, '/workspace', 'sess-ask', {
        resumeInteractions: interactions,
      })) {
        // consume
      }
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not resume the AskHuman session');
    expect((thrown as Error).cause).toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const payload = loggerPayload();
    expect(payload).not.toContain(ANSWER_SENTINEL);
    expect(payload).not.toContain(STDERR_SENTINEL);
    expect(mockLogger.error).toHaveBeenCalledWith(
      { errorClass: expect.any(String) },
      'claude.ask_resume_failed'
    );
  });

  test('maps isError terminal results to the safe message while preserving usage', async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'result',
        session_id: 'sess-ask',
        is_error: true,
        subtype: 'error_during_execution',
        errors: [`sdk failed: ${ANSWER_SENTINEL}`],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        total_cost_usd: 0.012,
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 11,
            outputTokens: 7,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.012,
          },
        },
      };
    });

    const chunks = [];
    for await (const chunk of client.sendQuery(EXECUTOR_PROMPT, '/workspace', 'sess-ask', {
      resumeInteractions: interactions,
    })) {
      chunks.push(chunk);
    }

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(chunks[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'error_during_execution',
      errors: ['Could not resume the AskHuman session'],
      tokens: { input: 11, output: 7, total: 18 },
      cost: 0.012,
    });
    expect(chunks[0]?.usageBreakdown?.[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 11,
      outputTokens: 7,
      costUsd: 0.012,
    });
    expect(JSON.stringify(chunks)).not.toContain(ANSWER_SENTINEL);
    expect(loggerPayload()).not.toContain(ANSWER_SENTINEL);
  });

  test('non-Ask resume keeps the executor prompt and requested forkSession', async () => {
    mockQuery.mockImplementation(async function* () {
      yield { type: 'result', session_id: 'sess-plain' };
    });

    for await (const _ of client.sendQuery(EXECUTOR_PROMPT, '/workspace', 'sess-plain', {
      forkSession: true,
    })) {
      // consume
    }

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith({
      prompt: EXECUTOR_PROMPT,
      options: expect.objectContaining({
        resume: 'sess-plain',
        forkSession: true,
      }),
    });
  });

  test('throws a safe error without calling query or attaching listeners when resumeSessionId is missing', async () => {
    const nodeCancel = new AbortController();
    const interruptController = new AbortController();
    const addNodeListener = spyOn(nodeCancel.signal, 'addEventListener');
    const addInterruptListener = spyOn(interruptController.signal, 'addEventListener');
    let thrown: unknown;
    try {
      for await (const _ of client.sendQuery(EXECUTOR_PROMPT, '/workspace', undefined, {
        abortSignal: nodeCancel.signal,
        interruptSignal: interruptController.signal,
        resumeInteractions: interactions,
      })) {
        // consume
      }
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not resume the AskHuman session');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(addNodeListener).not.toHaveBeenCalled();
    expect(addInterruptListener).not.toHaveBeenCalled();
    expect(loggerPayload()).not.toContain(ANSWER_SENTINEL);
    addNodeListener.mockRestore();
    addInterruptListener.mockRestore();
  });
});
