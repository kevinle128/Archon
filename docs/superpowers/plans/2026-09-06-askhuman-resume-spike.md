# Prove Claude and Pi Resume After AskHuman Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce executable evidence for Claude and Pi durable AskHuman resume, then confirm or amend AD-6 before Story 6.3 may implement continue.

**Architecture:** Story 6.1 is a protocol spike and must not add production resume plumbing.
The Claude half uses a manually invoked live harness against the custom in-process `mcp__archon__AskHuman` tool on SDK `0.3.209` and comparison version `0.3.261`.
The Pi half uses the real `SessionManager`, `AgentSession`, and `Agent.continue()` with only the external model transport replaced by Pi's deterministic faux provider.

**Tech Stack:** Bun, strict TypeScript, Bun Test, `@anthropic-ai/claude-agent-sdk`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, Zod 4, JSON evidence, and Markdown architecture records.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.1.

## Global Constraints

- Read `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/reviews/review-version-reality.md` before changing files.
- Preserve the AD-6 Archon boundary unless the evidence requires an amendment: the executor supplies ordered `resumeInteractions`, providers inject answers, and workflows do not encode answers in prompt prose.
- Keep custom `AskHuman` as the only ask channel and do not wrap or expose Claude's built-in `AskUserQuestion`.
- Do not infer an ask from assistant prose.
- Do not implement `AskHuman`, `AskHumanAwaitingError`, `resumeInteractions`, pending-interaction storage, API routes, SSE events, node state, or UI in this story.
- Do not change `NativeTool`, `SendQueryOptions`, `ProviderCapabilities`, `packages/workflows/`, `packages/core/`, `packages/server/`, `packages/web/`, or either production provider's `sendQuery` method.
- Do not add resume mappers, protocol constants, or another exported production surface without a current production caller.
- Treat PreToolUse `defer` as a valid candidate for the custom `mcp__archon__AskHuman` tool because AD-9 rejects the built-in `AskUserQuestion`, not the SDK hook mechanism.
- Run the Claude live harness manually and never from CI or the ordinary provider test script.
- Use ambient Claude authentication for the live harness and never write credentials to output files.
- Emit only version, model, session identifiers, stop reasons, counts, booleans, and redacted failure categories in Claude evidence.
- Do not emit question text, answer payloads, model transcript text, environment values, or tokens in evidence.
- Keep Claude `0.3.209` exact in both manifests while the spike is unresolved.
- Do not upgrade Claude automatically after an inconclusive run.
- Keep the Pi packages on lockfile `0.80.6`.
- Do not call a vendor API in the Pi test or in CI.
- Do not use `any`.
- Import SDK types from their owning SDK packages rather than copying them into production code.
- Add every new provider test file as its own `bun test <file>` process in `packages/providers/package.json` because Bun `mock.module()` state is process-global.
- Run focused provider tests from `packages/providers` in a subshell.
- Do not run an unscoped `bun test` from the repository root.
- Run `bun run validate` before completion.
- Keep each full Markdown sentence on its own physical line in this plan and in the outcome document.
- Story 6.3 remains blocked unless both provider conclusions are written and supported by recorded evidence.

---

## Approved Inputs and Repository Facts

- GitHub issue `anhle128/Archon#86` requires focused tests or characterization evidence, a written Story 6.1 outcome, and the feature sprint-status key marked done only after the acceptance criteria pass.
- Story 6.1 explicitly asks whether Claude `0.3.209` requires host abort or `tool_deferred` with PreToolUse `defer`.
- `review-version-reality.md` additionally requires the same Claude experiment on `0.3.261` and forbids treating the existence of SDK types as runtime proof.
- Claude SDK `0.3.209` types already include `requires_action`, PreToolUse `defer`, `tool_deferred`, `deferred_tool_use`, and `tool_deferred_unavailable`.
- Official SDK behavior described in the approved architecture review is that `defer` stops before tool execution and resuming the same session reissues the same tool call so a hook can return `allow` with `updatedInput`.
- AD-9 says not to wrap `AskUserQuestion`; it does not prohibit applying PreToolUse to the custom MCP tool.
- `packages/providers/src/claude/native-tools.ts` names the server `archon`, so the custom tool's fully qualified name is `mcp__archon__AskHuman`.
- `packages/providers/src/claude/provider.ts` resumes Claude with `options.resume = resumeSessionId`.
- `packages/providers/src/community/pi/event-bridge.ts` disposes every `AgentSession` in `finally`.
- `packages/providers/src/community/pi/session-resolver.ts` reopens persisted sessions with `SessionManager.open(path)`.
- Pi `0.80.6` exposes `continue()` on `session.agent`, not on `AgentSession`.
- `SessionManager.appendMessage()` is the durable way to append the matching `ToolResultMessage` before constructing the reopened `AgentSession`.
- `createAgentSession()` restores persisted messages into `session.agent.state.messages`, which makes the appended tool result the tail consumed by `session.agent.continue()`.
- `packages/providers/tsconfig.json` excludes test files, so a type-only assignment inside a Bun test is not a TypeScript compile gate.
- `_bmad-output/specs/spec-workflow-run-view-hitl/architecture-diagrams.md` currently contains unsubstantiated `VERIFIED` claims and must be reconciled with the actual spike result.
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/reviews/review-version-reality.md` is an input review and remains unchanged as a historical record.

## File Map

- Modify `package.json` to pin `@anthropic-ai/claude-agent-sdk` exactly to `0.3.209`.
- Modify `packages/providers/package.json` to apply the same exact Claude pin, add the manual Claude spike script, and add isolated invocations for the two new tests.
- Modify `bun.lock` so its workspace dependency specifications match both manifests.
- Create `packages/providers/src/claude/askhuman-resume-spike.ts` as a self-contained live Claude harness plus deterministic evidence classifier.
- Create `packages/providers/src/claude/askhuman-resume-spike.test.ts` for the classifier's fail-closed decision rules.
- Create `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts` for the real durable dispose, reopen, append, recreate, and continue round trip.
- Create `_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json` from the pinned Claude run.
- Create `_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json` from the isolated comparison run.
- Create `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md` as the written evidence and amend-or-confirm decision.
- Modify `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` only where AD-6, the Claude pin, or deferred-spike rows must reflect the result.
- Modify `_bmad-output/specs/spec-workflow-run-view-hitl/architecture-diagrams.md` to remove stale verification claims and show only the protocol actually proved.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` after applying the completion gate.

