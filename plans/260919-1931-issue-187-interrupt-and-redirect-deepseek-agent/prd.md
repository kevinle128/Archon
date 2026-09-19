# PRD: Interrupt and redirect a running DeepSeek agent

- **Issue:** https://github.com/kevinle128/Archon/issues/187
- **Story:** Agent Node Room Story 2.7 — `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:614-640`
- **Branch:** `archon/thread-e3d2ab87`
- **Source plan:** `plan.md` + `phase-01` … `phase-03` in this directory

## Overview

When an operator presses `Stop` while a DeepSeek-backed direct or AI-loop node is generating, Archon must cancel only the current DSH ACP prompt with `session/cancel`. The workflow node stays `running`, the steering handle enters `idle-after-interrupt`, and `Send now` starts the next provider turn by resuming the **same persisted ACP session id** (in a fresh DSH child). Queued + new guidance retain receipt order. A tool still open when the cancelled turn ends is recorded `interrupted` so the transcript shows `⚠`.

## Problem

Story 2.3 already built the whole provider-neutral stack: steering registry, fresh per-turn `interruptSignal`, five-case turn-end handling, interrupt route, `steeringSubState`, both web docks, and E2E coverage — but only Claude advertises `interrupt: 'native'`. DeepSeek forwards only `abortSignal` (node Cancel), advertises `interrupt: false`, and the executor classifies only Claude's exact native `terminalReason` values. Operator Stop on a DeepSeek node therefore does nothing provider-native.

## Solution

1. **Provider seam:** accept `interruptSignal` per turn, send exactly one cause-aware ACP `session/cancel` (first cause wins: `node-cancel` vs `operator-interrupt`), bound the cancelled-prompt wait with a fixed 500ms drain grace matching the Devin ACP pattern, and keep the existing local abort result byte-for-byte: `{ sessionId, stopReason:'aborted', isError:true, errorSubtype:'deepseek_aborted' }`.
2. **Executor:** replace terminal-reason-only classification with one provider-neutral predicate that also accepts the exact DeepSeek triple — gated on the operator-interrupt token. No provider-id branching, no `terminalReason:'cancelled'` synthesis.
3. **Capability + docs:** flip `DEEPSEEK_CAPABILITIES.interrupt` to `'native'` only after the pinned-runtime spike proves cancel → close → resume → continuation on one session id; regenerate the capability matrix; document verified behavior; close the sprint story last.

## Goals and success metrics

- `interruptSignal` abort during a live DeepSeek turn → exactly one `session/cancel`, session close, child reap, unchanged abort result — acknowledged < 1000ms on the pinned runtime.
- `Send now` resumes the same ACP session id (`resumed:true`, non-error continuation); no fresh-session fallback ever.
- Direct and AI-loop executor paths classify the exact DeepSeek triple as interrupted **only** with the operator flag; flagless or near-miss results keep the existing failure path.
- Open tool at interrupt → exactly one `interrupted` outcome; `failed`-after-operator-cancel maps to `interrupted` only if live evidence demands the bridge change.
- `bun run validate` green; generated matrix shows DeepSeek `**native**`; story `2-7` → `done` in `sprint-status.yaml` as the final edit.

## Non-goals

- No registry state-machine, HTTP route/schema, generated API type, web component, CSS, or Playwright changes (Story 2.3 visuals remain authoritative).
- No long-lived DSH child, concurrent prompt, soft-inject, new protocol field, DB/schema change, durable steering state, new timeout config, or fresh-session fallback.
- No changes to Codex, OMP, Grok, Devin, Claude, idle-await expiry, operator transcript rows, or DeepSeek usage/cost reporting.
- `Stop` is not undo — completed tool/file effects are never rolled back.
- Do not promise warm processes, 31ms latency, retained uncommitted model text, or token/cost reporting in docs.

## Technical context

### Verified facts (from plan)

