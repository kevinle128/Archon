# Story 2.1 — Acceptance Report: Queue guidance for a running agent

Issue: kevinle128/Archon#181 · PRD: `plans/260918-1721-issue-181-queue-guidance-for-running-agent`

All evidence below was produced by real runs of the listed commands in this
worktree. Screenshots and computed measurements live in `reports/evidence/`.

## Verification commands and results

| Command                                                                                                                                                                                                                            | Result                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `(cd packages/providers && bun test src/e2e-fake/provider.test.ts)`                                                                                                                                                                | 31 pass / 0 fail             |
| `(cd packages/workflows && bun test src/steering-registry.test.ts)`                                                                                                                                                                | 33 pass / 0 fail             |
| `(cd packages/workflows && bun test src/dag-executor.test.ts)`                                                                                                                                                                     | 623 pass / 0 fail            |
| `(cd packages/core && bun test src/db/workflows.test.ts -t 'steering handle cleanup')`                                                                                                                                             | 7 pass / 0 fail              |
| `(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)`                                                                                                                                                            | 227 pass / 0 fail / 9 todo   |
| `(cd packages/web && bun test src/lib/steering-dock.test.ts)`                                                                                                                                                                      | 48 pass / 0 fail             |
| `(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)`                                                                           | 52 pass / 0 fail             |
| `(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)` | 86 pass / 0 fail             |
| `(cd e2e && npm run typecheck)`                                                                                                                                                                                                    | clean                        |
| `bun run --cwd e2e test:ui -- --grep 'queue guidance'`                                                                                                                                                                             | 11 pass / 0 fail             |
| `bun run --cwd e2e test:ui:hitl`                                                                                                                                                                                                   | 36 pass / 0 fail / 3 skipped |
| `bun run validate`                                                                                                                                                                                                                 | exit 0 (all gates)           |

## Criterion → evidence map

### Provider echo (opt-in `echoPrompt`)

Criterion: strict-schema `echoPrompt?: boolean`; emits exactly one assistant
chunk `[e2e-fake] echo: <promptOutsideDirectives>` (new session) or
`[e2e-fake] resumed echo: <promptOutsideDirectives>` (resumed) before the
result; computed once via existing directive stripping;
`doneWhenPromptIncludes` still evaluates the stripped prompt; absent
`echoPrompt` emits identical chunks to before.

Evidence — `packages/providers/src/e2e-fake/provider.ts` (schema field +
single conditional emit before loop-sentinel/result handling) and
`provider.test.ts` cases:

- `echoPrompt emits one echo chunk of the stripped prompt before the result`
  — echo content is the stripped prompt; exactly one echo chunk; precedes
  result; new session id returned.
- `echoPrompt strips the usage directive alongside the scenario block` —
  usage directives are removed from the echoed text.
- `echoPrompt on a resumed session uses the resumed prefix and reuses the
session id` — `resumed echo:` prefix, supplied session id returned,
  `resumed: true`.
- `echoPrompt + doneWhenPromptIncludes emits echo then E2E_LOOP_DONE then
result` — exact ordering proven.
- `echoPrompt absent or false leaves the chunk sequence unchanged` — default
  parity proven.
- `rejects non-boolean echoPrompt` — strict schema enforcement.
- `echoPrompt still throws Query aborted during delayMs` — abort contract
  preserved under a delayed echo scenario.

### Fixtures

- `e2e/fixtures/workflows/e2e-queue-guidance.yaml` — only `steer-me` direct
  node on `e2e-fake`, bounded `delayMs`, no echo, no early finish.
- `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml` — only `steer-loop`
  loop node, `until: E2E_LOOP_DONE`, `max_iterations: 3`.
- Files are separate per the criterion.

### Runtime helpers

`e2e/lib/playwright/archon-runtime.ts`:

- Seeds both fixtures into each isolated `ARCHON_HOME` through the existing
  fixture copy block (`E2E_QUEUE_GUIDANCE_WORKFLOW_NAME`,
  `E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME`).
- `startWorkflowViaWeb` — web-dispatch helper returning
  `{ runId, conversationId, codebaseId }` after the run reaches a live
  status; factors the shared `dispatchWorkflowViaWeb` POST.
- `startDetachedWorkflow` — generic tracked detached-CLI helper returning
  PID/command/port/worktree; `startHitlWorkflow` now delegates to it, so all
  detached children are registered in runtime cleanup. No fixed sleeps, no
  untracked processes.

### Direct queue/drain — both shells

`[P1] [V:steer.direct-console]` / `[P1] [V:steer.direct-legacy]` — each on a
fresh web-dispatched `e2e-queue-guidance` run:

- No empty queue band while generating; enabled Queue; `this tab only` hint.
- Plain Enter inserts a newline and issues no request.
- Shortcut queues `first correction` → `queued · 1`, `sent` badge, status
  announcement, cleared field, retained focus.
- Button queues `second correction` → `queued · 2` in order.
- After completion the transcript shows one `steer-me` occurrence whose
  resumed echo is exactly `first correction\n\nsecond correction`; no extra
  `node_started` occurrence; no fabricated operator row/delivered badge
  (asserted absent).

