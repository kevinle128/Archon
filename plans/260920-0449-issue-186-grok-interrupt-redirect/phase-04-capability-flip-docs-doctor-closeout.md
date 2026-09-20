---
phase: 4
title: "Capability flip, docs, doctor, closeout"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1, 2, 3]
---

# Phase 4: Capability flip, docs, doctor, closeout

## Goal

Publish exactly what Phases 1–3 proved: the regenerated capability matrix, an operator guide that states the version floor, supported platforms, and written-work semantics, an `archon doctor` check that fails closed below the floor, an acceptance report, and the sprint row moved to `done` last.

## Context links

- Doctor: `packages/cli/src/commands/doctor.ts:268-320` (`checkGrok` runs `--version` then `models`); tests `packages/cli/src/commands/doctor.test.ts:289+`.
- Floor constant (Phase 2): `packages/providers/src/grok/config.ts` → `GROK_MIN_INTERRUPT_CLI_VERSION`.
- Guide: `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` → `## Grok Build` (`:262`), subsections Install / Authenticate / Configuration Options.
- Generated matrix: `packages/docs-web/src/content/docs/reference/provider-capabilities.md` (regenerate via `bun run generate:capability-matrix`; never hand-edit).
- Sprint status: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:73`.

## Files to create / modify

| File | Action | Size | Test impact |
|------|--------|------|-------------|
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md` | regenerate | 1 cell | `check:capability-matrix` |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` | modify (new `### Interrupt and redirect` under Grok Build) | +25–40 | docs build |
| `packages/cli/src/commands/doctor.ts` | modify `checkGrok` | +25 | D1–D5 |
| `packages/cli/src/commands/doctor.test.ts` | modify | +80 | D1–D5 |
| `plans/reports/acceptance-<yymmdd-hhmm>-issue-186-grok-interrupt.md` | create | ~100 | evidence |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify **last** | 1 line | none |

## Tests before

- `doctor.test.ts` existing `checkGrok` cases (:289+): unconfigured skip and resolve failure stay unchanged. The authenticated-pass case (`:316-329`) and the auth-failure case (`:333-345`) currently fabricate `stdout: 'grok 1.0.0\n'`, which is **below** the 1.0.34 floor and would fail closed before `models` — bump both fixtures to a version ≥ the floor **first**, keeping their assertions otherwise intact (red-team #14). Only then is the suite a valid regression baseline.
- `bun run check:capability-matrix` passes with Phase 2's flipped constant (already regenerated there).

## Refactor (doctor)

`checkGrok`: after `--version`, parse `^grok (\d+)\.(\d+)\.(\d+)` anchored at the start of the trimmed stdout (red-team #6); compare against `GROK_MIN_INTERRUPT_CLI_VERSION` (import from `@archon/providers`; no new dependency — a three-part numeric compare). Below the floor or unparsable → `status: 'fail'` with the actual string, the required floor, and the upgrade hint, **before** the authenticated `models` probe. Do not spawn anything per turn; this is a doctor-time diagnostic only.

## Tests after

| ID | Case | Assertion |
|----|------|-----------|
| D1 | version equals the floor | pass; `models` probe runs |
| D2 | version newer than the floor | pass |
| D3 | version older | fail before `models`; message includes actual + required + upgrade command |
| D4 | unparsable `--version` output | fail closed with the raw string capped at 1000 chars (mirrors `exitError`'s cap) |
| D5 | supported version, `models` fails | existing auth failure message unchanged |

## Documentation requirements (Grok guide)

State plainly: `Stop` ends the current Grok workflow turn and keeps the node running for `Send now` on the same session; an in-flight tool shows as interrupted and file changes already made are not rolled back; this is interrupt-then-continue, not hook-based soft injection; the exact minimum Grok CLI version and how to check/update; the supported platforms **exactly as Phase 1 evidenced** (no inferred Windows claim; if the Windows decision was "scope out" or "POSIX-only", say so and what happens on win32); a forced termination, failed persistence, or Stop-before-first-output timeout is reported as a provider failure, not a successful interrupt; a turn interrupted before Grok's `end` event may carry no token/USD accounting; a Stop pressed before Grok has produced any output is held until Grok's first event (bounded by the arm timeout) and node Cancel remains immediate; on Windows, state exactly what the recorded decision produces (proven support, or an explicit `grok_interrupt_unsupported_platform` failure when Stop is pressed); if Phase 1 found `M` precedes prompt persistence, note that a Stop before the first model output replaces the original prompt with the operator's message.

## Closeout sequence

1. Focused CLI/provider/workflow tests; regenerate matrix; docs build.
2. `bun run validate` (never `bun test` from the repo root).
3. Acceptance report mapping every Story 2.6 acceptance criterion and every `plan.md` success criterion to a test name, spike gate, or doc anchor; include tested build/platforms, the Windows decision, the accounting boundary, and rollback.
4. Review from product, architecture, contracts, security/reliability, performance, completeness, testing, operations/rollback, and maintainability angles; fix or record each finding; re-run affected gates.
5. Move only `2-6-interrupt-and-redirect-a-running-grok-agent` to `done`.
6. PR via `.github/pull_request_template.md` with `Closes #186`, linking the round-2 spike and acceptance reports. No Workflow Language Constitution citation (no YAML surface change).

## Todo

- [ ] Doctor floor check D1–D5
- [ ] Grok guide section
- [ ] Matrix regenerated, `check:capability-matrix` green
- [ ] `bun run validate` green
- [ ] Acceptance report
- [ ] Multi-angle review resolved
- [ ] Sprint row → `done`; PR opened

## Regression gate

```bash
cd packages/cli && bun test src/commands/doctor.test.ts
cd ../.. && bun run generate:capability-matrix && bun run check:capability-matrix && bun run validate
```

## Success criteria

- Doctor fails closed below the floor and on unparsable output; passes at/above it.
- Guide claims match Phase 1 evidence and the recorded Windows decision word for word on platform support.
- `bun run validate` green; acceptance report complete; sprint row `done`.

## Risk assessment

- **Doc drift vs. decision** — the platform sentence must be written from the Validation Log, not from memory.
- **Floor too strict** — only 1.0.34 is proven; if an older build is common, that is a follow-up spike, not a silent relaxation.

## Rollback

Revert capability constant (Phase 2), doctor check, and guide section together; regenerate the matrix.
