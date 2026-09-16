# Version Reality-Check — ARCHITECTURE-SPINE.md

**Spine:** `architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`
**Reviewed:** 2026-09-05
**Lens:** Every committed Stack / AD technology claim was checked against (a) this repo's `package.json` + `bun.lock`, (b) live npm registry / SDK type files, and (c) current vendor docs. Claims that exist only as spike folklore are flagged.
**This spine does not lean on a starter.** It is brownfield Archon. There are no create-vite / shadcn init defaults to audit. Workspace versions are the live baseline.

**Sources checked (2026-09-05):**

- Workspace: `packages/providers/package.json`, `packages/web/package.json`, `packages/server/package.json`, root `package.json`, `bun.lock`
- Code: `packages/providers/src/claude/capabilities.ts`, `packages/providers/src/claude/native-tools.ts`, `packages/providers/src/community/pi/{provider,event-bridge,capabilities}.ts`, `packages/providers/src/types.ts`, `packages/workflows/src/{store,schemas/workflow-run}.ts`
- npm registry: `@anthropic-ai/claude-agent-sdk@latest` = **0.3.261**; `@earendil-works/pi-coding-agent@latest` = **0.85.1**
- Pinned SDK types: `https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.209/sdk.d.ts`
- Current SDK types: `https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.261/sdk.d.ts`
- Claude docs: `https://code.claude.com/docs/en/agent-sdk/typescript`, `https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later`
- Pi docs / types: `https://pi.dev/docs/latest/sdk`; `https://unpkg.com/@earendil-works/pi-agent-core@0.80.6/dist/agent.d.ts`; `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.6/dist/core/agent-session.d.ts`; `https://www.npmjs.com/package/@earendil-works/pi-agent-core`

---

## Verdict

**CONDITIONAL — Stack table matches the workspace. AD-6's SDK pause/resume protocol is not current-docs-true as written.**

Every version number in the Stack table is consistent with the installed workspace packages. No invented library names. No starter-default drift.

Two committed protocol decisions were **not** re-confirmed against live SDK docs before being ADOPTED:

1. **Claude `requires_action` "never fires at 0.3.209"** — the _string_ is still not the documented pause API, but `0.3.209` already types `requires_action` as a session state **and** already types the real pause (`tool_deferred` / PreToolUse `defer`). Current docs prescribe a resume that **re-issues the deferred tool**, which contradicts AD-6's "new user message, no tool re-issue."
2. **Pi `Agent.continue()` + `ToolResultMessage`** — `continue()` is real on `@earendil-works/pi-agent-core` `Agent` (citable at the workspace pin `0.80.6`). It is **not** a method on `pi-coding-agent`'s `AgentSession`, is **not** in the current Pi coding-agent SDK docs, and Archon today is `prompt()` → `dispose()` only. AD-6's Pi path is a composable guess, not a documented recipe.

Do not treat AD-6 as spike-closed. Re-spike Claude against `tool_deferred` (and decide whether to pin `0.3.209` or current `0.3.261`). Cite `session.agent.continue()` plus a written ToolResultMessage append recipe before implementation, or mark Pi continue as a spike.

---

## Stack Table — Row-by-Row Results

| Spine claim                                     | Source checked                                | Actual value                                                                              | Status                                                 |
| ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Bun `^1.3`                                      | root `package.json` → `engines.bun`           | `^1.3.0`                                                                                  | ✅ matches workspace                                   |
| TypeScript `^5.3`                               | root `devDependencies.typescript`             | `^5.3.0`                                                                                  | ✅ matches workspace                                   |
| Hono `^4.12.16`                                 | `packages/server/package.json`                | `^4.12.16`                                                                                | ✅ matches workspace                                   |
| `@hono/zod-openapi` `^1.4.0`                    | `packages/server/package.json`                | `^1.4.0`                                                                                  | ✅ matches workspace                                   |
| React `^19`                                     | `packages/web/package.json`                   | `^19.0.0`                                                                                 | ✅ matches workspace                                   |
| Vite `^6`                                       | `packages/web/devDependencies.vite`           | `^6.0.0`                                                                                  | ✅ matches workspace (see Finding 6)                   |
| Tailwind v4                                     | `packages/web/devDependencies.tailwindcss`    | `^4.0.0`                                                                                  | ✅ matches workspace                                   |
| Zustand `^5.0.12`                               | `packages/web/package.json`                   | `^5.0.12`                                                                                 | ✅ matches workspace; npm latest 5.0.15 (compatible)   |
| `@anthropic-ai/claude-agent-sdk` `^0.3.209`     | providers + root `package.json`; `bun.lock`   | range `^0.3.209`; **lock 0.3.209**; npm latest **0.3.261**                                | ⚠️ range matches; caret is a moving target (Finding 1) |
| `@earendil-works/pi-coding-agent` `^0.80.6`     | `packages/providers/package.json`; `bun.lock` | range `^0.80.6`; **lock 0.80.6**; npm latest **0.85.1**                                   | ✅ pin matches; `^0.80.6` stays on 0.80.x (Finding 2)  |
| SQLite `bun:sqlite` / PostgreSQL `pg` `^8.11.0` | `packages/server/package.json`                | `pg` `^8.11.0`; SQLite is Bun built-in                                                    | ✅ matches workspace                                   |
| No new frontend graph dependency                | `packages/web/package.json`; AD-4             | already has `@xyflow/react` / `@dagrejs/dagre`; AD-4 adds a local `lib/run-graph/` module | ✅ no new dep required                                 |

