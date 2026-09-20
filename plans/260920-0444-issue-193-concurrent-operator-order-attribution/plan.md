---
title: 'Issue 193: preserve message order and attribution under concurrent operators'
description: 'Deep, test-first plan that proves and hardens the receipt-order and per-sender attribution chain (registry → route → executor rows → read model → both shells) for Story 2.13.'
status: pending
priority: P1
effort: '5 phases (~1.5d)'
issue: 193
branch: archon/thread-1d25203e
tags: [issue-193, agent-node-room, epic-2, workflows, server, e2e, test-coverage]
blockedBy: []
blocks: []
created: 2026-09-20
mode: deep
tdd: true
---

# Issue 193: preserve message order and attribution under concurrent operators

## Overview

Story 2.13 (`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:800-824`)
requires that when two distinct authenticated operators steer one live node at
the same time, the global order is the registry's server receipt order, each
operator's own stream keeps its written order, every executor-written operator
row carries the correct `operator_user_id` and `message_id`, the display-name
projection resolves the matching sender, and a concurrency integration test
proves registry order, queue order, transcript order, attribution, and the
absence of cross-node or cross-user identity leakage.

Scouting (see *Verified state of the code* below) shows the product mechanism
already exists after #207 (#181), #213 (2.9), #214 (#183) and #219 (2.8). No
new server ordering machinery is admissible: steering AD-11 explicitly forbids
a per-node steering lock ("operators are attributed, not serialized"). This
story is therefore a **proof-and-harden** story. Its deliverable is the chain of
tests that pins each link of the ordering/attribution invariant, any defect
those tests expose, and the closeout that records the evidence in
`steering-test-plan.md` and `sprint-status.yaml`.

## Outcome, constraints, non-goals, acceptance

**Outcome.** A repeatable, deterministic test chain exists at every layer that
carries an operator message, and it passes on the current code (or the code is
fixed until it does): registry accept order, HTTP route identity resolution,
executor drain and transcript writes, read-model display-name projection, and a
two-operator browser journey on both shells.

**Constraints.**
- No per-node steering lock, no server-side per-operator sequencing (AD-11).
- Per-stream order is a **client, per-dock-instance** property: each mounted
  composer gates its next `Queue` press on its own `sendInFlight`
  (`packages/web/src/lib/steering-dock.ts:32-37,156-162`, read by
  `ComposerDock.tsx:392` and `ConsoleComposerDock.tsx:398`). "Each operator's
  stream" in Story 2.13 therefore means one composer stream; the server
  promises accept order only, for every sender. The plan states this so nobody
  adds server-side per-operator sequencing (AD-11).
- No new table, migration, row kind, or metadata field (AD-6, Story 2.8).
- Tests must be deterministic: interleavings are controlled through awaited
  mock promises, never timers or races (`AGENTS.md` → Determinism).
- Never run root `bun test`; `bun run validate` is the pre-PR gate.
- `@archon/web` imports nothing from `@archon/workflows`.

**Non-goals.**
- Attribution on the queue-read shape. `steering-api-contract.md:38` fixes the
  queue read at `{ message_id, message }`; Story 2.9 asked for an ordered list
  only. Adding `operator_user_id` to that shape is a contract change outside
  this story.
- Attributing *interrupts* (who pressed Stop). The `interrupted` status row is
  unattributed today and Story 2.13's ACs speak only of messages.
- `delivered` status (G1), soft-inject (G2–G4), detached-run steering (AD-5).
- Ordering one identity's messages across **two of that identity's own tabs**.
  Two docks of the same operator have independent `sendInFlight` gates; the
  registry records receipt order (characterized by Phase 1 test 8), and no
  server-side per-identity lane is added.
- Hardening the identity **trust boundary**. `X-Archon-User` is trusted as
  identity source #2 (`api.ts:2499-2505`) and the steering routes' 401 gate is
  active only when web auth or the API gate is enabled
  (`api.ts:5345-5350`, `packages/server/src/auth/config.ts:25-27,94-96`). On a
  solo SQLite install any caller can label requests with arbitrary headers.
  That is the documented deployment boundary (`AGENTS.md` → "Config and
  provider metadata": the header is safe only behind a trusted proxy or on
  loopback); this story proves per-request binding of *whatever* identity the
  seam resolves, and Phase 5 records the boundary in the test plan.
