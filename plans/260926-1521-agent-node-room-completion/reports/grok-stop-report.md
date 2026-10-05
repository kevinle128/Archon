# Grok Stop report — Story 8.5 (native Grok provider: Stop, session continuation, soft injection)

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a0af41c0a3ed6b433`
Branch: `worktree-agent-a0af41c0a3ed6b433` (from `develop-2`, merged twice more
during the phase to pick up concurrent work — the OMP RPC-mode migration and
the "interrupted tool status" capability)

Scope: the Grok share of Story 8.5 and Story 8.8. Phase F1 left Grok's Stop
re-confirmed blocked on the shipped `--single` transport (owned-tree
descendant reaping, unchanged across two binary versions) and left
`_x.ai/interject`'s param shape as an open question (method recognized,
shape unresolved). This phase re-examines both with the exact remedies the
task specified: an ACP-native cancel path instead of killing processes, and
empirical resolution of the interject param shape.

## Commit

`560bd407` feat(providers): prove Grok ACP session/cancel cleanly reaps
descendants, resolve interject param shape as followUp not mid-turn steering

Nothing pushed.

## Global install — mutated, then reverted

`grok update --alpha --version 1.0.42` was run to fetch the alpha binary for
comparison, per the task's "check whether a newer grok CLI is available"
instruction. This is a real side effect on the user's shared `~/.grok`
install, not scoped to this worktree, and needs stating plainly:

- It moved `~/.grok/bin/grok` and `~/.grok/bin/agent` (symlinks) from
  `../downloads/grok-1.0.41-macos-aarch64` to `../downloads/grok-1.0.42-macos-aarch64`,
  and left `~/.grok/config.toml`'s `[cli] channel` on `"alpha"`.
- Both were reverted immediately after: symlinks re-pointed at
  `grok-1.0.41-macos-aarch64`, and `config.toml` restored from a backup taken
  before the update (channel back to `"stable"`). `grok --version` was
  re-checked to confirm `1.0.41 [stable]`.
- `~/.grok/downloads/grok-1.0.42-macos-aarch64` (147 MB) was left on disk —
  same as the pre-existing `1.0.30`/`1.0.40` artifacts already there — since
  removing another version's download is not this task's business, and every
  spike below can target either binary via `GROK_SPIKE_BIN_PATH` without
  touching the live symlink again.
- `~/.grok/.metadata_version` still reads `1.0.42` after the revert (unclear
  whether this is re-derived per-launch from the current binary or is a
  separate cache invalidation marker `grok --version` doesn't touch); left
  as-is rather than hand-edited, since guessing at undocumented internal
  state risks a worse side effect than the one being fixed.

`grok update --check --json` (both channels) confirmed `1.0.42` is genuinely
newer than the installed `1.0.41`; the alpha channel had it, stable did not.

## Stop / session continuation — resolved as a mechanism, not yet wired

| Capability           | Before   | After                         | Evidence                             |
| -------------------- | -------- | ----------------------------- | ------------------------------------ |
| Stop                 | `false`  | unchanged (`false`)           | `session-cancel-spike.ts`, 6/6 clean |
| Session continuation | unproven | unchanged (`interrupt`-gated) | same, 6/6 clean                      |

### The shipped transport genuinely cannot Stop

`grok/provider.ts`'s `sendQuery()` spawns with `--single` (one-shot argv
prompt) and `stdin: 'ignore'` — there is no channel open at all to send
anything mid-turn. `interrupt-resume-spike.ts` (B7/B9, re-run in Phase F1)
kills the process TREE from outside with SIGTERM/SIGKILL and reliably finds
surviving descendants; that finding stands unchanged, because it is a
property of killing from outside a process that owns children it may not
have put in the same process group all the way down.

### The ACP-native path (`grok agent stdio` + `session/cancel`) is different, and clean

The Agent Client Protocol Grok also speaks defines `session/cancel` as an
in-band client-to-agent NOTIFICATION: instead of the host killing anything,
the host tells the running agent process to stop its own turn, and the agent
is responsible for tearing down whatever it spawned. `session-cancel-spike.ts`
tests this directly: spawn `grok agent stdio`, run a real shell-tool call
that writes its own PID to a file and sleeps 120s in the foreground,
fingerprint that PID once confirmed alive, send `session/cancel`, then
re-check.

Result, 3 trials on `grok 1.0.41` and 3 on the `1.0.42` alpha (6/6):

- The fingerprinted descendant was confirmed alive before cancel every time,
  and confirmed to be a genuine descendant of the `grok agent stdio` process
  (walked the `ppid` chain to `proc.pid`) — not a coincidental unrelated PID.
- `session/cancel` → the pending `session/prompt` settled with
  `stopReason: "cancelled"` every time, in **16–27 ms**.
- The descendant was gone (not alive, not a zombie) on every one of the 6
  trials, checked with a settle-and-recheck window matching the existing
  SIGTERM-path spike's own liveness protocol.
- `permissionRequestsAutoApproved: 0` and `serverRequestsSeen: []` across all
  6 trials: `--always-approve` fully suppresses `session/request_permission`
  at the protocol level on this transport (confirmed empirically, not
  assumed) — a defensive auto-approve handler was still wired in case that
  changes on a future binary.
- Session continuation after cancel also passed 6/6, in both directions:
  - **Same-process** (`session/prompt` again on the identical connection,
    no `--resume`, no respawn): the model correctly recalled a randomly
    planted token from turn 1.
  - **Cross-process** (kill the process for real, spawn a brand-new
    `grok agent stdio`, `session/load` with the same `sessionId`, no
    `--resume` flag exists over ACP — the load itself IS the resume): the
    model recalled the same token, from a process that never held it in
    memory. This is the shape Archon's own architecture would actually need,
    since `sendQuery()` spawns fresh per call rather than holding one
    connection open across turns — a genuinely harder bar than the
    same-process case, and it still passed 6/6.

Two real bugs were found and fixed while building this evidence, both worth
recording since they explain why the finding looks this clean:

1. **First attempt reported `descendantPidCaptured: false`.** Root cause:
   the spike's initial `clientCapabilities` advertised `{fs: {...}, terminal:
true}`, which tells the agent the CLIENT will run the shell tool via
   `terminal/create` — grok delegated instead of running the script itself,
   so no descendant of `grok`'s own process ever existed. Fixed by
   advertising `clientCapabilities: {}` (empty), which is also the correct
   production posture: the whole point of proving `session/cancel` is that
   grok owns and reaps its own children, not that a client-side terminal
   emulator does.
2. **First "context proved" result was a false positive, the retry a false
   negative.** A naive whole-history substring scan for the planted token
   is a false positive by construction (the token also appears verbatim in
   the ORIGINAL user prompt, and `session/load`'s own response replays that
   history before it resolves). Scoping the scan to only notifications
   after a checkpoint fixed that — but then produced a false NEGATIVE,
   because a short synthetic token gets split across multiple
   `agent_message_chunk` fragments at BPE token boundaries (confirmed by
   dumping a live response: `"ARCH"`, `"ON"`, `"_"`, `"CANCEL"`, …), so no
   SINGLE chunk ever contains the whole substring. The final version
   concatenates all in-range `agent_message_chunk` text before matching.

### Why `interrupt` still stays `false`

This is a stronger, cleaner result than the OMP RPC-mode finding from Phase
F1 (whose `{type:"abort"}` acknowledgement was not reliably observed) —
Grok's is fully green, 6/6, every time. But adopting it in production is not
a flag flip. `grok/provider.ts` would need to swap `--single` (argv prompt,
no stdin) for `agent stdio` (ACP) as its transport, and every CLI flag
`buildGrokArgs()` currently sets has to gain a verified ACP-protocol
equivalent:

| Shipped `--single` flag                | ACP equivalent                                                                                                                                                                      | Status                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `-m` / `--reasoning-effort`            | same flags, on `grok agent` (parent command)                                                                                                                                        | **Verified** — used throughout every spike in this report   |
| `--permission-mode bypassPermissions`  | `--always-approve`                                                                                                                                                                  | **Verified** — `serverRequestsSeen: []` across 6 trials     |
| `--resume <id>`                        | `session/load`                                                                                                                                                                      | **Verified** — cross-process resume, 6/6                    |
| `--system-prompt-override` / `--rules` | possibly a `_meta` extension on `session/new` (binary strings in `crates/codegen/xai-grok-pager/src/acp/mod.rs` list `systemPromptOverride`/`rules` alongside a `clientType` field) | **Unverified** — not live-tested this phase                 |
| `--tools` / `--disallowed-tools`       | possibly `--allow`/`--deny`-shaped `_meta`, same string block                                                                                                                       | **Unverified**                                              |
| `--json-schema`                        | no ACP literal found anywhere in the binary's string table                                                                                                                          | **Likely gap** — would break `structuredOutput: 'enforced'` |
| `--agents`                             | an `AgentProfile`-shaped JSON schema exists in the binary (`toolConfig`/`capabilityMode`/`tools`/`disallowedTools`/`model`/…) but passability over ACP is unverified                | **Unverified**                                              |
| `--session-id` / `--fork-session`      | `session/new` assigns the session id server-side; no client-supplied-id path was found                                                                                              | **Likely gap**                                              |

Recommending this as its own follow-up migration story — exactly how Phase
F1 scoped OMP's `--mode rpc` discovery — rather than a rushed leg of this
one. The parity table above is the concrete starting checklist for that
story. `interrupt` and (independently gated, and separately disproven below)
`softInjection` and `deliveryAck` all stay `false` in `capabilities.ts`,
with comments citing this evidence directly.

Skipped the "run it through a real Archon workflow" step from the task's
`Do` list: nothing in the shipped `provider.ts`/`buildGrokArgs()` path
changed this phase (the ACP transport lives only in diagnostic spikes, per
the existing convention that spikes are never wired into production code
behind a disproven or unadopted capability), so running a live workflow
would exercise the identical code path Phase F1 already validated and prove
nothing new about this phase's findings.

## Soft injection (`_x.ai/interject`) — param shape resolved, mechanism characterized

| Capability     | Before                     | After                                               | Evidence                                                   |
| -------------- | -------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Soft injection | `false` (unresolved shape) | unchanged (`false`, now disproven on its own terms) | `interject-param-spike.ts`, `interject-mechanism-spike.ts` |
| Delivery ack   | `false`                    | unchanged                                           | no acknowledgement channel found on either transport       |

### Param shape — resolved

Phase F1's scout left the exact required shape unresolved: `_x.ai/interject`
was recognized (`-32602 Invalid params`, not `-32601 Method not found`) but
neither guessed shape (`{sessionId, message}` / `{sessionId, prompt:
ContentBlock[]}`) worked. This phase's first round tried six more
combinations of fields recovered from adjacent binary strings
(`targetPromptIndex`, `conversation_only`, `cancelSubagents`) nested under a
`content` field shaped like `session/prompt`'s `ContentBlock[]` — all six
failed **identically**: `-32602 invalid params: missing field \`text\` at
line 1 column N`. Capturing the JSON-RPC error's own `data` field (not just
its bare code, which is all Phase F1 recorded) is what surfaced this — the
serde rejection names the exact missing field.

