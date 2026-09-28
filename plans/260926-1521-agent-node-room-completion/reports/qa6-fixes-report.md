# Round-6 visual QA fixes — Agent Node Room

Date: 2026-09-28 (Asia/Saigon). Base checkout: `develop-2`. Worktree:
`/Users/dale/orca/Archon/.claude/worktrees/agent-ae4aaa77e98f86832`, branch
`worktree-agent-ae4aaa77e98f86832`.

Fixes the five findings in
`plans/260926-1521-agent-node-room-completion/reports/visual-qa-6-report.md`:
VQ6-1 (major), VQ6-2 (minor), VQ6-3 (minor), VQ6-4 (cosmetic), VQ6-5
(cosmetic), plus the two coordinator extras (loop-node abandon coverage,
`unknown` file-attribution coverage).

## VQ6-1 — tool call id collision across turns (major)

**Root cause.** Codex restarts its own item numbering (`item_1`, `item_2`,
…) on every `thread.runStreamed()` call — a fresh JSON-RPC turn, not a fresh
subprocess or thread. A Stop + redirect (or a cold subprocess retry) issues a
new call to `runStreamed()`, so the same raw id can name a genuinely
different tool call on a later turn of the same node execution. The web
pairing correlated call/result rows strictly by that id (plus
occurrence/attempt, which do not change across a redirect — a steered node
is one execution with several provider turns on one live session), so an
earlier turn's interrupted call could claim a later turn's result: an
interrupted command read `✓ succeeded`, and the command that actually
succeeded read `◐ running` forever (both live and after reload, since the
transcript rows are what a reload re-fetches).

**Fix — two layers, both required (the decision note explicitly asked for
"generally," not Codex-only).**

1. `packages/providers/src/codex/provider.ts` — `streamCodexEvents` now
   takes an injectable `turnId` (default `randomUUID()`, mirroring the
   existing `createDeepseekEventState`/`createGrokAcpEventState` per-call
   nonce pattern already used for DeepSeek/Grok text block ids). Every
   emitted tool id is scoped through a new `scopedItemId(turnId, rawId)`
   helper: `codex-<turnId>:<rawId>` (the file-change compound id
   `${item.id}:${index}` now composes on top of the already-scoped id, so it
   inherits the same turn scope). A fresh nonce is minted once per call, so
   every turn of a node execution — and every cold subprocess retry — gets
   its own namespace; ids stay globally unique, not merely unique within one
   node execution.
2. `packages/web/src/lib/pair-tool-transcript.ts` — the correlation
   algorithm no longer does a whole-transcript FIFO bucket match. A single
   seq-ordered pass tracks at most one "open" call per correlation key: a
   result closes the currently open call for its key, and a **later call
   under the same key supersedes whatever call was still open there** —
   that older call never got its own result (most commonly because its turn
   was cut off), so it renders permanently pending instead of stealing a
   different call's outcome. This repairs rows a pre-fix build already
   persisted too: no id uniqueness is assumed, only that a call and its true
   result are temporally adjacent relative to any other call sharing its
   key.
3. `packages/web/src/lib/agent-history.ts` — `toolStartedAtMs` /
   `toolRuntime` / `pendingToolOutcome` used to require exactly one matching
   `workflow_events` row and gave up (no duration, `unknown`/`running`
   fallback) on any ambiguity. A reused raw id — pre-fix persisted data, or
   any future provider with the same class of bug — produces two events
   sharing one `tool_call_id`. These three functions now take an `ordinal`
   (0-indexed, in event order): `buildAgentHistory` counts how many earlier
   tool cards share the same resolved `toolUseId` and passes that count, so
   each card resolves to its own matching event by occurrence order instead
   of refusing as ambiguous. Verified stable order: `workflow-events.ts`'s
   read query is `ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id
ASC` — insertion-stable even for same-timestamp events.