- A durable audit row for **cross-operator withdraw**. AD-11 lets any
  authenticated member withdraw any queued item; today only a Pino log line
  records who removed whose message. See open question 2.

**Acceptance (mirrors the issue).**
1. Story 2.13 acceptance criteria satisfied with focused, deterministic tests
   at the registry, route, executor, read-model, and E2E layers.
2. Characterization evidence recorded under this plan's `reports/` and named in
   `steering-test-plan.md` → "Concurrent operators".
3. `sprint-status.yaml` entry
   `2-13-preserve-message-order-and-attribution-under-concurrent-operators`
   moved to `done`.
4. `bun run validate` green; touched Playwright specs green on Console and
   Legacy.

## Verified state of the code (scout results, 2026-09-20)

| Link in the chain | Where | What holds today |
|---|---|---|
| Receipt order | `packages/workflows/src/steering-registry.ts` `accept()` (line 290) | Fully synchronous; `pending.push` in call order; `drain()` returns that array; `send_now` on idle drains the whole pending batch in accepted order. Idempotency keyed on `message_id` for the handle's lifetime. |
| Identity per request | `packages/server/src/routes/api.ts:2469-2516` `resolveAuthContext` | Better Auth session first, then `X-Archon-User`; no module-level request state, so concurrent requests cannot swap identities. Send route stamps `operatorUserId: requester?.userId ?? null` (`api.ts:5424-5435`). |
| Executor writes | `dag-executor.ts` ~3699 (direct drain), ~3574 (`send_now` wake), ~7447 (loop drain); rows via `appendOperatorTranscript` (`node-transcript.ts:70-91`) | One `text` row per drained message, in array order, metadata `{origin:'operator', operator_user_id, message_id}` plus execution scope. Rows are written at the first stream chunk of the caused turn. |
| `seq` | `packages/core/src/db/workflow-node-messages.ts` | `MAX(seq)+1` inside a transaction per `(run, node)`, one retry on the adopted unique race — order is per node, so cross-node writes cannot interleave a node's seq. |
| Read model | `api.ts:5842-5964` | Distinct sender ids batched once per response; trimmed display name or 8-char short id; `null` only for identity-less rows. |
| Lazy user creation | `packages/core/src/db/users.ts:99-170` | UNIQUE-race recovery on concurrent first sight — a new teammate hitting send and the queue poll at once resolves to one user. |
| Existing coverage | `steering-registry.test.ts` (single `user-1` only), `api.workflow-runs.test.ts:6664+` (actor matrix, one request at a time), `dag-executor.test.ts:26646` (op-a/op-b drained in one turn), `:27432` (send_now drain order), `api.workflow-runs.test.ts:3501` (A/B/A display names), `e2e/ui/agent-queue-guidance.spec.ts` (single operator) | No test overlaps two identities' requests, none proves cross-node/cross-user non-leakage, none drives two identities through the UI to attributed rows. |

Evidence helper for the implementer: run any suspect unit file with
`ARCHON_HOME=$(mktemp -d)` and confirm no `archon.db` appears.

## Phases

| # | Phase | Status | Owns |
|---|-------|--------|------|
| 1 | [Registry order and isolation](./phase-01-registry-order-and-isolation.md) | Pending | `steering-registry.test.ts`, `node-transcript.test.ts` (+ any registry fix) |
| 2 | [Route concurrency integration](./phase-02-route-concurrency-integration.md) | Pending | `api.workflow-runs.test.ts` send/queue blocks (+ any route fix) |
| 3 | [Executor transcript chain](./phase-03-executor-transcript-chain.md) | Pending | `dag-executor.test.ts` #181/#183 describes, read-model cross-node test (+ any executor fix) |
| 4 | [E2E two-operator journey](./phase-04-e2e-two-operator-journey.md) | Pending | new `e2e/ui/agent-concurrent-operators.spec.ts`, fixture if needed |
| 5 | [Closeout and spec sync](./phase-05-closeout-and-spec-sync.md) | Pending | `steering-test-plan.md`, `sprint-status.yaml`, evidence report, validate |