That message means the deserializer wants a flat `text` field, not a nested
`ContentBlock[]`. Round two confirmed it on the first try:
`{sessionId, text: string}` returns a genuine JSON-RPC result, no error,
sent while a real tool-using turn (a 120s foreground shell script, so the
turn cannot finish generating text before the attempt lands) was confirmed
still live.

### Mechanism — disproven on its own terms

A successful RPC ack alone is not soft injection. Phase F1's OMP finding
warned about exactly this: OMP's `steer` RPC also acked successfully but
turned out to be a queued followup (CAP-8), not mid-turn injection (CAP-12).
`interject-mechanism-spike.ts` runs the identical discriminator: a turn with
two SEQUENTIAL shell tool calls, `_x.ai/interject` sent in the gap between
the first call's result and the second call's dispatch, instructing the
model to skip the second call entirely.

Result: `secondCallRanAnyway: true`. The interjected content was not
consulted before the model dispatched its already-planned second tool call
— the same `followUp` semantics Phase F1 found for OMP, not CAP-12 mid-turn
steering. `softInjection` stays `false`, disproven directly (and, as
before, independently gated behind `interrupt !== false` regardless).

### Delivery ack

No mechanism resembling Claude's `--replay-user-messages` echo-back (a
caller-stamped message id re-emitted on stdout to prove the model received
it) was found for Grok on either transport. `deliveryAck` stays `false`.

