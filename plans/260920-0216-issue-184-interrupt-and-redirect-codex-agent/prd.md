# PRD: Issue 184 — Interrupt and redirect a running Codex agent

## Overview

Bring Codex onto the provider-independent interrupt/redirect path that Story 2.3
already shipped for Claude. While a Codex-backed workflow node is generating, an
operator presses `Stop` to end only the current provider turn; the node stays
`running` and projects `idle-after-interrupt`; `Send now` then delivers queued
guidance on the **same Codex thread**, in receipt order, without silently
starting a fresh conversation.

Authority:
- Issue: https://github.com/kevinle128/Archon/issues/184
- Story 2.4 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`
- Canonical spec: `_bmad-output/specs/spec-agent-node-room/SPEC.md` + companions
  (`EXPERIENCE.md` wins over mockups on disagreement)
- Compatibility baseline: Story 2.3 code in
  `packages/workflows/src/dag-executor.ts`,
  `packages/workflows/src/steering-registry.ts`, the interrupt server route,
  both web shells, `e2e/ui/agent-interrupt-redirect.spec.ts`
- SDK: `@openai/codex-sdk` declared `^0.144.5`, locked to exactly `0.144.5` in
  `bun.lock`. **No SDK upgrade.** Runtime behavior must be measured at the
  locked version before the capability is exposed.

## Problem

`CodexProvider.sendQuery()` passes one per-attempt controller to the SDK and to
`streamCodexEvents()`; that signal is node Cancel today. Operator Stop must not
be conflated with node Cancel. Additional constraints verified in code:

- A new Codex thread has no resumable id until the stream yields
  `thread.started`; killing the subprocess before retaining that id makes
  same-thread resume impossible.
- Codex's crash classifier treats `killed`/`signal`/`codex exec` strings as
  retryable and cold-retries with `startThread()` — forbidden after an operator
  interrupt and on a strict guidance resume.
- The executor recognizes only `INTERRUPT_TERMINAL_REASONS`; a new normalized
  marker and the capability flip must ship atomically.
- A guidance turn already passes the interrupted session id with
  `forkSession: false` — the existing typed signal for in-place continuation;
  use it to prohibit cold-start fallback (no new request field).
- The shipped disclosure ("stopped after the last completed tool call") is false
  for Codex stream-abort, which can kill a mid-flight command.
- Provider capability is not platform-scoped; Archon ships Linux/macOS/Windows
  binaries, so subprocess abort + descendant cleanup must be proven on all three
  native OS families (WSL counts as Linux, not Windows).

## Solution (4 stories, strict dependency order)

1. **US-001 — Measure the locked SDK** (plan Phase 1): bounded credentialed
   real-SDK spike + sanitized report; no production change. Unknown/unsafe
   result = BLOCKED, not generalized into a broad matcher.
2. **US-002 — Provider/executor slice** (plan Phase 2): separate node Cancel
   from operator Stop, deferred early abort until `thread.started` id retained,
   evidence-based `stream_aborted` terminal marker, retry suppression +
   interruptible backoff, strict same-thread resume when
   `resumeSessionId && forkSession === false`, executor marker recognition,
   atomic capability flip to `'stream-abort'`.
3. **US-003 — Truthful stop disclosure** (plan Phase 3, copy + shells):
   replace disclosure with
   `turn stopped · in-flight work may be partial · written files stay written`
   across canonical UX authority, shared web constant, both shells' tests, and
   the two-shell Playwright scenario.
4. **US-004 — Closeout** (plan Phase 3, evidence + gates): steering test plan +
   provider matrix updates, regenerated capability docs, acceptance report,
   `bun run validate`, sprint status `done` LAST.

## Goals and success metrics

- Stop ends only the active Codex turn: node stays `running`, projects
  `idle-after-interrupt`, exactly one `interrupted` tool row (`⚠`), no
  validation/re-ask, no node-failure event.
- Early Stop stays resumable: on a fresh thread, abort is held until
  `thread.started` yields a non-empty id; marker always carries that id; failure
  before any id remains a real failure.
- Send now uses the same thread: guidance receives the interrupted id +
  `forkSession: false`; Codex calls `resumeThread(id)`; every `startThread()`
  fallback door in strict mode fails visibly.
- Classification is evidence-based: measured operator-forwarded abort →
  `stream_aborted`; natural `turn.completed` racing Stop stays natural; node
  Cancel stays `Query aborted`; unknown/unmarked errors stay real failures and
  never cold-retry.
- Direct AI, AI loop, and loop-group body paths conform (namespaced handles),
  reusing Story 2.3 helpers without duplicating its full matrix.
- Both Legacy and Console idle states show the exact new disclosure; Stop
  absent, `Send now`/`WILL SEND` present, `⚠ interrupted` styling; one-line
  geometry holds at Legacy 460px, Console 520px reference panel, and 460×900
  responsive; focus/`aria-disabled`/live announcements/reduced-motion preserved.
- Operational gate: locked-SDK spike on native Linux + macOS + Windows reports
  no unhandled rejection/exception, hung iterator, lost thread context, or
  surviving captured descendant; focused tests + generated-doc checks +
  `bun run validate` + targeted Playwright all green before sprint `done`.

## Non-goals

- No new server routes or schemas, no steering-registry behavior change, no
  database/durable-queue changes, no new event kinds.
- No Codex app-server `turn/steer`, soft injection, SDK upgrades, or other
  providers' interrupt stories.
- No undo/rollback of filesystem writes, no Stop/Send-now rate limit, no
  detached-run steering, no idle expiry, no delivery confirmation.
- No change to best-effort resume for calls where `forkSession` is not
  explicitly `false`.
- Do NOT broaden the server's process-level rejection allowlist.
- Do NOT edit historical artifacts (`sources/spec-live-agent-steering/`, dated
  accessibility/rubric reports, `.working/` mockups).

## Technical context

Key files (from the plan):

- `packages/providers/src/codex/provider.ts` — signal ownership split, deferred
  abort, terminal normalization, retry suppression, strict resume.
- `packages/providers/src/codex/capabilities.ts` — `interrupt: false` →
  `'stream-abort'` (atomic with executor recognition).
- `packages/providers/src/types.ts` — export `STREAM_ABORT_TERMINAL_REASON =
  'stream_aborted'`; doc updates for `terminalReason`, `interruptSignal`,
  `forkSession: false`. No new request field.
- `packages/providers/src/codex/interrupt-resume-spike.ts` — new spike (US-001).
- `packages/providers/src/codex/provider.test.ts` — 12 focused test cases using
  existing `mockStartThread`/`mockResumeThread`/`mockRunStreamed` fixtures.
- `packages/workflows/src/dag-executor.ts` — add the shared constant to
  `INTERRUPT_TERMINAL_REASONS`; NO provider-name branch.
- `packages/workflows/src/dag-executor.test.ts` — Codex-shaped conformance
  (direct, classification boundary, AI loop, loop-group body; test provider must
  return `getType() === 'codex'` so the real registry exposes the handle —
  forcing `interruptible: true` manually proves nothing).
- `packages/web/src/lib/steering-dock.ts` — `STEERING_INTERRUPT_DISCLOSURE`
  constant (only this constant changes; no CSS/structure changes).
- `e2e/ui/agent-interrupt-redirect.spec.ts` — two-shell evidence spec.
- Canonical copy authorities: `_bmad-output/specs/spec-agent-node-room/SPEC.md`,
  `control-states.md`, `steering-test-plan.md`, `provider-steering-matrix.md`;
  `.../ux-Archon-agent-node-room-2026-09-09/{EXPERIENCE.md,DESIGN.md,
  mockups/key-steering-dock.html}`;
  `claude-design/design_handoff_node_room_transcript_steering/README.md` +
  3 `.dc.html` prototypes.
- Reports live under `plans/260920-0216-issue-184-interrupt-and-redirect-codex-agent/reports/`.

Design invariants:

- Per-attempt local state only: `knownThreadId` (seeded
  `thread.id ?? resumeSessionId`), `operatorInterruptRequested`,
  `operatorAbortForwarded`, existing fresh `attemptController`. No provider-global
  mutable state.
- Node Cancel wins when both fire; check it first at every catch/terminal
  boundary → `Query aborted`.
- After forwarding abort, keep consuming buffered events until the measured
  terminal so a buffered `item.completed` still yields its `tool_result`.
- Marker predicate requires ALL of: node Cancel not set,
  `operatorAbortForwarded` for this attempt, terminal matches the exact
  Phase-1-measured variant (enumerate OS variants if they differ; never a broad
  `killed`/`signal`/`SUBPROCESS_CRASH_PATTERNS` match).
- Normalized chunk is minimal: `{type:'result', sessionId: knownThreadId,
  terminalReason: STREAM_ABORT_TERMINAL_REASON}` — no invented usage,
  `stopReason`, or error subtype.
- `strictInPlaceResume = resumeSessionId !== undefined &&
  requestOptions?.forkSession === false`: sync `resumeThread` failure throws
  enriched (no `startThread`, no "Starting fresh conversation"); compat-client
  recreation must resume same id or fail; retryable crash fails instead of the
  attempt>0 `startThread` branch.
- Stop during retry backoff ends the delay immediately and throws the retained
  unmarked error — never returns the marker.
- Remove both signal listeners in `finally`; preserve the #1735 rule (never
  abort the attempt controller merely as cleanup).

## Story overview

| ID | Title | Phase | Depends on | Core deliverable |
| --- | --- | --- | --- | --- |
| US-001 | Codex SDK abort/resume spike + gate report | 1 | — | `interrupt-resume-spike.ts`, `spike:interrupt:codex` script, sanitized PASS/BLOCKED report on Linux+macOS+Windows |
| US-002 | Provider/executor slice + conformance | 2 | US-001 | marker export, provider signal/terminal/retry/strict-resume logic, executor recognition, `interrupt:'stream-abort'`, all focused tests green |
| US-003 | Truthful stop disclosure everywhere | 3 | US-002 | new disclosure literal across canonical UX authority, shared web constant, both shells' tests, updated+passing Playwright evidence |
| US-004 | Docs, acceptance record, sprint closeout | 3 | US-003 | steering test plan + provider matrix, regenerated capability matrix, `reports/acceptance.md`, `bun run validate`, sprint status `done` last |

## Working agreements for the implementing agent

- Follow existing test/mock conventions; keep current node-abort,
  fresh-signal-per-retry, usage, skill-catalog, and model-error tests green.
- KISS/YAGNI: no new request fields, no provider-name branches in the executor,
  no speculative matchers beyond what the spike measured.
- If Phase 1 is BLOCKED, US-002 does not start: leave capability `false`,
  commit the sanitized blocked report, stop.
- No reviewable green revision may advertise `'stream-abort'` without executor
  recognition, or vice versa.
- Commit hygiene: `main` is release, `develop` is working; a later PR uses
  `.github/pull_request_template.md` and `Closes #184`.
