# VQ10-1 live verification — Grok `--single` tool subprocess tree reaped on Abandon

Isolated scratch server, `qa10-grok-single` workflow (`output_format` forces
the `--single` transport per `selectGrokTransport`), node prompted to run
`sleep 60 && echo grok-step-1` via its shell tool.

## Sequence

1. Dispatched `qa10-grok-single` (run `92f54b109722842bdc80fea46eed19ef`).
   `tool_called` confirmed the shell tool started `sleep 60`.
2. Captured the live process tree via `ps -axo pid,ppid,command` under my
   server pid (77367): `grok --single` (pid 81858, ppid 77367), its zsh
   wrapper (pid 86609, ppid 81858), and `sleep 60` (pid 86678, ppid 86609) —
   three levels of descent, confirmed live and correctly parented.
3. `POST /api/workflows/runs/92f54b109722842bdc80fea46eed19ef/abandon` →
   `{"success":true}`.
4. Polled the three captured pids with `ps -p` at +1s, +3s, and +8s:
   - +1s: `grok --single` (81858) still alive (ppid 77367, not yet signaled);
     the zsh wrapper (86609) and `sleep 60` (86678) were **already gone**.
   - +3s: all three pids gone (`ps -p 81858,86609,86678` → no such process).
   - +8s: confirmed again, plus a system-wide `ps -axo pid,ppid,command | grep
"sleep 60"` found nothing anywhere.
   - No pid was ever observed reparented to PPID 1 at any sample.
5. Server log (`server-5.log`, excerpted in
   `vq10-1-grok-single-reap-server-log-excerpt.jsonl`):

   ```
   {"rootPid":81858,"descendantCount":10,"msg":"grok.tree_reap_armed"}
   {"pids":[81980,81981,81982,81984,81985,81986,86609,83549,85576,86678],"msg":"process_tree_reap.terminating_orphans"}
   ```

   The snapshot found **10** descendants (Grok's own MCP/helper subprocesses
   plus the zsh wrapper and `sleep 60`), and every one — including `86609`
   and `86678`, the exact pids from the pre-abandon snapshot — was targeted
   for termination. No `process_tree_reap.sigkilled_orphans` line followed,
   meaning every descendant died within the SIGTERM grace window; no
   escalation to SIGKILL was needed.

This reproduces the exact round-10 finding (`gs2`: the tool's `sleep 20`
process orphaned to PPID 1, alive at +3s and +8s, gone only at its natural
end) and shows the fix closes it: the whole descendant tree, not just the
`grok --single` root, is gone within 1-3 seconds of Abandon, and nothing is
ever reparented to init.

## Side effects

Grok wrote session files under the real `~/.grok/sessions/` (`grok` ignores
`ARCHON_HOME`), matching every prior round's observation. Left in place.

Full run detail: not saved separately — the process-tree evidence above is
the load-bearing artifact for this finding (VQ10-1 is about OS-level process
reaping, not workflow_events content).