**Provider audit (the finding's "audit ALL providers" requirement).**

| Provider        | Id source                                                                                                             | Per-turn reset risk                                                                                                    | `file:line`                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Claude          | SDK-issued `tool_use_id` (`toolu_…`), globally unique per call                                                        | None — API-issued                                                                                                      | `packages/providers/src/claude/provider.ts:1014,1025`           |
| Codex           | Own subprocess item counter, **restarts every `runStreamed()` call**                                                  | **Yes — fixed above**                                                                                                  | `packages/providers/src/codex/provider.ts:661,725`              |
| DeepSeek        | ACP `update.toolCallId` from a persistent CLI session; text ids already turn-scoped via `createDeepseekEventState`    | None — session-sourced                                                                                                 | `packages/providers/src/community/deepseek/event-bridge.ts:131` |
| Grok ACP        | Same pattern as DeepSeek                                                                                              | None                                                                                                                   | `packages/providers/src/grok/acp-event-bridge.ts:160`           |
| Grok `--single` | `event.toolCallId` from the CLI's own JSON stream                                                                     | N/A — this transport has no Stop, so a node execution never spans more than one turn (confirmed live, see VQ6-2 below) | `packages/providers/src/grok/event-parser.ts:318`               |
| OMP             | ACP-style `event.toolCallId` over a persistent warm RPC session (spans the whole node execution, including redirects) | None — session-sourced                                                                                                 | `packages/providers/src/community/omp/event-parser.ts:390`      |
| Devin           | ACP `update.toolCallId`                                                                                               | None                                                                                                                   | `packages/providers/src/community/devin/event-bridge.ts:108`    |
| Copilot         | `event.data.toolCallId` from its own event stream                                                                     | None — not tested live this round, but sourced identically to the ACP providers                                        | `packages/providers/src/community/copilot/event-bridge.ts:278`  |
| Pi              | `event.toolCallId`                                                                                                    | None                                                                                                                   | `packages/providers/src/community/pi/event-bridge.ts:317`       |
| OpenCode        | `${state.agent.key}:${rawCallId}` — already turn-agnostic scoping by agent                                            | None (already scoped)                                                                                                  | `packages/providers/src/community/opencode/multi-agent.ts:271`  |
| Qoder CLI       | N/A — this provider never yields `type: 'tool'` chunks; Archon has no per-tool visibility into it                     | N/A                                                                                                                    | `packages/providers/src/community/qodercli/provider.ts`         |

Only Codex resets its own numbering per turn; every ACP/RPC-backed provider
sources ids from a session that persists across the whole node execution.
**Unresolved (see below): `e2e-fake`'s synthetic provider has the same class
of bug** (`e2e-fake-tool-${sessionId}` — a fixed string per resumed
session), deliberately left alone this round — see "Unresolved questions."

**Tests.**

- `packages/providers/src/codex/provider.test.ts` — ~20 exact-string
  `toolCallId` assertions updated to `expect.stringMatching(/^codex-[^:]+:…$/)`
  (the turn nonce is random per call by design, so exact-string assertions
  can't survive the fix); logger-call assertions for `itemId` updated the
  same way. One new-format assertion (`endsWith(':t1')`) replaces an
  exact-match on the mid-tool-interrupt test.
- `packages/web/src/lib/pair-tool-transcript.test.ts` — new case: a call
  whose turn was cut off (no result row) never steals a later turn's result
  when both share the same raw id; the later turn's own call pairs with its
  own result.
- `packages/web/src/lib/agent-history.test.ts` — `toolRuntime`'s ambiguous-id
  test rewritten to prove ordinal selection (`ordinal 0` → the first
  matching event, `ordinal 1` → the second, `ordinal 2` past the end → still
  honestly `null`); a duplicate single-card `tool_called` scenario now
  resolves by ordinal instead of refusing; new end-to-end
  `buildAgentHistory` case reproduces the exact reported scenario (turn 1
  interrupted call with only a settle event, turn 2 reusing the raw id with
  its own transcript result) and asserts each card gets its own outcome
  _and_ duration.

**Live verification (real Codex, isolated server, both shells, before and
after reload).** See "Real-provider verification" below for the full
methodology; summary here:

- Run `968…`-class scenario reproduced fresh (`codex-steer` workflow, 5
  busy-wait bash steps): Stop mid-step-4 in Console, typed redirect from
  Legacy (`CX-REDIRECT reply with the word ACK then stop`). Steps 1–3 read
  `✓ … exit 0 · 24.9s`; the interrupted step 4 reads `– … output unknown ·
17.8s` — **never** a false `✓` — in both shells, live and after reload
  (`app-console-codex-a-after-reload.png`, `app-legacy-codex-a-after-reload.png`).
- A second run isolated the exact collision mechanism: Legacy stops
  mid-tool, Console redirects with a prompt that forces a **new** tool call.
  The DB proves the collision the fix defeats —
  `sqlite3 … "SELECT payload FROM remote_agent_workflow_node_messages WHERE
workflow_run_id='eb883c9…' AND kind='tool'"` returns
  `codex-9e17dd8e-…:item_0` for the interrupted turn-1 call and
  `codex-72b5f8ec-…:item_0` for the redirected turn-2 call — the **same raw
  `item_0`**, scoped to two **different** turn nonces. The UI reads turn 1's
  call as `– output unknown` (never stolen) and turn 2's as `✓ exit 0 · 1ms`
  (its own result, never withheld) — `app-console-codex-c-final.png`,
  `app-legacy-codex-c-final.png`.

## VQ6-2 — abandoned structured-output node leaves its open tool running (minor)

**Root cause.** `dag-executor.ts`'s `dag_node_cancelled_via_abort` catch
branch (the path a node reaches when its provider pass **throws** instead of
yielding a terminal `result` chunk — the only way a structured-output node's
stream can end on Abandon, since the missing-structured-output guard throws
regardless of why the stream closed) recorded the node as failed but never
wrote a `node_failed` event and never settled any tool still open in the
executor's `runningTools` map. Every other provider's Abandon ends via a
clean terminal `result` chunk (the in-stream settle already covers it,
before this branch is ever reached) — Grok `--single` was the one the
original report caught because grammar-constrained JSON output makes the
missing-output throw deterministic on cancel, but the report's own note
("likely affects any node that throws on abort") was right: the loop node's
equivalent paths had the identical gap.

**Fix.**

- `packages/workflows/src/dag-executor.ts`:
  - The prompt/command-node `dag_node_cancelled_via_abort` catch branch now
    settles every still-open tool to `'unknown'` and emits + persists
    `node_failed` before returning — mirroring the sibling (generic-error)
    branch immediately below it.
  - `finishCancelled` (the **graceful** cancel path most providers already
    take) gained the same settle call as a defensive no-op-safe safety net —
    idempotent, since `settleRunningToolsOutcome` deletes each entry it
    resolves.
  - The loop node's graceful "cancelled mid-stream" branch (reached when the
    stream ends via `withIdleTimeout`'s external-abort race rather than a
    thrown error — the common case) and its per-attempt catch's plain-cancel
    fallback (reached when the provider's own throw races ahead of that
    external abort) both gained the identical settle call, mirroring the
    prompt-node fix for the loop's own code paths.

**Tests.** `packages/workflows/src/dag-executor.test.ts`:

- New case reproducing the exact reported mechanism precisely: an
  `output_format` node whose stream only ends via the external-abort race
  (never a natural `result` chunk, exactly like the mock harness's own
  "stays silent forever" pattern) — asserts one `node_failed` event **and**
  a `tool_completed` event with `tool_outcome: 'unknown'` for the still-open
  tool.
- New loop-node case: a loop iteration abandoned mid-tool asserts the same
  pair of events, plus that the node ends promptly (`< 8s` in the mock
  harness).
- Two more general "provider throws after abort" cases (one per node type)
  with an open tool call, proving the settle fires regardless of exactly
  which of the two now-fixed branches the throw lands in.

**Live verification.** Grok `--single` could not be forced to invoke any
tool at all in this environment across three prompt variants (see
"Unresolved questions"), so the exact reported combination (a structured-
output node's stream ending via a _throw_, landing in the
`dag_node_cancelled_via_abort` catch branch) was not reproduced live — it
is covered by the two unit tests above instead. The loop node's **graceful**
cancel path (the far more common exit: the stream ends via
`withIdleTimeout`'s external-abort race, a clean return with no terminal
`result` chunk, not a throw — the same commit's fix at the loop's
"Cancelled mid-stream" branch) was verified live with a real Claude
session:

- `qa6-claude-loop` workflow (a 3-max-iteration loop, one 25s busy-wait bash
  step per iteration), abandoned mid-tool via `POST
/api/workflows/runs/{id}/abandon` while the Bash tool was genuinely
  in-flight (confirmed via the transcript row before abandoning).
- `sqlite3 … "SELECT event_type, data FROM remote_agent_workflow_events
WHERE workflow_run_id='43c8426f…' AND event_type IN
('tool_completed','node_failed')"` returns both:
  `node_failed {"error":"Loop iteration 1 failed: Workflow cancelled", …}`
  and `tool_completed {"tool_name":"Bash","duration_ms":15428,"tool_call_id":
"toolu_01WTx…","tool_outcome":"unknown"}`.
- UI (Legacy, `app-legacy-claude-loop-abandoned.png`): `Failed` pill, tool
  row reads `– … output unknown · 15.4s` — never `◐ running`.

## VQ6-3 — Legacy hides a durable queued item during the abandon window (minor)

**Root cause.** Legacy learned a node was terminal only from the parent's 3s
run-detail poll (`nodeTerminal` prop). Legacy's own queue poll (~1s) can
report `execution_state: 'finished'` and reconcile a queued item to
`never_sent` first. Between the two: `steeringDockMode`'s first branch
(`(nodeTerminal === true || !live) && neverSent.length > 0` → `'finished'`)
never fires because `nodeTerminal` is still stale, so the item — now sitting
in `dock.neverSent`, not `dock.sent` — falls out of the composer-mode
render entirely for up to ~1.8s.

**Fix.** `packages/web/src/components/workflows/ComposerDock.tsx` folds the
dock's own `dock.executionState === 'finished'` signal into an
`effectiveNodeTerminal` local, used everywhere the raw `nodeTerminal` prop
previously drove the terminal decision: the `steeringDockMode` call and the
one-shot authoritative queue refetch trigger. Legacy now learns "terminal"
from whichever of its two channels reports it first, closing the gap
between "the item left the live list" and "the terminal band has a reason
to show it."

**Tests.** New `ComposerDock.test.tsx` case feeding the exact intermediate
snapshot sequence an Abandon produces (live queued item → reconciled to
`never_sent` with `execution_state: 'finished'`, `nodeTerminal`/`rowStatus`
still stale → a later render with both finally caught up) — asserts the
item is present at every step. Verified this test fails without the fix
(reverted the one-line change, reran — failed with an empty band at the
middle step; restored, reran — passed) before finalizing it as a regression
test.

## VQ6-4 — room pill height and Legacy border (cosmetic)

**Root cause.** (a) The round-6 report measured the app pill's line-height
at 15px (21px total height) against an inherited cascade — `text-[10px]`
itself sets only `font-size` (confirmed against the built CSS: Tailwind v4's
pure bracket arbitrary value pairs no line-height), so the 15px came from
further up the cascade, not from that utility directly. The mockup's own
pill markup sets no line-height at all, so the browser's own default for
its font wins there (measured 18px). (b) Legacy's border used
`color-mix(in oklch, <bright accent> 40%, transparent)` — an alpha-blend
over whatever surface sits behind it; the mockup's Legacy pill uses flat,
unmixed per-tone literals (`RUNNING.pillBorder`,
`finishedUndelivered.pillBorder`, `failed.pillBorder` in `Legacy Node
Room.dc.html`) that render identically regardless of backdrop.

**Fix.** `packages/web/src/components/workflows/NodeRoomHeader.tsx` /
`.../console/components/inspect/ConsoleRoomHeader.tsx` — every pill tone's
`style` now sets `lineHeight: 'normal'` (both shells). Legacy's `accent`
(running), `success`, and `error` tones use the mockup's own flat literals
(`oklch(0.4 0.12 250)`, `oklch(0.4 0.08 155)`, `oklch(0.4 0.12 25)`) instead
of the alpha-blend; `warning` is left untouched — see "Unresolved
questions."

**Tests.** `NodeRoomHeader.test.tsx` / `ConsoleRoomHeader.test.tsx` — new
assertions on the rendered `style` attribute for `line-height: normal`
(both shells) and Legacy's flat `border-color` for the running and failed
tones (happy-dom's CSSOM does not parse `oklch()`, so the border-color
assertion reads the serialized `style` attribute string, not the parsed
`CSSStyleDeclaration`, and only for Legacy, where a real value is asserted).

**Live verification (real browser, real run).** Legacy, `Failed` pill,
`getBoundingClientRect()` + `getComputedStyle()` in the same live server
session used for the loop-abandon check above:
`{"height":"18px","lineHeight":"normal","borderColor":"oklch(0.4 0.12
25)","fontSize":"10px","fontWeight":"700"}` — an exact match to the
mockup's own literal `pillBorder: 'oklch(0.4 0.12 25)'` for the `failed`
state and to the mockup's `18px` computed height (21px before the fix; happy-dom's own
unit tests could not have caught this, since jsdom-class environments
compute layout differently from a real browser — this is why the height
number was only ever verifiable live).