## Evidence and Decision Contract

The Claude harness must run one host-abort experiment and one PreToolUse-defer experiment for each of the `sonnet` and `opus` model aliases.
Each experiment must use the custom in-process MCP tool named `mcp__archon__AskHuman` and must instruct the model to make exactly one tool call.
The harness must observe `session_state_changed` events and record whether `requires_action` occurs, but that observation alone never selects a resume protocol.

Classify one model as `tool-deferred-reissue` only when all of these facts are true:

- The first PreToolUse hook sees `mcp__archon__AskHuman` and returns `defer`.
- The first query ends with `stop_reason` or `terminal_reason` equal to `tool_deferred`.
- The first result contains `deferred_tool_use` for the same tool-use id.
- The MCP handler is not called before the pause.
- Resuming the same session causes PreToolUse to fire again for the same tool-use id.
- The second hook returns `allow` with a redacted `updatedInput.archonResume` value.
- The MCP handler receives that updated value exactly once.
- The resumed query succeeds without `tool_deferred_unavailable`.

Classify one model as `host-abort-new-user-message` only when all of these facts are true and the defer classification is false:

- The MCP handler is called exactly once before the host aborts the first query.
- The first query yields a persisted session id.
- A second query resumes that exact session id with a new user message containing a generated answer marker.
- The resumed query completes and its final result contains the generated completion marker.
- The MCP handler sees no second AskHuman call after resume.

Classify a version as a protocol only when both required model aliases independently produce the same non-inconclusive classification.
Prefer `tool-deferred-reissue` when both mechanisms appear to work because it is the SDK's explicit pause contract and preserves the pending tool identity.
Classify split-model, missing-result, unavailable-tool, authentication, timeout, unexpected `requires_action`, and partial observations as `inconclusive`.

Use this version policy after both files exist:

- If `0.3.209` has one unanimous protocol, retain exact `0.3.209` and use `0.3.261` only as comparison evidence.
- If `0.3.209` is inconclusive, keep exact `0.3.209`, record any successful `0.3.261` result as comparison evidence, and leave Story 6.1 incomplete.
- Do not use a `0.3.261` success to override Story 6.1's required `0.3.209` proof or to make an automatic dependency upgrade.
- If either required model differs within a version, do not choose a protocol for that version.
- If `requires_action` fires for this custom MCP flow, record it and leave the Claude conclusion inconclusive because it is a third runtime mechanism outside the binary decision this story was approved to settle.

The Pi conclusion is confirmed only when the focused test proves all of these facts with real SDK objects:

- A persisted transcript ends in an assistant `AskHuman` tool call with a known id.
- The first `AgentSession` is disposed.
- `SessionManager.open()` reopens the session file.
- A `ToolResultMessage` with the same `toolCallId` is appended to the reopened manager.
- A new `AgentSession` restores that tool result as the tail of `session.agent.state.messages`.
- `session.agent.continue()` calls the faux model with that tool result as the last context message.
- The continuation assistant message is persisted and survives a second reopen.

## Completion Gate

Story 6.1 is complete only when one Claude protocol is proved on exact `0.3.209`, the Pi durable test passes, the two Claude evidence files are redacted and valid, the written outcome cites the evidence, AD-6 and the diagram agree with that outcome, and `bun run validate` passes.
If any part is incomplete, write an `INCONCLUSIVE` outcome, set the Story 6.1 sprint key to `in-progress`, leave Story 6.3 blocked, and do not claim the issue is complete.
Only a complete result may set `6-1-prove-claude-and-pi-can-resume-after-askhuman: done`.

---

### Task 1: Make the Claude Spike Version Reproducible

**Files:**

- Modify: `package.json` at the root `dependencies` entry for `@anthropic-ai/claude-agent-sdk`.
- Modify: `packages/providers/package.json` at the `dependencies` entry for `@anthropic-ai/claude-agent-sdk`.
- Modify: `bun.lock` at the root and `packages/providers` workspace dependency specifications.

**Interfaces:**

- Consumes: The repository lock currently resolves Claude SDK `0.3.209` while both manifests declare `^0.3.209`.
- Produces: Two matching exact manifest specifications and a frozen-installable lockfile.

- [ ] **Step 1: Run the exact-pin check and verify the current manifests fail it.**

Run from the repository root:

```bash
bun -e "const root = await Bun.file('package.json').json(); const providers = await Bun.file('packages/providers/package.json').json(); if (root.dependencies['@anthropic-ai/claude-agent-sdk'] !== '0.3.209' || providers.dependencies['@anthropic-ai/claude-agent-sdk'] !== '0.3.209') throw new Error('Claude SDK must be pinned exactly to 0.3.209 for the spike')"
```

Expected: FAIL with `Claude SDK must be pinned exactly to 0.3.209 for the spike` because both values currently contain a caret.

- [ ] **Step 2: Change both manifest values to exact `0.3.209`.**

Use this literal dependency value in both files:

```json
"@anthropic-ai/claude-agent-sdk": "0.3.209"
```

- [ ] **Step 3: Regenerate only the lockfile metadata and verify a frozen install.**

Run:

```bash
bun install --lockfile-only
bun install --frozen-lockfile
```

Expected: both commands exit zero, the installed Claude SDK remains `0.3.209`, and the lockfile's workspace specifications lose the caret without changing the resolved Claude package version.

- [ ] **Step 4: Re-run the exact-pin check.**

Run the command from Step 1 again.

Expected: PASS with exit code zero and no output.

- [ ] **Step 5: Review and commit the reproducibility change.**

Run:

```bash
git diff -- package.json packages/providers/package.json bun.lock
git diff --check
git add package.json packages/providers/package.json bun.lock
git commit -m "chore(providers): pin Claude SDK for AskHuman spike"
```

Expected: only the two workspace dependency specifications and corresponding lock metadata change.

---

### Task 2: Build the Fail-Closed Claude Evidence Classifier with TDD

**Files:**

