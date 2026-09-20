---
title: 'Issue 185 interrupt and redirect a running OMP agent'
description: 'Implementation-ready plan for Agent Node Room Story 2.5: interrupt one OMP turn safely, preserve its session, wait for Send now, and continue on that same session.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/185'
branch: archon/thread-9aa07a8e
tags: [issue-185, agent-node-room, providers, workflows, omp, tdd]
blockedBy:
  - 'Platform-wide OMP graceful-interrupt evidence or owner-approved platform-specific capability scope'
blocks: []
created: 2026-09-20
---

# Issue 185: interrupt and redirect a running OMP agent

## Goal and user outcome

While an OMP-backed workflow node is generating, an operator can press `Stop`, end only the current provider turn, and reach `idle-after-interrupt` without cancelling or failing the node. `Send now` then drains the queued guidance in receipt order as the next turn on the same OMP session. Work and file changes already completed are not rolled back.

Story 2.3 / PR #214 already owns the in-process registry, route authorization, queue ordering, executor idle-await, server projection, and both composer docks. Issue #185 is the provider conformance slice: it must prove that the installed OMP CLI can be interrupted gracefully and resumed, normalize that end into the existing executor contract, and expose the already-shipped UI states by flipping OMP's capability.

## Verified authority and repository evidence

The implementation must satisfy, in order:

1. Issue #185 and Story 2.5 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
2. The ratified root companions in `_bmad-output/specs/spec-agent-node-room/`, especially `SPEC.md`, `engine-integration.md`, `provider-steering-matrix.md`, `steering-test-plan.md`, and `control-states.md`. The copies below `sources/` are historical inputs, not update targets.
3. Current provider/executor contracts and their tests.
4. For presentation only, `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/{DESIGN,EXPERIENCE}.md`; the imported HTML is an older prototype and yields to the ratified Markdown plus shipped tests.

Evidence inspected during this review:

- `packages/providers/src/community/omp/{provider,event-parser,capabilities}.ts` and their tests: OMP is a one-shot `--mode json` child; Cancel already uses SIGTERM then a five-second SIGKILL fallback; the parser retains the session header and buffers text deltas; normal results reject incomplete assistant/tool lifecycles.
- `packages/providers/src/types.ts`: `interruptSignal`, `terminalReason`, and `'stream-abort'` documentation is stale; the public `resumed` field promises an observable resume outcome.
- `packages/workflows/src/dag-executor.ts` and the #183 test matrix: direct and AI-loop paths both require the operator flag plus a deterministic terminal marker, already retain the prior session id on resumed passes, settle open tools, and enter the common idle-await path. They do not branch on `'native'` versus `'stream-abort'`.
- `packages/server/src/routes/api.ts`, `packages/web/src/lib/steering-dock.ts`, web component tests, and `e2e/ui/agent-interrupt-redirect.spec.ts`: routes and docks are provider-neutral. Existing E2E coverage exercises Legacy and Console, focus/ARIA behavior, and the 460px reference width.
- `scripts/generate-capability-matrix.ts` and the generated provider matrix: the generator already renders `**stream-abort**`.
- Installed `/Users/agent/.bun/bin/omp` reports 18.1.21. The existing scout report describes 18.1.16 source only, so it is supporting evidence, not a runtime guarantee.
- `packages/providers/src/community/omp/binary-resolver.ts` supports macOS, Linux, and Windows, while the current capability is one provider-wide constant. This review found no repository or live evidence proving that OMP receives a graceful, resumable SIGTERM on every supported platform.
- Issue #183 is closed and its dependency is merged. Story 2.5 remains `backlog` in sprint status.

Audit limitation: a focused provider test command could not establish a green baseline in this worktree because workspace dependencies do not currently resolve `@archon/paths`. Implementation starts by restoring the repository's normal dependency state and running the focused baseline; this review did not install dependencies or treat the failed invocation as product evidence.

### Release blocker — platform-wide capability evidence

