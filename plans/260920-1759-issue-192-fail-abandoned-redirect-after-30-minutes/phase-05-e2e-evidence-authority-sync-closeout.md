---
phase: 5
title: 'Phase 5: E2E evidence, authority sync, and closeout'
status: pending
priority: P1
effort: '5h'
dependencies: [1, 2, 3, 4]
---

# Phase 5: E2E evidence, authority sync, and closeout

## Goal

Prove the complete contract through the real server, registry, executor, web
client, and both node-room shells under the env-gated fake provider. Correct
the canonical documentation where repository behavior disproves its restart
claim, retain durable evidence, and mark Story 2.12 done only after all gates
pass.

## Evidence and constraints

- `e2e/lib/playwright/suite.ts` owns the worker-scoped `archon` runtime.
- `e2e/lib/playwright/archon-runtime.ts` starts a tracked server process with
  `isolatedEnv`; server env is currently not customizable.
- `e2e/lib/playwright/run-detail.ts` locally types `nodeExecutions` but omits
  fields needed here. Generated API already exposes them.
- `e2e-queue-guidance` plus the fake provider supplies the real interruptible
  path and tool call ids derived from provider session ids:
  `e2e-fake-tool-${sessionId}`. Different ids before/after retry are a direct
  fresh-session proof.
- Existing interrupt and never-sent specs own route interception, observation
  ledger, focus, measurement, and screenshot patterns. Reuse helpers rather
  than adding a second harness.
- The E2E package is standalone npm tooling. Its README requires a built web
  bundle; root workspace validation does not typecheck it.
- There is no axe dependency. Existing E2E accessibility checks use Chromium
  `Accessibility.queryAXTree` through a CDP session.

## Files

