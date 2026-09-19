---
title: 'Issue 187 interrupt and redirect a running DeepSeek agent'
description: 'Implementation-ready plan for Agent Node Room Story 2.7: end a DeepSeek ACP turn with session/cancel, classify the provider’s existing abort result, and resume the same persisted ACP session for redirected work.'
status: ready
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/187'
branch: archon/thread-e3d2ab87
tags: [issue-187, agent-node-room, providers, deepseek, workflows, tdd, deep]
blockedBy: []
blocks: []
created: 2026-09-20
revised: 2026-09-20
---

# Issue 187: interrupt and redirect a running DeepSeek agent

## Goal and user outcome

When an operator presses `Stop` while a DeepSeek-backed direct or AI-loop node is generating, Archon cancels only the current DSH ACP prompt with `session/cancel`. The workflow node stays `running`, the existing steering handle enters `idle-after-interrupt`, and `Send now` starts the next provider turn by resuming the same persisted ACP session id. Earlier queued guidance and the new message retain receipt order. A tool still open when the cancelled turn ends is recorded as `interrupted` so the existing transcript renderer shows `⚠`.

This is the outcome in issue #187 and Story 2.7 at `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:614-640`. Story 2.3 already supplied the registry, fresh per-turn `interruptSignal`, five-case turn-end handling, interrupt route, projected sub-state, both web docks, and generic visual/E2E coverage. Story 2.7 is therefore limited to the DeepSeek provider seam, the exact DeepSeek result discriminator in both executor paths, conformance coverage, and user-facing provider documentation.

## Verified authority and current behavior

The implementation must follow these sources in descending order:

