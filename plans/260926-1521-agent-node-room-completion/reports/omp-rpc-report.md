# OMP RPC-mode migration — Story 8.7 completion

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-af3789df36729e37c`
Branch: `worktree-agent-af3789df36729e37c` (from `develop-2`, merged twice more
during the phase to pick up the coordinator's ComposerDock type-error fix).

Scope: move the OMP community provider from `--mode json` + SIGTERM to
`--mode rpc` as a warm per-node-session process, so Stop works reliably and
the interrupted turn can be redirected on the same live session instead of
respawning from disk.

## What changed and why

The prior `--mode json` transport spawned a fresh OMP process per turn and
took the prompt as an argv string. Stop sent SIGTERM to end the turn, then a
later redirect respawned a new process with `--resume <id>`, hoping OMP had
flushed enough session state to disk before the kill. The phase F1 spike
(`plans/260926-1521-agent-node-room-completion/reports/phase-f1-report.md`)
proved that path unreliable and proved that `--mode rpc`'s in-band
`{type:"abort"}` command — which never kills the child — sidesteps the
problem, but flagged the abort command's own JSON-RPC response as
unreliable and called the transport swap "a substantial migration, not
something a conformance spike alone can prove."

This phase does that migration:

- **`packages/providers/src/community/omp/rpc-transport.ts`** (new) — the
  wire-level primitives for `--mode rpc`: `RpcFrameReader` (JSONL framing,
  protocol v1 only — see the module doc for why v2 chunking was not built),
  `OmpRpcProcess`/`OmpRpcSpawner` (bidirectional process handle, replacing
  the old argv-only `OmpProcess`/`OmpSpawner`), `OmpRpcSession` (one live
  child + its frame reader + a continuous stderr capture, with
  `closeGracefully()` for a clean stdin-EOF exit and `kill()` for a hard
  SIGTERM/SIGKILL), and `performReadyHandshakeAndGetSessionId()` (consumes
  `ready`, then `get_state`, since RPC mode never emits the `session` header
  frame `--mode json` does).
- **`packages/providers/src/community/omp/provider.ts`** (rewritten) —
  `buildOmpArgs` now builds `--mode rpc` argv with no trailing prompt (the
  prompt travels as a `{type:"prompt"}` stdin frame). `OmpProvider` holds an
  instance-level warm `OmpRpcSession` reused across turns whenever the
  caller's `resumeSessionId` matches the session's own id (and neither
  `forkSession` nor `persistSession: false` applies); a mismatch, Cancel, or
  a bounded idle timeout evicts it. Stop sends `{type:"abort"}` in-band
  (never killing the process) and classifies the turn as interrupted purely
  from the turn's own terminal event — an assistant `message_end` with
  `stopReason: "aborted"` — never from the unreliable abort-command echo.
- **`packages/providers/src/community/omp/capabilities.ts`** — `interrupt`
  flips `false` → `'stream-abort'` with a comment recording the real-binary
  evidence. `softInjection`/`deliveryAck` stay `false` (see below).
- **`packages/providers/src/community/omp/index.ts`**,
  **`packages/providers/src/index.ts`** — export the renamed
  `OmpRpcProcess`/`OmpRpcSpawner` types (the old `OmpProcess`/`OmpSpawner`
  shape could not represent a bidirectional stdin, so the rename is
  intentional, not cosmetic).
- **`packages/providers/src/community/omp/interrupt-resume-spike.ts`**
  (deleted) — it drove the retired `--mode json` + SIGTERM transport
  directly and depended on the old `OmpProcess`/`OmpSpawner`/
  `INTERRUPT_SESSION_HEADER_WAIT_MS` shapes; nothing in production still
  uses that transport, so keeping it would mean a broken, uncompilable
  diagnostic testing a mechanism that no longer exists. Its package.json
  script (`spike:interrupt:omp`) was removed with it.
  `rpc-mode-spike.ts` (the RPC-mode conformance spike from the prior phase)
  is untouched — it never imported from `provider.ts`.
- **`packages/providers/src/registry.test.ts`** — the capability-matrix
  assertion that pinned OMP to "not stream-abort yet" now expects it
  alongside Codex and DeepSeek.
- **`packages/docs-web/src/content/docs/reference/provider-capabilities.md`**
  — regenerated via `bun run generate:capability-matrix`.

### Why the old json-mode disk-resume path was removed entirely

The task allowed keeping the old path as a cross-run resume fallback if RPC
mode could not resume across process restarts. It can: a live probe against
the real binary (below) showed `--mode rpc --resume <id>` on a **freshly
spawned** process, after the prior process exited cleanly via stdin EOF,
correctly restored full conversation context. The prior transport's
unreliability was specifically about resuming immediately after a SIGTERM
kill, not about `--mode rpc --resume` itself. Since the new transport never
SIGTERMs a session it wants to keep resumable — Stop uses in-band abort, and
eviction always tries a graceful `closeGracefully()` (stdin-EOF) first — the
disk-resume path stays reliable through the one transport, and the old
json-mode arg-building/SIGTERM machinery, and its ~40-line test double
contract, could be deleted rather than duplicated alongside the new one.

### Warm-session lifecycle

`OmpProvider` instances are constructed fresh per node execution
(`deps.getAgentProvider()` calls the registry factory), and the **same**
instance is reused by the dag-executor across every turn of one node
(interrupt-redirect, natural-boundary queued guidance, structured-output
re-asks) — confirmed by reading `dag-executor.ts` (`aiClient` is assigned
once, outside the `turns:` loop). That makes an instance-level warm session
safe: no cross-node leakage, and it is naturally released once the node's
execution function returns and drops the last reference.

- **Reuse**: a call is served on the existing warm process when
  `resumeSessionId` equals the warm session's own id, `forkSession` is not
  requested, and `persistSession !== false`. No respawn, no `--resume` args
  — a new `{type:"prompt"}` frame on the same stdin.
- **Cancel**: `AgentRequestOptions.abortSignal` is the _same_
  `AbortController.signal` for the whole node's lifetime (set once, outside
  the turn loop, in `dag-executor.ts`), so `OmpProvider` attaches exactly one
  listener to it (on first sight) that hard-kills (SIGTERM → SIGKILL after a
  grace period) the current warm session whenever Cancel fires — including
  while the session is idling between turns, with no `dispose()`/`cancel()`
  method added to `IAgentProvider`.
- **Idle eviction**: an unused warm session is closed gracefully after
  `WARM_SESSION_IDLE_EVICTION_MS` (40 minutes) with no new turn. That must
  exceed the workflow engine's own post-interrupt redirect window
  (`STEERING_IDLE_AWAIT_INACTIVITY_MS`, 30 minutes,
  `packages/workflows/src/steering-registry.ts`) — otherwise the very
  process this migration exists to keep warm would be evicted while the
  operator is still composing a redirect. `@archon/providers` cannot import
  that constant (dependency direction is the other way), so the 40-minute
  value is a deliberately generous, independently chosen margin documented
  at its declaration site.

### Interrupt classification — no abort-ack dependency

Verified against the real binary (below): sending `{type:"abort"}` — at any
point before the turn's own natural `agent_end`, whether mid-text-stream or
mid-active-tool-call — reliably produces an assistant `message_end` with
`stopReason: "aborted"`, `errorMessage: "Interrupted by user"`, even though
the abort command's own JSON-RPC `response` was never observed to echo back
by id in any run (matching the phase F1 spike's finding on the same
mechanism). `OmpProvider` classifies a turn as interrupted from that
observed `stopReason`, never from the abort response. `parser
.beginOperatorInterrupt()` is called synchronously the moment Stop is
accepted (before the abort frame is even written), preserving the existing
`toolOutcome: 'interrupted'` mapping for a tool call that was active at the
moment of Stop — this required no changes to `event-parser.ts`.

### `event-parser.ts` is unchanged

RPC mode has no `session` header frame; `OmpProvider` seeds the parser's
existing extension point with a synthesized `{type:"session", id}` line
(constructed from the id already known via `get_state`, before any real
frame is fed) — the exact same event shape the parser already handles for
`--mode json`. Every other RPC envelope type not part of the parser's known
`AgentSessionEvent` set (`ready`, `response`, `available_commands_update`,
`extension_ui_request`, …) already falls through to the parser's existing
`default: flushAssistant()` arm harmlessly, matching how unknown types are
handled today; the transport layer only intercepts `response` (id
correlation for `get_state`/the prompt ack), `extension_ui_request`
(defensive auto-answer — `--no-extensions` is always passed, so this should
never fire in practice), and `rpc_frame_error` (a v1 encoding failure,
mapped to a protocol error). This kept the parser's 27 KB test file
untouched.

### Protocol v1 only (no chunk reassembly)

OMP advertises `supportedProtocolVersions: [1, 2]` on `ready` but stays on
v1 until a client sends `negotiate_protocol`; this reader never does. v1's
writer-side shrink passes can silently truncate a frame over 1 MiB.
`OmpProvider` reads only a handful of small top-level fields per frame
(`type`, `delta`, `stopReason`, `toolCallId`, …), so the practical exposure
is a very long final assistant message losing trailing text — already
surfaced (not silently) by the existing `omp_stream_mismatch` completeness
check in `event-parser.ts`. Negotiating v2 would add a ~110-line
chunk-reassembly codec for a truncation mode this codebase already detects
and reports; not built. Documented at the top of `rpc-transport.ts`.

### Tool-status truthfulness (point 4 of the brief)

No new `ProviderCapabilities` field landed on `develop-2` for "can prove an
interrupted tool outcome" — re-checked after the final `git merge develop-2`
(`grep -n "toolOutcome\|canProve" packages/providers/src/types.ts`, one hit:
the existing `toolOutcome?: 'success' | 'error' | 'interrupted' |
'unknown'` field on the `tool_result` chunk, unchanged). The spec line this
refers to (`SPEC.md:238`, "For a provider that can prove an interrupted tool
outcome…") describes that existing field, not a new capability axis. OMP's
mapping to `toolOutcome: 'interrupted'` for a tool active at the moment of
Stop is unchanged logic in `event-parser.ts`, verified still correct under
the new transport by both the unit test ("mid-tool Stop maps the
interrupted tool call to toolOutcome 'interrupted'") and the live `sleep 90`
runs below.

## Files changed

- `packages/providers/src/community/omp/rpc-transport.ts` — new, 330 lines.
- `packages/providers/src/community/omp/provider.ts` — rewritten, 620 lines
  (was 693; net smaller despite the added warm-session/eviction/Cancel-
  listener logic, because the old SIGTERM/kill-timer/header-wait machinery
  for interrupt classification is gone).
- `packages/providers/src/community/omp/provider.test.ts` — rewritten, 30
  tests (was 40 against the retired transport): `buildOmpArgs` (6), fresh-
  spawn turns (11), warm-session reuse (6), Stop/Cancel (7).
- `packages/providers/src/community/omp/capabilities.ts` — `interrupt`
  flipped, comments updated on all three interrupt-adjacent flags.
- `packages/providers/src/community/omp/index.ts`,
  `packages/providers/src/index.ts` — export renames.
- `packages/providers/src/community/omp/interrupt-resume-spike.ts` —
  deleted (1273 lines).
- `packages/providers/package.json` — removed `spike:interrupt:omp`.
- `packages/providers/src/registry.test.ts` — updated capability-matrix
  assertion.
- `packages/docs-web/src/content/docs/reference/provider-capabilities.md` —
  regenerated.

`session-usage.ts`, `event-parser.ts`, `binary-resolver.ts`, `config.ts`,
`registration.ts` are untouched.

## Live verification (real `omp` binary, real subscriptions, real Archon workflow)

Isolated server: `ARCHON_HOME` pointed at a scratch copy of `archon.db` +
`config.yaml` + `credential-key`, `TELEGRAM_BOT_TOKEN=`/`SLACK_BOT_TOKEN=`/
`DISCORD_BOT_TOKEN=` unset, `WORKFLOW_RUN_RETENTION_DAYS=36500`,
`SESSION_RETENTION_DAYS=36500`, `PORT=3326`. A scratch non-git folder
project (`kind: 'folder'`, no worktree/remote machinery involved) with two
one-node workflows, `omp-rpc-verify-grok` (`provider: omp`, `model:
xai-oauth/grok-4.5`) and `omp-rpc-verify-codex` (`model:
openai-codex/gpt-5.6-sol`). Driven entirely through the server's real HTTP
API (`POST /api/workflows/{name}/run`, `POST …/nodes/{id}/interrupt`,
`POST …/nodes/{id}/send`, `POST …/runs/{id}/abandon`) — no code paths
bypassed. `omp/18.1.21`, the same version the prior phase's spikes used.

Every case below plants a random token in the first turn and asks for it
back after Stop/redirect or after the queued follow-up, so "context
preserved" means the **model's own reply contained the token**, read
directly off `node_completed.data.node_output` in the run's event log — not
inferred.

| Case                                                                                                                           | Model       | Reps | Result                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop mid-generation (streaming text) + Send-now redirect                                                                       | grok-4.5    | 3/3  | Interrupt call returned `sub_state: "idle-after-interrupt"` every time; redirect turn's `node_output` was the exact planted token each time (`OMPTOKEN12345`, `TXTMID-1`, `TXTMID-2`); `proc.signals` empty — child never killed.         |
| Stop mid-generation + Send-now redirect                                                                                        | gpt-5.6-sol | 3/3  | Same, tokens `CTXT-1`/`CTXT-2`/`CTXT-3`.                                                                                                                                                                                                  |
| Stop mid-active-tool-call (`sleep 90`) + Send-now redirect                                                                     | grok-4.5    | 3/3  | Interrupt fired seconds into the tool call (never waited out the 90s); redirect turn replied `DONE` as instructed each time, proving the model retained "I was told to skip the sleep" context; process alive throughout.                 |
| Stop mid-active-tool-call (`sleep 90`) + Send-now redirect                                                                     | gpt-5.6-sol | 3/3  | Same.                                                                                                                                                                                                                                     |
| Natural-boundary Queue delivery (`intent: "queue"` while a tool call is in flight, delivered automatically once the turn ends) | grok-4.5    | 1/1  | `POST …/send` returned `state: "queued"`; the queued follow-up ran automatically on the same warm process once the `sleep 12` turn finished naturally; `node_output` was the planted token (`QUEUE-42`).                                  |
| Natural-boundary Queue delivery                                                                                                | gpt-5.6-sol | 1/1  | Same, token `CODEXQ-9`.                                                                                                                                                                                                                   |
| Cancel (`POST …/abandon`) mid-tool-call still kills the process                                                                | grok-4.5    | 1/1  | Run transitioned to `cancelled` (`dag.stop_detected_between_layers`); the specific child PID was confirmed gone via `ps -p` after the shared dag-executor's `CANCEL_CHECK_INTERVAL_MS` (10 s) poll plus the SIGTERM→SIGKILL grace period. |
| Cancel mid-tool-call still kills the process                                                                                   | gpt-5.6-sol | 1/1  | Same.                                                                                                                                                                                                                                     |

Stop was fired via curl **immediately** after `omp.query_started` appeared
in the server log (typically 2–4 s in) rather than on a fixed delay, so
every recorded rep genuinely landed mid-turn — two earlier grok attempts
that used a plain "count to N" prompt were **not** counted above because
the model finished the count before curl could send Stop (an 11 s natural
completion each time); that is a prompt-timing miss on my part, not a
provider failure, and is why the counted reps switched to a long essay
prompt and the deterministic `sleep 90` tool call.

`interrupt: 'stream-abort'` was flipped only after all of the above passed
consistently, per the brief's rule; nothing here failed.

### Not proven / left as documented limitation

- **Protocol v2 / chunk reassembly**: not implemented, not tested against a
  frame that actually exceeds 1 MiB (none of the live runs produced output
  anywhere near that size). Documented risk, not a gap in this story's
  required scope.
- **`omp.session_usage_header_mismatch`** (best-effort hidden-usage
  enrichment, `session-usage.ts`, untouched by this phase): appeared on most
  live runs. `session-usage.ts` reads the OMP-owned transcript `.jsonl` file
  on disk to find advisor/subagent usage and compares its embedded `type:
"session"` header against the id/cwd it expected; a mismatch here is a
  pre-existing heuristic in a file this phase did not modify, and it never
  affected the **primary** usage numbers — every `node_completed` event
  above carries correct `tokens`/`cost_usd`. The live verification reused
  one scratch folder across ~18 back-to-back runs, which is exactly the
  condition (many session files sharing one cwd hash) most likely to make
  that file-discovery heuristic ambiguous; this looks like a testing-density
  artifact rather than a regression, but it was not root-caused further —
  flagged for whoever next touches `session-usage.ts`'s file discovery.

## Tests

- `packages/providers/src/community/omp/provider.test.ts` — rewritten, 30
  tests, 0 fail. Covers `buildOmpArgs` (rpc-mode argv, no trailing prompt),
  the ready/get_state handshake (including its failure/rejection paths),
  malformed-JSON and `rpc_frame_error` → protocol error, an unexpected
  mid-turn exit → transport error, defensive `extension_ui_request`
  auto-answer, JSON-schema structured output, warm-session reuse (same
  fake process instance served across two calls, no second spawn) and its
  negative cases (mismatched session id, `forkSession`, `persistSession:
false` all force a fresh spawn), idle eviction and its cancellation on
  reuse, in-band Stop for both mid-text and mid-tool-call with the
  `toolOutcome: 'interrupted'` mapping, a Stop that races a natural
  completion (not classified as interrupted), same-process redirect after
  Stop, and Cancel's SIGTERM→SIGKILL escalation both during an active call
  and while a warm session is idling between turns.
- `packages/providers/src/registry.test.ts` — updated one assertion to
  include `omp` in the stream-abort set.
- No changes needed to `event-parser.test.ts`, `session-usage.test.ts`,
  `config.test.ts`, `binary-resolver.test.ts`, `usage-contract.test.ts`,
  `rpc-mode-spike.test.ts` — all still pass unmodified.

A fake-process bug worth recording for future spike/test authors: a
`ReadableStream`'s `start()` callback assigning the controller is not
guaranteed to have run before a synchronous `push()` call right after
construction; the fake buffers pre-`start()` writes and flushes them once
`start()` runs, in order, so tests can queue turn frames immediately after
constructing the fake process without a race.

## Validation

- `bun run type-check` (whole monorepo, including `scripts/tsconfig.json`)
  — clean. One real issue caught and fixed along the way: `for await` used
  directly on a `ReadableStream` type-checks under `@archon/providers`'s own
  tsconfig (Bun's ambient types) but not under `scripts/tsconfig.json`
  (`lib: ["ES2022", "DOM"]`, which lacks `ReadableStream[Symbol
.asyncIterator]`); switched both stdout/stderr pumps in
  `rpc-transport.ts` to `.getReader()` + a manual `read()` loop, matching
  the pattern the retired `provider.ts` already used for the same reason.
- `bun run lint --max-warnings 0` — clean.
- `bun run format:check` — clean.
- `bun run check:capability-matrix` — clean, no diff after regeneration.
- `bun run check:bundled`, `check:bundled-skill`, `check:bundled-schema`,
  `check:pi-vendor-map` — clean (unaffected by this change; run as part of
  the full validate sequence).
- `bun run test:install` — clean.
- Per-package `bun run test` (not a raw `bun test` glob) run and green:
  `@archon/providers` (all files, including the OMP suite above),
  `@archon/workflows`, `@archon/core`, `@archon/server`, `@archon/adapters`,
  `@archon/cli`. The whole-monorepo `bun run test` was not run in one shot
  per the machine-load guidance; per-package runs cover every package this
  phase touches or that consumes `ProviderCapabilities`/the OMP provider.
- Did not run `@archon/web`'s own test suite (untouched by this phase); the
  coordinator's separate ComposerDock fix already landed on `develop-2` and
  is included via the merge, and the whole-monorepo `type-check` (which
  includes `@archon/web`) is clean.

## Status

DONE

## Summary

OMP now runs `--mode rpc` as a warm per-node-session process. Stop sends
in-band `{type:"abort"}` without ever killing the child and is classified
purely from the interrupted turn's own terminal event
(`stopReason: "aborted"`), never from the abort command's own unreliable
JSON-RPC echo; a redirect after Stop, and queued guidance delivered at a
natural turn boundary, both continue on the exact same live process with no
respawn. `interrupt` is now `'stream-abort'`, proven on the real binary
across 3 consistent reps each of mid-generation Stop and mid-tool-call Stop,
on both `xai-oauth/grok-4.5` and `openai-codex/gpt-5.6-sol`, every one
confirmed by the model correctly recalling a planted token after the
redirect. Cancel still hard-kills the process (confirmed on both models,
subject to the shared dag-executor's existing 10-second cancel-poll
interval — unrelated to this transport). `softInjection`/`deliveryAck` stay
`false`: RPC `steer` was already disproven as mid-turn injection by the
prior phase's real-binary spike (follow-up-turn semantics, not injection),
and no transport surfaces a reliable delivery acknowledgement. The old
`--mode json` + SIGTERM transport, its argv-prompt/kill-timer/header-wait
machinery, and the diagnostic spike that tested it are deleted rather than
kept alongside the new one, since a live probe proved `--mode rpc --resume`
is itself reliable for cross-run resume after a clean exit — the disk-resume
fallback the task allowed turned out to need no separate code path.

## Unresolved / needs orchestrator attention

- `session-usage.ts`'s `header_mismatch` file-discovery heuristic surfaced
  repeatedly during live testing (see "Not proven" above) — looks like a
  testing-density artifact from reusing one scratch cwd across ~18 runs,
  never affected primary usage numbers, but was not root-caused. Worth a
  short follow-up look if hidden advisor/subagent usage accounting for OMP
  ever looks off in production.
- Protocol v2 (chunk reassembly for frames over 1 MiB) remains unbuilt and
  undemonstrated either way — documented, not a gap in this story's scope.