`OMP_CAPABILITIES.interrupt` is currently platform-independent, so a successful macOS spike alone would expose Stop on Linux and Windows too. Before the capability flip, run the same versioned gate on every platform on which this release will advertise OMP interrupt. The current resolver makes that macOS, Linux, and Windows unless product scope is changed.

If any platform cannot deliver a graceful session-persisting interrupt, stop for an owner decision between: (a) deferring issue #185 until OMP provides a usable mechanism there, or (b) explicitly accepting a platform-specific capability contract and expanding the provider/registry/matrix/docs scope so unsupported platforms remain queue-only. Do not silently ship a static `'stream-abort'` value after testing only macOS, and do not treat forceful Windows termination as SIGTERM success.

## Scope

In scope:

- characterize the exact installed OMP binary with assistant-text and active-tool interrupts before advertising support;
- make `OMP_CAPABILITIES.interrupt` equal `'stream-abort'` only after that gate passes;
- add first-cause-aware turn termination, early-interrupt session-header deferral, buffered-text draining, truthful resume reporting, graceful-interrupt result construction, and listener/timer cleanup;
- fail the node rather than claim a safe idle session if runtime termination escalates to SIGKILL, and block the capability flip if the spike finds a surviving child tool;
- add `stream_aborted` to the executor's deterministic marker set and prove direct plus AI-loop conformance;
- synchronize the two canonical engine/testing companions whose current OMP-throws wording is superseded by the normalized result, while retaining a thrown-`Query aborted` regression fixture;
- regenerate the capability matrix, update OMP user documentation, record sanitized spike evidence under `plans/reports/`, and close sprint status only after all gates pass.

Out of scope:

- OMP RPC/ACP mode and soft inject (`steer`, `set_steering_mode`, `abort_and_prompt`);
- new routes, authorization rules, persisted steering state, database changes, or UI components;
- Codex, Grok, and DeepSeek provider implementations;
- changing the shared 30-minute idle-await behavior, delivery confirmation, or `NEVER SENT` reconciliation;
- generic process-tree infrastructure unless the mandatory OMP spike proves the current CLI leaves a descendant alive. In that event this plan is blocked before the capability flip and must be revised with a platform-safe, owned-process design; orphaning is not an acceptable follow-up.

## Technical decisions

### D1 — Gate the capability on observed graceful behavior

Run a disposable, sanitized real-binary spike for an assistant-text turn and an active-tool turn on every platform where the capability will be enabled. A passing binary must emit its session header before work events, exit through that platform's demonstrably graceful mechanism without the fallback firing, complete provider classification in under one second, resume the exact session id with context intact, and leave no owned descendant alive. Authentication unavailable, a failed same-id resume, forceful termination, a survivor, or an over-one-second provider acknowledgement blocks implementation. Evidence is version- and platform-specific and records `omp --version` plus OS/architecture.

SIGKILL is a safety fallback, not a successful interrupt mechanism. If it fires, emit an unmarked terminal error such as `omp_interrupt_force_killed`; the existing executor error path fails the node. Do not enter idle on a session whose persistence or child termination was not proved.

### D2 — Track termination ownership, not merely an aborted signal

The current transport, parser, Cancel, cleanup, and new Stop paths can all call termination. Record the first termination cause (`interrupt`, `interrupt-unresumable`, `cancel`, `transport`, `protocol`, or `cleanup`) and whether escalation fired. Cancel still dominates classification whenever the node-level `abortSignal` is aborted. An interrupt result is allowed only when operator interrupt owns termination, graceful SIGTERM reaped the child, and the parser had not already observed a natural `agent_end`.

Consequences:

- an interrupt-caused stdout close/truncation cannot masquerade as a transport/protocol failure;
- a real transport/protocol failure that happened first cannot be hidden by a later Stop;
- a Stop racing an already-natural end stays natural and does not enter idle;
- cleanup termination never becomes an operator interrupt.

### D3 — Preserve the session even for an immediate Stop, with a bounded wait

