# OMP CLI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `omp` as a bundled Archon community provider that drives a user-installed OMP CLI with streaming output, resumable sessions, model/thinking controls, named skills, structured output, cancellation, and explicit failure reporting.

**Architecture:** Implement one short-lived `omp --mode json` subprocess per `IAgentProvider.sendQuery()` call, mirroring Codex's session/result/cancellation contract while reusing the existing Qoder CLI spawn pattern.
Parse OMP's newline-delimited JSON at the process boundary, translate supported events into Archon `MessageChunk`s, and use OMP's persisted session header ID with `--resume` or `--fork` on later calls.
Keep the adapter external to OMP's SDK so Archon neither bundles OMP nor couples its provider package to OMP's rapidly evolving internal TypeScript API.

**Tech Stack:** Bun subprocesses and streams, strict TypeScript, Archon's provider registry and structured-output helpers, OMP CLI 17.2.9 JSON mode, Bun test.

## Global Constraints

- Preserve the user's existing unrelated changes under `.archon/workflows/defaults/` and `.specify/extensions/ralph-loop/`.
- Do not edit `CHANGELOG.md`.
- Do not manually edit `packages/docs-web/src/content/docs/reference/provider-capabilities.md` because it is generated.
- Regenerate the capability matrix with `bun run generate:capability-matrix` after registering OMP.
- Keep every new or substantially edited Markdown sentence on its own physical line.
- Keep `packages/providers/src/types.ts` free of SDK imports and runtime dependencies.
- Use complete TypeScript annotations and no `any` types.
- Keep OMP authentication in OMP's own `~/.omp` store and environment resolution.
- Do not add `@oh-my-pi/pi-coding-agent` as an Archon dependency.
- Do not add setup-wizard, database, API-route, or web-specific provider branches because those surfaces already consume the runtime registry or intentionally omit other community providers such as Qoder CLI.
- Run package-isolated tests through the documented scripts.
- Never run `bun test` from the repository root.
- Never add an agent name as a commit co-author.

## Source-Derived Integration Contract

The implementation must preserve these facts verified against `/Users/dale/Desktop/workspace/opensources/oh-my-pi` at OMP 17.2.9.

| Concern | Upstream source | Required Archon behavior |
| --- | --- | --- |
| Executable | `packages/coding-agent/package.json` declares `bin.omp = src/cli.ts` | Resolve and spawn the `omp` executable without an SDK dependency. |
| Headless stream | `packages/coding-agent/src/modes/print-mode.ts` emits one JSON object per line for `--mode json` | Parse stdout as NDJSON and treat stderr as diagnostics only. |
| Session identity | `packages/coding-agent/src/session/session-entries.ts` emits a `{ type: "session", id, cwd, ... }` header | Capture the header `id` and return it on Archon's terminal `result` chunk. |
| Resume | `packages/coding-agent/src/main.ts` resolves `--resume <id>` and `--fork <id>` through OMP's persisted session store | Use `--resume` for normal continuation and `--fork` when `forkSession` is true. |
| Persistence | `packages/coding-agent/src/main.ts` creates an in-memory session for `--no-session` | Map `persistSession: false` to `--no-session` and reject an impossible resume-plus-no-session request before spawning. |
| Streaming text | `printableEvent()` keeps only `message_update.assistantMessageEvent` deltas and emits authoritative `message_end` messages | Stream `text_delta` and `thinking_delta`, then repair a missing text tail from `message_end` without duplicating content. |
| Tool lifecycle | `packages/agent/src/types.ts` emits `tool_execution_start` and `tool_execution_end` with a stable `toolCallId` | Emit paired Archon `tool` and `tool_result` chunks with the original ID. |
| Usage | `packages/ai/src/types.ts` assistant messages carry `usage`, `stopReason`, `errorMessage`, `provider`, and `model` | Aggregate assistant-message token and cost usage across the OMP tool loop and put the final status/model on the terminal chunk. |
| Model | `packages/coding-agent/src/cli/flag-tables.ts` accepts `--model`, including `provider/model` refs | Pass Archon's resolved model unchanged through `--model`. |
| Thinking | OMP accepts `--thinking` values including `off`, provider efforts, and `auto` | Preserve Archon's provider-owned non-empty effort string unchanged and keep string `thinking` precedence consistent with the existing CLI providers. |
| Skills | OMP accepts `--skills name-or-glob,...` and discovers `.agents/skills` roots | Translate Archon's per-node `skills` list into one `--skills` filter. |
| Extensions | OMP automatically discovers executable extensions unless `--no-extensions` is present | Disable extension discovery by default and require `assistants.omp.enableExtensions: true` to opt in. |
| Approval | OMP accepts `--yolo` for non-interactive approval | Always pass `--yolo`; document that OMP inherits Archon's host-user permissions and environment, may access resources outside the worktree, and requires external isolation when that access is unacceptable. |
| Structured output | OMP has no CLI JSON-schema decoding flag | Use Archon's prompt augmentation and post-parse path, declaring `best-effort`. |

The canonical spawned command shape is:

```text
omp --mode json --cwd <cwd> --yolo --no-title [--no-extensions]
    [--model <provider/model>] [--thinking <value>]
    [--system-prompt <text> | --append-system-prompt <text>]
    [--skills <name-or-glob,...>]
    [--no-session | --resume <id> | --fork <id>]
    -- <prompt>
```

The capability declaration must be conservative and reflect Archon fields that the adapter actually translates.

```typescript
export const OMP_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: true,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: true,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
};
```

OMP may discover its own `.mcp.json`, hooks, agents, and default tools, but those facts do not make Archon's per-node `mcp`, `hooks`, `agents`, or `allowed_tools`/`denied_tools` fields supported.
The capability flags stay false until those exact Archon fields have complete, tested translations.

The Archon implementation follows these existing integration seams.

| Archon reference | Reused decision |
| --- | --- |
| `packages/providers/src/codex/provider.ts` | Preserve one provider-neutral stream, return the concrete provider session ID, report usage/model/stop status on the terminal result, make resume outcome observable, and terminate on cancellation. |
| `packages/providers/src/codex/config.ts` | Parse assistant defaults at the provider boundary and preserve provider-owned effort strings. |
| `packages/providers/src/codex/binary-resolver.ts` | Resolve explicit binary overrides before safe autodetection and fail with actionable install guidance. |
| `packages/providers/src/community/qodercli/provider.ts` | Use an injectable Bun subprocess seam, merge request env, drain stderr concurrently, wrap Windows command shims, and escalate termination from `SIGTERM` to `SIGKILL`. |
| `packages/providers/src/shared/structured-output.ts` | Augment JSON-schema prompts and parse the assistant text without inventing a second schema implementation. |

---

### Task 0: Confirm the Baseline and Preserve the Dirty Checkout

**Files:**

- Verify only.

**Interfaces:**

- Establish that provider and config tests pass before OMP files exist.
- Record the user's unrelated modified and untracked paths so later diff review can distinguish them from this feature.

- [ ] **Step 1: Capture the initial worktree state.**

Run:

```bash
git status --short --branch
```

Expected: the branch is `dev`, and the existing `.archon/workflows/defaults/` and `.specify/extensions/ralph-loop/` changes remain visible.

- [ ] **Step 2: Run the nearest existing provider baselines.**

Run:

```bash
bun test packages/providers/src/community/qodercli/provider.test.ts
bun test packages/providers/src/registry.test.ts
bun test packages/core/src/config/config-loader.test.ts
```

Expected: all PASS.
If one fails before OMP work begins, record the exact failure and do not hide it in the OMP commits.

### Task 1: Add OMP Defaults Parsing and Binary Resolution

**Files:**

- Modify: `packages/providers/src/types.ts`
- Create: `packages/providers/src/community/omp/capabilities.ts`
- Create: `packages/providers/src/community/omp/config.ts`
- Create: `packages/providers/src/community/omp/config.test.ts`
- Create: `packages/providers/src/community/omp/binary-resolver.ts`
- Create: `packages/providers/src/community/omp/binary-resolver.test.ts`

