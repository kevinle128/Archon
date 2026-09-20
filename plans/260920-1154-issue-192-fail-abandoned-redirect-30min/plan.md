---
title: "ANR Story 2.12 — Fail an abandoned redirect safely after 30 minutes"
description: "Bound the idle-after-interrupt wait with a fixed 30-minute inactivity timer that fails the node once with 'interrupted by operator, no redirect received', re-armed by an authenticated composer keepalive, resolving the idle-await slot exactly once."
status: pending
priority: P1
effort: 12h
issue: 192
branch: archon/thread-cfc1f82b
tags: [anr, epic-2, steering, workflow-engine, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
---

# ANR Story 2.12 — Fail an abandoned redirect safely after 30 minutes

## Overview

An interrupted agent node (`idle-after-interrupt`, Story 2.3) currently waits **forever** for
the operator to press `Send now`. `raceIdleWake` (`packages/workflows/src/dag-executor.ts:521`)
races only the handle idle-waiter (`send_now` / `terminated`) against a terminal-status
cancel-poll — there is no upper bound. An abandoned steer therefore holds a live provider
session and a `running` node indefinitely.

This plan adds a **fixed 30-minute inactivity timer** to the idle-await lifecycle. On genuine
inactivity the node fails **once** with the exact message `interrupted by operator, no redirect
received` — deliberately **not** the existing streaming idle-timeout that *completes* a node.
Composer activity (keystroke / focus / an authenticated keepalive route) **re-arms** the timer
without resolving idle-await; `Send now` is excluded because it *resolves* idle-await. The
idle-await slot must resolve **exactly once** whether `Send now`, the cancel-poll, or the timer
wins.

Because the wait is **in-memory only** (the steering registry, engine-integration.md §3), it
must be bounded: durable waits (approval gates) may be unbounded because they are
restart-recoverable, but a registry-only wait leaks a live session with no durable recovery
path. This is why engine-integration.md §2 rejects *wait-forever* outright.

## Constitutional clearance (read before red-team)

The 30-minute auto-fail is **not** a violation of AGENTS.md *"No Autonomous Lifecycle Mutation
Across Process Boundaries."* That rule triggers when a process cannot distinguish "running
elsewhere" from "orphaned." Here the executor **is** the owner — it holds the live session and
the `await`; nothing runs elsewhere. The keepalive is the presence channel, and the failure is
recoverable via `workflow retry-node`. This lands squarely inside the rule's own carve-out
("subprocess timeouts … recoverable operations remain appropriate").

**Verification sources (sticky decisions — an audit reverses these only with new evidence):**

- AGENTS.md carve-out: "Heuristics for recoverable operations (retry backoff, subprocess
  timeouts …) remain appropriate; the rule is about destructive mutation of *non-terminal* state
  owned by an *unknowable other party*." The idle-await owner is knowable and local.
- NFR6 (`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:118`): *"Idle-after-interrupt
  uses a fixed 30-minute inactivity timer."* Owner-ratified; **fixed, not configurable.**
- engine-integration.md §2 rejected-bounds list: *wait-forever* ("fragile in-process, §3") and
  *complete-with-partial* ("the do-nothing bug") are both rejected; the explicit fail branch is
  the ratified choice.

A red-team persona proposing "make the timeout configurable" or "don't auto-fail / wait forever"
is **reversing a ratified owner decision**, not raising new evidence — reject unless it brings
new data.

## Core mechanism (settled with advisor + three scouts)

**Expiry resolves *through* the handle's single idle-waiter slot — never as a third
`Promise.race` participant.** A bare executor-local timer that wins the race while the handle
still shows `subState: 'idle-after-interrupt'` with a live `idleWaiter` would let a concurrent
`accept(msg, 'send_now')` drain the batch, flip the handle to `generating`, and return the
operator a **success receipt on a queue the executor is simultaneously failing**. Funnelling
expiry through the handle makes "resolves exactly once" **structural**, not merely asserted, and
satisfies the `#181` invariant *seal before the first awaited terminal write* for free (the seal
*is* the expiry).

Design (all pieces small, layered by dependency):

1. **Registry (`steering-registry.ts`)** — add a third `SteeringIdleWake` variant
   `{ kind: 'expired' }`; add `expireIdle()` (one synchronous mutation: resolve the live
   `idleWaiter` with `{ kind: 'expired' }` **and** seal → later `accept` returns
   `{ ok: false, reason: 'closed' }` → route 409); add the composer-activity relay
   (`recordComposerActivity()` invokes an executor-registered re-arm callback; a setter +
   clearer to register/deregister it). No time is generated in the registry — it only relays a
   signal, consistent with callers supplying `receivedAt` today.
2. **Executor (`dag-executor.ts`)** — export `IDLE_AWAIT_TIMEOUT_MS = 30 * 60_000` beside
   `CANCEL_CHECK_INTERVAL_MS` (`:857`) and a behavior-named error constant
   `interrupted by operator, no redirect received`. Extend `raceIdleWake` to arm a **one-shot,
   injectable-duration** timer that calls `handle.expireIdle()` on fire and re-arms via the
   handle callback; clear the timer + deregister the callback on any resolution (mirror the
   `stopped` flag). Add an explicit **`wake.kind === 'expired'`** fail branch (mirror
   `finishCancelled` shape but emit `node_failed` with the specific error, return
   `{ state: 'failed' }`). The timeout is injectable for fake-timer-free tests
   (existing steering tests never fire a real `setTimeout`).
