# PRD: Grok interrupt-and-redirect (issue #186 / Story 2.6)

Source plan: `plans/260920-0449-issue-186-grok-interrupt-redirect/plan.md` + `phase-01..04-*.md` in this directory. This PRD is self-contained; a fresh-context agent should not need the plan to execute a story, but the phase files remain the authority for fine detail.

## Overview / Problem

When an operator presses `Stop` while a Grok-backed direct AI node or AI loop is generating, Archon must end only the current Grok turn — the workflow node stays `running`, the steering handle enters `idle-after-interrupt`, and `Send now` continues the **same persisted session** with `forkSession: false`. Queued guidance precedes newly typed guidance in receipt order. A tool left open by the interrupted turn is recorded exactly once as `interrupted` (rendered `⚠`, not failure). Interrupted turns without a terminal `end` event must not fabricate token/USD accounting.

Story 2.3 already delivered the registry, fresh per-turn `interruptSignal`, route, queue, idle-await lifecycle, provider-neutral docks, and direct/AI-loop turn machinery. This story is therefore: (1) a runtime evidence gate, (2) a Grok provider seam, (3) one exact executor result discriminator, (4) capability publication + docs. It is **not** a new steering system or UI redesign.

Current state: `GrokProvider` treats only `abortSignal` (node Cancel) as process termination, emits `grok_incomplete_output` without an `end` event, and advertises `interrupt: false`. `GrokEventParser` learns the session id only from the `end` event and closes unresolved tools as `unknown`.

## Solution (corrected technical decisions D1–D6)

- **D1 — Evidence proves the product contract.** Safe interrupt boundary `M` is the earliest production-observable event predicate after which: target session resumable, current turn's prompt marker retained (not just inherited context), inherited marker retained on resumed/forked turns, request-to-settlement < 1,000 ms in every sample, no descendant left behind. `M` must cover text-only, reasoning-first, and tool-first first-progress shapes; a terminal `end` arriving first is natural completion. No weaker fallback accepted — if no `M` meets the contract on a supported host, the story stays blocked.
- **D2 — Preassign identity only on interrupt-capable turns.** With `interruptSignal`: new turn → `--session-id <uuid>`; fork → `--resume <source> --fork-session --session-id <new-uuid>`; non-fork resume → `--resume <existing>` only. Without `interruptSignal`: byte-for-byte unchanged argv. Reported `end.sessionId` ≠ expected id → fail-closed `grok_session_id_mismatch`, never `grok_aborted`.
- **D3 — One exact normalized abort result.** `{ type:'result', sessionId, stopReason:'aborted', isError:true, errorSubtype:'grok_aborted', resumed? }`. Usage fields only when Grok emitted authoritative terminal usage. No synthesized Claude `terminalReason`. Live operator-interrupt token still required by the executor.
- **D4 — Cause-aware, tree-safe termination.** First cause recorded (interrupt / node cancel / natural / fault); node Cancel re-checked at settlement and dominates. Interrupt-involved shutdown settles < 1,000 ms; Cancel-only cleanup keeps existing 5,000 ms grace. Only a graceful interrupt after `M` emits `grok_aborted`; unmaterialized / forced kill / mismatch / prior fault stay genuine failures. Owned-tree spawn (POSIX detached process group; Windows primitive proven in Phase 1) only when `interruptSignal` present; termination encapsulated behind `GrokProcess`; no broad process-name matching.
- **D5 — Authoritative tool + accounting semantics.** On interrupt, each unresolved tool closes once with `toolOutcome:'interrupted'`, `outputState:'missing'` before the abort result; executor removes it from its running-tool map so no duplicate `tool_completed`. No fabricated usage without `end`; a matching `end` with usage winning the drain race retains authoritative fields while the turn is still classified interrupted.
- **D6 — Capability flips last.** `GROK_CAPABILITIES.interrupt` stays `false` through evidence/provider/executor phases; `'stream-abort'` only after all gates pass. No `archon doctor` version floor from a single tested build.

## Goals and success metrics

- Stop on new/resumed/forked Grok turns settles < 1,000 ms on native macOS, Linux, and Windows; no Grok/tool descendant survives; resumed session contains inherited context **and** the interrupted turn's unique prompt marker.
- Successful Stop emits the exact `grok_aborted` result with a concrete session id — never after forced kill, missing materialization, identity mismatch, or prior fault.
- Node Cancel keeps `Query aborted` and wins Stop races; natural completion that wins stays natural.
- Direct AI and AI-loop paths write one `interrupted` status, skip partial-output validation/re-ask, enter idle-await, no `node_failed`, resume same session on `Send now`.
- Queued + new guidance reach the next turn in receipt order with `forkSession: false`.
- Each in-flight tool recorded exactly once as `interrupted`; no fabricated usage/cost.
- Calls without `interruptSignal` keep existing argv/result behavior; complete listener/timer/process cleanup on all exit paths.
- `interrupt: 'stream-abort'` advertised only after all gates; generated matrix, guide, and tested build/hosts agree.
- `bun run validate` passes; sprint `2-6-...` moves `backlog` → `done` only after the acceptance report maps every criterion to evidence.

## Non-goals (explicit plan scope)