**Interfaces:**

- Consume raw `SendQueryOptions.assistantConfig` values as `Record<string, unknown>`.
- Produce a validated `OmpProviderDefaults` object.
- Consume `OMP_BIN_PATH`, `assistants.omp.ompBinaryPath`, common install paths, and `PATH`.
- Produce one verified executable file path or one actionable error.

- [ ] **Step 1: Write the failing config parser tests.**

Create `packages/providers/src/community/omp/config.test.ts` with these cases.

```typescript
import { describe, expect, test } from 'bun:test';

import { parseOmpConfig } from './config';

describe('parseOmpConfig', () => {
  test('parses the supported OMP defaults', () => {
    expect(
      parseOmpConfig({
        model: 'openai-codex/gpt-6-sol',
        modelReasoningEffort: '  future-omp  ',
        ompBinaryPath: ' /opt/omp/bin/omp ',
        enableExtensions: true,
        ignored: 'value',
      })
    ).toEqual({
      model: 'openai-codex/gpt-6-sol',
      modelReasoningEffort: '  future-omp  ',
      ompBinaryPath: '/opt/omp/bin/omp',
      enableExtensions: true,
    });
  });

  test('rejects blank or non-string model fields', () => {
    expect(() => parseOmpConfig({ model: '   ' })).toThrow('assistants.omp.model');
    expect(() => parseOmpConfig({ ompBinaryPath: 42 })).toThrow(
      'assistants.omp.ompBinaryPath'
    );
  });

  test('preserves non-empty provider-owned effort exactly', () => {
    expect(parseOmpConfig({ modelReasoningEffort: '  future-omp  ' })).toEqual({
      modelReasoningEffort: '  future-omp  ',
    });
    expect(() => parseOmpConfig({ modelReasoningEffort: '' })).toThrow('non-empty string');
  });

  test('rejects non-boolean extension opt-in', () => {
    expect(() => parseOmpConfig({ enableExtensions: 'yes' })).toThrow(
      'assistants.omp.enableExtensions'
    );
  });
});
```

- [ ] **Step 2: Run the config parser test and confirm it fails for the missing module.**

Run:

```bash
bun test packages/providers/src/community/omp/config.test.ts
```

Expected: FAIL because `./config` does not exist.

- [ ] **Step 3: Add the canonical provider defaults type.**

Add this immediately after `QoderCliProviderDefaults` in `packages/providers/src/types.ts`.

```typescript
/**
 * Community provider defaults for the user-installed OMP CLI.
 */
export interface OmpProviderDefaults {
  [key: string]: unknown;
  /** Default OMP model ref, normally '<provider>/<model>'. */
  model?: string;
  /** Provider-owned value passed unchanged to `omp --thinking`. */
  modelReasoningEffort?: string;
  /**
   * Absolute path to the OMP executable.
   * `OMP_BIN_PATH` has higher precedence.
   */
  ompBinaryPath?: string;
  /**
   * Allow OMP to discover executable extensions from its normal roots.
   * Disabled by default because a project-local extension is executable code.
   * @default false
   */
  enableExtensions?: boolean;
}
```

- [ ] **Step 4: Implement the minimal config parser.**

Create `packages/providers/src/community/omp/config.ts`.

```typescript
import type { OmpProviderDefaults } from '../../types';

export type { OmpProviderDefaults };

function parseTrimmedString(
  raw: Record<string, unknown>,
  field: 'model' | 'ompBinaryPath'
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.omp.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

function parseRawEffort(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      'Invalid assistants.omp.modelReasoningEffort: expected a non-empty string.'
    );
  }
  return value;
}

function parseEnableExtensions(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error('Invalid assistants.omp.enableExtensions: expected a boolean.');
  }
  return value;
}

export function parseOmpConfig(raw: Record<string, unknown>): OmpProviderDefaults {
  const config: OmpProviderDefaults = {};
  const model = parseTrimmedString(raw, 'model');
  const ompBinaryPath = parseTrimmedString(raw, 'ompBinaryPath');
  const modelReasoningEffort = parseRawEffort(raw.modelReasoningEffort);
  const enableExtensions = parseEnableExtensions(raw.enableExtensions);

  if (model !== undefined) config.model = model;
  if (modelReasoningEffort !== undefined) config.modelReasoningEffort = modelReasoningEffort;
  if (ompBinaryPath !== undefined) config.ompBinaryPath = ompBinaryPath;
  if (enableExtensions !== undefined) config.enableExtensions = enableExtensions;
  return config;
}
```

- [ ] **Step 5: Run the config parser test and confirm it passes.**

Run:

```bash
bun test packages/providers/src/community/omp/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing binary resolver tests.**

Create `packages/providers/src/community/omp/binary-resolver.test.ts` by following the real-filesystem approach in Qoder's resolver test.
The test must create a temporary executable with `mkdtemp`, `writeFile`, and `chmod`, restore `process.env.OMP_BIN_PATH` in `afterEach`, and remove only its own temporary directory.

```typescript
import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveOmpBinaryPath } from './binary-resolver';

const originalEnvPath = process.env.OMP_BIN_PATH;