## VQ6-5 — no optimistic row for a fresh Send now (cosmetic)

**Root cause.** `beginSendNow` clears `sent: []` and moves the batch into
`inFlightBatch` for the request's duration. `resolveSendNowSuccess`'s
"generating" branch (a typed Send now while idle-after-interrupt) discarded
`inFlightBatch` without repopulating `sent`, so the band stayed empty from
the moment the POST resolved until the next queue poll (~1s) restored the
server's own `dispatching` row under the same message id.

**Fix.** `packages/web/src/lib/steering-dock.ts` — the "generating" branch
now sets `sent: state.inFlightBatch.map(entry => ({ ...entry, state:
'dispatching' }))`. `dispatching` already renders `sending…`
(`queueItemStatusLabel`) and is already excluded from claimable/withdrawable
states — this reuses the exact rendering path the server's own `dispatching`
row already takes. `applyQueueSnapshot` replaces `sent` **wholesale** by
server truth on the next poll (proven by an existing test,
`'replaces sent wholesale with the server-ordered receipts'`), so the
optimistic row is a placeholder that's overwritten, never duplicated
alongside the real one.

**Tests.** `packages/web/src/lib/steering-dock.test.ts` — the two existing
"discards the batch" tests updated to assert the optimistic `dispatching`
rows instead of an empty `sent` array (both a single-item and a two-item
batch, including the "retry" flow where the whole batch resends).
`ComposerDock.test.tsx` / `ConsoleComposerDock.test.tsx` — three existing
DOM-level tests that asserted `0 li` elements / no band text right after a
successful Send now updated to assert the `sending · N` band header and
`sending…` row text instead.