- Create: `packages/providers/src/claude/askhuman-resume-spike.test.ts`.
- Create: `packages/providers/src/claude/askhuman-resume-spike.ts`.
- Modify: `packages/providers/package.json` in `scripts.test` and `scripts`.

**Interfaces:**

- Consumes: Literal observations collected by the live harness.
- Produces: `classifyClaudeModel(evidence: ClaudeModelEvidence): ClaudeProtocol` and `classifyClaudeVersion(evidence: readonly ClaudeModelEvidence[]): ClaudeProtocol`.

- [ ] **Step 1: Write classifier tests before classifier behavior.**

Create `packages/providers/src/claude/askhuman-resume-spike.test.ts` with literal fixtures that name the wrong decisions they catch:

```ts
import { describe, expect, test } from 'bun:test';
import {
  classifyClaudeModel,
  classifyClaudeVersion,
  type ClaudeModelEvidence,
} from './askhuman-resume-spike';

function fullyProvedEvidence(model: string): ClaudeModelEvidence {
  return {
    sdkVersion: '0.3.209',
    model,
    requiresActionSeen: false,
    failureCategory: null,
    hostAbort: {
      handlerCallsBeforePause: 1,
      handlerCallsAfterResume: 1,
      sessionIdCaptured: true,
      resumedSameSession: true,
      completionMarkerSeen: true,
    },
    deferred: {
      firstStopReason: 'tool_deferred',
      deferredToolUsePresent: true,
      handlerCallsBeforePause: 0,
      hookToolUseIds: ['toolu_ask_1', 'toolu_ask_1'],
      updatedInputReachedHandler: true,
      resumedHandlerCalls: 1,
      resumedSuccessfully: true,
      unavailable: false,
    },
  };
}

describe('Claude AskHuman spike evidence classification', () => {
  test('prefers a complete SDK defer round trip over a working host-abort workaround', () => {
    expect(classifyClaudeModel(fullyProvedEvidence('sonnet'))).toBe(
      'tool-deferred-reissue'
    );
  });

  test('selects host abort only when defer is unproved and the same session consumes the new answer message', () => {
    const evidence = fullyProvedEvidence('sonnet');
    evidence.deferred.firstStopReason = 'completed';
    evidence.deferred.deferredToolUsePresent = false;
    evidence.deferred.hookToolUseIds = ['toolu_ask_1'];
    evidence.deferred.updatedInputReachedHandler = false;
    evidence.deferred.resumedHandlerCalls = 0;
    evidence.deferred.resumedSuccessfully = false;

    expect(classifyClaudeModel(evidence)).toBe('host-abort-new-user-message');
  });

  test('fails closed when either required model lacks the same complete protocol', () => {
    const sonnet = fullyProvedEvidence('sonnet');
    const opus = fullyProvedEvidence('opus');
    opus.requiresActionSeen = true;

    expect(classifyClaudeVersion([sonnet, opus])).toBe('inconclusive');
  });

  test('fails closed when a run ended for an environment reason', () => {
    const evidence = fullyProvedEvidence('sonnet');
    evidence.failureCategory = 'timeout';

    expect(classifyClaudeModel(evidence)).toBe('inconclusive');
  });

  test('fails closed when the required model set is incomplete', () => {
    expect(classifyClaudeVersion([fullyProvedEvidence('sonnet')])).toBe('inconclusive');
  });
});
```

The first test catches choosing the historical workaround without recognizing a proved SDK pause.
The second test catches choosing host abort without proof that the answer is consumed on the same session and without a repeated Ask.
The last three tests catch publishing a protocol from third-mechanism, environment-limited, or partial evidence.

- [ ] **Step 2: Add only the compilation skeleton, then verify a behavioral RED.**

Create `packages/providers/src/claude/askhuman-resume-spike.ts` with these exact data contracts and fail-closed stubs:

```ts
export type ClaudeProtocol =
  | 'tool-deferred-reissue'
  | 'host-abort-new-user-message'
  | 'inconclusive';

export type ClaudeFailureCategory =
  | 'authentication'
  | 'model-unavailable'
  | 'timeout'
  | 'runtime-error';

export interface ClaudeModelEvidence {
  sdkVersion: string;
  model: string;
  requiresActionSeen: boolean;
  failureCategory: ClaudeFailureCategory | null;
  hostAbort: {
    handlerCallsBeforePause: number;
    handlerCallsAfterResume: number;
    sessionIdCaptured: boolean;
    resumedSameSession: boolean;
    completionMarkerSeen: boolean;
  };
  deferred: {
    firstStopReason: string | null;
    deferredToolUsePresent: boolean;
    handlerCallsBeforePause: number;
    hookToolUseIds: string[];
    updatedInputReachedHandler: boolean;
    resumedHandlerCalls: number;
    resumedSuccessfully: boolean;
    unavailable: boolean;
  };
}

export function classifyClaudeModel(_evidence: ClaudeModelEvidence): ClaudeProtocol {
  return 'inconclusive';
}

export function classifyClaudeVersion(
  _evidence: readonly ClaudeModelEvidence[]
): ClaudeProtocol {
  return 'inconclusive';
}
```

Run:

```bash
(cd packages/providers && bun test src/claude/askhuman-resume-spike.test.ts)
```

Expected: FAIL because the first assertion receives `inconclusive` instead of `tool-deferred-reissue`.

- [ ] **Step 3: Implement the minimum decision logic.**

Replace the two stubs with:

```ts
export function classifyClaudeModel(evidence: ClaudeModelEvidence): ClaudeProtocol {
  if (evidence.requiresActionSeen || evidence.failureCategory !== null) {
    return 'inconclusive';
  }

  const [firstHookId, secondHookId] = evidence.deferred.hookToolUseIds;
  const deferredProved =
    evidence.deferred.firstStopReason === 'tool_deferred' &&
    evidence.deferred.deferredToolUsePresent &&
    evidence.deferred.handlerCallsBeforePause === 0 &&
    evidence.deferred.hookToolUseIds.length === 2 &&
    firstHookId !== undefined &&
    firstHookId === secondHookId &&
    evidence.deferred.updatedInputReachedHandler &&
    evidence.deferred.resumedHandlerCalls === 1 &&
    evidence.deferred.resumedSuccessfully &&
    !evidence.deferred.unavailable;

  if (deferredProved) return 'tool-deferred-reissue';

  const hostAbortProved =
    evidence.hostAbort.handlerCallsBeforePause === 1 &&
    evidence.hostAbort.handlerCallsAfterResume === 1 &&
    evidence.hostAbort.sessionIdCaptured &&
    evidence.hostAbort.resumedSameSession &&
    evidence.hostAbort.completionMarkerSeen;

  return hostAbortProved ? 'host-abort-new-user-message' : 'inconclusive';
}

export function classifyClaudeVersion(
  evidence: readonly ClaudeModelEvidence[]
): ClaudeProtocol {
  if (evidence.length !== 2) return 'inconclusive';
  const models = new Set(evidence.map(item => item.model));
  if (!models.has('sonnet') || !models.has('opus')) return 'inconclusive';
  const protocols = new Set(evidence.map(classifyClaudeModel));
  if (protocols.size !== 1 || protocols.has('inconclusive')) return 'inconclusive';
  return protocols.values().next().value ?? 'inconclusive';
}
```

- [ ] **Step 4: Run the focused classifier test and verify GREEN.**

Run:

```bash
(cd packages/providers && bun test src/claude/askhuman-resume-spike.test.ts)
```

Expected: five tests pass with no warnings.

- [ ] **Step 5: Extend the same file into a self-contained live harness.**

Import `createSdkMcpServer`, `query`, `tool`, and SDK message and option types directly from `@anthropic-ai/claude-agent-sdk`.
Import `z` from `zod` because this committed diagnostic is inside the providers package and is not an OpenAPI schema.
Use only Node built-ins plus those two declared provider dependencies so the file can be copied unchanged into a temporary `0.3.261` package.

Use this MCP schema in both experiments:

```ts
const askHumanInputShape = {
  questions: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      selection: z.enum(['single', 'multi']),
      options: z.array(z.string()),
      allowOther: z.boolean(),
    })
  ),
  archonResume: z
    .object({
      payload: z.string(),
      declined: z.boolean(),
    })
    .optional(),
};

const qualifiedToolName = 'mcp__archon__AskHuman';
```

The `archonResume` field is test-only updated input that proves the hook can convey an answer to the reissued custom tool.
It is not a production schema decision for Story 6.2 or Story 6.3.
Build every experiment server with `createSdkMcpServer({ name: 'archon', version: '1.0.0', tools: [askTool], alwaysLoad: true })`.
Build `askTool` with the SDK's `tool()` helper, the `askHumanInputShape`, and `{ alwaysLoad: true }`.
Return MCP text results as `{ content: [{ type: 'text', text: 'redacted spike result' }] }`, matching the production wrapper's boundary.

Use this helper before merging the hook's unknown input into `updatedInput`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

Use these exact live function boundaries so collection, classification, and serialization remain separate:

```ts
interface CollectedClaudeQuery {
  sessionId: string | null;
  stopReason: string | null;
  terminalReason: string | null;
  deferredToolUseId: string | null;
  deferredToolUseName: string | null;
  requiresActionSeen: boolean;
  completed: boolean;
  completionMarkerSeen: boolean;
}

async function collectClaudeQuery(
  prompt: string,
  options: import('@anthropic-ai/claude-agent-sdk').Options,
  completionMarker: string
): Promise<CollectedClaudeQuery>;

async function runHostAbortExperiment(
  model: string,
  sdkVersion: string
): Promise<ClaudeModelEvidence['hostAbort'] & { requiresActionSeen: boolean }>;

async function runDeferredExperiment(
  model: string,
  sdkVersion: string
): Promise<ClaudeModelEvidence['deferred'] & { requiresActionSeen: boolean }>;

async function runClaudeVersionSpike(
  sdkVersion: string,
  models: readonly string[]
): Promise<{
  schemaVersion: 1;
  sdkVersion: string;
  models: ClaudeModelEvidence[];
  protocol: ClaudeProtocol;
}>;
```

`collectClaudeQuery()` must consume the entire async iterator.
It must capture `session_id` from SDK messages, capture both `stop_reason` and `terminal_reason` from result messages, capture `deferred_tool_use.id` and `.name`, observe `session_state_changed` with state `requires_action`, and inspect the final result only for a generated completion marker.
It must not retain or serialize raw messages.
The deferred experiment must set `firstStopReason` from `stop_reason ?? terminal_reason`.
It must set `deferredToolUsePresent` to true only when `deferred_tool_use.id` equals the first PreToolUse id and `deferred_tool_use.name` equals `mcp__archon__AskHuman`.
The deferred experiment must set `unavailable` when either result field is `tool_deferred_unavailable` without treating that expected protocol failure as an environment error.

For the host-abort experiment, create a fresh `AbortController` and a fresh SDK MCP server named `archon` for the first query.
The first tool handler increments a counter, aborts that controller, and returns a short redacted MCP text result.
The first prompt must direct the selected model to call `AskHuman` exactly once with one literal question and to emit the generated completion marker only after it later receives the generated answer marker.
After collecting the first query, create a second MCP server with the same name and schema, resume with `options.resume` equal to the captured session id, and send one new user message containing the answer marker.
The second handler increments the same counter so a reissued Ask makes `handlerCallsAfterResume` greater than one and invalidates this mechanism.

For the defer experiment, install one PreToolUse matcher whose matcher is exactly `mcp__archon__AskHuman`.
On the first hook call, record the tool-use id and return this exact hook output:

```ts
{
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'defer',
    permissionDecisionReason: 'Archon AskHuman spike pause',
  },
}
```

The first MCP handler must count calls but must not run when defer works.
Resume the captured session with the same MCP server name and the same hook matcher.
Construct a fresh SDK MCP server instance for the resumed query so the result proves that a disposed process does not depend on the original in-memory server object.
On the second hook call for the same id, return `allow` and preserve the original input while adding the redacted answer:

```ts
{
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: {
      ...originalInput,
      archonResume: { payload: 'east', declined: false },
    },
  },
}
```

