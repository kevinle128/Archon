---
phase: 5
title: 'Phase 5: E2E evidence, authority sync, closeout'
status: pending
priority: P1
effort: '5h'
dependencies: [1, 2, 3, 4]
---

# Phase 5: E2E evidence, authority sync, closeout

## Goal

Prove the whole story on the real executor through both web surfaces with the
fake provider and a shortened inactivity timer; record evidence; bring the
spec, test-plan, and API-contract authorities in line with what shipped; and
move the Story 2.12 tracker entry to `done` only after every gate passes.

## Context links

- `e2e/lib/playwright/suite.ts` — worker-scoped `archon` fixture;
  `e2e/lib/playwright/archon-runtime.ts` — `createArchonRuntime`,
  `isolatedEnv` (sets `ARCHON_E2E_FAKE_PROVIDER: '1'`), interruptible
  `e2e-queue-guidance` scenario constants.
- `e2e/ui/agent-interrupt-redirect.spec.ts` (Stop → idle → Send now flow,
  `page.route('**/interrupt')`, `waitForResponse`, evidence dir pattern) and
  `e2e/ui/agent-never-sent.spec.ts` (alert locator, operator-row check,
  focus assertions, geometry evidence).
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`,
  `steering-api-contract.md`, `engine-integration.md`, `control-states.md`.
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`
  lines 130–131 and 173 (already describe the timer and keepalive — verify,
  do not rewrite).
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
  line 79.

## File inventory

| File                                                                    | Action | Size   | Test impact                              |
| ----------------------------------------------------------------------- | ------ | ------ | ---------------------------------------- |
| `e2e/lib/playwright/suite.ts`                                           | Modify | ~+10   | Worker-scoped `idleAwaitMs` option       |
| `e2e/lib/playwright/archon-runtime.ts`                                  | Modify | ~+10   | `createArchonRuntime(index, { env })`    |
| `e2e/ui/agent-idle-await-expiry.spec.ts`                                | Create | ~350   | E1–E7 below                              |
| `plans/260920-1759-…/reports/evidence/`                                 | Create | —      | Captures + measurements JSON             |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`         | Modify | ~+6    | Mark idle-await lifecycle cases covered  |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`      | Modify | ~+3    | Keepalive no-op/409/422 semantics        |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Modify | 1 line | `backlog` → `done`                    |

## Tests before (E2E specification, written first and failing)

Add a worker-scoped option `idleAwaitMs?: number` to `suite.ts`; when set,
`createArchonRuntime` spawns the server with
`ARCHON_E2E_STEERING_IDLE_AWAIT_MS` (the fake-provider flag is already set by
`isolatedEnv`). The new spec declares `test.use({ idleAwaitMs: 8000 })`, so
Playwright gives it its own worker and other specs keep the real 30 minutes.

| ID  | Test (both surfaces unless noted)                          | Required assertion                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | idle disclosure is rendered and accessible                 | After Stop settles idle, the well contains both `stopped after the last completed tool call …` and `no redirect ends this node after 30 min of inactivity · typing keeps it open` as visible text; axe scan of the dock has no violations. |
| E2  | keystroke issues one keepalive                             | Intercept `**/keepalive`; type `abc` → exactly one POST with empty body and `200 { success: true }`; the node stays `running` and `idle-after-interrupt` in run detail.                                                                  |
| E3  | focus issues a keepalive within the throttle window        | Blur then focus the field → no second POST inside 30 s (assert count stays 1 after a 1.5 s settle).                                                                                                                                    |
| E4  | Send now issues no keepalive and redirects                 | Fresh idle; type then press Cmd/Ctrl+Enter → a `/send` with `intent:'send_now'` and zero `/keepalive` requests; the redirect echo appears (same-session proof from the interrupt spec).                                                  |
| E5  | expiry fails the node with the exact error                 | Fresh idle with one queued message; do nothing for > 8 s → run detail shows the node `failed`, `NodeExecution.error === 'interrupted by operator, no redirect received'`, no `node_completed`, and the run is `failed`. This string assertion is the cross-package guard for the web's local copy of the constant (Phase 4 T4.3). |
| E6  | queued message is restored as NEVER SENT with the fail copy | After E5 terminal evidence: `Never sent, 1` box contains the queued text and id; exactly one `role="alert"` reads `node failed · interrupted with no redirect · none of this was sent`; operator rows do not include the id; focus is on the last transcript row when it was in the dock. |
| E7  | keepalive extends the deadline (single surface, Console)   | Type once at ~5 s after idle; the node is still `running` at ~11 s; it fails by ~20 s.                                                                                                                                                  |
| E8  | retry starts a fresh session (single surface, Legacy)      | After E5, trigger the failed-node retry action from the UI (or the existing `/retry` route helper); the new execution's first operator/assistant rows show the fake provider's fresh-session marker (no `resumed` echo).                  |