---

## SDK Protocol Claims (AD-5 / AD-6 / conventions)

### Finding 1 — Claude `requires_action` types exist at the spike pin; the documented pause is `tool_deferred` ⛔

**Spine claims:** Consistency table — "Guard spike behavior against `@anthropic-ai/claude-agent-sdk` `^0.3.209` (no `requires_action` trigger)." AD-6 — Claude ends the turn on ask; resume delivers the human payload as a **new user message** (no tool re-issue).

**Checked against 0.3.209 types** (`unpkg` `sdk.d.ts`, fetched 2026-09-05):

```ts
// SDKSessionStateChangedMessage
state: 'idle' | 'running' | 'requires_action';

export declare type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';

export declare type TerminalReason = /* … */ | 'tool_deferred' | /* … */ | 'tool_deferred_unavailable' | /* … */;

deferred_tool_use?: SDKDeferredToolUse; // { id, name, input }
```

The same unions are present in **0.3.261**. So:

- The claim "there is no `requires_action` _type_" is **false** at the spike pin.
- The claim "`requires_action` never _fires_" is a **runtime** assertion this review did not re-execute. Current TypeScript docs do **not** document `requires_action` as the HITL pause contract. They document PreToolUse `permissionDecision: "defer"` → result `stop_reason: "tool_deferred"` + `deferred_tool_use`, then resume the **same** `session_id`. Official round-trip (hooks docs, "Defer a tool call for later"):
  1. Tool call fires `PreToolUse`.
  2. Hook returns `defer`. Tool does not execute. Process exits `tool_deferred`.
  3. Host UI collects the answer.
  4. Resume with `--resume` / `resume: sessionId`.
  5. Same tool fires `PreToolUse` **again**; hook returns `allow` + `updatedInput` with the answer. **The tool is re-issued.**

**AD-6's "new user message, no tool re-issue" is the opposite of the current documented Claude pause.** `tool_deferred` was already in the 0.3.209 type file the spike supposedly locked. Either the spike never looked at `defer` / `tool_deferred`, or it observed that `session_state_changed` / `requires_action` did not fire for a custom MCP tool and over-generalized to "SDK has no pause."

**Caret hazard:** Stack lists `^0.3.209`. `bun.lock` pins **0.3.209**. npm latest is **0.3.261** (published 2026-09-05; bundled CLI `claudeCodeVersion` 2.1.261). A lockfile-less install lands on current docs behavior, not the spike. If the guard is real, pin `0.3.209` (no caret) or re-spike against 0.3.261 and rewrite AD-6.

**Known current-SDK caveats** (do not ignore if adopting `defer`): GitHub `anthropics/claude-agent-sdk-typescript#362` (defer race can hallucinate a wrap-up "tool failed" turn); Python sibling `#1060`; in-process MCP deferred tools have been reported to fail on resume if the tool registry is not ready.

**Implication for AD-5:** Aborting `sendQuery` from a `NativeTool.handler` throw (Claude MCP wrapper awaits `handler()` and wraps the string in `CallToolResult`) is a host-side abort, not the SDK pause. Current docs' HITL path is hook `defer`, not a branded throw from an in-process MCP tool.

---

### Finding 2 — Pi `continue()` is real on `pi-agent-core` Agent; AD-6's coding-agent recipe is unverified ⚠️

**Spine claims:** AD-6 — "Pi: new provider path — `Agent.continue()` + appended `ToolResultMessage` (today is prompt→dispose only)." Stack — `@earendil-works/pi-coding-agent` `^0.80.6` for that path.

**Workspace today (confirmed in code):**

- `PiProvider.sendQuery` → `createAgentSession` → `session.prompt(text)` → `bridgeSession` **always `session.dispose()`** in `finally` (`event-bridge.ts`).
- Grep of `packages/providers` found **zero** `continue(` calls.
- `PI_CAPABILITIES.nativeTools: true`; no `askHuman` flag yet (planned).

