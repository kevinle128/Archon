# VQ9-2 live verification — Abandon writes a terminal node event for a restart-recovered node

Isolated scratch server, `bash-hold` workflow (a single deterministic `bash:` node
running `sleep 120 && echo step-1`) — chosen over a `prompt`/`loop` agent node after two
attempts where the real Claude subscription finished (or short-circuited) the tool call
faster than the round trip needed to confirm "still running" before `kill -9`; a
deterministic bash node reliably stays running for the full duration, and the fix under
test (`writeTerminalNodeEventsForOrphanedNodes` / `findNonTerminalNodes`) is generic over
node type — it reads and writes plain `workflow_events` rows without branching on
`bash`/`prompt`/`loop`, so this exercises the exact same code path a stuck agent node
would.

## Sequence

1. Dispatched `bash-hold`; confirmed `GET /api/workflows/runs` → `status: "running"`.
2. `kill -9` on the server process while confirmed running (run `33ce12d264d523ec843eea7aa7180006`).
3. Restarted the server (fresh process, empty in-process emitter registry — no
   `registerRun` entry for this run exists in the new process).
4. `GET /api/workflows/runs/{id}` → `status: "running"` still (no autonomous mutation —
   the restart alone never flips it).
5. `POST /api/workflows/runs/{id}/abandon` → `{"success":true}`.
6. `GET /api/workflows/runs/{id}` → now shows:
   - `run.status: "cancelled"`
   - A new `node_failed` event, `data: { occurrence_id, attempt_id, retry_epoch, error: "Cancelled by user" }`
     — the SAME `occurrence_id`/`attempt_id`/`retry_epoch` as the original `node_started`
     event, confirming the scope-carry-forward fix (the synthesized event attaches to the
     same execution row a live cancel's own write would have).
   - `nodeStates: [{ nodeId: "hold", status: "failed", error: "Cancelled by user" }]` —
     no longer stuck on `"running"`.
   - `nodeExecutions: [{ status: "failed", started_at, ended_at, duration_ms: 45000,
error: "Cancelled by user" }]` — a genuinely terminal execution row, which is exactly
     what `hasUnsettledNodeExecutions` (the Console's 3 s terminal-catch-up poll) checks;
     this row now reads terminal, so that poll would stop instead of running forever.
7. A second `POST .../abandon` on the same run → `400 "Cannot abandon run with status
'cancelled'"` — confirmed idempotent (no duplicate `node_failed` write is even
   reachable on a retry/double-click).

Raw response captured in this evidence folder is reproduced above verbatim (see the
session transcript); the exact run id is `33ce12d264d523ec843eea7aa7180006`.

## Not reproduced live

The Console/Legacy header pill itself (`ConsoleRoomHeader`/`NodeRoomHeader`) was not
exercised in a browser — `packages/web/dist` is not normally built in this worktree
(confirmed via the server's own `web_dist_not_found` log line before `bun run --filter
@archon/web build` was run for the e2e suite). The `buildExecutionHeader`/`statusPill`
precedence fix (run-terminal status projected onto a still-`running` node, and a durable
terminal status beating a stale `recoveryRequired` flag) is covered instead by dedicated,
individually-reverted-and-confirmed-failing unit tests in `execution-room-model.test.ts`,
using the exact `nodeStatus`/`runStatus`/`recoveryRequired` combination this live run
produces server-side (a still-`running`-looking node report racing a just-turned-terminal
run).
