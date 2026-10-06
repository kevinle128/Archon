# VQ9-1 live verification — Codex process-tree reap

Isolated scratch server (PID 19016), real Codex subscription, workflow
`codex-tool-hold` (a single prompt node instructing the agent to run
`sleep 90 && echo step-1` via its shell tool). Full server log excerpt:
`vq9-1-codex-tree-reap-server-log-excerpt.jsonl`.

## Abandon mid-tool-call

Run `4156c2844d5f618a04f6cee0dba33714`. Confirmed via `ps` the tool was live:

```
19971 19016 codex exec ... --cd .../worktrees/archon/thread-e64508e4 ...
23489 19971 /bin/bash -c sleep 90 && echo step-1
23490 23489 sleep 90
```

`POST /api/workflows/runs/4156c2844d5f618a04f6cee0dba33714/abandon` → `{"success":true}`.

Server log:

```json
{"rootPid":19971,"descendantCount":6,"msg":"codex.tree_reap_armed"}
{"pids":[20487,20488,20489,23489,20844,23490],"msg":"codex.tree_reap_terminating_orphans"}
```

6 s later, `ps -p 19971`, `ps -p 23489`, `ps -p 23490`, and `ps -p 20487,20488,20489,20844`
all returned no such process (empty result, header row only) — every descendant reaped,
none escalated to SIGKILL (no `codex.tree_reap_sigkilled_orphans` line). Run status:
`cancelled`.

## Stop mid-tool-call, then continuation

Run `e823f06d911d964ed8f230566e791ccd`. Confirmed live tool call:

```
26737 19016 codex exec ... --cd .../worktrees/archon/thread-70071063 ...
30210 26737 /bin/zsh -c sleep 90 && echo step-1
30211 30210 sleep 90
```

`POST /api/workflows/runs/e823f06d911d964ed8f230566e791ccd/nodes/hold/interrupt` →
`{"success":true,"sub_state":"idle-after-interrupt"}`.

Server log:

```json
{"rootPid":26737,"descendantCount":6,"msg":"codex.tree_reap_armed"}
{"pids":[27418,27420,27421,30210,27908,30211],"msg":"codex.tree_reap_terminating_orphans"}
{"threadId":"01a0ead2-27bf-7412-a6b3-91e2881ccd17","msg":"codex.query_interrupted"}
```

6 s later, `ps -p 26737,30210,30211` returned no such process — all three reaped.

Continuation: `POST .../nodes/hold/send` with a plain follow-up message (no tool call)
resumed the SAME thread — the next `codex.thread_started` log line carries the identical
id `01a0ead2-27bf-7412-a6b3-91e2881ccd17` the interrupted turn had — and the run finished
`completed`.

## Prior (pre-fix) reproduction

Before the `onToolStarted`-snapshot fix, the same Abandon flow left the tool's shell and
`sleep` reparented to PPID 1, confirming the finding: `codex exec` (PID 41255 in that
earlier run) exited but `/bin/zsh -c sleep 25 && echo step-1` (44561) and `sleep 25`
(44563) survived, matching the original QA report. A snapshot taken AFTER
`attemptController.abort()` (the first design attempted here) also failed live —
`codex exec`'s death from the SDK's own `spawn({ signal })` teardown is faster than the
snapshot's own `ps` round-trip, confirmed via a diagnostic log showing zero processes
with `ppid === ourPid` at snapshot time. This is why the shipped fix snapshots on the
SDK's `item.started` (`command_execution`) event instead, while the tool is still alive.
