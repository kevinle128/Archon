---
title: 'Issue 183 interrupt and redirect a running Claude agent'
description: 'Implementation-ready plan for Agent Node Room Story 2.3: interrupt the active Claude turn without cancelling the node, wait for an explicit redirect, then continue on the same session.'
status: ready
priority: P1
effort: '5 phases'
issue: 'https://github.com/kevinle128/Archon/issues/183'
branch: archon/thread-dffdf57a
tags: [issue-183, agent-node-room, providers, workflows, server, web, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
revised: 2026-09-19
---

# Issue 183: interrupt and redirect a running Claude agent

## Goal and user outcome

An operator watching a live Claude-backed node can stop only Claude's current turn, inspect the partial outcome, add a correction, and send the pending guidance as the next turn on the same provider session. The workflow node remains `running`; node Cancel, sibling execution, and normal DAG progression are not repurposed.

The successful flow is:

1. `Stop` reaches the current in-process Claude query through its native `interrupt()` control.
2. The executor classifies the turn as interrupted, does not validate/re-ask/complete/fail it, settles any in-flight tool card as interrupted, writes one interrupted status row, and enters `idle-after-interrupt`.
3. The dock removes Stop, shows `Send now`, `WILL SEND · n`, and the written-work disclosure.
4. `Send now` drains previously accepted guidance followed by the new non-blank message, in registry receipt order, and starts the next turn with the same session id.

This is the actual project need recorded by issue #183 and Story 2.3 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. It is not a node stop/resume feature and does not create durable steering state.

## Authority and resolved conflicts

For this story, authority is applied in this order:

1. Issue #183 and Story 2.3 acceptance criteria in `epics.md` (the issue names this as spec authority).
2. Ratified machine companions in `_bmad-output/specs/spec-agent-node-room/`.
3. Final UX spines `DESIGN.md` and `EXPERIENCE.md`, then `mockups/key-steering-dock.html` for visual anatomy.
4. Current source and tests for integration shape and existing behavior.

Three conflicts are resolved explicitly:

- Story 2.3 says focus moves to the last transcript row rather than `<body>` when a dock transition removes the focused control or the dock. `EXPERIENCE.md` separately says Stop-to-idle moves focus to the renamed send control. The story-level criterion governs: when Stop unmounts, focus the last transcript row (or transcript scroller when no row exists), never the send control or `<body>`. Record this deliberate divergence in component tests so it is not “corrected” back accidentally.
- `steering-test-plan.md` says the pinned Claude SDK produces no result after interrupt, while the installed `0.3.209` declaration documents an interrupted turn result with a terminal reason. Neither claim substitutes for runtime evidence. Phase 1 therefore has a mandatory real-SDK spike; its observed event sequence gates the provider/executor contract.
- The steering mock's comment says Legacy inherits a filled send button, but the later final `DESIGN.md` explicitly reverses that treatment after measuring only 3.06:1 contrast. The final design wins: send and Stop are bordered, transparent controls in both shells, with shell-specific tokens/focus offsets only.

## Scope

In scope:

- a distinct, fresh per-provider-call interrupt signal on `AgentRequestOptions`;
- Claude streaming-input mode only for interrupt-capable turns, native `Query.interrupt()`, terminal-reason normalization, and same-session resume;
- an explicit provider interrupt-capability axis, set to native only for Claude and the opt-in e2e fake in this story;
- race-safe live-turn tracking, interrupt classification, idle-await, atomic `send_now`, and cleanup in the direct AI path, AI loop path, and provider-calling loop-group bodies;
- an interrupt route, exact actual-outcome responses, and optional live steering sub-state projection;
- the complete Stop / Stopping / idle / Send now dock flow in both web shells;
- focused unit, route, component, real-SDK spike, and Playwright evidence.

Out of scope, with existing owners preserved:

- the 30-minute inactivity failure and composing keepalive (Story 2.12); this story only adds the cancel/discard exits needed so an idle node is not uncancellable;
- withdraw, operator transcript rows, terminal `NEVER SENT` reconciliation, finished-iteration projection, and cross-tab queue synchronization (Stories 2.2 and 2.8–2.11);
- non-Claude provider interruption (Stories 2.4–2.7); those providers retain the queue-only Story 2.1 dock and are not shown Stop;
- mid-turn soft injection and delivered acknowledgements (G1–G4);
- database migrations, durable queue/sub-state storage, new workflow event kinds, or a transcript `kind` widening.

## Repository evidence inspected

| Area             | Evidence and verified implication                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product contract | Issue #183; `epics.md` Story 2.3; `SPEC.md`, `control-states.md`, `engine-integration.md`, `provider-steering-matrix.md`, `steering-api-contract.md`, and `steering-test-plan.md`. These establish native Claude interruption, the five-case end-cause rule, the two projected sub-states, actual-outcome route responses, and direct/loop parity.                                                                                                          |
| SDK              | Installed `@anthropic-ai/claude-agent-sdk@0.3.209` declarations. `Query.interrupt()` is streaming-input-only; terminal reasons include `aborted_streaming` and `aborted_tools`; the result types carry `terminal_reason`. Runtime behavior remains spike-gated.                                                                                                                                                                                             |
| Providers        | `packages/providers/src/types.ts`, Claude provider/tests, every provider `capabilities.ts`, registry/observability fixtures, and `scripts/generate-capability-matrix.ts`. Claude currently sends a string prompt and its existing abort listener is Cancel-grade (`AbortController.abort()` plus query close), so steering needs a distinct option and listener.                                                                                            |
| Engine           | `packages/workflows/src/steering-registry.ts`, `dag-executor.ts`, its direct/loop tests, node execution schemas, and core workflow discard ordering. Story 2.1 already supplies an in-process receipt-ordered queue and multi-turn outer loops; it lacks active-turn identity, interrupt settlement, and idle-await. Existing result handling clears outstanding tools as `unknown`, so interrupted settlement must occur at classification, not afterward. |
| Server           | Send schemas/handler, GET-run node projection, OpenAPI wrapper patterns, auth resolution, and route tests in `packages/server/src/routes/`. `send_now` already exists in the request schema, and the response schema already includes `awaiting_send_now`; the implementation must preserve idempotent receipts and make enqueue-plus-release atomic.                                                                                                       |
| Web              | Shared `packages/web/src/lib/steering-dock.ts`, both thin dock components, their node-room owners, both request layers, polling/SSE behavior, and existing component/isolation tests. The existing local `sent` list is only a client receipt view; a failed Send now needs a reversible in-flight batch without re-enqueuing server-accepted messages.                                                                                                     |
| UX/design        | Final `DESIGN.md`/`EXPERIENCE.md`, `mockups/key-steering-dock.html`, and `validation-report.html`. Required anatomy is identical across shells; 460px is the only authoritative panel width, 520px is illustrative, controls are 32px minimum, send is at least 84px wide, and the final design makes controls bordered on both shells. No separate design-handoff directory referenced by the draft exists in this checkout.                               |
| E2E/operations   | Existing `e2e-queue-guidance*.yaml` fixtures, `agent-queue-guidance.spec.ts`, e2e-fake provider/tests, and runtime fixture seeding. The current fixtures can be extended; duplicate interrupt-only fixtures and seeding are unnecessary.                                                                                                                                                                                                                    |

The existing reports under `./reports/` were used only as navigation aids; their claims were rechecked against the sources above.

## Technical decisions

### D1 — Separate node Cancel from turn interruption

Add `interruptSignal?: AbortSignal` to `AgentRequestOptions`. `abortSignal` remains the long-lived node Cancel signal. A fresh interrupt controller is created for every provider call, including structured-output re-asks; no `AbortSignal.any`, magic `reason`, or node-controller mutation is used. This makes accidental Cancel-grade behavior impossible for providers that do not implement this story yet.

### D2 — Capability-gated Claude transport

Add a required `ProviderCapabilities.interrupt` axis with values `'native' | 'stream-abort' | false`. Claude and the opt-in e2e fake are `'native'`; other providers are `false` until their stories. Only an interrupt-capable live turn receives an interrupt signal and projects a steering sub-state. A non-Claude Story 2.1 handle remains queue-only, so Stop is absent; a defensive interrupt request maps to the existing 422 `not_steerable_here`, not a new public error code.

When `interruptSignal` is present, Claude uses a typed one-message `AsyncIterable<SDKUserMessage>` kept open for the query lifetime and calls `query.interrupt()` exactly once on signal abort. The node Cancel listener retains its existing abort/close behavior. Calls without `interruptSignal` keep the existing string-prompt path unchanged.

### D3 — Spike-gated terminal contract

Normalize the SDK result's `terminal_reason` as `MessageChunk.result.terminalReason?: string`. The preferred verified path is an abort-marked result that retains the session id. The real-SDK spike must prove initial-turn interrupt, resumed-turn interrupt, event ordering, terminal reason, query completion, and same-session continuation before engine work proceeds.

If the SDK instead closes without a result, Phase 1 may emit a normalized interrupted terminal chunk only when a real session id was already observed and the behavior is covered by tests. If no trustworthy session id survives, stop implementation and record a blocker; do not invent a session id, downgrade to Cancel, or silently broaden scope.

### D4 — Tokenized, idempotent live-turn state machine

Extend the existing registry handle rather than introducing another registry. `beginTurn()` returns a monotonically increasing token; `endTurnStream(token)` clears only that turn's active controller; `settleTurn(token, outcome)` resolves only that turn's pending interrupt. This prevents a late cleanup from clearing a newer turn.

`interrupt()` is synchronous up to aborting the current controller and returns one shared settlement promise. Repeated calls while interrupting do not abort twice. While idle it returns idle immediately. If the stream has already ended it waits for classification without touching a stale controller. Closing/parking the handle settles all pending interrupt and idle waiters exactly once.

### D5 — Five-case end classification and transcript integrity

Classification follows `engine-integration.md`:

1. result without an abort marker: natural end, even if Stop raced it;
2. abort-marked result plus operator-interrupt flag: interrupted;
3. abort-like throw plus operator-interrupt flag: interrupted;
4. other throw: genuine failure;
5. node Cancel wins by position.

Only cases 2–3 skip validation/re-ask and enter idle-await. For Claude in this story, the typed result marker is exactly `terminalReason === 'aborted_streaming' || terminalReason === 'aborted_tools'`; do not use a broad `startsWith` rule that could absorb a future unrelated terminal. A thrown-error helper accepts only recognized abort names/codes/messages while the matching turn signal and operator-interrupt flag are both set, with false-positive tests. An interrupt request prevents another re-ask from claiming the same turn slot, even when a natural result wins the race. The result handler must settle still-open tool calls as `interrupted` before the existing map clear; provider-emitted interrupted tool results are not duplicated. Idle entry writes exactly one `interrupted` status row, which the existing reader fold applies to the preceding tool card. No `dag_node_failed` is emitted for cases 2–3.

### D6 — Idle-await and atomic redirect

An interrupted end always idles, regardless of queue depth. In this story, idle-await exits only through atomic `send_now`, same-process discard, or a cancel-status poll using the existing interval/status predicate. It intentionally has no 30-minute timer yet.

Registry acceptance takes the intent in the same synchronous mutation as idempotency and queue insertion. A newly accepted `send_now` while idle appends the non-blank message, drains all receipts in order, claims the idle waiter, and moves the internal handle back to generating before yielding. Duplicate message ids replay their original receipt without draining twice. `send_now` received while generating/interrupting queues normally for the next boundary.

The immutable receipt state describes acceptance time: a message accepted while idle returns `awaiting_send_now`, including the message whose `send_now` call releases the batch. It does not change to `queued` merely because delivery began; the projected sub-state reports that transition.

### D7 — Actual-outcome API and ephemeral projection

`POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt` awaits executor settlement and returns only the actual outcome: 200 `idle-after-interrupt`, 200 `generating` after a natural end auto-drains pending guidance, or 409 `node_finished` when the natural end closes with an empty queue. Existing auth/identity and detached/parked refusal behavior mirrors send.

`WorkflowNodeState.steeringSubState?: 'generating' | 'idle-after-interrupt'` is joined from the live in-process registry. It is absent for detached, parked, terminal, and currently non-interrupt-capable handles. `interrupting` remains a caller-tab-only UI transient. No database or SSE event is added; cross-tab freshness stays outside Story 2.3.

### D8 — UI state and lossless local batching

The shared dock logic drives both shells:

- queue-only handle (sub-state absent): existing Story 2.1 Queue dock, no Stop;
- generating: Stop left, Queue right;
- interrupting: focusable `Stopping…` with `aria-disabled`, Queue still usable so the race cannot lose text;
- idle: Stop absent, `Send now`, `WILL SEND · n`, disclosure;
- resolved generating/terminal: use route outcome plus authoritative run state.

`Send now` requires a non-blank newly typed message, matching the existing request schema and UX ban on an enabled send for an empty draft. Its reducer snapshots displayed server receipts plus the new draft into an in-flight batch and clears the band optimistically. It posts only the new message—the server already holds earlier receipts. Success discards the batch; failure restores the full display batch at the front without re-posting old ids, retains idle state, and exposes `couldn't send · back in the queue` in `role="alert"`.

## Phases

| #   | Phase                                                                                                            | Depends on |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | [Claude native interrupt seam and real-SDK gate](./phase-01-claude-native-interrupt-seam.md)                     | —          |
| 2   | [Registry, executor classification, and idle-await](./phase-02-engine-registry-turns-and-idle-await.md)          | 1          |
| 3   | [Interrupt route, atomic Send now, and sub-state projection](./phase-03-server-interrupt-route-and-sub-state.md) | 2          |
| 4   | [Both web docks, accessibility, and visual states](./phase-04-web-stop-send-now-dock-both-shells.md)             | 3          |
| 5   | [Deterministic E2E evidence and closeout](./phase-05-e2e-evidence-and-closeout.md)                               | 1–4        |

## Acceptance criteria

- [ ] Every interrupt-capable direct AI turn, AI-loop turn, and provider-calling loop-group body registers and settles a tokenized active turn; terminal paths close/unregister and settle all waiters, while AskHuman intentionally parks the existing handle/queue for resume.
- [ ] Stop calls Claude's native `interrupt()` once through the fresh turn signal; it never aborts/closes the query through the node Cancel path, the node remains `running`, and the next turn resumes the verified same session id.
- [ ] The interrupt route returns the classified actual state—idle, generating after auto-drain, or 409 finished—and concurrent/repeated interrupts and sends lose or duplicate no accepted receipt.
- [ ] An interrupted end retains usage/cost accounting but performs no output validation, validation-miss event, re-ask, batch partial emission, background-task follow-up wait, node completion, or node failure; it settles outstanding tool UI as interrupted and writes exactly one interrupted status row.
- [ ] Natural-end races retain normal validation/completion behavior; Cancel remains dominant and unchanged.
- [ ] Idle `send_now` accepts a non-blank new message, returns its immutable `awaiting_send_now` receipt, drains earlier receipts then the new one exactly once, and starts the next turn on the same session.
- [ ] Non-Claude providers remain queueable but expose no Stop or steering sub-state in this story; detached/parked/terminal refusals preserve existing contracts.
- [ ] Both docks match the final design anatomy and content at the authoritative 460px panel width and at a 1440×900 desktop shell: no horizontal overflow or control reordering, 32px targets, stable ≥84px send width, token-only styling, and scrollable transcript as the dock grows.
- [ ] Generating, interrupting, idle with/without queued receipts, generating-again, delivery-failure, and terminal-removal states meet the copy, announcement, alert, contrast, reduced-motion, and last-transcript-row focus criteria in both shells.
- [ ] Focused tests, the sanitized real-SDK spike report, both-shell Playwright flow, loop parity test, capability matrix check, type checks, and `bun run validate` all pass before Story 2.3 is marked done.

## Compatibility, operations, and rollback

- All type/schema changes are additive and optional at wire boundaries. No migration or persisted state changes.
- Existing calls without `interruptSignal`, all non-opt-in e2e-fake scenarios, and non-Claude queue guidance must remain behaviorally unchanged.
- The interrupt HTTP request may remain open until classification; every engine terminal path must settle it. Do not add an arbitrary server timeout that can report the wrong outcome.
- Idle-after-interrupt is process-local and, until Story 2.12, can wait indefinitely if no operator acts; the cancel poll and registry cleanup prevent an uncancellable or leaked run. A process restart loses the session/queue as already disclosed by the steering design.
- Idle-await adds at most one interval per idle node, using the existing cancel cadence and clearing it on every wake/teardown; it must not busy-poll, retain query listeners, or add per-chunk registry work. Queue and accepted-id complexity remains the existing Story 2.1 behavior.
- OpenAPI regeneration must use one tracked server process on the deterministic project port and stop that process afterward.
- Rollback is a single feature slice: remove the route/projection and UI controls, then remove the executor/provider seam. No data rollback is required.

## Validation sequence

Run the focused commands named in each phase, then:

```bash
bun run generate:capability-matrix
bun run check:capability-matrix
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'interrupt and redirect'
bun run validate
```

Do not run root `bun test`; the repository requires per-package isolation. Do not mark `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` done until the final gate and evidence map are complete.