1. Story 2.7 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:614-640` and issue #187.
2. The canonical Agent Node Room contract in `_bmad-output/specs/spec-agent-node-room/SPEC.md:27,129-150`, especially the five-case rule at line 133.
3. `_bmad-output/specs/spec-agent-node-room/engine-integration.md:15-40`, `steering-test-plan.md:15-44`, and `provider-steering-matrix.md:59-63`.
4. Current provider, executor, route, registry, web, test, and generated-doc code.

Verified repository facts:

- `AgentRequestOptions.interruptSignal` and `ProviderCapabilities.interrupt` already exist in `packages/providers/src/types.ts`. The executor creates a fresh controller immediately before every provider pass (`packages/workflows/src/dag-executor.ts:2428-2435` and `:6322-6325`).
- DeepSeek currently forwards only `abortSignal` (`community/deepseek/provider.ts:202-217`) and advertises `interrupt: false` (`capabilities.ts:25`).
- `driveDeepseekAcpTurn()` already uses ACP `session/cancel`, closes the live ACP session, and emits the stable local result `{ stopReason:'aborted', isError:true, errorSubtype:'deepseek_aborted', sessionId }` (`acp-client.ts:105-113,312-374`). It does not need a new result field.
- The canonical spec explicitly identifies DeepSeek's `stopReason:'aborted'` / `errorSubtype:'deepseek_aborted'` result as the abort marker. `terminalReason` is documented as a provider-native value forwarded verbatim from an SDK result (`types.ts:350-356`); synthesizing `terminalReason:'cancelled'` would create a second DeepSeek contract, change node-Cancel output, and contradict that documentation.
- Both executor paths currently classify only Claude's exact native `terminalReason` values (`dag-executor.ts:452-465,2688-2693,6409-6414`). The interrupted branch already precedes the generic SDK-error guard, preserves the result's session id, skips structured-output validation/re-ask, and enters the existing same-session idle path.
- The route and both docks are provider-neutral. They consume only the live handle and `steeringSubState` (`packages/server/src/routes/api.ts:5464-5555`, `packages/web/src/lib/steering-dock.ts`, `packages/web/src/components/workflows/ComposerDock.tsx`, and `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`). No provider-id branch or DeepSeek-specific UI copy exists.
- The final visual/behavioral authority is `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/{DESIGN,EXPERIENCE}.md`; `EXPERIENCE.md` explicitly wins over imports and wireframes. The older `imports/mockup-live-interaction.html` says `Stop node`/`stopped`, but the final reframe and current components use `Stop`, keep the node `running`, and project `idle-after-interrupt`. Existing Story 2.3 tests cover both docks, including the Legacy 460px and Console 520px panel baselines. This provider-only story has no unresolved design conflict and requires no visual change.
- Each DeepSeek turn already runs in a fresh DSH child. A follow-up uses `session/resume` on the persisted id and then closes/reaps that child. Story 2.7 promises the same logical ACP session, not a long-lived operating-system process. Current upstream DSH documentation corroborates that close persists state for later resume, but the pinned `@deepseek-ai/dsh@0.1.2-rc.1` behavior still requires the live gate below.
- ACP cancellation requires the pending prompt to settle as `cancelled`; Archon's DeepSeek adapter intentionally normalizes that transport outcome into its existing local `deepseek_aborted` result. The executor should classify the normalized contract rather than expose or invent another wire value.

External dependency evidence used only as corroboration, not as a substitute for the pinned-runtime spike:

- [DeepSeek Harness ACP package contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md) documents persistent resume across process restarts, prompt-owned `session/cancel`, quiescent `session/close`, and persistence after close.
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts) exposes typed `session.cancel`, `session.resume`, `session.close`, and `PromptResponse.stopReason` on the pinned SDK family.

## Corrected technical decisions

### D1 — Preserve the existing DeepSeek abort-result contract

Do not add `terminalReason` to `abortedResult()` and do not add `'cancelled'` to `INTERRUPT_TERMINAL_REASONS`. Add one provider-neutral executor predicate that accepts either:

- Claude/e2e-fake: the existing exact `terminalReason` allowlist; or
- DeepSeek: the exact normalized result triple `stopReason === 'aborted'`, `isError === true`, and `errorSubtype === 'deepseek_aborted'`.

The operator-interrupt token remains a separate mandatory condition. A DeepSeek error without the flag still takes the existing SDK-error failure path. Requiring the complete triple prevents an unrelated error or a result carrying only one coincidental field from being reclassified.

### D2 — One cancellation primitive, with the first cause recorded

`DeepseekAcpTurnInput` gains `interruptSignal?: AbortSignal`; `DeepseekProvider.sendQuery()` forwards it unchanged. The ACP driver listens to node Cancel and operator Stop separately. One `requestCancel(cause)` records the first cause and releases the local prompt wait; one `flushCancel()` sends at most one ACP notification when the client and session id exist. This split preserves a cancellation requested during initialization and still makes the wire notification exactly once. It protects three contracts:

- either signal sends at most one ACP `session/cancel`;
- node Cancel keeps its existing result and executor failure behavior;
- if live evidence requires special treatment of a failed tool update, only an operator interrupt may map that update to `toolOutcome:'interrupted'`.

Register listeners while the session is live, handle a signal already aborted when the session becomes available, and remove both listeners on every completion/error/consumer-return path. Freeze the turn outcome when `session/prompt` settles: a later Stop during `session/close` must not convert a natural result into an abort result or send a stale cancel.

Keep the existing local abort result byte-for-byte. Calls without `interruptSignal` retain their current prompt, result, and cleanup behavior.

### D3 — Bounded local cancellation, then normal close/reap

Use the existing Devin ACP pattern as the local precedent: cancellation releases the prompt wait after a fixed 500ms drain grace (`CANCEL_DRAIN_GRACE_MS`, matching Devin) so an agent that fails to answer the cancelled prompt cannot keep Archon waiting on `session/prompt` indefinitely. The normal `session/close` and `runDeepseekAcpTurn()` child reaper still run. Preserve late update ordering during the drain grace and surface close/protocol failures rather than manufacturing success. The pinned-runtime gate must also prove the complete Stop acknowledgement remains below the final UX contract's one-second ceiling.

This is a reliability guard, not a new configuration knob. It requires deterministic coverage with a fake agent that ignores `session/cancel`; do not expose a timeout setting.

### D4 — Tool outcome is evidence-driven and must not alter Cancel

The executor already settles any tool still open when the abort result arrives as `interrupted`. No bridge change is needed when DSH leaves the tool open or reports an interrupted outcome itself.

If the pinned live spike proves DSH reports an in-flight cancelled tool as ACP `status:'failed'` before the abort result, extend `DeepseekEventState` with the first cancellation cause and map `failed` to `toolOutcome:'interrupted'` only when that cause is `operator-interrupt`. A normal failure and a node-Cancel failure remain `error`. Do not infer cancellation from tool output text.

### D5 — Advertise capability only after the seam and classifier agree

`DEEPSEEK_CAPABILITIES.interrupt` becomes `'native'` only in Phase 2, together with the exact executor predicate and its direct/loop conformance tests. ACP `session/cancel` is a provider-native turn primitive; the next Archon call resumes the same persisted session id even though it uses a fresh DSH child. `'stream-abort'` remains reserved for adapters that terminate by aborting their stream rather than asking the provider to cancel its turn.

### D6 — Real DSH is a ship gate, not a source of runtime parsing rules

A diagnostic script exercises the pinned DSH/ACP pair in a disposable directory and emits sanitized structured evidence. It must be time-bounded and must never print prompt text, model output, credentials, base URLs, environment contents, or raw tool payloads. The capability must not ship if cancel does not yield a resumable session or the continuation fails. No fallback to a fresh session or node Cancel is allowed.

## Scope and affected files

| Area                        | Files                                                                                                                                                                                                                      | Change                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Provider seam               | `packages/providers/src/community/deepseek/acp-client.ts`, `packages/providers/src/community/deepseek/provider.ts`                                                                                                         | Forward the turn signal; exactly-once cause-aware ACP cancellation; listener/outcome race handling; bounded local cancel drain. |
| Provider tests              | `packages/providers/src/community/deepseek/acp-client.test.ts`, `packages/providers/src/community/deepseek/provider.test.ts`                                                                                               | Exact signal, cleanup, race, ignored-cancel, and unchanged-result coverage.                                                     |
| Optional tool normalization | `packages/providers/src/community/deepseek/event-bridge.ts`, `packages/providers/src/community/deepseek/event-bridge.test.ts`                                                                                              | Only if pinned live evidence observes `failed` for an operator-cancelled in-flight tool.                                        |
| Live diagnostic             | `packages/providers/src/community/deepseek/interrupt-resume-spike.ts`, `packages/providers/package.json`, `plans/reports/deepseek-interrupt-resume-spike.md`                                                               | Bounded cancel/resume/continuation evidence; script is not exported or run in CI.                                               |
| Engine contract             | `packages/workflows/src/dag-executor.ts`, `packages/workflows/src/dag-executor.test.ts`                                                                                                                                    | Exact normalized DeepSeek result predicate on direct and loop paths; DeepSeek conformance fixture.                              |
| Capability contract         | `packages/providers/src/community/deepseek/capabilities.ts`, `packages/providers/src/community/deepseek/config.test.ts`, `packages/providers/src/registry.test.ts`, `packages/providers/src/types.ts`                      | Advertise native interrupt, update pinned fixtures and capability documentation.                                                |
| User docs/status            | `packages/docs-web/src/content/docs/reference/provider-capabilities.md`, `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`, `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Document behavior, regenerate the canonical matrix, close only after all gates.                                                 |

