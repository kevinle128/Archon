---
phase: 3
title: 'Phase 3: Corpus audit, release gate, and verification'
status: pending
priority: P1
effort: '1d'
dependencies: [1, 2]
---

# Phase 3: Corpus audit, release gate, and verification

> Deep-mode outline. A dedicated scout pass runs before execution to re-read the HITL E2E specs as they stand after Story 1.2 and the release skill's current step order.

## Goal

Ship the read-only generic-fallback audit and its release gate, prove the bodies end to end on both surfaces, run the full validation, and close the story.

## Context links

- Audit contract: `_bmad-output/specs/spec-agent-node-room/test-plan.md:38-44`; Story AC `epics.md:282-285`
- Script precedent: `scripts/migrate-state-dir.ts:1-40` (docblock, dry-run default, exit codes); cross-package import precedent `scripts/node-ref-parity.test.ts` via `scripts/tsconfig.json` `@/*` mapping
- Release skill: `.claude/skills/release/SKILL.md:69` (Step 1.5), `:130` (Step 2) — the new gate slots between them
- E2E: `e2e/ui/workflow-run-hitl-room.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`; runner `e2e/package.json:9` (`test:ui:hitl`)
- Closing records: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:60`; evidence convention `1-1-evidence.md` (commit `b261a00e`)

## Requirements

- [ ] `scripts/audit-generic-fallback.ts` replays the resolver over the deployment corpus **read-only** (`bun:sqlite` `{ readonly: true }`), never writes to the database, and records `{ snapshotDate, dbPath (basename only), calls, generic, fraction, topGenericNames[≤10] }`.
- [ ] Denominator = one row per tool **call**: `metadata.tool_phase === 'call'`, or no `tool_phase` and no `payload.output`. Numerator = those rows whose `toolPresentation({ name, input, output: undefined }).family === 'generic'`. The definition is in the script docblock.
- [ ] `--db <path>` defaults to `${ARCHON_HOME ?? ~/.archon}/archon.db`; a missing file or a `DATABASE_URL` pointing at PostgreSQL without an explicit `--db` errors out with a message (SQLite only — explicit, not silent).
- [ ] `--check` reads the committed record and exits `1` when it is missing, malformed, or `fraction >= 0.02`, printing the snapshot date and numbers either way. Default invocation replays and writes the record; `--dry-run` replays and prints only.
- [ ] The record lives at `docs/release-audits/generic-fallback.json` and the first committed record comes from the local corpus (expected ≈ 20/1,966 = 1.02%).
- [ ] `.claude/skills/release/SKILL.md` gains a step that runs `bun run scripts/audit-generic-fallback.ts --check` and aborts the release on failure, with the instruction to re-run the audit against the deployment database first.
- [ ] E2E (HITL, both surfaces): an expanded shell row shows its command and output text and no JSON; an expanded generic row shows kv pairs; Raw still swaps.
- [ ] Visual/a11y evidence: body-box contrast ≥ 4.5:1 for text-primary and text-secondary on `surface-inset` (both surfaces), no horizontal scroll at 460 px, reduced-motion unaffected, screen-reader pass over one open shell row and one open matches row.
- [ ] `bun run validate` green; local `bun run --cwd e2e test:ui:hitl` green and recorded.
- [ ] `sprint-status.yaml:60` → `done`; `1-3-evidence.md` records focused tests, package tests, validate, HITL run, and the audit numbers.

## Architecture

```text
scripts/audit-generic-fallback.ts
  parse args → open SQLite readonly → SELECT payload, metadata FROM remote_agent_workflow_node_messages WHERE kind='tool'
  → filter call rows → toolPresentation(...) per row → tally → write docs/release-audits/generic-fallback.json | --check
```

Imports `toolPresentation` by relative path (`../packages/web/src/lib/tool-presentation`); the module's only import is `./format`, which is browser-free.

## Related code files

- Create: `scripts/audit-generic-fallback.ts`, `scripts/audit-generic-fallback.test.ts` (fixture DB in a temp dir; no network, no real `~/.archon`), `docs/release-audits/generic-fallback.json`
- Modify: `.claude/skills/release/SKILL.md`, `e2e/ui/workflow-run-hitl-room.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`
- Modify: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`; Create: `_bmad-output/implementation-artifacts/agent-node-room/1-3-evidence.md`
- Optional: `package.json` script alias `audit:generic-fallback` if the release skill prefers a named script

## File inventory

