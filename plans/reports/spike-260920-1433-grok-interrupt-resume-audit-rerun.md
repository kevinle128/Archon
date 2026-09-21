# Grok interrupt/resume diagnostic audit rerun

- **Date**: 2026-09-20
- **Issue**: #186
- **Scope**: B7 and B9 only; this is not a replacement for the required full host matrix.
- **CLI**: `grok 1.0.34 (3736acbc8658) [stable]`
- **Host**: native macOS arm64
- **Bun**: `1.3.14`

## Corrected runner contract

The diagnostic now launches the CLI with `Bun.spawn()` and the same `buildGrokArgs()` / `buildSpawnCommand()` path as the provider. Owned-tree mode uses Bun's detached POSIX process group. It timestamps a mid-tool Stop when the fixed PID-file boundary is reached, rather than when the turn starts, and treats a reaping zombie as exited rather than as a live descendant.

## Results

| Scenario                    | Exit | Stop to settlement | SIGKILL | Descendants alive | Result  |
| --------------------------- | ---- | ------------------ | ------- | ----------------- | ------- |
| B7 owned-tree mid-tool Stop | 143  | 120 ms             | false   | true              | BLOCKED |
| B9 owned-tree node Cancel   | 143  | 94 ms              | false   | true              | BLOCKED |

The exact pre-signal descendant fingerprints were B7: `pid=3508;start=Sun Sep 20 14:40:03 2026`, `pid=3512;start=Sun Sep 20 14:40:03 2026`, and `pid=3513;start=Sun Sep 20 14:40:03 2026`; B9: `pid=4203;start=Sun Sep 20 14:40:19 2026`, `pid=4207;start=Sun Sep 20 14:40:19 2026`, and `pid=4208;start=Sun Sep 20 14:40:19 2026`. They were still live after the detached-group signal and the grace polls. The runner cleaned up only those exact fingerprints after recording the failed gate.

## Verdict

The earlier above-one-second B7/B9 measurements were a diagnostic timestamping defect, not provider-settlement evidence. The corrected runs meet the timing bound but still fail the required tree-reap invariant. The old Node-spawn observations for the remaining macOS cases are superseded pending a full current-Bun rerun. Native Linux and Windows evidence is also still required. Keep `GROK_CAPABILITIES.interrupt` false and do not start Phase 2.
