---
phase: 5
title: 'Closeout and spec sync'
status: pending
priority: P1
effort: '1.5h'
dependencies: [1, 2, 3, 4]
---

# Phase 5: Closeout and spec sync

## Goal

Record the characterization evidence, point the steering test plan at the
tests that now prove the "Concurrent operators" bullet, move the sprint entry
to `done`, and ship a validated PR that closes #193.

## Scout pass (run before editing)

1. `grep -n "## Concurrent operators" -A 3 _bmad-output/specs/spec-agent-node-room/steering-test-plan.md`
2. `grep -n "2-13-preserve" _bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
   (line 80 at plan time; the value is `backlog`).
3. `cat .github/pull_request_template.md`.
4. Re-read Phases 1–4 evidence reports under this plan's `reports/`.

## Context links

- Issue #193 acceptance checklist
- `steering-test-plan.md` → "Concurrent operators" (one bullet today)
- `sprint-status.yaml:80`
- `AGENTS.md` → Pre-PR Validation, Git Workflow and Releases

## Requirements

- The test plan names each new test by file and title, grouped by layer, and
  states the per-operator order mechanism (dock `sendInFlight`) and the
  non-goal (queue read carries no attribution).
- `sprint-status.yaml` entry moved to `done` and nothing else in the file
  changes.
- One evidence report `reports/characterization-evidence.md` under this plan
  consolidating: commands run, pass counts, E2E scenario ids, screenshot
  paths, and any product defect fixed (or "none").
- `bun run validate` green on the branch; PR uses the template; `Closes #193`.

## Files to create / modify

- Modify: `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`
- Modify: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
- Create: `plans/260920-0444-issue-193-concurrent-operator-order-attribution/reports/characterization-evidence.md`

## Tests before

None new — this phase runs the full gate:

```bash
bun run validate
```

## Refactor (protected code)

None.

## Tests after

None.

## Regression gate

```bash
bun run validate
cd e2e && npx playwright test agent-concurrent-operators
```

## Implementation steps

1. Replace the single "Concurrent operators" bullet with a short list naming:
   `steering-registry.test.ts` → `concurrent operators (Story 2.13)`;
   `api.workflow-runs.test.ts` → `send/queue — concurrent operators (Story 2.13)`
   and the read-model node-scoping tests; `dag-executor.test.ts` → the four
   mixed-operator tests; `e2e/ui/agent-concurrent-operators.spec.ts` →
   `[V:steer.concurrent-operators-console|legacy]`. Keep the existing sentence
   about receipt order and add one line each for: the per-dock (not
   per-identity) `sendInFlight` gate; the queue-read non-goal; the header
   trust boundary (attribution integrity on `X-Archon-User` holds only behind
   a trusted proxy or the Better Auth session — `AGENTS.md` → Config and
   provider metadata); cross-operator withdraw being an AD-11 grant with only
   log-level attribution; and the soft-inject forward note (prompt-join
   assertions characterize today's delivery).
   <!-- Updated: Red Team 2026-09-20 — findings S1, S3, A1, A6 -->
2. Edit `sprint-status.yaml:80` to `done`.
3. Write `reports/characterization-evidence.md`.
4. Run `bun run validate`; fix anything red.
5. Commit in focused conventional commits (tests per layer, docs/spec sync
   separately); open the PR against `develop` from the template with
   `Closes #193`; tick the issue's acceptance boxes in the PR body's
   Validation section.

## Todo

- [ ] test plan updated
- [ ] sprint status `done`
- [ ] consolidated evidence report written
- [ ] `bun run validate` green
- [ ] PR opened with template and `Closes #193`

## Success criteria

- Issue #193's three acceptance checkboxes are demonstrably satisfied by
  linked artifacts.

## Risk assessment

- Low. Documentation and status only; the gate is mechanical.

## Security considerations

- None beyond confirming no secrets or evidence containing tokens are
  committed (evidence screenshots show test identities only).

## Next steps

Merge to `develop`; unblocks no story in the ANR tracker (2.13 is a leaf).
