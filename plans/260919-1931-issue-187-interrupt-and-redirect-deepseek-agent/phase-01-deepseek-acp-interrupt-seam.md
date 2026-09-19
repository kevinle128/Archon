---
phase: 1
title: 'DeepSeek ACP interrupt seam and pinned-runtime gate'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: DeepSeek ACP interrupt seam and pinned-runtime gate

## Goal

Teach the DeepSeek provider to receive the executor's turn-scoped `interruptSignal`, cancel the active ACP prompt exactly once, preserve the existing abort-result contract and session id, and cleanly close/reap the per-turn DSH child. Prove cancel -> close -> resume -> continuation against the pinned DSH runtime before advertising the capability.

## Preconditions and invariants

- Read `packages/providers/src/community/deepseek/acp-client.ts`, `provider.ts`, `event-bridge.ts`, their tests, and the Devin ACP cancellation pattern before editing.
- Keep `abortedResult()` unchanged. The executor phase will classify its existing exact shape.
- `abortSignal` remains node Cancel; `interruptSignal` is operator Stop. Both use ACP `session/cancel`, but the first cause is retained for tool-outcome semantics.
- No capability flip occurs in this phase. Production cannot expose Stop until Phase 2's classifier and conformance tests land.
- Do not log prompts, model output, raw tool payloads, environment values, base URLs, or credentials.

## File inventory

| File | Action | Purpose |
| --- | --- | --- |
| `packages/providers/src/community/deepseek/acp-client.ts` | modify | Add the signal, cause-aware exactly-once cancel, listener cleanup, natural-result race protection, and bounded local cancellation drain. |
| `packages/providers/src/community/deepseek/provider.ts` | modify | Forward `requestOptions.interruptSignal`. |
| `packages/providers/src/community/deepseek/acp-client.test.ts` | modify | Deterministic ACP protocol, race, cleanup, and ignored-cancel tests. |
| `packages/providers/src/community/deepseek/provider.test.ts` | modify | Verify signal forwarding without changing existing pre-aborted node-Cancel behavior. |
| `packages/providers/src/community/deepseek/interrupt-resume-spike.ts` | create | Bounded, sanitized pinned-runtime diagnostic; never exported or run by CI. |
| `packages/providers/package.json` | modify | Add `spike:interrupt:deepseek`. |
| `plans/reports/deepseek-interrupt-resume-spike.md` | create during execution | Sanitized operator evidence in the configured reports tree. |
| `packages/providers/src/community/deepseek/event-bridge.ts`, `packages/providers/src/community/deepseek/event-bridge.test.ts` | conditional modify | Only if the live evidence proves cancelled in-flight tools arrive as `status:'failed'`. |

## Tests first

Run from `packages/providers`:

```bash
bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts src/community/deepseek/event-bridge.test.ts
```

Add or extend these cases before implementation:

1. `provider.test.ts`: `interruptSignal` is forwarded into `DeepseekProcessInput` alongside, not instead of, `abortSignal`.
2. `acp-client.test.ts`: aborting `interruptSignal` while `session/prompt` is live produces one `session/cancel`, one `session/close`, and the exact existing abort result with the created session id.
3. Existing `abortSignal` test remains byte-for-byte compatible and still takes the same ACP path.
4. When both signals abort, only one `session/cancel` is sent; the first cause is stable.
5. A signal already aborted when the ACP session becomes available sends cancel once, skips `session/prompt`, closes, and returns an abort result carrying that new/resumed session id.
6. An interrupt during `session/set_config_option` cancels once, skips the prompt, closes, and yields the abort result.
7. Hold `session/close` after a natural prompt response, then abort `interruptSignal`: the natural result and structured output survive and no `session/cancel` is sent.
8. Success, prompt failure, setup failure, and early consumer return remove both listeners. Early return still cancels a live session and releases the connection.
9. A fake DSH whose `session/prompt` never settles after `session/cancel` cannot hold the prompt wait forever: after a local `CANCEL_DRAIN_GRACE_MS = 500`, matching Devin, the fake must allow `session/close` to complete, cleanup/reap proceeds, and the abort result is emitted. Use fake timers; do not add product configuration or a test-only production seam solely for the duration.
10. If the conditional bridge change applies, `failed` after first cause `operator-interrupt` maps to `interrupted`, while normal `failed` and first cause `node-cancel` remain `error`.

## Implementation steps