## Coordinator extras

- **Abandon on a loop node mid-tool.** Covered by the two new
  `dag-executor.test.ts` cases under VQ6-2 above (prompt-node and loop-node
  variants) plus the live Claude loop-abandon verification (same section).
  Both prove: node ends promptly, `node_failed` fires, the open tool
  settles, and (per the existing, unmodified `ComposerDock`/`steering-dock`
  contract already covered by `'a cancelled run shows the read-only band for
a still-queued item before the node reports terminal'`) a queued item on
  an abandoned node reaches `NEVER SENT`.
- **`unknown` file attribution in Files Changed.** Already covered on both
  shells before this round started —
  `packages/web/src/components/workflows/source-control/files-changed-tab.test.tsx:129`
  (`'shows unknown for a path with no proven execution'`) and
  `packages/web/src/experiments/console/components/FilesChangedPanel.test.tsx:83`
  (same test name). Re-ran both directly (`-t "unknown"`): 2 pass, 0 fail.
  No new test added — writing a duplicate would violate DRY against
  existing, currently-passing coverage of the exact condition
  (`describeFilesChangedExecutions`'s `executions.length === 0` branch in
  `packages/web/src/lib/files-changed.ts`, which itself already has a direct
  unit test).

## Real-provider verification — methodology

Isolated `ARCHON_HOME` under the session scratchpad (never
`scratchpad/archon-home`), DB copied via `sqlite3 …db ".backup …"`,
`config.yaml` + `credential-key` copied from `~/.archon`. Server on port
3343 (`ARCHON_HOME=… TELEGRAM_BOT_TOKEN= SLACK_BOT_TOKEN= DISCORD_BOT_TOKEN=
WORKFLOW_RUN_RETENTION_DAYS=36500 SESSION_RETENTION_DAYS=36500
CODEX_BIN_PATH=/Users/dale/.local/bin/codex PORT=3343 bun --watch
src/index.ts`), Vite dev server on 5211 (`PORT=3343 bunx vite --port 5211`,
proxying `/api` to 3343). A scratch git repo (working tree + a local bare
`origin.git`) was registered by absolute `path`. Every run was dispatched
over HTTP against the same server process
(`POST /api/codebases` → `POST /api/conversations` → `POST
/api/workflows/{name}/run`), matching the documented CLI-vs-HTTP process
boundary from the round-5 report.

