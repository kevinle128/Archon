---
phase: 3
title: "Engine conformance: direct, loop, loop-group"
status: pending
priority: P1
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Engine conformance — direct, loop, loop-group

## Goal

Teach the provider-neutral executor predicate to recognise the Grok abort triple (D3) and prove, with the shared steering harness, that Grok's exact chunk sequence passes the direct, AI-loop, and loop-group-body paths without a node failure. No other engine, registry, route, store, or UI behaviour changes.

## Context links

- Predicate: `packages/workflows/src/dag-executor.ts:481-493` (`isInterruptMarkedResult`), `:462-468` (`INTERRUPT_TERMINAL_REASONS` comment), `:2740-2760` (direct classification), `:6508` (loop classification).
- Missing-id fail-fast: `:3554-3561` (direct), `:7176` (loop).
- Existing generic suite: `packages/workflows/src/dag-executor.test.ts` — 19 #183 cases from `:27432`; DeepSeek fixture block from `:28119` (`abortedResult`, `liveHandle`, `awaitIdle`, `enqueue`, `sendNow`, `transcriptStates`, `toolCompletedOutcomes`, `storedEventTypes`, `invokeDag`).
- Spec: `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md:33-40`.

## Files to create / modify

| File | Action | Size | Test impact |
|------|--------|------|-------------|
| `packages/workflows/src/dag-executor.ts` | modify predicate + comments | +8 / comments | whole workflow package |
| `packages/workflows/src/dag-executor.test.ts` | modify (new `describe` block) | +220–280 | G0–G4 |

Rule of Three note: with Claude (allowlist), DeepSeek (triple), and now Grok (triple) the predicate has three shapes. Keep it as a third explicit clause in this phase; if a fourth stream-abort provider arrives, extract a table of exact triples then — not now.

## Tests before

- Run the full #183 block and the DeepSeek block: `bun test src/dag-executor.test.ts -t 'interrupt'` — green and unchanged.
- Add **G0** before touching the predicate: "Grok triple without the operator flag follows the `grok_aborted` failure path" (mirrors the DeepSeek case at `:28175`). It passes today because the triple is not yet recognised; it must still pass after the clause lands because the operator flag gates classification.

## Refactor

1. Add the Grok clause to `isInterruptMarkedResult`: `stopReason === 'aborted' && isError === true && errorSubtype === 'grok_aborted'`. Update the docblock: exact provider-normalized triples (DeepSeek, Grok) OR Claude's forwarded `terminalReason` allowlist.
2. Correct the `INTERRUPT_TERMINAL_REASONS` comment so it no longer claims to be "the ONLY" interrupt marker.
3. No provider-id branching, no prefix matching, no error-message parsing.

## Tests after (conformance fixtures)

The mock identifies as `grok` with `GROK_CAPABILITIES` (`interrupt: 'stream-abort'`) and yields the Phase 2 shape: optional `tool`, interrupted `tool_result`(s), then `{ type: 'result', stopReason: 'aborted', isError: true, errorSubtype: 'grok_aborted', sessionId, resumed? }`.

| ID | Path | Assertions |
|----|------|------------|
| G0 | direct, no operator flag | triple → existing failure path (`node_failed`), no idle state |
| G1 | direct AI node, mid-tool, `output_format` declared | one `interrupted` status row; exactly one `tool_completed` for the open tool with `tool_outcome: 'interrupted'` (provider-emitted `tool_result` and executor settlement do not double-write); no `node_failed`; no re-ask; `Send now` → second call resumes the **same** id with `forkSession: false`; prompt is `'older guidance\n\nnew instruction'`; node completes |
| G2 | AI loop, mid-text | interrupt parks inside the current iteration; `Send now` resumes the same id; the interrupted pass consumes no iteration and triggers no output validation; loop completes |
| G3 | loop-group body node, mid-tool | namespaced step parks and resumes; one interrupted tool outcome persists; no parent/body failure; group continues |
| G4 | direct, Stop races a natural `end` (unmarked natural result) | result stays natural; no `interrupted` row; no signal effect |

If any fixture fails, diagnose the shared contract or the Phase 2 shape. Do not weaken an assertion or add a provider-name branch; a non-comment executor change beyond step 1 is a plan change and requires re-running the whole #183 suite.

## Implementation steps

1. Run "Tests before"; add G0 (green).
2. Add the predicate clause + comments.
3. Add G1–G4 adjacent to the DeepSeek block, reusing its helpers with a `grok` assistant and a `grokAbortedResult(sessionId, resumed?)` helper.
4. Run the focused selection, then the whole workflow package script.

## Todo

- [ ] G0 written and green pre-change
- [ ] Predicate clause + docblocks
- [ ] G1–G4 green
- [ ] Generic #183 + DeepSeek blocks unchanged and green

## Regression gate

```bash
cd packages/workflows
bun test src/dag-executor.test.ts -t 'interrupt'
bun run test
cd ../.. && bun run type-check && bun run lint --max-warnings 0
```

## Success criteria

- G0–G4 pass with the real Phase 2 shape; same-session id and queue order are asserted, not inferred.
- Exactly one `tool_completed` per interrupted tool.
- No Grok-specific engine branch beyond the exact-triple clause.

## UI/design boundary

No UI file is in scope. G1 proves the data (`interrupted` status row, `tool_outcome: 'interrupted'`) that the shipped provider-blind dock renders as `Stop` → `Stopping…` → `Send now` and `⚠ interrupted`. If a UI change becomes necessary, pause and add visual assertions against `_bmad-output/specs/spec-agent-node-room/control-states.md` before continuing.

## Rollback

Revert the predicate clause and the test block; nothing else changed.
