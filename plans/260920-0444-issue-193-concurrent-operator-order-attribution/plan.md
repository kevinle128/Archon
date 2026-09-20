---
title: 'Issue 193: preserve message order and attribution under concurrent operators'
description: 'Focused, test-first plan for the concurrent-operator receipt-order and attribution proof required by Story 2.13.'
status: pending
priority: P1
effort: '5 phases (~1 day)'
issue: 193
branch: archon/thread-1d25203e
tags: [issue-193, agent-node-room, epic-2, workflows, server, e2e, tests]
blockedBy: []
blocks: []
created: 2026-09-20
mode: deep
tdd: true
---

# Issue 193: preserve message order and attribution under concurrent operators

## Goal

Prove that two distinct operator identities can send overlapping guidance to
one live node without a lock, and that the one global order chosen by the
server survives unchanged through the shared queue and the executor-written
transcript. Every written row must retain the sender and caller message id that
belong to that message. A sibling node must receive only its own message and
sender, never any row from the target node.

This is a proof-and-harden story. The ordering, attribution, queue, transcript,
and display-name mechanisms already exist; production code changes are made
only if the focused tests expose a concrete violation.

## Product and design authority

- GitHub issue #193 delegates acceptance to Story 2.13 and requires focused
  characterization evidence plus the sprint-status transition.
- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`, Story 2.13,
  requires server receipt order, stable written order within each operator's
  stream, correct `operator_user_id` / `message_id`, matching display names,
  overlapping requests, and no cross-node or cross-user identity mix-up.
- `_bmad-output/planning-artifacts/epics-agent-node-room/implementation-readiness-report-2026-09-16.md`,
  EQ-10, identifies this as one missing happy-path integration criterion. It
  explicitly says authorization, duplicate-id, and terminal-race behavior are
  owned by earlier stories. Those cases are regressions, not new Story 2.13
  scope.
- Steering architecture AD-11 defines one process-local FIFO per
  `(runId, nodeId)`, no per-node lock, and attribution rather than
  serialization.
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` keeps the
  queue-read item shape at `{ message_id, message }`; sender identity is
  intentionally internal until the transcript read model.
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`,
  `DESIGN.md`, and `mockups/key-steering-dock.html` define the unchanged
  visual contract: `operator · <display name>`, full-strength text, and the
  `sent` badge on both Legacy and Console. This story adds no state, layout, or
  copy beyond those artifacts, and no mockup is co-located with this plan.

## Verified baseline

| Contract link       | Repository evidence                                                                                                                                                                | Existing coverage and the remaining gap                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry order      | `NodeSteeringHandle.accept()` synchronously appends to `pending`; `drain()` returns the array unchanged. Registry keys are `(runId, stepName)`.                                    | FIFO, drain, idempotency, run/node isolation, and `send_now` order are covered, but most fixtures use one hard-coded sender.                                |
| Request attribution | The send route resolves request identity, performs its awaited lifecycle gates, then synchronously calls `handle.accept()` with `requester?.userId ?? null`.                       | Starter/member/admin/identity-less cases are covered one request at a time. No test holds one identity request while another completes.                     |
| Queue read          | The route maps one handle snapshot to ordered `{message_id, message}` rows.                                                                                                        | Ordered shape and node scoping are covered. Sender fields must not be added.                                                                                |
| Executor transcript | Direct-node and loop paths drain the handle and call `appendOperatorTranscript`; that helper awaits one append per message in input order and passes both identity fields through. | The direct-node test already uses `op-a` and `op-b`; strengthen existing direct, idle `send_now`, and loop cases rather than adding parallel test matrices. |
| Read model          | Node-message reads batch only the requested rows' distinct sender ids and project a name per row.                                                                                  | The existing A/B/A test already proves matching display-name projection, including repeated senders. No new read-model test is needed.                      |
| Full chain          | `agent-queue-guidance.spec.ts` proves one sender from dock to transcript; `agent-queue-convergence.spec.ts` proves two identities and two-node queue isolation on both shells.     | No current journey launches the two docks together and then compares the pre-drain queue order with the final mixed-sender transcript.                      |

## Contract definitions used by the tests

- **Server receipt order** is the synchronous call order at
  `NodeSteeringHandle.accept()`. It is not browser click order, request creation
  order, a timestamp sort, or response completion order.
- **One operator stream** means one dock/request stream that waits for its
  prior send response before sending its next message. Two tabs for the same
  identity are separate streams; the server promises only receipt order across
  them.
- **No cross-user identity leakage** means a message is never stamped or
  displayed as the other sender. It does not mean users have private queues:
  the node queue is deliberately shared and visible to every permitted reader.
- The trusted-header seam and Better Auth session both resolve to canonical
  Archon user ids. Story 2.13 tests request-to-user binding; it does not reopen
  the already-covered authentication grant or harden proxy deployment.

## Scope

1. Add one mixed-sender registry characterization by extending existing tests.
2. Add one deterministic Hono-route concurrency test. Hold operator A at the
   identity-resolution seam, let operator B finish, release A, and prove the
   handle snapshot and queue-read response use that accept order while each
   message retains its request identity.
3. Strengthen existing executor tests so direct natural drain, idle
   `send_now`, and loop drain all assert mixed-sender order and metadata.
4. Extend the existing two-context/two-node Playwright spec with one
   end-to-end Story 2.13 journey on Legacy and Console. Two dock sends are
   launched together in two rounds; the observed pre-drain queue order becomes
   the oracle for transcript and DOM order after completion.
5. Record evidence, update the steering test plan, move the tracker entry to
   `done`, and run repository gates.

## Non-goals

- No new lock, per-user lane, timestamp sort, queue version, or ordering field.
- No schema, migration, OpenAPI, generated type, or queue-response change.
- No new authorization behavior, proxy hardening, interrupt attribution,
  withdraw audit row, delivery state, soft injection, or detached steering.
- No load test or multi-process guarantee. The registry is intentionally
  process-local and JavaScript execution makes each `accept()` mutation atomic.
- No new UI layout or copy. Existing two-shell visual behavior is regression
  coverage only.
- Do not add duplicate tests for malformed input, duplicate ids, terminal
  transitions, anonymous sends, display-name fallback, or queue visibility;
  those contracts already have focused coverage.

## Phases

| #   | Phase                                                                          | Deliverable                                                                   |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | [Registry characterization](./phase-01-registry-order-and-isolation.md)        | Minimal mixed-sender FIFO/idempotency/`send_now` assertions in existing tests |
| 2   | [Deterministic route concurrency](./phase-02-route-concurrency-integration.md) | One controlled overlapping-request test through the real Hono app             |
| 3   | [Executor transcript chain](./phase-03-executor-transcript-chain.md)           | Existing direct, idle, and loop tests strengthened for mixed senders          |
| 4   | [End-to-end two-operator journey](./phase-04-e2e-two-operator-journey.md)      | Real server/registry/executor/DB/read-model proof on both shells              |
| 5   | [Closeout and spec sync](./phase-05-closeout-and-spec-sync.md)                 | Evidence, test-plan mapping, tracker completion, full validation              |

Phases 1-3 diagnose individual links before Phase 4 proves the full chain.
Phase 5 runs only after the focused suite is green.

## Acceptance criteria

1. A deterministic route test starts operator A's request, proves it is held,
   completes operator B's request, releases A, and shows:
   - the handle order is B then A;
   - each item has the user id resolved for its own request;
   - queue GET returns the same id order and no attribution fields.
2. Existing executor tests prove mixed A/B batches preserve message order,
   `operator_user_id`, `message_id`, and the caused attempt for direct,
   `send_now`, and loop delivery paths.
3. One Playwright scenario per shell launches two identities' dock sends
   without awaiting one identity before starting the other, observes the
   authoritative queue order before drain, and proves after completion that:
   - transcript operator-row ids exactly equal that queue order;
   - each sender's two ids retain its dock order;
   - sender ids/display names match the originating identity;
   - the sibling node contains only its own message and sender;
   - both views render the same ordered rows and labels.
4. No public or persistent contract changes. Any production fix is
   cause-aligned, covered by a failing test first, and called out in the
   evidence report.
5. Focused Bun tests, E2E typecheck/scenarios, and `bun run validate` pass;
   the Story 2.13 test-plan entry names the final tests and sprint status is
   changed to `done` only after those gates pass.

## Files

| File                                                                                                     | Planned action                                                                                            |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/workflows/src/steering-registry.test.ts`                                                       | Modify existing cases for mixed senders; add at most one focused characterization test                    |
| `packages/server/src/routes/api.workflow-runs.test.ts`                                                   | Add one deterministic overlapping-request test; no route contract change expected                         |
| `packages/workflows/src/dag-executor.test.ts`                                                            | Strengthen three existing delivery tests; do not add a parallel executor matrix                           |
| `e2e/ui/agent-queue-convergence.spec.ts`                                                                 | Add the two-operator delivery journey using its existing contexts, rooms, queue helpers, and pair fixture |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`                                          | Map the concurrent-operator bullet to the final evidence                                                  |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                               | Move only Story 2.13 to `done`, after validation                                                          |
| `plans/260920-0444-issue-193-concurrent-operator-order-attribution/reports/characterization-evidence.md` | Create the final command/result report                                                                    |

Conditional production owners, only after a red test proves a defect:
`packages/workflows/src/steering-registry.ts`,
`packages/server/src/routes/api.ts`, or
`packages/workflows/src/dag-executor.ts`.

## Compatibility, operations, and rollback

- This is expected to be test/documentation-only. There is no rollout,
  migration, feature flag, backfill, or generated artifact.
- The queue remains process-local, shared per node, and unbounded exactly as
  before; this story introduces no new memory or latency path.
- Tests use bounded fixture delays and promise-controlled interleaving, never
  sleeps as the source of ordering truth.
- Rollback is a straight revert of the Story 2.13 tests and status/docs update.
  If production code changes become necessary, keep them in a separate focused
  commit so they can be reverted independently.

## Risks and mitigations

| Risk                                                                     | Mitigation                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A test accidentally proves request-start order instead of receipt order  | The route test blocks A before `accept()` and waits for B's 200 response before releasing A. The E2E test uses the actual queue snapshot as its order oracle.            |
| Browser requests are launched together but the scheduler serializes them | Deterministic overlap is owned by Phase 2; Phase 4 proves the real persisted chain against whichever order the registry chose.                                           |
| Header identities are mistaken for an authentication test                | The plan treats headers as the existing trusted identity seam and relies on the existing actor/gate matrix for authentication policy.                                    |
| The E2E pair node drains before the snapshot                             | Wait for both nodes to start, open only the two required rooms, launch two compact send rounds, and snapshot immediately; retain the existing 45-second bounded fixture. |
| New tests duplicate prior stories and become brittle                     | Modify existing direct/idle/loop cases, reuse the convergence spec and fixture, and omit already-covered error matrices.                                                 |

## Implementation completion check

Before marking the story done, review the result for product outcome,
architecture, public/internal contracts, identity integrity, performance,
test completeness, operations/rollback, and maintainability. The change is
complete only if every acceptance item above has direct passing evidence.

## Handoff

Implement on the current feature branch. Use focused conventional commits and,
when opening the PR against `develop`, use `.github/pull_request_template.md`
and include `Closes #193`.
