# PRD — Issue 191: Recover messages that were never sent when the node ends

Plan source: `plans/260920-1136-issue-191-recover-never-sent-messages/plan.md` + `phase-01..04-*.md` (same directory). Issue: https://github.com/kevinle128/Archon/issues/191. This is Story 2.11 from `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`; its data dependencies (Story 2.8 operator rows with `message_id`, Story 2.9 shared queue snapshots) are already done.

## Problem

When a workflow node ends, guidance an operator queued (or submitted, or was still typing) can silently vanish: `NodeSteeringHandle.drain()` removes pending items and the executor only writes an operator transcript row on the guidance turn's first successful stream yield. A receipt can disappear from a later queue snapshot before any row exists. Nothing tells the user which messages were never delivered.

## Solution

After the client observes the selected node's **actual terminal evidence** (a persisted lifecycle terminal event, or the server's exact-scope terminal projection of a transactionally purged parked Ask), both node-room docks (Legacy `ComposerDock`, Console `ConsoleComposerDock`) reconcile every observed steering receipt against node-wide persisted operator `message_id`s. Unmatched items return in the draft area as a read-only `NEVER SENT · n` box preserving exact text and `message_id`; a still-pending submission and a different half-typed draft fold in last. One `<p role="alert">node finished · none of this was sent</p>` announces it.

Non-negotiable safety rules threaded through every story:

- **Reconcile only on real node-terminal evidence.** Run-level terminal status is NOT sufficient: `cancelWorkflowRun()` publishes `cancelled` and discards steering handles before the executor writes `node_failed`, and can still persist an operator row in between. Settled projected `nodeStates` are not event proof either — raw `nodeExecutions` stays `running` until the event exists. Never reconcile on `!live`.
- **Fail closed.** No terminal evidence or no complete node-wide transcript drain → no `NEVER SENT` claim, ever. Unscoped/ambiguous Ask interaction data never closes an execution.
- **Observation ledger, not visible queue.** The ledger accumulates receipts from every generation-valid queue snapshot plus this tab's successful sends; later snapshot omission never erases it; only this tab's confirmed withdraw removes an id. It is component-mounted memory only (NFR4) — no persistence, no cross-reload recovery.
- **Logical execution key, not occurrence id.** Fold ordered events: an Ask `interaction_resolved` with `resumed:true` makes the next same-node `node_started` retain the prior key (loop resume mints a new outer `occurrence_id` but keeps the key); every other new start adopts its occurrence id (or persisted event id fallback). Key replacement = attempt reset; Ask continuation is not.
- **Attempt reset is an async-ownership boundary.** A per-attempt generation captured by every async continuation (queue read, Queue, Send-now, withdraw, interrupt, terminal drain) makes prior-attempt completions inert. Server mutations that already happened are not cancelled; obsolete client responses are discarded.
- **Terminal catch-up.** While a mounted run-detail view shows a terminal run whose raw `nodeExecutions` are still unsettled, keep a 3 s read-only refetch/invalidation until all settle or unmount. No timeout inference, no lifecycle mutation.
- **Node-wide scope.** Terminal signal and the delivery-comparison transcript drain are both run/node-scoped — never occurrence-scoped. Dock React key moves to run/node; transcript pagination stays occurrence-scoped.

## Goals and success metrics (acceptance criteria)

