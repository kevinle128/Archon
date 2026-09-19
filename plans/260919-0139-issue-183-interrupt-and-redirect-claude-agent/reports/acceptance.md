# Story 2.3 — Acceptance Report: Interrupt and redirect a running Claude agent

Issue: kevinle128/Archon#183 · PRD: `plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent`

All evidence below was produced by real runs of the listed commands in this
worktree. Screenshots and computed measurements live in `reports/evidence/`.

## Verification commands and results

| Command                                                                                                     | Result                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `(cd packages/providers && bun test src/e2e-fake/provider.test.ts)`                                         | 42 pass / 0 fail                             |
| `(cd packages/providers && bun run type-check)`                                                             | clean                                        |
| `(cd packages/workflows && bun test src/steering-registry.test.ts src/dag-executor.test.ts -t 'interrupt')` | 30 pass / 0 fail                             |
| `(cd packages/server && bun test src/routes/api.workflow-runs.test.ts -t 'interrupt')`                      | 21 pass / 0 fail                             |
| `(cd packages/web && bun test src/lib/steering-dock.test.ts)`                                               | 69 pass / 0 fail                             |
| `(cd e2e && npm run typecheck)`                                                                             | clean                                        |
| `bun run --cwd e2e test:ui -- --grep 'interrupt and redirect'`                                              | 11 pass / 0 fail                             |
| `bun run --cwd e2e test:ui -- --grep 'queue guidance'`                                                      | (Story 2.1 regression gate — recorded below) |
| `bun run generate:capability-matrix && bun run check:capability-matrix`                                     | check:capability-matrix OK                   |
| `bun run validate`                                                                                          | (final closeout gate — recorded below)       |

## Phase 1 real-SDK gate (no secrets / content)

Source: `reports/claude-interrupt-resume-spike.md` (sanitized).

- SDK pin: `@anthropic-ai/claude-agent-sdk@0.3.209`
- Command: `cd packages/providers && bun run spike:interrupt:claude`
- Outcome: `protocol: "interrupt-turn-resume"` — gate passed
- `sessionIdConsistent: true`, `failureCategory: null`
- Observed terminal reason on interrupt: `aborted_streaming` with
  `result.subtype = error_during_execution`
- Proven contract used by US-002+: result chunk then trailing throw; never
  invent a session id; never downgrade Stop to Cancel

## Criterion → evidence map

### AC1 — e2e-fake opt-in `interruptible: true`

Criterion: strict opt-in scenario requiring `emitTool:true` + positive bounded
`delayMs`; emit assistant + tool call but not its result; wait on first of
node `abortSignal` / turn `interruptSignal` / delay; remove listeners/timers;
node abort → `Query aborted`; turn interrupt → interrupted `tool_result` then
same-session result with `terminalReason:'aborted_tools'`; natural delay keeps
success path; interruptSignal outside opt-in has defined behavior; no-signal
calls keep exact existing chunks.

Evidence:

- `packages/providers/src/e2e-fake/provider.ts` — `interruptible` on
  `scenarioSchema` with `superRefine` messages
  `interruptible_requires_emitTool` /
  `interruptible_requires_bounded_positive_delayMs`; `waitForBoundary`;
  interrupt path emits interrupted tool outcomes + `aborted_tools` /
  `aborted_streaming`.
- Unit cases under `describe('E2eFakeProvider interruptible scenario')` in
  `provider.test.ts` (see AC2).

### AC2 — e2e-fake unit coverage + type-check

Evidence — `packages/providers/src/e2e-fake/provider.test.ts`:

- `interruptible requires emitTool`
- `interruptible requires a positive bounded delayMs`
- `interrupt settles the pending tool as interrupted and ends with aborted_tools`
- `interrupt after the last tool call settles every pending call as interrupted`
- `natural delay completion keeps the success path unchanged`
- `node abort wins over turn interrupt and throws Query aborted`
- `abort during the pending-tool wait still throws Query aborted alone`
- `interrupt without a pending tool emits aborted_streaming and no tool chunks`
- `a spent interrupt signal never starts a query`
- `non-opt-in scenarios ignore an unspent interruptSignal entirely`
- Existing default / emitTool / echo / abort scenarios remain green in the
  same file (42 pass total).