async function makeExecutable(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-omp-'));
  const path = join(dir, process.platform === 'win32' ? 'omp.exe' : 'omp');
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('resolveOmpBinaryPath', () => {
  afterEach(() => {
    if (originalEnvPath === undefined) delete process.env.OMP_BIN_PATH;
    else process.env.OMP_BIN_PATH = originalEnvPath;
  });

  test('prefers OMP_BIN_PATH over config', async () => {
    const path = await makeExecutable();
    process.env.OMP_BIN_PATH = path;
    try {
      await expect(resolveOmpBinaryPath('/different/omp')).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('uses the config path when the env override is absent', async () => {
    delete process.env.OMP_BIN_PATH;
    const path = await makeExecutable();
    try {
      await expect(resolveOmpBinaryPath(path, {})).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('rejects an invalid explicit path with an actionable label', async () => {
    await expect(
      resolveOmpBinaryPath(undefined, { OMP_BIN_PATH: '/definitely/missing/omp' })
    ).rejects.toThrow('OMP_BIN_PATH');
  });
});
```

- [ ] **Step 7: Run the resolver test and confirm it fails for the missing module.**

Run:

```bash
bun test packages/providers/src/community/omp/binary-resolver.test.ts
```

Expected: FAIL because `./binary-resolver` does not exist.

- [ ] **Step 8: Implement the OMP binary resolver.**

Create `packages/providers/src/community/omp/binary-resolver.ts` with the same executable-file checks and `execFileSync('which' | 'where')` behavior as Qoder's resolver.
Use this exact precedence:

1. The supplied environment's `OMP_BIN_PATH`.
2. `assistants.omp.ompBinaryPath`.
3. `~/.local/bin/omp`, which is OMP's native installer default through `PI_INSTALL_DIR`.
4. `~/.bun/bin/omp`, which is the documented Bun global-install layout.
5. `/opt/homebrew/bin/omp` on Apple Silicon.
6. `/usr/local/bin/omp` on POSIX.
7. `%USERPROFILE%\.local\bin\omp.exe`, `%USERPROFILE%\.bun\bin\omp.exe`, and `%APPDATA%\npm\omp.cmd` on Windows.
8. The first `omp` returned by `which` or `where`.

Use this terminal error text so installation and override paths are actionable.

```typescript
throw new Error(
  'OMP CLI binary not found.\n\n' +
    'Install OMP with one of:\n' +
    '  curl -fsSL https://omp.sh/install | sh\n' +
    '  brew install can1357/tap/omp\n' +
    '  bun install -g @oh-my-pi/pi-coding-agent\n\n' +
    'Then ensure `omp` is on PATH, set OMP_BIN_PATH, or configure:\n' +
    '  assistants:\n' +
    '    omp:\n' +
    '      ompBinaryPath: /absolute/path/to/omp\n'
);
```

Do not add an Archon vendor-directory probe because this feature does not bundle or download OMP.

- [ ] **Step 9: Run both Task 1 test files.**

Run:

```bash
bun test packages/providers/src/community/omp/config.test.ts
bun test packages/providers/src/community/omp/binary-resolver.test.ts
```

Expected: both PASS.

- [ ] **Step 10: Add the exact conservative capabilities constant.**

Create `packages/providers/src/community/omp/capabilities.ts` with the `OMP_CAPABILITIES` object shown in the Source-Derived Integration Contract.
Add a comment that a capability remains false when OMP itself supports a nearby feature but Archon's corresponding node field is not translated.
This file must exist before the provider implementation imports it in Task 3.

- [ ] **Step 11: Commit the defaults, resolver, and capability declaration.**

```bash
git add packages/providers/src/types.ts packages/providers/src/community/omp/capabilities.ts packages/providers/src/community/omp/config.ts packages/providers/src/community/omp/config.test.ts packages/providers/src/community/omp/binary-resolver.ts packages/providers/src/community/omp/binary-resolver.test.ts
git commit -m "feat(providers): add OMP CLI configuration"
```

### Task 2: Normalize OMP's NDJSON Event Stream

**Files:**

- Create: `packages/providers/src/community/omp/event-parser.ts`
- Create: `packages/providers/src/community/omp/event-parser.test.ts`

**Interfaces:**

- Consume one complete OMP stdout line at a time as untrusted JSON text.
- Produce zero or more ordered Archon `MessageChunk`s.
- Retain the session ID, terminal state, structured-output text, usage totals, final model, stop reason, and error detail for the provider.
- Never import types from the OMP source tree or package.

- [ ] **Step 1: Write a representative OMP JSON fixture in the parser test.**

The fixture must contain these lines in order:

```typescript
const OMP_SUCCESS_LINES = [
  JSON.stringify({
    type: 'session',
    version: 3,
    id: 'omp-session-1',
    timestamp: '2026-08-06T00:00:00.000Z',
    cwd: '/repo',
  }),
  JSON.stringify({
    type: 'message_start',
    message: { role: 'assistant', content: [] },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Think' },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Hel' },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'lo' },
  }),
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Think' },
        { type: 'text', text: 'Hello' },
      ],
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite: 0,
        totalTokens: 17,
        cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.2 },
      },
      stopReason: 'toolUse',
    },
  }),
  JSON.stringify({
    type: 'tool_execution_start',
    toolCallId: 'tool-1',
    toolName: 'read',
    args: { path: 'README.md' },
  }),
  JSON.stringify({
    type: 'tool_execution_end',
    toolCallId: 'tool-1',
    toolName: 'read',
    result: { content: [{ type: 'text', text: 'contents' }] },
    isError: false,
  }),
  JSON.stringify({
    type: 'message_start',
    message: { role: 'assistant', content: [] },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done' },
  }),
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      usage: {
        input: 8,
        output: 2,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 11,
        cost: { input: 0.02, output: 0.03, cacheRead: 0, cacheWrite: 0, total: 0.05 },
      },
      stopReason: 'stop',
    },
  }),
  JSON.stringify({ type: 'agent_end', messages: [] }),
];
```

- [ ] **Step 2: Write failing tests for the observable parser contract.**

Create `packages/providers/src/community/omp/event-parser.test.ts` and assert all of these behaviors.

```typescript
import { describe, expect, test } from 'bun:test';

import { OmpEventParser } from './event-parser';

describe('OmpEventParser', () => {
  test('maps session, thinking, coalesced text, tools, usage, and model', () => {
    const parser = new OmpEventParser(true);
    const chunks = OMP_SUCCESS_LINES.flatMap(line => parser.consumeLine(line));
    const result = parser.buildResult(true);

    expect(chunks).toContainEqual({ type: 'thinking', content: 'Think' });
    expect(chunks).toContainEqual({ type: 'assistant', content: 'Hello' });
    expect(chunks).toContainEqual({ type: 'assistant', content: 'Done' });
    expect(chunks).toContainEqual({
      type: 'tool',
      toolName: 'read',
      toolInput: { path: 'README.md' },
      toolCallId: 'tool-1',
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'read',
      toolOutput: '{"content":[{"type":"text","text":"contents"}]}',
      toolCallId: 'tool-1',
    });
    expect(result).toMatchObject({
      type: 'result',
      sessionId: 'omp-session-1',
      tokens: { input: 18, output: 7, total: 28, cost: 0.25 },
      cost: 0.25,
      stopReason: 'stop',
      numTurns: 2,
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      resumed: true,
    });
  });

  test('repairs only a strict missing suffix from message_end', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-tail' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hel' },
      })
    );
    const chunks = parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'stop',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));

    expect(chunks).toEqual([{ type: 'assistant', content: 'hello' }]);
  });

  test('marks model errors on the terminal result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-error' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          usage: { input: 2, output: 0, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'error',
          errorMessage: 'rate limited',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));

    expect(parser.buildResult(undefined)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'error',
      errors: ['rate limited'],
    });
  });

  test('parses best-effort structured output from assistant text', () => {
    const parser = new OmpEventParser(true);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-json' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '{"answer":"ok"}' },
      })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '{"answer":"ok"}' }],
          usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'stop',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));

    expect(parser.buildResult(undefined)).toMatchObject({
      structuredOutput: { answer: 'ok' },
    });
  });

  test('rejects malformed NDJSON with a bounded preview', () => {
    const parser = new OmpEventParser(false);
    expect(() => parser.consumeLine('{bad json')).toThrow('invalid JSON');
  });

  test('fails incomplete success streams instead of inventing a result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-incomplete' }));
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });
});
```

- [ ] **Step 3: Run the parser test and confirm it fails for the missing module.**

Run:

```bash
bun test packages/providers/src/community/omp/event-parser.test.ts
```

Expected: FAIL because `./event-parser` does not exist.

- [ ] **Step 4: Implement the parser as a concrete state holder.**

Create `packages/providers/src/community/omp/event-parser.ts`.
Import only Archon types, the Archon logger, and the existing structured-output parser.

```typescript
import { createLogger } from '@archon/paths';

import type { MessageChunk, TokenUsage } from '../../types';
import { tryParseStructuredOutput } from '../../shared/structured-output';

const MAX_ERROR_PREVIEW_CHARS = 1000;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function serializeToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
```

Implement `export class OmpEventParser` with these exact fields and responsibilities.

```typescript
export class OmpEventParser {
  private sessionId: string | undefined;
  private sawAgentEnd = false;
  private sawAssistantMessage = false;
  private pendingAssistant = '';
  private currentMessageText = '';
  private structuredText = '';
  private tokens: TokenUsage = { input: 0, output: 0, total: 0, cost: 0 };
  private stopReason: string | undefined;
  private errorMessage: string | undefined;
  private resolvedModel: string | undefined;
  private numTurns = 0;

  constructor(private readonly wantsStructured: boolean) {}