- `AgentRequestOptions.interruptSignal` and `ProviderCapabilities.interrupt` already exist in `packages/providers/src/types.ts`. The executor creates a fresh controller before every provider pass: `packages/workflows/src/dag-executor.ts:2428-2435` and `:6322-6325`.
- DeepSeek forwards only `abortSignal` at `packages/providers/src/community/deepseek/provider.ts:202-217`; `interrupt: false` at `capabilities.ts:25`.
- `driveDeepseekAcpTurn()` already uses ACP `session/cancel`, closes the ACP session, reaps the child, and emits `{ stopReason:'aborted', isError:true, errorSubtype:'deepseek_aborted', sessionId }` — `acp-client.ts:105-113,312-374`. **Do not add fields.**
- `terminalReason` is documented as provider-native verbatim (`types.ts:350-356`); synthesizing `cancelled` would create a second DeepSeek contract.
- Both executor paths classify only Claude's exact `terminalReason` values: `dag-executor.ts:452-465,2688-2693,6409-6414`. The interrupted branch already precedes the generic SDK-error guard, preserves session id, skips structured-output re-ask, and enters the same-session idle path.
- Route + both docks are provider-neutral: `packages/server/src/routes/api.ts:5464-5555`, `packages/web/src/lib/steering-dock.ts`, `packages/web/src/components/workflows/ComposerDock.tsx`, `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`.
- Resume after cancel+close at the pinned runtime is **unproven** until the spike runs — that is the ship gate.
- Pinned deps: `@deepseek-ai/dsh@0.1.2-rc.1`, `@agentclientprotocol/sdk@1.4.0`.

### Key decisions (D1–D6, from plan)

- **D1** — Preserve the abort-result contract. One executor predicate accepts Claude's terminalReason allowlist OR the complete DeepSeek triple; operator-interrupt token remains mandatory.
- **D2** — One cancellation primitive, first cause recorded. `requestCancel(cause)` records + releases the prompt wait once; `flushCancel()` sends at most one wire notification once client+session exist. Listeners removed on every completion/error/consumer-return path; outcome frozen when `session/prompt` settles.
- **D3** — `CANCEL_DRAIN_GRACE_MS = 500` (Devin precedent) bounds the cancelled prompt wait; normal close/reap still run; close/protocol failures surface, not masked. No config knob.
- **D4** — Tool outcome is evidence-driven. Executor already settles still-open tools as `interrupted`. Only if the live spike shows an in-flight cancelled tool arriving as ACP `status:'failed'`, extend `DeepseekEventState` with first cause and map `failed` → `interrupted` **only** for `operator-interrupt`; normal failure and node-cancel stay `error`. Never infer from tool output text.
- **D5** — `interrupt: 'native'` flips only in Phase 2, with the predicate + conformance tests.
- **D6** — The spike is a ship gate: bounded, sanitized (no prompts, model output, credentials, base URLs, env, raw tool payloads), version-checked, non-CI. Blocked evidence → do not flip capability, no fallback.

### File map

| Area            | Files                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider seam   | `packages/providers/src/community/deepseek/acp-client.ts`, `provider.ts`                                                                                          |
| Provider tests  | `acp-client.test.ts`, `provider.test.ts`, (conditional) `event-bridge.ts` + `.test.ts`                                                                            |
| Live diagnostic | `interrupt-resume-spike.ts` (new), `packages/providers/package.json`, `plans/reports/deepseek-interrupt-resume-spike.md`                                          |
| Engine          | `packages/workflows/src/dag-executor.ts`, `dag-executor.test.ts`                                                                                                  |
| Capability      | `capabilities.ts`, `config.test.ts`, `registry.test.ts`, `types.ts`                                                                                               |
| Docs/closeout   | `packages/docs-web/.../provider-capabilities.md` (regenerate), `.../ai-assistants.md`, `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` |

### Validation commands

Run from an installed workspace — **never** root `bun test` (package-isolated runs only).

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

# Operator-run, non-CI, requires credentials:
cd packages/providers
DEEPSEEK_LIVE_TEST=1 DEEPSEEK_API_KEY=... DEEPSEEK_BASE_URL=... DEEPSEEK_LIVE_MODEL=... bun run spike:interrupt:deepseek

cd ../..
bun run validate
```

## Story overview

| ID     | Title                                                              | Phase | Depends on     |
| ------ | ------------------------------------------------------------------ | ----- | -------------- |
| US-001 | DeepSeek ACP interrupt seam + pinned-runtime spike                 | 1     | —              |
| US-002 | Executor interrupt predicate, capability flip, conformance fixture | 2     | US-001         |
| US-003 | Capability matrix, provider docs, evidence + sprint closeout       | 3     | US-001, US-002 |

Stories run in priority order (1 → 3). Each is completable in one fresh-context iteration; TDD ordering inside each story: write the listed failing tests first, implement, then run the regression gate.
