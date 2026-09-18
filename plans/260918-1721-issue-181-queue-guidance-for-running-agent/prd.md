# PRD: Issue 181 — Queue guidance for a running agent (Story 2.1)

## Overview

While an in-process agent node is generating, an operator can submit guidance with `Queue` or `Cmd`/`Ctrl`+`Enter` without interrupting the current turn. The server accepts the message immediately into a process-local queue keyed by `(runId, namespacedNodeId)`. At the next natural turn boundary, the executor delivers all waiting messages in server receipt order as one follow-up turn on the same provider session. The node remains `running` until the final turn completes.

Both Legacy and Console node rooms show the Story 2.1 dock states and locally accepted `sent` receipts. Unsent text remains tab-local. Detached execution, invalid targets, terminal nodes, invalid requests, and unauthenticated callers receive the canonical typed refusal without mutating the node, queue, or transcript.

Source plan: `plans/260918-1721-issue-181-queue-guidance-for-running-agent/plan.md` + `phase-01-start.md` … `phase-04-e2e-evidence-and-closeout.md`. Issue: https://github.com/kevinle128/Archon/issues/181. Target branch for the PR: `dev`, with `Closes #181`.

## Problem

A running agent node is a black box: the operator cannot steer it mid-turn without cancelling. Issue #181 / Story 2.1 (`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`) requires accepting operator guidance during generation and delivering it at the next natural boundary on the same provider session — a queue, not an interrupt.

## Solution

1. **Process-local steering registry** in `@archon/workflows`, keyed by `(runId, stepName)` where `stepName` is the namespaced node id already used by transcript routes and loop-group bodies. Handles have `live | parked | closed` phases, synchronous enqueue, full-lifetime idempotency (a `message_id` → original receipt map survives drain), and a synchronous `closeIfEmpty()` last gate so no receipt can succeed after the executor commits to teardown.
2. **Natural-boundary drain in the DAG executor.** `executeNodeInternal` (direct AI nodes and loop-group prompt bodies) and `executeLoopNode` (AI loop nodes) wrap their existing send/re-ask flows in an outer provider-turn loop. At a settled-turn boundary: `closeIfEmpty()` → if `false`, require the just-returned session id (fail the node clearly if absent, before draining) → `drain()` → run the joined `\n\n` messages as turn N+1 on that session id. No `await` between the gate check, session-id decision, and `drain()`.
3. **Canonical typed send route.** `POST /api/workflows/runs/:runId/nodes/:nodeId/send` per `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`: nested `{ success, error: { code, message } }` shape, actor grant for any resolved identity (identity-less installs get `operatorUserId: null`), strict statuses 200/400/401/403/404/409/422, run-state re-read immediately before synchronous enqueue.
4. **Queue composer dock in both shells.** Shared framework-free state/helpers in `packages/web/src/lib/steering-dock.ts`; Legacy renderer `ComposerDock.tsx` mounted in `NodeTranscriptPane.tsx`; Console renderer `ConsoleComposerDock.tsx` mounted in `ConsoleNodeRoom.tsx`. POST-only evidence — no polling, no queue GET.
5. **E2E + closeout.** Opt-in `echoPrompt` scenario in the e2e-fake provider proves same-session resumed delivery in a real web-dispatched run; separate direct and loop fixtures; visual/accessibility captures; acceptance report; PR to `dev` with `Closes #181`.

## Goals and success metrics

- Queued guidance accepted during a generating turn is delivered verbatim (receipt order, joined with `\n\n`) as the next provider turn resuming the immediately prior session id; the node emits exactly one `node_started` and one terminal lifecycle event.
- Zero behavior change when no guidance is queued: identical output, events, batching, usage, retries, Cancel, AskHuman, loop completion.
- Idempotency holds for the whole handle lifetime (duplicate `message_id` replays the original 200 receipt, before and after drain; no FIFO eviction — 501st id must not invalidate the 1st).
- Every canonical actor/status case (400/401/403/404/409/422) returns the nested error and leaves run state, handle snapshot, and transcript/event writers untouched.
- Both shells pass viewport (Legacy 460px; Console 1440×900 + 460px harness), focus, live-region, contrast (4.5:1 text / 3:1 non-text), list-semantics, and reduced-motion checks.
- `bun run validate` passes; focused suites per story pass; no root `bun test`.

## Non-goals (explicit later-story scope — do NOT implement)

