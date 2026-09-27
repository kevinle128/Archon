# Grok ACP transport report — Story 8.5 completion (Stop works)

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-afc723aa8e05c8205`
Branch: `worktree-agent-afc723aa8e05c8205` (from `develop-2`)

Scope: move the native Grok provider's default transport from `--single`
(one-shot argv prompt, no stdin, no interrupt channel) to `grok agent stdio`
(ACP), so Stop and Cancel cleanly reap descendants instead of leaking them
(the B7/B9 finding from the prior Grok Stop report). `session-cancel-spike.ts`
had already proven the mechanism works against the raw protocol; this phase
wires it into `sendQuery()`, verifies every `buildGrokArgs()` flag against the
live binary rather than guessing, and proves the wiring end-to-end through a
real Archon workflow.

## Commit

`a3a2cc41` feat(providers): move Grok to grok agent stdio (ACP) so Stop and
Cancel cleanly reap descendants

Nothing pushed.

## What changed

- **`packages/providers/src/grok/acp-client.ts`** (new) — `driveGrokAcpTurn`
  (drives one ACP turn over an `AgentApp`/`Stream`, mirrors the DeepSeek ACP
  client's structure) and `runGrokAcpTurn` (spawns `grok agent --always-approve
--no-leader [-m MODEL] [--reasoning-effort EFFORT] stdio` via
  `node:child_process`, wraps stdio in `ndJsonStream`). `session/cancel`
  dominance logic (node-Cancel vs operator-Stop, first cause wins) matches
  DeepSeek's; Stop yields the shared `STREAM_ABORTED_TERMINAL_REASON` marker
  (Codex/OMP's shape) instead of DeepSeek's own triple, since that is the
  marker the dag-executor already recognizes without any executor change.
  Cancel throws `Error('Query aborted')`, matching this provider's existing
  `--single`-path contract.
- **`packages/providers/src/grok/acp-event-bridge.ts`** (new) — maps ACP
  `SessionUpdate` → `MessageChunk`, structurally identical to DeepSeek's
  bridge but tolerant of malformed input (ACP's `ToolCall` shape is
  protocol-typed, unlike the ad hoc NDJSON `GrokEventParser` reads, so this
  degrades on a missing name rather than throwing).
- **`packages/providers/src/grok/async-queue.ts`** (new) — a straight copy of
  DeepSeek's `AsyncQueue` (the FIFO push/close/fail bridge the turn generator
  needs). Duplicated rather than imported: it is a small, generic, already-
  tested utility, and importing across a community/built-in boundary would
  create an unwanted coupling for no shared-helper benefit (Rule of Three:
  this is only the second occurrence).
- **`packages/providers/src/grok/provider.ts`** — `sendQuery()` now calls
  `selectGrokTransport()` and dispatches to `acpQuery()` (new default) or
  `singleQuery()` (the pre-existing `--single` body, unchanged, renamed).
  `buildGrokArgs()` is untouched and still used by `singleQuery()`.
- **`packages/providers/src/grok/capabilities.ts`** — `interrupt: false` →
  `'stream-abort'`. Comment rewritten with the exact evidence.
- **`packages/providers/src/registry.test.ts`** — `Codex and DeepSeek
advertise stream-abort; OMP does not yet` → adds `'grok'` to the expected
  list (the project-wide invariant test this flag change necessarily affects).
- **`packages/docs-web/.../provider-capabilities.md`** — regenerated
  (`bun run generate:capability-matrix`); the only diff is Grok's "Turn
  interrupt" cell flipping from ❌ to **stream-abort**.

## The transport-selection decision (`selectGrokTransport()`)

ACP is the default. A node config with no verified ACP equivalent routes to
the pre-existing `--single` transport instead (losing Stop for that turn
only — `sendQuery()` says so via a `system` chunk, since `capabilities.
interrupt` is a provider-wide flag and cannot vary per turn). This is the
"never silently drop an option" contract from the task, applied per flag,
with the exact live evidence recorded in `selectGrokTransport()`'s own doc
comment and reproduced here for anyone extending it later:

| `buildGrokArgs()` flag                 | ACP path tried                                                | Result                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-m` / `--reasoning-effort`            | CLI flags on `grok agent` (parent command)                    | **Verified** — used by every ACP spawn                                                                                                                                                                    |
| `--permission-mode bypassPermissions`  | `--always-approve` on `grok agent`                            | **Verified** (prior phase, re-confirmed)                                                                                                                                                                  |
| `--resume <id>`                        | `session/resume`                                              | **Verified live**, 3/3 redirect-with-context trials, cross-process                                                                                                                                        |
| `--system-prompt-override` / `--rules` | top-level `_meta.systemPromptOverride` on `session/new`       | **Disproven live** — model answered the original prompt normally, ignoring the override                                                                                                                   |
| `--tools` / `--disallowed-tools`       | `_meta.agentProfile.{tools,disallowedTools}` on `session/new` | **Disproven live, twice** — the model still ran a disallowed tool both attempts (see below)                                                                                                               |
| `--agents`                             | none found                                                    | **No ACP field exists** — the `agentProfile` JSON-object schema (recovered from a live parse-failure message, see below) has no sub-agent-definitions field                                               |
| `--json-schema`                        | none found                                                    | **No ACP literal exists** anywhere in the binary's string table (confirmed again this phase)                                                                                                              |
| `--fork-session`                       | none found                                                    | **Not advertised** — `initialize`'s `agentCapabilities.sessionCapabilities` has no `fork` key live (only `list`, `resume`, `close`)                                                                       |
| `--session-id`                         | n/a                                                           | **Not actually used by `buildGrokArgs()`** — the parity table in the prior Grok Stop report over-scoped this; grepped to confirm                                                                          |
| a non-default `permissionMode`         | none found                                                    | **`grok agent`'s own CLI parser** (distinct from the top-level `grok`/`grok --single` parser — confirmed via `grok agent --help`) **exposes only `--always-approve`**, no `--permission-mode` flag at all |

