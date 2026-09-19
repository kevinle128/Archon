---
phase: 5
title: 'Deterministic E2E evidence and closeout'
status: pending
priority: P1
dependencies: [1, 2, 3, 4]
---

# Phase 5: Deterministic E2E evidence and closeout

## Goal

Prove the complete browser-to-provider flow against a real web-dispatched run without vendor/network timing: Stop interrupts an in-flight fake turn, the room becomes idle, Send now delivers queued plus new guidance on the same fake session, and direct/loop behavior and both shells match the accepted design.

The real Claude primitive itself is proven by Phase 1's manual spike and provider tests; the e2e fake proves Archon's integration and UI deterministically.

## Files

| File                                                                       | Change                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/providers/src/e2e-fake/provider.ts` and test                     | Add deterministic per-turn interrupt handling and an opt-in tool-before-wait scenario; preserve every existing no-interrupt sequence. |
| `e2e/fixtures/workflows/e2e-queue-guidance.yaml`                           | Extend the already-seeded direct fixture with the opt-in interruptible tool scenario.                                                 |
| `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml`                      | Extend the already-seeded loop fixture likewise.                                                                                      |
| `e2e/ui/agent-interrupt-redirect.spec.ts`                                  | Add both-shell flow, route smoke, loop parity, accessibility, geometry, contrast, and screenshots.                                    |
| `reports/acceptance.md`                                                    | Map every plan acceptance criterion to automated/manual evidence and final command result.                                            |
| `reports/evidence/`                                                        | Store named screenshots and measured geometry/contrast JSON following the existing issue-plan convention.                             |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Change only Story 2.3 from `backlog` to `done`, and only after all gates pass.                                                        |

Do not add duplicate interrupt workflow fixtures or modify `e2e/lib/playwright/archon-runtime.ts`; both queue-guidance fixtures and constants are already seeded/exported. Keep the existing queue-guidance spec green against the enhanced fixtures.

## E2E-fake contract

Add a strict `interruptible: true` scenario option with validation that it is paired with `emitTool:true` and a positive bounded `delayMs`.

For the opt-in path:

1. Resolve/reuse the fake session id.
2. Emit the existing assistant chunk and tool call immediately, but not its result.
3. Wait for the first of node `abortSignal`, turn `interruptSignal`, or the bounded delay, removing all listeners/timers afterward.
4. Node abort throws the existing `Query aborted`.
5. Turn interrupt yields a matching `tool_result` with `toolOutcome:'interrupted'`, then a result with the same session id and `terminalReason:'aborted_tools'`.
6. Natural delay completion yields the current successful tool result and continues through existing echo/done/result behavior.

Because the fake advertises native interruption for this story, a provided `interruptSignal` must also have defined behavior outside the opt-in visual scenario: an interrupt during an existing delay returns a normalized interrupted result (and an interrupted tool result only when a tool call has actually been emitted). Calls with no interrupt signal or no interrupt event retain their exact existing chunks.

Unit tests cover node-abort precedence, already-aborted signals, exactly-once listener cleanup, natural timeout, interrupt before/after tool emission, same-session result, and unchanged default scenarios.

## Fixture use

Enhance the first-turn directives:

- direct: `{"interruptible":true,"emitTool":true,"delayMs":30000}`;
- loop: `{"interruptible":true,"emitTool":true,"delayMs":25000}`.

The redirect typed by the test includes `echoPrompt:true` and a bounded delay so the generating-again state remains observable. The loop redirect also includes `doneWhenPromptIncludes` so the same interrupted iteration can finish deterministically.

The existing Story 2.1 natural-boundary tests must still pass: when no Stop occurs, the bounded delay completes, the tool succeeds, and queued guidance drains exactly as before.

## Playwright scenarios

### Both-shell direct flow

Run once for Legacy and Console:

1. Start the direct fixture from the web and open the live node room.
2. Assert projected generating renders Stop + Queue and the fake tool is in flight.
3. Queue two messages and verify receipt order.
4. Activate Stop; assert one interrupt request, `Stopping…` is focusable with `aria-disabled` and no `disabled`, Queue remains usable, and the polite region says `agent interrupting`.
5. On response, assert the node is still `running`, Stop is gone, Send now and exact disclosure render, header/list say Will send, the tool card reads `⚠ interrupted`, and focus is the last transcript row (not body).
6. Verify blank Send now and its shortcut issue no request.
7. Type a third message and activate Send now. Assert the request body contains only that message with `intent:'send_now'`; all three displayed items leave the band.
8. Assert generating returns, then transcript contains exactly one `[e2e-fake] resumed echo: first\n\nsecond\n\nthird` in the same node occurrence/session.
9. Let the run finish and assert no interrupted-turn `node_failed`/`dag_node_failed` event.

### Failure and race behavior

- Intercept one Send-now response to prove the band restores old then new order, the new message remains retryable, the role-alert copy is exact, and no old receipt is POSTed again.
- Queue during the in-flight interrupt and prove it appears under Will send after idle.
- Call interrupt again while idle and expect idempotent 200 idle.
- Call interrupt after terminal and expect 409 `node_finished`.
- Natural-end `generating` and empty-finished races remain deterministic route/engine unit tests; do not add timing-flaky browser sleeps solely to reproduce them.

### Loop parity

Run the enhanced loop fixture, Stop, then Send now with an echo/done redirect. Assert:

- one `loop_iteration_started` and one node occurrence;
- redirect echo is marked resumed and appears before `E2E_LOOP_DONE`;
- completion checks run only after the redirected turn;
- no `×2` iteration group appears.

Loop-group body parity remains a focused executor test because no separate browser fixture is needed to prove a path already delegated to direct-node execution.

## Visual and accessibility evidence

Use locator/state waits, never fixed sleeps. Capture and measure:

- both shells at the authoritative 460px effective panel width: generating with queue, interrupting, idle, and generating again;
- both shells at a 1440×900 desktop viewport: idle dock in full room context and restored delivery failure;
- both shells under reduced motion for the interrupt transition;
- JSON metrics for panel/control widths, 32px targets, stable ≥84px send width, no horizontal overflow, band max height/scrollability, focus-ring and Stopping text contrast, active element, and transcript visibility before/after dock growth.

Screenshots supplement DOM/computed-style assertions; they do not replace them. Names include shell, state, and viewport.

## Acceptance report and documentation impact

`reports/acceptance.md` records:

- each top-level acceptance criterion and its test/evidence path;
- the Phase 1 real-SDK result without secrets/content;
- focused and full validation commands with pass/fail;
- any accepted visual delta from the mockup (none may be unrecorded).

No evergreen docs page currently documents the Story 2.1 queue dock, so this slice does not invent a new isolated docs page. The generated capability matrix and OpenAPI types are the owning machine-readable documentation. Reassess only if implementation discovers an existing live-steering page.

## Validation and closeout order

```bash
cd packages/providers
bun test src/e2e-fake/provider.test.ts
bun run type-check
cd ../../e2e
npm run typecheck
cd ..
bun run --cwd e2e test:ui -- --grep 'interrupt and redirect'
bun run --cwd e2e test:ui -- --grep 'queue guidance'
bun run validate
```

After every command is green:

1. Review evidence against all nine perspectives in the issue-plan review brief (product, architecture, contracts, security/reliability/data, performance, completeness, testing, operations/rollback, and maintainability) and complete `reports/acceptance.md`.
2. Change only `2-3-interrupt-and-redirect-a-running-claude-agent` to `done` in sprint status. Do not “fix” the stale Story 2.1 status in issue #183.
3. Review the final diff for secrets, prompts, generated churn, duplicate fixtures, and accidental production logging.
4. If opening a PR is in scope for the implementation session, target `develop`, use the repository template, include only material sections, and add `Closes #183`. Use a conventional commit without AI attribution.

## Completion criteria

- Fake/provider, existing queue-guidance, new interrupt E2E, and full validation pass.
- Evidence proves both shells, direct and loop paths, same-session redirect, interrupted transcript outcome, focus/announcement behavior, and required viewports.
- Sprint status changes only after proof; no server/process started by validation is left running.

## Risks and rollback

- Browser timing is controlled by an explicit bounded fake scenario and state/route waits; do not increase test timeouts to hide a missing event.
- Enhancing shared fixtures can regress Story 2.1, which is why its existing spec is an explicit gate.
- Rollback removes the new spec/scenario and restores the two fixture directives; evidence/status changes are reverted with the feature.
