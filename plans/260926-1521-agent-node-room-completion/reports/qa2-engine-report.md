# QA2 engine fixes — Agent Node Room

Date: 2026-09-28 (Asia/Saigon). Checkout: `develop-2` merged into worktree branch `worktree-agent-a1e2f7ddaa348a14c`. Agent: qa2-engine.

Fixes the five engine-level findings from `plans/260926-1521-agent-node-room-completion/reports/visual-qa-2-report.md`: VQ2-1 (blocker), VQ2-3 (major), the blank-Send-now gap, the stuck-`◐`-on-denial gap, and the retry-attribution gap (VQ2-7).

## Method

- **Isolated server.** DB copied with `sqlite3 ~/.archon/archon.db ".backup …"`, plus `config.yaml` and `credential-key`, into a scratch `ARCHON_HOME` under the session scratchpad. Server on port 3333 (`ARCHON_HOME=… TELEGRAM_BOT_TOKEN= SLACK_BOT_TOKEN= DISCORD_BOT_TOKEN= WORKFLOW_RUN_RETENTION_DAYS=36500 SESSION_RETENTION_DAYS=36500 PORT=3333`), Vite on port 5201 proxying `/api` to it (a temporary repo-root `.env` with `PORT=3333` was needed for Vite's `loadEnv` to pick up the port — created, used, and deleted afterward; never committed).
- **Scratch repo.** A local bare `origin` plus a working clone under the session scratchpad, registered as a folder-path codebase. One workflow, `qa2-steer` (Claude sonnet, thinking enabled, `worktree.enabled: false`), with a single node prompted to run a real leading `sleep 25` (above the ~25s guard threshold — confirmed via web search, not the 2s figure named in the initial GitHub issue text) then two more `sleep`-bearing steps, so the run stays live long enough to steer.
- **Real subscription.** All runs used the logged-in Claude subscription; no fake/mock provider.
- **Runs used for the final verification pass:** `22644b4b19ab75a1b5571a56bd654eab` (full steering + denial + live screenshots). Earlier diagnostic runs (`47f5dede…`, `4ae97aa0…`, `7378e104…`, `1a15ff0a…`, `822212551…`) are documented below because they drove the actual root-cause finding for item 4.
- **Screenshots** via `playwright-core` (from `e2e/node_modules`, resolved by running the script with `bun --cwd e2e/`), one Chromium context, `X-Archon-User: qa2-operator`, 1440×900. Both shells captured **while the node was still `running`**, mid-redirect-turn. Saved to `plans/260926-1521-agent-node-room-completion/evidence/qa2-engine/`.
- **Processes.** Server and Vite were both started by me and both stopped (`kill -TERM`) before finishing; verified via `lsof -i :3333` / `:5201` returning nothing afterward. No other session's process was touched.

## Item 1 (VQ2-1, blocker) — guidance turns kept a steered node's rows on one occurrence

**Root cause** (found via `git log -S newTranscriptAttempt` / `-S turnIsGuidance`, tracing `dag-executor.ts` from #181 through #183): a guidance turn (Send now, natural queue drain, auto-send) called `newTranscriptAttempt(executionScope)` before its provider call — minting a fresh `attempt_id` on the SAME `occurrence_id`. The room's node-message fetch (`node-message-pages.ts`), the header's `node_started` event matcher (`execution-room-model.ts`), and both shells' ask-interaction placement helpers all additionally filtered by `attempt_id`, so once a guidance turn started, every row from an earlier turn — the prompt, the interrupted tool call, prior operator messages — dropped out of the projection while the node was still live, and after completion only the last turn's rows remained.

**Fix.** Per the SPEC's decision ("a steered node is one execution with several provider turns on one live session … grouping keys on `occurrence_id`, never `attempt_id`"):

- `packages/workflows/src/dag-executor.ts` — removed `executionScope = newTranscriptAttempt(executionScope)` from both turn loops (the plain-node loop at the former line ~3562 and the loop-node loop at the former line ~6464). A guidance turn now keeps the SAME `attempt_id` as turn 1 of its occurrence.
- `packages/web/src/lib/node-message-pages.ts` — `nextLoaderOptions` no longer forwards `attemptId` to the messages loader; the fetch scopes to `occurrenceId` only.
- `packages/web/src/lib/execution-room-model.ts` — `eventMatchesSelection` drops the `attempt_id` comparison for occurrence-kind selections (occurrence match alone decides).
- `packages/web/src/components/workflows/merge-agent-room-items.ts` and `packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts` — the ask-interaction placement guard drops its `attempt_id` comparison the same way.
- `packages/web/src/experiments/console/components/inspect/execution-interactions.ts` — `matchesScope` likewise occurrence-only.
- Old rows already written under separate attempt ids (pre-fix runs) are tolerated automatically — none of the read-side changes require `attempt_id` to agree, so a legacy run's guidance-turn rows now display under their execution too, with no data migration.

**Unit tests updated:** three `dag-executor.test.ts` assertions that previously asserted `attempt_id` differs across a guidance/redirect turn now assert it (and `occurrence_id`) stay equal. `node-message-pages.test.ts`, `execution-room-model.test.ts`, `execution-interactions.test.ts`, `select-visible-node-ask-interactions.test.ts`, `merge-agent-room-items.test.ts`, `ConsoleExecutionHistory.test.tsx` updated to match.

**e2e (`agent-interrupt-redirect.spec.ts`):** now captures the interrupted tool's `data-tool-id` and asserts, while the redirect turn is live (Stop button visible again, node still `running`), that the SAME tool row is still present with `⚠`, before asserting the operator rows — proving the room keeps the WHOLE transcript live rather than swapping to only the newest turn. Both the main interrupt/redirect test and the 460px visual-geometry test were updated this way. The API-level assertions that `resumedAttempt`/`interruptedAttempt` differ were flipped to assert they're equal (same occurrence too).

**Real-run verification (below, combined with items 3 and 4):** run `22644b4b19ab75a1b5571a56bd654eab`'s final transcript — 14 rows spanning the denied step 1, the interrupted step 2, the operator redirect, and the redirect turn's own tool call/result/completion text — reported **exactly one** `occurrence_id` and **exactly one** `attempt_id` across the whole run. Screenshots (`console-live-steering.png`, `legacy-live-steering.png`) show all of this live, in both shells, while the node header still reads `RUNNING`/`running`.

## Item 2 (VQ2-3, major) — a rejected retry-node request is now side-effect free

**Root cause:** `prepareWorkflowNodeRetry` (`packages/core/src/operations/workflow-retry.ts`) claimed the run (`claimWorkflowRunForNodeRetry`, bumping `retry_epoch` and flipping status to `running`) and wrote the `node_retry_requested` audit event BEFORE it ever checked whether HEAD had moved past the node's saved checkpoint. The `checkout_strategy_required` rejection was thrown deep inside the claimed branch, which the `catch` block turned into `restoreFailedAfterRetrySetupError` — leaving the run `failed` at a bumped epoch with dependent nodes `pending`, even though the caller's own request was rejected. Every subsequent retry attempt (even with a strategy chosen) then found the run already in a bad, epoch-advanced state.

**Fix.** Extracted the checkpoint-vs-HEAD ancestry comparison (previously inline only in the claimed branch and duplicated in the read-only preview endpoint) into a shared `computeCheckoutChoice` helper. `prepareWorkflowNodeRetry` now runs this check BEFORE calling `claimWorkflowRunForNodeRetry`, for exactly the case that needs it (`mutates_checkout !== false`, `requesterSurface === 'web'`, `checkoutStrategy` omitted) — a missing-strategy conflict is rejected with zero claim, zero audit write, zero run mutation. The in-flight claimed branch keeps its own check as a narrow backstop for the race where HEAD moves in the gap between the pre-claim read and the claim itself (mirroring how the existing path-lock check already tolerates that same race) — it now delegates to the same `checkoutStrategyRequiredError` helper instead of duplicating the error text.

**Test:** `workflow-retry.test.ts`'s existing "rejects web retry without strategy…" test was strengthened to assert `claimWorkflowRunForNodeRetry`, `updateWorkflowRun`, and the audit-event `pool.query` mock are never called on the rejected path (was previously asserting the run WAS marked failed — the exact bug). 20/20 tests pass.

This item was not part of the "verify with a real Claude run" list (only items 1–4 were) and needs no LLM call — it's pure git-ancestry/API mechanics, fully covered by the DB-mocked unit suite.

## Item 3 — blank Send now delivers everything already waiting (CAP-10)

**Root cause:** two independent blockers. (1) `sendWorkflowNodeBodySchema` (`packages/server/src/routes/schemas/workflow.schemas.ts`) refined `message` to reject blank text unconditionally — a blank `send_now` request 400'd before the route body even ran. (2) `canSubmitGuidance` (`packages/web/src/lib/steering-dock.ts`) required non-blank draft text regardless of mode, so both dock implementations kept Send now `aria-disabled` even when items were already queued and the agent was idle-after-interrupt.

**Fix.**

- Server: the schema's blank-message refine now only applies to `intent: 'queue'`. The send route (`packages/server/src/routes/api.ts`) special-cases a blank `send_now`: it writes no durable row and just wakes the idle handle so every already-queued item drains together in FIFO order, replying `{ success: true, message_id: <caller's own id>, state: 'sent' }` — the wake itself, not a specific message's delivery.
- Client: `canSubmitGuidance` gained `agentMode`/`willSendCount` parameters — a blank draft is submittable only when `agentMode === 'idle'` (idle-after-interrupt) and at least one claimable item is already queued. `beginSendNow` no longer adds an optimistic placeholder row for a blank draft (there's no new message to display).
- `steering-api-contract.md` updated to document the widened `message` contract and the blank-`send_now` response shape.

**Tests:** `steering-dock.test.ts` (widened `canSubmitGuidance` matrix + a new `beginSendNow` blank-draft case), `ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx` (both dock components' "Send now with a blank draft…" tests, replacing the old "requires a non-blank draft" tests that asserted the bug), and two new `api.workflow-runs.test.ts` server-route tests (blank send_now wakes without a durable row; blank send_now claims every already-queued item in FIFO order without adding a third).

**e2e:** the old "blank Send now … issue no request" step now asserts the control is enabled (not `aria-disabled`) once items are waiting. A new dedicated test, `interrupt-blank-send-now-${surface}`, drives the full queue → Stop → blank Send now → redirect-completes flow and asserts the POST body's `message` is `''` and exactly one operator row (`'first'`) reaches the transcript.

**Real-run verification (run `22644b4b19ab75a1b5571a56bd654eab`):** after `Stop` settled to `idle-after-interrupt`, `POST …/send {message: "", intent: "send_now"}` returned `{"success":true,"message_id":"c5d0fb30…","state":"sent"}` and the node resumed running the redirect turn — confirmed live in both screenshots (Stop button back, `running · N.Ns` on the new tool call).

## Item 4 — a Claude tool call the CLI denies before execution now settles

**What I initially assumed vs. what real runs proved.** I first added a `PermissionDenied` SDK hook (per the SDK's own doc comment: "covers the 'deny' short-circuit in canUseTool"). It compiled, unit-tested fine, but **a live run proved it never fires for the leading-sleep guard**: I ran the same `sleep 25 && echo …` command against the real server three separate times with temporary debug logging in all three hook callbacks (`PostToolUse`, `PostToolUseFailure`, `PermissionDenied`) plus a raw-event dump, and captured the actual wire event. None of the three hooks logged anything for the denied call. The denial reached Archon ONLY as a plain Anthropic Messages API `user`-role turn:

```json
{
  "type": "user",
  "message": {
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_…",
        "content": "<tool_use_error>Blocked: sleep 25 followed by: echo step-1-done. …</tool_use_error>",
        "is_error": true
      }
    ]
  }
}
```

`streamClaudeMessages`'s `event.type === 'user'` branch only ever handled `isReplay` delivery-acks — it silently dropped every `tool_result` content block, so the executor's `runningTools` entry for that call never settled and the room showed it stuck `◐ running` for the rest of the turn.

**Fix** (`packages/providers/src/claude/provider.ts`, `streamClaudeMessages`):

- Track `toolNameByCallId` (populated at every assistant `tool_use` block) and `hookSettledCallIds` (populated by the existing hook-drain loop, at the SAME point it already yields a `tool_result` chunk).
- In the `user`-message branch, for each `tool_result` content block with `is_error === true` whose `tool_use_id` is NOT in `hookSettledCallIds`, synthesize the same terminal `tool_result` chunk the hooks would have produced — looked-up tool name, flattened text content (string or array-of-text-blocks, via a new `textFromToolResultContent` helper), `toolOutcome: 'error'`.
- A call the hooks DID already settle (a genuine executed failure, which the Messages API also echoes back as a `user` tool_result) is skipped — proven by ordering: the hook's control round-trip with the CLI subprocess completes before the corresponding stream message is emitted, so `hookSettledCallIds` is already populated by the time the `user` message's iteration processes it. Verified by a dedicated unit test that fires BOTH a `PostToolUseFailure` hook and a matching `user` `is_error` tool_result for the same call and asserts exactly one `tool_result` chunk results.
- Kept the `PermissionDenied` hook — it's still correct, defensive coverage for a denial that DOES route through `canUseTool`'s own short-circuit (a different, real mechanism the SDK documents separately), just not the one this particular guard uses.

**Tests:** 4 new `provider.test.ts` cases — the real reproduction shape (assistant `tool_use` → `user` `is_error` tool_result with no hook → terminal `tool_result` chunk with the exact tool name and raw error text), the array-content-block variant, the no-double-count case described above, plus the two `PermissionDenied`-hook tests kept from the first (still-valid) attempt. 191/191 `provider.test.ts` tests pass; 264/264 across `src/claude/`.

**Real-run verification:** run `22644b4b19ab75a1b5571a56bd654eab`, node `steer`. The `sleep 25 && echo step-1-done` Bash call (seq 4) is immediately followed by a proper tool RESULT row (seq 5) carrying the exact `<tool_use_error>Blocked: sleep 25 followed by: echo step-1-done. …</tool_use_error>` text with `outcome: error` — confirmed both via the messages API and visually: both screenshots show the call expanded with a red **FAILED** badge, not `◐ running`.

## Item 5 (VQ2-7, minor) — file-change attribution now follows git ancestry, not retry epoch

**Root cause:** `execution-attribution.ts` kept only a retried node's highest `retry_epoch`, assuming an earlier attempt's commits were always reset away. That assumption holds for the default `checkoutStrategy: 'checkpoint'` retry, but **not** for `checkoutStrategy: 'current'`, which never resets the checkout — the earlier attempt's commits stay exactly where they were and remain reachable from HEAD. A file two node executions both touched (one under each strategy) was credited to only the later one, even though the file still carried both edits.

**Fix:** replaced the epoch-number heuristic with the actual test it stood in for — an execution counts only when its END commit is still an ancestor of (or equal to) the checkout's current HEAD, via the already-existing `isCommitAncestorOfHead` (`@archon/git`). `selectRunBaselineCommit` and `computeFileAttribution` (`packages/server/src/routes/git/execution-attribution.ts`) both take an injected `isAncestorOfHead` check and are now `async`; the route handler (`files-changed-handler.ts`) wires it to the real git check.

**Tests:** `execution-attribution.test.ts` — two new cases (`checkpoint`-strategy retry excludes the reset-away attempt via ancestry, not epoch; `current`-strategy retry keeps BOTH attempts attributed) plus every existing case converted to the new async signature with an `isAncestorOfHead` stub. `api.files-changed.test.ts` — added the `isCommitAncestorOfHead` mock (defaulting to `true`) the route now requires. 15/15 and 6/6 pass respectively.

This item is server-side git/DB logic with no LLM dependency and was not on the "verify with a real Claude run" list; covered by the unit suite above.

## Validate

`bun run validate` (full monorepo: bundled/schema/pi-vendor-map/capability-matrix checks, `type-check`, `lint --max-warnings 0`, `format:check`, `test:install`, and every package's `test` script) was run twice — once before starting item 1 (clean baseline) and once after all five commits — both green, zero failures.

## Files changed

- `packages/workflows/src/dag-executor.ts`, `dag-executor.test.ts` (item 1)
- `packages/web/src/lib/execution-room-model.ts`, `node-message-pages.ts`, `node-message-pages.test.ts`
- `packages/web/src/components/workflows/merge-agent-room-items.ts`
- `packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts`
- `packages/web/src/experiments/console/components/inspect/execution-interactions.ts`, `execution-interactions.test.ts`, `ConsoleExecutionHistory.test.tsx`
- `e2e/ui/agent-interrupt-redirect.spec.ts` (items 1 and 3)
- `packages/core/src/operations/workflow-retry.ts`, `workflow-retry.test.ts` (item 2)
- `packages/server/src/routes/schemas/workflow.schemas.ts`, `packages/server/src/routes/api.ts`, `api.workflow-runs.test.ts` (item 3)
- `packages/web/src/lib/steering-dock.ts`, `steering-dock.test.ts`
- `packages/web/src/components/workflows/ComposerDock.tsx`, `ComposerDock.test.tsx`
- `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`, `ConsoleComposerDock.test.tsx`
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` (item 3, doc update)
- `packages/providers/src/claude/provider.ts`, `provider.test.ts` (item 4)
- `packages/server/src/routes/git/execution-attribution.ts`, `execution-attribution.test.ts`, `files-changed-handler.ts`, `api.files-changed.test.ts` (item 5)