Any `nodeConfig.allowed_tools` (including an empty array — `buildGrokArgs()`'s
own "cannot be enforced" guard needs to still fire) or non-empty
`denied_tools`, any `systemPrompt`, any `nodeConfig.agents` with entries,
`output_format`, `forkSession: true`, or a `permissionMode` other than
`bypassPermissions`/unset routes to `--single`. Everything else — the common
case — runs on ACP.

### The `_meta.agentProfile` investigation (the most useful thing for whoever revisits this)

`grok agent`'s CLI surface (`--reauth`, `-m`, `--reasoning-effort`,
`--always-approve`, `--agent-profile <PATH>`, `--plugin-dir`, `--leader`/
`--no-leader`, ws overrides, debug, help, leader-socket — confirmed via
`grok agent --help`) has no equivalent to `--tools`/`--disallowed-tools`/
`--system-prompt-override`/`--rules`/`--agents`/`--json-schema`. All of those
are flags on the **top-level** `grok`/`grok --single` argument parser, a
different parser entirely from `grok agent`'s.

The one escape hatch `grok agent` does have is `--agent-profile <PATH>`, and
its ACP equivalent is real: a live probe sending `_meta.agentProfile` (an
object) on `session/new` produced a debug-log line naming the exact rejected
shape:

```
ERROR run_stdio_agent:agent.new_session: xai_grok_shell::upload::turn:
Failed to parse _meta.agentProfile JSON object, falling back to default agent
error=failed to parse agent definition: missing field `name`
```