- Withdraw/delete (2.2); Stop/interrupt/idle-after-interrupt (2.3); provider-specific soft injection (2.4–2.7).
- Operator transcript rows and `delivered` reconciliation (2.8); no server transcript/event writes at all in 2.1.
- `GET .../queue`, queue-read/live-update contract, cross-tab/cross-operator convergence, queue rehydration after navigation (2.9).
- Finished-iteration queue projection (2.10); terminal `NEVER SENT` restoration (2.11).
- Schema migration, durable steering state, new workflow events, queue-depth/message-length/accepted-id caps (contract defines none — do not invent 16k/50/500 limits).
- Edits to `steering-api-contract.md`; axe dependency in e2e; stale-timeout reapers or cross-process lifecycle guessing.

## Technical context

### Key design decisions (from plan.md)

- Registry is a process singleton following the workflow event emitter pattern; exported via `./steering-registry` subpath only — not through the package root.
- `register` only when the resolved provider has `sessionResume === true`; other providers get no handle (their targets get 422).
- AskHuman and interactive loop gates `park()` the handle; resume re-registers the same handle with queue intact. Every terminal executor path closes/unregisters in `finally`, logging `{ runId, nodeId, queuedCount }` — never message text.
- `packages/core/src/db/workflows.ts` `cancelWorkflowRun`: after the central cancel transaction commits, call `discardRun(runId)` and log counts only. DB cancel never depends on registry contents; cleanup failure must not fail a committed Cancel. No stale-timeout reaper.
- Guidance turns: drop `resumeInteractions`, force `forkSession: false`, rotate transcript attempt scope while preserving node occurrence id, no new `node_started`, no steering event. Turn 1 batching stays visible; `batchMessages` flush must move inside the outer turn loop because `runStreamPass` clears it.
- Idle-timeout, Cancel, credit exhaustion, empty output, provider error: NOT natural boundaries — close handle, take existing terminal path, never drain.
- Re-ask prompts must use the current turn prompt as base (not a closure over turn 1); re-asks keep fresh-session behavior.

### Route mutation order (phase-02, correctness requirement)

1. Auth middleware/actor resolution (401/403) — BEFORE OpenAPI body validation so an unauthenticated gated caller gets 401 even with a malformed body.
2. OpenAPI validation (400) via route-scoped `steeringValidationErrorHook` mapping to `{ success:false, error:{ code:"invalid_request", message } }`.
3. Load run (unknown → 404).
4. Project effective node state + inspect handle: no node & no handle → 404; terminal run/node → 409 `node_finished` (even with stale live handle); closed handle → 409; non-terminal node, no handle → 422 `not_steerable_here`; parked handle/new message → 422; live handle → enqueue.
5. Re-read run status, no `await` afterward; terminal transition wins → 409.
6. Build internal message (original text, caller id, operator id or null, server receipt time); `enqueue` synchronously; translate result.
7. Duplicate accepted id replays original 200 even if parked; duplicate with different prose never overwrites (content-free warning at most). Never "repair"/unregister a stale handle in a rejected request.
8. `intent: 'send_now'` on a live generating handle → also enqueued, returns `'queued'` (idle-after-interrupt is Story 2.3; never synthesize `awaiting_send_now`).

### Schemas (phase-02)

In `packages/server/src/routes/schemas/workflow.schemas.ts`, `z` from `@hono/zod-openapi`, `z.infer` types:

- `sendWorkflowNodeBodySchema`: strict `{ message: string (refined trim().length>0, NOT transformed), message_id: UUID, intent: enum('queue','send_now') }`.
- `sendWorkflowNodeResponseSchema`: strict `{ success: literal(true), message_id: UUID, state: enum('queued','awaiting_send_now') }`.
- `steeringErrorSchema`: strict `{ success: literal(false), error: { code: string, message: string } }`.
- Do NOT touch global `apiError`/`errorSchema` or the existing validation hook.
- After route is done, regenerate `packages/web/src/lib/api.generated.d.ts` (check port 3090 owner first; track PID; stop only the server started for this task).

### Web state contract (phase-03)

`SteeringDockState { sent: LocalSentReceipt[]; inFlight: boolean; pendingRetry: PendingSubmission | null; refusal: {code,message} | null }`.