The session id exists only in OMP's swallowed `session` event. A fresh-turn Stop that kills before that event would make same-session redirect impossible. Do not add a pre-aborted `interruptSignal` no-spawn guard. Instead, remember a pending operator interrupt and, if no session header has been observed, defer its SIGTERM for at most 500 ms. Trigger termination as soon as the parser consumes the header and before yielding later work.

If turn activity arrives before the required header, the 500 ms deadline expires, or OMP exits/fails first, terminate/reap as needed and return an unmarked `omp_interrupt_session_unavailable` error. Never invent an id or enter idle. This bounded fail-safe prevents a pre-header Stop from waiting indefinitely on a changed or unhealthy CLI.

The real-binary gate must show that this bounded deferral still meets the sub-second UX contract. The node-level Cancel signal retains its existing immediate pre-spawn and in-flight behavior.

### D4 — Normalize a graceful interrupt without inventing completed output

After operator-owned graceful reap:

1. drain buffered assistant text exactly once;
2. preserve only observed session and accounting fields (`tokens`, `cost`, `numTurns`, `usageBreakdown`, `resolvedModel`) plus truthful `resumed` and `terminalReason: 'stream_aborted'`;
3. omit `structuredOutput`, `stopReason`, and all error fields because the partial turn is neither schema-valid output nor a natural/provider-error completion;
4. run existing hidden-session usage enrichment fail-soft, then return without a trailing throw.

The parser enters an interrupting mode only after interrupt ownership is won. A late errored `tool_execution_end` for a tool that was active at that moment becomes `toolOutcome: 'interrupted'` with no failure warning; a genuinely successful late end remains `success`; a still-open tool is settled `interrupted` by the executor on the terminal marker. This prevents the transcript from showing a Stop-caused tool failure while preserving completed work.

For the interrupted result only, omit `resumed` when no prior session was requested; report true for ordinary `--resume` only when the observed id equals the requested id; report true for `--fork` when OMP observed a session header; otherwise report false. Keep the existing non-interrupted success/error semantics unchanged—normal resume/fork behavior is outside this story.

### D5 — Keep executor and UI changes minimal

Export a shared `STREAM_ABORTED_TERMINAL_REASON` from the provider contract and add it to the executor marker set. No other production executor, server, or UI branch is needed. Direct and AI-loop tests are required because those paths implement classification independently; a new loop-group fixture is redundant because loop-group prompt bodies delegate to the already-tested direct path and #183 already pins namespacing.

The existing provider-neutral UI must remain unchanged at both its normal desktop layout and 460px reference width: generating shows `Stop` + `Queue`; interrupting shows focusable `Stopping…` with `aria-disabled`; idle removes Stop, shows `Send now`, the disclosure, and an `⚠ interrupted` tool row; the redirected turn returns to `Stop` + `Queue`; neither shell overflows or loses focus. The existing Legacy/Console E2E and its tracked evidence are the regression authority. No rerun is required when the implementation stays outside server/UI files; the spec writes into #183's tracked evidence directory.

### D6 — Update the canonical contract to match the implementation

`engine-integration.md` and `steering-test-plan.md` currently say OMP interrupt throws `Query aborted`. A throw cannot carry a first-turn session id, so the provider must normalize its own operator interrupt to a marked result. Update those root companions to say this while retaining executor case 3 and a fixture for an abort-like throw when a prior session id is available. Do not edit the historical `sources/` copies or weaken the Story 2.5 conditional Given/Then.

## Phases

| #   | Phase                                                                                                           | Depends on |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | [OMP graceful stream-abort seam and real-binary gate](./phase-01-omp-stream-abort-seam-and-real-binary-gate.md) | —          |
| 2   | [Executor conformance and `stream_aborted`](./phase-02-executor-conformance-and-stream-aborted-marker.md)       | 1          |
| 3   | [Contract/docs synchronization and closeout](./phase-03-docs-matrix-and-closeout.md)                            | 1–2        |

## Measurable acceptance criteria