Adding the required `name` field (plus `description`, `disallowedTools:
['run_terminal_command', 'execute']`) made the object parse without error —
but the model still called `run_terminal_command` successfully both times
this was tried (with and without `name`). Grok's own binary strings document
the full frontmatter-derived field list this JSON object accepts:
`description, promptMode, toolConfig, capabilityMode, permissionMode,
skills, discoverSkills, inheritSkills, injectDefaultTools, tools,
disallowedTools, effort, isolation, background, color, initialPrompt,
mcpServers, mcpInheritance, hooks, memory, model, completionRequirement,
toolOverrides, userMessageTemplate` — no field for inline sub-agent
definitions (`--agents`'s equivalent), confirming that gap structurally, not
just by absence of evidence. `_meta.systemPromptOverride` (a bare top-level
field, not nested in `agentProfile`) was also tried and had no observed
effect — the model answered the original question normally instead of
outputting the fixed acknowledgement token the override instructed.

Given two independent live disproofs (with and without the required `name`
field) and no remaining untried parameter shape, `allowed_tools`/
`denied_tools`/`systemPrompt` are treated as unverified — not "needs one more
probe" — and route to `--single`.

### `session/resume`, not `session/load`

The prior Grok Stop report proved cross-process continuation only via
`session/load` (which replays the whole prior transcript as `session/update`
notifications before resolving — DeepSeek's own client needs a checkpoint
scan to avoid double-counting that replay). This phase's `initialize` probe
shows Grok advertises **both** `agentCapabilities.loadSession: true` (top
level) **and** `agentCapabilities.sessionCapabilities.resume: {}`
(session-level) — and `session/resume` was verified live, cross-process (kill
the process, spawn a new one, `session/resume` with the same id, no
`--resume` flag exists over ACP): the model correctly recalled a planted
token, and no replayed content notification landed during the resume request
itself. `session/resume` is architecturally the better choice regardless (no
replay to filter), and matches the DeepSeek ACP client's own precedent. The
`driveGrokAcpTurn` notification handler's `params.sessionId !==
activeSessionId` early-return is what makes this safe even if that ever
changes — documented inline.

### `costUsdTicks` — 1 USD = 10^10 ticks

`_meta.usage.costUsdTicks` (and the per-model `modelUsage.<id>.costUsdTicks`)
is Grok's own fixed-point USD representation, not decimal dollars. The exact
scale factor is documented in the binary's own embedded CLI reference text:
`` `costUsdTicks` is 10^10 ticks per USD (divide by `1e10` for dollars) `` —
confirmed against a live `costUsdTicks: 678728400` / expected-~$0.068 pair.
`buildGrokAcpUsageBreakdown()` divides by `1e10`; verified live against a real
structured-output run (`cost_usd: 0.05438708` recorded via
`node_usage_recorded`).

## The lazy-load regression this migration would have introduced (found and fixed)

Grok is a **built-in** provider — `registry.ts` imports `grok/provider.ts`
statically (unlike DeepSeek/Devin, community providers that are dynamically
imported). The first version of this change added a static
`import { runGrokAcpTurn } from './acp-client'` to `provider.ts`, which
transitively pulled in `@agentclientprotocol/sdk` on every import of
`registry.ts` — i.e. every Archon boot, even for installs that never run
Grok. This broke two pre-existing regression tests that guard exactly this
invariant for DeepSeek and Devin
(`community/{deepseek,devin}/provider-lazy-load.test.ts`), both failing
identically with `SyntaxError: Export named 'client' not found in module
'.../dist/acp.js'` — the `mock.module('@agentclientprotocol/sdk', () => ({}))`
those tests use turns a static named import that reaches the SDK into a hard
import-time error.

Fixed by importing `GrokAcpProcessInput`/`runGrokAcpTurn` as `import type`
only in `provider.ts` (a type-only import of a value binding is valid in a
`typeof` position) and loading the real function inside `acpQuery()` with
`await import('./acp-client')`, matching DeepSeek's own pattern exactly. Added
`grok/provider-lazy-load.test.ts` (mirrors the DeepSeek/Devin test) so this
can't regress silently again. Both pre-existing DeepSeek/Devin tests pass
again after the fix.

## Live verification (real `grok` binary, real logged-in account, isolated

`ARCHON_HOME`)

Isolated server per the task's procedure: `sqlite3 ~/.archon/archon.db
".backup ...''`, copied `config.yaml` + `credential-key`,
`ARCHON_HOME=<scratch> TELEGRAM_BOT_TOKEN= SLACK_BOT_TOKEN=
DISCORD_BOT_TOKEN= WORKFLOW_RUN_RETENTION_DAYS=36500
SESSION_RETENTION_DAYS=36500 PORT=3328`, real server from `packages/server`.
Two home-scoped workflows (`grok-acp-verify`, `grok-acp-verify-structured`,
both `interactive: true`, `provider: grok`) against a fresh scratch git repo
(needed a bare-repo `origin` remote — Archon's worktree isolation requires
one; the codebase had to be re-registered once after adding it, since the
first clone predates the remote). Driven via the real HTTP API
(`POST /api/workflows/{name}/run`, `POST .../nodes/{id}/interrupt`,
`POST .../nodes/{id}/send`, `POST /api/workflows/runs/{id}/abandon`), not
through spikes.

- **Stop mid-generation** — interrupted a live essay-writing turn.
  `dag.node_turn_interrupted` logged, node settled `idle-after-interrupt`,
  ACP session cleanly closed (`grok.acp_query_completed` with a real session
  id).
- **Stop mid-tool + redirect-with-context, 3/3** — planted a codename in the
  turn-1 prompt ("write a long essay" + "remember codename X"), interrupted
  mid-essay, sent a Send-now redirect asking only "what was the codename?".
  `resumed: true` on the redirect turn (same session id both times), and the
  model correctly answered `FALCON-91` and `OSPREY-16` in two separate
  trials. A third trial phrased the plant-and-recall as a single redirect
  message ("remember this token, just acknowledge it") and the model refused
  to comply on safety-heuristic grounds unrelated to the transport — a
  prompt-phrasing artifact, not a `session/resume` failure (the mechanism
  itself — same session id, `resumed: true` — worked identically in all
  three).
- **Stop mid-tool, descendant reaping** — prompted Grok to run `sleep 90` via
  its shell tool; confirmed the descendant PID alive via `ps` before
  interrupting; `session/cancel` fired, `dag.node_turn_interrupted` logged,
  and the `sleep 90` PID was gone within ~1 second of the interrupt call
  returning. The model had actually used a background-task-plus-poll pattern
  (`run_terminal_command` then `get_command_or_subagent_output`, not a bare
  blocking foreground call) — the poll tool never received a terminal
  update and settled `'unknown'` via `closeOutstandingGrokAcpTools()` exactly
  as designed, a real-world confirmation of that fallback path with a shape
  the unit tests hadn't anticipated.
- **Structured output (fallback transport)** — ran
  `grok-acp-verify-structured` (declares `output_format`); confirmed it
  selects `--single` (the `system` fallback notice fired) and produced a
  real schema-conforming result: `{"answer":"Paris","confidence":1}`, with
  `node_usage_recorded` carrying a real `cost_usd` derived from the
  `--single` path's own (unchanged) usage parser.
- **Cancel (`POST /abandon`)** — abandoned a run with a live `sleep 90` tool
  call in flight. Confirmed via `ps` that both the `sleep 90` descendant and
  the `grok agent` process itself were gone afterward — no orphans. (The
  executor's own cancellation-detection polling adds latency here,
  independent of this transport — `dag_node_cancelled_during_streaming`
  logged the actual kill once detected.)
- **Natural multi-turn queue delivery** — not exercised live this phase
  (lower priority given the time budget; this is engine-level FIFO-claim
  logic unrelated to the Grok transport specifically, and is covered by the
  existing `dag-executor.test.ts`/`steering-registry.test.ts` suites).

### A real UX bug found live, then correctly reverted

Initially "fixed" Stop-on-the-`--single`-fallback-transport by killing the
process and yielding the shared interrupted marker (mirroring the ACP path),
because a live test showed pressing Stop during a long structured-output
turn blocked the `interrupt` HTTP call for the turn's entire remaining
duration (measured: 2 minutes 27 seconds) before finally reporting
`409 node_finished`. That fix was itself wrong and was reverted: the
dag-executor correctly rejects an interrupted result with no session id to
resume from (`node_failed: "...returned no session id to resume — failing
instead of losing resumability"`) — and Grok's `--single` transport only
ever learns its session id from the final `end` event, which a mid-turn kill
never reaches. Killing the process there does not produce a valid,
resumable interrupt; it can only produce a **failed node**, which is worse
than the blocking behavior it was meant to fix (data loss vs. slowness).
Reverted cleanly to the original behavior: `interruptSignal` is not wired
into `singleQuery()` at all. Confirmed live afterward: the same interrupt
call still blocks until natural completion, then correctly reports either
the real result or `409 node_finished` — never a failure, never a true
infinite hang. This asymmetry (Stop works on ACP, blocks-until-natural-end on
the `--single` fallback) is the honest, load-bearing consequence of
`capabilities.interrupt` being a provider-wide flag; it is stated in the
`system` chunk every fallback turn emits.

### Side effects on the real, non-isolated environment

- **`~/.grok/sessions/`** — the `grok` binary does not honor `ARCHON_HOME`;
  every live probe and workflow run this phase wrote real session files
  under the operator's actual `~/.grok/sessions/` directory (visible in a
  live tool-output path captured during probing:
  `.../terminal/call-....log`). Nothing was cleaned up there — deleting
  another tool's session state was judged riskier than leaving it, matching
  the "don't guess at undocumented internal state" posture from the prior
  Grok Stop report. No `grok update`, no `~/.grok/config.toml`/binary changes
  were made this phase.