- No route, schema, generated API, database, registry state-machine, web component, CSS, or Playwright change.
- No Grok hook/interjection soft-inject, leader-socket integration, ACP transport migration, or concurrent prompts.
- No rollback of files/side effects already produced by Grok tools.
- No fabricated spend for interrupted turns; no new user configuration or YAML surface.
- No provider-specific executor branch, no natural-language error classification, no `archon doctor` minimum-version rejection.
- No permanent credentialed CI workflow for the diagnostic (operator-run from a reviewed commit on trusted hosts).

## Technical context

### Verified code anchors (on branch `archon/thread-34dc83fe`)

- `packages/providers/src/grok/capabilities.ts:21` — `interrupt: false` (flip last, in US-004).
- `packages/providers/src/grok/provider.ts:24` `GrokProcess`, `:31` `GrokSpawnOptions`, `:58` `defaultSpawner`, `:83` `buildSpawnCommand`, `:110` `buildGrokArgs`, `:270`–`:406` existing `abortSignal` (node Cancel) handling incl. `throw new Error('Query aborted')` at `:270`/`:354`.
- `packages/providers/src/grok/event-parser.ts:97` `closeOutstandingTools()` (defaults `unknown`), `:113` `buildResult()`, `:123` `grok_incomplete_output` path, `:136` `getSessionId()`, `:292` session id learned from `end`.
- `packages/providers/src/types.ts:609` `interruptSignal?: AbortSignal`; `:843`–`:847` `interrupt: 'native' | 'stream-abort' | false` contract.
- `packages/workflows/src/dag-executor.ts:481`–`:493` `isInterruptMarkedResult()` — Claude `terminalReason` allowlist OR exact DeepSeek triple; call sites `:2746` (direct) and `:6510` (AI loop). Extend the error-subtype to a set `{deepseek_aborted, grok_aborted}` requiring the full triple; fix the stale comment at `:475`.
- `packages/providers/src/registry.test.ts` — Grok published-capability assertion (US-004).
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` — generated; regenerate via `bun run generate:capability-matrix`, never hand-edit.
- `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` — add Grok interrupt section under `## Grok Build`.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` — change only `2-6-interrupt-and-redirect-a-running-grok-agent`, last.
- `plans/reports/` — precedent sanitized spike report: `deepseek-interrupt-resume-spike.md`.

### Spike assets

- Commit `2fb341bd` exists in the repo but is **not** an ancestor of HEAD — cherry-pick it in US-001. It adds only `packages/providers/src/grok/interrupt-resume-spike.ts`, the `spike:interrupt:grok` script in `packages/providers/package.json`, and `plans/reports/spike-260920-0243-grok-interrupt-resume.md`. Do NOT bring PR #217's superseded plan/PRD/progress/checkpoint files.
- `interrupt-resume-spike.ts` does not exist on this branch until the cherry-pick.
- Tested build: `grok 1.0.34 (3736acbc8658) [stable]` — evidence of compatibility, not a minimum version.

### Commands

```bash
cd packages/providers && bun run type-check
bun test src/grok/event-parser.test.ts src/grok/provider.test.ts src/grok/usage-contract.test.ts src/registry.test.ts
cd packages/workflows && bun test src/dag-executor.test.ts -t 'interrupt' && bun run test
# root:
bun run generate:capability-matrix && bun run check:capability-matrix
bun run build:docs && bun run lint --max-warnings 0 && bun run format:check && bun run type-check && bun run validate
# diagnostic (operator-run, needs XAI_API_KEY):
GROK_SPIKE_REPORT_PATH=<report> bun --filter @archon/providers run spike:interrupt:grok
```

Never run root `bun test` — `bun run validate` uses package-isolated test commands.

### Cross-cutting rules

- Sanitization: reports/tests may include opaque session ids, timings, event types, booleans — never credentials, prompts, markers, model text, home paths, session contents, or raw stderr.
- Process hygiene: track/terminate only exact child fingerprints; verify start identity before cleanup (PID-reuse); no `pkill`/name matching.
- Determinism: provider tests use controllable fake process + fake timers — no multi-second real timers.
- Honest gates: blank/failed validation-log entries are blockers, not optional. No 30-second Stop fallback, no percentile waiver, no POSIX-only publication, no fresh-session fallback.
- Rollback order: capability back to `false` → regenerate matrix → revert predicate/docs → revert dormant provider seam. Owned-tree spawn only engages when `interruptSignal` is supplied, so capability rollback restores the pre-feature spawn path.

## Story overview

| ID     | Title                                      | Plan phase | Depends on     | Core deliverable                                                              |
| ------ | ------------------------------------------ | ---------- | -------------- | ----------------------------------------------------------------------------- |
| US-001 | Round-2 runtime evidence gate (spike)      | Phase 1    | —              | Refactored diagnostic + sanitized PASS/BLOCKED report + filled validation log |
| US-002 | Grok provider stream-abort seam            | Phase 2    | US-001         | Provider/parser seam + P1–P6/T1–T18 green; capability still `false`           |
| US-003 | Executor conformance: direct + AI loop     | Phase 3    | US-002         | Exact subtype predicate + G0–G4 conformance green                             |
| US-004 | Capability publication, docs, and closeout | Phase 4    | US-001..US-003 | `'stream-abort'` flip + matrix + guide + acceptance report + sprint done + PR |