- **AC1** — On actual node terminal evidence, every receipt ever shown by a generation-valid queue snapshot (including the read-only finished-iteration view) or returned by this tab, except ids this tab confirmed withdrawn, is compared with node-wide persisted operator `message_id`s; every unmatched receipt is restored once, in original observation order.
- **AC2** — A live refetch, a workflow-terminal status with raw execution still `running`/`awaiting`, or a transcript drain begun before terminal evidence never populates reconciliation input. Cancelling a scoped parked Ask projects only its proven execution(s) terminal; answered-Ask resume retires only proven superseded segments; unscoped/ambiguous data fails closed.
- **AC3** — A pending submission neither observed nor written is restored; a different current draft follows it verbatim; unchanged text is not duplicated.
- **AC4** — The finished box has exact text and identities, accessible name `Never sent, n`, exactly one assertive alert `node finished · none of this was sent`, and no fields or controls.
- **AC5** — If every observed receipt was written and there is no unsent input, the finished dock is absent.
- **AC6** — A new execution attempt for the same node clears terminal reconciliation state even if it started and finished between client refreshes; late prior-attempt async results are inert; draft text remains, the old retry UUID is cleared, next submit mints a new id.
- **Tracker** — `2-11-recover-messages-that-were-never-sent-when-the-node-ends` in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` moves to `done` only after all gates pass.

## Non-goals (explicit exclusions)

- No workflow engine, steering registry, database write/schema, route, OpenAPI, or generated-API changes. The only server change is the existing read projection in `workflow-execution-history.ts`.
- No durable/session storage of the observed ledger or finished box; no resend/dismiss controls; no cross-reload recovery. Existing draft/retry storage key and record shape are unchanged (retry reset clears only the prior UUID, keeps draft text).
- No Story 2.12 idle-expiry timer/copy or Story 2.13 ordering work.
- No changes to transcript rendering, `agent-history.ts`, or node-room routing.
- No `test.fixme` skeletons — skipped tests are not red tests. Tests are written red before implementation in each story.
- No new E2E workflow fixture unless the confirmed `e2e-queue-guidance.yaml` / `e2e-queue-guidance-loop.yaml` fixtures provably cannot hold a tested transition.

## Technical context (verified anchors)

Core state (framework-free, pure, readonly):

- `packages/web/src/lib/steering-dock.ts` — `SteeringDockState` (line 32), `steeringDockMode` (112), `createSteeringDockState` (223), `resolveGuidanceSuccess` (286), `resolveSendNowSuccess` (382), `beginWithdraw`/withdraw resolves (479+), `applyQueueSnapshot` (581). Add `observedLedger: readonly LocalSentReceipt[]`, `neverSent: readonly NeverSentEntry[] | null`, `NeverSentEntry` (`messageId: string | null`), `'finished'` mode, `reconcileNeverSent(state, { writtenMessageIds, draft })`, `collectWrittenOperatorMessageIds(rows)`, and the exact copy constants (lowercase source `never sent · n`, list aria-label `Never sent, n`, alert `node finished · none of this was sent`).

Docks:

- `packages/web/src/components/workflows/ComposerDock.tsx` (Legacy) and `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` (Console). Both get optional `writtenOperatorMessageIds?: ReadonlySet<string> | null` (default null), `nodeTerminal?: boolean` (false), `nodeExecutionKey?: string | null` (null). Console isolation: shared lib imports OK, never Legacy component imports (`packages/web/src/experiments/console/console-isolation.test.ts` guards this).

Server read projection (read-only, no writes, no new fields):

- `packages/server/src/routes/workflow-execution-history.ts` — `projectWorkflowExecutionHistory` (line 142) already receives every interaction row including purged ones with server-minted `execution_scope` (see existing scope handling ~line 247). Extend it — after lifecycle pairing — for `kind:'ask', status:'purged'` (close exact scoped execution + uniquely matched loop-owner segments via `loop_ancestry` prefixes, `ended_at` = parseable `resolved_at`) and `kind:'ask', status:'answered'` (retire scoped pre-resolution open segments only when matching persisted `interaction_resolved` `resumed:true` event + later corresponding starts exist). File-local indexes only; ambiguity fails closed per segment.

Shared model + parents:

- `packages/web/src/lib/execution-room-model.ts` — add `hasUnsettledNodeExecutions(executions)` (terminal = `completed`/`failed`/`skipped` only; anything else unsettled), `hasTerminalNodeEvidence(executions, nodeId)` (≥1 execution AND all terminal), `latestNodeExecutionKey(events, nodeId)` (sort by `event_order` → timestamp → persisted id; fold exact-node events; Ask-resume continuation marker; terminal/`node_retry_requested` clears unused marker; ignore loop-iteration starts and siblings).
- `packages/web/src/components/workflows/WorkflowExecution.tsx` — existing live 3 s refetch at `refetchInterval` (line ~440); extend to also poll when run is terminal AND raw executions unsettled. Passes `nodeExecutions` down at ~line 1023.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx` — SSE + existing 30 s heartbeat `setInterval` at ~line 242; add a distinct 3 s invalidation only for terminal + unsettled; never stack with heartbeat.

Wrappers/panes (Legacy: `LegacyGraphLogsPane.tsx` → `LegacyNodeRoom.tsx` → `NodeTranscriptPane.tsx` + `ComposerDock`; Console: `RunDetailPage` → `ConsoleInspectPane.tsx` → `ConsoleNodeRoom.tsx` + `ConsoleComposerDock`):