| File                                                    | Action | Size   | Test impact                              |
| ------------------------------------------------------- | ------ | ------ | ---------------------------------------- |
| `scripts/audit-generic-fallback.ts`                     | create | ~180 L | new script test                          |
| `scripts/audit-generic-fallback.test.ts`                | create | ~120 L | runs in the root `bun test ./scripts/` leg |
| `docs/release-audits/generic-fallback.json`             | create | small  | read by `--check`                        |
| `.claude/skills/release/SKILL.md`                       | modify | +15 L  | —                                        |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                 | modify | +40 L  | HITL run                                 |
| `e2e/ui/agent-tool-row-visual.spec.ts`                  | modify | +60 L  | HITL run                                 |
| `sprint-status.yaml`, `1-3-evidence.md`                 | modify/create | small | —                                   |

## Implementation steps (outline)

1. Scout pass: re-read the HITL specs post-1.2 and the release skill step order.
2. Tests before (red): script test over a temp fixture DB with known call/result rows (including rows without `tool_phase`), asserting denominator, numerator, record shape, `--check` exit codes, and that the DB file's mtime/size are unchanged after a run.
3. Implement the script; run it against the local corpus; commit the record.
4. Add the release-skill step; add the E2E body assertions; run HITL locally.
5. Visual/a11y evidence captured under the plan's `reports/` directory.
6. `bun run validate`; flip `sprint-status.yaml`; write `1-3-evidence.md`.

## Test scenario matrix

| Path     | Scenario                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Critical | Fixture DB: 4 call rows (1 generic) + 4 result rows → `calls: 4`, `generic: 1`, `fraction: 0.25`      |
| Critical | `--check` with fraction ≥ 0.02 → exit 1; with 0.0102 → exit 0; record missing → exit 1 with message   |
| Critical | Database bytes untouched after a full run (readonly open; compare size + mtime)                       |
| Critical | E2E both surfaces: open shell row → `$` + command + output visible, body contains no `"stdout"`       |
| High     | Legacy row without `tool_phase` metadata and no output counts as a call                               |
| High     | `DATABASE_URL=postgres://…` without `--db` → explicit error, exit 2                                   |
| High     | E2E: Raw open hides the family body; Raw close restores it                                            |
| Medium   | `topGenericNames` capped at 10 and sorted by count desc                                               |
| Medium   | Contrast + 460 px geometry recorded for terminal, matches, and kv bodies on both surfaces              |

## Tests before / Refactor / Tests after

- **Tests before**: script test (red on missing module), E2E body assertions (red against the empty 1.2 slot).
- **Refactor**: none in product code; the release skill gains a step.
- **Tests after**: script test green; HITL green; `bun run validate` green.

## Regression gate

```bash
bun test ./scripts/audit-generic-fallback.test.ts
bun run scripts/audit-generic-fallback.ts --dry-run && bun run scripts/audit-generic-fallback.ts --check
bun run validate
bun run --cwd e2e test:ui:hitl
```

## Dependency map

- Depends on Phase 1 (resolver bodies) and Phase 2 (bodies on screen for E2E).
- Blocks story closure.

## Todo

- [ ] Script red tests, then implementation
- [ ] First record committed from the local corpus
- [ ] Release-skill step added
- [ ] E2E body assertions green on both surfaces (local HITL run recorded)
- [ ] Visual/a11y evidence under `reports/`
- [ ] `bun run validate` green
- [ ] `sprint-status.yaml` → `done`; `1-3-evidence.md` written

## Success criteria

- Audit record committed with fraction < 2%; `--check` passes; release skill references it; validate and HITL green; story closed in the tracker.

## Risk assessment

| Risk                                                                      | Signal                                   | Response                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Deployment corpus at release time exceeds 2%                              | `--check` fails on a fresh record        | Inspect `topGenericNames`; add measured aliases (e.g. `get_output` → shell) in a follow-up PR with tests; never lower the gate |
| Root `bun test ./scripts/` leg picks up the script test with a real DB     | Test opens `~/.archon/archon.db`         | Test always passes `--db` to a temp fixture; assert no default-path access                     |
| HITL specs not run by CI for `develop` PRs                                | Green CI without E2E                     | The recorded local HITL run is a required PR item (same posture as 1.2)                        |

## Security considerations

- The audit reads payload names and inputs only to classify; the record contains counts and tool names, never payload bodies or paths beyond the DB basename.
- The script opens the database read-only and fails rather than falling back to a write-capable handle.