- [ ] Version/platform-keyed sanitized spike evidence covers every platform where OMP advertises interrupt; both assistant/tool cases see a session header first, return in under one second through a proven graceful mechanism, resume the exact id with context, and leave no owned descendant. No case relies on forceful termination.
- [ ] `OMP_CAPABILITIES.interrupt === 'stream-abort'`; the registry still identifies Claude alone as `'native'` and OMP alone as `'stream-abort'`.
- [ ] Immediate and mid-turn Stop preserve partial assistant text, observed/fail-soft-enriched usage, and the real session id; exactly one last result carries `stream_aborted` and no completion/error fields. Missing/late/out-of-order headers fail within the bounded pre-header path and never idle.
- [ ] Cancel dominates a co-fire; first-cause transport/protocol failures and force-kill escalation remain failures; a natural-end race remains natural; all listeners, timers, and children are cleaned up.
- [ ] Active tools settle once with `interrupted` only when the interrupt owns the end; successful late completion stays successful and real tool failure before the interrupt stays failed.
- [ ] Interrupted ordinary-resume equality/mismatch and fork/header presence report `resumed` conservatively; existing non-interrupted resume/fork behavior remains unchanged.
- [ ] Direct and AI-loop OMP fixtures idle without `node_failed`, keep the node `running`, write one interrupted status, resume the same id, and drain guidance in written order. Both paths fail explicitly if a first-turn marked result lacks a session id.
- [ ] An unflagged marker remains a natural end; an abort-like throw with the operator flag and an already-known session id still idles; a throw without a session id fails explicitly.
- [ ] Canonical companions, provider type docs, OMP user docs, and generated matrix agree with the implemented shape. Historical source copies are untouched.
- [ ] No server/UI production file changes; the existing tracked Legacy/Console evidence remains the applicable proof for desktop and 460px states. If that scope changes, the targeted E2E becomes mandatory.
- [ ] Focused provider/workflow tests, type checks, matrix check, and `bun run validate` pass before sprint status becomes `done`.

## Compatibility, operations, security, and rollback

- No schema, API, persisted-state kind, or UI contract changes. Existing interrupted status rows remain the audit trail. Direct chat does not pass `interruptSignal` and is unaffected.
- Steering retains #183's ratified any-authenticated-user actor grant, including identity-less runs, and OMP retains its documented host-user permissions. This plan does not silently narrow or broaden either contract.
- Spike prompts, model content, credentials, paths outside a disposable temp repository, and session ids must not enter the report. Record booleans, event names, timings, exit classes, and a hashed/redacted session correlation only.
- The spike tracks every PID it starts, reaps it in `finally`, and checks only those owned processes/unique markers. Never use broad `pkill` patterns.
- Rollback flips OMP interrupt back to `false` and removes the provider listener/marker support, returning OMP to queue-only. Already-written transcript rows are harmless. A run already idle in a lost process remains subject to #183's existing manual cancel/abandon behavior; no timer guesses its lifecycle across process boundaries.
- Runtime cost is one abort listener and a few state fields per active OMP turn. Hidden-usage enrichment already occurs after normal turns and remains fail-soft; no new polling, database traffic, or unbounded buffering is introduced.
- OMP is an externally installed, unpinned CLI. The report and public docs identify each tested version/platform pair; protocol drift fails closed through the session/first-cause checks. A version or platform change requires re-running the spike before claiming conformance, not a guessed semantic-version range.

## Validation and closeout order

1. Restore workspace dependencies and establish the focused pre-change baseline.
2. Complete Phase 1 tests and the mandatory real-binary gate; stop if it blocks.
3. Complete executor fixtures and contract/document changes.
4. Run focused tests/type checks and regenerate/check the capability matrix. Run the targeted Legacy/Console E2E only if implementation unexpectedly touches shared server/UI behavior.
5. Run a preliminary `bun run validate` from the repository root; never run root `bun test`.
6. Change Story 2.5 sprint status to `done`, then run final `bun run validate` so the status edit is included. If it fails, restore `backlog` until fixed.
7. If a PR is requested, target `develop`, use `.github/pull_request_template.md`, cite the spike report and focused tests, and include `Closes #185`.