Deep mode: Phase 1 is fully detailed. Phases 2–5 are concrete but each begins
with a bounded scout pass (listed in the phase) that the executor runs before
editing, because line anchors in `api.ts`/`dag-executor.ts` drift.

## Dependency map

```
Phase 1 (registry + transcript writer)  ──▶  Phase 2 (route → registry)  ──▶  Phase 3 (executor → rows → read model)
                                                                                      │
                                                                                      ▼
                                                                          Phase 4 (browser: both shells)
                                                                                      │
                                                                                      ▼
                                                                          Phase 5 (evidence, spec, sprint status)
```

Phases 1–3 are independent in file ownership and could run in parallel, but the
recommended order is sequential so a defect found at a lower layer is fixed
before the higher layer asserts on it.

## Test scenario matrix (critical / high / medium)

| Tier | Scenario | Layer(s) |
|---|---|---|
| Critical | Interleaved accepts from operators A and B → queue equals accept order; A's and B's subsequences preserved; `drain()` identical | 1 |
| Critical | Two identities' overlapping HTTP sends → every queued item carries the header identity that sent it; queue GET order equals registry order | 2 |
| Critical | Executor drains a mixed A/B batch → rows in `seq` order equal receipt order with matching `operator_user_id` + `message_id`; caused-turn `attempt_id` | 3 |
| Critical | Cross-node: sends to `node-a` and `node-b` never appear on the other node's handle, queue, or rows | 1, 2, 3, 4 |
| High | Cross-user idempotency: B replays A's `message_id` → original receipt, stored `operatorUserId` stays A, no second item | 1, 2 |
| High | Identity-less request between two identified requests → `null`, never the neighbour's id | 2 |
| High | Idle `send_now` by B after A queued while idle → batch `[A, B]` in receipt order, both attributed | 1, 3 |
| High | Loop node (`executeLoopNode`) mirrors the direct-node A/B ordering and attribution | 3 |
| High | Read model: node A's senders never leak into node B's `/messages` response | 3 |
| High | Browser: starter + teammate on Console and Legacy → `operator · e2e-starter` / `operator · e2e-hitl-teammate` rows in receipt order | 4 |
| High | Node finishes while operator A's request is in flight after B's landed → A gets 409, B's item intact | 2 |
| High | Two never-seen identities resolve concurrently in reverse completion order → each item bound to its own header | 2 |
| Medium | Same identity across two streams → receipt order, no per-identity lane (characterization) | 1 |
| Medium | Duplicate concurrent send of the same `message_id` by the same operator → one item | 2 |
| Medium | Per-tab `sendInFlight` gate documented as the per-operator order mechanism (existing `steering-dock.test.ts:245-262`) | 1 (doc only) |

## File inventory

