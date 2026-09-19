---
title: 'Issue 182 withdraw a queued guidance message'
description: 'Implementation-ready plan for an idempotent queued-guidance withdraw route and an accessible delete control in both node-room shells.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/182'
branch: archon/thread-1889047a
tags: [issue-182, agent-node-room, workflows, server, web, e2e, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
mode: deep
---

# Issue 182 withdraw a queued guidance message

## Outcome

An operator can delete guidance that is still waiting in a live or parked
process-local node queue. Each locally known queued row in the Legacy and
Console node rooms receives a message-specific `delete` control backed by:

`DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId`

Pending items are excluded from the next provider turn. Already-drained and
never-seen valid ids return the same idempotent
`{ success: true, message_id }` response. Contract refusals never mutate the
queue or transcript, terminal handles cannot be changed through a race, and
keyboard focus moves predictably after a row disappears.

Story 2.1 is implemented in the current tree and PR #207 is merged, so Issue
#182 has no remaining blocker.

## Scope

Included:

- one synchronous, closed-safe `NodeSteeringHandle.withdraw(messageId)`;
- the bodyless typed DELETE route, OpenAPI schemas/generated web types, nested
  errors, and a public-contract clarification for parked retained queues;
- the per-row control and shared state/focus rules in both web shells;
- focused registry/server/component tests, real delivery-exclusion E2E on both
  shells, visual/accessibility evidence, and issue closeout.

Excluded:

- the UX spine's undefined `keep` action; Issue #182 and the API contract
  define only delete/withdraw, so no no-op behavior is invented;
- Stop/interrupt/keepalive/`Send now`, operator transcript rows, queue reads,
  cross-tab convergence, finished-iteration projection, and terminal
  `NEVER SENT` restoration (Stories 2.3–2.11);
- persistence, migrations, workflow events, executor drain changes, automatic
  retries, new dependencies, or correction of the stale `2-1` tracker entry.

## Verified repository evidence

- Story 2.2 and GitHub issue #182 require live removal, idempotent no-op
  success, mutation-free contract errors, and message-specific accessible
  naming/focus.
- `steering-api-contract.md` defines the exact path, bodyless request,
  response, nested error family, and drain/unknown-id idempotency.
- `steering-registry.ts` separates pending items from full-lifetime accepted-id
  memory; parked handles retain their queues and terminal handles seal before
  awaited terminal persistence.
- The send route/tests provide auth-before-validation, the target ladder, final
  run re-read, and the critical precedent where a handle closes during that
  await. Projected terminal node states are `completed`, `failed`, and
  `skipped`; cancellation is a run status.
- Both dock renderers already share `steering-dock.ts` while keeping
  shell-owned request layers. Console isolation forbids Legacy runtime imports.
- `EXPERIENCE.md`/`DESIGN.md` require one-line end elision, identical shell
  anatomy, a padded 24×24 per-item target, message-specific naming, and focus
  that never falls to `<body>`. The illustrative steering mockup predates
  those controls; `reconcile-live-steering.md` says the spines win.
- The existing 30-second E2E fixture and fake-provider `echoPrompt` can prove
  that only the non-withdrawn sibling reaches the resumed provider turn. The
  E2E package has no axe dependency, so no axe/live-screen-reader pass will be
  claimed unless one is actually run.

## Decisions that constrain implementation

1. Withdraw removes only `pending`; it never deletes accepted-id memory or
   resurrects a replayed send.
2. Live and parked queues are withdrawable. Closed handles are immutable and
   return 409.
3. After the final run-state await, the route rechecks the handle phase, then
   synchronously withdraws with no intervening await. This closes the
   terminal-handle race the original draft missed.
4. If drain happened first, DELETE is a 200 no-op and the message may already
   be in the provider turn. The wire response does not reveal the race winner.
5. Auth middleware precedes UUID path validation so gated unauthenticated calls
   return 401 before 400. Unknown valid message ids remain 200.
6. Mirror the send ladder inline. Two differing callers do not justify a shared
   target abstraction; declare the new handler's 500 response in OpenAPI.
7. The UI stays response-driven and local. It allows one withdraw request at a
   time per dock, while Queue/send remains independent.
8. Success focus is next delete → previous delete → textarea. Ordinary failure
   retains row/focus; a 422 focuses the detached alert. No path returns focus to
   `<body>`.
9. Visible text is `delete`; the accessible name begins with it and identifies
   the trimmed message. The action sits after `sent`, remains at least 24×24,
   and never prevents the message from end-eliding.
10. The linear pending-array search is retained. A second index or durable
    structure is unnecessary for the existing per-handle queue.

## Delivery phases

| #   | Phase                                                                                     | Depends on             |
| --- | ----------------------------------------------------------------------------------------- | ---------------------- |
| 1   | [Registry primitive, contract clarification, and typed DELETE route](./phase-01-start.md) | —                      |
| 2   | [Delete control in both web shells](./phase-02-web-delete-control-in-both-shells.md)      | Phase 1 generated type |
| 3   | [End-to-end evidence and closeout](./phase-03-e2e-evidence-and-closeout.md)               | Phases 1–2             |

## Acceptance criteria

- [ ] Registry removal preserves order, phase, accepted memory, and replay
      idempotency; parked removal succeeds and closed removal is mutation-free.
- [ ] Exact 200 is returned for removed, repeated, drained, and never-seen valid
      ids.
- [ ] Auth/validation precedence and 401/400/404/409/422/500 nested errors match
      the contract. Refusal paths change no queue snapshot or transcript/run
      writer.
- [ ] Both a terminal final run re-read and a handle closing during that await
      return 409 without removing the queued item.
- [ ] Both shells issue one bodyless DELETE for the selected id, remove only
      that row on 200, retain it on ordinary failure, and preserve concurrent send.
- [ ] Every row has a native message-named `delete` button with a 24×24 target,
      correct shell focus ring, honest `aria-disabled` pending state, and no
      long-row overflow at required viewports.
- [ ] Focus follows next → previous → field after success, stays on the row
      after ordinary failure, and moves to the detached alert after 422.
- [ ] Both-shell E2E proves a withdrawn item does not reach the provider while a
      sibling does, and that deleting an only item yields no resumed echo.
- [ ] Focused tests, E2E typecheck/regressions, and `bun run validate` pass.
      Acceptance evidence records exact results and limitations.
- [ ] Only after gates pass, `2-2-withdraw-a-queued-guidance-message` is changed
      to `done`, committed, and included in a `develop` PR with `Closes #182`.

## Validation summary

Run the focused commands specified in each phase, then:

```bash
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'withdraw|queue guidance'
bun run validate
```

Never run bare `bun test` at the repository root. Type generation must use a
server owned by this worktree on a checked free port; never stop or consume a
server owned by another session.

## Compatibility, security, rollback, and residual risk

- The API/internal changes are additive; there is no migration, durable state,
  event, or dependency change. Reverting the feature PR restores Story 2.1.
- Steering keeps the ratified broad actor grant. The success log includes the
  resolved operator id (or null), target/message ids, and `removed` boolean,
  never operator message content.
- A 200 cannot tell the UI whether DELETE beat drain. Cross-tab state also
  remains stale until Story 2.9; both limits must be recorded, not papered over
  with polling or inferred delivery.
- Parked queues remain process-local and inherit Story 2.1's restart and
  cross-process limitations. No staleness timer or autonomous lifecycle
  mutation is added.

## Open questions

None. The only apparent design conflict—the UX spine's separate `keep`
control—is resolved by the issue/API authority and remains outside this story.

<!-- slug: issue-182-withdraw-queued-guidance-message -->