Narrow `input` using `input.hook_event_name === 'PreToolUse'` before reading `tool_input` or `tool_use_id`.
Set `const originalInput = isRecord(input.tool_input) ? input.tool_input : {}` before spreading it into `updatedInput`.
The resumed MCP handler must set `updatedInputReachedHandler` only when it receives `{ payload: 'east', declined: false }` and then return a redacted success result.
Use a neutral resume prompt such as `Continue the pending tool call.` and classify success from the reissued id, updated input, handler call, and result fields rather than from prose.

Both experiments must use these base options:

```ts
{
  cwd: process.cwd(),
  model,
  tools: [qualifiedToolName],
  allowedTools: [qualifiedToolName],
  mcpServers: { archon: server },
  settingSources: [],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  maxTurns: 3,
  maxBudgetUsd: 1,
}
```

Read `CLAUDE_SPIKE_MODELS` as a comma-separated structured setting and default it to `sonnet,opus`.
Resolve the installed SDK entry with `Bun.resolveSync()`, read the adjacent package manifest, and fail closed when its version differs from `EXPECTED_CLAUDE_SDK_VERSION`.
Wrap each model experiment in a bounded timeout of 120 seconds and serialize timeout, authentication, model-unavailable, and unexpected runtime failures only as the corresponding `ClaudeFailureCategory` value.
Merge the two experiments' `requiresActionSeen` values with logical OR on the model evidence.
Set `failureCategory` to `null` when both candidate experiments ran to an ordinary observed result, including the expected host abort and an observed `tool_deferred_unavailable` result.
Print exactly one JSON document to stdout.
Set `process.exitCode = 1` when the version protocol is `inconclusive` so shell automation cannot mistake partial evidence for proof.
Guard execution with `if (import.meta.main)` so the classifier test performs no live call.

- [ ] **Step 6: Register the isolated test and manual script.**

Append this isolated invocation to `packages/providers/package.json` `scripts.test`:

```text
&& bun test src/claude/askhuman-resume-spike.test.ts
```

Add this sibling script entry:

```json
"spike:askhuman:claude": "bun src/claude/askhuman-resume-spike.ts"
```

Do not add the live script to `test`, `validate`, or CI.

- [ ] **Step 7: Type-check and test the completed harness without making a live call.**

Run:

```bash
(cd packages/providers && bun test src/claude/askhuman-resume-spike.test.ts)
(cd packages/providers && bun run type-check)
```

Expected: the classifier tests pass and strict TypeScript accepts the live harness.

- [ ] **Step 8: Perform the mutation check and commit.**

Temporarily change the classifier to prefer host abort before defer and verify the first test fails.
Restore the implementation, rerun the focused test, and commit only the restored green state.

Run:

```bash
git add packages/providers/package.json packages/providers/src/claude/askhuman-resume-spike.ts packages/providers/src/claude/askhuman-resume-spike.test.ts
git commit -m "test(providers): add Claude AskHuman resume spike"
```

---

### Task 3: Characterize Pi Durable Reopen and Continue

**Files:**

- Create: `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts`.
- Modify: `packages/providers/package.json` in `scripts.test`.

**Interfaces:**

- Consumes: Real Pi `SessionManager`, `createAgentSession()`, `session.dispose()`, `session.agent.continue()`, and `ToolResultMessage` at lockfile `0.80.6`.
- Produces: A focused executable proof of the durable reopen recipe with no Archon production API.

This task characterizes an existing upstream boundary and adds no production code.
Its first execution is evidence collection rather than a contrived TDD red phase.
The faux provider replaces only the network model transport; all lifecycle and persistence objects under test remain real.

- [ ] **Step 1: Write the focused characterization test.**

Create `packages/providers/src/community/pi/askhuman-resume.characterization.test.ts` with this complete real-lifecycle test:

```ts
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentSession,
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  type Context,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type ToolResultMessage,
} from '@earendil-works/pi-ai';
import {
  registerFauxProvider,
  resetApiProviders,
} from '@earendil-works/pi-ai/compat';

describe('Pi AskHuman durable resume characterization', () => {
  test('continues after dispose and reopen when the matching tool result is persisted', async (): Promise<void> => {
    const spikeRoot = mkdtempSync(join(tmpdir(), 'archon-pi-ask-resume-'));
    const cwd = join(spikeRoot, 'cwd');
    const agentDir = join(spikeRoot, 'agent');
    const sessionDir = join(spikeRoot, 'sessions');
    mkdirSync(cwd);
    mkdirSync(agentDir);
    mkdirSync(sessionDir);

    const faux = registerFauxProvider({
      api: 'archon-askhuman-spike',
      provider: 'archon-askhuman-spike',
      models: [{ id: 'resume-model' }],
      tokensPerSecond: 10_000,
    });
    const model = faux.getModel();
    let first: AgentSession | undefined;
    let second: AgentSession | undefined;

    const createSession = async (sessionManager: SessionManager): Promise<AgentSession> => {
      const authStorage = AuthStorage.inMemory({
        'archon-askhuman-spike': { type: 'api_key', key: 'test-key' },
      });
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const result = await createAgentSession({
        cwd,
        agentDir,
        model,
        authStorage,
        modelRegistry,
        settingsManager: SettingsManager.inMemory(),
        sessionManager,
        noTools: 'all',
      });
      return result.session;
    };

    try {
      const toolUseId = 'askhuman-tool-use-1';
      const pendingToolCall = fauxAssistantMessage(
        [
          fauxToolCall(
            'AskHuman',
            {
              questions: [
                {
                  id: 'direction',
                  prompt: 'Choose a direction.',
                  selection: 'single',
                  options: ['east', 'west'],
                  allowOther: false,
                },
              ],
            },
            { id: toolUseId }
          ),
        ],
        { stopReason: 'toolUse', timestamp: 2 }
      );
      const answer: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: toolUseId,
        toolName: 'AskHuman',
        content: [{ type: 'text', text: 'east' }],
        isError: false,
        timestamp: 3,
      };
      const continuedMessage = fauxAssistantMessage(fauxText('continued after AskHuman'), {
        stopReason: 'stop',
        timestamp: 4,
      });
      let capturedContext: Context | undefined;
      faux.setResponses([
        (context): typeof continuedMessage => {
          capturedContext = context;
          return continuedMessage;
        },
      ]);

      first = await createSession(SessionManager.create(cwd, sessionDir));
      first.sessionManager.appendMessage({
        role: 'user',
        content: 'Ask for a direction.',
        timestamp: 1,
      });
      first.sessionManager.appendMessage(pendingToolCall);
      const sessionFile = first.sessionFile;
      expect(typeof sessionFile).toBe('string');
      if (sessionFile === undefined) throw new Error('Pi did not persist the spike session');
      first.dispose();
      first = undefined;

      const reopened = SessionManager.open(sessionFile);
      reopened.appendMessage(answer);
      second = await createSession(reopened);
      expect(second.agent.state.messages.at(-1)).toEqual(answer);

      await second.agent.continue();

      expect(faux.state.callCount).toBe(1);
      expect(capturedContext?.messages.at(-1)).toMatchObject({
        role: 'toolResult',
        toolCallId: toolUseId,
      });
      expect(second.agent.state.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'continued after AskHuman' }],
        api: 'archon-askhuman-spike',
        provider: 'archon-askhuman-spike',
        model: 'resume-model',
        stopReason: 'stop',
      });
      second.dispose();
      second = undefined;

      const reopenedAgain = SessionManager.open(sessionFile);
      const persistedTail = reopenedAgain.buildSessionContext().messages.slice(-2);
      expect(persistedTail[0]).toEqual(answer);
      expect(persistedTail[1]).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'continued after AskHuman' }],
        provider: 'archon-askhuman-spike',
        model: 'resume-model',
      });
    } finally {
      first?.dispose();
      second?.dispose();
      faux.unregister();
      resetApiProviders();
      const expectedPrefix = join(tmpdir(), 'archon-pi-ask-resume-');
      if (!spikeRoot.startsWith(expectedPrefix)) {
        throw new Error(`Refusing to remove unexpected spike directory: ${spikeRoot}`);
      }
      rmSync(spikeRoot, { recursive: true, force: true });
    }
  });
});
```