| File | Action | Size | Test impact |
|---|---|---|---|
| `packages/workflows/src/steering-registry.test.ts` | modify | +~120 lines | new `describe('concurrent operators')` |
| `packages/workflows/src/node-transcript.test.ts` | modify | +~30 lines | mixed-sender attribution row test |
| `packages/workflows/src/steering-registry.ts` | modify only if Phase 1 exposes a defect | 0–20 lines | — |
| `packages/server/src/routes/api.workflow-runs.test.ts` | modify | +~180 lines | new `describe('send/queue — concurrent operators (Story 2.13)')` |
| `packages/server/src/routes/api.ts` | modify only if Phase 2/3 exposes a defect | 0–20 lines | — |
| `packages/workflows/src/dag-executor.test.ts` | modify | +~200 lines | 4 new `it` blocks in #181 and #183 describes |
| `packages/workflows/src/dag-executor.ts` | modify only if Phase 3 exposes a defect | 0–20 lines | — |
| `e2e/ui/agent-concurrent-operators.spec.ts` | create | ~350 lines | 2 parameterized journeys |
| `e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml` | modify only if the fake provider does not drain guidance on it | ≤5 lines | — |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` | modify | +~10 lines | names the tests |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify | 1 line | — |
| `plans/260920-0444-issue-193-concurrent-operator-order-attribution/reports/` | create | evidence | — |

## Risks

| Risk | Mitigation |
|---|---|
| A route-level "concurrency" test that depends on scheduler timing is flaky on CI | Phase 2 controls interleaving with an **identity-keyed gate** on `findOrCreateUserByPlatformIdentity` (the handler's first awaited seam, whose argument is the header) and waits on request *responses*, never on resolver indices; the assertion is "queue order == accept order" recorded by `spyOn(NodeSteeringHandle.prototype, 'accept')` (requires adding a value import — the class is type-only imported today). |
| Phase 4's order check compares two outputs of the same registry array | Phase 4 is scoped as the rendering/attribution proof; the order-causality proof lives in Phases 1–2. The spec also checks each context's ids against that context's independently recorded send-completion order. |
| Lazy per-header user creation (`api.ts:2504`, `users.ts:99-136`) has no cap on ungated installs | Adjacent exposure of the same trust boundary as the non-goal above; noted for the test-plan sync, not changed here. |
| `mock.module` merge semantics silently un-mock a newly imported export | Phases 2–3 extend existing test files that already mock `@archon/core/db/*`; no new module imports are introduced in production code. |
| E2E teammate identity has no seeded display name | Lazy creation stores the header as `display_name`; the expected DOM label is `operator · e2e-hitl-teammate`. Phase 4 asserts exactly that and documents why. |
| The pair fixture (`delayMs` only) may not run a second provider turn | Phase 4 scout step confirms; otherwise a dedicated `e2e-concurrent-operators.yaml` fixture with two `emitTool` delayed nodes is added and registered in `archon-runtime.ts`. |
| Best-effort attribution: header present but user lookup failed → `null` (`api.ts:2506-2515`) | Out of scope for ordering; recorded as an open question below, not changed silently. |

## Success criteria

- [ ] Every scenario in the matrix has a named, passing test.
- [ ] `cd packages/workflows && bun test src/steering-registry.test.ts src/node-transcript.test.ts` green.
- [ ] `cd packages/server && bun test src/routes/api.workflow-runs.test.ts` green.
- [ ] `cd packages/workflows && bun test src/dag-executor.test.ts` green.
- [ ] `cd e2e && npx playwright test agent-concurrent-operators` green on Console and Legacy.
- [ ] `bun run validate` green.
- [ ] `steering-test-plan.md` "Concurrent operators" names the tests; `sprint-status.yaml` 2-13 is `done`.

## Open questions (non-blocking)

1. Best-effort attribution on lookup failure (`api.ts:2506-2515`) writes an
   identity-less row when the header *was* present. For an audit trail this is
   arguably a misattribution. Keep (documented soft seam) or fail the send with
   503? Default for this plan: keep, and add a test documenting the behavior.
2. Cross-operator withdraw leaves no durable trace (`api.ts` withdraw handler,
   log event `api.workflow_node_withdraw_completed` only). Options: (a) accept
   as the AD-11 grant and record it in the test plan (this plan's default);
   (b) a follow-up story adding a `status`-kind transcript row for withdraws
   (new metadata, out of 2.13's scope). Decision belongs to the owner; the
   plan does not change the route.

## Red Team Review

### Session — 2026-09-20
**Reviewers:** Security Adversary (S), Failure Mode Analyst (F), Assumption Destroyer (A)
**Findings:** 17 raised → 15 distinct after de-duplication (14 accepted, 1 rejected)
**Severity breakdown (as raised):** 2 Critical, 5 High, 10 Medium

| # | Finding | Severity | Disposition | Applied to |
|---|---------|----------|-------------|------------|
| S1 | Attribution rests on a client-forgeable header on ungated solo installs | Critical | Accept (scope/documentation) — deployment boundary already documented in `AGENTS.md`; recorded as non-goal + risk + test-plan line; no product gate added (would contradict the AD-11 identity-less-run allowance) | plan.md non-goals/risks, Phase 5 |
| S2 / F3 | `NodeSteeringHandle` is a type-only import; `spyOn(...prototype)` needs a value import | High | Accept | Phase 2 scout 5, step 2 |
| S3 | Cross-operator withdraw has only log-level attribution | High | Accept (surface to owner) — open question 2; test 7 kept as characterization | plan.md, Phase 5 |
| S4 | Lazy user creation reachable unbounded on ungated installs | Medium | Accept (note only) | plan.md risks |
| S5 | Phase 1 anchors drifted ~30 lines | Medium | Accept | Phase 1 context links + scout step |
| F1 | Call-order-indexed deferred `getWorkflowRun` cannot distinguish A from B; microtask choreography unspecified | Critical | Accept — redesigned to an identity-keyed gate on `findOrCreateUserByPlatformIdentity`, waiting on responses | Phase 2 key insights, tests 1/9/10, helper |
| F2 | Cross-node test hedged its expected order | High | Accept — asserts only deterministic invariants | Phase 2 test 6 |
| F4 | Phase 3 test 3 inherits the polling `awaitIdle()` | High | Accept — await the `interrupt()` settlement promise instead | Phase 3 test 3 |
| F5 | Call-count mitigation does not cover slot drift | Medium | Accept — superseded by the identity-keyed gate | Phase 2 risk |
| F6 | Seam count inconsistency (4 vs 5) | Medium | Accept | Phase 2 scout 3 |
| A1 | "Per-operator" order is really per dock instance | High | Accept — constraint reworded, non-goal added, Phase 1 test 8 characterizes | plan.md, Phase 1 |
| A2 | E2E order proof is self-referential | Medium | Accept — phase scoped as rendering/attribution proof; independent per-context check added | Phase 4 |
| A3 | Two never-seen identities racing first sight untested | Medium | Accept (modified) — route-level reverse-release test; DB-level has no shared UNIQUE key, documented | Phase 2 test 10 |
| A4 | Teammate label could depend on spec order | Medium | Reject — every path creates the teammate with the header as display name, so the label is order-independent; a precondition note was added anyway | Phase 4 scout 2 |
| A5 | Mid-flight termination race between two operators untested | Medium | Accept | Phase 2 test 9 |
| A6 | Soft-inject will invalidate prompt-join assertions | Medium | Accept (note) | Phase 3 requirements, Phase 5 |
| — | (F1 duplicate of S2 on import; S1 partially overlaps S4) | — | Deduplicated | — |

Rejected without merit evaluation: none (every finding carried `file:line`
evidence). Rejected on merit: A4 (see rationale).

### Whole-Plan Consistency Sweep
- Decision delta: "per-operator order" → "per-dock-instance order" (plan.md
  constraints, Phase 1 insight/test 8/step 5, Phase 4 insight); deferred
  `getWorkflowRun` → identity-keyed gate (Phase 2 key insights, tests 1/9/10,
  helper name, risk, success criteria); `awaitIdle` → `interruptOutcome`
  promise (Phase 3 test 3); Phase 2 test count 8 → 10 (todo, steps).
- Grep for stale terms after edits: `deferredWorkflowRunLookups`, "resolve
  B's two lookups", "awaits four seams", "per-operator stream order is a
  client property" → none remain in any plan file.
- No contradictions remain; the plan is ready for implementation.

## Validation Log

### Session 1 — 2026-09-20
- Verification pass: carried by the red-team session above (three reviewers
  with Fact Checker / Flow Tracer / Scope Auditor roles; every finding cited
  `file:line`). Failures surfaced and corrected: stale Phase 1 anchors,
  type-only `NodeSteeringHandle` import, seam count. No `[UNVERIFIED]` tags
  remain.
- Interview: not run. The plan was produced in an autonomous job (issue → plan
  → advisor review → handoff). The two owner decisions it surfaced are
  non-blocking and carry stated defaults (open questions 1 and 2); the
  implementer should raise them in the PR body rather than change routes.
- Task hydration: no live task-management surface is exposed in this
  session; the `ak plan` store indexes the phase files (`ak plan status`
  reports 0/5 phases, 0/23 tasks) and is the tracker for `/ak:cook`.

## Handoff

Execute with `/ak:cook plans/260920-0444-issue-193-concurrent-operator-order-attribution/plan.md`.
Feature branch off `develop`; PR body from `.github/pull_request_template.md`
with `Closes #193`.
