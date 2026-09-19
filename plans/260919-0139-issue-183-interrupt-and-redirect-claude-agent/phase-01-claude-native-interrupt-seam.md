---
phase: 1
title: 'Claude native interrupt seam (spike + provider)'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: Claude native interrupt seam (spike + provider)

## Goal

`@archon/providers` exposes a per-turn `interruptSignal` option, and the Claude provider honours it by calling the SDK's native `interrupt()` in streaming-input mode so the turn ends, the session survives, and the normalized `result` carries a typed abort marker plus the session id. Nothing else in the provider's behavior changes when the option is absent.

## Context links

- Spec: `_bmad-output/specs/spec-agent-node-room/engine-integration.md` §1–2, `provider-steering-matrix.md` (claude row), `steering-test-plan.md` "Providers — interrupt conformance".
- Architecture: `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` AD-2, AD-3.
- SDK facts (pinned 0.3.209, read from `sdk.d.ts` via unpkg): `Query.interrupt()` at `:2245` with the JSDoc "on a clean interrupt this receipt is written before the interrupted turn result"; control requests "only supported when streaming input/output is used" (`:2233-2235`); `SDKUserMessage` shape at `:4440` (`{ type:'user', message: MessageParam, parent_tool_use_id: null }`); `TerminalReason` at `:6721` includes `'aborted_streaming' | 'aborted_tools'`; `SDKResultSuccess.terminal_reason?` at `:4192`.
- Vendor docs (streaming-vs-single-mode): single-message input "does not support real-time interruption".

## Key insights

- The provider already has every piece except the input mode: `ClosableQuery` (`provider.ts:78-89`) wraps `close()`; `onAbort` (`:1601-1607`) is the Cancel path; `streamClaudeMessages` (`:1080-1400`) normalizes the `result`; `captureFirstSessionId` (`:994-1015`) already reads `session_id` from the first SDK message.
- An interrupted tool call already normalizes to `toolOutcome: 'interrupted'` (`:953-960`), so the transcript's `⚠` glyph needs no provider work.
- `[UNVERIFIED]` Whether the one-message input generator may complete right after its first yield or must stay open until the result. The SDK JSDoc implies control requests travel over the same stdin channel, so the plan keeps the generator open until the terminal `result` is observed (or the query closes). The spike settles it.
- `[UNVERIFIED]` Which `terminal_reason` an interrupted turn carries (`aborted_streaming` while the model streams, `aborted_tools` during a tool). The executor only needs "starts with `aborted_`"; the spike records the observed values.

## Files to create / modify

| File                                                                         | Action | Change                                                                                                                                                               | Test impact                       |
| ---------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `packages/providers/src/types.ts`                                            | Modify | `AgentRequestOptions.interruptSignal?: AbortSignal` (JSDoc: per-turn, ends the turn, session alive; distinct from `abortSignal`); `ProviderCapabilities.interrupt: 'native' \| 'stream-abort' \| false`; result chunk gains `terminalReason?: string`. | Type-checks every provider's caps |
| `packages/providers/src/claude/capabilities.ts`                              | Modify | `interrupt: 'native'`.                                                                                                                                               | Matrix regen                      |
| `packages/providers/src/codex/capabilities.ts`, `grok/`, `community/*/capabilities.ts`, `e2e-fake` | Modify | `interrupt: false` everywhere except e2e-fake (`'native'`, Phase 5 implements it).                                                                | Matrix regen                      |
| `packages/providers/src/claude/provider.ts`                                  | Modify | Streaming-input wrapper, `interrupt` listener, `terminalReason` on the normalized result, `ClosableQuery.interrupt?`.                                                | Claude provider tests             |
| `packages/providers/src/claude/provider.test.ts`                             | Modify | Interrupt conformance tests (see matrix).                                                                                                                            | —                                 |
| `scripts/generate-capability-matrix.ts`                                      | Modify | New `interrupt` axis (the generator fails on an unknown `ProviderCapabilities` field by design).                                                                    | `check:capability-matrix`         |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md`      | Regen  | `bun run generate:capability-matrix`.                                                                                                                                | CI check                          |
| `scripts/spikes/claude-interrupt-spike.ts`                                   | Create | Manual spike against the real SDK (not part of any test chain).                                                                                                      | None (manual)                     |
| `plans/260919-0139-issue-183-interrupt-and-redirect-claude-agent/reports/spike-claude-interrupt.md` | Create | Observed sequence, `terminal_reason`, session resume proof.                                                                                          | Gate for Phase 2                  |

## Architecture

```mermaid
sequenceDiagram
  participant EX as executor (Phase 2)
  participant CP as ClaudeProvider.sendQuery
  participant Q as SDK Query (streaming input)
  EX->>CP: sendQuery(prompt, cwd, resumeId, { abortSignal: node, interruptSignal: turn })
  CP->>Q: query({ prompt: oneMessageStream(prompt), options })
  Q-->>CP: system/init (session_id) … assistant … tool_use …
  EX-->>CP: turn.abort() (interruptSignal)
  CP->>Q: await query.interrupt()
  Q-->>CP: tool_result is_interrupt:true (toolOutcome 'interrupted')
  Q-->>CP: result { subtype:'success', terminal_reason:'aborted_*', session_id }
  CP-->>EX: { type:'result', sessionId, terminalReason:'aborted_*' }
  CP->>Q: input stream ends → subprocess exits; session file resumable