The complete test asserts the real context handed to the faux transport and the real JSONL transcript after the second reopen.
Do not read `event-bridge.ts` as text and do not assert the absence of `AgentSession.continue()`.

- [ ] **Step 2: Run the characterization and interpret the result without patching production.**

Run:

```bash
(cd packages/providers && bun test src/community/pi/askhuman-resume.characterization.test.ts)
```

Expected when AD-6's Pi premise is valid: one test passes, the faux provider receives the persisted tool result as the continuation tail, and no network request occurs.
If it fails because the real SDK requires a different order, revise only the test setup to the smallest real `0.80.6` order that succeeds and record that exact recipe in the outcome.
If no durable order succeeds, leave the test as a focused failing reproduction, classify Pi as inconclusive, and do not alter production code in this story.

- [ ] **Step 3: Register the test in its own process and run the provider type check.**

Append this invocation to `packages/providers/package.json` `scripts.test`:

```text
&& bun test src/community/pi/askhuman-resume.characterization.test.ts
```

Run:

```bash
(cd packages/providers && bun test src/community/pi/askhuman-resume.characterization.test.ts)
(cd packages/providers && bun run type-check)
```

Expected for a confirmable Pi result: both commands exit zero.

- [ ] **Step 4: Perform the mutation check and commit.**

Temporarily change the persisted answer's `toolCallId` to a different literal and verify that the focused assertion fails.
Restore the matching id, rerun the focused test, and commit only the restored state.

Run:

```bash
git add packages/providers/package.json packages/providers/src/community/pi/askhuman-resume.characterization.test.ts
git commit -m "test(providers): prove Pi AskHuman durable continue"
```

---

### Task 4: Run and Record Both Claude SDK Experiments

**Files:**

- Create: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json`.
- Create: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json`.

**Interfaces:**

- Consumes: `runClaudeVersionSpike()` and ambient Claude authentication.
- Produces: Two redacted JSON documents whose `protocol` fields drive the architecture decision.

- [ ] **Step 1: Create the evidence directory and run the exact `0.3.209` install.**

Run from the repository root:

```bash
mkdir -p _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence
(cd packages/providers && CLAUDE_SPIKE_MODELS=sonnet,opus EXPECTED_CLAUDE_SDK_VERSION=0.3.209 bun run spike:askhuman:claude) > _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json
```

Expected for a conclusive result: exit zero and the JSON top-level `protocol` is either `tool-deferred-reissue` or `host-abort-new-user-message`.
If authentication, account model access, timeout, or a third mechanism prevents proof, preserve a redacted JSON document with `protocol: "inconclusive"` and follow the incomplete completion branch.

- [ ] **Step 2: Validate the pinned evidence shape and secrecy.**

Run:

```bash
jq -e '.schemaVersion == 1 and .sdkVersion == "0.3.209" and ((.models | map(.model) | sort) == ["opus", "sonnet"]) and (.protocol == "tool-deferred-reissue" or .protocol == "host-abort-new-user-message" or .protocol == "inconclusive")' _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json
if rg -n 'ANTHROPIC|token|api[_-]?key|Choose a direction|"east"|"west"' _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json; then exit 1; fi
```

Expected: `jq` exits zero and `rg` prints nothing.

- [ ] **Step 3: Run the same self-contained file in an isolated `0.3.261` package.**

Run:

```bash
repo_root="$(pwd)"
spike_dir="$(mktemp -d)"
test -n "$spike_dir" && test "$spike_dir" != "/"
cp packages/providers/src/claude/askhuman-resume-spike.ts "$spike_dir/askhuman-resume-spike.ts"
(
  cd "$spike_dir"
  bun init -y >/dev/null
  bun add --exact @anthropic-ai/claude-agent-sdk@0.3.261 zod@4.4.3 >/dev/null
  CLAUDE_SPIKE_MODELS=sonnet,opus EXPECTED_CLAUDE_SDK_VERSION=0.3.261 bun run askhuman-resume-spike.ts
) > "$repo_root/_bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json"
test -n "$spike_dir" && test "$spike_dir" != "/" && rm -rf -- "$spike_dir"
```

Expected for a conclusive comparison: exit zero and the JSON top-level `sdkVersion` is `0.3.261`.
If the live command exits nonzero after writing a redacted inconclusive document, retain that document and continue only through the incomplete branch.

