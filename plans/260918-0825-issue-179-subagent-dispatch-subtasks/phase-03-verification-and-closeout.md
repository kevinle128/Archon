---
phase: 3
title: 'Phase 3: Deterministic full-stack verification and closeout'
status: todo
priority: P1
effort: '4h'
dependencies: [1, 2]
---

# Phase 3: Deterministic full-stack verification and closeout

## Goal

Prove both provider shapes on both production UI surfaces through the existing isolated fake-provider runtime, capture visual/accessibility evidence at the required sizes and states, pass every relevant gate, and only then close the sprint item.

This replaces the draft's credential-dependent/manual or static-HTML fallback. Those paths cannot reliably prove stored messages, the built application, disclosure semantics, computed styles, network behavior, or both room shells.

## Files

| Path                                                                                  | Action                                                            |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/providers/src/e2e-fake/provider.ts`                                         | Extend its strict scenario schema and deterministic tool emission |
| `packages/providers/src/e2e-fake/provider.test.ts`                                    | Prove both exact task payloads and compatibility                  |
| `e2e/fixtures/workflows/e2e-task-dispatch.yaml`                                       | Create two-node deterministic fixture                             |
| `e2e/lib/playwright/archon-runtime.ts`                                                | Seed fixture, export node/workflow constants, expose run method   |
| `e2e/ui/task-dispatch-body.spec.ts`                                                   | Create behavior, visual, a11y, responsive, and network proof      |
| `plans/260918-0825-issue-179-subagent-dispatch-subtasks/reports/visual-acceptance.md` | Record measured results and artifact names                        |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`            | Mark done only after all verification passes                      |

The fake provider is registered only under `ARCHON_E2E_FAKE_PROVIDER=1`; this phase must not touch real provider adapters or change default registration.

## Deterministic fixture design

### Fake-provider scenario

Extend the existing strict scenario object with:

```ts
taskDispatch: z.enum(['omp', 'claude']).optional();
```

Rules:

- `taskDispatch` and `emitTool` are mutually exclusive; invalid combinations fail scenario validation instead of picking a branch.
- `taskDispatch: 'omp'` emits exactly one tool call named `Task` with synthetic input:
  - markdown context containing emphasis, a list, a blocked image URL, and an unsafe-scheme link for security assertions;
  - two tasks with distinct names, agents, and multiline prompts.
- `taskDispatch: 'claude'` emits exactly one tool call named `Agent` with required `description`/`prompt` and no `subagent_type`, exercising the nullable agent path.
- Each emits the existing deterministic tool result/outcome sequence and stable exported fixture constants. No network, model call, delay, randomness in payload content, or real user data.
- Existing `emitTool`, repetition, large-output, AskHuman, usage, and default scenarios remain byte-for-byte compatible.

Provider tests assert exact emitted `toolName`, `toolInput`, call/result pairing, and mutual-exclusion failure. This is test-fixture behavior, not a production-provider contract.

### Workflow/runtime

Create `e2e-task-dispatch.yaml`:

- node `omp-dispatch` runs `e2e-fake` with `{"taskDispatch":"omp"}`;
- node `claude-dispatch` depends on it and runs with `{"taskDispatch":"claude"}`;
- both use the fake model, have `mutates_checkout: false`, and complete without an approval gate.

Update `ArchonRuntime` to copy this fixture into its isolated `ARCHON_HOME`, export workflow/node constants, and provide `runTaskDispatchWorkflow(): Promise<CliRunResult>`. Reuse the existing CLI runner and owned-process cleanup; do not create another server, port strategy, or database seeder.

## Playwright proof

Create `e2e/ui/task-dispatch-body.spec.ts` using the shared `suite` fixture and existing room-opening conventions. Parameterize the production assertions over `console` and `legacy`; one workflow run per surface may visit both nodes.

### Valid mapping and body content

For each surface:

1. Register request observation before navigating to `omp-dispatch`, then open the node and locate its single tool row; closed `<details>` content is already mounted.
2. Assert the closed row is single-line and contains `Task` plus `2 subagents`.
3. Open it by keyboard. Assert the body bar begins `task · batch · 2 subtasks`, any runtime fact appears once after that prefix, context markdown precedes two row-scoped subtask cards, and no `<img>` is present.
4. Assert the unsafe link has no executable `javascript:` target. Observe page requests and prove the fixture's image URL was never requested.
5. Use Chromium accessibility evidence to verify each card summary is a collapsed disclosure named in the order `agent · subtask — excerpt`, with decorative chevron excluded. Verify DOM tab order, including Raw before the cards when Story 1.2 is present.
6. Focus and open the first card by Enter. Assert expanded state, complete multiline prompt, preserved focus, and unchanged outer-row open state. Close with Space.
7. Open `claude-dispatch`. Assert `1 subagent`, a body bar beginning `task · single dispatch` with no repeated subagent count, exactly one card, no context block, and a readable summary without an orphan agent separator. Open it and verify the complete prompt.

### Computed visual contract

At each design reference width—460px Legacy and 520px Console—assert computed styles rather than class strings:

- card background resolves to `--surface-elevated`;
- 1px border, 6px radius, 6px/9px padding, 5px top margin;
- summary minimum height at least 24px and font size 11.5px;
- agent weight 600 and color derived from `--node-approval`; subtask name bold; excerpt `--text-secondary`;
- chevron 9px column / 10px type / 120ms transform, and zero transition duration under reduced motion;
- prompt box resolves to `--surface-inset` and wraps without horizontal overflow;
- focused summary has solid 2px `--accent-bright` outline with -2px Legacy / +2px Console offset.

Calculate contrast from computed foreground/background colors for agent, name, excerpt, and prompt on both surfaces. Every text pair must be at least 4.5:1. Attach a JSON record and row/room screenshots through `testInfo`, following `agent-tool-row-visual.spec.ts` conventions.

### Responsive states

For both surfaces, run the OMP row/card state through:

- the surface's reference room width (460px Legacy / 520px Console) inside a 1440x1000 viewport;
- 390x844 viewport using the room's production responsive layout;
- 200% browser zoom using the established CDP device-metrics approach.

At each state, outer and card summaries stay one line, the opened prompt remains usable, and the room has no horizontal overflow attributable to the task body. Do not invent a task-specific breakpoint.

### Artifact/report contract

Attach at least:

- `legacy-task-body-460.png`
- `console-task-body-520.png`
- `legacy-claude-task-460.png`
- `console-claude-task-520.png`
- `task-card-contrast.json`

Write `reports/visual-acceptance.md` with the command/commit, artifact names, mapping/content results, geometry table, contrast table, focus/keyboard/AX findings, reduced-motion result, request-observation result, and responsive/zoom results. Compare the captures against the task sections in `key-transcript-states.html` and `full-transcript-review.html`, plus the collapsed task rows in both surface mockups; record every visible delta and its authority-based disposition. Use only synthetic fixture text.

## Test order and commands

Run focused gates first:

```bash
cd packages/providers
bun test src/e2e-fake/provider.test.ts

cd ../web
bun run test
bun run type-check

cd ../..
bun run build:web

cd e2e
npm run typecheck
ARCHON_E2E_PROOF=1 npx playwright test -c playwright.config.ts ui/task-dispatch-body.spec.ts

cd ..
bun run validate
```

If the standalone E2E package has not been installed in the environment, run its documented `npm ci`/browser setup first; do not add it to the Bun workspace. Never run root `bun test`.

## Failure handling

- A skipped, unsupported, flaky, or credential-dependent task-dispatch scenario is not evidence. Fix the deterministic fixture or report the blocking environment.
- If a visual assertion exposes a production defect, fix both renderer copies, add/strengthen the Phase 2 component assertion, rebuild, and rerun Playwright.
- If Story 1.2/1.3 merged during implementation, re-run their focused suites after conflict resolution and verify one readable-vs-Raw tree remains.
- The runtime fixture already owns server PIDs, ports, temp homes, and cleanup. Do not start an extra detached dev server or reuse the operator's database.
- Never weaken geometry/contrast/overflow checks merely to make a screenshot look acceptable.

## Closeout

1. Confirm focused web/provider/Playwright commands and `bun run validate` are green on the final diff.
2. Review the diff against every plan acceptance criterion and the nine audit perspectives listed below.
3. Write the completed `visual-acceptance.md`; do not pre-fill measurements.
4. Change `1-6-inspect-a-subagent-dispatch-and-its-subtasks` from `in-progress` to `done` in `sprint-status.yaml` only now.
5. Use the repository PR template, keep its required sections, include exact validation commands/artifacts, and add `Closes #179`. Target the current verified working integration branch.

## Final implementation audit

Before declaring done, explicitly confirm:

1. **Product outcome:** an operator can identify every accepted dispatch and open its full prompt on both surfaces.
2. **Architecture:** provider differences stop in `lib/`; JSX consumes render-neutral fields; Console isolation holds.
3. **Contracts:** exact mapping, body-bar words, badge words, generic fallback, and no per-subtask outcome match canonical docs.
4. **Security/reliability/data integrity:** total bounded projection, no partial dispatch, no payload logging, safe markdown, no storage mutation.
5. **Performance/scalability:** explicit entry/text/excerpt/key limits, no new memo/cache/virtualizer, responsive overflow proof.
6. **Completeness:** Legacy, selected Console, inline Console, fake provider, fixture/runtime, and tracker are all accounted for.
7. **Testing:** unit/component/full-stack/visual/a11y evidence covers happy, nullable, malformed, boundary, and interaction paths.
8. **Operations/compatibility/rollback:** no migration/config/flag, historical data untouched, sibling merge order verified, ordinary revert works.
9. **Maintainability:** one shared interpretation, two thin renderers, no speculative abstraction or provider-specific UI branch.

## Exit criteria

- Task-dispatch Playwright proof passes on both surfaces with both shapes and no skips.
- Required screenshots and computed evidence are attached and summarized in the report.
- `bun run validate` passes on the final tree.
- Sprint status is done and the PR closes #179.