**What current / pinned SDKs actually export:**

| API                                                      | Where                                               | 0.80.6 (workspace pin)                                                                                             | Current docs (pi.dev SDK, 2026-09-05)                             |
| -------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `AgentSession.prompt` / `dispose` / `steer` / `followUp` | `@earendil-works/pi-coding-agent`                   | yes                                                                                                                | documented                                                        |
| `AgentSession.continue()`                                | coding-agent `agent-session.d.ts`                   | **absent** (no `continue(` in the 0.80.6 d.ts)                                                                     | **not listed** on `AgentSession`                                  |
| `session.agent: Agent`                                   | coding-agent                                        | `readonly agent: Agent`                                                                                            | documented                                                        |
| `Agent.continue()`                                       | `@earendil-works/pi-agent-core@0.80.6` `agent.d.ts` | **yes** — JSDoc: _"Continue from the current transcript. The last message must be a user or tool-result message."_ | documented on **pi-agent-core**, not on the coding-agent SDK page |
| `ToolResultMessage` (`role: "toolResult"`)               | pi-ai / coding-agent session-format + rpc.md        | yes                                                                                                                | yes                                                               |
| `session.agent.state.messages = messages`                | pi.dev SDK                                          | yes                                                                                                                | documented ("Replace messages")                                   |

**Citable path (composed, not documented as a recipe):** keep the `AgentSession` alive (do not `dispose()`), append a `ToolResultMessage` onto `session.agent.state.messages` so the tail is `toolResult`, then `await session.agent.continue()`. `continue()` **throws** `Cannot continue from message role: assistant` if you skip the append (issues `#5120`, `#5445`, `#5463`, `#5886` on 0.80.x).

**What is not cited:**

- No Pi coding-agent SDK page documents "append ToolResultMessage then continue()."
- Durable cross-process resume after Archon's current `dispose()` would need `SessionManager.open` + inject a tool-result into the persisted transcript + `session.agent.continue()`. That round-trip is **unverified**.
- Latest coding-agent is **0.85.1** (npm 2026-09-05). The workspace caret `^0.80.6` correctly stays on **0.80.x** (`^0.80.6` ⇒ `>=0.80.6 <0.81.0`). Implementation must not assume 0.85 APIs.

**Implication:** AD-6 may still be the right design, but it is **not** "spike-verified against current SDK docs." Treat it as a required provider spike: prove `session.agent.continue()` after a mid-tool abort at `0.80.6`, with a ToolResultMessage whose `toolCallId` matches the AskHuman invocation, including the dispose/reopen case AD-2 requires (durable teardown, no in-memory promise).

---

### Finding 3 — Unacknowledged Claude HITL surface: built-in `AskUserQuestion` + `defer` ⚠️

`CLAUDE_KNOWN_TOOL_NAMES` in `packages/providers/src/claude/capabilities.ts` already lists **`AskUserQuestion`**, hand-audited against 0.3.209. Current hooks docs use `AskUserQuestion` as **the** example for `defer` (collect answers in the host UI, resume, `allow` + `updatedInput`).

The spine invents a custom `AskHuman` NativeTool (`mcp__archon__AskHuman` — naming matches `ARCHON_TOOL_SERVER = 'archon'` in `native-tools.ts`, so the MCP prefix is workspace-true). That can still be the right product choice (Archon-owned schema, decline, CAS, starter-only). The version-reality gap is that AD-5/AD-6 never mention the SDK's existing ask/pause channel. Implementation will otherwise rediscover `AskUserQuestion` + `defer` as a competing contract.

---

### Finding 4 — All other named Archon technologies still exist and fit ✅

Checked in this repo, not asserted:

| Spine name                                                                 | Reality                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IWorkflowStore` / `WorkflowDeps` / `@archon/providers/types`              | exist; `NativeTool.handler: (input) => Promise<string>` matches AD-5 "leave handler as `Promise<string>`"                                                                                                                                                                         |
| `nodeStateSchema` / `workflowStepStatusSchema` / `workflowRunStatusSchema` | run status already has `paused`; node/step enums are `pending\|running\|completed\|failed\|skipped` — adding `awaiting` to node/step only is a real schema change, not a rename of a run status                                                                                   |
| `shouldContinueStreamingForStatus('paused') === true`                      | tested in `dag-executor.test.ts` — AD-2 sibling-streaming is code-true                                                                                                                                                                                                            |
| `WORKFLOW_EVENT_TYPES`                                                     | live list uses `approval_requested` / `approval_received`; emitter still has a `approval_pending` **event-object type**. AD-7 "do not reuse `approval_pending`" is the right split; implementers must add `node_awaiting` / `interaction_resolved` to the **array** in `store.ts` |
| `resolveAuthContext`                                                       | exists in `packages/server/src/routes/api.ts`                                                                                                                                                                                                                                     |
| Additive schema + trailing indexes                                         | matches AGENTS.md / `migrations/000_combined.sql` rules                                                                                                                                                                                                                           |
| Console isolation                                                          | `experiments/console` copies HTTP helpers instead of importing `@/lib/api`; AD-4's one sanctioned `lib/run-graph/` import is consistent with that rule                                                                                                                            |
| `mcp__archon__AskHuman`                                                    | prefix convention already used for native tools                                                                                                                                                                                                                                   |

---

### Finding 5 — Caret on Claude SDK vs exact spike pin ⚠️

The consistency row and the Stack row both write `^0.3.209`. Capabilities.ts comments "hand-audited against 0.3.209." `bun.lock` is exact `0.3.209`.

`^0.3.209` on a `0.3.x` package means **any 0.3 ≥ 0.209**, i.e. today's 0.3.261. The spike-guard sentence is therefore not enforceable as written. Either:

- change the Stack/convention to **exact** `0.3.209` until AD-6 is re-spiked, or
- re-spike on 0.3.261 and drop the "no requires_action" wording in favor of an explicit stance on `tool_deferred`.

Pi's `^0.80.6` does **not** have this problem (0.x caret stays in 0.80).

---

### Finding 6 — Workspace Vite 6 while current Vite is 8 (not a spine error) ℹ️

Spine correctly binds React/Vite/Tailwind/Zustand to **@archon/web**, not to latest-on-npm. Live npm Vite is **8.2.x** (changelog 8.2.2 dated 2026-08-20). Zustand workspace `^5.0.12` vs npm **5.0.15** is in-range. No new frontend dependency is proposed. Do not "upgrade the spine to Vite 8"; do not pretend Vite 6 is current-industry default either. Brownfield: use what Archon already runs.

---

## What was web-verified vs asserted

| Claim                                              | Verified how                                                            | Result                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Stack versions                                     | workspace package.json + bun.lock                                       | match                                                                                          |
| Claude package still exists                        | npm 0.3.261 2026-09-05                                                  | exists                                                                                         |
| "no requires_action pause"                         | 0.3.209 + 0.3.261 `sdk.d.ts` + live hooks/TS docs                       | **type exists**; **documented pause is `tool_deferred`**; runtime "never fires" **not re-run** |
| Claude resume = new user message, no tool re-issue | live "Defer a tool call for later"                                      | **contradicts current docs**                                                                   |
| Pi package still exists                            | npm 0.85.1 2026-09-05                                                   | exists                                                                                         |
| Pi `continue()`                                    | `pi-agent-core@0.80.6` `Agent.continue()` d.ts + pi.dev `session.agent` | **Agent yes; AgentSession no; coding-agent docs silent; Archon unused**                        |
| `ToolResultMessage`                                | pi session-format / rpc.md / agent-core continue() JSDoc                | exists                                                                                         |
| "today is prompt→dispose only"                     | `event-bridge.ts` `finally { session.dispose() }`                       | **code-true**                                                                                  |
| MCP name `mcp__archon__AskHuman`                   | `ARCHON_TOOL_SERVER = 'archon'`                                         | convention-true                                                                                |
| No starter defaults                                | brownfield feature spine                                                | N/A                                                                                            |

---

## Required before implementation (do not edit the spine here)

1. **Re-spike Claude 0.3.209 and 0.3.261** for: does `session_state_changed`/`requires_action` fire for in-process MCP tools? Does PreToolUse `defer` on `mcp__archon__AskHuman` yield `tool_deferred` + resumable `deferred_tool_use`? If yes, AD-6's "new user message" path is the workaround, not the SDK contract.
2. **Pin or re-range** `@anthropic-ai/claude-agent-sdk` so the spike version is the install version.
3. **Spike Pi 0.80.6** with a written citation: `session.agent.state.messages` append `ToolResultMessage` → `session.agent.continue()`, including reopen-after-dispose. Until that lands, AD-6 Pi is **unverified against current SDK docs**.
4. Record an explicit reject/defer of built-in `AskUserQuestion` if `AskHuman` remains the mandated channel.

---

## Not flagged / out of scope

- Hono `^4.12.16` vs any newer 4.x: workspace-true; feature adds routes via existing `registerOpenApiRoute`.
- React 19 / Tailwind 4: still the Archon web stack; no new tokens.
- `workflowStepStatusSchema` gaining `awaiting` alongside `nodeStateSchema`: planned additive enum change, not a stale package.
- Permission envelope dormant: no extra library claim.
- Source-control viewer reuse: correctly deferred; no extra dep.
  )
