# VQ10-2 and VQ10-3 live verification — restart recovery, one kill -9 session

Isolated scratch server (port 3353) + Vite (port 5221, proxying to 3353),
`qa10-prompt` and `qa10-loop` workflows (Claude, `provider: claude`
forced — the config default was `codex`), a foreground CPU busy-wait
command (`end=$((SECONDS+120)); while [ $SECONDS -lt $end ]; do :; done`)
matching the round-9/10 QA's own technique, since a plain backgroundable
`sleep` let Claude report done via its own background-task tracking before
the command actually finished.

## VQ10-3 — prompt node (run `cd51131c880dd1182b990f86ca2c5d7b`)

1. Dispatched `qa10-prompt`; confirmed `tool_called` for the busy-wait Bash
   command.
2. `POST .../nodes/hold/interrupt` (Stop) mid-tool-call.
3. `POST .../nodes/hold/send` with `intent: "queue"` — queued 1 item
   (`F-Q1`).
4. Confirmed via `GET` that the run's LATEST event was `node_usage_recorded`
   with `{retry_epoch: 0, iteration: null}` and **no** `occurrence_id` /
   `attempt_id` — the exact synthesized-event trigger the round-10 finding
   describes (a bare usage event, not the node's own `node_started`, as the
   newest row).
5. `kill -9` the server (pid 16797), restarted on the same port (pid 38821).
   `GET` confirmed `status: "running"` still — no autonomous mutation from
   the restart alone.
6. `POST .../abandon` → `{"success":true}`.
7. `GET` result: `nodeExecutions` is a **single** row,
   `status: "failed"`, `occurrence_id: "feff8a80-30c6-4af8-a0ee-f6c5a8d7d3d7"`,
   `attempt_id: "0bd3bd06-a0ad-414d-b8c4-3a21b0077ec9"` — the **exact same**
   ids as the original `node_started` event. No `unknown_scope` row. The
   synthesized `node_failed` event itself carries those same ids.

Full run detail saved: `vq10-3-prompt-node-run-detail.json`.

## VQ10-3 — loop node, iteration 2 (run `d3e396da80248326c7fce87c718f818d`)

Same sequence, on `qa10-loop`'s iteration 2 (iteration 1 used a short 3s
busy-wait so the loop advances quickly; iteration 2 uses the 120s one).
Captured both the outer container's `node_started` scope
(`occurrence_id: 81bc6ae1-...`) and iteration 2's own
`loop_iteration_started` scope (`occurrence_id: 93cdb515-...`, distinct from
the container's) before Stop + queue (`LF3-Q1`) + `kill -9` (pid 67627) +
restart (pid 77367) + Abandon.

Result — `nodeExecutions` has **three** rows, zero `unknown_scope`, zero
`running`:

- iteration 1: `status: "completed"` (unaffected, already closed before the
  crash).
- the **container**: `status: "failed"`, `occurrence_id: "d2227f3f-..."`,
  `attempt_id: "eb04d377-..."` — matches the outer `node_started` exactly.
- **iteration 2**: `status: "failed"`, `occurrence_id: "e8249667-..."`,
  `attempt_id: "54ca282c-..."` — matches iteration 2's own
  `loop_iteration_started` exactly, and is a **different** occurrence than
  the container's, proving both open executions were closed independently
  rather than one write accidentally closing both (or neither).

The last two persisted events, in order, were `loop_iteration_failed`
(iteration 2's own occurrence) THEN `node_failed` (the container's) —
confirming the write order fix (iteration closed before the container,
mirroring the live executor's own `failLoopIteration` → `failLoopNode`
sequence).

Full run detail saved: `vq10-3-loop-node-run-detail.json`.

## VQ10-2 — Console pill in a tab opened after the restart

Reused the same kill-9/restart cycle for a third loop run (`d3e396da80...`
was itself re-used for this — see the timing notes file), this time with a
**fresh Playwright browser tab that never existed before the `kill -9`**,
opened ~1.5s after the restart, navigated straight to the Console run room
for the recovered node. `evidence/qa10-fixes/vq10-2-timing-notes.txt` has
the full transcript; the result: the pill read `Recovery required` before
Abandon, then went straight to `Failed` 167ms after the Abandon POST —
`Running` was never observed at any of the 40ms samples taken across the
whole window. Screenshot: `vq10-2-fresh-tab-after-restart-failed.png`.

Pre-fix, round 10 measured this same scenario (fresh tab opened after
restart) at 429-456ms into `Running`, settling to `Failed` only at
26.35-26.39s (via the 30s SSE-drop safety-net poll, since this tab's own SSE
subscription — `SSETransport`'s one-stream-per-conversation slot — can lose
the live push to a sibling tab on the same run). The fix (forcing an
immediate run refetch the instant the dock's own ~1s queue poll learns the
node is finished, and treating `finished` the same as `recovery_required`
until the row/run status itself is terminal) collapses that ~26s gap to
under 200ms, independent of whether the SSE push ever lands.

## Side effects

The real `~/.archon/archon.db`, `~/.archon/config.yaml`, and
`~/.archon/credential-key` were only ever read (`.backup` / `cp`), never
written to. Every workflow run, worktree, DB, and log for this session lives
under the scratch `ARCHON_HOME`.