Out of scope:

- No registry state-machine, HTTP route/schema, generated API type, web component, CSS, or Playwright change. The approved Story 2.3 visual states and responsive evidence remain authoritative because this story only makes an existing capability available to another provider. If implementation unexpectedly requires a UI diff, stop and re-scope it against final `DESIGN.md`/`EXPERIENCE.md` with explicit generating, stopping, idle, resumed, Legacy 460px, and Console 520px acceptance evidence.
- No long-lived DSH child, concurrent prompt, soft-inject, new protocol field, database/schema change, durable steering state, new timeout setting, or fallback to a fresh session.
- No change to Codex, OMP, Grok, Devin, Claude, idle-await expiry, operator transcript rows, or DeepSeek usage/cost reporting.
- No attempt to roll back files or side effects produced by a tool before interruption; `Stop` is not undo.

## Implementation phases

| #   | Phase                                                                                                                | Depends on             | Exit condition                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | [DeepSeek ACP interrupt seam and pinned-runtime gate](./phase-01-deepseek-acp-interrupt-seam.md)                     | —                      | Provider tests pass and sanitized live evidence proves cancel, retained id, close, and resume. |
| 2   | [Executor discriminator, capability, and conformance fixture](./phase-02-executor-marker-and-conformance-fixture.md) | Phase 1 proceed result | Exact result is handled on direct and loop paths; capability fixtures agree.                   |
| 3   | [Generated matrix, provider docs, and closeout](./phase-03-matrix-docs-and-closeout.md)                              | Phases 1-2             | Full validation passes; evidence is linked; sprint status changes last.                        |

