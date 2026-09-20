---
title: 'Issue 186 interrupt and redirect a running Grok agent'
description: 'Evidence-gated implementation plan for Agent Node Room Story 2.6: interrupt one Grok Build turn, preserve its session, and continue redirected work without stopping the workflow node.'
status: blocked
priority: P1
effort: '1 evidence phase + 3 implementation phases'
issue: 'https://github.com/kevinle128/Archon/issues/186'
branch: archon/thread-34dc83fe
tags: [issue-186, agent-node-room, providers, grok, workflows, tdd, deep]
blockedBy: []
blocks: []
created: 2026-09-20
revised: 2026-09-20
---

# Issue 186: interrupt and redirect a running Grok agent

## Goal and user outcome

When an operator presses `Stop` while a Grok-backed direct AI node or AI loop is generating, Archon ends only the current Grok turn. The workflow node remains `running`, the existing steering handle enters `idle-after-interrupt`, and `Send now` starts the next Grok turn on the same persisted session. Previously queued guidance precedes the newly typed guidance in registry receipt order. A tool left open by the interrupted turn is recorded once as `interrupted`, so the existing transcript projection renders `⚠` rather than a failure.

This is the outcome in issue #186 and Story 2.6 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`. Story 2.3 already supplied the registry, fresh per-turn `interruptSignal`, route, queue, idle-await lifecycle, provider-neutral docks, and direct/AI-loop turn machinery. This story is therefore a Grok provider seam, one exact executor result discriminator, provider conformance coverage, capability publication, and Grok documentation. It is not a new steering system or UI redesign.

## Status and blockers

The plan is implementation-ready **after Phase 1 evidence passes**, but production work is currently blocked by two unproven external-runtime facts:

1. A production-observable point must exist after which terminating Grok preserves the assigned session **and the current turn's prompt**, while the complete Stop acknowledgement remains below the approved 1,000 ms ceiling. This must hold for new, resumed, and forked turns.
2. Native Linux and Windows must prove the same session and process-tree behavior as macOS. In particular, the real Windows `.cmd`/`cmd.exe` launch path must terminate the Grok tree without losing the resumable session.

PR #217 and its issue comment provide useful round-one evidence, not authority. They prove only that `grok 1.0.34 (3736acbc8658) [stable]` accepted caller-assigned session ids on native macOS, resumed after a mid-turn SIGTERM, exited quickly, and left a long-running tool child alive. They also prove that SIGTERM immediately after spawn happened before session materialization and could not resume. Phase 1 must repair and extend that diagnostic before any production capability changes.

## Authority and verified evidence

Use these sources in descending order:

1. Issue #186 and Story 2.6 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
2. `_bmad-output/specs/spec-agent-node-room/SPEC.md`, especially CAP-9 and CAP-10.
3. `_bmad-output/specs/spec-agent-node-room/engine-integration.md`, `steering-test-plan.md`, `provider-steering-matrix.md`, and `control-states.md`.
4. Final UX authority in `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/{DESIGN,EXPERIENCE}.md`; the older imported mockup is not authoritative where it says the node stops.
5. Current provider, executor, tests, registry, generated capability matrix, and assistant guide.

Repository and live inspection established:

- `GrokProvider` currently treats only `abortSignal` as process termination, emits `grok_incomplete_output` without an `end` event, and advertises `interrupt: false`.
- `GrokEventParser` learns the session id only from the `end` event and closes an unresolved tool as `unknown`.
- The executor already passes a fresh `interruptSignal` on each interrupt-capable provider pass, gives node Cancel precedence, skips validation/re-ask on an interrupt-marked result, fails if an interrupted turn has no resumable id, and handles direct AI nodes, AI loops, and namespaced loop-group body nodes.
- The executor's exact result predicate currently accepts Claude terminal reasons and the DeepSeek triple. Grok needs one additional exact normalized subtype; no provider-name branch or prose classifier is needed.
- The route and both docks are provider-neutral. Existing visual behavior is already `Stop` / brief `Stopping…` / `Send now`, with the node continuously `running`. The approved UX explicitly says the interrupt acknowledgement is sub-second. A 30-second “stop pending” interval would conflict with that authority.
- The installed and current stable CLI is `grok 1.0.34 (3736acbc8658) [stable]`. Its local `--help` and the official CLI reference confirm that `--session-id` names a new UUID and may name a fork only with `--resume --fork-session`; headless sessions are stored and resumed by id. One tested build is evidence of compatibility, not proof that 1.0.34 is the minimum compatible version.
- The round-one diagnostic commit is `2fb341bd`. It changes only the runner, its package script, and a sanitized report and can be cherry-picked independently of PR #217's superseded plan/PRD files.

