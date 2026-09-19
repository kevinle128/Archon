---
phase: 1
title: 'Claude native interrupt seam and real-SDK gate'
status: pending
priority: P1
dependencies: []
---

# Phase 1: Claude native interrupt seam and real-SDK gate

## Goal

Prove the pinned Claude SDK's runtime behavior, then add a provider contract that can interrupt one Claude turn without invoking node Cancel. Calls that do not opt into interruption remain byte-for-byte on the existing prompt/abort path.

Phase 2 must not start until the real-SDK gate below records a usable session id across an interrupted turn.

## Files

| File                                                                                                                | Change                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/providers/src/types.ts`                                                                                   | Add `AgentRequestOptions.interruptSignal?: AbortSignal`, required `ProviderCapabilities.interrupt`, and `MessageChunk.result.terminalReason?: string`.                   |
| `packages/providers/src/claude/provider.ts`                                                                         | Use streaming input only for interrupt-capable calls; bind native `query.interrupt()` to the new signal; normalize `terminal_reason`; preserve existing Cancel behavior. |
| `packages/providers/src/claude/provider.test.ts`                                                                    | Characterize string-prompt regression, native interrupt, cleanup, terminal normalization, and error paths.                                                               |
| `packages/providers/src/claude/interrupt-resume-spike.ts`                                                           | Add a diagnostic real-SDK script, following the existing `askhuman-resume-spike.ts` convention.                                                                          |
| `packages/providers/package.json`                                                                                   | Add `spike:interrupt:claude`; do not export the diagnostic script.                                                                                                       |
| All 11 `packages/providers/src/**/capabilities.ts` files                                                            | Set Claude and e2e-fake to `'native'`; set Codex, Grok, Copilot, DeepSeek, Devin, OMP, OpenCode, Pi, and Qoder CLI to `false` for this story.                            |
| `packages/providers/src/registry.test.ts`, `observability.test.ts`, and other compile-reported capability fixtures  | Supply the required axis without weakening types.                                                                                                                        |
| `scripts/generate-capability-matrix.ts` and `packages/docs-web/src/content/docs/reference/provider-capabilities.md` | Include a total Interrupt row whose cells render `native`, `stream-abort`, or ❌ rather than collapsing the mechanism union to a boolean; regenerate the canonical page. |
| `reports/claude-interrupt-resume-spike.md`                                                                          | Record sanitized command, SDK pin, event ordering, terminal reason, session-id equality, and outcome. Never record prompts, credentials, or model content.               |

## Real-SDK gate

Run the spike in a disposable git repository with an operator-provided Claude credential. It must exercise both a new session and a resumed session:

1. Start a streaming-input query with one typed `SDKUserMessage`.
2. Wait for a deterministic observable start event, call `query.interrupt()`, and record the control acknowledgement (including `still_queued`) and subsequent SDK event types.
3. Record whether the input iterator must remain open for the full query, whether a terminal result arrives, its `is_error`/subtype/`stop_reason`/`terminal_reason` shape, and where the session id first becomes available.
4. Resume using that exact session id, interrupt the resumed turn, and prove the session remains usable for a further turn.
5. Verify interrupting does not require aborting the SDK controller or closing the query.

Gate outcomes:

- **Proceed:** the SDK yields an abort-marked result with the real session id, or exposes the real session id before a clean no-result close so the provider can emit a tested normalized interrupted terminal chunk; the controlled one-message transport reports no surviving queued message that could auto-start another turn.
- **Block:** the session id cannot be retained, the query cannot finish while the input iterator remains usable, native interrupt kills resume, the controlled transport leaves a queued message that can auto-run, or behavior differs nondeterministically. Record evidence and stop; do not substitute node Cancel or a stream-abort design under issue #183.

The spike is diagnostic, not CI. Unit tests use the mocked SDK only after the observed sequence is known.

## Implementation contract

### Typed transport and lifetime

- Check a pre-aborted `interruptSignal` before every SDK retry attempt so an already-spent turn does not start or restart work. Once operator interruption fires, the provider retry loop must exit; it cannot turn a failed interrupt command into a fresh model attempt.
- With no interrupt signal, pass the existing string prompt and retain all current abort/close behavior.
- With an interrupt signal, construct the exact typed one-message `AsyncIterable<SDKUserMessage>` the pin expects. Keep it open through the query lifetime using a provider-owned deferred; settle the deferred in every result, error, Cancel, and finally path.
- Attach separate listeners:
  - node `abortSignal`: existing SDK-controller abort plus query close;
  - turn `interruptSignal`: call `query.interrupt()` once, never abort the SDK controller, never close the query.
- Track the native interrupt promise so rejection is surfaced through the provider stream rather than becoming an unhandled rejection or a silent hang.
- Remove both listeners and settle pending iterator/query resources in `finally`, including when the consumer stops early.

### Normalized result

- Pass through the SDK result's `terminal_reason` as optional `terminalReason`; do not infer interruption from prose or tool text.
- Preserve the SDK session id and all existing result/usage fields.
- Keep the existing `is_interrupt` to `toolOutcome: 'interrupted'` mapping.
- Do not manufacture a terminal chunk unless the spike proves the clean-no-result branch and a real session id is already known.

### Capability

The capability is an implementation-mechanism declaration, not UI state. Only Claude/e2e-fake become interruptible in this story; future provider stories replace their `false` values. Do not expose this internal axis through the server provider-catalog schema unless a current caller requires it.

## Tests first

Add failing provider tests for:

1. no interrupt signal: the SDK receives the existing string prompt;
2. interrupt-capable call: the SDK receives streaming input with one correctly shaped user message;
3. signal abort invokes native `interrupt()` exactly once, including repeated abort notification, and invokes neither SDK abort nor query close;
4. node Cancel still invokes the existing SDK abort/close path and does not call native interrupt;
5. the observed interrupted result exposes `terminalReason` and preserves its exact error/subtype/session/usage shape for engine classification;
6. already-aborted interrupt signal starts no query;
7. native interrupt rejection is observed by the stream consumer;
8. early consumer return, result, throw, and Cancel all remove listeners and close the input iterator;
9. an interrupted attempt is never retried, while calls without the new option retain existing retry/resume behavior.

Update capability-totality tests and prove every concrete provider registration declares the new axis.

## Validation

```bash
cd packages/providers
bun test src/claude/provider.test.ts -t 'interrupt'
bun test src/registry.test.ts
bun test src/observability.test.ts
bun run type-check
cd ../..
bun run generate:capability-matrix
bun run check:capability-matrix
```

Run `bun --filter @archon/providers spike:interrupt:claude` manually only with explicit credentials, then review the sanitized report before Phase 2.

## Completion criteria

- The real-SDK gate is passed and documented.
- Native interruption is exactly-once, distinct from Cancel, leak-free, and preserves the verified session id.
- Existing non-interrupt calls and all current provider tests remain unchanged in behavior.
- Capability matrix generation and provider type-check pass without casts or optional escape hatches.

## Risks and rollback

- The key risk is an inaccurate SDK declaration. The spike makes it a prerequisite rather than burying it in E2E.
- A hung open input iterator can retain a query; every exit-path cleanup is therefore a test requirement.
- Rollback removes the optional request/result fields and capability values; no persistent state is affected.