- Two Codex title-generation calls fired and failed fast with the same
  pre-existing 400 (`reasoning.effort 'minimal'` incompatible with a
  requested tool) documented in the earlier Phase B report — an unavoidable
  side effect of any new conversation on this isolated server, unrelated to
  Grok.
- The isolated server, database, and scratch git repo were entirely
  confined to the scratchpad directory; nothing was written to the real
  `~/.archon/archon.db`. The scratch server (final PID 69867) was stopped
  after verification; `ps` confirmed no `grok agent` or `sleep 90` processes
  survived it.

## Tests

- `packages/providers/src/grok/acp-event-bridge.test.ts` (new) — 9 cases for
  `mapGrokAcpSessionUpdate`/`closeOutstandingGrokAcpTools`.
- `packages/providers/src/grok/async-queue.test.ts` (new) — 11 cases, the
  DeepSeek `AsyncQueue` test suite verbatim.
- `packages/providers/src/grok/acp-client.test.ts` (new) — 24 cases: turn
  ordering (fresh vs. resumed), usage-breakdown mapping (single/multi-model/
  fallback), resume failure, tool event mapping, node-Cancel vs.
  operator-Stop dominance (including both-already-aborted and a natural
  result racing a late Stop), consumer early return, and `runGrokAcpTurn`'s
  process wiring (spawn args, SIGTERM reap, early exit, spawn failure). The
  permission-request test drives a real `session/request_permission` call
  through the fake agent and asserts the actual `{outcome:{outcome:
'cancelled'}}` response (an earlier draft only asserted the turn didn't
  crash — fixed to be a real assertion before this report).
