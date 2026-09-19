---
phase: 3
title: 'E2E evidence and closeout'
status: pending
priority: P1
effort: '1 session'
dependencies: [1, 2]
---

# Phase 3: E2E evidence and closeout

## Goal

Prove end to end, on both shells, that a withdrawn message never reaches the agent while a sibling still drains; exercise the withdraw route ladder against the live server; capture the accessibility evidence the story asks for; then close the issue through a `develop`-targeted PR and the sprint-status move.

> Deep mode: scout before executing. Re-read `e2e/ui/agent-queue-guidance.spec.ts` (helpers `trackSendRequests`, `queueList`, `guidanceField`, `waitForNodeStarted`, `listNodeMessages`, `sendPathname`, evidence writer) and `e2e/lib/playwright/archon-runtime.ts` (`startWorkflowViaWeb`, `startDetachedWorkflow`, `starterFetch`, `waitForRunStatus`) at cook time.

## Context links

- Story AC (all four groups) and `steering-test-plan.md:54,73`.
- `e2e/ui/agent-queue-guidance.spec.ts` (Story 2.1 spec — the withdraw spec mirrors its structure and reuses its helpers).
- `e2e/fixtures/workflows/e2e-queue-guidance.yaml` (30 s fake-provider delay — the withdraw window).
- `packages/providers/src/e2e-fake/provider.ts` (`echoPrompt` scenario: the resumed-echo chunk reveals exactly which text drained).
- `.github/pull_request_template.md`; `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:69`.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `e2e/ui/agent-withdraw-guidance.spec.ts` | create | ~350 lines | new Playwright spec: per-surface drain proof + a11y, one route-ladder test |
| `e2e/ui/agent-queue-guidance.spec.ts` | modify (only if needed) | export `trackSendRequests`, `queueList`, `guidanceField`, `waitForNodeStarted`, `listNodeMessages`, `sendPathname` — or move them to `e2e/lib/steering-helpers.ts` | none behaviorally |
| `plans/260919-0135-issue-182-withdraw-queued-guidance-message/reports/evidence/` | create | screenshots + `measurements.json` | evidence only |
| `plans/260919-0135-issue-182-withdraw-queued-guidance-message/reports/acceptance.md` | create | short acceptance report mapping each AC to its test id | none |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify | one line: `2-2-… : done` | none |

No fixture or fake-provider changes are expected; if the drain proof needs a second delayed turn, add a fixture rather than editing `e2e-queue-guidance.yaml`.

## Tests before (Playwright, `[P1]` tags, both surfaces where marked)