  consumeLine(line: string): MessageChunk[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const preview = line.slice(0, MAX_ERROR_PREVIEW_CHARS);
      throw new Error(`OMP CLI emitted invalid JSON: ${preview}`);
    }
    const event = asObject(parsed);
    if (!event) throw new Error('OMP CLI emitted a non-object JSON record.');
    return this.consumeEvent(event);
  }

  buildResult(resumed: boolean | undefined): MessageChunk {
    if (!this.sessionId || !this.sawAgentEnd || !this.sawAssistantMessage) {
      const missing = !this.sessionId
        ? 'session header'
        : !this.sawAgentEnd
          ? 'agent_end event'
          : 'assistant message';
      return {
        type: 'result',
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        isError: true,
        errorSubtype: 'omp_incomplete_output',
        errors: [`OMP CLI completed without a required ${missing}.`],
        ...(resumed !== undefined ? { resumed: false } : {}),
      };
    }

    const isError = this.stopReason === 'error' || this.stopReason === 'aborted';
    const structuredOutput = this.wantsStructured
      ? tryParseStructuredOutput(this.structuredText)
      : undefined;
    return {
      type: 'result',
      sessionId: this.sessionId,
      tokens: this.tokens,
      cost: this.tokens.cost,
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      numTurns: this.numTurns,
      ...(this.resolvedModel ? { resolvedModel: { id: this.resolvedModel } } : {}),
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      ...(isError
        ? {
            isError: true,
            errorSubtype: this.stopReason,
            ...(this.errorMessage ? { errors: [this.errorMessage] } : {}),
          }
        : {}),
      ...(resumed !== undefined ? { resumed } : {}),
    };
  }
}
```

Implement the private `consumeEvent()` switch with the following exact rules.

- `session`: require a non-empty string `id` and retain it.
- `message_start`: when `message.role === 'assistant'`, reset `currentMessageText` to an empty string.
- `message_update` plus `text_delta`: append the string `delta` to `pendingAssistant`, `currentMessageText`, and `structuredText` when structured output is requested.
- `message_update` plus `thinking_delta`: flush pending assistant text first, then emit one `thinking` chunk for the delta.
- `message_update` boundary variants such as `text_end`, `done`, and `error`: flush pending assistant text without emitting duplicate snapshot content.
- `message_end` for an assistant message: read the full text blocks, append only a strict suffix when the assembled text starts with the streamed text, flush the completed assistant chunk, accumulate the message's `usage`, increment `numTurns`, and retain final `provider/model`, `stopReason`, and `errorMessage`.
- `tool_execution_start`: flush text, then emit `tool` with a structurally validated object for `args` and the original `toolCallId`.
- `tool_execution_end`: flush text, emit a warning `system` chunk first when `isError === true`, then emit `tool_result` using `serializeToolResult` and the original ID.
- `notice`: flush text and emit its non-empty `message` as a `system` chunk.
- `auto_retry_start`: flush text and emit a `system` chunk containing the attempt and error message when those fields exist.
- `agent_end`: flush text and set `sawAgentEnd = true`.
- Unknown events: return only any required text flush and otherwise ignore them for forward compatibility.

Accumulate usage with addition rather than replacement because one OMP agent run can contain multiple model turns around tool calls.
Construct `resolvedModel` as `<provider>/<model>` when both fields exist and fall back to `model` when only that field exists.
If `message_end` assembled text does not start with the streamed text, do not emit either version again because replacing already-delivered stream content would duplicate output.
Log that mismatch as `omp.streaming_text_mismatch` with lengths only.

- [ ] **Step 5: Run the parser test and confirm it passes.**

Run:

```bash
bun test packages/providers/src/community/omp/event-parser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the tested parser.**

```bash
git add packages/providers/src/community/omp/event-parser.ts packages/providers/src/community/omp/event-parser.test.ts
git commit -m "feat(providers): normalize OMP JSON events"
```

### Task 3: Implement the OMP Process Provider

**Files:**

- Create: `packages/providers/src/community/omp/provider.ts`
- Create: `packages/providers/src/community/omp/provider.test.ts`

**Interfaces:**

- Consume `prompt`, `cwd`, optional `resumeSessionId`, and `SendQueryOptions` through `IAgentProvider.sendQuery()`.
- Produce ordered `MessageChunk`s and exactly one terminal `result` for every normally completed process.
- Spawn one local child process and terminate it on abort or early generator close.

- [ ] **Step 1: Write failing argv-builder tests.**

Export `buildOmpArgs()` from the future provider and test these cases in `packages/providers/src/community/omp/provider.test.ts`.

```typescript
describe('buildOmpArgs', () => {
  test('builds a safe headless OMP command', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: {
        model: 'openai-codex/gpt-6-sol',
        modelReasoningEffort: 'high',
      },
      requestOptions: {
        systemPrompt: ['first', 'second'],
        nodeConfig: { skills: ['archon', 'review-*'] },
      },
    });

    expect(result.args).toEqual([
      '--mode',
      'json',
      '--cwd',
      '/repo',
      '--yolo',
      '--no-title',
      '--no-extensions',
      '--model',
      'openai-codex/gpt-6-sol',
      '--thinking',
      'high',
      '--system-prompt',
      'first\n\nsecond',
      '--skills',
      'archon,review-*',
      '--',
      'hello',
    ]);
  });

  test('uses request model and string thinking before assistant defaults', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: { model: 'fallback/model', modelReasoningEffort: 'low' },
      requestOptions: {
        model: 'selected/model',
        nodeConfig: { thinking: 'off', effort: 'future-effort' },
      },
    });
    expect(result.args).toContain('selected/model');
    expect(result.thinking).toBe('off');
  });

  test('passes raw effort unchanged when string thinking is absent', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: {},
      requestOptions: { nodeConfig: { effort: '  future-omp  ' } },
    });
    expect(result.thinking).toBe('  future-omp  ');
  });

  test('uses resume, fork, and in-memory flags without inventing session ids', () => {
    const resumeArgs = buildOmpArgs({
      prompt: 'a',
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
    }).args;
    const resumeIndex = resumeArgs.indexOf('--resume');
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(resumeArgs[resumeIndex + 1]).toBe('session-1');

    const forkArgs = buildOmpArgs({
      prompt: 'b',
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
      requestOptions: { forkSession: true },
    }).args;
    const forkIndex = forkArgs.indexOf('--fork');
    expect(forkIndex).toBeGreaterThan(-1);
    expect(forkArgs[forkIndex + 1]).toBe('session-1');

    expect(
      buildOmpArgs({
        prompt: 'c',
        cwd: '/repo',
        config: {},
        requestOptions: { persistSession: false },
      }).args
    ).toContain('--no-session');
  });

  test('rejects resume when persistence is disabled', () => {
    expect(() =>
      buildOmpArgs({
        prompt: 'hello',
        cwd: '/repo',
        config: {},
        resumeSessionId: 'session-1',
        requestOptions: { persistSession: false },
      })
    ).toThrow('cannot resume');
  });

  test('omits no-extensions only after explicit opt-in', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: { enableExtensions: true },
    });
    expect(result.args).not.toContain('--no-extensions');
  });
});
```

- [ ] **Step 2: Write fake-process tests for fragmented NDJSON, failures, and abort.**

Define an injectable process boundary matching the Qoder provider pattern.

```typescript
export interface OmpProcess {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
}

export interface OmpSpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

export type OmpSpawner = (command: string[], options: OmpSpawnOptions) => OmpProcess;
```

Use fake `ReadableStream<Uint8Array>` objects to assert all of these behaviors.

- A successful stream split in the middle of JSON lines still emits the fixture's assistant/tool chunks and a terminal result with `sessionId`.
- A resumed successful stream emits `resumed: true`.
- Exit code 2 with stderr `missing credentials` emits `system` followed by an `omp_exit_nonzero` result and sets `resumed: false` when resume was requested.
- Exit code 0 without `agent_end` emits `omp_incomplete_output` rather than success.
- A malformed JSON line emits `omp_protocol_error` and kills the still-running child.
- A pre-aborted signal rejects with `Query aborted` without spawning.
- An abort during streaming sends `SIGTERM`, eventually sends `SIGKILL` if needed, and rejects with `Query aborted`.
- The spawned environment contains request-scoped values overlaid on defined `process.env` values.
- A JSON-schema request passes the augmented prompt and attaches parsed structured output to the terminal result.

- [ ] **Step 3: Run the provider test and confirm it fails for the missing module.**

Run:

```bash
bun test packages/providers/src/community/omp/provider.test.ts
```

Expected: FAIL because `./provider` does not exist.

- [ ] **Step 4: Implement argv construction.**

Create `packages/providers/src/community/omp/provider.ts` with these imports.