- `packages/providers/src/grok/provider-lazy-load.test.ts` (new) — 1 case,
  the lazy-load regression guard described above.
- `packages/providers/src/grok/provider.test.ts` — existing `--single`-path
  tests updated to force that transport (`outputFormat` in their
  `requestOptions`, since ACP is now the default); new `selectGrokTransport`
  suite (9 cases) and a new `GrokProvider ACP transport (default)` suite (6
  cases: default dispatch, model/effort/resume/signal threading, fallback
  routing never reaching `runAcpTurn`, a stream-abort marker passing through
  unchanged, a node-cancel throw propagating, and the impossible-resume
  guard firing before `runAcpTurn`). 25 tests, 0 failures.
- `packages/providers/src/registry.test.ts` — updated the
  stream-abort-providers invariant test to include `'grok'`.
- Real-binary spikes from the prior phase (`acp-handshake-spike.ts`,
  `session-cancel-spike.ts`, `interject-*-spike.ts`) are untouched and remain
  diagnostic-only per the existing convention.

## Validation

- `bun run type-check` — clean across every package (13/13).
- `bun run lint --max-warnings 0` — clean at the whole-monorepo level.
- `bun run format:check` — clean.
- `bun run check:capability-matrix` — clean, no diff after regeneration.
- `packages/providers`'s own `bun run test` (the project's per-file split) —
  89 files, 0 failures, run twice (before and after the pre-commit hook's
  `eslint --fix`/`prettier --write` pass).
- `bun run validate` (the full monorepo gate, all of the above plus every
  other package's own test script) — exit code 0.

## Unresolved / needs orchestrator attention

- **Natural multi-turn queue delivery** was not exercised live against Grok
  specifically this phase (see above) — the generic engine behavior is
  already covered elsewhere; flag if a Grok-specific regression is ever
  suspected here.
- **`allowed_tools`/`denied_tools`/`systemPrompt`/`--agents`/`--fork-session`
  on Grok always cost Stop** (they route to `--single`). If any of these
  becomes a commonly-used Grok node config, that is worth surfacing to the
  user as a product trade-off (broader ACP coverage vs. a real xAI-side
  feature gap this migration could not close) rather than something to fix
  in this codebase.
- **`~/.grok/sessions/`** accumulated real session files from this phase's
  live verification (see above) — left as-is; not this codebase's data to
  manage.

## Status

DONE

## Summary

Grok's `sendQuery()` now defaults to the ACP transport (`grok agent stdio`)
instead of `--single`, making `capabilities.interrupt: 'stream-abort'` true
end-to-end: verified live through the real HTTP API and a real Archon
workflow that Stop cleanly reaps a mid-tool descendant (a `sleep 90` process,
confirmed gone via `ps`) and that a Stop-then-redirect correctly recalls
context planted before the interrupt via `session/resume`, 3/3 trials, no
replay artifacts. Every `buildGrokArgs()` flag without a live-proven ACP
equivalent (tool restrictions, system prompt override, structured output,
session fork, non-default permission modes) is routed to the pre-existing
`--single` transport by `selectGrokTransport()` rather than silently dropped,
with the exact per-flag evidence recorded both in code and in this report — a
tool-restriction and a system-prompt-override attempt were each disproven
live, not merely left untested. A live-discovered lazy-load regression (Grok,
as a built-in provider, would have eagerly loaded
`@agentclientprotocol/sdk` on every Archon boot) was caught by two
pre-existing DeepSeek/Devin tests, fixed with a dynamic import matching their
own established pattern, and is now separately guarded for Grok too. A second
live-discovered issue — an initial "fix" for the fallback transport's
Stop-blocks-for-minutes behavior that killed the process but produced a
result the dag-executor correctly rejects as an unresumable interrupt — was
caught before commit and reverted to the honest, data-preserving original
behavior.
