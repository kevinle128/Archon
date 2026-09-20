# PRD — Issue 193: preserve message order and attribution under concurrent operators

Source plan: `plans/260920-0444-issue-193-concurrent-operator-order-attribution/plan.md` + `phase-01..05-*.md` (same directory). Branch: `archon/thread-1d25203e`, PR target: `develop`, `Closes #193`. Tracker: Story 2.13 in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.

## Overview

Prove that two distinct operator identities can send overlapping guidance to one live workflow node without a lock, and that the one global order chosen by the server survives unchanged through the shared queue and the executor-written transcript. Every written row must retain the sender and caller message id that belong to that message. A sibling node must receive only its own message and sender.

This is a **proof-and-harden** story. The ordering, attribution, queue, transcript, and display-name mechanisms already exist. Production code changes are made **only** if a focused test exposes a concrete violation — write the red test first, keep any fix minimal and in a separately revertible commit.

## Problem

Issue #193 delegates acceptance to Story 2.13 (`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`): server receipt order, stable written order within each operator's stream, correct `operator_user_id` / `message_id`, matching display names, overlapping requests, and no cross-node or cross-user identity mix-up. EQ-10 in the implementation-readiness report identifies this as the one missing happy-path integration criterion — most existing fixtures use a single hard-coded sender, and no current journey launches two docks together then compares pre-drain queue order with the final mixed-sender transcript.

## Solution

Five phases diagnose individual links before proving the full chain:

1. Registry characterization — mixed senders retain synchronous `accept()` order and attribution through snapshot, drain, idempotent replay, and idle `send_now`.
2. Deterministic route concurrency — hold operator A at the identity-resolution seam, let B finish, release A, prove the handle snapshot and queue GET reflect that accept order with per-request attribution.
3. Executor transcript chain — strengthen existing direct natural-drain, idle `send_now`, and loop-drain tests for mixed-sender order/metadata.
4. E2E two-operator journey — one Playwright scenario per shell (Legacy + Console): two identity contexts launch overlapping dock sends; the observed pre-drain queue order is the oracle for transcript and DOM order; sibling node isolation proven in the same journey.
5. Closeout — evidence report, steering test-plan mapping, sprint-status `done`, full repository gates.

## Goals and success metrics

- A deterministic route test proves B-then-A handle order when A is held at identity resolution; each item keeps its own request's user id; queue GET returns the same id order and exactly `{message_id, message}` fields — no attribution fields.
- Existing executor tests prove mixed A/B batches preserve message order, `operator_user_id`, `message_id`, and the caused attempt for direct, `send_now`, and loop delivery paths.
- One Playwright scenario per shell: transcript operator-row ids exactly equal the observed queue order; each sender's two ids retain dock order; sender ids/display names match the originating identity; sibling node contains only its own message and sender; both views render the same ordered rows and labels.
- No public or persistent contract changes. Any production fix is cause-aligned, red-test-first, and called out in the evidence report.
- Focused Bun tests, E2E typecheck/scenarios, and `bun run validate` pass; Story 2.13 moves to `done` only after those gates pass.

## Non-goals

- No new lock, per-user lane, timestamp sort, queue version, or ordering field.
- No schema, migration, OpenAPI, generated type, or queue-response change.
- No new authorization behavior, proxy hardening, interrupt attribution, withdraw audit row, delivery state, soft injection, or detached steering.
- No load test or multi-process guarantee — the registry is intentionally process-local and each `accept()` mutation is atomic under JavaScript execution.
- No new UI layout or copy; two-shell visual behavior is regression coverage only.
- No duplicate tests for malformed input, duplicate ids (beyond the one strengthened registry case), terminal transitions, anonymous sends, display-name fallback, or queue visibility — those contracts already have focused coverage.

## Contract definitions (tests must use these meanings)

- **Server receipt order** = the synchronous call order at `NodeSteeringHandle.accept()`. NOT browser click order, request creation order, timestamp sort, or response completion order.
- **One operator stream** = one dock/request stream that waits for its prior send response before sending its next message. Two tabs for the same identity are separate streams; the server promises only receipt order across them.
- **No cross-user identity leakage** = a message is never stamped or displayed as the other sender. It does NOT mean private queues — the node queue is deliberately shared and visible to every permitted reader.
- The trusted-header seam and Better Auth session both resolve to canonical Archon user ids. These tests cover request-to-user binding; they do not reopen authentication grants or proxy hardening.