```typescript
import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
  SystemPromptInput,
} from '../../types';
import {
  augmentPromptForJsonSchema,
} from '../../shared/structured-output';
import { OMP_CAPABILITIES } from './capabilities';
import { resolveOmpBinaryPath } from './binary-resolver';
import { parseOmpConfig, type OmpProviderDefaults } from './config';
import { OmpEventParser } from './event-parser';

const MAX_CAPTURE_CHARS = 1_000_000;
const TERMINATION_GRACE_MS = 5_000;

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.omp');
  return cachedLog;
}
```

Define `BuildOmpArgsInput` and `BuildOmpArgsResult` with complete annotations.

```typescript
interface BuildOmpArgsInput {
  prompt: string;
  cwd: string;
  config: OmpProviderDefaults;
  requestOptions?: SendQueryOptions;
  resumeSessionId?: string;
}

interface BuildOmpArgsResult {
  args: string[];
  model?: string;
  thinking?: string;
}
```

Implement this precedence and validation exactly.

```typescript
function resolveSystemPrompt(
  input: SystemPromptInput | undefined
): { flag: '--system-prompt' | '--append-system-prompt'; value: string } | undefined {
  if (typeof input === 'string') {
    return input.length > 0 ? { flag: '--system-prompt', value: input } : undefined;
  }
  if (Array.isArray(input)) {
    const value = input.filter(part => part.length > 0).join('\n\n');
    return value.length > 0 ? { flag: '--system-prompt', value } : undefined;
  }
  if (input?.type === 'preset' && typeof input.append === 'string' && input.append.length > 0) {
    return { flag: '--append-system-prompt', value: input.append };
  }
  return undefined;
}

function resolveThinking(
  requestOptions: SendQueryOptions | undefined,
  config: OmpProviderDefaults
): string | undefined {
  const rawThinking = requestOptions?.nodeConfig?.thinking;
  if (typeof rawThinking === 'string') {
    if (rawThinking.length === 0) throw new Error('OMP thinking must be a non-empty string.');
    return rawThinking;
  }
  const rawEffort = requestOptions?.nodeConfig?.effort;
  if (typeof rawEffort === 'string') {
    if (rawEffort.length === 0) throw new Error('OMP effort must be a non-empty string.');
    return rawEffort;
  }
  return config.modelReasoningEffort;
}
```

When `thinking` is a non-null object, emit one warning `system` chunk before spawning and use an explicit `effort` or `modelReasoningEffort` fallback.
Do not serialize a Claude-shaped thinking object into a CLI argument.

Build args in this stable order so tests and logs are deterministic.

```typescript
export function buildOmpArgs(input: BuildOmpArgsInput): BuildOmpArgsResult {
  if (input.resumeSessionId && input.requestOptions?.persistSession === false) {
    throw new Error('OMP cannot resume a session when persistSession is false.');
  }

  const args = ['--mode', 'json', '--cwd', input.cwd, '--yolo', '--no-title'];
  if (input.config.enableExtensions !== true) args.push('--no-extensions');

  const model = input.requestOptions?.model ?? input.config.model;
  if (model) args.push('--model', model);

  const thinking = resolveThinking(input.requestOptions, input.config);
  if (thinking) args.push('--thinking', thinking);

  const systemPrompt = resolveSystemPrompt(
    input.requestOptions?.systemPrompt ?? input.requestOptions?.nodeConfig?.systemPrompt
  );
  if (systemPrompt) args.push(systemPrompt.flag, systemPrompt.value);

  const skills = input.requestOptions?.nodeConfig?.skills;
  if (skills && skills.length > 0) args.push('--skills', skills.join(','));

  if (input.requestOptions?.persistSession === false) args.push('--no-session');
  else if (input.resumeSessionId) {
    args.push(input.requestOptions?.forkSession === true ? '--fork' : '--resume');
    args.push(input.resumeSessionId);
  }

  args.push('--', input.prompt);
  return { args, model, thinking };
}
```

- [ ] **Step 5: Implement process and stream helpers locally.**

Use Qoder's existing patterns without extracting a new cross-provider abstraction in this feature.
Add these local helpers with complete annotations.

- `defaultSpawner()` using `Bun.spawn` with `cwd`, the merged environment, ignored stdin, and piped stdout/stderr.
- `buildProviderEnv()` that filters undefined `process.env` entries and overlays `requestOptions.env`.
- `buildSpawnCommand()` that wraps `.cmd` and `.bat` executables with `cmd.exe /d /s /c` on Windows.
- `readStream()` that drains stderr concurrently and caps retained diagnostic text at 1,000,000 characters.
- `streamLines()` that uses one `TextDecoder`, preserves a partial line between byte chunks, accepts `\n` and `\r\n`, and yields a final non-empty tail.
- `scheduleKill()` that sends `SIGTERM`, schedules `SIGKILL` after 5 seconds, and `unref()`s the timer where supported.
- `buildExitErrorMessage()` that includes a bounded stderr diagnostic preview and tells users to run `omp` or `omp setup` when the detail indicates missing authentication or model configuration.

Implement the process and streaming core as follows.

```typescript
function defaultSpawner(command: string[], options: OmpSpawnOptions): OmpProcess {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    kill: (signal?: NodeJS.Signals): void => {
      proc.kill(signal);
    },
  };
}

function buildProviderEnv(requestEnv?: Record<string, string>): Record<string, string> {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...baseEnv, ...(requestEnv ?? {}) };
}

function buildSpawnCommand(binaryPath: string, args: string[]): string[] {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binaryPath)) {
    return ['cmd.exe', '/d', '/s', '/c', binaryPath, ...args];
  }
  return [binaryPath, ...args];
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (output.length < MAX_CAPTURE_CHARS) {
        output += decoder
          .decode(next.value, { stream: true })
          .slice(0, MAX_CAPTURE_CHARS - output.length);
      }
    }
    if (output.length < MAX_CAPTURE_CHARS) {
      output += decoder.decode().slice(0, MAX_CAPTURE_CHARS - output.length);
    }
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function* streamLines(
  stream: ReadableStream<Uint8Array> | null
): AsyncGenerator<string> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        yield line;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

function scheduleKill(proc: OmpProcess): ReturnType<typeof setTimeout> {
  proc.kill('SIGTERM');
  const timer = setTimeout(() => proc.kill('SIGKILL'), TERMINATION_GRACE_MS);
  if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}

function buildExitErrorMessage(exitCode: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 1000);
  const lower = detail.toLowerCase();
  if (
    lower.includes('credential') ||
    lower.includes('authenticated model') ||
    lower.includes('/login')
  ) {
    return (
      'OMP CLI is not ready for headless use. Run `omp setup` or start `omp` and complete ' +
      '`/login`, then retry.' +
      (detail ? ` OMP said: ${detail}` : '')
    );
  }
  return detail
    ? `OMP CLI exited with code ${String(exitCode)}: ${detail}`
    : `OMP CLI exited with code ${String(exitCode)}.`;
}
```

Do not cap valid stdout JSON line length because OMP's final `agent_end` record can legitimately be multi-megabyte.
Only cap retained diagnostic previews.

- [ ] **Step 6: Implement `OmpProvider.sendQuery()`.**

The method must use this order.

1. Reject an already-aborted request before binary resolution or spawn.
2. Parse `assistantConfig` with `parseOmpConfig()`.
3. Merge request-scoped environment values.
4. Resolve the OMP binary.
5. Prompt-augment only when `outputFormat.type === 'json_schema'`.
6. Build args and emit any unsupported thinking-object warning.
7. Spawn one process and start draining stderr immediately.
8. Feed every non-empty stdout line to one `OmpEventParser` and yield its chunks in order.
9. On a parser error, terminate the child and retain the protocol error until the process is reaped.
10. Await the exit code and stderr.
11. If aborted, throw `Query aborted`.
12. If a protocol error occurred, emit `system` plus `result` with `errorSubtype: 'omp_protocol_error'` and `resumed: false` when resume was requested.
13. If exit is non-zero, emit `system` plus `result` with `errorSubtype: 'omp_exit_nonzero'`, the captured session ID when available, and `resumed: false` when resume was requested.
14. If exit is zero, yield `parser.buildResult(resumeSessionId === undefined ? undefined : true)`.
15. In `finally`, remove the abort listener and terminate an unreaped process when the consumer closes the generator early.