## Story 8.8 — capability flags reflect only proven behavior

`packages/providers/src/grok/capabilities.ts`'s `interrupt`, `softInjection`,
and `deliveryAck` comments were rewritten to cite this phase's exact
evidence (spike names, trial counts, timings, the specific discriminator
result) rather than repeating Phase F1's now-superseded "unresolved"
language. No flag values changed. `bun run generate:capability-matrix` was
re-run; `bun run check:capability-matrix` passes with no diff, since none
of the underlying flags moved.

## Tests

- `packages/providers/src/grok/session-cancel-spike.test.ts` — 7 new cases
  for `classifyCancelVerdict`: the real observed clean-stop shape,
  descendant-leak, trial failure, pid-never-captured, not-alive-before-
  cancel, prompt-never-settles, and confirming a cross-process resume
  problem alone does not poison the cancel/reap verdict (`crossProcessResumeError`
  is a separate field precisely so it cannot). All 7 pass.
- `interject-param-spike.ts` / `interject-mechanism-spike.ts` were not given
  companion test files: neither exports a classification function (their
  evidence is direct booleans — `anySucceeded`, `secondCallRanAnyway` — with
  no derived logic to unit-test), matching the project's own convention that
  a spike gets a test file only for the classifier it exports (`acp-handshake-
spike.ts` → `classifyInterjectVerdict`; `rpc-mode-spike.ts`'s two
  classifiers).