### Loop delivery

`[P1] [V:steer.loop-console]` / `[P1] [V:steer.loop-legacy]` — queue
`finish now` during delayed iteration 1 of `steer-loop`; DOM-order checks
place `[e2e-fake] resumed echo: finish now` inside the `steer-loop ×1` group
and `E2E_LOOP_DONE` after it; exactly one iteration group exists (no `×2`);
the run completes.

### Route smoke (real server, authenticated fetch)

`[P1] [V:steer.route-smoke]` — live POST → `200` canonical success
(`{success:true, message_id, state:'queued'}`); malformed body → `400`
nested `invalid_request`; unknown node → `404` nested `not_found`; completed
node → `409` nested `node_finished` with no new transcript row; detached run
during its delay → `422` nested `not_steerable_here`.

### Blocked / detached UI

- `[P1] [V:steer.blocked-console]` / `[P1] [V:steer.blocked-legacy]` —
  existing HITL fixture parked at its Ask node: Queue focusable with
  `aria-disabled="true"`, no native `disabled`, described reason
  `answer the agent's question first` resolves; click (forced) and shortcut
  issue no request.
- `[P1] [V:steer.detached-console]` / `[P1] [V:steer.detached-legacy]` —
  tracked detached run during its delay: submit → 422 → dock content is
  exactly `not steerable here · this run was started detached, so its live
session is not in this process`; draft/retry data preserved in
  `sessionStorage`. No Story 2.11 `NEVER SENT` UI asserted.

### Visual / accessibility evidence

`[P1] [V:steer.visual-console]` / `[P1] [V:steer.visual-legacy]` +
deterministic captures from the direct/loop/blocked/detached tests, stored
under `reports/evidence/`:

| State                    | Console                                                                                              | Legacy                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| generating-empty         | `us-005-console-generating-empty.png`                                                                | `us-005-legacy-generating-empty.png`                           |
| two-receipt `queued · 2` | `us-005-console-queued-2.png`, `us-005-console-1440-queued-2.png`, `us-005-console-460-queued-2.png` | `us-005-legacy-queued-2.png`, `us-005-legacy-460-queued-2.png` |
| ask-blocked              | `us-005-console-ask-blocked.png`                                                                     | `us-005-legacy-ask-blocked.png`                                |
| post-422 detached        | `us-005-console-detached-422.png`                                                                    | `us-005-legacy-detached-422.png`                               |
| reduced-motion parity    | `us-005-console-queued-2-reduced-motion.png`                                                         | `us-005-legacy-queued-2-reduced-motion.png`                    |

Viewports: Console run detail at 1440×900 (measured node-panel width 696px)
plus a 460px harness check; Legacy room panel constrained to 460 CSS px.

Computed measurements — `us-005-measurements.json` (all ≥ thresholds):

- Contrast: queue-label text 18.79:1 (console) / 16.45:1 (legacy); receipt,
  sent badge, hint, blocked reason and detached disclosure all ≥5.33:1 —
  above 4.5:1 text minimum.
- Focus ring: 5.14:1 (console) / 7.99:1 (legacy) against band background —
  above 3:1 non-text minimum.
- Band geometry: `max-height` 237.6px (33vh of 720px viewport), internal
  `overflow-y: auto`, no overlay, no horizontal overflow; last transcript
  row reachable after scrolling the node-room scroller.
- Accessibility: labelled textarea (`message to <node>`), labelled queued
  list, accessible Queue name beginning with its visible label,
  `role="status"` announcements for count changes, `aria-describedby`
  resolves to the visible reason, focus retention after queueing, IME
  (`isComposing`/key-code 229) and plain-Enter guards.
- `prefers-reduced-motion: reduce`: identical dock content, no introduced
  animation (parity capture above).

No axe dependency added — assertions are DOM/computed-style checks only, per
phase-04 §5. A live screen-reader pass was not automated; manual check
recorded honestly as not run (no axe scan claimed).

### Closeout hygiene

- Final diff contains no database migration, no GET queue route, no API
  contract edit (`api.generated.d.ts` untouched by this story), no
  Stop/delete controls, no fabricated operator transcript row, and no
  later-story reconciliation (`send_now` still queues identically;
  `awaiting_send_now` remains reserved).
- Process reconciliation: all E2E/detached processes started by this story's
  runs are tracked through the runtime cleanup path; no stray process owned
  by this worktree remains. Note: an unrelated E2E server owned by a
  different worktree (`thread-cabc0cf5`, PID 53811, port 3409) was observed
  and deliberately left running — it is not owned by this worktree.
- Conventional commits; no issue/phase labels in code comments or commit
  subjects.

## Deferred to owners outside this story's scope

- **PR creation**: the containing workflow owns per-story commits and the PR
  lifecycle (hard rule for this iteration). No `git push`/`gh pr create` was
  performed here; the parent workflow opens the PR from
  `.github/pull_request_template.md` targeting `dev` with `Closes #181`.
- **sprint-status**: `2-1-queue-guidance-for-a-running-agent` in
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
  remains `backlog`; the criterion requires the move to `done` be performed
  only by its owning workflow after all gates pass. Gates are green; the
  owning workflow can now move it.