The provider class surface is:

```typescript
export class OmpProvider implements IAgentProvider {
  private readonly spawn: OmpSpawner;

  constructor(options?: { spawn?: OmpSpawner }) {
    this.spawn = options?.spawn ?? defaultSpawner;
  }

  getType(): string {
    return 'omp';
  }

  getCapabilities(): ProviderCapabilities {
    return OMP_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');

    const config = parseOmpConfig(requestOptions?.assistantConfig ?? {});
    const env = buildProviderEnv(requestOptions?.env);
    const binaryPath = await resolveOmpBinaryPath(config.ompBinaryPath, env);
    const outputFormat = requestOptions?.outputFormat;
    const wantsStructured = outputFormat?.type === 'json_schema';
    const effectivePrompt = outputFormat
      ? augmentPromptForJsonSchema(prompt, outputFormat.schema)
      : prompt;
    const { args, model, thinking } = buildOmpArgs({
      prompt: effectivePrompt,
      cwd,
      config,
      requestOptions,
      resumeSessionId,
    });

    const rawThinking = requestOptions?.nodeConfig?.thinking;
    if (rawThinking !== null && typeof rawThinking === 'object') {
      yield {
        type: 'system',
        content:
          '⚠️ Warning: OMP ignored object-form `thinking`; use a string `thinking` or provider-owned `effort` value.',
      };
    }

    const command = buildSpawnCommand(binaryPath, args);
    getLog().info(
      {
        cwd,
        model,
        thinking,
        resumed: resumeSessionId !== undefined,
        forked: requestOptions?.forkSession === true,
      },
      'omp.query_started'
    );

    const parser = new OmpEventParser(wantsStructured);
    const proc = this.spawn(command, { cwd, env });
    const stderrPromise = readStream(proc.stderr);
    const abortSignal = requestOptions?.abortSignal;
    let processExited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let protocolError: Error | undefined;
    const onAbort = (): void => {
      killTimer ??= scheduleKill(proc);
    };

    if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });

    try {
      for await (const line of streamLines(proc.stdout)) {
        if (line.trim().length === 0) continue;
        try {
          for (const chunk of parser.consumeLine(line)) yield chunk;
        } catch (error: unknown) {
          protocolError = error instanceof Error ? error : new Error(String(error));
          killTimer ??= scheduleKill(proc);
          break;
        }
      }

      const exitCode = await proc.exited;
      processExited = true;
      const stderr = await stderrPromise;
      if (abortSignal?.aborted) throw new Error('Query aborted');

      if (protocolError) {
        const message = protocolError.message;
        yield { type: 'system', content: message };
        yield {
          type: 'result',
          ...(parser.getSessionId() ? { sessionId: parser.getSessionId() } : {}),
          isError: true,
          errorSubtype: 'omp_protocol_error',
          errors: [message],
          ...(resumeSessionId !== undefined ? { resumed: false } : {}),
        };
        return;
      }

      if (exitCode !== 0) {
        const message = buildExitErrorMessage(exitCode, stderr);
        yield { type: 'system', content: message };
        yield {
          type: 'result',
          ...(parser.getSessionId() ? { sessionId: parser.getSessionId() } : {}),
          isError: true,
          errorSubtype: 'omp_exit_nonzero',
          errors: [message],
          ...(resumeSessionId !== undefined ? { resumed: false } : {}),
        };
        return;
      }

      yield parser.buildResult(resumeSessionId === undefined ? undefined : true);
      getLog().info({ sessionId: parser.getSessionId() }, 'omp.query_completed');
    } finally {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      if (killTimer && processExited) clearTimeout(killTimer);
      if (!processExited && !killTimer) scheduleKill(proc);
    }
  }
}
```

Add this accessor to `OmpEventParser` so transport-level error chunks can retain a header that arrived before failure.

```typescript
getSessionId(): string | undefined {
  return this.sessionId;
}
```

- [ ] **Step 7: Run the provider and parser tests.**

Run:

```bash
bun test packages/providers/src/community/omp/event-parser.test.ts
bun test packages/providers/src/community/omp/provider.test.ts
```

Expected: both PASS.

- [ ] **Step 8: Commit the process provider.**

```bash
git add packages/providers/src/community/omp/provider.ts packages/providers/src/community/omp/provider.test.ts
git commit -m "feat(providers): add OMP CLI transport"
```

### Task 4: Register OMP and Expose Safe Configuration

**Files:**

- Create: `packages/providers/src/community/omp/registration.ts`
- Create: `packages/providers/src/community/omp/index.ts`
- Modify: `packages/providers/src/registry.ts`
- Modify: `packages/providers/src/registry.test.ts`
- Modify: `packages/providers/src/index.ts`
- Modify: `packages/providers/package.json`
- Modify: `packages/core/src/config/config-loader.ts`
- Modify: `packages/core/src/config/config-loader.test.ts`

**Interfaces:**

- Produce a community `ProviderRegistration` with ID `omp` and no Archon-managed credential specs.
- Make OMP visible through every registry-backed CLI, server, workflow, and web provider list.
- Expose non-sensitive defaults to web clients while hiding the executable path.

- [ ] **Step 1: Add idempotent community registration.**

Create `packages/providers/src/community/omp/registration.ts`.

```typescript
import { isRegisteredProvider, registerProvider } from '../../registry';

import { OMP_CAPABILITIES } from './capabilities';
import { OmpProvider } from './provider';

export function registerOmpProvider(): void {
  if (isRegisteredProvider('omp')) return;
  registerProvider({
    id: 'omp',
    displayName: 'OMP CLI',
    factory: () => new OmpProvider(),
    capabilities: OMP_CAPABILITIES,
    builtIn: false,
    credentials: { kind: 'static', specs: [] },
  });
}
```

The empty credential list is intentional because OMP owns its many backend credentials and login flows.

- [ ] **Step 2: Add the community subpath exports.**

Create `packages/providers/src/community/omp/index.ts`.

```typescript
export { OMP_CAPABILITIES } from './capabilities';
export { parseOmpConfig, type OmpProviderDefaults } from './config';
export { resolveOmpBinaryPath, resolveFromPath, isExecutableFile } from './binary-resolver';
export { OmpEventParser } from './event-parser';
export {
  OmpProvider,
  buildOmpArgs,
  type OmpProcess,
  type OmpSpawner,
} from './provider';
export { registerOmpProvider } from './registration';
```

Add `./community/omp` and `./community/omp/binary-resolver` to `packages/providers/package.json` exports.
Re-export the same public symbols from `packages/providers/src/index.ts`, aliasing generic resolver helper names as `ompIsExecutableFile` and `ompResolveFromPath` just as the Qoder exports do.

- [ ] **Step 3: Write failing registry tests before changing the aggregator.**

Import `registerOmpProvider` in `packages/providers/src/registry.test.ts`.
Update the aggregator test to expect `omp` and the idempotence test to assert exactly one OMP registration.
Add this provider-specific block.

