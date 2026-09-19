---
phase: 3
title: 'Engine conformance: direct, loop, loop-group'
status: pending
priority: P1
effort: '0.5d'
dependencies: [2]
---

# Phase 3: Engine conformance — direct, loop, loop-group

## Goal

Prove that the shipped #183 executor, registry, and transcript projection handle the Grok stream-abort shape identically to Claude on all three provider-calling paths, without adding Grok-specific executor logic — and correct the two comments that currently claim the abort vocabulary is Claude-only.

## Context links

- Decision D5 in [plan.md](./plan.md).
- `packages/workflows/src/dag-executor.test.ts:27068-27800` — the #183 matrix and its helpers (`liveHandle`, `awaitIdle`, `enqueue`, `sendNow`, `toolCompletedOutcomes`, `transcriptStates`, `invokeDag`, `mockGetAgentProviderDag`).
- `packages/workflows/src/dag-executor.ts:452-483` (`INTERRUPT_TERMINAL_REASONS`, `isAbortLikeStreamError`), `:3196-3205` and `:5964-5973` (interruptible gate), `:3482-3511` and `:7065-7102` (idle entry).
- `packages/providers/src/types.ts` — `terminalReason` docstring ("forwarded verbatim from the SDK").

## Key insights

- `providerInterruptible = getProviderCapabilities(provider).interrupt !== false` already admits `'stream-abort'`; a Grok-typed mock provider with `GROK_CAPABILITIES` therefore gets a token and an `interruptSignal` with no executor change.
- The reader fold that renders `⚠` reads `tool_completed.tool_outcome === 'interrupted'`; asserting the persisted row is the provider-blind proof the story asks for, so no Playwright run is needed.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/workflows/src/dag-executor.test.ts` | modify | ~250 lines, new `describe('… Grok stream-abort conformance (#186)')` | reuses #183 helpers; may need `mockGetAgentProviderDag` to accept `getType: () => 'grok'` and `GROK_CAPABILITIES` |
| `packages/workflows/src/dag-executor.ts` | modify | comments only (`:448-461`) | none |
| `packages/providers/src/types.ts` | modify | `terminalReason` docstring | none |

## Tests before (TDD)

These scenarios are the Grok conformance fixture. Mock `sendQuery` yields exactly the Phase 2 chunk shapes (a `tool` chunk, then on interrupt a `tool_result{toolOutcome:'interrupted'}` and a `result{terminalReason, sessionId}` with no `isError`).

| # | Path | Scenario | Assertions |
| --- | --- | --- | --- |
| G1 | direct | interrupt mid-tool (outcome B shape), two queued receipts, then `send_now` | one `interrupted` status row; `tool_completed` outcomes for the cut tool `=== ['interrupted']` (no `unknown`); no `node_failed`; second call gets `resumeSessionId === <pre-assigned>` and `forkSession === false`; prompt `'old one\n\nold two\n\nnew'`; `node_completed` |
| G2 | direct | interrupt mid-text (`aborted_streaming`, no tool) | idle reached; no `tool_completed` rows; same-session redirect |
| G3 | direct | outcome A shape: interrupted result carries `usage`/`cost` | usage and cost recorded once; interrupted row still exactly one |
| G4 | direct | interrupt on a resumed turn: result `sessionId` equals the resumed id | redirect resumes that id |
| G5 | direct | Cancel racing Stop: mock throws `'Query aborted'` with `abortSignal` aborted | existing Cancel failure path; no idle |
| G6 | direct | natural end racing Stop: unmarked result, empty queue | interrupt route promise resolves `node_finished`; no interrupted row |
| G7 | AI loop | interrupt inside iteration 1, `send_now` | idles inside the iteration, redirect resumes the same session, iteration counter not consumed, loop completes normally |
| G8 | loop-group body | provider-calling body node interrupted | parks under the namespaced step name; same assertions as G1 |
| G9 | direct | `interrupt: 'stream-abort'` provider with `sessionResume: true` but mock `sendQuery` ignoring the signal and ending naturally | registry settles `generating`/`node_finished`; proves the executor never relies on provider cooperation for termination |

## Refactor (protected changes)

1. Rewrite the `INTERRUPT_TERMINAL_REASONS` comment: these are Archon's normalized abort markers, originally named after the Claude SDK and emitted by Claude, e2e-fake, and Grok's stream-abort; the set is still closed and prose-free.
2. Rewrite the `terminalReason` docstring in `types.ts`: forwarded verbatim by Claude; synthesized by providers that stream-abort.
3. If `mockGetAgentProviderDag` or `minimalConfig` needs a `grok` assistant entry, add it in the test file only.

## Tests after

G1-G9 green; the existing 19 #183 scenarios untouched and green.

## Verification

```bash
cd packages/workflows && bun test src/dag-executor.test.ts -t 'interrupt'
cd packages/workflows && bun test src/steering-registry.test.ts
bun run type-check && bun run lint
```

## Todo

- [ ] G1-G9 written against the Phase 2 chunk shapes and failing only for the reasons expected (none should fail once Phase 2 is merged — if one fails, it is a real executor defect to fix, not a test to weaken)
- [ ] Comments in `dag-executor.ts` and `types.ts` corrected
- [ ] Full `-t 'interrupt'` selection green

## Success criteria

- No non-comment change in `dag-executor.ts` or `steering-registry.ts` is required; if one is, record why in this phase and in the plan's D5 before making it.
- Persisted evidence for `⚠`: `tool_outcome: 'interrupted'` rows for Grok on all three paths.

## Risk assessment

- The direct path's idle entry uses `newSessionId ?? turnResumeId`; if a scenario ever yields no session id the executor fails explicitly — G-scenarios must always carry one, matching Phase 2's guarantee.

## Next steps

Phase 4 regenerates the capability matrix and closes the story.
