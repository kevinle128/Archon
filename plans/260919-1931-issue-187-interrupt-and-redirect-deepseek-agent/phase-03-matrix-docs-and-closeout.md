---
phase: 3
title: 'Generated matrix, provider docs, and closeout'
status: pending
priority: P2
effort: '0.25d'
dependencies: [1, 2]
---

# Phase 3: Generated matrix, provider docs, and closeout

## Goal

Make generated capability documentation and the DeepSeek guide match the verified behavior, run the complete repository gate, attach sanitized evidence to issue #187, and mark the story done only after every acceptance criterion is proven.

## File inventory

| File                                                                       | Action          | Purpose                                                                           |
| -------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md`    | regenerate only | DeepSeek Turn interrupt cell becomes `**native**`.                                |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`      | modify          | Explain Stop, idle, same-id resume in a fresh child, Queue, and no-undo behavior. |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify last     | Change Story 2.7 from `backlog` to `done`.                                        |

Do not hand-edit the generated matrix. `scripts/generate-capability-matrix.ts` already renders the interrupt axis from the registry and needs no code change for this story.

## Documentation requirements

In the existing DeepSeek section of `ai-assistants.md`, add compact user-facing text that states:

- `Stop` sends ACP `session/cancel` for the current prompt only; the workflow node remains running and waits in `idle-after-interrupt`.
- `Send now` starts a fresh DSH child, resumes the same persisted ACP session id, and delivers queued plus new guidance in receipt order.
- `Queue` does not inject into an in-flight DSH prompt; it waits for the natural turn boundary.
- Stop is not undo: completed tool/file effects remain.
- A failed session resume fails loudly; Archon does not start a fresh session silently.

Do not promise a warm process, 31 ms latency, retained uncommitted model text, token/cost reporting, or soft injection. Those are not contracts proven by this implementation.

## Steps

1. Run `bun run generate:capability-matrix` from the repository root.
2. Inspect the diff. The intended matrix behavior change is only DeepSeek's Turn interrupt cell from `❌` to `**native**`; provider/type documentation changes may alter no other generated cells.
3. Add the verified DeepSeek steering paragraph to `ai-assistants.md`.
4. Run the focused provider and workflow suites, generated-matrix check, type-check, and full `bun run validate`.
5. Confirm `plans/reports/deepseek-interrupt-resume-spike.md` contains sanitized evidence, dependency pins, a `Proceed` conclusion, and the tool-status decision.
6. Attach or link the report plus focused test commands/results on issue #187.
7. As the final repository edit, change `2-7-interrupt-and-redirect-a-running-deepseek-agent` from `backlog` to `done` in `sprint-status.yaml`.

## Validation gate

```bash
cd packages/providers
bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts src/community/deepseek/event-bridge.test.ts src/community/deepseek/config.test.ts src/registry.test.ts

cd ../workflows
bun test src/dag-executor.test.ts -t 'deepseek conformance'
bun test src/dag-executor.test.ts -t 'interrupt and redirect'

cd ../..
bun run generate:capability-matrix
bun run check:capability-matrix
bun run type-check
bun run validate
```

Do not run root `bun test`; the project requires package-isolated `bun run test`, which is included in `validate`.

## Acceptance review

Before changing sprint status, review the delivered result from all nine required perspectives:

1. **Product:** Stop cuts only the active DeepSeek turn, acknowledges in under one second against the pinned runtime, and Send now redirects the same logical session.
2. **Architecture:** provider normalization stays at the adapter boundary; the executor has one exact provider-neutral predicate and no provider-id branch.
3. **Contracts:** existing abort result, Cancel, ACP session id, capability registry, and generated docs agree.
4. **Security/reliability/data integrity:** no secrets or content in evidence; the cancelled prompt wait is bounded and close/reap are verified; resume fails closed; no fresh-session fallback or undo claim.
5. **Performance/scalability:** no persistent process/registry/data growth; fixed drain grace only applies after cancellation.
6. **Completeness:** provider seam, direct path, loop path, tool outcome, docs, evidence, and status are all present.
7. **Verification:** exact positive and negative result shapes, race cleanup, pinned live resume, and full validation pass.
8. **Operations/compatibility/rollback:** source/npm limitation unchanged; no migration; capability can be reverted to false without data work.
9. **Maintainability:** no new protocol field, feature flag, generic framework, or duplicated classifier.

## Completion checklist

- [ ] Generated matrix contains DeepSeek `**native**` and no unrelated cell changes.
- [ ] DeepSeek docs state only verified behavior and distinguish logical session from DSH child lifetime.
- [ ] Focused suites, type-check, generated-doc check, and `bun run validate` pass.
- [ ] Live report is sanitized, complete, and linked from issue #187.
- [ ] Sprint status is changed last.

## Rollback

If validation or the pinned-runtime rerun fails, leave the story `backlog`, revert the capability to `false`, regenerate the matrix, and retain the sanitized failure report for diagnosis. No database or user-data rollback is needed.