```typescript
describe('registerOmpProvider (community provider)', () => {
  test('registers OMP with the wired capabilities and no Archon credential catalog', () => {
    registerOmpProvider();
    const registration = getRegistration('omp');
    expect(registration.displayName).toBe('OMP CLI');
    expect(registration.builtIn).toBe(false);
    expect(registration.credentials).toEqual({ kind: 'static', specs: [] });
    expect(getProviderCapabilities('omp')).toMatchObject({
      sessionResume: true,
      skills: true,
      structuredOutput: 'best-effort',
      envInjection: true,
      effortControl: true,
      thinkingControl: true,
      mcp: false,
      hooks: false,
      agents: false,
      toolRestrictions: false,
      nativeTools: false,
      containerExec: false,
    });
  });

  test('is idempotent and does not collide with built-ins', () => {
    registerOmpProvider();
    expect(() => registerOmpProvider()).not.toThrow();
    expect(getRegisteredProviders().filter(provider => provider.id === 'omp')).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the registry test and confirm the aggregator case fails.**

Run:

```bash
bun test packages/providers/src/registry.test.ts
```

Expected: the direct registration tests pass after the new files exist, while the aggregator expectation fails until the registry is wired.

- [ ] **Step 5: Wire the registry aggregator.**

Add this import and call in `packages/providers/src/registry.ts`.

```typescript
import { registerOmpProvider } from './community/omp/registration';
```

```typescript
export function registerCommunityProviders(): void {
  registerOpencodeProvider();
  registerPiProvider();
  registerCopilotProvider();
  registerQoderCliProvider();
  registerOmpProvider();
}
```

Do not change CLI or server entrypoints because both already call `registerCommunityProviders()`.

- [ ] **Step 6: Add package-isolated OMP tests to the provider test script.**

Append these invocations before the OpenCode test in `packages/providers/package.json`.

```text
bun test src/community/omp/config.test.ts &&
bun test src/community/omp/binary-resolver.test.ts &&
bun test src/community/omp/event-parser.test.ts &&
bun test src/community/omp/provider.test.ts &&
```

Keep them as separate `bun test` processes so future module mocks cannot pollute sibling provider tests.

- [ ] **Step 7: Write the safe-config test.**

Add this beside the Qoder safe-config test in `packages/core/src/config/config-loader.test.ts`.

```typescript
test('exposes only safe OMP assistant fields', async () => {
  mockFsReadFile.mockResolvedValue(`
assistants:
  omp:
    model: openai-codex/gpt-6-sol
    modelReasoningEffort: high
    enableExtensions: true
    ompBinaryPath: /sensitive/omp
`);
  const config = await loadConfig();
  const safe = toSafeConfig(config);
  expect(safe.assistants.omp).toEqual({
    model: 'openai-codex/gpt-6-sol',
    modelReasoningEffort: 'high',
    enableExtensions: true,
  });
  expect(safe.assistants.omp).not.toHaveProperty('ompBinaryPath');
});
```

- [ ] **Step 8: Run the core config test and confirm it fails before the allowlist change.**

Run:

```bash
bun test packages/core/src/config/config-loader.test.ts
```

Expected: FAIL because OMP fields are hidden by the unknown-provider safe-config fallback.

- [ ] **Step 9: Add OMP's safe fields.**

Add this entry to `SAFE_ASSISTANT_FIELDS` in `packages/core/src/config/config-loader.ts`.

```typescript
omp: ['model', 'modelReasoningEffort', 'enableExtensions'],
```

Keep `ompBinaryPath` absent because absolute executable paths must not be returned to web clients.

- [ ] **Step 10: Run the registry, provider-package, and core config tests.**

Run:

```bash
bun test packages/providers/src/registry.test.ts
bun --filter @archon/providers test
bun test packages/core/src/config/config-loader.test.ts
```

Expected: all PASS.

- [ ] **Step 11: Commit registry and safe-config wiring.**

```bash
git add packages/providers/src/community/omp/registration.ts packages/providers/src/community/omp/index.ts packages/providers/src/registry.ts packages/providers/src/registry.test.ts packages/providers/src/index.ts packages/providers/package.json packages/core/src/config/config-loader.ts packages/core/src/config/config-loader.test.ts
git commit -m "feat(providers): register OMP community provider"
```

### Task 5: Document OMP and Regenerate the Capability Matrix

**Files:**

- Modify: `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`
- Modify: `packages/docs-web/src/content/docs/getting-started/configuration.md`
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md`
- Modify: `packages/docs-web/src/content/docs/guides/authoring-workflows.md`
- Modify: `skills/archon-workflow-creator/references/providers-models-thinking.md`
- Generate: `packages/docs-web/src/content/docs/reference/provider-capabilities.md`

**Interfaces:**

- Teach users how to install, authenticate, select, configure, and troubleshoot OMP.
- Keep human-maintained provider lists aligned with the runtime registry.
- Produce the generated capability matrix from the registered capability constants.

- [ ] **Step 1: Add OMP to the AI assistants guide.**

Update the frontmatter description and structured-output table in `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` so OMP appears with the best-effort providers.
Add a new `## OMP CLI (Community Provider)` section immediately after Qoder CLI with the following content and examples.

````markdown
## OMP CLI (Community Provider)

**CLI-backed community provider.**
Archon invokes a user-installed `omp` executable once per turn in newline-delimited JSON mode.
OMP owns model discovery, authentication, and persisted session files under its normal configuration roots.

### Install and authenticate

Install OMP through one of its supported methods:

```bash
curl -fsSL https://omp.sh/install | sh
# or
brew install can1357/tap/omp
# or
bun install -g @oh-my-pi/pi-coding-agent
```

Run `omp setup` or start `omp` interactively, select a default model, and complete `/login` for that model's upstream provider.
Confirm the executable is available:

```bash
omp --version
```

### Binary path configuration

Archon resolves `OMP_BIN_PATH`, then `assistants.omp.ompBinaryPath`, then OMP's native, Bun, Homebrew, system, and PATH install locations.

```ini
OMP_BIN_PATH=/absolute/path/to/omp
```

```yaml
assistants:
  omp:
    ompBinaryPath: /absolute/path/to/omp
```

### Configuration

```yaml
assistants:
  omp:
    model: openai-codex/gpt-6-sol
    modelReasoningEffort: high
    enableExtensions: false
```

`model` maps unchanged to `omp --model`.
`modelReasoningEffort` is the legacy provider default for `omp --thinking`; a resolved tier, alias, workflow, or node `effort` takes precedence.
String `thinking` values, including `off` and `auto`, also map to `omp --thinking`.
Per-node `skills` names map to OMP's `--skills` filter and can select skills discovered from `.agents/skills` and OMP's other configured roots.

Archon passes `--yolo` because workflow and remote-chat turns are non-interactive.
The OMP process inherits Archon's host-user permissions and environment, including access to resources outside its working directory.
Archon's worktree isolation separates Git branches but is not a filesystem or host security boundary, so it does not contain an unsandboxed OMP process.
Run Archon and OMP inside an external sandbox, container, or virtual machine when that host-level access is unacceptable.
Worktree isolation is still recommended to prevent branch conflicts.

Project and user extension discovery is disabled by default because OMP extensions are executable code.
Set `enableExtensions: true` only when the OMP extension roots and the target repository are trusted.

OMP structured output is best-effort.
Archon appends the JSON schema instruction, parses the final assistant text, validates it, and lets the existing workflow reask loop handle schema misses.

Archon's per-node `mcp`, `hooks`, `agents`, and tool-restriction fields are not translated in this version even though OMP has its own nearby features and configuration files.
````

Keep each prose sentence on its own physical line when applying the content.

- [ ] **Step 2: Update configuration references.**

Add `OMP_BIN_PATH` beside the other AI executable overrides in `packages/docs-web/src/content/docs/getting-started/configuration.md`.
In `packages/docs-web/src/content/docs/reference/configuration.md`, add `omp` to the registered-provider examples, correct the stale `DEFAULT_AI_ASSISTANT` list to include every currently registered provider, and add this provider note after the Qoder or Copilot provider notes.

```markdown
### AI Providers -- OMP CLI (community)

The OMP provider reads `assistants.omp.{model, modelReasoningEffort, ompBinaryPath, enableExtensions}` from `~/.archon/config.yaml` or `.archon/config.yaml`.
`OMP_BIN_PATH` overrides `ompBinaryPath`.
Authentication and upstream model configuration remain in OMP.
See the [AI Assistants guide](/getting-started/ai-assistants/#omp-cli-community-provider) for setup and security behavior.
```

