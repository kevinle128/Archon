---
phase: 4
title: 'Phase 4: Outside-in E2E evidence, authority sync, tracker closeout'
status: pending
priority: P1
effort: '4h'
dependencies: [3]
gate: 'Phases 1–3 green; `bun --filter @archon/web test` and `type-check` pass'
---

# Phase 4: Outside-in E2E evidence, authority sync, tracker closeout

## Goal

Prove Story 2.11 against a real server, real executor, and the fake provider
on both surfaces; capture the characterization evidence the issue requires;
align the three authority documents with the decisions this plan made; move
the sprint tracker to `done`; and pass `bun run validate`.

## Scout checklist (deep mode — re-verify before editing)

- [ ] `e2e/lib/playwright/archon-runtime.ts`: the queue-guidance fixture is
      seeded (`QUEUE_GUIDANCE_WORKFLOW_FIXTURE`, `E2E_QUEUE_GUIDANCE_WORKFLOW_NAME`,
      `QUEUE_GUIDANCE_NODE = 'steer-me'`), `startWorkflowViaWeb`,
      `starterFetch`, `waitForRunStatus` exist with the signatures quoted in
      `plan.md`. The fixture's turn is `interruptible` with `delayMs: 30000`.
- [ ] `e2e/ui/agent-queue-guidance.spec.ts` and
      `e2e/ui/agent-interrupt-redirect.spec.ts`: reuse their helpers for
      opening a node room per surface (`openRunDetail` / `openLegacyRunDetail`
      + `openNodeRoom`), typing into the dock field, pressing `Queue` / `Stop`,
      tracking send `message_id`s (`trackSendRequests`), and
      `listNodeMessages` for row assertions.
- [ ] The abandon route: `POST /api/workflows/runs/{runId}/abandon` (no body)
      is reachable through `starterFetch`; it marks the run `cancelled` and
      discards steering handles synchronously.
- [ ] `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`
      AD-11 paragraph "Every terminal cause surfaces the undelivered queue".
- [ ] `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` line ~61.
- [ ] `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups/key-steering-dock.html`
      state 5 disclosure line (`node finished · these never left this tab`).