Evidence: screenshots of E1 (both surfaces, 460 px dock), E6 (both surfaces),
and `idle-await-expiry-measurements.json` (keepalive counts, timings) under
`reports/evidence/`.

## Implementation steps

1. `archon-runtime.ts`: accept `options?: { env?: Record<string, string> }`
   in `createArchonRuntime` and spread it into `isolatedEnv(home, port)` for
   the server spawn only (CLI spawns keep the default).
2. `suite.ts`: add `idleAwaitMs: [undefined, { scope: 'worker', option: true }]`
   to the worker fixtures type and **change the `archon` fixture's signature to
   `async ({ idleAwaitMs }, use, workerInfo) => …`** so it declares the
   dependency — Playwright only threads an option into fixtures that consume
   it and only allocates a distinct worker on that basis. Pass
   `{ env: { ARCHON_E2E_STEERING_IDLE_AWAIT_MS: String(idleAwaitMs) } }` to
   `createArchonRuntime` when defined. Verify with a `console.log` of the
   spawned env in a scratch run, then remove it.
   <!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F2 -->
3. Write `agent-idle-await-expiry.spec.ts` reusing the interrupt spec's
   helpers (`openRunDetail`/`openLegacyRunDetail`, `getRunDetail`,
   `listNodeMessages`, scenario directives) and the never-sent spec's alert
   and focus helpers. Use Playwright `expect.poll` with `T` timeouts; never a
   fixed 30-minute wait and no `waitForTimeout` longer than 2 s.
4. Run the spec on both surfaces and store evidence.
5. Authority sync:
   - `steering-test-plan.md` "Engine — idle-await lifecycle": annotate each
     bullet with the covering test ids (T1/T2/T3/E) — additive, no rewording —
     except its parenthetical "(fake timers)", which becomes "(injected short
     durations)" to match plan decision 4; add one bullet recording the
     accepted limitation that a server restart during idle-await orphans the
     run (plan Risks).
     <!-- Updated: Red Team 2026-09-20 — Failure Mode F1 -->
   - `steering-api-contract.md` keepalive rows: add the resolved semantics
     (generating node → 200 no-op; 409/422 as the other routes).
   - `engine-integration.md` / `control-states.md` / ARCHITECTURE-SPINE: read
     and confirm they already state the built behaviour; change nothing unless
     a sentence is now false.
6. Tracker: set `2-12-fail-an-abandoned-redirect-safely-after-30-minutes: done`
   in `sprint-status.yaml`.
7. Run the whole-plan gate from `plan.md` (`bun run validate`) and the E2E
   file; only then mark this phase done.

## Regression gate

```bash
cd e2e && npx playwright test ui/agent-idle-await-expiry.spec.ts
cd e2e && npx playwright test ui/agent-interrupt-redirect.spec.ts ui/agent-never-sent.spec.ts
bun run validate
```

Pass condition: all three commands succeed; the pre-existing interrupt and
never-sent specs still pass with the real 30-minute default (they run in a
worker without the option).

## Test scenario matrix

| Path     | Scenario                                  | Tests    |
| -------- | ----------------------------------------- | -------- |
| Critical | expiry fails once with exact error        | E5       |
| Critical | NEVER SENT with cause-naming copy         | E6       |
| High     | disclosure + a11y                         | E1       |
| High     | keepalive on activity, never on Send now  | E2–E4    |
| Medium   | keepalive extends deadline end-to-end     | E7       |
| Medium   | fresh session on retry                    | E8       |

## Dependency map

- Requires Phases 1–4.
- Owns the E2E runtime option that Phase 1's env gate enables.

## Risk assessment

- Worker option not honoured (Playwright reuses a worker) — verify with
  `--workers=1` that the expiry spec still gets its own runtime; the option
  fixture guarantees a fresh worker for differing values.
- 8 s is too short if the fake provider's interrupt settle is slow under CI
  load — the fake settles on the abort signal immediately; keep 8 s and use
  `expect.poll` windows of 20 s.
- Retry UI action may differ per surface — E8 is single-surface; if no UI
  action exists on Legacy use the existing route helper and assert via
  transcript rows.

## Security considerations

None new. The E2E env override only exists alongside the fake-provider flag.

## Rollback

Delete the spec and the two fixture edits; revert the authority and tracker
edits. Production code is untouched by this phase.