1. Add `interruptSignal?: AbortSignal` to `DeepseekAcpTurnInput`; it flows into `DeepseekProcessInput` by extension. Forward `requestOptions?.interruptSignal` in `DeepseekProvider.sendQuery()`.
2. In the ACP driver, keep shared turn state outside individual listeners: first cancellation cause (`node-cancel`, `operator-interrupt`, or cleanup), a local cancellation deferred, a `cancelSent` guard/promise, and the active client/session references.
3. Implement `requestCancel(cause)` so the first call records the cause and releases the local cancellation deferred exactly once. Implement `flushCancel()` separately: it is a no-op until both `clientCtx` and `activeSessionId` exist, then sends and memoizes one `session/cancel`. A cancellation requested before session creation therefore remains pending instead of being lost; later causes cannot overwrite it.
4. Once the session is live, register one listener per supplied signal, check both signals for an already-aborted state, and call `flushCancel()` after those checks. If either is already aborted, call `requestCancel()` with the correct cause; if both are already aborted, check node Cancel first so the executor's existing Cancel dominance remains intuitive. All later listener calls run `requestCancel()` followed by `flushCancel()`.
5. Honor cancellation at setup boundaries: check the recorded cause before each configuration request, after each awaited configuration response, and before `session/prompt`. ACP cancel does not cancel an already-pending config request, so do not claim otherwise; the invariant is that no later setup or prompt request starts after the boundary observes cancellation.
6. Await `session/prompt` against a local 500ms cancellation drain grace, following the existing Devin ACP pattern. This preserves a short window for ordered late updates but prevents an unresponsive cancelled prompt from holding the generator indefinitely.
7. At prompt settlement, remove both listeners before awaiting cancel completion or `session/close`. Capture whether the prompt ended naturally at that boundary. A later signal during teardown must not change the result.
8. Await the cancel notification best-effort as today, then call `session/close`; surface a close failure through the existing `deepseek_protocol_error` path. Keep `runDeepseekAcpTurn()`'s `finally` reaper unchanged unless a deterministic ignored-cancel test proves it cannot complete cleanup.
9. Leave `abortedResult(sessionId)` exactly as it is. Do not add `terminalReason`, expose raw ACP `cancelled`, or change `toDeepseekErrorResult()`.
10. Preserve consumer-return cleanup by routing the outer `finally` through `requestCancel('cleanup')` plus `flushCancel()` rather than a second independent notify.

## Pinned-runtime diagnostic

Create `interrupt-resume-spike.ts` using `acp-handshake-spike.ts` for DeepSeek env setup and the Claude interrupt spike for evidence hygiene and timeout structure.

The script must:

- require `DEEPSEEK_LIVE_TEST=1`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_LIVE_MODEL`;
- run only in a disposable temporary directory and always remove it;
- enforce a total timeout and return non-zero for timeout, authentication, model, protocol, missing-session, resume, or continuation failure;
- read and report the installed `@deepseek-ai/dsh` and ACP SDK versions, failing if they differ from the package pins;
- start one tool-using turn, trigger `interruptSignal` only after an observable assistant/tool event, and record `interruptAckMs` from signal abort through the local abort result plus post-interrupt chunk-type/tool-status names;
- assert the final result has a non-empty session id and the exact local abort triple;
- start one redirect turn with that id, assert `resumed === true`, a non-error terminal result, and session-id continuity;
- emit one sanitized JSON document. Record equality booleans rather than raw session ids; record no prompt or response text.

Gate outcomes:

- **Proceed:** `interruptAckMs < 1000`, the local abort result carries the session id, close completes, resume reports `true`, and the redirect completes without error on the same id.
- **Block:** `interruptAckMs >= 1000`, cancellation/close times out, session id is absent, `session/resume` yields `deepseek_resume_failed`, `resumed` is not `true`, or continuation fails. Record sanitized evidence and stop; do not flip the capability or fall back to a new session/node Cancel.
- **Tool mapping decision:** if an in-flight cancelled tool arrives as terminal ACP `failed` before the result, apply the first-cause-safe bridge mapping and its three-way tests. If it remains open, the executor owns `interrupted`; if DSH emits no tool start, adjust and rerun the diagnostic before declaring the tool evidence complete.

Write the operator command, dependency pins, sanitized JSON, outcome, and tool-mapping decision to `plans/reports/deepseek-interrupt-resume-spike.md`.

## Regression gate

```bash
cd packages/providers
bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts src/community/deepseek/event-bridge.test.ts
bun run type-check
```

## Completion checklist

- [ ] Tests 1-9 fail for the expected missing behavior, then pass.
- [ ] Existing node-Cancel and consumer-return tests remain green.
- [ ] Abort result has no new field and unchanged values.
- [ ] Diagnostic is bounded, sanitized, version-checked, and not exported/CI-wired.
- [ ] Pinned-runtime outcome is `Proceed` and report exists under `plans/reports/`.
- [ ] Conditional tool mapping is either implemented with evidence or explicitly recorded as unnecessary.

## Risks and rollback

- DSH may not resume after cancel+close at the pinned version. That blocks the story; no fallback is acceptable.
- A late ACP `failed` tool update is ambiguous without local cause. Never map it from text or from a generic `cancelRequested` boolean that would also change node Cancel.
- Incorrect listener lifetime could turn a natural end into an interrupt during close. Test 7 is the release guard.
- Rollback removes the optional signal and diagnostic changes. Because the capability is still false in this phase, no user-visible Stop path is exposed.
