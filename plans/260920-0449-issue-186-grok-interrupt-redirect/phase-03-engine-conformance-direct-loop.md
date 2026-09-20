---
phase: 3
title: 'Executor conformance: direct and AI loop'
status: pending
priority: P1
effort: '0.5d'
dependencies: [2]
---

# Phase 3: executor conformance — direct and AI loop

## Goal

Extend the provider-neutral terminal-result predicate with the exact Grok abort subtype and prove that the real Phase 2 chunk sequence follows Story 2.6 on direct AI nodes and AI loops. Keep every existing Claude, DeepSeek, queue-only, race, and loop-group test unchanged and green.

## Verified integration boundary

- `isInterruptMarkedResult()` in `packages/workflows/src/dag-executor.ts` is shared by direct and AI-loop stream handling.
- Both paths separately require the current steering token's operator-interrupt flag, settle open tools, retain the result's session id, skip partial structured-output validation/re-ask, write one `interrupted` status, enter idle-await, and fail explicitly when no resumable id exists.
- Namespaced loop-group body prompt nodes reuse the direct-node path. The existing generic test `interrupt of a loop-group body node parks under the namespaced step name` already covers that indirect path. Story 2.6 explicitly requires direct and loop conformance, so a second provider-specific loop-group copy is unnecessary unless the shared test regresses.
- Routes, stores, and web components consume provider-neutral steering state and transcript rows. No Grok-specific change belongs there.

## Files

| File                                          | Change                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/workflows/src/dag-executor.ts`      | Accept the exact Grok normalized abort subtype; update stale comments. |
| `packages/workflows/src/dag-executor.test.ts` | Add a compact Grok conformance block beside DeepSeek.                  |

## Predicate change

Retain the existing Claude `terminalReason` allowlist. For provider-normalized result errors, require the complete common shape:

```ts
result.stopReason === 'aborted' &&
  result.isError === true &&
  ABORT_ERROR_SUBTYPES.has(result.errorSubtype);
```

where the exact subtype set contains `deepseek_aborted` and `grok_aborted`. This remains provider-neutral: no provider id, prefix match, exception text, or synthesized Claude terminal reason. A near miss is not an interrupt.

The live operator-interrupt token remains mandatory at each caller. Do not move it into the shape predicate or let an unrequested Grok abort become idle.

## Tests before

1. Run the existing interrupt-focused selection and full workflow package test script.
2. Add G0 before changing the predicate: an exact Grok abort result with no operator flag follows the existing SDK-error/node-failed path. This must remain true after the predicate changes.
3. Confirm the generic loop-group namespaced-body test passes; do not duplicate it unless implementation changes that path.

## Grok conformance fixture

The fixture registers Grok as `interrupt: 'stream-abort'` only within the test block while the production constant remains false. It yields the actual Phase 2 sequence:

```text
optional tool -> interrupted tool_result ->
result { stopReason:'aborted', isError:true, errorSubtype:'grok_aborted', sessionId }
```

| ID  | Scenario                                        | Required assertions                                                                                                                                                                               |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0  | Direct node, exact result, no operator flag     | Existing `grok_aborted` failure path; `node_failed`; no idle state.                                                                                                                               |
| G1  | Direct node, mid-tool, `output_format` declared | One interrupted tool completion and one interrupted status; no re-ask or `node_failed`; queue + new guidance preserve order; next call uses the same id with `forkSession:false`; node completes. |
| G2  | AI loop, mid-text                               | Interrupt parks inside the current iteration; no iteration is consumed and partial output is not validated; `Send now` resumes the same id and completes that iteration.                          |
| G3  | Stop races a natural unmarked Grok result       | Natural result remains natural; queued guidance auto-drains or the node finishes under the existing queue rule; no interrupted row.                                                               |
| G4  | Near-miss Grok result with operator flag        | Missing/wrong triple member remains a genuine provider failure, never idle.                                                                                                                       |

G1 must assert the provider-emitted interrupted `tool_result` removes the open tool before terminal settlement, so exactly one `tool_completed` event exists. It must also assert receipt order (`older guidance\n\nnew instruction`), concrete resume id, no partial structured-output re-ask, and one status row.

G2 must assert the redirect uses the interrupted iteration's session and attempt scope and that the normal loop-completion check runs only after the redirected turn.

If these fixtures reveal a shared executor defect, stop and revise the plan before changing code outside the predicate/comments. Do not patch around it with a Grok provider-name branch.

## Implementation order

1. Run existing interrupt and loop-group tests; add G0 and confirm it passes.
2. Add the exact subtype set/condition and correct the “ONLY terminal reasons” comment.
3. Add G1–G4 using the existing steering helpers.
4. Run focused tests, then the package test script and shared type/lint gates.

## Validation

```bash
cd packages/workflows
bun test src/dag-executor.test.ts -t 'grok conformance'
bun test src/dag-executor.test.ts -t 'interrupt'
bun run test

cd ../..
bun run type-check
bun run lint --max-warnings 0
```

## Exit criteria

- G0–G4 pass with the exact Phase 2 result/chunk shape.
- Existing Claude, DeepSeek, queue-only, AI-loop, and loop-group interrupt tests are unchanged and green.
- Same-session id, receipt order, no re-ask, no node failure, and exactly-once tool/status persistence are asserted rather than inferred.
- The only production executor change is the exact normalized subtype predicate and its comments.

## UI/design boundary

No UI file changes. Existing provider-neutral dock and transcript coverage owns the approved generating, brief `Stopping…`, `idle-after-interrupt`, resumed, and `⚠ interrupted` states on Legacy 460 px and Console 520 px. This phase proves the rows/state Grok supplies to that UI; it does not restyle or re-specify them.