- [ ] **Step 4: Validate the comparison evidence shape and secrecy.**

Run:

```bash
jq -e '.schemaVersion == 1 and .sdkVersion == "0.3.261" and ((.models | map(.model) | sort) == ["opus", "sonnet"]) and (.protocol == "tool-deferred-reissue" or .protocol == "host-abort-new-user-message" or .protocol == "inconclusive")' _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json
if rg -n 'ANTHROPIC|token|api[_-]?key|Choose a direction|"east"|"west"' _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json; then exit 1; fi
```

Expected: `jq` exits zero and `rg` prints nothing.

- [ ] **Step 5: Confirm the deterministic version decision.**

Read both top-level protocols with:

```bash
jq -r '[.sdkVersion, .protocol] | @tsv' _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json
```

Keep exact `0.3.209` when its evidence is conclusive.
Keep exact `0.3.209` and classify Claude as inconclusive when its evidence is inconclusive, even if the comparison version succeeds.
Record a differing `0.3.261` result as future architecture evidence without changing dependencies in this story.

- [ ] **Step 6: Commit the redacted evidence.**

Run:

```bash
git diff --check
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.261.json
git commit -m "docs(hitl): record Claude AskHuman resume evidence"
```

---

### Task 5: Write the Outcome and Reconcile the Architecture

**Files:**

- Create: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`.
- Modify: `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` at AD-6, the Claude convention row, the stack row, and the two deferred-spike rows.
- Modify: `_bmad-output/specs/spec-workflow-run-view-hitl/architecture-diagrams.md` in the HITL lifecycle and provider production-path diagrams.
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` at `last_updated`, `epic-6`, and the Story 6.1 key.

**Interfaces:**

- Consumes: The two Claude JSON documents and the actual Pi focused-test result.
- Produces: One unambiguous protocol record with no silent alternative and a sprint state that reflects the gate truthfully.

- [ ] **Step 1: Write the evidence document from observed facts.**

Use this exact section order in `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`:

```markdown
# Story 6.1 outcome — Claude and Pi resume after AskHuman

## Scope

## Evidence

### Claude SDK 0.3.209

### Claude SDK 0.3.261 comparison

### Pi 0.80.6 durable reopen

## AD-6 decision

## AskUserQuestion decision

## Version decision

## Story gate
```

Under each Claude heading, cite the corresponding repository-relative JSON path and list the model classifications, repeated tool-use-id fact, handler counts, stop reason, `requires_action` observation, and top-level classification.
Do not copy raw prompts, answers, transcript text, credentials, or environment data into the Markdown.
Under Pi, record the focused test command and whether the persisted order was `assistant tool call -> matching tool result -> continuation assistant message` after two reopens.

Use exactly one of these AD-6 decision statements and delete the other two:

- `AMEND: Claude uses PreToolUse defer on the custom mcp__archon__AskHuman tool, ends with tool_deferred, resumes the same provider session, reissues the same tool-use id, and allows it with provider-supplied updatedInput; no answer is inserted by workflows.`
- `CONFIRM: Claude host-aborts after the custom mcp__archon__AskHuman callback persists the Ask, resumes the same provider session with one provider-owned user message, and does not reissue AskHuman; no answer is inserted by workflows.`
- `INCONCLUSIVE: Claude did not produce one complete protocol on both required model aliases, so AD-6 remains provisional and Story 6.3 continue stays blocked.`

If Pi passes, include this exact durable recipe:

`CONFIRM: Pi opens the persisted SessionManager, appends each matching ToolResultMessage through SessionManager.appendMessage before createAgentSession, constructs the new AgentSession from that manager, verifies the tool result is the agent transcript tail, and calls session.agent.continue(); AgentSession.continue() is not an API.`

If Pi fails, include this exact statement instead:

`INCONCLUSIVE: Pi 0.80.6 did not complete the dispose, SessionManager.open, matching ToolResultMessage append, createAgentSession, session.agent.continue, and second-reopen round trip, so Story 6.3 continue stays blocked.`

The AskUserQuestion section must always say that Archon rejects the built-in tool as a product channel while allowing the selected hook mechanism to operate on the custom MCP tool.
The version section must name exact `0.3.209` as the manifest version and explain the `0.3.261` comparison without calling a caret range pinned.
The story gate must say either `COMPLETE` only when every Completion Gate condition is true or `INCONCLUSIVE` with Story 6.3 explicitly blocked.

- [ ] **Step 2: Amend or confirm AD-6 without preserving two legal Claude protocols.**

If defer is selected, replace AD-6's provisional Claude sentence with one protocol that names custom-MCP PreToolUse `defer`, `tool_deferred`, same-session resume, same-id reissue, and provider-owned `allow` plus `updatedInput`.
If host abort is selected, replace the provisional sentence with one protocol that names host abort, same-session `options.resume`, one provider-owned user message, and no AskHuman reissue.
If Claude is inconclusive, leave the provisional mechanism explicitly marked unconfirmed and add that Story 6.3 continue remains blocked.

If Pi passes, replace the Pi provisional clause with the exact durable order proved by the test: `SessionManager.open`, `appendMessage(ToolResultMessage)`, `createAgentSession`, then `session.agent.continue()`.
If Pi fails, retain it as a deferred spike and keep Story 6.3 blocked.

Update the Claude consistency and stack rows to exact `0.3.209` and state that the Story 6.1 comparison does not authorize a floating range.
Update the Claude and Pi deferred rows to `resolved by Story 6.1` only for conclusions supported by evidence.
Do not edit the historical `review-version-reality.md` file.

- [ ] **Step 3: Reconcile the diagrams with the same evidence.**

Replace the HITL lifecycle's hard-coded Claude `new user message` label with the selected single protocol, or with `unresolved — Story 6.3 blocked` when inconclusive.
Replace the Claude provider box's pre-existing `VERIFIED Sonnet+Opus` claim with the exact Story 6.1 conclusion and selected SDK version.
Replace the Pi provider box's pre-existing `durable VERIFIED` claim with the exact durable order only when the focused Pi test passes.
Use `INCONCLUSIVE — Story 6.3 blocked` in either provider box whose gate failed.
Do not claim that `hitl-contract.md` contains mechanism evidence because it defines payloads rather than SDK behavior.