## Technical context (verified references)

| Concern | Code | Notes |
| --- | --- | --- |
| Registry | `packages/workflows/src/steering-registry.ts` — `NodeSteeringHandle` (line 128), `pending` queue (130), `accept()` (290, pushes at 306, first-wins `send_now` batch release 314-318), `enqueue()` (334), `drain()` (359-363), `pendingCount()` (337) | Keys are `(runId, stepName)`; `accept()` is synchronous; snapshot/drain return array order unchanged |
| Send route | `packages/server/src/routes/api.ts` — POST `nodes/:nodeId/send` (handler ~5343, `handle.accept(...)` at 5426); identity via `userDb.findOrCreateUserByPlatformIdentity` (2478, 2504, 2546, 2564); GET `nodes/:nodeId/queue` at 5650 | Route resolves identity → awaited lifecycle gates → synchronous `accept()` with `requester?.userId ?? null` |
| Registry tests | `packages/workflows/src/steering-registry.test.ts` — helpers `msg`, `enqueue`; suites `idempotency`, `drain`, `discardRun`, `accept + enterIdle` | Phase 1 extends `msg()` with optional `operatorUserId` (default `user-1`) |
| Route tests | `packages/server/src/routes/api.workflow-runs.test.ts` — helpers `postNodeSend`, `sendPayload`, `liveSetup`; default `mockFindOrCreateUserByPlatformIdentity` echoes the header value | Phase 2 installs a temporary identity mock keyed by header value to block A deterministically |
| Executor tests | `packages/workflows/src/dag-executor.test.ts` — `executeDagWorkflow -- queued guidance (#181)` (already uses `op-a`/`op-b`), `-- interrupt and redirect (#183)` (single-sender helpers), loop-guidance test (single sender) | Phase 3 strengthens these three; `appendOperatorTranscript` order/fields already proven by `node-transcript.test.ts` — do not duplicate |
| E2E spec | `e2e/ui/agent-queue-convergence.spec.ts` — starter/teammate contexts, Console+Legacy navigation, `e2e-queue-guidance-pair` two-node fixture, queue GET/DOM/node-start/viewport helpers; `e2e/lib/playwright/run-detail.ts` exports `listNodeMessages` | Phase 4 adds one parameterized `[V:steer.concurrent-operators-${surface}]` scenario; fixture unchanged (bounded 45s first turns = pre-drain window) |
| Docs/tracker | `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` (replace the generic concurrent-operators bullet); `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` (move only `2-13-...` to `done`) | Phase 5 only, after gates pass |
| Evidence report | `plans/260920-0444-issue-193-concurrent-operator-order-attribution/reports/characterization-evidence.md` (new file) | Commands, pass/fail summaries, scenario ids, any production defect fixed |

Conditional production owners (only after a red test proves a defect): `packages/workflows/src/steering-registry.ts`, `packages/server/src/routes/api.ts`, `packages/workflows/src/dag-executor.ts`.

## Rules for every story

- No timers, sleeps, microtask counts, or call-indexed gates as the source of ordering truth — use promise-controlled interleaving and real snapshots.
- Test/docs-only by default; if production code must change, isolate it in a separate focused commit with red/green evidence for Phase 5.
- Do not add redundant cross-run, withdraw, anonymous-sender, same-identity/tab, or error matrices — prior stories own them.
- `bun run validate` does not run the standalone Playwright project; both Bun gates and the Playwright commands are required.

## Story overview

| ID | Title | Phase | Files touched | Depends on |
| --- | --- | --- | --- | --- |
| US-001 | Registry mixed-sender characterization | 1 | `packages/workflows/src/steering-registry.test.ts` | — |
| US-002 | Deterministic route concurrency test | 2 | `packages/server/src/routes/api.workflow-runs.test.ts` | US-001 |
| US-003 | Executor mixed-sender transcript chain | 3 | `packages/workflows/src/dag-executor.test.ts` | US-001, US-002 |
| US-004 | E2E two-operator journey (Legacy + Console) | 4 | `e2e/ui/agent-queue-convergence.spec.ts` | US-001–US-003 |
| US-005 | Closeout: evidence, test plan, tracker, gates | 5 | `reports/characterization-evidence.md` (new), `steering-test-plan.md`, `sprint-status.yaml` | US-001–US-004 |
