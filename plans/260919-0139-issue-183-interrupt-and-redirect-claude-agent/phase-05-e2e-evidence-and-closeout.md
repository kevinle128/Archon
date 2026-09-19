---
phase: 5
title: 'E2E evidence and closeout'
status: pending
priority: P1
effort: '1d'
dependencies: [1, 2, 3, 4]
---

# Phase 5: E2E evidence and closeout

## Goal

A deterministic e2e-fake interrupt path lets Playwright drive Stop → idle-after-interrupt → Send now on both shells against a real web-dispatched run; visual and accessibility evidence is captured; the acceptance report maps every Story 2.3 criterion to a test; sprint status moves to `done` after all gates.

Deep mode: outline; scout pass `reports/scout-260919-0830-claude-provider-interrupt.md` §5 and `scout-260919-0830-server-web-dock.md` §6 precede execution.

## Files

| File                                                                                                | Action | Change                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `packages/providers/src/e2e-fake/provider.ts` (+ test)                                              | Modify | Opt-in `interruptible` scenario: emit a `tool` chunk, then hold on a bounded delay that resolves early when `interruptSignal` aborts; on interrupt yield `tool_result` (`toolOutcome:'interrupted'`) then `result { sessionId, terminalReason:'aborted_tools' }`; without interrupt end naturally after the delay. Capability `interrupt:'native'` (set in Phase 1). |
| `e2e/fixtures/workflows/e2e-interrupt-redirect.yaml`                                                | Create | One-node direct fixture on `e2e-fake` with the interruptible scenario + `echoPrompt`                  |
| `e2e/fixtures/workflows/e2e-interrupt-redirect-loop.yaml`                                           | Create | One-node AI-loop fixture (Send now continues the iteration)                                           |
| `e2e/lib/playwright/archon-runtime.ts`                                                              | Modify | Seed both fixtures; reuse the web-dispatch start helper                                               |
| `e2e/ui/agent-interrupt-redirect.spec.ts`                                                           | Create | Both-shell flow, route ladder smoke, loop, a11y, visual                                               |
| `plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/reports/acceptance.md`             | Create | Criterion → evidence map                                                                              |
| `plans/…/reports/evidence/`                                                                         | Create | Screenshots (generating, stopping, idle, generating-again) × both shells × 460px/1440 × reduced motion |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                          | Modify | `2-3-interrupt-and-redirect-a-running-claude-agent: done` after all gates                             |

## Refactor (protected change)

Only the opt-in e2e-fake scenario branch changes provider code; every default scenario keeps its chunk sequence (Tests After 2 pins it). Fixtures, runtime seeding, and the spec are additive.

## Tests before

- Story 2.1 e2e spec (`--grep 'queue guidance'`) green; e2e-fake default scenarios unchanged (provider tests).

## Tests after

| #   | Scenario                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | provider: interruptible scenario ends early on `interruptSignal` with the interrupted `tool_result` + marked `result`; same `sessionId`; no throw |
| 2   | provider: scenario without interrupt ends naturally; default scenarios byte-identical                                       |
| 3   | e2e (Legacy + Console): queue two messages → Stop → `Stopping…` `aria-disabled` → idle: `Send now`, `WILL SEND · 2`, disclosure, `⚠ interrupted` tool row → type third → Send now → transcript shows `[e2e-fake] resumed echo: first\n\nsecond\n\nthird` → dock generating again |
| 4   | e2e: loop fixture — Send now continues the same iteration (occurrence header count unchanged) before completion            |
| 5   | e2e: route smoke via `request` — repeat interrupt while idle → 200 idle; interrupt after finish → 409                       |
| 6   | e2e a11y: status region receives one announcement per transition; alert on a forced delivery failure (route intercept); focus never `<body>` after Stop and after node finish; reduced-motion snapshot |
| 7   | e2e visual: four states × both shells × 460px and 1440×900                                                                  |

## Closeout

1. `bun run validate` (includes `check:capability-matrix`, `check:bundled`, lint, type-check, all package tests).
2. Write `reports/acceptance.md` mapping the nine plan.md acceptance criteria to tests/evidence.
3. Move the sprint-status entry to `done`; note that `2-1-queue-guidance-for-a-running-agent` still reads `backlog` although #207 merged (owner to confirm whether to correct it in the same PR — validation question V5).
4. PR from this worktree branch into `develop` using `.github/pull_request_template.md` (Problem and outcome, Review guidance, Solution, Validation; `Closes #183`), attribution trailer per repo rules.

## Regression gate

```bash
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'interrupt'
bun run validate
```

## Todo

- [ ] e2e-fake interruptible scenario + tests
- [ ] Fixtures + runtime seeding
- [ ] Spec: flow, loop, route smoke, a11y, visual
- [ ] Evidence captured and referenced from `acceptance.md`
- [ ] `bun run validate` green; sprint status `done`; PR opened

## Success criteria

All Tests After green; evidence present; validate green; PR opened against `develop` with the template.

## Risk assessment

- Playwright timing around a sub-second interrupt: assert on dock state changes with explicit waits, not fixed sleeps; the fake's delay must be long enough (≥ 15 s) for the browser steps.
- Do not spawn extra servers: the e2e runtime owns its process; follow the process-management rules.