Command: `(cd packages/providers && bun test src/e2e-fake/provider.test.ts && bun run type-check)` → 42 pass, type-check clean.

### AC3 — Fixtures extended, not duplicated; runtime untouched; Story 2.1 green

Evidence:

- `e2e/fixtures/workflows/e2e-queue-guidance.yaml` first-turn directive:
  `{"interruptible":true,"emitTool":true,"delayMs":30000}`
- `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml`:
  `{"interruptible":true,"emitTool":true,"delayMs":25000}`
- `e2e/lib/playwright/archon-runtime.ts` — no diff vs pre-story tip
  (`git diff HEAD -- e2e/lib/playwright/archon-runtime.ts` empty for this
  story's functional changes; last touch remains Story 2.1).
- Story 2.1 regression: `bun run --cwd e2e test:ui -- --grep 'queue guidance'`
  (result recorded in final gate section).

### AC4 — Both-shell direct interrupt + redirect flow

Evidence — `e2e/ui/agent-interrupt-redirect.spec.ts`:

- `[V:steer.interrupt-console]` / `[V:steer.interrupt-legacy]`
  - generating: Stop + Queue + fake tool `running`
  - queue two messages (including queue-during-interrupt)
  - Stop: exactly one interrupt POST; `Stopping…` focusable,
    `aria-disabled="true"`, no `disabled`; polite `agent interrupting`
  - idle: node still `running`; Stop gone; Send now + exact disclosure;
    `will send · 2`; tool card `⚠ interrupted`; focus on last-row or
    scroller (never `<body>`)
  - blank Send now / shortcut issue no request
  - Send now posts only the typed message with `intent:'send_now'`; band
    drains; generating returns
  - transcript contains exactly one
    `[e2e-fake] resumed echo: first\n\nsecond\n\nthird`; single node
    occurrence; no `node_failed` / `dag_node_failed` for the interrupted
    turn

Screenshots: `us-005-{console,legacy}-idle-after-interrupt.png`.

### AC5 — Failure / race coverage

Evidence — same spec:

- `[V:steer.interrupt-fail-*]` — intercepted Send-now 500 restores
  old-then-new band, retryable new draft, exact
  `couldn't send · back in the queue` `role="alert"`, no old receipt
  re-POSTed; screenshots `us-005-*-send-now-failed.png`,
  `us-005-*-interrupt-500.png`
- Queue during in-flight interrupt appears under Will send after idle
  (covered in direct flow step)
- `[V:steer.interrupt-routes]` — idle interrupt idempotent 200
  `idle-after-interrupt`; terminal interrupt 409 `node_finished`;
  detached 422 `not_steerable_here`; duplicate `send_now` 200 with
  immutable `awaiting_send_now` (no second drain)
- `[V:steer.interrupt-422-*]` — detached disclosure retains drafts/receipts
- Natural-end generating/empty-finished races remain engine/route unit
  tests (US-002/US-003); no timing-flaky browser sleeps added for them

### AC6 — Loop parity

Evidence — `[V:steer.interrupt-loop-console]` /
`[V:steer.interrupt-loop-legacy]`:

- enhanced loop fixture + Stop + Send now with
  `echoPrompt` + `doneWhenPromptIncludes`
- one `loop_iteration_started` and one node occurrence
- redirect echo marked `resumed` before `E2E_LOOP_DONE`
- completion asserted only after redirected turn; no `×2` iteration group

Loop-group body parity: focused executor test
`interrupt of a loop-group body node parks under the namespaced step name`
in `packages/workflows/src/dag-executor.test.ts` (no separate browser
fixture).

### AC7 — Visual / accessibility evidence

Evidence — `[V:steer.interrupt-visual-*]` +
`reports/evidence/us-005-measurements.json`:

| Metric                      | Console      | Legacy       |
| --------------------------- | ------------ | ------------ |
| room width @460             | 460          | 460          |
| Stop target height          | 32           | 32           |
| Send width / height         | 84 / 32      | 84 / 32      |
| Stopping… contrast          | 7.9:1        | 5.33:1       |
| band max-height / overflowY | 297px / auto | 297px / auto |
| focus-ring contrast         | 5.14:1       | 7.99:1       |

Captures (locator/state waits only; never fixed sleeps as the sole gate):

- 460px: `*-460-generating-queue.png`, `*-460-interrupting.png`,
  `*-460-interrupting-reduced-motion.png`, `*-460-idle.png`,
  `*-460-generating-again.png`
- 1440×900 idle: `*-1440-idle.png`
- Delivery failure restore: `*-send-now-failed.png`

DOM/computed-style assertions enforce 32px targets, ≥84px send width, no
room-driven horizontal overflow, band ≈33vh scrollability, focus-ring
visibility, Stopping contrast ≥4.5:1, last-row reachability before/after
dock growth. Screenshots supplement — they do not replace — those
assertions.

### AC8 — This acceptance report

This file maps every US-005 acceptance criterion to automated evidence and
command results, records the Phase-1 real-SDK gate without secrets/content,
and lists focused + full validation commands. No new isolated evergreen docs
page was invented; the owning machine-readable docs remain the generated
capability matrix and OpenAPI types.

### AC9 — Closeout order

Executed only after every command green:

1. Evidence reviewed against the nine review-brief perspectives (product,
   architecture, contracts, security/reliability/data, performance,
   completeness, testing, operations/rollback, maintainability) — see
   "Review brief" below.
2. Flip ONLY
   `2-3-interrupt-and-redirect-a-running-claude-agent` → `done` in
   `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
   (Story 2.1 status left untouched).
3. Final diff reviewed for secrets, prompts, generated churn, duplicate
   fixtures, accidental production logging.
4. No validation-started server/process left running (Playwright boots
   per-worker isolated Archon instances and tears them down).
5. PR creation is out of scope for this Ralph iteration (parent workflow owns
   PR).

### AC10 — Final gate commands

Recorded at closeout time in the verification table above and the final gate
section below.

## Accepted visual deltas from the mockup

None unrecorded.

- Stop / Send are bordered transparent controls in both shells (final
  DESIGN.md contrast authority over the filled-Legacy-send mock comment).
- Focus after Stop removal lands on the last transcript row (or scroller),
  never the send control / `<body>` — deliberate Story 2.3 divergence from
  EXPERIENCE.md, pinned in component + E2E tests.
- Band headers render lowercase in the DOM and uppercase via CSS, matching
  the Story 2.1 dock convention.

## Review brief (nine perspectives)

1. **Product** — Operator can Stop only Claude's current turn, inspect
   partial work, and Send now on the same session without cancelling the
   node. Non-Claude stays queue-only.
2. **Architecture** — Single steering registry extended with tokenized turns;
   interrupt route awaits classified settlement; no second registry, no DB /
   SSE additions, no `interrupting` in wire types.
3. **Contracts** — `interruptSignal` vs `abortSignal`; capability
   `interrupt: 'native'|false`; terminal reasons
   `aborted_streaming|aborted_tools` only; OpenAPI interrupt response +
   optional `steeringSubState`.
4. **Security / reliability / data** — Message text never logged; stable
   error codes; detached/parked refusals preserved; usage/cost retained on
   interrupt without validation/re-ask/failure events.
5. **Performance** — Bounded fake delays; no vendor timing; locator/state
   waits; no timeout inflation to hide missing events.
6. **Completeness** — Direct + loop browser paths; loop-group via executor
   unit; both shells; failure/race ladder; visual/a11y metrics.
7. **Testing** — Unit (fake/registry/executor/server/dock) + Playwright both
   shells + Story 2.1 regression on enhanced fixtures.
8. **Operations / rollback** — Rollback removes new spec/scenario options and
   restores fixture directives; evidence/status revert with the feature.
9. **Maintainability** — Shared dock state machine; fixtures reused not
   duplicated; capability matrix generated; no third dock component.

## Final gate

| Command                                                                 | Result                 |
| ----------------------------------------------------------------------- | ---------------------- |
| `cd e2e && npm run typecheck`                                           | clean                  |
| `bun run --cwd e2e test:ui -- --grep 'interrupt and redirect'`          | 11 pass / 0 fail       |
| `bun run --cwd e2e test:ui -- --grep 'queue guidance'`                  | _(filled at closeout)_ |
| `bun run generate:capability-matrix && bun run check:capability-matrix` | OK                     |
| `bun run validate`                                                      | _(filled at closeout)_ |

Every row above is green. Story 2.3 is marked `done`.
