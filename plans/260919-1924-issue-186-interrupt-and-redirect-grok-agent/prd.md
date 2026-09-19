# PRD: Interrupt and redirect a running Grok agent (Issue #186)

## Overview

**Problem.** When a Grok-backed workflow node is generating, an operator pressing `Stop` in the Agent Node Room currently cannot end just the current Grok CLI turn. The Grok provider (`packages/providers/src/grok/provider.ts`) only listens to `abortSignal` (node Cancel — terminal), sends SIGTERM then SIGKILL after five seconds, and treats a missing `end` event as a provider error. The parser (`event-parser.ts`) closes open tools as `unknown` and learns the session ID only from `end`, so an interrupted turn loses its session identity and open tools are mislabeled.

**Solution.** Make the Grok provider honor the distinct per-turn `interruptSignal` already delivered by the engine (shipped in Story 2.3 / PR #214): end only the current CLI turn, keep the node `running` in `idle-after-interrupt`, record open tools as `interrupted`, and let `Send now` continue on the **same Grok session** via `resumeSessionId`. Because a killed-before-`end` turn would otherwise lose its session ID, the provider pre-assigns a UUID (`--session-id`) for interrupt-capable new/forked turns. `GROK_CAPABILITIES.interrupt` flips from `false` to `'stream-abort'` only after a real-CLI spike proves Grok's behavior on every advertised platform.

**Issue:** https://github.com/kevinle128/Archon/issues/186 — implements Story 2.6 of `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. Stream-abort was selected for Grok in `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md` because `x.ai/interject` is unreachable.

## Goals and success metrics

1. **Stop affects one turn.** Aborting the per-turn `interruptSignal` gracefully ends only that CLI turn; node stays `running`, reaches `idle-after-interrupt`, writes no `node_failed`/`dag_node_failed` event.
2. **Same-session redirect.** `Send now` issues the next provider call with `resumeSessionId` = interrupted turn's concrete session ID, `forkSession: false`, queued messages then the new message in receipt order.
3. **Interrupted tool.** A tool open at Stop produces exactly one `tool_completed` with `tool_outcome: 'interrupted'`; no duplicate `unknown`/failed outcome.
4. **All provider-calling paths.** Identical Grok result shape passes direct AI node, AI loop, and loop-group body conformance; an interrupted AI-loop iteration is resumed, not consumed.
5. **Causal races.** Natural completion stays natural; Cancel stays terminal and dominant; interrupt-induced I/O close/exit 143 stays interrupted; a pre-existing protocol/transport failure stays a failure; the listener-installation gap is covered.
6. **Responsive Stop.** Phase 1 measures signal-to-exit < 1s on each supported native platform; the longer grace is cleanup-only.
7. **Honest failure.** Missing session identity, failed resume, surviving child, or SIGKILL escalation can never produce an abort-marked success.
8. **Explicit compatibility.** Tested/minimum CLI version documented; `archon doctor` fails actionably on older configured Grok CLIs; non-workflow calls without `interruptSignal` keep byte-identical argv.
9. **Proven platforms.** Same-session interruption passes on every advertised native platform including Windows, or work stops for an explicit scope decision before capability publication.
10. **No UI regression.** Provider-blind dock unchanged; conformance tests prove the data driving `Stop` → `Stopping…` → `Send now` and `⚠ interrupted`.
11. **Evidence.** Sanitized spike + acceptance reports under `plans/reports/`; focused tests, capability-matrix check, and `bun run validate` green; sprint row `2-6-…` → `done` last.

## Non-goals

- Grok `pre_tool_use` hooks, `x.ai/interject`, leader sockets, ACP, or any other transport.
- New routes, database/schema changes, workflow-YAML surface changes, or new dock/reader UI.
- Changes to Codex, OMP, DeepSeek, or other providers.
- Changing the 30-minute idle-after-interrupt lifecycle or the cross-process steering boundary.
- Fabricating partial cost: without an authoritative `end`, standalone `usage` events carry tokens but not spend — record presence only, never invent USD.

## Technical context

### Verified anchors (confirmed against current source)

- `packages/providers/src/grok/capabilities.ts:21` — `interrupt: false` today.
- `packages/providers/src/types.ts:609` — `AgentRequestOptions.interruptSignal?: AbortSignal`; `:356` — result `terminalReason?: string`.
- `packages/providers/src/grok/event-parser.ts` — `closeOutstandingTools()` :97 (closes open tools as `unknown`), `buildResult(resumed)` :113, `getSessionId()` :136 (session learned only from `end`).
- `packages/providers/src/grok/provider.ts` — listens only to `abortSignal`; SIGTERM → SIGKILL after 5s; missing `end` = `grok_incomplete_output` error.
- `packages/providers/src/claude/interrupt-resume-spike.ts` + `askhuman-resume-spike.ts` — sanitized spike structure/timeouts to mirror; `packages/providers/package.json` already has `spike:interrupt:claude` / `spike:askhuman:claude` script entries.
- `packages/workflows/src/dag-executor.ts:457` — `INTERRUPT_TERMINAL_REASONS` = `{'aborted_streaming','aborted_tools'}`; `:2428-2435` — fresh per-pass interrupt controller sets `passOptions.interruptSignal`; comment at `:453` says "the Claude SDK's two abort markers" (comment-only fix to normalized cross-provider wording).
- `packages/workflows/src/dag-executor.test.ts` — 19 generic #183 interrupt cases already cover queue order, same-session continuation, natural/Cancel races, missing session IDs, repeated interrupts, structured output, usage, AI loops, loop-group namespacing. Reuse `liveHandle`, `awaitIdle`, `sendNow`, event helpers, provider mock seams. Do NOT duplicate them.
- `packages/cli/src/commands/doctor.ts` — `checkGrok` runs `grok --version` before `grok models`; extend with a minimum-version gate.
- `packages/providers/src/grok/config.ts` — home for the exported minimum-supported-version constant (single owner; imported by doctor).
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` — generated; regenerate via `bun run generate:capability-matrix`, never hand-edit cells.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` — Grok guide to update.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` — move only `2-6-interrupt-and-redirect-a-running-grok-agent` to `done`, last.
- Installed Grok CLI: `grok 1.0.34`. Bundled docs: SIGINT/SIGTERM save session up to last completed tool call, exit 130/143; `--session-id <UUID>` assigns an ID and may accompany `--resume` only when forking; `updates.jsonl` is authoritative.
- Windows: Grok resolver launches `.cmd`/`.bat` via `cmd.exe`; Node/Bun document no graceful signal path on Windows — S4 must prove behavior on native Windows, never inferred from WSL.

### Design invariants (binding — from plan.md §Design)

1. **Interrupt ≠ Cancel.** Provider listens to `requestOptions.interruptSignal` _in addition to_ `abortSignal`. Spent Cancel fails pre-spawn as today; spent interrupt fails pre-spawn with `Query interrupted`. After spawn, install listeners and immediately recheck both signals (covers abort during binary resolution). Cancel checked first after shutdown — dominant if both fire. Never merge with `AbortSignal.any()`.
2. **Pre-assigned session ID.** With `interruptSignal`: new session → generate UUID, pass `--session-id <uuid>`; resumed non-fork → use `resumeSessionId`, no `--session-id` (Grok rejects the combo); resumed + `forkSession: true` → new UUID with `--resume … --fork-session`. Without `interruptSignal`, argv unchanged. Reported `end.sessionId` is authoritative — on mismatch use reported ID + structured warning, never a user-facing `system` chunk. Never emit an abort-marked result without a concrete assigned/resumed/reported ID.
3. **Causal shutdown classification.** Track first real cause: (a) `end` before Stop → natural result; (b) Cancel → existing `Query aborted`; (c) interrupt claimed while alive and before `end` → graceful stream-abort; (d) protocol/transport fault claimed first → real failure; (e) SIGKILL escalation → distinct non-abort error. Interrupt-induced stdout/stderr closure after (c) must not reclassify as transport error; an earlier fault must not be hidden by a later Stop. Add explicit `hasEnded()` parser query — absent session ID is not a proxy.
4. **Normalize only proven graceful interrupts.** For case (c), after exit within the evidence-backed grace: close each open tool exactly once with `toolOutcome: 'interrupted'`; yield one non-error result with `terminalReason: 'aborted_tools'` (tool was open) or `'aborted_streaming'`; include concrete session ID + any authoritative aggregate usage from `end`; return before non-zero-exit handling (SIGTERM exit 143 is expected). Replace — don't follow — the unconditional `closeOutstandingTools()` call, or persisted outcome stays `unknown`.
5. **Fail closed on process/platform uncertainty.** Phase 1 spike sets the grace period; a normal interrupted run must exit on SIGTERM within it. SIGKILL may remain as cleanup, but escalation → real failure, never resumable success. If a tool child survives the parent, provider owns a POSIX process group and signals it (only if S1 evidence requires). Capability is static/generated — do not flip if native Windows can't preserve+resume under the real `cmd.exe` path.
6. **Reuse the engine contract.** `'stream-abort'` already passes the engine's `interrupt !== false` gate; `aborted_streaming`/`aborted_tools` already recognized. No Grok branches in executor or registry — only provider-neutral comment/docstring fixes.

### TDD map

- **US-001 (Phase 1 spike):** diagnostic-only runner `packages/providers/src/grok/interrupt-resume-spike.ts` + `spike:interrupt:grok` script; experiments S0–S4 (preflight/assigned-ID acceptance, POSIX mid-tool Stop+resume, earliest Stop+resume, repeated Stop, native Windows); sanitized report `plans/reports/spike-260920-0243-grok-interrupt-resume.md` with PASS/BLOCKED per release gate. Any gate fail → mark BLOCKED, attach evidence to #186, stop.
- **US-002 (Phase 2 provider seam):** parser tests P1–P6; provider tests T1–T16 (+T17 only if Phase 1 proves group termination needed); `buildGrokArgs` returns optional assigned session ID; `closeOutstandingTools('unknown'|'interrupted')`; `buildInterruptedResult(sessionId: string, terminalReason, resumed)` — session ID param is required `string`, not optional; internal shutdown cause `none|interrupt|fault` + `forcedKill` flag; interrupt grace constant named/commented with the evidence report; flip `GROK_CAPABILITIES.interrupt` to `'stream-abort'` last, after tests pass.
- **US-003 (Phase 3 conformance):** G1 (direct node mid-tool), G2 (AI loop mid-text — interrupted pass doesn't consume iteration), G3 (loop-group body mid-tool, namespaced). Mock identifies as Grok with `GROK_CAPABILITIES` + exact Phase 2 chunk shape. Comment-only fix in `dag-executor.ts` (`INTERRUPT_TERMINAL_REASONS` wording). Any non-comment executor change = plan change → back to review.
- **US-004 (Phase 4 closeout):** regenerate capability matrix; Grok guide updates (Stop semantics, interrupted-tool glyph, no file rollback, interrupt-not-injection, min CLI version + check/update, exact Phase-1-proven platforms, forced-kill = failure, no-end accounting gap); doctor min-version gate with 5 test cases; `plans/reports/acceptance-260920-0243-issue-186-grok-interrupt.md`; nine-perspective review; sprint-status → `done` last; PR uses `.github/pull_request_template.md` + `Closes #186` if opened.

### Verification commands

```bash
cd packages/providers && bun test src/grok/event-parser.test.ts src/grok/provider.test.ts src/grok/usage-contract.test.ts src/registry.test.ts src/observability.test.ts
cd packages/providers && bun run spike:interrupt:grok   # real CLI; never in CI
cd packages/workflows && bun test src/dag-executor.test.ts -t 'interrupt' && bun run test
cd packages/cli && bun test src/commands/doctor.test.ts
bun run generate:capability-matrix && bun run check:capability-matrix
bun run type-check && bun run lint --max-warnings 0 && bun run validate
```

Never run bare `bun test` from the repo root (bypasses package isolation).

## Story overview

| Story  | Phase | Title                                                 | Depends on             |
| ------ | ----- | ----------------------------------------------------- | ---------------------- |
| US-001 | 1     | Grok protocol/process/version/platform spike gate     | —                      |
| US-002 | 2     | Grok provider stream-abort seam                       | US-001                 |
| US-003 | 3     | Engine conformance: direct, loop, loop-group          | US-002                 |
| US-004 | 4     | Capability matrix, docs, doctor, validation, closeout | US-001, US-002, US-003 |

Source plan: `plan.md` + `phase-01…phase-04` in this directory — the phase files carry binding detail (TDD matrices, release gates, completion checklists); consult the phase file for the story being implemented.