- [ ] **Step 4: Apply the sprint-status gate.**

When every Completion Gate condition is true, set:

```yaml
  epic-6: in-progress
  6-1-prove-claude-and-pi-can-resume-after-askhuman: done
```

When any condition is false, set:

```yaml
  epic-6: in-progress
  6-1-prove-claude-and-pi-can-resume-after-askhuman: in-progress
```

Update `last_updated` to the actual completion time in the file's existing quoted format.
Do not mark Story 6.1 done merely because files or type checks exist.

- [ ] **Step 5: Cross-check the three records and commit.**

Read the AD-6 paragraph, both diagram labels, the outcome decision, and the sprint key together.
Verify they name one Claude mechanism, one Pi recipe, one exact Claude version, and the same completion state.

Run:

```bash
git diff --check
git diff -- _bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md _bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md _bmad-output/specs/spec-workflow-run-view-hitl/architecture-diagrams.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md _bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md _bmad-output/specs/spec-workflow-run-view-hitl/architecture-diagrams.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "docs(hitl): settle AskHuman resume protocol"
```

---

### Task 6: Run Focused and Repository Validation

**Files:**

- Verify all files in the File Map.
- Do not create or modify additional production files to make the spike appear complete.

**Interfaces:**

- Consumes: The completed evidence, tests, and documentation.
- Produces: A clean validation record and a truthful ready-or-blocked handoff for Story 6.3.

- [ ] **Step 1: Run both focused provider tests.**

Run:

```bash
(cd packages/providers && bun test src/claude/askhuman-resume-spike.test.ts)
(cd packages/providers && bun test src/community/pi/askhuman-resume.characterization.test.ts)
```

Expected for completion: both commands pass with no warnings.

- [ ] **Step 2: Run the complete provider package test script and type check.**

Run:

```bash
(cd packages/providers && bun run test)
(cd packages/providers && bun run type-check)
```

Expected for completion: all isolated provider test processes and strict TypeScript pass.

- [ ] **Step 3: Run the repository validation command.**

Run:

```bash
bun run validate
```

Expected for completion: every validation stage passes.
The Claude live harness is intentionally absent from this command.

- [ ] **Step 4: Verify evidence and scope.**

Run:

```bash
jq -e '.protocol != "inconclusive"' _bmad-output/implementation-artifacts/workflow-run-view-hitl/evidence/6-1-claude-0.3.209.json
git diff --check
git status --short
```

Expected for completion: the required `0.3.209` evidence is conclusive, whitespace checks pass, and status shows only files in the File Map.

- [ ] **Step 5: Audit every acceptance criterion before handoff.**

Confirm all of the following:

- Both manifests and `bun.lock` name exact Claude SDK `0.3.209`.
- The live harness exercises the custom in-process MCP tool on `sonnet` and `opus` for both candidate mechanisms.
- The live harness is not part of CI or ordinary tests.
- Both redacted Claude evidence files exist and pass their JSON and secrecy checks.
- The Pi test uses real persistence, real dispose/reopen, real `session.agent.continue()`, and only a faux model transport.
- No type-only or source-text assertion is presented as runtime proof.
- No resume mapper or uncalled production abstraction was added.
- AD-6 contains only one selected Claude protocol or explicitly remains provisional and blocked.
- AD-6 records the actual Pi order or explicitly remains provisional and blocked.
- The architecture diagrams no longer contain unsupported verification claims.
- The outcome, spine, diagrams, exact manifest pin, and sprint state agree.
- Story 6.3 remains blocked unless Story 6.1 is complete.
- `bun run validate` passes before a `done` status is retained.

- [ ] **Step 6: Commit any validation-only corrections.**

If validation required in-scope corrections, rerun every failed command and commit those corrections with:

```bash
git add package.json packages/providers/package.json bun.lock packages/providers/src/claude/askhuman-resume-spike.ts packages/providers/src/claude/askhuman-resume-spike.test.ts packages/providers/src/community/pi/askhuman-resume.characterization.test.ts _bmad-output/implementation-artifacts/workflow-run-view-hitl
git add _bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md _bmad-output/specs/spec-workflow-run-view-hitl/architecture-diagrams.md
git commit -m "test(hitl): validate AskHuman resume spike"
```

Do not create an empty commit when validation needed no correction.

## Acceptance Criteria

- Claude evidence records actual runtime behavior on exact `0.3.209` and isolated `0.3.261`; SDK declarations alone do not satisfy this criterion.
- Claude evidence tests host abort and PreToolUse `defer` against the custom `mcp__archon__AskHuman` tool rather than the built-in `AskUserQuestion`.
- A selected Claude protocol works on both required model aliases, or the outcome is explicitly inconclusive and blocks Story 6.3.
- Pi evidence proves a matching `ToolResultMessage` survives dispose/reopen and is consumed by `session.agent.continue()`, or the outcome is explicitly inconclusive and blocks Story 6.3.
- Claude package version `0.3.209` is exact and identical in root `package.json`, `packages/providers/package.json`, and `bun.lock`.
- The written outcome cites both Claude JSON files and the Pi focused test command.
- AD-6 is confirmed or amended to one protocol and is not silently forked.
- `AskUserQuestion` remains rejected as a product channel even if the custom tool uses the SDK's hook mechanism.
- The architecture diagram does not claim verification beyond the recorded evidence.
- No Story 6.2 or Story 6.3 production behavior is implemented in this spike.
- Focused tests, provider tests, provider type checking, and `bun run validate` pass before the sprint key is marked done.
- The sprint key remains `in-progress` and Story 6.3 remains blocked whenever either provider result is inconclusive.

## Open Questions

1. The actual Claude mechanism cannot be inferred from types or documentation alone and remains open until the live `0.3.209` evidence is unanimous across `sonnet` and `opus`.
The safe provisional default is to retain exact `0.3.209`, keep AD-6 marked unconfirmed, and block Story 6.3.
2. A future move from Claude SDK `0.3.209` to `0.3.261` remains open when the comparison exposes a different protocol or capability.
The safe provisional default for Story 6.1 is exact `0.3.209`; a successful comparison cannot substitute for inconclusive required-version evidence.