**One real methodology issue worth recording for future rounds:**
`resolveCodexBinaryPath` returns `undefined` in dev mode when no
`CODEX_BIN_PATH`/`config.yaml` override is set, so the Codex SDK falls back
to its own vendored binary under `node_modules/.bun/@openai+codex@…`. That
vendored binary is real and runs standalone, but every spawn of it through
the SDK inside this server process failed immediately with `Codex Exec
exited with code 1: Error: No such file or directory (os error 2)` — not a
credentials or auth problem (the same binary, same cwd, same `--cd` flag,
same model/effort config all succeeded when spawned directly, including via
`bun -e` with `child_process.spawn` and the identical `env: process.env`).
Setting `CODEX_BIN_PATH` to the machine's own globally-installed Codex CLI
(`/Users/dale/.local/bin/codex`, a newer version) resolved it completely —
every Codex run in this report used that binary. The root cause of the
vendored-binary spawn failure was not further isolated (out of scope for
this round; it reproduced identically across three server restarts, so it
is not a transient issue).

A second methodology note: the workflow YAML `description` field is
**required** for `/workflow run` (a load-time validation error, not
logged as an error-level line — only visible in the conversation's stored
assistant message) — the three scratch workflow files needed it added
before any of them would run.

## Automated

- `bun run validate` — green after each of the four commits (the three fix
  commits plus the doc-comment correction below).
