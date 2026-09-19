---
phase: 4
title: 'Capability matrix, docs, and closeout'
status: pending
priority: P2
effort: '0.25d'
dependencies: [1, 2, 3]
---

# Phase 4: Capability matrix, docs, and closeout

## Goal

Make the generated and hand-written surfaces reflect Grok's new `stream-abort` interrupt, assemble the story's evidence, and move the sprint tracker to `done` last.

## Context links

- `scripts/generate-capability-matrix.ts:70,153-160` and `packages/docs-web/src/content/docs/reference/provider-capabilities.md:60,80-83`.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` (Grok section — check for any "Stop is Claude-only" phrasing; none was found at planning time).
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:73`.
- Issue #186 acceptance checklist.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md` | regenerate | 1 cell | `bun run check:capability-matrix` |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` | modify only if it states provider-specific Stop support | ≤5 lines | none |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify | 1 line → `done` | none |
| `plans/260919-1924-issue-186-interrupt-and-redirect-grok-agent/reports/acceptance.md` | create | evidence map | none |

## Tests before (TDD)

Regression gate for generated files — run before editing so drift is attributable to this story:

```bash
bun run check:capability-matrix
bun run check:bundled && bun run check:bundled-schema
```

## Steps

1. `bun run generate:capability-matrix`; confirm the grok cell in the "Turn interrupt (operator Stop)" row renders `stream-abort` (the generator already maps the union, `scripts/generate-capability-matrix.ts:153`).
2. Grep docs for provider-specific Stop claims (`grep -rn -i "stop\b.*claude\|interrupt" packages/docs-web/src/content/docs`) and correct any that now exclude Grok.
3. Write `reports/acceptance.md` mapping AC1-AC8 from [plan.md](./plan.md) to test names, the spike report path, and command outputs.
4. Run the full gate: `bun run validate`.
5. Move `2-6-interrupt-and-redirect-a-running-grok-agent` to `done` in `sprint-status.yaml`.
6. Open the PR from the template (`.github/pull_request_template.md`), `Closes #186`, cite the Workflow Language Constitution only if a YAML surface changed (it does not here).

## Tests after

```bash
bun run check:capability-matrix
bun run validate
```

## Todo

- [ ] Matrix regenerated; check passes
- [ ] Docs audited for Claude-only Stop wording
- [ ] `reports/acceptance.md` maps every AC to evidence
- [ ] `bun run validate` green
- [ ] `sprint-status.yaml` moved to `done` (last)

## Success criteria

- `provider-capabilities.md` shows `stream-abort` for grok and `bun run check:capability-matrix` passes.
- Issue #186's three checkboxes are satisfiable from `reports/acceptance.md`.

## Risk assessment

- `bun run validate` includes every package's tests; a flaky unrelated suite must be reported, not retried into green.

## Next steps

Story 2.4 (Codex) and 2.5 (OMP) can reuse the Grok fake-process pattern and the G-scenario template.
