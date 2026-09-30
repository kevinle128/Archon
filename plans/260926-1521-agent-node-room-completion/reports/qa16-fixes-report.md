# QA round 16 fixes

Date: 2026-10-01 (Asia/Saigon). Branch `worktree-agent-a757e920c72625cbf`, forked from `develop-2` @ `1e06fc49`.

## Outcome

All four findings are fixed as the "Decisions (2026-10-01)" section says. Live evidence is in `evidence/qa16-fixes/data/` (8 restart cycles, 11 rAF-sampled UI runs).

## VQ16-1: restart returns an unread soft injection to the queue

- New `restoreUnreadSoftInjections(runId, nodeId)` in `packages/core/src/db/workflow-steering.ts`. One UPDATE sets every `sent` entry of the node back to `queued` when no operator row in `remote_agent_workflow_node_messages` carries its `message_id` (`json_extract` on SQLite, `->>` on PostgreSQL, the same split `workflow-node-messages.ts` already uses). `fifo_position` is untouched, so the entry keeps its original place, the same rule the in-process ledger uses. Entries with an operator row stay `sent`. No schema change, so no bundled-schema or upgrade check was needed.
- The queue read route (`packages/server/src/routes/api.ts`) calls it when the node has no live in-process handle, before listing the queue. A restarted server has no ledger, so the durable row is the proof. `execution_state` is computed as before: the room still reads `recovery_required` from the missing handle, never inferred from the restored entry.
- After the restart the band shows `QUEUED · 2 saved to server` with the entry. After Abandon the node is finished and the entry shows in `NEVER SENT · 2` (the web derives that from the queued entries of a finished node, as for the other restored items).
- Tests: three DB tests (unread returns and keeps its place, entry with a row is left, other node and delivered entries untouched) and one route test (restart returns the unread entry and leaves the one with a row). The route test file's `mock.module` factory got the new export.

Live (`data/cycle-*.json`, screenshots `*-restored.png`, `*-abandoned.png`): 4 fake-provider cycles and 4 real Claude (haiku) cycles. Each: queue ONE and TWO, per-item `Send now` on TWO (`sent`, 0 operator rows), `kill -9` on my own server PID, restart, open the room. Result in 8 of 8: queue read `TWO queued`, `execution_state: recovery_required`, band `QUEUED · 2`; after Abandon `NEVER SENT · 2` with TWO listed and `node finished · none of this was sent`.

## VQ16-2: focus after per-item Send now

`ComposerDock.tsx` records a focus target when the click (or `Enter`) fires: the same control on the next queued item, else the previous one, else the message field, the same helper the withdraw rule uses (`nextFocusAfterRemoval` now takes the control kind). A ref map tracks each per-item `Send now` button. The restore effect waits until the send settles and is a layout effect, so the move happens before the browser paints the removal (a passive effect left one `<body>` frame on the last item in an early run). A failed send clears the target and the clicked button keeps focus.

Live (fake soft-inject, 7 runs, rAF-sampled): click on item 1 lands on item 2's `Send now`; `Enter` on item 2 lands on item 3's; `Enter` on the last item lands on the message field. 0 `<body>` frames after load in the final 4 runs.

## VQ16-3: the dock keeps the entry until its row renders

`applyQueueSnapshot` takes the set of operator message ids the transcript has rendered (the room already computes it). A `sent` or `delivered` entry the dock tracked stays until that set contains its id, instead of for one more poll. A finished node ends the hand-off. `ComposerDock` passes the set through a ref so the polling callbacks read the latest value. Two older unit tests asserted the one-poll drop; the decision reverses that rule, so they now assert retention until the row renders and the drop once it has.

Live: 0 frames with an injected item in neither the band nor the transcript and 0 frames with it in both, across 7 runs with 3 injected items each.

## VQ16-4: band count on Stop

Unread injected entries carry a flag. When the sub-state becomes `idle-after-interrupt` on a provider that acknowledges deliveries (`capabilities.delivery_ack`), both the reducers (`syncProjectedSubState`, `resolveInterruptOutcome`) and the snapshot path show the entry as `queued`, so the header reads `WILL SEND · n` with n rows. Providers without an acknowledgement (Grok ACP) are not folded, because the transport may still carry the entry into a later turn.

Live: before the fix the stopping tab showed `WILL SEND · 1` with TWO still `sending…` for 317 ms. After the fix, 4 of 4 Stop runs go straight to `WILL SEND · 2` with 0 such frames.

## Checks

- `bun run validate`: green (after the last source change).
- Web unit: `steering-dock.test.ts` 185 pass, `ComposerDock.test.tsx` 129 pass. DB: `workflow-steering.test.ts` 34 pass.
- Full e2e: see the end of this file.

## Concerns

- The restore runs on the queue read when the server holds no handle for the node. A node driven by a detached CLI process also has no handle in the server, so a soft injection that process accepted a moment earlier and has not yet written a row for would return to the queue while its ledger still holds it. The route already treats that case as `recovery_required`, and the window is the gap between acceptance and the operator row. I did not add a staleness guess, which the lifecycle rule forbids.
- "Front of the queue" is read as the entry's original FIFO position, the same as the in-process late-injection return. An entry queued after another one therefore drains after it.
- During `Stopping…` (the turn has not yet stopped) the header still counts queued entries only, with the injected entry shown as `sending…`. That is the approved Stopping layout and the decision covers the moment the Stop lands.
- VQ16-2, 3 and 4 were checked live on the fake soft-inject provider; real Claude was used for the VQ16-1 restart cycles.
- VQ16-2, 3 and 4 share `ComposerDock.tsx` and `steering-dock.ts`, so they are one commit.

## Full e2e

After `git merge develop-2` (already up to date) and a web rebuild, `ARCHON_E2E_PORT_BASE=3630 playwright test ui`: 151 passed, 2 skipped, 1 failed. The failure was `agent-tool-row-visual.spec.ts` `hitl.tool-body-gallery-legacy`, a `locator.click` timeout at 120 s in the full run. It touches no steering code. Isolated with `--repeat-each 5` it passed 5 of 5 (about 6 s each), so it is a load flake, reported and not accepted silently. No assertion was changed.
