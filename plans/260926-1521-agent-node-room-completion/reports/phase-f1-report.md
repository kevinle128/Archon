# Phase F1 report — provider steering completion (Claude, Grok, OMP)

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a16941e916649a010`
Branch: `worktree-agent-a16941e916649a010` (from `develop-2`, merged twice more
during the phase to pick up Phase D and F2's concurrent work)

Scope: Stories 8.3 (Claude), 8.5 (Grok), 8.7 (OMP), and this agent's share of
8.8 — capability flags that record only proven behavior. Every claim below
was tested against the real binary/SDK the operator is logged into on this
machine; no capability was flipped on inference or documentation alone.

## Commits

1. `acbdecab` feat(providers): complete Claude Stop conformance, disprove soft injection and delivery ack
2. `92c3adde` feat(providers): wire verified Claude delivery acknowledgement (CAP-13)
3. `9a13e893` feat(providers): re-confirm OMP Stop is blocked, disprove RPC steer as soft injection
4. `102ad7ea` feat(providers): re-confirm Grok Stop is blocked, narrow the interject question

Nothing pushed.

## Shared engine plumbing (added once, consumed by Claude; ready for OMP/Grok when their gates open)

Phase B built the durable claim for soft injection but never wired anything
into the live provider turn — `api.ts`'s `queued_message_id` branch claimed
the durable entry and returned `sent` without ever touching the provider.
This phase adds the missing live-delivery channel:

- **`packages/providers/src/types.ts`** — `SoftInjectionRequest` /
  `SoftInjectionChannel` on `AgentRequestOptions.softInjection`, symmetric
  with `interruptSignal`/`AbortSignal`: the executor owns the writable
  controller, the provider adapter gets only the read-only `ready()` view.
  Also `operatorMessageId?: string` for delivery-ack correlation (CAP-13),
  and a new `MessageChunk` variant `operator_delivery_ack`.
- **`packages/workflows/src/steering-registry.ts`** — `SoftInjectionController`
  / `createSoftInjectionController()`, and `NodeSteeringHandle.softInject()`
  (mirrors `interrupt()`'s truthful-projection-without-throwing shape:
  `delivered` / `not_ready` / `no_active_turn`).
- **`packages/workflows/src/dag-executor.ts`** — a fresh controller is built
  at both `beginTurn()` sites (direct node and loop body) and passed through
  `sendQuery` options; `operatorMessageId` is set only when a guidance pass
  delivers exactly one durable message (a combined multi-message prompt has
  no single id to honestly attribute a provider echo to, so it is omitted
  and that entry simply stays at `sent`); a new `operator_delivery_ack` chunk
  branch (both stream loops) calls the new store method below.
- **`packages/workflows/src/store.ts` / `packages/core/src/db/workflow-steering.ts`**
  — `markSteeringMessageDelivered` (engine-facing, `sent` -> `delivered` CAS
  by id) and `revertSteeringSoftInjectionClaim` (server-layer-only: reverts a
  soft-injection claim back to `queued` when the live turn does not accept
  it, keeping the "every rejected request leaves the queue unchanged"
  contract from `steering-api-contract.md`).
- **`packages/server/src/routes/api.ts`** send route — after the durable
  claim, calls `handle.softInject(...)`; on anything but `delivered`, reverts
  the claim and returns 409 `soft_injection_unavailable` instead of a false
  `sent`.

Unit tests added for every piece above: `steering-registry.test.ts` (7 new
`softInject` cases, including a fresh-turn-never-receives-a-stale-channel
regression), `workflow-steering.test.ts` (4 new store cases against a real
SQLite adapter), `dag-executor.test.ts` (4 new cases: the delivery-ack chunk
routing including a mismatched-id no-op, and single-vs-combined guidance
message affecting whether `operatorMessageId` is set), `api.workflow-runs.test.ts`
(3 new route-level cases against a real `OpenAPIHono` app: accept, decline
with revert, and no-handler-registered with revert).

## Claude (Story 8.3)

| Capability           | Before     | After                   | Evidence                                                           |
| -------------------- | ---------- | ----------------------- | ------------------------------------------------------------------ |
| Stop                 | `'native'` | unchanged               | Already proven (`Query.interrupt()`), not re-litigated this phase. |
| Session continuation | proven     | unchanged               | Same session reused; not re-litigated.                             |
| Soft injection       | `false`    | **`false` (disproven)** | `spike:softinject:claude`                                          |
| Delivery ack         | `false`    | **`true` (verified)**   | `spike:softinject:claude`                                          |

### Soft injection — disproven

`Query.streamInput()` can push a second `SDKUserMessage` onto an already-open
streaming-input query, and the model DOES incorporate it — but the result
comes back as a genuinely NEW queued turn, not an injection into the turn
already streaming. Measured twice with different injection points:

- Mid-token-stream on a single completion (no tools): the pushed message
  produced a second `result` message (`resultCountAfterInjection: 2`) even
  with `maxTurns: 1` set — `streamInput()` bypasses `maxTurns`. Confirmed
  `genuinelyMidGeneration: true` (tokens were still streaming at push time),
  so this was not a timing artifact.
- At a between-tool-calls boundary (two sequential Bash calls): same
  result — two `result` events, the second one produced by the injected
  content as its own new turn.

A reviewer raised `SDKUserMessage.priority: 'next'` (present but undocumented
in this SDK version's `sdk.d.ts`) as a candidate fix, hypothesizing it
attaches at the next tool-call boundary inside the running turn rather than
queuing a new one. Retested with `priority: 'next'` explicitly set on the
injected message: `resultCountAfterInjection` stayed `2`. Disproven. The
Anthropic API has no primitive to alter an in-flight completion; `streamInput()`
is — as its own doc comment says — for multi-turn conversations on a warm
process, which is a real win for CAP-10 (already available via the existing
session-resume path) but not CAP-12.

### Delivery acknowledgement — verified, and wired to production

`claude --help` documents `--replay-user-messages`: "Re-emit user messages
from stdin back on stdout for acknowledgment (only works with
`--input-format=stream-json` and `--output-format=stream-json`)" — exactly
the transport Archon's interruptible turns already use. Passed via
`Options.extraArgs` (not present in `sdk.d.ts` as a typed option, but the SDK
exposes `extraArgs?: Record<string, string | null>` for pass-through CLI
flags). Verified: the CLI re-emits the pushed message on stdout as
`{type: 'user', isReplay: true, uuid: <the caller-stamped id>}`.
`injectedUuidEchoed: true`, `echoedViaReplayMessage: true`.

Wired into production:

- `dag-executor.ts` sets `AgentRequestOptions.operatorMessageId` only when a
  guidance pass delivers exactly one durable steering message.
- `claude/provider.ts` stamps that id as the streamed `SDKUserMessage.uuid`
  and adds `extraArgs: { 'replay-user-messages': null }`, gated on the
  existing `interruptSignal` streaming-input path the feature requires.
  `streamClaudeMessages` detects the `isReplay: true` echo and yields
  `operator_delivery_ack`, which `dag-executor.ts` routes to
  `markSteeringMessageDelivered`.
- `capabilities.ts`: `deliveryAck: true`.

A second reviewer hypothesis — that `SDKUserMessageReplay`'s `isReplay: true`
shape (already present in `sdk.d.ts` without this flag) might itself be a
generic ack mechanism, separate from `--replay-user-messages` — was subsumed
by the direct test: the flag is what makes the echo happen at all; without
it, no `type: 'user'` message with the injected uuid ever appeared in any of
the three earlier runs.

**Checked but not pursued:** whether a newer SDK version (0.3.283 is current
on npm; 0.3.209 is installed) changes anything. Fetched its `sdk.d.ts` via
`npm pack` (no install) and diffed the relevant types: `still_queued`/
`SDKUserMessageReplay`/`isReplay` are unchanged in substance (the newer
version adds an `interrupt_cancel_queued_v1` capability for atomically
cancelling queued async messages alongside an interrupt — unrelated to
soft injection). No upgrade needed for this story's findings.

**Not done:** soft injection is not wired into `claude/provider.ts` — a seam
behind a disproven capability is dead code, and Phase D was concurrently
editing that file for thinking/advisor extraction. The shared engine plumbing
above is real, tested, provider-neutral infrastructure with a live caller
today (Claude's delivery ack) and no changes needed to adopt it for OMP or
Grok if either capability is later proven.

## OMP (Story 8.7)

| Capability                   | Before   | After                                             | Evidence                     |
| ---------------------------- | -------- | ------------------------------------------------- | ---------------------------- |
| Stop                         | `false`  | unchanged (`false`)                               | `spike:interrupt:omp` re-run |
| Session continuation on Stop | unproven | unchanged                                         | same                         |
| Soft injection               | `false`  | unchanged (`false`, disproven on a new mechanism) | `spike:rpc:omp`              |
| Delivery ack                 | `false`  | unchanged                                         | no verified transport        |

### Stop — re-confirmed blocked on the shipped transport

`OmpProvider`'s production interrupt seam (SIGTERM on `interruptSignal`,
already fake-tested extensively) exists but the capability was never flipped
pending real-binary proof. Re-ran `spike:interrupt:omp` on the currently
installed `omp/18.1.21` (same version as the prior spike): both the
assistant-text and active-tool conformance cases failed resume this run —
the active-tool case had passed in the prior spike, so the failure is not
even consistent across runs on the identical version. `interrupt` stays
`false`.

### Investigated: does `--mode rpc` fix the resumability problem?

The matrix's OMP row describes "RPC-mode turn interruption" — a genuinely
different mechanism from the shipped SIGTERM path: in RPC mode the process is
never killed at all (Stop is the in-band `{type:"abort"}` command), so
"resume" means sending another prompt to the SAME warm process rather than
respawning and hoping OMP persisted enough to disk. Wrote a new spike
(`rpc-mode-spike.ts`) to test this directly against the real binary,
independent of the shipped provider code:

- **Same-process redirect after abort — proved.** Planted a random token in
  turn 1's prompt, sent `{type:"abort"}` mid-stream, then sent a NEW prompt
  (no `--resume` flag, no respawn) asking the model to repeat the token. The
  redirect turn's final `agent_end.messages` contained the token —
  `redirectProvedContext: true`, on the same pid. This is the mechanism the
  matrix describes and it genuinely sidesteps the disk-resumability failure.
- **But the abort's own acknowledgement was not reliable.** Across repeated
  runs, the `{type:"abort"}` command's own JSON-RPC response did not
  consistently echo back matching its request id (`abort.ackSeen: false` in
  the final recorded run). Without a reliable ack, Stop cannot be classified
  with confidence.
- **Porting is a migration, not a story leg.** `--mode rpc` requires moving
  the prompt from argv to a stdin frame, unwrapping the RPC envelope in
  `OmpEventParser` (`ready`/`response`/`available_commands_update` alongside
  the `AgentSessionEvent` stream it already parses), replacing SIGTERM with
  `{type:"abort"}`, and re-validating the 53&nbsp;KB `session-usage.ts`
  tracker and ~20 existing interrupt unit tests against the new transport.
  Scoped as a dedicated follow-up story, not attempted here.

`interrupt` stays `false`.

### Soft injection — disproven on the RPC transport too

Tested RPC `steer` directly against the real binary with
`set_interrupt_mode: 'immediate'` set (the doc's own "checks steering between
tool calls" mode) and a two-Bash-call task. Sent `steer` in the gap between
tool call 1's result and tool call 2's dispatch, instructing the model to
skip the second call entirely.

- `steer.ackSeen: true`, `steer.toolOutcomeDisrupted: false` (the in-flight
  first tool's own outcome was not disturbed — good).
- `steer.secondToolCallStillRan: true` — the model ran the SECOND Bash call
  anyway. The steer content was not consulted before dispatching it.
- `steer.agentEndCountAfterSteer: 1` and `steer.sawTurnStartAfterSteer: true`
  — the steered content landed as an internal `turn_start`/`turn_end` cycle
  appended AFTER the original plan finished, inside the same `agent_end` —
  `followUp` semantics (CAP-8 Queue, just delivered faster on a warm
  process), not CAP-12 mid-turn injection.

`softInjection` stays `false` — disproven directly, and independently gated
behind `interrupt !== false` regardless.

## Grok (Story 8.5)

| Capability           | Before   | After                | Evidence                                                |
| -------------------- | -------- | -------------------- | ------------------------------------------------------- |
| Stop                 | `false`  | unchanged            | `spike:interrupt:grok` (`GROK_SPIKE_ONLY=B7,B9`) re-run |
| Session continuation | unproven | unchanged            | same                                                    |
| Soft injection       | `false`  | unchanged            | gated behind `interrupt`                                |
| Delivery ack         | `false`  | unchanged (narrowed) | new `acp-handshake-spike.ts`                            |

### Stop — re-confirmed blocked, same failure mode on a newer binary

The shipped adapter uses `--single` (one-shot argv prompt, no stdin, no
interrupt wiring at all — `grep interruptSignal grok/provider.ts` returns
nothing). Re-ran the prior round-2 conformance gate's two blocking scenarios
(`GROK_SPIKE_ONLY=B7,B9`) on `grok 1.0.41` — up from `1.0.30`/`1.0.34` when
originally tested. `descendantsAliveAfterExit: true` for both the owned-tree
mid-tool Stop and the node-Cancel tree-termination gate — the identical
process-tree reaping failure, unchanged across two binary versions six
months apart. `interrupt` stays `false`.

### Delivery ack — narrowed the open question, did not resolve it

A prior scout left one question explicitly open: is Grok's ACP extension
method `x.ai/interject` (the exact literal recovered from the binary)
reachable from an arbitrary ACP client, or gated to grok's own pager UI? Ran
a real handshake (`initialize` -> `session/new` -> `session/prompt`) against
`grok 1.0.41` and attempted `x.ai/interject` mid-stream:

- `x.ai/interject` -> JSON-RPC `-32601` "Method not found" — wrong method
  name, not a capability gate.
- Every OTHER server-emitted notification in the same session uses an
  `_x.ai/...` (underscored) namespace. Retried as `_x.ai/interject` ->
  `-32602` "Invalid params" instead of `-32601` — the method IS recognized
  under that name. Two param shapes were tried (`{sessionId, message}` and
  `{sessionId, prompt: ContentBlock[]}`, matching `session/prompt`'s own
  shape) — both rejected the same way.

This narrows the scout's open question materially (the method exists and is
reachable; the exact parameter shape is the remaining unknown) but does not
resolve it inside this story's time-box. `softInjection`/`deliveryAck` stay
`false` — a recognized-but-unproven call is not a verified capability, and
`softInjection` is independently gated behind `interrupt`.

## Story 8.8 (this agent's share — capability flags record only proven behavior)

Every capability flag touched by this phase (`claude/capabilities.ts`,
`community/omp/capabilities.ts`, `grok/capabilities.ts`) now carries a
comment describing the exact evidence for its current value — command run,
version, and the specific observation — rather than "current implementation
work" placeholder text. `bun run generate:capability-matrix` was re-run after
every flag/comment change; `check:capability-matrix` passes with no diff
against the regenerated doc.

## Tests

- `packages/providers/src/claude/provider.test.ts` — 3 new cases (uuid
  stamping + `extraArgs`, the no-`operatorMessageId` control, and the
  echo-to-chunk mapping with a mismatched-uuid negative case). Full file:
  186 pass, 0 fail.
- `packages/providers/src/claude/soft-injection-spike.test.ts` — 7 cases
  covering the classification logic against both the real observed shape
  and the verified-shape control.
- `packages/providers/src/community/omp/rpc-mode-spike.test.ts` — 9 cases,
  same pattern for the RPC Stop/steer verdicts.
- `packages/providers/src/grok/acp-handshake-spike.test.ts` — 4 cases for
  the interject verdict classifier.
- `packages/workflows/src/steering-registry.test.ts` — 7 new `softInject`
  cases. Full file: 58 pass, 0 fail.
- `packages/workflows/src/dag-executor.test.ts` — 4 new cases (delivery-ack
  chunk routing + operatorMessageId single-vs-combined). Full file after the
  final merge: run via `bun run test`'s per-file split, 0 fail across every
  segment.
- `packages/core/src/db/workflow-steering.test.ts` — 4 new cases against a
  real `SqliteAdapter(':memory:')`. Full file: 25 pass, 0 fail.
- `packages/server/src/routes/api.workflow-runs.test.ts` — 3 new
  route-level cases against a real `OpenAPIHono` app. Full file: 327 pass, 9
  todo (pre-existing), 0 fail.

Real-binary spikes are diagnostic-only per the existing convention in this
codebase (not exported from the providers barrel, not called from tests or
CI): `spike:softinject:claude`, `spike:rpc:omp`, `spike:acp:grok`, plus the
pre-existing `spike:interrupt:omp` and `spike:interrupt:grok` (`GROK_SPIKE_ONLY=B7,B9`)
re-runs. Every spike run against real credentials/binaries the operator is
logged into on this machine, driven directly (not through the server, to
avoid Phase B's discovered side effect of the server routing an unbound
conversation through the default assistant and firing a real billed call).

## Validation

- `bun run type-check` — clean across every package this phase touched
  (providers, workflows, core, server, adapters, cli, isolation, paths, git,
  docs-web). The whole-monorepo run fails only in
  `packages/web/src/components/workflows/ComposerDock.tsx` (+`.test.tsx`)
  and `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
  (+`.test.tsx`) — the pre-existing break from Phase B's widened steering
  wire contract, outside this phase's ownership. The coordinator confirmed
  the UI-owning agent is landing a fix separately.
