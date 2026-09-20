---
phase: 3
title: 'Docs, capability matrix, and closeout'
status: pending
priority: P2
effort: '0.25d'
dependencies: [1, 2]
---

# Phase 3: Docs, capability matrix, and closeout

## Goal

Make the user-facing and generated documentation state what OMP's `Stop` does, prove the generated matrix is current, run the full pre-PR gate, and move the sprint-status entry to `done` with the evidence recorded.

This phase is outlined (deep mode). **Scout pass before execution:** re-read the OMP section of `ai-assistants.md` and the matrix legend; confirm `bun run generate:capability-matrix` still owns `provider-capabilities.md` end to end.

## Context links

- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` §"OMP CLI (Community Provider)"
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` (generated; legend describes `stream-abort`)
- `scripts/generate-capability-matrix.ts` (renders `**stream-abort**` already)
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` key `2-5-interrupt-and-redirect-a-running-omp-agent`
- Spike evidence from Phase 1: `reports/omp-interrupt-resume-spike.md`

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md` | regenerate | 1 cell | `check:capability-matrix` |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` | modify | ~10 lines | none |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify | 1 line | none |

## Dependency map

- Depends on Phase 1 (measured numbers) and Phase 2 (conformance evidence).

## Implementation contract

### `ai-assistants.md` OMP section

Add a short "Interrupt and redirect (operator Stop)" note after the `--yolo` paragraph:

- `Stop` in the node room sends SIGTERM to the OMP child (SIGKILL after the grace measured in Phase 1); OMP's signal teardown persists the session, and `Send now` continues it with `--resume`.
- The interrupted turn's partial work stays on disk and in the session; Stop does not undo it (matches the dock disclosure).
- If Stop lands before OMP prints its session header (state the measured window), the node fails explicitly rather than continuing on a fresh session.
- Mid-turn steering (`steer` in RPC mode) is not used in this version; guidance is delivered as the next turn.
- Usage from a turn stopped before OMP reported its first `message_end` is not recorded (state what the spike measured); advisor/subagent usage already on disk is still enriched fail-soft.
- Stop and Send now follow the node room's actor grant (any authenticated user; identity-less runs allowed) — the same posture as every other provider.

Keep it to the smallest owning surface; do not duplicate the matrix.

### Capability matrix

`bun run generate:capability-matrix` then `bun run check:capability-matrix`. The OMP cell in the "Turn interrupt (operator Stop)" row must read `**stream-abort**`.

### Closeout

- Run `bun run validate` from the repo root (never root `bun test`).
- Update `sprint-status.yaml`: `2-5-interrupt-and-redirect-a-running-omp-agent: done`.
- In the PR body (template at `.github/pull_request_template.md`), cite the spike report and the executor matrix rows as the "Focused tests / characterization evidence" the issue requires; `Closes #185`.

## Tests before

- `bun run check:capability-matrix` fails before regeneration (proves the check sees the flip).

## Refactor

- None.

## Tests after

- `bun run check:capability-matrix` passes; `bun run validate` passes.

## Todo

- [ ] Scout pass on the two docs files.
- [ ] Regenerate + check the matrix.
- [ ] Write the OMP Stop note with the Phase 1 numbers.
- [ ] `bun run validate`.
- [ ] Flip `sprint-status.yaml` to `done`; open the PR with the template.

## Regression gate

```bash
bun run generate:capability-matrix
bun run check:capability-matrix
bun run validate
```

## Success criteria

- Docs state SIGTERM semantics, session persistence, the explicit early-Stop failure, and the no-soft-inject boundary.
- Matrix current; validate green; sprint status `done`.

## Risk assessment

- **Docs drift from measurement:** the numbers come from the spike report, not from the scout report's source reading.
- **Premature `done`:** the flip is the last todo, after validate.

## Next steps

Stories 2.4 (Codex), 2.6 (Grok), 2.7 (DeepSeek) can reuse the `stream_aborted` contract; the decision to parameterise the executor fixtures is deferred to them.
