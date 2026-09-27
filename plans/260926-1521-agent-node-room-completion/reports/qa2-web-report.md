# QA2 web fixes — presentation findings from visual-qa-2

Date: 2026-09-28 (Asia/Saigon). Worktree: `agent-a2c85d425cfef3b48`, branch `worktree-agent-a2c85d425cfef3b48`, based on `develop-2` (merged twice: once at session start, once mid-session to pick up qa2-engine's VQ2-1/VQ2-3/blank-Send-now/VQ2-6/VQ2-7 fixes — both merges were clean, no conflicts).

## Scope

Fixed the 7 presentation findings assigned from `plans/260926-1521-agent-node-room-completion/reports/visual-qa-2-report.md`:

1. VQ2-2 — operator row delivery status (`sent`/`delivered`/`delivery unknown`)
2. VQ2-4 + VQ2-5 — run numbering after a skipped retry epoch; the "max N" caption
3. VQ2-9 — prompt row actor shown as a raw user-id fragment
4. VQ2-10 — expanded Codex tool body bar cut off before its exit code/duration
5. VQ-6 remnant — expanded terminal body still showing the shell wrapper
6. VQ2-8 — todo strip not folding Claude's `TaskCreate`/`TaskUpdate`
7. VQ2-11 + VQ2-12 — header title/pill placement; composer placeholder

Out of scope (explicitly not mine): VQ2-1 (attempt identity), VQ2-3 (retry-node backend bug), VQ2-6 (hook-denied Claude tool stuck `◐`), VQ2-7 (files-changed misattribution after a `current`-strategy retry) — all qa2-engine's, now merged into this branch from `develop-2`.

## Commits (conventional, no push)

1. `35f995f4` fix(web): keep exit/duration badges visible on a long tool body bar — items 4+5
2. `c93f32b9` fix(web): match the mockup's room header title and composer placeholder — item 7
3. `d4bd868b` fix(web): rank retried runs by surviving position, and read a loop's real cap — item 2
4. `6372ab5a` fix(web,server): show the prompt row's actor name, not an id fragment — item 3
5. `8d541937` fix(web): show an operator row's proven delivery state, not a hard-coded "sent" — item 1
6. `1ba1da11` feat(web): fold Claude's TaskCreate/TaskUpdate into the todo strip — item 6
7. `e67b7b23` fix(web): reset the terminal-hydration flag on cleanup, not only on failure — a real bug this same testing pass found and fixed (see below)

## What each fix does

**Item 1 (VQ2-2).** `packages/web/src/lib/agent-history.ts` — the operator item's `delivery` field is no longer a literal `'sent'`; `resolveOperatorDelivery` joins the row's stamped `message_id` against a new `deliveryStateByMessageId` input, defaulting to `'sent'` for any id it has no evidence for. The evidence comes from `packages/web/src/lib/steering-dock.ts`'s `applyQueueSnapshot`, which now also builds a `deliveryByMessageId: ReadonlyMap<string, SteeringQueueItemState>` covering every row the server returns (not just the pending band `sent` already tracked) — `sent`/`delivered` rows are dropped from `sent` but their state survives in this new map. `ComposerDock.tsx`/`ConsoleComposerDock.tsx` report it upward via a new `onDeliveryStatesChange` callback, mirroring the existing `onExecutionStateChange` pattern exactly. `NodeTranscriptPane.tsx`/`ConsoleNodeRoom.tsx` hold it in local state and pass it into `buildAgentHistory`. Render: `NodeRoom.tsx`/`ConsoleAgentHistoryList.tsx` show `operatorDeliveryPresentation(item.delivery)`'s label (`sent`/`delivered`/`delivery unknown`) and tone (neutral/success/warning → `text-text-secondary`/`text-success`/`text-warning`).

**Item 2 (VQ2-4/5).** `packages/web/src/lib/execution-room-model.ts` — `computeRunOfTotal` and `executionLabel`'s "Run N" text both now rank the selected retry epoch by its position among the _surviving_ (non-skipped) epochs for that iteration/route slot (`survivingRetryEpochs` + `retryRunNumber`), instead of using the raw epoch value plus one. A skipped middle epoch (e.g. a rejected retry-node request that still wrote `node_retry_requested`, per VQ2-3) no longer creates a numbering gap — "run 3 of 2" is now "run 2 of 2", and the selector's "Run 1"/"Run 3" is now "Run 1"/"Run 2". Threaded through `ExecutionHeaderInput.siblingRows` at the 3 real call sites (`WorkflowExecution.tsx`, `ConsoleInspectPane.tsx`, `ConsoleNodeRoom.tsx`'s own fallback). The header's "of N · max 8" caption is now "of N · max `<loop's own max_iterations>`" for a loop node (via a new `loopMaxIterations` field, read from the node definition, never from `EXECUTION_OPTIONS_MAX`), and just "of N" with no max segment for a non-loop node — matching the mockup's "`of 3 · max 8` appears only on the loop" language.

I did **not** touch `occurrence-groups.ts`'s own independent "Run N" computation for transcript headings (`factsOf`'s `Run ${retryEpoch + 1}`), which has the identical raw-epoch bug. It isn't named in my assigned scope text or in the QA report's "Likely file" column for this finding, and fixing it correctly needs the same sibling-epoch threading through a 4th file/component I didn't have room to scope safely alongside qa2-engine's concurrent attempt-identity work in the same area. **This is a known follow-up gap**: a skipped epoch will still show a numbering mismatch between the header/selector (now correct) and a transcript occurrence heading (still using the raw epoch), reintroducing the exact "must never disagree" issue the code's own comment warns about, just in one fewer place than before.

**Item 3 (VQ2-9).** Server: `packages/server/src/routes/api.ts` generalizes the operator-row display-name lookup (`buildOperatorDisplayNameById` → `buildActorDisplayNameById`) to also collect `actor_user_id` from `prompt`-origin rows, and returns a new `prompt_display_name` wire field (added to `workflowNodeMessageTextResponseSchema`) — a real display name, or the neutral fallback `'unknown user'` (never a raw id slice) when no name is stored. Client: `agent-history.ts`'s `promptActorLabel` takes the resolved name; `promptSourceLabel` returns `null` for `node_prompt` so the row's own "prompt ·" label doesn't repeat itself as the source suffix too (fixing the literal "PROMPT · 5DEA152B · PROMPT" from the report — this half of the finding wasn't explicitly called out in my one-line task text, but it's the same finding (VQ2-9) in the source report and a one-line JSX change, so I included it; flagging it here per the scope-note convention rather than silently expanding).

**Item 4 (VQ2-10) + item 5 (VQ-6).** `packages/web/src/lib/tool-presentation.ts` — `ToolRowPresentation.bodyBarText: string` is now `bodyBar: { label: string; badges: string }`, splitting the previously-concatenated body bar into a truncatable zone (family, body facts, the resolved name) and a pinned zone (runtime badges: state/exit/output-state/duration) that never truncates. All 4 render sites (`NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, `ToolCallItem.tsx`, `ToolCallCard.tsx`) render two spans instead of one, the second `shrink-0`. Separately, `resolveToolBody`'s `shell` case and the body-bar's own fallback name now run the raw Codex name through the same `stripShellWrapper` the headline already uses, so the expanded terminal body and the body-bar's name both show `bun test ...` instead of `/bin/zsh -lc 'bun test ...'`; Raw (a separate, untouched `rawPayload`) is unaffected. `tool-presentation-contract.md` updated to say the terminal body uses the same stripped text as the headline, not the untouched name.

**Item 6 (VQ2-8).** `tool-presentation.ts`'s `FAMILY_ALIASES` gains `taskcreate`/`taskupdate` → `'todo'` (not `tasklist`/`taskget`, which are reads). `todo-state.ts` adds a `TaskCreate`/`TaskUpdate` upsert path keyed by `taskId` (`TodoItem` gains an optional `id` field for this), duck-typed as its own branch in `projectTodoState`'s main loop, separate from OMP's `op`-based fold and Claude's `TodoWrite` snapshot fold, and explicitly never runs OMP's auto-promotion. `TaskCreate`'s input never carries the id the tool assigns (only its output does); `agent-history.ts`'s new `todoFoldInput` merges that output-assigned id onto the input under the same `taskId` key `TaskUpdate` already sends, before the fold ever sees it. `todo-fold-contract.md` documents the third provider shape and the identity mechanism.

**Item 7 (VQ2-11/12).** `NodeRoomHeader.tsx`/`ConsoleRoomHeader.tsx` — the title lost its `flex-1` (which had let it grow to fill the row, stranding the pill next to the far-right ✕) and gained `font-mono font-bold text-[13px]` to match the mockup's `Geist Mono` 700/13px treatment (the app's `font-mono` token resolves to `JetBrains Mono`, a pre-existing token-value difference I didn't change). `ComposerDock.tsx`/`ConsoleComposerDock.tsx`'s `<textarea>` gained `placeholder="Message the agent…"`.

## A real bug this testing found and fixed

Verifying item 1 against a real Claude run exposed a genuine bug, not a test artifact: reloading a **finished** node's room showed `sent` even though the server's queue read already reported `delivered` for that exact message id (confirmed via `curl`). Traced to `ComposerDock.tsx`/`ConsoleComposerDock.tsx`'s pre-existing one-shot terminal-node queue read (the same read my delivery-status field now also relies on): it set an "already fetched" ref before starting, but only cleared it when the node stopped being terminal — not when the fetch was cancelled. React 18 StrictMode's dev-only double effect invocation aborts the first of its two runs; the second run saw the stale `true` flag and skipped its own (unaborted) fetch, permanently losing that node's terminal hydration for the mount. Since the same ref-with-no-reset-on-cancel shape also applies in production whenever `runId`/`nodeId` changes while `nodeTerminal` stays `true` (switching between two finished nodes), this was a real, if narrow, gap — not purely a dev-mode artifact. Fixed by resetting the ref in the effect's own cleanup. See `plans/260926-1521-agent-node-room-completion/evidence/qa2-web/app-legacy-delivery-strictmode-bug-before-fix-460w.png` (before) vs `app-legacy-delivered-todo-header-460w.png` (after, same run, same node, fresh page load).

## Verification

### Real-provider runs

Isolated server on port 3334 (`ARCHON_HOME` = scratch copy of the real `~/.archon` via `.backup`, `WORKFLOW_RUN_RETENTION_DAYS=36500`, no chat platform tokens), web dev server on port 5202 (`bunx vite --port 5202`, `PORT=3334` for the proxy). A scratch git repo + local bare origin registered as codebase `qa2repo`. Two scratch workflows:

- `qa2-codex-fail` (Codex, `gpt-5.5`, `effort: high`) — one prompt node asking Codex to run a shell command that fails (`bun test` against a nonexistent file). Runs `113b9ab4…` (first pass) and its retry (`run 2 of 2`, `checkoutStrategy: current`).
- `qa2-claude-tasks` (Claude) — one prompt node instructed to use `TaskCreate`/`TaskUpdate` (not `TodoWrite`) around a `sleep 20`, so an operator message sent mid-run has time to be claimed, delivered, and acknowledged before the node finishes. Run `12a72dece…`.

All runs used the real Codex CLI (`~/.codex/auth.json`) and Claude subscription (global keychain auth, already logged in) — no mocks.

### Screenshot evidence (`plans/260926-1521-agent-node-room-completion/evidence/qa2-web/`)

| File                                                                      | Shows                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-legacy-codex-wrapper-stripped-460w.png`                              | Item 4+5: Codex's `/bin/zsh -lc '...'` name-only call — collapsed row, expanded body bar (`exit 1 · 1ms` fully visible, not cut off), and terminal body (`$ bun test ...`, wrapper gone). Item 3: `PROMPT · QA2-WEB-OPERATOR` (real resolved name, not an id fragment). Item 7: header title/pill. |
| `app-legacy-delivery-strictmode-bug-before-fix-460w.png`                  | Item 1, before the StrictMode fix: `OPERATOR · QA2-WEB-OPERATOR … sent` on a fresh load of a finished node whose server-side state was already `delivered`.                                                                                                                                        |
| `app-legacy-delivered-todo-header-460w.png`                               | Item 1 after the fix: same run, same node, fresh load — `OPERATOR · QA2-WEB-OPERATOR … delivered` (green). Item 6: `TaskCreate`/`TaskUpdate` chips read "todo updated"; a `TODO` strip at the bottom shows `Write a short note … 1/1`. Item 7: header + (scrolled) composer.                       |
| `app-console-delivered-todo-header-520w.png`                              | Console-shell parity for the same run: delivered badge, todo strip, and the `Message the agent…` composer placeholder all visible together (item 1, 6, 7/VQ2-12).                                                                                                                                  |
| `app-legacy-run2of2-noMax-460w.png`, `app-console-run2of2-noMax-520w.png` | Item 2: `run 2 of 2` in the header meta line and `Run 2` of `2` in the selector for a real 2-execution node; caption reads `of 2` with **no** `max` segment (non-loop node, per the fix).                                                                                                          |

Mockup source (`claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html`, `Transcript States.dc.html`, read directly for exact byte comparison rather than only screenshotted) confirms: `delivered` uses `color:var(--success)`, `sent` uses `var(--text-secondary)`, the title is `Geist Mono` 700 13px with the pill immediately after it, and the composer placeholder is exactly `Message the agent…`. A full-page mockup capture is also saved as `mock-steering-full.png` for reference.

### Not independently verified live

- The loop-node half of item 2's caption fix (`of N · max <loop's max_iterations>`) — proportionate given the non-loop half (`of N`, no max) is now confirmed live above, and the loop half is covered by 2 new unit tests (`loopMaxIterationsForNode`, plus the header-caption render tests) plus the pre-existing loop-caption test I updated. Setting up a real loop run was out of proportion to the remaining time budget.
- The skipped-retry-epoch numbering gap itself (`run 3 of 2` → `run 2 of 2`) — reproducing it live needs VQ2-3's exact backend bug (a rejected retry-node request without `checkoutStrategy`), which isn't mine to fix or trigger deliberately. Covered by a dedicated unit test in `execution-room-model.test.ts` that reproduces the exact epoch gap and asserts the corrected rank.
- `ConsoleAgentHistoryList.tsx` has no dedicated unit test file (it's exercised only via `ConsoleNodeRoom.test.tsx`); I added Legacy-side render tests for the 3 delivery states (`NodeRoom.test.tsx`) but relied on the shared `operatorDeliveryPresentation` unit tests plus this session's live Console screenshot for Console-side coverage, rather than duplicating a third near-identical render test.

## Quality gates

- `bun run type-check`, `bun run lint --max-warnings 0` clean throughout (checked incrementally per commit and via full `bun run validate`).
- `bun run validate` (typecheck + lint + format:check + full test suite across every package) green twice: once before the final `develop-2` merge, once after — both exit 0, no non-zero fail counts anywhere in either run.
- New/updated unit tests: `agent-history.test.ts`, `steering-dock.test.ts`, `todo-state.test.ts`, `execution-room-model.test.ts`, `tool-presentation.test.ts`, `NodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx`, `ComposerDock.test.tsx`, `ConsoleComposerDock.test.tsx`, `api.workflow-runs.test.ts`, `NodeRoomHeader.test.tsx`, `ConsoleRoomHeader.test.tsx` — all green.
- No comments/test names reference story/plan/finding IDs (checked each file before commit).
- Console never imports `@/components/` (unchanged — no new cross-shell imports added).

## Processes

All started by me; all stopped before finishing.

- Server PID 94272 (port 3334), Vite PID (port 5202, `bunx vite`) — both isolated to `ARCHON_HOME` scratch copy, stopped.
- Mockup server on port 8791 was already running when I started (not mine) — left untouched.
- Scratch repo, bare origin, and scratch `ARCHON_HOME` (including the DB copy) left under the session scratchpad, not touched by anything outside it. The real `~/.archon/archon.db` was only read via `.backup`.

## Unresolved questions

1. `occurrence-groups.ts`'s transcript-heading "Run N" still uses the raw epoch (see item 2 above) — same bug class, different location, not fixed. Worth a follow-up pass so the header/selector and the transcript heading can't disagree again after a skipped epoch.
2. VQ2-9's "PROMPT" duplicate-word fix was bundled with the id-fragment fix since both are the same source finding; flagging per the scope-note convention in case a stricter split was intended.
3. The StrictMode-cleanup fix (commit `e67b7b23`) touches the same terminal-hydration one-shot qa2-engine's merged blank-Send-now work is adjacent to (same two files, different statements) — worth a second pair of eyes given two agents landed changes in this exact region within the same session.

Status: DONE

Summary: All 7 assigned findings fixed in both shells with unit-test coverage and real-provider (Claude + Codex) screenshot verification; `bun run validate` green. Found and fixed one additional real bug (StrictMode-only-reachable-in-dev-but-production-real ref-reset gap) while verifying the delivery-status fix. One known follow-up gap documented (`occurrence-groups.ts`'s own Run-N numbering), out of scope for this pass.