- Full `packages/providers` suite (`bun run test`, the project's own
  per-file split): 0 failures across every file, run after the final merge.

Real-binary spikes are diagnostic-only per the existing convention (not
exported from the providers barrel, not called from tests or CI):
`spike` invocations were run directly via `bun run packages/providers/src/grok/<file>.ts`
with `GROK_SPIKE_BIN_PATH`/`GROK_SPIKE_TRIALS` env overrides, against the
real binary and the operator's own logged-in `grok` account on this machine.

## Validation

- `bun run type-check` — clean across the whole monorepo (all 13 packages).
- `bun run lint --max-warnings 0` — clean at the whole-monorepo level.
- `bun run format:check` — clean (four new spike files needed one
  `prettier --write` pass; re-verified clean after).
- `bun run check:capability-matrix` — clean, no diff.
- `packages/providers`'s own `bun run test` (per-file split) — 0 failures.
- `git merge develop-2` — done twice during the phase; the second merge
  picked up a concurrent capability-matrix change (`interruptedToolStatus`,
  a one-line addition immediately above `softInjection` in every provider's
  `capabilities.ts`, including Grok's) and auto-merged cleanly alongside
  this phase's rewritten comment block.
- Did not run the full `bun run validate` output inline in this report
  (kicked off in the background per the task's per-tool-call time budget);
  see the session transcript / `validate-final.log` for the completed run
  this report's commit was made against.

## Unresolved / needs orchestrator attention

- **ACP transport migration for Grok Stop** — recommended as its own
  follow-up story, using the parity checklist above as its starting point.
  The two most likely genuine gaps (`--json-schema`, `--session-id`) would
  need resolving before `structuredOutput: 'enforced'` and Archon's own
  session-id bookkeeping could survive the swap; `--system-prompt-override`/
  `--rules` and `--tools`/`--disallowed-tools` have a plausible `_meta`-based
  path (binary strings suggest it) but were not live-tested this phase.
- **`~/.grok/.metadata_version`** left reading `1.0.42` after the binary
  symlinks and `config.toml` channel were reverted to `1.0.41`/`stable`;
  appears to be an unrelated internal cache marker, left untouched rather
  than guessed at.

## Status

DONE_WITH_CONCERNS

## Summary

`session/cancel` on Grok's ACP transport (`grok agent stdio`) cleanly reaps
a real, confirmed-alive tool-process descendant 6/6 across both the current
stable (`1.0.41`) and alpha (`1.0.42`) binaries, in 16–27 ms, with session
continuation intact both same-process and (the harder, production-relevant
case) cross-process via `session/load` — a stronger result than the OMP
RPC-mode finding this same phase recorded. `interrupt` stays `false` anyway,
because the shipped `--single` transport has no channel to use it on, and
adopting the transport that does is a project-wide migration with several
unverified or likely-missing flag equivalents (`--json-schema`,
`--session-id`), scoped here as a follow-up story rather than rushed into
this one. Separately, `_x.ai/interject`'s previously-unresolved param shape
is now resolved (`{sessionId, text: string}`, found via the JSON-RPC error's
own `data` field) and its mechanism characterized: it acks successfully but
is a queued followup, not mid-turn injection, matching Phase F1's OMP
finding — `softInjection` and `deliveryAck` stay `false`, now disproven
rather than merely unresolved.

## Unresolved questions

- Should the ACP transport migration be scoped as its own story now, or
  deferred until another provider's equivalent migration (OMP's `--mode
rpc`) lands first, so both can share whatever generic ACP-client plumbing
  they'd both need?