- [ ] `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
      entry `2-11-recover-messages-that-were-never-sent-when-the-node-ends: backlog`.

## Files to Create / Modify

- Modify: `e2e/ui/agent-never-sent.spec.ts` (Phase 1 `test.fixme` skeleton → real tests)
- Modify: `e2e/ui/agent-queue-guidance.spec.ts` (natural-drain negative assertion)
- Modify: `…/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` (AD-11 clarification)
- Modify: `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`
- Modify: `…/ux-Archon-agent-node-room-2026-09-09/mockups/key-steering-dock.html` (one copy line)
- Modify: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
- Create: `plans/260920-1136-issue-191-recover-never-sent-messages/reports/evidence/` (captures + measurements JSON)

No fixture, provider, server, or executor change. If a scout finds the
existing fixture cannot hold a turn open long enough for the Cancel case,
add a dedicated `e2e-never-sent.yaml` fixture (same shape, `delayMs: 30000`)
and register it in `archon-runtime.ts` next to the queue-guidance fixture —
do not modify the existing fixture's timing.

## Test-first design (Playwright, both surfaces)

Test titles follow the repo's `[P1] [V:<key>-<surface>]` convention. Each
case runs for `surface of ['console', 'legacy']`.

| ID | Test | Flow → assertions |
|----|------|-------------------|
| E4.1 | `[P1] [V:steer.never-sent.cancel-${surface}] queued guidance is restored read-only as NEVER SENT when the run is cancelled` | Start `e2e-queue-guidance` via web; open node room; queue `first correction`, `second correction` (track ids); confirm `QUEUED · 2`; `starterFetch(POST …/abandon)`; `waitForRunStatus(runId,'cancelled')`. Assert within `T.long`: `getByRole('list', { name: 'Never sent, 2' })` with two items in order whose `data-message-id`s equal the tracked ids and whose text is verbatim; heading text `NEVER SENT · 2` (via `toHaveText` + computed `text-transform: uppercase` on lowercase DOM); exactly one `[role="alert"]` with `node finished · none of this was sent`; no `textarea`, no `Queue`/`Stop`/`Send now`/`delete` buttons in the dock; `listNodeMessages(runId, nodeId)` contains no operator row with either id. |
| E4.2 | `[P1] [V:steer.never-sent.idle-${surface}] a Will-send message is restored when the run is cancelled while idle-after-interrupt` | Start; open; press `Stop`, wait for `Send now`; queue one message (band `WILL SEND · 1`); abandon → `Never sent, 1` with that id; alert once. |
| E4.3 | `[P1] [V:steer.never-sent.draft-${surface}] an unsent draft folds in as the last never-sent item` | Start; open; queue one message; type `still typing` without queuing; abandon → list `Never sent, 2`; last item text `still typing` without `data-message-id`; first item keeps its id. |
| E4.4 | `[P1] [V:steer.never-sent.none-${surface}] nothing is restored after a natural drain` | Extend the existing natural-drain test in `agent-queue-guidance.spec.ts`: after `completed`, assert no `list` named `/^Never sent/`, no alert with the disclosure, and that both operator rows exist with the tracked ids. |
| E4.5 | `[P1] [V:steer.never-sent.visual-${surface}] never-sent box geometry and contrast evidence` | Reuse the visual-evidence pattern from `agent-queue-guidance.spec.ts`: capture the finished dock at 460 px and 1280 px, record header/item/disclosure font sizes, item min-height, and the text-secondary-on-elevated contrast ratio into `reports/evidence/us-never-sent-measurements.json`; assert contrast ≥ 4.5:1 and no focusable element in the dock. |
| E4.6 | `[P2] [V:steer.never-sent.focus-${surface}] focus leaves the dock to the last transcript row on terminal` | Focus the field; abandon → `document.activeElement` is the last transcript row (or scroller fallback), never `body`; the alert is present. |

Timing notes for the executor: after `abandon`, the web run query notices
`cancelled` within 3 s and the pane performs its final drain within ~1 s;
assert with `T.long`. The in-process executor writes `node_failed` up to
10 s later; the spec must not wait for that event. Keep the fixture's 30 s
turn so the Stop/queue steps in E4.2 land before a natural end.

## Tasks & Steps

1. Fill in `agent-never-sent.spec.ts` (E4.1–E4.3, E4.5, E4.6), removing the
   Phase 1 `test.fixme` markers, and add the E4.4 assertion; run green
   against the finished build: `bun run build:web` once, then
   `cd e2e && npx playwright test -c playwright.config.ts ui/agent-never-sent.spec.ts ui/agent-queue-guidance.spec.ts`.
2. Save captures and the measurements JSON under `reports/evidence/`; add a
   short `reports/acceptance-report-260920-issue-191.md` summarising each
   AC → test id → result (this is the "characterization evidence" the issue
   requires).
3. **AD-11 clarification** — append one bullet to AD-11 (do not renumber):
   "Client trigger, ratified with Story 2.11 (#191): the browser keys
   reconciliation on the node row turning terminal (`completed|failed|skipped`)
   or the run leaving the live statuses, followed by one transcript drain
   that started after that observation. For natural ends this is the
   `node_completed`/`node_failed` event projected onto the row; for Cancel the
   registry queue is discarded in the same commit that publishes `cancelled`
   (`cancelWorkflowRun` → `discardRun`), the run query stops polling, and the
   executor's `node_failed` may never reach the browser — so the settled
   status is the terminal signal there. The reconciled set is the union of the
   tab's accepted receipts (drained-but-unwritten guidance is not lost) and
   the last shown shared queue; a message another tab withdrew is restored
   as `NEVER SENT` (true, read-only, no request). The finished-iteration band
   (Story 2.10) never reconciles — its rows are occurrence-scoped."
4. **`steering-test-plan.md`** line ~61: replace "runs **only** on the node's
   terminal event" with "runs only after the node is observed terminal
   (terminal row status or non-live run) and against a transcript drain that
   started after that observation; unit + component tests assert `null` on
   every live refetch; E2E `agent-never-sent.spec.ts` covers Cancel,
   idle-after-interrupt Cancel, draft fold-in, and the natural-drain
   negative".
5. **Mockup copy**: change state 5's disclosure to
   `node finished · none of this was sent` (EXPERIENCE.md is the copy
   authority; the box can hold other tabs' messages since Story 2.9). Leave
   state 7's 30-minute copy for Story 2.12.
6. **Tracker**: set
   `2-11-recover-messages-that-were-never-sent-when-the-node-ends: done` and
   update `last_updated`; leave `epic-2` as is (other stories remain).
7. Run the full gate: `bun run validate` (includes lint, type-check, tests,
   bundled/generated checks). Fix anything it surfaces in the touched files
   only.
8. Update this plan's phase statuses to `completed` and the plan `status`
   to `completed` via `ak plan phase … --json` (or edit the front matter if
   the CLI is unavailable).

## Verification

```bash
bun run build:web
cd e2e && npx playwright test -c playwright.config.ts ui/agent-never-sent.spec.ts ui/agent-queue-guidance.spec.ts
cd .. && bun run validate
grep -n "2-11-recover" _bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml   # shows ': done'
```

Mechanical pass condition: all E4.x tests pass on both surfaces; evidence
files exist; `bun run validate` exits 0; the three authority edits and the
tracker change are present in the diff.

## Rollback

Revert the spec, the doc edits, and the tracker line; Phases 1–3 remain
functional without them.
