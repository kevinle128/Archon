---
phase: 2
title: 'Executor discriminator, capability, and DeepSeek conformance fixture'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1]
---

# Phase 2: Executor discriminator, capability, and DeepSeek conformance fixture

## Goal

Recognize the provider's existing normalized DeepSeek abort result on both direct and AI-loop execution paths, advertise DeepSeek's ACP cancel as native turn interruption, and prove same-session redirect without changing registry, route, idle-await, or web behavior.

Do not begin until Phase 1's pinned-runtime report says `Proceed` and records the tool-update outcome.

## File inventory

| File | Action | Purpose |
| --- | --- | --- |
| `packages/workflows/src/dag-executor.ts` | modify | Replace terminal-reason-only classification with one exact provider-normalized result predicate used by both paths. |
| `packages/workflows/src/dag-executor.test.ts` | modify | Register DeepSeek and add its exact direct/loop conformance fixture and false-positive guards. |
| `packages/providers/src/community/deepseek/capabilities.ts` | modify | Change `interrupt` from `false` to `'native'`. |
| `packages/providers/src/community/deepseek/config.test.ts` | modify | Update exact capability literal. |
| `packages/providers/src/registry.test.ts` | modify | Expect Claude and DeepSeek as native interrupt providers. |
| `packages/providers/src/types.ts` | modify | Clarify that ACP `session/cancel` + same-id resume is a native interrupt example; do not change the union or result shape. |

## Executor contract

Keep `INTERRUPT_TERMINAL_REASONS` as the exact allowlist for providers that supply a native terminal reason. Add a small local predicate accepting the complete result chunk:

```text
isInterruptMarkedResult(result) =
  isInterruptTerminalReason(result.terminalReason)
  OR (
    result.stopReason === 'aborted'
    AND result.isError === true
    AND result.errorSubtype === 'deepseek_aborted'
  )
```

Both direct and loop paths must call this same helper while retaining the existing independent guards:

- matching live turn token;
- `wasOperatorInterrupted(token) === true`;
- node Cancel check still wins later by its established position.

Do not add provider-id branching, prefix matching, prose/error-message parsing, or `terminalReason:'cancelled'`.

## Test harness setup

`dag-executor.test.ts` bootstraps selected providers but not DeepSeek. Import and call `registerDeepseekProvider()` in the test bootstrap, and import `DEEPSEEK_CAPABILITIES` from `@archon/providers`. Confirm the additional registration does not alter any provider-list assertion in this file.

Extend the local `invokeDag()` helper's assistant union/config branch with `deepseek`, because `getProviderCapabilities('deepseek')` reads the real registry even though `deps.getAgentProvider` is mocked. Add a local DeepSeek fake provider returning:

- `getType: () => 'deepseek'`;
- `getCapabilities: () => DEEPSEEK_CAPABILITIES`;
- the shared mocked `sendQuery`;
- an `abortedResult(sessionId)` helper with exactly the Phase 1 shape and no `terminalReason`.

Keep this as a nested `describe('deepseek conformance', ...)`; do not build a generic conformance framework for two providers.

## Tests first

Run from `packages/workflows`:

```bash
bun test src/dag-executor.test.ts -t 'deepseek conformance'
```

Add these cases:

1. **Direct path, full contract:** first turn triggers the live handle interrupt, emits an open DeepSeek-shaped tool call and the exact abort result, enters idle with one `interrupted` status and no `node_failed`, then drains older queued guidance plus `Send now` in order. The second call receives the interrupted result's session id and completes. Assert the open tool has exactly one `interrupted` outcome. If Phase 1 needed the evidence-gated bridge mapping, add a focused variant that emits its terminal interrupted tool result before the abort result and still asserts one outcome. Use an `output_format` node or an explicit call-count assertion so the interrupted pass cannot run a structured-output re-ask.
2. **No operator flag:** yielding the exact DeepSeek abort result without calling `interrupt()` follows the existing `SDK returned deepseek_aborted` node-failure path. This preserves node Cancel/non-operator behavior.
3. **Exactness guard:** with the operator flag set, a result missing any member of the DeepSeek triple is not classified by the new branch. Use an error-shaped near miss and assert normal failure rather than idle.
4. **AI-loop path:** the exact DeepSeek abort result enters idle inside the current iteration; `Send now` resumes the same session id without consuming an iteration, then completes with no `node_failed`.

The existing Story 2.3 matrix already covers natural-result races, repeated interrupts, Cancel dominance, missing session id, background tasks, idle discard, and both docks. Do not clone those provider-neutral tests unless the new predicate changes them.

## Implementation steps

1. Add `isInterruptMarkedResult()` beside the current terminal-reason helper and explain that exact provider-normalized result fields are transport contracts, not prose inference.
2. Replace the two `isInterruptTerminalReason(msg.terminalReason)` call sites with the shared result predicate. Change no other direct/loop control flow.
3. Add the DeepSeek fixture and four tests. Verify the exactness test fails if the helper is broadened to one field or a prefix.
4. Change `DEEPSEEK_CAPABILITIES.interrupt` to `'native'` with a concise ACP cancel/same-id-resume comment.
5. Update the exact DeepSeek capability fixture and registry native-provider list (`['claude', 'deepseek']` after sorting).
6. Update the `ProviderCapabilities.interrupt` documentation to include DeepSeek ACP `session/cancel` followed by `session/resume` on the same persisted id as a native example. Do not edit `MessageChunk.terminalReason` documentation.

## Regression gate

```bash
cd packages/providers
bun test src/community/deepseek/config.test.ts src/registry.test.ts

cd ../workflows
bun test src/dag-executor.test.ts -t 'deepseek conformance'
bun test src/dag-executor.test.ts -t 'interrupt and redirect'

cd ../..
bun run type-check
```

## Completion checklist

- [ ] Phase 1 report says `Proceed`.
- [ ] Direct and loop tests use the exact production DeepSeek abort result with no synthetic field.
- [ ] Flagless and near-miss results fail normally.
- [ ] Direct redirect keeps message order/session id and interrupted tool outcome.
- [ ] Capability constant, provider object, registry, and type documentation agree on `'native'`.
- [ ] Existing Story 2.3 interrupt matrix remains green without route/UI changes.

## Risks and rollback

- A broad result check could hide genuine provider errors racing Stop. The exact triple plus operator token and near-miss test are the safety boundary.
- Registering DeepSeek in a large shared test file can affect global registry state. Register once with the existing bootstrap pattern and verify no list-order assumptions change.
- Rollback sets the capability to `false` and removes only the DeepSeek arm from the result predicate/tests. Claude classification remains unchanged.