- [ ] **Step 3: Remove hard-coded provider drift from the workflow guide.**

In `packages/docs-web/src/content/docs/guides/authoring-workflows.md`, replace the stale provider lists around the provider-validation example with wording that points to the generated capability matrix or the provider list returned by the validation error.
Do not copy another fixed list into the prose.
Update the sample error to `Unknown provider 'claud'. Registered: claude, codex, opencode, pi, copilot, qodercli, omp` so it matches the registry order after OMP registration.

- [ ] **Step 4: Update the bundled workflow-authoring skill reference.**

In `skills/archon-workflow-creator/references/providers-models-thinking.md`:

- Add `qodercli` and `omp` to the provider ID list because Qoder is already supported but omitted.
- Add capability-table rows for both Qoder and OMP that match their runtime constants.
- Add OMP to the typical config sample.
- Add an OMP section after Qoder explaining `provider/model`, raw `effort`, string `thinking`, session resume, skills filtering, and default-disabled executable extensions.
- Add Qoder and OMP to the best-effort structured-output table.
- Keep all capability statements field-specific so OMP's own ambient MCP or subagents are not mistaken for Archon node-field support.

Use this OMP example.

```yaml
provider: omp
model: openai-codex/gpt-6-sol
effort: high
skills: [archon]
```

- [ ] **Step 5: Regenerate, never hand-edit, the provider capability matrix.**

Run:

```bash
bun run generate:capability-matrix
```

Expected: `packages/docs-web/src/content/docs/reference/provider-capabilities.md` gains `omp` in the provider list and table, with only session resume, skills, best-effort structured output, env injection, effort control, and thinking control marked supported.

- [ ] **Step 6: Verify generated and Markdown formatting checks.**

Run:

```bash
bun run scripts/generate-capability-matrix.ts --check
bun run format:check
```

Expected: both PASS.

- [ ] **Step 7: Commit documentation and generated output.**

```bash
git add packages/docs-web/src/content/docs/getting-started/ai-assistants.md packages/docs-web/src/content/docs/getting-started/configuration.md packages/docs-web/src/content/docs/reference/configuration.md packages/docs-web/src/content/docs/guides/authoring-workflows.md skills/archon-workflow-creator/references/providers-models-thinking.md packages/docs-web/src/content/docs/reference/provider-capabilities.md
git commit -m "docs(providers): document OMP CLI setup"
```

### Task 6: Validate the Full Integration and Run a Real OMP Smoke Test

**Files:**

- Verify only.
- Do not add a network-dependent test to the repository.

**Interfaces:**

- Verify deterministic unit/package/monorepo gates.
- Verify the actual local OMP 17.2.9 executable, authentication, file tool use, session persistence, resume reporting, and structured output.

- [ ] **Step 1: Run focused tests from narrowest to broadest.**

Run:

```bash
bun test packages/providers/src/community/omp/config.test.ts
bun test packages/providers/src/community/omp/binary-resolver.test.ts
bun test packages/providers/src/community/omp/event-parser.test.ts
bun test packages/providers/src/community/omp/provider.test.ts
bun test packages/providers/src/registry.test.ts
bun test packages/core/src/config/config-loader.test.ts
bun --filter @archon/providers test
```

Expected: all PASS without running unrelated test files in a shared process.

- [ ] **Step 2: Run provider and core type checks.**

Run:

```bash
bun --filter @archon/providers type-check
bun --filter @archon/core type-check
```

Expected: both PASS with no `any` or incomplete public annotations.

- [ ] **Step 3: Verify the real installed executable without spending model tokens.**

Run:

```bash
command -v omp
omp --version
```

Expected in the source author's current environment: `/Users/dale/.bun/bin/omp` and `omp/17.2.9` or a newer compatible version.

- [ ] **Step 4: Run the opt-in real-process smoke after confirming OMP auth and model selection.**

This smoke intentionally spends a small number of model tokens and writes only inside a newly created temporary directory.
It verifies the actual subprocess and OMP session store rather than the injected fake process.

Run from the Archon repository root:

```bash
OMP_BIN_PATH="$(command -v omp)" bun -e '
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpProvider } from "./packages/providers/src/community/omp/provider.ts";

const cwd = await mkdtemp(join(tmpdir(), "archon-omp-smoke-"));
const provider = new OmpProvider();
let sessionId: string | undefined;
try {
  for await (const chunk of provider.sendQuery(
    "Create omp-smoke.txt containing exactly OMP_SMOKE_OK, then reply done.",
    cwd
  )) {
    if (chunk.type === "result") {
      if (chunk.isError) throw new Error(JSON.stringify(chunk));
      sessionId = chunk.sessionId;
    }
  }
  if (!sessionId) throw new Error("OMP did not return a session id");
  if ((await readFile(join(cwd, "omp-smoke.txt"), "utf8")).trim() !== "OMP_SMOKE_OK") {
    throw new Error("OMP tool execution did not create the expected file");
  }

  let resumed: boolean | undefined;
  let structured: unknown;
  for await (const chunk of provider.sendQuery(
    "Read omp-smoke.txt and return its content in the requested JSON object.",
    cwd,
    sessionId,
    {
      outputFormat: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { content: { type: "string" } },
          required: ["content"],
          additionalProperties: false,
        },
      },
    }
  )) {
    if (chunk.type === "result") {
      if (chunk.isError) throw new Error(JSON.stringify(chunk));
      resumed = chunk.resumed;
      structured = chunk.structuredOutput;
    }
  }
  if (resumed !== true) throw new Error("OMP resume was not reported as successful");
  const structuredContent =
    typeof structured === "object" && structured !== null && "content" in structured
      ? structured.content
      : undefined;
  if (structuredContent !== "OMP_SMOKE_OK") {
    throw new Error(`Unexpected structured output: ${JSON.stringify(structured)}`);
  }
  console.log("OMP provider smoke passed");
} finally {
  await rm(cwd, { recursive: true, force: true });
}
'
```

Expected: `OMP provider smoke passed`.
If OMP reports missing credentials or a missing default model, configure those in OMP and rerun rather than adding Archon credential storage to this feature.

- [ ] **Step 5: Run the complete pre-PR gate.**

Run:

```bash
bun run validate
```

Expected: bundled checks, schemas, type checking, lint, formatting, generated-file checks, and all package-isolated tests PASS.

- [ ] **Step 6: Review the final diff and commits.**

Run:

```bash
git status --short
git diff --check
git log --oneline --max-count=6
```

Expected:

- The user's pre-existing `.archon` and `.specify` changes are still present and untouched.
- No `CHANGELOG.md` edit exists.
- No OMP SDK dependency exists in a package manifest or lockfile.
- The only generated file change is the capability matrix produced by its generator.
- Every task commit has a normal author only and no agent co-author trailer.

## Explicit Non-Goals

- Do not keep a long-lived OMP RPC process.
The short-lived JSON process already satisfies Archon's per-turn provider contract and delegates durable context to OMP sessions.
- Do not add OMP's SDK as a dependency.
The CLI was explicitly requested and is the stable process boundary.
- Do not bundle or auto-download the OMP executable.
Use OMP's supported installers and an explicit binary override.
- Do not import OMP credentials into Archon's per-user credential database.
OMP currently owns more than 60 backend and OAuth flows, and duplicating them would create two sources of truth.
- Do not claim MCP, hooks, inline agents, denied tools, sandboxing, native tools, or container execution.
Add each only when Archon's exact request field has a tested OMP translation.
- Do not add OMP to the current three-provider interactive setup wizard in this change.
Other registered community providers already rely on YAML, CLI preference commands, or the registry-backed web surfaces.

## Rollback

Rollback is code-only and does not require a database migration or data cleanup.
Revert the OMP feature and documentation commits, remove the `omp` registration call and exports, rerun `bun run generate:capability-matrix`, and leave OMP's own session/auth files untouched because Archon never owns them.