3. **Server route (`api.ts` + `workflow.schemas.ts`)** — `POST
   /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`, bodyless, modeled on `interrupt`:
   404 → 409 `node_finished` → 422 `not_steerable_here` → re-check status → call
   `recordComposerActivity()`; identity via `resolveAuthContext` (any authenticated user; 401
   only when the gate is on; identity-less run allowed). Regenerate `api.generated.d.ts`.
4. **Web docks (both shells)** — one shared disclosure string (30-min limit + "typing keeps it
   open") rendered at the existing `idle` gate; a debounced keepalive fired on **keystroke and
   focus** while `agentMode === 'idle'` only — never on `Send now`, never from the
   finished-iteration read-only dock.

## Acceptance-criteria → work map (existing vs new — keeps the diff honest)

| AC (epics.md Story 2.12) | Verdict | Where |
|---|---|---|
| 30-min inactivity → fail once `interrupted by operator, no redirect received`; never the completing idle timeout | **NEW** | Phase 1 (node), Phase 2 (loop) |
| Keepalive re-arms the fixed timer without resolving idle-await; `Send now` excluded | **NEW** | Phase 1 (engine) + Phase 3 (route) + Phase 4 (docks) |
| Idle-await resolves exactly once (Cancel / `Send now` / expiry); cancel-poll reachable with no stream | cancel-poll **existing** (`:528`); exactly-once = existing waiter machinery **extended** | Phase 1 |
| Queued messages at expiry → Story 2.11 restores as `NEVER SENT` | **EXISTING** 2.11 flow — **proof test only** (`hasTerminalNodeEvidence` fires on the fail terminal) | Phase 5 |
| 30-min-failed node retried via `workflow retry-node` → fresh provider session | **EXISTING** — automatic (`upsertWorkflowNodeSession` is completion-only `:10402`; `prepareWorkflowNodeRetry` deletes persisted sessions `:537`) — **proof test only** | Phase 5 |
| Dock discloses the 30-min limit + that typing keeps it open, in accessible text | **NEW** | Phase 4 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Registry + executor idle-await expiry core](./phase-01-start.md) | Pending |
| 2 | [Loop-node idle-await parity](./phase-02-loop-node-idle-await-parity.md) | Pending |
| 3 | [Keepalive server route + OpenAPI schema](./phase-03-keepalive-server-route-and-openapi-schema.md) | Pending |
| 4 | [Web docks: 30-min disclosure + keepalive](./phase-04-web-docks-disclosure-and-keepalive.md) | Pending |
| 5 | [Integration proofs + validation](./phase-05-integration-proofs-and-validation.md) | Pending |

## Dependencies

- **Depends on (shipped):** Story 2.3 (interrupt/redirect Claude — the idle-await race exists),
  Story 2.11 (NEVER SENT recovery — #225), Story 2.13 (concurrent-operator ordering — #222).
- **Blocks:** nothing tracked; closes issue #192.
- **Out of scope (do not build):** configurable timeout (NFR6 fixed); rewiring the existing
  cancel-poll through the handle (shipped 2.3 behavior, 2.11 is its safety net); any E2E for
  expiry (the test plan scopes idle-await lifecycle to fake/small-duration timers, *"never a
  real 30-minute wait"*); a `delivered` message state (SDK-pinned, unchanged).

## Success Criteria

- [ ] Idle-after-interrupt with no activity for the injected timeout fails once with the exact
      string, emitting `node_failed` — never `node_completed`, never sets `nodeIdleTimedOut`,
      never logs "completed via idle timeout" (node **and** loop paths).
- [ ] A keepalive (or keystroke/focus) before expiry re-arms the timer; the node survives past
      the original deadline and fails only after a full fresh interval of inactivity.
- [ ] `Send now` after the interval drains and continues on the same session; a `Send now` that
      races expiry never yields a success receipt on a failed node (structural once-only).
- [ ] The cancel-poll still reaches an idle node with no live stream.
- [ ] Keepalive route matches the typed schema, honors the actor grant (starter/member/admin/
      identity-less allow; unauthenticated 401 when gated), returns 409 `node_finished` /
      422 `not_steerable_here`, and is idempotent + a no-op on a `generating` handle.
- [ ] Both docks disclose the 30-min limit and "typing keeps it open" as accessible text and
      fire the debounced keepalive on keystroke/focus **only** while idle (not on `Send now`,
      not from the finished-iteration dock).
- [ ] Queued-at-expiry messages surface as `NEVER SENT`; `workflow retry-node` re-runs with a
      fresh session.
- [ ] `bun run validate` passes; `@archon/web` imports nothing from `@archon/workflows`.

<!-- slug: issue-192-fail-abandoned-redirect-30min -->