External runtime references are the official [headless scripting guide](https://docs.x.ai/build/cli/headless-scripting), [CLI reference](https://docs.x.ai/build/cli/reference), and [Grok Build changelog](https://x.ai/build/changelog). Record the access date in live evidence because this surface is outside the repository and can change.

## Corrected technical decisions

### D1 — Evidence must prove the product contract, not a weaker fallback

The safe interrupt boundary `M` is the earliest production-observable event predicate after which all of the following are true:

- the intended target session id can be resumed;
- the interrupted turn's unique prompt marker is present after resume, not merely context from an older turn;
- an inherited marker is also retained on resumed and forked turns;
- from `interruptSignal.abort()` through provider settlement is less than 1,000 ms in every required evidence run; and
- terminating the process tree leaves no descendant behind.

`M` must cover every first-progress shape the CLI can emit for an interruptible turn. It may be one lifecycle event or a small explicit set of protocol event types, but it cannot depend on model prose, a particular tool, or an event that some turns never emit. Phase 1 must exercise text-only, reasoning-first, and tool-first turns and treat a terminal `end` that arrives first as natural completion. It must also measure a Stop requested **before** `M`: the provider may defer termination until `M`, but the entire request-to-settlement interval still has to fit below 1,000 ms.

Do not accept “same id but current prompt lost,” “works after first model text but takes longer than one second,” or a 30-second arm timeout. If no production-observable `M` meets the contract on a supported platform, Story 2.6 remains blocked and the next step is a separately reviewed transport/product change, not a degraded implementation.

### D2 — Preassign identity only on turns that need it

When `interruptSignal` is present:

- a new turn gets `--session-id <uuid>`;
- a fork gets `--resume <source> --fork-session --session-id <new-uuid>`; and
- a non-fork resume keeps `--resume <existing>` and does not invent a new id.

Calls without `interruptSignal` retain byte-for-byte argument behavior. Phase 1 must independently prove the fork combination and the post-interrupt target id before this ships. A reported `end.sessionId` that differs from the expected assigned/resumed id is a fail-closed protocol error, never a resumable interrupt.

### D3 — Normalize one exact Grok abort result

A successful operator interrupt yields:

```ts
{
  type: 'result',
  sessionId: string,
  stopReason: 'aborted',
  isError: true,
  errorSubtype: 'grok_aborted',
  resumed?: boolean,
}
```

Observed usage fields may accompany it only when Grok emitted authoritative terminal usage. Do not synthesize Claude's `terminalReason` vocabulary. The executor still requires the live operator-interrupt token; the same result without that token follows the ordinary provider-error path.

### D4 — Make Stop and Cancel cause-aware and tree-safe

The provider records an explicit first cause (`interrupt`, node `cancel`, natural completion, or fault), with node Cancel re-checked at final settlement so it dominates a race. Interrupt and Cancel share one tree-safe termination coordinator, but their established deadlines differ: any Stop-involved path must settle below 1,000 ms, while Cancel-only cleanup retains its existing 5,000 ms grace. Only a graceful interrupt after `M` can emit `grok_aborted`. Missing materialization, forced kill, session mismatch, protocol failure before Stop, and unsupported runtime behavior remain genuine failures.

For interrupt-capable turns on POSIX, the spawned Grok process owns a process group and tree signals target that group. The platform-specific termination primitive is encapsulated behind `GrokProcess`; the state machine does not reconstruct operating-system commands. Windows production behavior must be exactly what Phase 1 proves. No POSIX-only capability publication is possible because the registry capability is static and host-independent.

### D5 — Preserve authoritative tool and accounting semantics

On operator interrupt, an unresolved parser tool closes once with `toolOutcome: 'interrupted'` and `outputState: 'missing'` before the abort result. The executor removes it from its running-tool map when consuming that chunk, so the later result/status handling does not create a duplicate `tool_completed` event. Natural/fault/Cancel closure retains the current `unknown` default unless the provider reported a stronger status.

An interrupted turn with no `end` event has no fabricated token or USD accounting. If an `end` event with matching identity and usage wins the shutdown race, retain those authoritative fields while still classifying the operator-marked turn as interrupted.

### D6 — Capability publication is the final behavior change

Keep `GROK_CAPABILITIES.interrupt` false throughout the evidence, provider, and executor phases. Flip it to `'stream-abort'` only after all required host evidence and offline conformance tests pass. This keeps the new provider path dormant and makes rollback immediate.

Do not add an `archon doctor` minimum-version rejection from a single tested build. The round-one draft confused “tested version” with “minimum compatible version,” and doctor is advisory rather than a runtime enforcement boundary. Document the exact validated build and recommend the current stable CLI. If later evidence proves a real incompatible version range, design one shared, runtime-enforced version policy in a separate accepted scope.

## Scope and affected surfaces

| Area             | Files                                                                                                                                                                             | Change                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Evidence         | `packages/providers/src/grok/interrupt-resume-spike.ts`, `packages/providers/package.json`, `plans/reports/spike-260920-0243-grok-interrupt-resume.md`, a new round-two report    | Repair the diagnostic; prove session, latency, prompt retention, fork, process-tree, and host behavior.               |
| Provider         | `packages/providers/src/grok/provider.ts`, `event-parser.ts`, their tests, `usage-contract.test.ts`, `packages/providers/src/types.ts`                                            | Assigned identity, cause-aware bounded tree termination, exact abort result, tool/usage settlement, listener cleanup. |
| Engine           | `packages/workflows/src/dag-executor.ts`, `dag-executor.test.ts`                                                                                                                  | Add the exact Grok result subtype and direct/AI-loop conformance.                                                     |
| Publication/docs | `packages/providers/src/grok/capabilities.ts`, `packages/providers/src/registry.test.ts`, generated `provider-capabilities.md`, Grok section of `ai-assistants.md`, sprint status | Advertise only after proof; document behavior and close the story.                                                    |

Out of scope:

- no route, schema, generated API, database, registry state-machine, web component, CSS, or Playwright change;
- no Grok hook/interjection soft-inject, leader-socket integration, ACP transport migration, or concurrent prompt;
- no rollback of files or side effects already produced by Grok tools;
- no fabricated spend for interrupted turns;
- no new user configuration or YAML surface;
- no provider-specific executor branch and no natural-language error classification.

If implementation unexpectedly requires a UI change, stop and re-scope it against final `DESIGN.md`/`EXPERIENCE.md`, including generating, brief stopping, idle, resumed, interrupted-tool, Legacy 460 px, and Console 520 px acceptance evidence. Do not infer a visual change from this plan.

## Phases

| #   | Phase                                                                                    | Status                               | Exit condition                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | [Runtime evidence gate](./phase-01-unblock-evidence-gates-spike-round-2.md)              | Blocked on required hosts/credential | New, resumed, and forked turns meet session/prompt/latency requirements and process trees are reaped on macOS, native Linux, and native Windows. |
| 2   | [Grok provider stream-abort seam](./phase-02-grok-provider-stream-abort-seam.md)         | Pending Phase 1                      | Offline provider/parser matrix passes while capability remains false.                                                                            |
| 3   | [Executor conformance: direct and AI loop](./phase-03-engine-conformance-direct-loop.md) | Pending Phase 2                      | Exact Grok result passes direct and AI-loop contracts; generic loop-group regression stays green.                                                |
| 4   | [Capability, docs, and closeout](./phase-04-capability-docs-closeout.md)                 | Pending Phases 1–3                   | Capability flips last, generated docs and guide agree, full validation passes, sprint row changes last.                                          |

## Acceptance criteria

- [ ] On macOS, native Linux, and native Windows, a Stop on new, resumed, and forked Grok turns settles in under 1,000 ms, leaves no Grok/tool descendant, and produces a resumable target session containing both inherited context and the interrupted turn's unique prompt marker.
- [ ] A successful Stop emits the exact Grok abort result with a concrete session id. It never emits that marker after forced kill, missing materialization, identity mismatch, or a prior fault.
- [ ] Node Cancel retains its existing `Query aborted` behavior and wins Stop races; natural completion that wins the race remains natural.
- [ ] Direct AI and AI-loop executor paths write one `interrupted` status, skip partial-output validation/re-ask, enter `idle-after-interrupt`, emit no `node_failed`, and resume the interrupted session on `Send now`.
- [ ] Queued guidance followed by the new message reaches the next turn in receipt order with `forkSession: false`.
- [ ] Each in-flight tool is recorded exactly once as `interrupted`; completed tools retain their reported outcome; interrupted turns never fabricate usage or cost.
- [ ] Calls without `interruptSignal` keep their existing argv and result behavior. Listener/timer/process cleanup is complete on natural, failed, interrupted, cancelled, and early-consumer-return paths.
- [ ] Grok advertises `interrupt: 'stream-abort'` only after all evidence and conformance gates pass; the matrix and guide describe the same tested platforms/build and written-work semantics.
- [ ] Focused suites, package suites, docs build, type-check, generated-doc check, and `bun run validate` pass. Sprint status moves from `backlog` to `done` only after the acceptance report maps every criterion to evidence.

## Compatibility, security, performance, and operations

- The request signal and result subtype are additive internal contracts. There is no data migration, YAML change, or API change.
- Assigned UUIDs are generated only for interrupt-capable new/forked turns. Logs and reports may include opaque session ids and timings, but never credentials, prompt/model text, home paths, or session contents.
- Live diagnostics use disposable repositories and fixed benign prompts on trusted hosts. Do not add a repository-secret-backed workflow that can run arbitrary branch code with `XAI_API_KEY`; native Windows/Linux evidence is operator-run from a reviewed commit.
- Group/tree termination targets only the child tree Archon just spawned. Phase 1 verifies exact descendant PIDs and cleanup; the implementation must not use broad process-name matching.
- Stop adds no polling, daemon, persistent timer, or per-turn version subprocess. The only wait is bounded by the sub-second interaction contract; timeout and forced termination fail honestly.
- Rollback order: set Grok interrupt back to `false`, regenerate the matrix, revert the Grok predicate/docs, then revert the dormant provider seam if needed. Because process-group ownership is enabled only when an `interruptSignal` is supplied, the capability rollback restores the pre-feature spawn path.

## Validation log

Phase 1 must fill this table before Phase 2 begins. Blank or failed entries are blockers, not optional decisions.

| Evidence             | Required result                                                                       | Recorded result                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grok build           | Exact binary/version/hash; current stable checked                                     | `grok 1.0.34 (3736acbc8658) [stable]` on native macOS arm64 / Bun 1.3.14 (report `plans/reports/spike-260920-0702-grok-interrupt-resume-round-2.md`). Validated build only — not a minimum floor.                  |
| Safe boundary `M`    | Production-observable; current prompt and inherited context survive                   | **PASS on macOS text/reasoning/tool shapes:** `first-stdout-event` (owned-tree). Marker retention true; request→settlement ~300 ms.                                                                                |
| Stop acknowledgement | `< 1,000 ms` in every cold/warm sample on each host                                   | **PASS on macOS LAT:** new n=10 min/med/max 293/311/318; resumed 268/277/289; forked 298/307/325 — all under 1000 ms, 0 failures. Linux/Windows: **BLOCKED** (hosts unavailable).                                  |
| Fresh turn           | Assigned id resumes with current marker                                               | **PASS (macOS B0/B2):** B0 natural + B2 interrupt at M retain current marker.                                                                                                                                      |
| Resumed turn         | Same id resumes with old + current markers; immediate-stop policy decided by evidence | **PASS (macOS B3):** inherited+current markers; policy = wait for M (request early, signal at M).                                                                                                                  |
| Forked turn          | Assigned fork id resumes with source + fork markers; source remains unchanged         | **PASS (macOS B4):** fork retains source+fork markers; sourceWithoutFork true.                                                                                                                                     |
| POSIX process tree   | Exact child gone after graceful Stop/Cancel                                           | **BLOCKED:** B7/B9 mid-tool owned-tree still leave exact tool-child fingerprint alive after parent exit (settlement also >1s because M deferred to pid-file). Non-tool Stop at `first-stdout-event` reaps cleanly. |
| Windows launch/tree  | Real `.cmd`/`cmd.exe` path; same-session resume and exact descendants gone            | **BLOCKED** — no native Windows host in this environment (`W1` pending operator evidence).                                                                                                                         |
| Supported hosts      | Native macOS, Linux, Windows all pass                                                 | **BLOCKED** — macOS incomplete (B7/B9); native Linux unavailable; native Windows unavailable. Containers/WSL not substituted.                                                                                      |
| Grace interval       | Measured graceful shutdown bound with margin below 1,000 ms total                     | Interrupt path uses 800 ms SIGTERM→SIGKILL ceiling; non-tool Stop at M settles ~300 ms without SIGKILL. Cancel grace remains 5000 ms. Mid-tool pid-file path cannot meet 1000 ms request→settlement on this host.  |

## Remaining questions

There are no open product choices inside the current Story 2.6 contract. The remaining unknowns are execution evidence. A failed host/session/latency gate blocks capability publication; changing the cross-platform or sub-second promise requires an explicit update to the owning spec and UX authority before this plan can be revised.

<!-- slug: issue-186-grok-interrupt-redirect -->