| File                                                                                     | Action                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `e2e/lib/playwright/suite.ts`                                                            | Add consumed worker-scoped `idleAwaitMs` option                                           |
| `e2e/lib/playwright/archon-runtime.ts`                                                   | Accept server-only env additions and pass them to the tracked server spawn                |
| `e2e/lib/playwright/run-detail.ts`                                                       | Add `error`, `retry_epoch`, `started_at`, and `ended_at` to the local node-execution type |
| `e2e/ui/agent-idle-await-expiry.spec.ts`                                                 | Create end-to-end/visual/accessibility proof                                              |
| `plans/260920-1759-issue-192-fail-abandoned-redirect-after-30-minutes/reports/evidence/` | Add screenshots and measurement JSON                                                      |
| Steering authorities listed below                                                        | Correct route/test/restart claims                                                         |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`               | Move Story 2.12 to `done` last                                                            |

## Runtime fixture changes

1. Change `createArchonRuntime(workerIndex, options?)` and
   `startArchonRuntime(...)` to accept a typed `serverEnv` record. Spread it
   after `isolatedEnv(home, port)` only in the server spawn. CLI child
   environments remain unchanged.
2. Extend the Playwright worker fixture type with optional `idleAwaitMs` and
   declare it as `[undefined, { scope: 'worker', option: true }]`.
3. Make the `archon` fixture explicitly consume `idleAwaitMs`. When defined,
   pass `ARCHON_E2E_STEERING_IDLE_AWAIT_MS: String(idleAwaitMs)` through
   `serverEnv`; `isolatedEnv` already supplies the exact fake-provider flag.
4. The new spec uses `test.use({ idleAwaitMs: 8_000 })`. Other specs omit the
   option and continue with the 30-minute default. Do not add debug logging or
   a global env mutation to verify the option; the observed 8-second expiry is
   the proof.
5. Preserve existing process ownership: the fixture records the server and CLI
   children and stops them in `finally`; ports remain deterministic and an
   occupied port remains a hard error, never an invitation to increment it.

## E2E specification

Create parameterized Legacy and Console coverage where the state belongs to a
browser observation ledger. Open all observer tabs before queueing/expiry so
Story 2.11 has seen the accepted ids; do not assume a tab opened after terminal
can reconstruct ephemeral receipts.

Use Playwright polling and response listeners registered before user actions.
Avoid fixed sleeps longer than two seconds. Record elapsed bounds with
tolerance; do not assert millisecond precision.

| ID  | Scenario                                      | Required assertions                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Disclosure and accessibility, both shells     | Stop settles to idle; existing Stop explanation and exact 30-minute sentence are visible in order. CDP AX subtree contains non-ignored `StaticText` for the complete sentence.                                                                                                                  |
| E2  | Focus/typing activity request, both shells    | A fresh idle field focus plus `abc` burst yields one immediate bodyless POST, 200 exact body, and no request storm in the observation window; node remains running/idle. Component tests separately distinguish focus from keystroke.                                                           |
| E3  | Real server re-arm, Console                   | Let most of the 8-second interval elapse, create one activity request, prove the node remains running beyond the original deadline, then fails after the re-armed deadline. Store observed timestamps/counts.                                                                                   |
| E4  | Send now exclusion                            | After activity has already produced any keepalive, snapshot its count. Activate Send now by keyboard and by click in fresh cases; `/send` carries `intent:'send_now'`, the count does not increase because of submit, and resumed echo proves redirect still works.                             |
| E5  | Exact expiry failure                          | With no further activity, run and selected node become failed; latest `NodeExecution.error` is exact; exactly one `node_failed` event exists; no `node_completed` or idle-timeout completion message exists. This guards the web's local constant against engine drift.                         |
| E6  | NEVER SENT cause, both shells                 | Queue one identified message while idle and never Send now. On terminal evidence, one `Never sent, 1` read-only band retains text/id, operator transcript rows omit that id, and one alert has exact cause copy. Field/controls disappear and focus transfers to last row/scroller, never body. |
| E7  | Expiry with no unmatched message, both shells | Terminal node shows no empty composer/NEVER SENT shell and no cause-specific empty alert; ordinary failed-node presentation remains visible.                                                                                                                                                    |
| E8  | Supported retry is fresh, Legacy              | After expiry, use the existing `WorkflowNodeRetryAction` and confirm it. Compare the interrupted attempt's fake tool call id with the retried first tool call id; their embedded session ids differ, and the retried execution has the next retry epoch.                                        |

### Visual evidence

Capture, on both shells where applicable:

- idle/empty and idle/queued states with the complete two-line disclosure;
- expired/queued read-only state with exact alert;
- expired/empty state with no dock.

Legacy evidence must measure the authoritative 460px node panel; Console uses
the normal 1440×900 desktop viewport and its current panel width. Persist JSON
with panel/well/textarea/control/band rectangles, scroll widths, keepalive
counts, and expiry/re-arm timestamps. Assertions:

- complete strings are in DOM and AX tree, with no ellipsis or clipping;
- no horizontal overflow, overlap, or off-screen `Send now`;
- queue band keeps the existing 33vh cap and scroll behavior;
- structure/order/tokens match the co-located mockups, with only the final UX
  authority's new sentence added;
- reduced-motion and existing focus behavior are unchanged.

## Authority synchronization

Read every target immediately before changing it and keep edits to statements
this implementation proves.

1. `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`
   - replace the inaccurate “fake timers” instruction with injected manual
     scheduler/manual expiry plus one real E2E timer;
   - map Story 2.12 coverage to the focused test ids;
   - record the restart limitation and explicit recovery sequence.
2. `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`
   - document live idle re-arm, live non-idle 200 no-op, parked/missing 422,
     and terminal/closed 409; retain bodyless/no-row/auth language.
3. `_bmad-output/specs/spec-agent-node-room/SPEC.md` and
   `_bmad-output/specs/spec-agent-node-room/engine-integration.md`
   - replace “the run resumes normally” with the verified behavior: restart
     drops the process-local handle/timer/continuation and can leave a durable
     non-terminal run; no autonomous staleness mutation; operator explicitly
     abandons/cancels, then uses CLI `archon workflow retry-node` when desired
     (the web Retry action is not shown for a still-`running` node projection).
4. Keep absorbed source copies that the canonical spec says are carried
   verbatim in sync:
   `sources/spec-live-agent-steering/SPEC.md` and
   `sources/spec-live-agent-steering/engine-integration.md`.
5. Correct the same factual sentence in
   `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`
   and its mirrored `walkthrough.html`. Do not rewrite historical review files
   that quote the old statement; they remain evidence that the conflict was
   previously identified.
6. `control-states.md`, the epic acceptance criteria, and design artifacts
   require no semantic change unless implementation evidence reveals an actual
   mismatch. Verify rather than churn them.
7. Only after code, focused tests, E2E, evidence, and full validation pass, set
   `2-12-fail-an-abandoned-redirect-safely-after-30-minutes: done` in
   `sprint-status.yaml`.

## Verification order

From repository root unless the command changes directory:

```bash
bun run build:web
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test -c playwright.config.ts ui/agent-idle-await-expiry.spec.ts)
(cd e2e && npx playwright test -c playwright.config.ts ui/agent-interrupt-redirect.spec.ts ui/agent-never-sent.spec.ts)
bun run validate
```

Also run the Phase 1–4 focused gates before the full validation. After docs
edits, use `rg` to confirm no current canonical steering authority still says
a restarted running node “resumes normally”; historical reviews/snapshots may
retain quotations. Verify plan-relative links and evidence paths.

## Completion, risks, and rollback

- Eight seconds is an E2E-only server duration. Client coalescing remains 30
  seconds; E3 deliberately uses one immediate activity, while deterministic
  unit tests prove continuous-window behavior at production ratios.
- A screenshot alone is not proof: DOM, AX, API, event, focus, and geometry
  assertions must all pass.
- Tracker status is a closeout artifact, never evidence that tests passed.
- If runtime-option plumbing is reverted, delete the new spec/evidence and
  restore the default fixture. If product code is reverted, restore authority
  and tracker claims in the same rollback. No database action is required.