## Acceptance criteria

- [ ] A live DeepSeek turn with an aborted `interruptSignal` sends exactly one ACP `session/cancel`, closes the ACP session, reaps the child, and emits the unchanged `{ sessionId, stopReason:'aborted', isError:true, errorSubtype:'deepseek_aborted' }` result.
- [ ] A node-Cancel-only turn retains the same result and failure behavior; a Stop+Cancel race sends no duplicate cancel, and executor Cancel still dominates.
- [ ] A natural prompt result that wins a Stop race remains natural; no stale cancel is sent during close. Both signal listeners are removed on success, failure, and early consumer return.
- [ ] With the operator-interrupt flag set, and only then, both direct and AI-loop executor paths classify the exact DeepSeek abort triple as interrupted, write exactly one `interrupted` status, skip SDK-error/structured-output re-ask handling, and enter `idle-after-interrupt` without `node_failed`.
- [ ] `Send now` drains queued and new guidance in receipt order and calls the next provider turn with the interrupted result's session id; `resumed:true` and a non-error continuation prove no fresh-session fallback occurred.
- [ ] A tool still open at the interrupted result is recorded once as `interrupted`. If the bridge emits a terminal failed update after operator cancellation, the evidence-gated mapping produces `interrupted`; ordinary failure and node Cancel remain `error`.
- [ ] Sanitized, time-bounded evidence against `@deepseek-ai/dsh@0.1.2-rc.1` and `@agentclientprotocol/sdk@1.4.0` proves `interruptSignal` abort -> local abort result in less than 1,000ms and cancel -> close -> resume -> completed continuation on one session id; executor conformance proves that result enters `idle-after-interrupt`.
- [ ] DeepSeek advertises `interrupt:'native'`; the generated matrix and assistant guide describe the same behavior; focused tests, type-check, generated-doc check, and `bun run validate` pass.
- [ ] `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` changes from `backlog` to `done` only after all prior criteria pass and issue #187 has the evidence reference.

## Compatibility, security, performance, and operations

- The request addition is optional; no database, API, YAML, or serialized contract changes. DeepSeek's existing abort-result shape remains compatible for all consumers.
- The change does not broaden DSH permissions. The live spike runs only in a disposable temporary directory with the existing credential contract and records no secrets or model content.
- No extra long-running process is introduced. Every turn still closes its ACP session and reaps its DSH child. The fixed local drain grace bounds the cancelled prompt wait without becoming user configuration; close/protocol failures remain explicit.
- The redirect retains current per-turn process startup cost. The story guarantees logical-session continuity, not the 31 ms warm-connection measurement from the research matrix.
- Resume failure remains a hard `deepseek_resume_failed` node failure. It is never silently replaced by `session/new`.
- Rollback is code-only: set DeepSeek interrupt back to `false`, remove the DeepSeek result branch from the predicate, and revert the signal forwarding. No data rollback is required.

## Validation sequence

Run from an installed workspace. Do not use root `bun test`.

```bash
cd packages/providers
bun test src/community/deepseek/acp-client.test.ts src/community/deepseek/provider.test.ts src/community/deepseek/event-bridge.test.ts src/community/deepseek/config.test.ts src/registry.test.ts

cd ../workflows
bun test src/dag-executor.test.ts -t 'deepseek conformance'

cd ../..
bun run generate:capability-matrix
bun run check:capability-matrix
bun run type-check

cd packages/providers
DEEPSEEK_LIVE_TEST=1 DEEPSEEK_API_KEY=... DEEPSEEK_BASE_URL=... DEEPSEEK_LIVE_MODEL=... bun run spike:interrupt:deepseek

cd ../..
bun run validate
```

The live command is operator-run and non-CI. Record its sanitized stdout and dependency pins in `plans/reports/deepseek-interrupt-resume-spike.md`.

## Unresolved execution evidence

- This planning session had no DeepSeek live credentials, so the pinned runtime's exact post-cancel tool update (`failed`, no terminal update, or another status) remains a Phase 1 observation. The plan contains an explicit, first-cause-safe branch for each outcome.
- The pinned runtime must still prove that `session/resume` succeeds after Archon sends `session/cancel` and `session/close`. Current repository research and upstream DSH documentation support it, but capability advertisement is gated on the actual spike.
