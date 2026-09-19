---
phase: 3
title: 'Capability matrix, docs, and closeout'
status: pending
priority: P2
effort: '0.25d'
dependencies: [1, 2]
---

# Phase 3: Capability matrix, docs, and closeout

## Goal

Regenerate the canonical capability matrix, state the DeepSeek Stop behaviour in the provider docs, run the full validation gate, and record Story 2.7 as done only after evidence exists.

Deep mode: outline only; scout `scripts/generate-capability-matrix.ts:140–160` and `ai-assistants.md:879–913` before editing.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md` | regenerate (`bun run generate:capability-matrix`) | 1 cell | `check:capability-matrix` |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` | modify | 2–3 sentences in the DeepSeek section | — |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:74` | modify | `backlog` → `done` | — |

## Tests before

- `bun run check:capability-matrix` fails until regenerated (the DeepSeek cell must read `**native**`).

## Implementation steps

1. `bun run generate:capability-matrix`; confirm the DeepSeek Interrupt cell is `**native**` and nothing else changed.
2. `ai-assistants.md` DeepSeek section: add that operator `Stop` cancels the current DSH turn through ACP `session/cancel`, the node keeps running, and `Send now` resumes the same ACP session in a new DSH child; a concurrent message is not soft-injected (DSH rejects an in-flight second prompt), so `Queue` waits for the turn boundary.
3. Run the full gate (below). Attach the spike report path and focused test output to issue #187.
4. Move `2-7-interrupt-and-redirect-a-running-deepseek-agent` to `done` in `sprint-status.yaml` — last step, after the gate.

## Tests after

- `bun run check:capability-matrix` passes; `bun run validate` passes.

## Regression gate

```bash
bun run generate:capability-matrix && bun run check:capability-matrix
bun run validate
```

## Todo

- [ ] Matrix regenerated and checked
- [ ] DeepSeek docs sentence added
- [ ] `bun run validate` green
- [ ] Evidence attached to #187; sprint status → done

## Success criteria

Matrix, docs, and sprint status agree with the shipped behaviour; validation passes; issue #187 carries the evidence links.

## Risk assessment

- Marking `done` before the spike proves resume-after-cancel would ship a Stop that strands the node on `deepseek_resume_failed`; the ordering above prevents it.