- `bun run lint` (`--max-warnings 0`) — clean at the whole-monorepo level.
- `bun run format:check` (`prettier --check .`) — clean.
- `bun run check:capability-matrix` — clean, no diff after regeneration.
- Per-package `bun run test` (the project's own per-file split, not a raw
  `bun test` glob) — 0 failures in every package this phase touched, run
  after every commit and again after the final `git merge develop-2`.
- Did not run the whole-monorepo `bun run test` in one shot in this
  environment (machine under heavy concurrent load from parallel agents;
  kept every command bounded and ran suites per-package instead, per the
  coordinator's guidance mid-phase).

## Unresolved / needs orchestrator attention

- **`packages/web` ComposerDock type break** — not mine to fix (outside
  ownership); tracked by the coordinator with B-UI.
- **OMP `--mode rpc` migration** — recommended as its own follow-up story.
  The redirect-with-context-proof finding is real and positive; the
  transport swap (provider turn loop, event parser envelope, `--replay`-style
  ack correlation if OMP has an equivalent, `session-usage.ts`, ~20 existing
  tests) is out of this story's scope.
- **Grok `_x.ai/interject` param shape** — recognized but unproven. A
  follow-up spike with more param-shape guesses, or captured traffic from
  grok's own pager UI, is the natural next step.
- **Grok B7/B9 (owned-tree descendant reaping)** — a grok-binary-side
  process-tree behavior, not an Archon adapter bug; native Linux and Windows
  evidence remains unavailable in this environment regardless.

## Status

DONE_WITH_CONCERNS

## Summary

Claude's Stop was already proven; this phase disproves soft injection
(`streamInput()` always starts a new queued turn, confirmed under three
different injection strategies including a reviewer-suggested SDK field) and
proves + wires delivery acknowledgement (`--replay-user-messages`, a real
CLI flag not documented in the installed SDK's types) end to end through the
new provider-neutral soft-injection/delivery-ack plumbing this phase also
built. OMP and Grok's shipped Stop transports remain provably blocked on
real, reproducible binary-side failures (re-confirmed on the currently
installed versions, both changed since the last spike); OMP's RPC-mode
alternative is genuinely promising for Stop+redirect but unproven for Stop's
own acknowledgement and is recommended as its own migration story rather
than a rushed leg of this one; Grok's soft-injection channel is real and
partially reachable (method recognized, param shape unresolved) but not
provably callable. Every capability flag this phase touches reflects real,
reproducible evidence rather than aspiration.