```

## Tests before (regression, written first)

1. `provider.test.ts` — "string prompt is passed unchanged when no `interruptSignal` is set": assert the mocked `query` receives `prompt: string` (pins D2's byte-for-byte guarantee for chat and non-steerable nodes).
2. "abort signal still aborts the SDK controller and closes the query" — the existing tests at `provider.test.ts:1986-2030` stay green; add an assertion that `interrupt` is NOT called on Cancel.
3. "ask-resume prompt keeps its retry count and sanitization" (existing ask-resume tests) — unchanged.
4. Capability matrix: `bun run check:capability-matrix` passes before the field is added (baseline), then fails loudly after adding the field until the axis exists — record both.

## Refactor (protected change)

1. **Types.** In `types.ts` add `interruptSignal?: AbortSignal` next to `abortSignal` (`:593`) with a JSDoc stating: fired by the executor to end the CURRENT turn only; the provider must keep the session resumable and must not treat it as `abortSignal`. Add `terminalReason?: string` to the `result` chunk union member (`:333-345`). Add `interrupt: 'native' | 'stream-abort' | false` to `ProviderCapabilities` (`:755+`) with the three-tier doc.
2. **Streaming-input wrapper.** In `provider.ts` add a small helper next to `captureFirstSessionId`:
   ```ts
   function oneMessageInput(text: string, turnDone: Promise<void>): AsyncIterable<SDKUserMessage> {
     return (async function* () {
       yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
       await turnDone; // keep stdin open so control requests (interrupt) can be written
     })();
   }
   ```
   `turnDone` is a deferred the provider resolves when `streamClaudeMessages` yields the terminal `result`, when the query closes, or in the attempt's `finally`. Use it only when `requestOptions.interruptSignal` is defined (`:1689`): `query({ prompt: interruptSignal ? oneMessageInput(queryPrompt, turnDone.promise) : queryPrompt, options })`. `queryPrompt` already covers the ask-resume prompt (`:1615-1617`).
3. **Interrupt listener.** Beside `onAbort` (`:1601`): `const onInterrupt = () => { void currentQuery?.interrupt?.().catch(err => getLog().warn({ err }, 'claude.interrupt_failed')); }` registered `{ once: true }` per sendQuery on `requestOptions.interruptSignal`; remove both listeners in the outer `finally`. Extend `ClosableQuery` with `interrupt?: () => Promise<unknown>`. If `interruptSignal.aborted` is already true before an attempt starts, do not start it — throw `new Error('Turn interrupted before start')` so the executor's flag classifies it (case 3).
4. **Abort marker.** In the `result` branch (`:1275-1375`), spread `...(resultMsg.terminal_reason !== undefined ? { terminalReason: resultMsg.terminal_reason } : {})` onto the yielded chunk. Do not change `isError` semantics: an interrupted `success` result stays `isError: false`.
5. **Retry guard.** `classifyAndEnrichError` (`:1421-1470`) reads `controller.signal.aborted`; a steering interrupt never aborts that controller, so a throw during an interrupted turn keeps its real class. Add a guard in the retry loop: if `requestOptions.interruptSignal?.aborted`, do not retry (`shouldRetry = false`) — re-running an interrupted turn would resurrect the work the operator stopped.
6. **Capabilities.** Set `interrupt: 'native'` in `claude/capabilities.ts`, `false` in every other provider's capabilities object, `'native'` on e2e-fake (its behavior lands in Phase 5; the flag is what lets the executor hand it the signal). Add the axis to `scripts/generate-capability-matrix.ts` and run `bun run generate:capability-matrix`.

## Tests after (new behavior)

| #   | Test (claude `provider.test.ts`)                                                                                             | Asserts                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `interruptSignal` present → `query` receives an `AsyncIterable` whose first item is the user message with the original text  | streaming mode only when requested; `parent_tool_use_id === null`                                                        |
| 2   | aborting `interruptSignal` mid-stream calls `query.interrupt()` exactly once and never `controller.abort()`/`close()`         | native path, session alive                                                                                               |
| 3   | mocked stream after interrupt yields `tool_result is_interrupt:true` then `result { terminal_reason:'aborted_tools' }`        | provider yields `tool_result.toolOutcome === 'interrupted'` then `result.terminalReason === 'aborted_tools'` with `sessionId` |
| 4   | input generator completes only after the terminal result is observed                                                         | `turnDone` gate                                                                                                          |
| 5   | `interruptSignal` already aborted before the attempt → throws without spawning                                               | no `query` call                                                                                                          |
| 6   | throw during an interrupted turn → no retry attempt                                                                          | one `query` call                                                                                                         |
| 7   | Cancel (`abortSignal`) during a streaming-input turn still aborts the SDK controller and closes the query; `interrupt` unused | Cancel byte-for-byte                                                                                                     |
| 8   | ask-resume prompt with `interruptSignal` wraps `buildClaudeAskResumePrompt(...)` output                                       | AskHuman re-entry remains interruptible                                                                                  |

Capability tests: `getProviderCapabilities('claude').interrupt === 'native'`; `check:capability-matrix` green after regen.

## Spike (mandatory gate before Phase 2)

`scripts/spikes/claude-interrupt-spike.ts` (run with `bun run scripts/spikes/claude-interrupt-spike.ts`, needs a real Claude credential; never wired into `bun run test`):

1. Start `query({ prompt: oneMessageInput('Run `sleep 20` with Bash, then say done', turnDone), options: { cwd, allowedTools:['Bash'] } })`.
2. After the first `tool_use`, call `await q.interrupt()`; log every subsequent message type, the `result.subtype`, `result.terminal_reason`, `result.is_error`, `result.session_id`, and whether the `tool_result` carries `is_interrupt`.
3. Start a second `query` with `options.resume = session_id` and a plain string prompt "What was the last command you ran?"; confirm the answer references the interrupted `sleep` (context preserved).
4. Repeat step 1–2 with `options.resume` set from the start (interrupt on a resumed turn) — this is the Send now → Stop again path.
5. Record the observed values in `reports/spike-claude-interrupt.md`. Pass condition: interrupt lands within ~2 s, a `result` arrives with `terminal_reason` starting `aborted_` and a `session_id`, and step 3 resumes with context. Any miss → stop, report `BLOCKED`, and present the stream-abort fallback to the owner (it does not satisfy AC 2's wording).

## Regression gate

```bash
(cd packages/providers && bun test src/claude/provider.test.ts)
(cd packages/providers && bun run type-check 2>/dev/null || bun run --cwd packages/providers tsc --noEmit)
bun run generate:capability-matrix && bun run check:capability-matrix
bun run lint
```

## Todo

- [ ] Add `interruptSignal`, `terminalReason`, and the `interrupt` capability to `types.ts`
- [ ] Set the capability on every provider; add the matrix axis; regenerate docs
- [ ] Write Tests Before (1–4) and confirm green/red as expected
- [ ] Implement `oneMessageInput`, `turnDone` gate, `onInterrupt`, `terminalReason`, retry guard
- [ ] Write Tests After (1–8), all green
- [ ] Run the spike; write `reports/spike-claude-interrupt.md`; decide go / BLOCKED

## Success criteria

- Tests After 1–8 and the full Claude provider suite pass; `check:capability-matrix` passes.
- Spike report shows native interrupt + same-session resume with context.
- No behavior change for calls without `interruptSignal` (Tests Before 1–3 unchanged).

## Risk assessment

- Streaming-input mode may change subprocess lifetime (stdin held open). Mitigation: `turnDone` resolves in every `finally`, and `closeQuery` on Cancel still tears the process down.
- `withFirstMessageTimeout` (`:410-450`) wraps the first `next()`; unchanged, but verify it still fires with an async-iterable prompt (Test After 1 with a stalled mock).

## Security considerations

- No new credentials or env exposure. Operator prose is never logged (`claude.interrupt_failed` logs the error only).

## Next steps

Phase 2 consumes `interruptSignal`, `terminalReason`, and the `interrupt` capability. Do not start Phase 2 until the spike report is written.