- Full `packages/workflows`, `packages/providers`, and `packages/web` test
  suites — 0 fail, run individually in addition to `bun run validate`'s own
  invocation.
- Full e2e UI suite (`cd e2e && bun run test:ui`, `web dist` rebuilt first —
  the suite requires a static build, not the dev server) — **154 passed, 4
  skipped, 0 failed** on the confirming run. The first run hit exactly one
  failure: `agent-queue-guidance.spec.ts`'s `route-smoke` test expected 409
  `recovery_required` for a CLI-detached run and got 422
  `not_steerable_here`. Traced before accepting it: the durable
  `upsertSteeringNodeSettings` write that stamps a node as steerable
  (`packages/workflows/src/dag-executor.ts:3569`, unmodified by any commit in
  this report — `git diff develop-2..HEAD` on that file touches only the
  cancel/abort branches under VQ6-2) is fire-and-forget, and the test's
  `waitForNodeStarted` polls the `node_started` event, which can fire before
  that unawaited write commits — a pre-existing race between two independent
  async paths, not a regression. Confirmed three ways before moving on: (1)
  the isolated test passed on retry (30.8s, no code change), (2) the full
  suite's second full run passed it cleanly in the same position, (3) a
  `git diff` on the exact code path the test depends on shows zero changes
  from any commit in this report. The 4 skipped tests are identical across
  both runs and are pre-existing conditional `test.skip()` gates
  (`workflow-env-overlay.spec.ts:156`, `workflow-run-hitl.spec.ts:229`),
  unrelated to this work.

## Files changed

**VQ6-2** (commit `e6d9a6ad`): `packages/workflows/src/dag-executor.ts`
(+test).

**VQ6-1** (commit `1a90eeaf`): `packages/providers/src/codex/provider.ts`
(+test), `packages/web/src/lib/pair-tool-transcript.ts` (+test),
`packages/web/src/lib/agent-history.ts` (+test).

**VQ6-3 / VQ6-4 / VQ6-5** (commit `167fe0d2`):
`packages/web/src/components/workflows/ComposerDock.tsx` (+test),
`packages/web/src/components/workflows/NodeRoomHeader.tsx` (+test),
`packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx`
(+test), `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx`,
`packages/web/src/lib/steering-dock.ts` (+test).

**Doc-comment correction** (commit `8e7814bf`):
`packages/web/src/components/workflows/NodeRoomHeader.tsx` (+test),
`packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx`
(+test), `packages/workflows/src/dag-executor.ts` — no behavior change.
Self-caught during this report's own write-up: the VQ6-4 pill comment
claimed `text-[10px]` pairs a Tailwind default line-height, which the built
CSS disproves (it sets only `font-size`); the comment now states only the
verified fact (measured 18px vs. 21px) without asserting the wrong
mechanism. Also clarifies the VQ6-2 safety-net comment's wording.

**Evidence + report** (this commit): `plans/260926-1521-agent-node-room-completion/evidence/qa6-fixes/*`,
`plans/260926-1521-agent-node-room-completion/reports/qa6-fixes-report.md`.

## Unresolved questions

