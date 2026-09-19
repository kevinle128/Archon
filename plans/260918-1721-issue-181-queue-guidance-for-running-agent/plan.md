---
title: 'Issue 181 queue guidance for a running agent'
description: 'Implementation-ready plan for Story 2.1: accept queued guidance, preserve the current turn, and deliver it at the next natural boundary on the same provider session.'
status: pending
priority: P1
effort: '4 phases'
issue: 'https://github.com/kevinle128/Archon/issues/181'
branch: archon/thread-37c215a0
tags: [issue-181, agent-node-room, workflows, server, web, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
revised: 2026-09-19
---

# Issue 181 queue guidance for a running agent

## Outcome

While an in-process agent node is generating, an operator can submit guidance with `Queue` or `Cmd`/`Ctrl`+`Enter` without interrupting the current turn. The server accepts the message immediately into a process-local queue keyed by `(runId, namespacedNodeId)`. At the next natural turn boundary, the executor delivers all waiting messages in server receipt order as one follow-up turn on the same provider session. The node remains `running` until the final turn completes.

Both Legacy and Console node rooms show the Story 2.1 dock states and locally accepted `sent` receipts. Unsent text remains tab-local. Detached execution, invalid targets, terminal nodes, invalid requests, and unauthenticated callers receive the canonical typed refusal without mutating the node, queue, or transcript.

## Scope boundary

This plan implements Story 2.1 and only the infrastructure it needs:

- an in-process live-handle registry;
- natural-boundary delivery for direct AI nodes, AI loop nodes, and prompt nodes inside loop groups;
- the existing canonical `POST .../send` contract;
- the Queue composer and its generating, blocked, error, and post-422 detached states in both shells.

The following belong to later accepted stories and are deliberately excluded:

- withdraw/delete (2.2), Stop/interrupt/idle-after-interrupt (2.3), provider-specific soft injection (2.4–2.7);
- operator transcript rows and delivered reconciliation (2.8);
- a queue-read/live-update contract, cross-tab or cross-operator convergence, and queue rehydration after navigation (2.9);
- finished-iteration queue projection (2.10) and terminal `NEVER SENT` restoration (2.11).

There is no schema migration, durable steering state, new workflow event, operator transcript row, or documentation change to the already-complete steering API contract.

## Evidence checked

| Evidence                                                                                            | Verified implication                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue #181 and Story 2.1 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`        | The user outcome is queue-at-natural-boundary; the issue adds no requirements beyond the story.                                                                                                                                             |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`                                  | Story 2.1 implements `POST .../send`, its nested error schema, actor grant, idempotency, and status codes. The contract has no GET queue route and no queue, id-memory, or message-size caps.                                               |
| Story 2.9 in the same epic                                                                          | Shared queue reads/convergence are explicitly later scope and depend on Stories 2.1 and 2.2.                                                                                                                                                |
| `_bmad-output/specs/spec-agent-node-room/engine-integration.md`, `SPEC.md`, and `control-states.md` | Steering is process-local; web-dispatched execution is reachable, detached CLI execution is not; natural delivery reuses the live provider session and must not touch Cancel's node-level abort controller.                                 |
| `packages/workflows/src/dag-executor.ts` and tests                                                  | `executeNodeInternal` and `executeLoopNode` have separate send/re-ask/completion flows. `batchMessages` resets per pass, the provider session id arrives on the `result` chunk, and the loop path lacks a function-level cleanup `finally`. |
| `packages/workflows/src/retry-state.ts`, server workflow-run routes/tests, and auth helpers         | Node state is projected from workflow events; route authorization and target resolution must occur before synchronous queue mutation.                                                                                                       |
| Legacy/Console node-room components and tests                                                       | Both rooms already own a transcript scroller and pending-ask selection; the dock belongs after the scroller/jump control as a fixed sibling.                                                                                                |
| Final `EXPERIENCE.md`, `DESIGN.md`, accessibility review, and co-located mockups                    | Final design prose overrides stale mock details: the queue is a full-bleed elevated band, controls are bordered in both shells, detached copy is exact, and the blocked send remains focusable with `aria-disabled`.                        |
| `packages/providers/src/e2e-fake`, E2E runtime/specs, and package scripts                           | The fake supports delays and resumable sessions but needs an opt-in echo scenario; a web-dispatched run is required for a positive E2E; test scripts are explicitly enumerated and root `bun test` is forbidden.                            |
| Repository governance and git state                                                                 | Feature PRs target `dev`, not the remote's current default `develop`; the working tree was clean at review time.                                                                                                                            |

## Design decisions

1. **Process singleton in `@archon/workflows`.** The server and web-dispatched executor share one process. A registry keyed by `(runId, stepName)` is the smallest correct seam and matches the accepted architecture. `stepName` is the namespaced id already used by transcript routes and loop-group bodies.
2. **Synchronous last gate.** The live handle has `live`, `parked`, and `closed` phases. A final empty-queue check and close happen synchronously in one method; enqueue is also synchronous. This prevents a successful receipt after the executor has committed to teardown.
3. **Full-lifetime idempotency.** Every accepted `message_id` and its original receipt remains remembered until that execution's handle is unregistered, including after delivery. No FIFO eviction may invalidate the contract. A reused id with different prose replays the original receipt and logs metadata only, never message content.
4. **No invented public bounds.** The canonical contract defines only a non-empty message and UUID id. This plan does not add undocumented 16k/50/500 limits or a new error case. Memory exposure lasts only for the live handle; any future hard limit requires an explicit contract decision that preserves idempotency.
5. **Follow-up turn, not prompt reconstruction.** Waiting messages are joined verbatim with `\n\n` in receipt order and passed directly as the next prompt. They are not run through workflow `$ref` substitution. The turn resumes only a session id positively returned by the immediately preceding turn.
6. **Missing session id is a node failure when delivery is pending.** The executor checks pending count before removal. If guidance is waiting but the provider returned no resumable session id, it fails clearly and leaves the queue intact for terminal discard logging; it never drains then silently completes or starts a fresh session.
7. **Existing terminal semantics precede delivery.** Structured-output re-ask settles first. Each turn preserves current idle-timeout, Cancel, batch flush, credit-exhaustion, and empty-output behavior before a queue drain. Cancel, credit exhaustion, or empty output therefore cannot be bypassed by queued work; an idle-timeout end is not treated as a natural boundary.
8. **Park only for resumable pauses.** AskHuman and an interactive loop gate park the handle without losing accepted guidance. Resume re-registers the same handle. Every executor terminal path closes/unregisters in `finally`; the central run-cancel transition also discards handles for that run so cancelling a paused node cannot leak a parked queue. Cleanup logs counts—not message text—when later-story reconciliation is not yet available.
9. **Run state is checked before mutation.** The send handler loads the run and projected node state before using the registry. A terminal run/node returns 409 even if a stale live handle exists; an unknown target returns 404; a non-terminal target without a live handle returns 422. The final `enqueue` has no intervening `await`.
10. **POST-only staged UI.** Story 2.1 displays receipts accepted in the current mounted tab; it does not poll an uncontracted read route. They remain labelled `sent` until the room leaves the live execution. A 422 changes the dock to the exact detached disclosure and preserves the draft in `sessionStorage`. Story 2.9 will add authoritative queue projection and cross-view convergence.
11. **One lifecycle occurrence.** Drained turns do not emit another `node_started` or a steering event. They rotate only transcript attempt scope as existing re-asks do, accumulate usage, and produce one final node completion/failure.

## Delivery phases

| #   | Phase                                                                             | Depends on |
| --- | --------------------------------------------------------------------------------- | ---------- |
| 1   | [Engine: registry and natural-boundary drain](./phase-01-start.md)                | —          |
| 2   | [Server: typed send route](./phase-02-server-send-and-queue-routes.md)            | Phase 1    |
| 3   | [Web: Queue dock in both shells](./phase-03-web-composer-dock-both-shells.md)     | Phase 2    |
| 4   | [E2E, visual verification, and closeout](./phase-04-e2e-evidence-and-closeout.md) | Phases 1–3 |

## Contract and compatibility summary

- Public API: implement the already-ratified send request, success response, nested error body, and exact status codes. Do not add `GET .../queue` or modify the canonical contract.
- Internal API: export a narrow registry subpath from `@archon/workflows`; no package dependency inversion.
- Persistence: none. Server restart or process loss drops live steering by accepted v1 design.
- Provider compatibility: register only when `sessionResume` is supported; otherwise a live-looking target is refused with 422 rather than receiving unsafe fresh-session behavior.
- Existing workflows: when no guidance is queued, output, events, batching, usage, retries, Cancel, AskHuman, loop completion, and provider options remain behaviorally identical.
- Terminal cleanup: the existing central cancel write keeps its database semantics and additionally drops same-process live/parked handles only after the terminal write succeeds; it never changes workflow state based on queue age.
- Rollout/rollback: one focused code change with no data migration or flag. Reverting the PR restores prior behavior; any in-memory handles disappear with the process.

## Phase-wide validation

Run focused suites first, then package gates, then repository validation. Never run `bun test` from the repository root.

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts -t 'queued guidance')
(cd packages/core && bun test src/db/workflows.test.ts -t 'steering handle cleanup')
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'queued guidance')
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'queue guidance'
bun run validate
```

## Acceptance criteria

- [ ] Generating dock: both shells show an enabled textarea, bordered `Queue` control, tab-local label, and no empty queue band.
- [ ] Accepted sends: button and guarded shortcut send the original non-blank text once; the local band shows receipts in acceptance order with `sent`; the current provider call and tool execution are untouched.
- [ ] Natural boundary: direct, loop, and loop-group-body AI nodes drain waiting messages in receipt order as one next turn using the immediately prior session id; the node remains running and emits one lifecycle occurrence.
- [ ] Idempotency: a duplicate id before or after drain replays its original receipt and never creates a second entry; memory lasts for the handle lifetime.
- [ ] Refusals: the actor matrix and 400/404/409/422 cases match the canonical contract and leave run state, handle snapshot, and transcript writers unchanged.
- [ ] Blocked state: the ask-parked dock uses `aria-disabled` and an associated reason; click and shortcut share the same guard; plain Enter remains a newline and IME composition never submits.
- [ ] Failure integrity: missing session id with pending guidance fails explicitly; terminal cleanup warns by count; no accepted message is silently treated as delivered.
- [ ] Visual/accessibility: required states pass the phase 3 viewport, focus, live-region, contrast, list-semantics, and reduced-motion checks in both shells.
- [ ] All focused suites and `bun run validate` pass without weakening existing assertions.
- [ ] Closeout uses the PR template, targets `dev`, includes `Closes #181`, and moves sprint status only through its owning workflow after all gates pass.

## Residual risks and operational notes

- The process-local queue is intentionally lost on server restart, and detached child processes are intentionally unreachable. The UI discloses the latter after the canonical 422; cross-tab recovery is later scope.
- A paused web run manually resumed or terminally mutated from a different OS process cannot transfer its parked in-memory queue back to the server process. This is the same accepted process boundary as restart/detach. Same-process Cancel is explicitly cleaned; cross-process cleanup occurs when the owning process next observes teardown or exits, without a speculative staleness timer.
- Until Stories 2.8/2.9/2.11, this tab cannot observe delivery or reconstruct accepted receipts after reload. It must never claim `delivered`; terminal restoration is not fabricated here.
- The contract currently has no per-message or per-handle hard limit. The implementation must not invent one, but the memory consequence should be recorded in the PR for a separate product/API decision if operational evidence requires a bound.
- Broad steering authorization is an explicit contract decision. Store attribution on the internal queue item, never expose it in a new queue-read response, and never log operator prose.
- Starting a server to regenerate OpenAPI types requires checking port 3090 first, tracking the exact PID, and stopping only the process started for this worktree.

<!-- slug: issue-181-queue-guidance-for-running-agent -->