## Evidence

- `plans/260926-1521-agent-node-room-completion/evidence/qa2-engine/console-live-steering.png`
- `plans/260926-1521-agent-node-room-completion/evidence/qa2-engine/legacy-live-steering.png`

Both captured against real run `22644b4b19ab75a1b5571a56bd654eab` while the node was still `running`, mid-redirect-turn — showing the denied `sleep 25` call (FAILED badge, full error text — item 4), the interrupted `sleep 15` call, the operator's redirect row, and the live redirect-turn tool call all together in one transcript under one occurrence (item 1), following a blank `Send now` (item 3).

## Processes

Server (scratch `ARCHON_HOME`, port 3333) and Vite (port 5201) were both started by me and both stopped (`kill -TERM`) before finishing. Verified via `lsof -i :3333` / `:5201` returning nothing afterward. No process belonging to another session or the main checkout was touched. The temporary repo-root `.env` (`PORT=3333`, needed only so Vite's dev-server proxy could find the scratch backend) was deleted before the final commit and never staged.

## Unresolved questions

None. All five items are fixed, tested, and (for the four in scope) verified live against a real Claude subscription on an isolated server.

## Status

DONE

## Summary

All five VQ2 engine findings are fixed. Item 1 (blocker): guidance turns now stay on the same `occurrence_id`/`attempt_id` as the turn that started the node, so the room never hides earlier turns' rows while a steered node is live — verified live with a real Claude run showing all 14 transcript rows under one occurrence. Item 2 (major): a rejected retry-node request is now side-effect free (no claim, no audit write, no run mutation) when the caller omitted `checkoutStrategy` and HEAD has moved. Item 3: a blank Send now with items already waiting now delivers everything queued, per CAP-10, both client- and server-side. Item 4: a Claude tool call the CLI's own leading-sleep guard denies before execution now settles with a proper terminal result instead of staying stuck `◐ running` — root cause required three live-server diagnostic runs to find (the initial hook-based fix attempt was empirically disproven and replaced with the correct fix, sourced from the real Messages API `user`-turn tool_result the CLI actually emits). Item 5 (minor): file-change attribution now follows git ancestry instead of assuming retry epoch always means "reset away", correctly crediting both node executions when `checkoutStrategy: 'current'` keeps an earlier attempt's commits reachable from HEAD.