1. **VQ6-4 `warning` tone.** The Legacy mockup's `RECOVERY` state defines no
   `pillBorder` override, so its rendered border falls to the same default
   `oklch(0.4 0.12 250)` the `RUNNING` state uses — a blue-hued border under
   an amber pill, per the mockup's own fallback expression
   (`s.pillBorder ?? 'oklch(0.4 0.12 250)'`). This felt too surprising to
   apply on inference alone; `warning` was left on `color-mix` rather than
   guess. If the coordinator confirms the fallback is intentional (not a
   mockup oversight), applying it is a one-line follow-up.
2. **Inline `oklch()` literals in `NodeRoomHeader.tsx`.** AGENTS.md's brand
   guidance prefers design tokens over ad-hoc values. `grep`ping
   `packages/web/src/index.css` for `0.4 0.12 250` / `0.4 0.08 155` / `0.4
0.12 25` found no existing token for any of the three — the mockup
   itself authors them as inline literals, not CSS custom properties, so
   there is no existing token to reuse. Tokenizing them (e.g.
   `--pill-border-running`) is a reasonable follow-up but was not done here
   to keep the fix minimal and exactly traceable to the mockup's own
   values.
3. **`e2e-fake-tool-${sessionId}`.** The synthetic e2e-fake provider builds
   its tool ids from the (possibly resumed) session id, not a per-turn
   nonce — the same class of VQ6-1 bug, reproducible in principle by a
   redirect that repeats a tool call within one resumed e2e-fake session.
   Left unfixed this round: the format is asserted by name in several
   existing tests (`e2e/ui/agent-idle-await-expiry.spec.ts:948` extracts the
   embedded session id via `toolId.replace(/^e2e-fake-tool-/, '')`, and
   `packages/providers/src/e2e-fake/provider.test.ts` has ~10 exact-string
   assertions on the current format), and e2e-fake never ships to a real
   user — it is a test-harness-only construct. Changing its id scheme is a
   larger, separate change (updating every consumer of the format) that
   duplicates work the "run the full e2e suite" step already does. Flagging
   it here rather than fixing it silently.
4. **Grok `--single` could not be made to invoke a tool live.** Across three
   prompt variants (increasingly explicit instructions, a `python3` command
   instead of a bash `while` loop) the model consistently answered directly
   without ever calling the shell tool, in this environment. The exact
   reported mechanism — an `output_format` node's abort surfacing as a
   _throw_ (`dag_node_cancelled_via_abort`) — was therefore not reproduced
   live; it is covered by the two dag-executor unit tests instead (both
   node types, same throw shape). Live verification used the loop node's
   **graceful** cancel path (a clean stream exit via the external-abort
   race, not a throw) with real Claude — a different branch of the same
   commit's fix, not the same one Grok `--single` hits. Both branches share
   the identical `settleRunningToolsOutcome` call and the identical
   `runningTools` map, so the live run proves that call is correct; it does
   not prove the specific throw path is reachable outside the mock harness.

Status: DONE_WITH_CONCERNS

Summary: All five round-6 findings (VQ6-1 major, VQ6-2/VQ6-3 minor,
VQ6-4/VQ6-5 cosmetic) are fixed at their root causes and covered by new
unit tests. VQ6-1 and VQ6-4 are additionally verified against a real Codex
session on an isolated server (both shells, live and after reload, plus a
DB-level proof the exact id-collision the report described no longer
produces a false result); VQ6-2's dag-executor fix is verified live via a
real Claude loop-node abandon (Grok `--single` could not be induced to call
a tool in this environment across three attempts). `bun run validate` is
green after every commit. The full e2e UI suite required a one-time
`bun run build:web` (the web dist bundle was missing); the confirming run
was **154 passed, 4 skipped, 0 failed** — the one failure on the first run
(a pre-existing async-write-vs-poll race in unmodified code, traced and
reproduced in isolation) did not recur.

Concerns: the four items in "Unresolved questions" above (VQ6-4 `warning`
tone, inline `oklch()` tokenization, `e2e-fake`'s own id-collision class,
and the Grok `--single` live-tool-call gap in this environment) are
documented, not silently resolved. The pre-existing e2e timing race
(`route-smoke`'s CLI-detached-run check) is also documented above, not
fixed — it is outside this report's five findings and touching the
durable-stamp write's timing is a separate, deliberate change this report
does not make.