- Derive `nodeTerminal`/`nodeExecutionKey` from raw `nodeExecutions`/ordered events; pass through to pane and dock. In both panes (`NodeTranscriptPane.tsx` — `drainNodeMessages` imported at line 20, used ~239; `ConsoleNodeRoom.tsx`), start a separate node-wide `drainNodeMessages` with `kind:'node'` selection only when `nodeTerminal === true`; publish `collectWrittenOperatorMessageIds(rows)` only on `complete:true` + `error:null`; retry transport/incomplete failures at 1 s while mounted/terminal; abort + clear on run/node change, execution-key change, or `nodeTerminal:false`. Never feed drain state into transcript rendering; keep occurrence filters/scroll/Retry unchanged.

E2E + authority artifacts (Phase 4 only):

- New `e2e/ui/agent-never-sent.spec.ts`; modify `e2e/ui/agent-queue-guidance.spec.ts` (natural-drain negative) and `e2e/ui/agent-finished-iteration.spec.ts` (finished-iteration observer). Reuse `e2e/lib/playwright/archon-runtime.ts` helpers (`startWorkflowViaWeb`, `starterFetch`, `waitForRunStatus`, `getRunDetail`, `listNodeMessages`), fixtures `e2e-queue-guidance.yaml` (interruptible turn `delayMs: 30000`) and `e2e-queue-guidance-loop.yaml`, and `POST /api/workflows/runs/{runId}/abandon`. Wait for persisted `event_type === 'node_failed'` on the selected `step_name` via `expect.poll` — never `dag_node_failed` (a log label), never a fixed sleep.
- Update AD-11 in `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`, that folder's `walkthrough.html` terminal-reconciliation entry, `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`, and the one conflicting line in `.../ux-Archon-agent-node-room-2026-09-09/mockups/key-steering-dock.html` (`these never left this tab` → `none of this was sent`). Do NOT touch `.memlog.md`, `reconcile-spec.md`, or `reviews/` — dated records, not current authority.
- Evidence → `plans/260920-1136-issue-191-recover-never-sent-messages/reports/evidence/`; acceptance report → `reports/acceptance-report-260920-issue-191.md`; tracker `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` last.

UX authority: dock width 460 px; Console host also checked at 1440 px; band ≤ `33vh`; lowercase DOM text + CSS uppercase `0.07em` tracking; existing elevated-band tokens + top rule; single-line/elided items; `data-message-id` only on identified entries; focus hands off to last transcript row/scroller (never `body`); alert node identity stable across rerenders; contrast ≥ 4.5:1. The obsolete mockup's 520 px label and the unsupported 1280 px dock target are NOT authority.

## TDD and verification conventions

- Write failing tests first in each story's test file(s); `bun:test` conventions; use real generated types for fixtures (`NodeMessageRow`, `PendingInteraction`, `WorkflowEventRow`, `NodeExecution`, `WorkflowEvent`) — no duplicated enums in public types.
- Component tests run with `NODE_ENV=development`. Never run root `bun test` — use per-package/per-file commands. `@archon/web` has no `lint` script; lint via root `bun x eslint <files> --max-warnings 0`.
- Final repo gate is `bun run validate`. Full command list: `plan.md` "Validation" section (lines ~409–429) and each phase file's "Verification" section.

## Story overview

| Story | Title | Phase | Tests | Depends on |
| ----- | ----- | ----- | ----- | ---------- |
| US-001 | Shared core: observed ledger, reconciliation, finished mode | 1 | T1.1–T1.22 | — |
| US-002 | Read-only NEVER SENT box in both docks | 2 | T2.1–T2.18 | US-001 |
| US-003 | Server projection: scoped purged/answered Ask closure | 3A | T3.1–T3.4 | US-002 |
| US-004 | Raw-history helpers + terminal catch-up in both parents | 3B/3C | T3.5–T3.14 | US-003 |
| US-005 | Node-terminal derivation, pass-through, dock rekey | 3D | T3.15–T3.17 | US-004 |
| US-006 | Node-wide reconciliation drain in both panes | 3E | T3.18–T3.26 | US-005 |
| US-007 | Real-executor E2E, evidence, authority sync, tracker closeout | 4 | E4.1–E4.8 | US-006 |