1. `[V:withdraw.drain-${surface}]` — start `e2e-queue-guidance` via web; wait for `node_started`; queue `first correction` and `second correction` (band reads `queued · 2`); activate the first row's `delete` (accessible name `delete · first correction`); assert the DELETE request for that `message_id` returned 200 `{ success: true, message_id }`; band reads `queued · 1`, the remaining row is `second correction`, focus is on its delete button; wait for the run to complete; `listNodeMessages` shows one resumed echo containing `second correction` and none containing `first correction`; the node has exactly one execution row.
2. `[V:withdraw.last-${surface}]` — queue one, delete it: band disappears, focus lands on the textarea, status region reads no count; the run completes with **no** resumed echo (withdraw emptied the queue before the boundary, so `closeIfEmpty()` sealed it).
3. `[V:withdraw.a11y-${surface}]` — with two rows: each delete has `aria-label` starting with `delete · `; each is a `<button type="button">` ≥ 24×24 CSS px; `Tab` reaches it; `Enter` activates it; `axe` (or the suite's existing a11y check) reports no new violations on the band; screenshot at 460 px (Legacy) and the Console panel width, plus a reduced-motion variant.
4. `[V:withdraw.route-ladder]` (single test, `starterFetch`):
   - live queued id → 200 `{ success: true, message_id }`;
   - same id again → 200 identical body;
   - random never-queued UUID → 200 with that id echoed;
   - `not-a-uuid` → 400 `invalid_request`;
   - unknown node → 404 `not_found`; unknown run → 404;
   - detached run (`startDetachedWorkflow`) → 422 `not_steerable_here`;
   - after the run completes → 409 `node_finished`; `listNodeMessages` count unchanged before/after every refusal.
5. `[V:withdraw.blocked-${surface}]` — on the HITL ask fixture used by Story 2.1's blocked test: queue one message before the ask parks the node (or via `starterFetch`), then with the dock in its blocked mode activate delete → 200 and the row is gone (decision 3: parked handle withdraws). **Timing-dependent:** at scout time check whether the fixture's node generates long enough before the ask to accept a send. If there is no reliable pre-ask window, skip this E2E — decision 3 is already proven by route test 22 and registry test 6 — rather than add a fixture or loosen assertions.

## Refactor

- Create `e2e/ui/agent-withdraw-guidance.spec.ts` mirroring the 2.1 spec's surface loop, evidence directory convention (`plans/<this plan>/reports/evidence/`), and `T` timeouts. Add a `trackWithdrawRequests(page, runId, nodeId)` helper that records DELETE requests and their responses keyed by `message_id`.
- If the 2.1 spec's helpers are module-private, lift them into `e2e/lib/steering-helpers.ts` and import them from both specs; do not copy them.

## Tests after

`bun run --cwd e2e test:ui -- --grep 'withdraw'` green on both surfaces; `--grep 'queue guidance'` still green; `npm run typecheck` in `e2e` green.

## Test scenario matrix

| Priority | Scenario | Test |
| --- | --- | --- |
| Critical | withdrawn message never drains; sibling does | 1 |
| Critical | route ladder incl. idempotent 200s and mutation-free refusals | 4 |
| High | last-row delete empties the queue and the node finishes without a guidance turn | 2 |
| High | accessible name, target size, keyboard activation, focus after removal | 3 |
| Medium | parked-handle withdraw through the blocked dock | 5 |

## Closeout steps

1. `bun run validate` from the repo root (never bare `bun test`).
2. Write `reports/acceptance.md`: AC → test id → result, with evidence file names.
3. Commit with conventional messages (no AI references); the PR body copies `.github/pull_request_template.md` verbatim, keeps Problem and outcome / Review guidance / Solution / Validation, deletes unused conditional sections, and ends with `Closes #182`.
4. `gh pr create --base develop`.
5. After all gates pass, change `sprint-status.yaml:69` to `2-2-withdraw-a-queued-guidance-message: done`. Leave `2-1` (`backlog` at HEAD despite #207) untouched; note it in the PR's Review guidance so the owner can decide.
6. Stop any server or Playwright process started during this phase by its recorded PID.

## Regression gate

```bash
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'withdraw|queue guidance'
bun run validate
```

## Todo

- [ ] Scout pass over the 2.1 spec and `archon-runtime.ts`.
- [ ] Lift shared helpers if needed; write tests 1–5 (red where the UI is missing, then green).
- [ ] Capture evidence and measurements; write `reports/acceptance.md`.
- [ ] `bun run validate` green.
- [ ] PR to `develop` with `Closes #182`; sprint-status `2-2` → `done`.

## Success criteria

- Every story AC maps to at least one green test id in `reports/acceptance.md`.
- The E2E proves delivery exclusion, not just UI removal.
- No orphaned server or browser processes remain.

## Risk assessment

- **30 s fake delay is too short on a slow CI runner for queue → delete → assert** — the 2.1 spec already completes two sends inside it; if flaky, add a fixture with a longer `delayMs` rather than shortening assertions.
- **Detached-run 422 test needs the CLI child alive** — reuse the exact sequence from the 2.1 route-smoke test (`startDetachedWorkflow` → `waitForRunStatus('running')` → `waitForNodeStarted`).

## Security considerations

- Evidence screenshots contain only fixture text; no credentials or user data.

## Next steps

Story 2.9 (shared queue reads) depends on this story and 2.1; it will replace local `sent` rows with the authoritative projection and reuse the injectable `withdraw` prop.