- Blank-only rejected locally; original non-blank string sent unchanged. One in-flight request; button and shortcut share the guard. UUID stamped once per submission; ambiguous-failure retry reuses id; editing creates a new id. 200 appends once by `message_id` in acceptance order; clears draft; keeps textarea focus.
- Draft + ambiguous retry id persist in `sessionStorage` keyed by run + namespaced node id; accepted receipts are NOT persisted. `sent` receipts live only for the mounted live room — never infer `delivered`.
- Ask-park blocks send pre-transport with exact reason `answer the agent's question first`; sibling asks don't block. Blocked Queue: focusable, `aria-disabled="true"` (not `disabled`), text-secondary, `aria-describedby` → visible reason; click and shortcut share the no-op guard.
- 422 `not_steerable_here` → replace band/field/hint/controls with exactly: `not steerable here · this run was started detached, so its live session is not in this process` (text-secondary; draft/retry preserved).
- Keyboard: `Cmd`/`Ctrl`+`Enter` submits only when non-blank/not blocked/not in-flight/not composing — guard `nativeEvent.isComposing` AND key code 229. Plain/Shift+Enter = newline.
- Layout: `RoomRegion` stays flex column; transcript scroller flexible; full-bleed `surface-elevated` queue band (1px top rule, header `queued · n` lowercase DOM + CSS uppercase, labelled list `Queued messages, n`, visible `sent` per item, internal scroll above 33vh) sits immediately above the dock outside its padded column; dock is the final fixed sibling — reduces transcript viewport, never overlays. Textarea label `message to <node name or id>`, ≥56px, `surface-inset`; hint `Cmd/Ctrl+Enter to send · this tab only`; Queue button bordered/transparent in BOTH shells, ≥32px × ≥84px, `aria-keyshortcuts="Meta+Enter Control+Enter"`, accessible name starts with `Queue` + shortcut + count. One polite `role="status"` per room for count changes; `role="alert"` for failures. No animation; honor reduced motion. No Stop, no per-item delete.
- Mount: Legacy — after jump-to-latest control in `NodeTranscriptPane`'s `RoomRegion`, pass runId, namespaced `row.nodeId`, row status, label, pending-ask via `selectVisibleNodeAskInteractions(...)`. Console — analogous position in `ConsoleNodeRoom` via `requestJson` in `experiments/console/skills/runs.ts`. Update `console-isolation.test.ts` positive file list + approved imports.

### E2E (phase-04)

- `packages/providers/src/e2e-fake/provider.ts`: opt-in `echoPrompt?: boolean` in strict scenario schema; emit one assistant chunk `[e2e-fake] echo: <promptOutsideDirectives>` or `[e2e-fake] resumed echo: …` before result. Default path unchanged.
- Fixtures: `e2e/fixtures/workflows/e2e-queue-guidance.yaml` (single `steer-me` direct node, bounded delay) and `e2e-queue-guidance-loop.yaml` (single `steer-loop` loop node, `until: E2E_LOOP_DONE`, small `max_iterations`) — kept separate so one scenario's lifecycle can't invalidate the other.
- `e2e/lib/playwright/archon-runtime.ts`: seed both fixtures into isolated `ARCHON_HOME`; web-dispatch start helper returning `{ runId, conversationId, codebaseId }`; tracked detached-CLI start helper with runtime cleanup; reuse existing status polling — no fixed sleeps, no untracked processes.
- `e2e/ui/agent-queue-guidance.spec.ts`: both-shell direct queue+drain (expect resumed echo `first correction\n\nsecond correction`, one occurrence), loop delivery (echo + `E2E_LOOP_DONE` inside iteration 1, no iteration 2), real-route smoke (200/400/404/409/422), blocked+detached UI, visual/a11y captures per the viewport matrix.
- Closeout: `reports/acceptance.md` (this PRD dir) mapping Story 2.1 criteria → tests/artifacts; conventional commits; PR via `.github/pull_request_template.md` to `dev` with `Closes #181`; move `2-1-queue-guidance-for-a-running-agent` to `done` in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` only via its owning workflow after all gates pass.

### Validation commands

Never `bun test` from repo root. Focused suites first, then `bun run validate`:

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts -t 'queued guidance')
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts -t 'steering handle cleanup')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'queued guidance')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'queue guidance'
bun run validate
```

Per-package `type-check` and `eslint --max-warnings 0` on touched files (see phase files for exact lists).

## Story overview

| ID     | Title                                                    | Phase                 | Depends on |
| ------ | -------------------------------------------------------- | --------------------- | ---------- |
| US-001 | Steering registry module in `@archon/workflows`          | 1 (registry contract) | —          |
| US-002 | Executor natural-boundary drain + central cancel cleanup | 1 (executor + core)   | US-001     |
| US-003 | Canonical typed send route in the server                 | 2                     | US-002     |
| US-004 | Queue composer dock in Legacy + Console shells           | 3                     | US-003     |
| US-005 | E2E evidence, acceptance report, closeout                | 4                     | US-004     |

Each story is TDD per its phase file: write the focused tests first (or alongside per existing file conventions), implement, run the story's verification commands, then confirm no unrelated assertions were weakened.
