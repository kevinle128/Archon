---
phase: 3
title: 'Engine conformance: direct, loop, loop-group'
status: pending
priority: P1
effort: '0.25-0.5d'
dependencies: [2]
---

# Phase 3: Engine conformance — direct, loop, loop-group

## Goal

Prove that the shipped provider-neutral executor contract accepts Grok's exact stream-abort chunk sequence on all provider-calling paths. Avoid duplicating the 19 generic #183 cases already in `packages/workflows/src/dag-executor.test.ts`.

## Files

| File                                          | Action        | Purpose                                                                          |
| --------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `packages/workflows/src/dag-executor.test.ts` | modify        | Add three Grok-shape conformance scenarios using existing steering helpers       |
| `packages/workflows/src/dag-executor.ts`      | comments only | Describe normalized cross-provider abort reasons rather than Claude-only reasons |

`packages/providers/src/types.ts` is owned by Phase 2; do not edit it again here. `packages/workflows/src/steering-registry.ts`, routes, stores, and UI should not change.

## Existing coverage to reuse

The #183 block already proves the engine's queue ordering, same-session `forkSession: false`, status projection, repeated interrupt, natural and Cancel races, abort-like throws, unrelated errors, missing session IDs, structured output, usage, AI-loop iteration handling, and loop-group namespacing. Use its `liveHandle`, `awaitIdle`, `sendNow`, event helpers, and provider mock seams rather than building a second harness.

## Conformance scenarios

The mock identifies as Grok, returns `GROK_CAPABILITIES`, and yields the Phase 2 provider shape: optional `tool`, interrupted `tool_result`, then a non-error `result` with the assigned/resumed ID and normalized terminal reason.

| ID  | Path                                       | Required assertions                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | direct AI node, mid-tool                   | one `interrupted` status; exactly one `tool_completed` with `tool_outcome: 'interrupted'`; no node failure; idle state reached; `Send now` resumes the same ID with `forkSession: false`; two queued messages plus new message arrive in receipt order; node can complete |
| G2  | AI loop, mid-text                          | interrupt parks inside the current iteration; `Send now` resumes the same ID; the interrupted pass does not consume an iteration or trigger output validation; loop completes without node failure                                                                        |
| G3  | provider-calling loop-group body, mid-tool | the namespaced step parks and resumes; interrupted tool outcome persists once; no parent/body node failure; group continues normally                                                                                                                                      |

G1 proves the transcript data that both existing readers render as `⚠ interrupted`; no new browser test is needed because Story 2.3 already tests the shared dock/read model. G2 and G3 are required because those are separate executor paths.

If any scenario fails, diagnose the shared engine contract. Do not weaken the assertion or add a provider-name branch. A non-comment executor change is a plan change and requires rechecking all generic #183 cases.

## Implementation steps

1. Reuse or minimally parameterize the existing mock-provider helper to expose Grok type/capabilities and the exact Phase 2 chunks.
2. Add G1-G3 adjacent to the existing #183 interrupt suite.
3. Correct the `INTERRUPT_TERMINAL_REASONS` comment: the two strings are Archon's closed normalized vocabulary, forwarded by Claude and synthesized by stream-abort providers.
4. Run the focused interrupt selection, then the complete workflow package test script because all three executor paths share this file.

## Verification

```bash
cd packages/workflows
bun test src/dag-executor.test.ts -t 'interrupt'
bun run test
cd ../..
bun run type-check
bun run lint --max-warnings 0
```

## Completion checklist

- [ ] G1-G3 use the real Phase 2 terminal shape
- [ ] Same-session ID and queue order are asserted, not inferred
- [ ] Tool outcome and no-failure persistence are asserted
- [ ] AI-loop iteration and loop-group namespace behaviour are asserted
- [ ] Existing generic #183 suite remains unchanged and green
- [ ] No Grok-specific engine/registry branch was introduced

## UI/design acceptance boundary

No UI file is in scope. Existing design authority requires these already-shipped states on both shells: `Stop`/`Queue` while generating, transient `Stopping…` with `aria-disabled`, `Send now` while idle-after-interrupt, then generating again; the interrupted tool uses `⚠`, not the failure glyph. G1-G3 prove the provider-side events that drive those states. If implementation reveals a UI change is necessary, pause this phase and add visual assertions for Legacy at its 460 px panel and Console at the mock's 520 px panel against `_bmad-output/specs/spec-agent-node-room/control-states.md` and the reconciled Agent Node Room UX artifacts.

## Rollback

Conformance tests and comment changes revert cleanly. A need for production executor changes means the provider contract was not actually reusable and must be brought back to plan review rather than rolled into this phase.
