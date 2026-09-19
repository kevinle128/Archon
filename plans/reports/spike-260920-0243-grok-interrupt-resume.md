# Grok interrupt/resume spike evidence

- **Overall**: **BLOCKED**
- **Date**: 2026-09-20
- **Issue**: #186
- **CLI version (exact)**: `grok 1.0.34 (3736acbc8658) [stable]`
- **Binary basename**: `grok`
- **Proposed grace**: 5000 ms

## Environments

| Host               | Kind                         | Result                      | Notes                                                                                                 |
| ------------------ | ---------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| macOS Darwin arm64 | native                       | S0-S3 re-run by this review | Primary evidence below.                                                                               |
| Linux arm64        | Docker container, not native | S0-S2 attempted             | `--sandbox workspace` refuses start at `hooks-paths` verification; this is not native-Linux evidence. |
| Windows            | unavailable                  | S4 not run                  | No native Windows host or VM is available.                                                            |

## Method and sanitization

The diagnostic-only runner resolves the binary with `resolveGrokBinaryPath`, uses a fresh temporary git repository, caller-assigned UUIDs, `--no-auto-update`, and `--sandbox workspace`. Every continuation must output the exact non-secret context token given before the interruption; neither tokens nor model text are written to this report. The runner records only event types, IDs, timing, booleans, and usage presence. It deletes its exact created session IDs from the matching temporary cwd, terminates its exact child PID when necessary, and removes the temporary directory.

```text
grok --version
grok --single <nonce-prompt> --verbatim --cwd <temp-git-repo> \
  --output-format streaming-json --permission-mode bypassPermissions \
  --no-auto-update --sandbox workspace --session-id <uuid> \
  [--resume <uuid>] [--tools run_terminal_command]
grok sessions delete <uuid>   # from the matching temp cwd only
```

## macOS experiment table

| ID  | Passed | Exit | Signal-to-exit ms | SIGKILL | Session equal | Resume same / context retained | Child alive after parent | Standalone / final usage |
| --- | ------ | ---- | ----------------- | ------- | ------------- | ------------------------------ | ------------------------ | ------------------------ |
| S0  | true   | 0    | n/a               | false   | true          | n/a                            | n/a                      | true / true              |
| S1  | false  | 143  | 13                | false   | n/a           | true / true                    | true                     | true / false             |
| S2  | false  | 143  | 0                 | false   | n/a           | false / false                  | n/a                      | false / false            |
| S3  | true   | 143  | 12                | false   | n/a           | true / true                    | n/a                      | false / false            |
| S4  | false  | n/a  | n/a               | false   | n/a           | n/a                            | n/a                      | false / false            |

- S0 observed `available_commands`, `thought`, `text`, `usage`, and `end` events.
- S1 observed the same stream categories plus `tool_call` and `tool_call_update`; the exact slow-tool child survived its parent, then the spike reaped that exact PID. The same-session continuation passed the non-secret context-token check.
- S2 emitted no stdout before SIGTERM, exited in 0 ms without SIGKILL, and then failed same-ID resume. This reproduces the earliest-stop durability failure.
- S3 interrupted only after an assistant `text` event (rather than setup output) and passed the same-ID context-token continuation check.
- S4 was skipped because this host is not Windows. The runner uses the provider's `cmd.exe` wrapper for `.cmd`/`.bat` binaries and creates a Windows-compatible slow-tool helper, but this is not runtime proof.

## Minimum version and process decision

The conservative feature floor is the exact tested build, `grok 1.0.34 (3736acbc8658) [stable]`; older versions remain unproven. The doctor must reject earlier or unparsable versions if this feature is later approved.

The slow-tool child survived S1, so any later Phase 2 implementation must own and terminate a POSIX process group. The spike itself cleaned that exact PID; it does not claim the CLI reaped it.

## Release gates

| #   | Gate                                                                   | Status      | Evidence                                                                        |
| --- | ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| 1   | Caller-assigned session IDs accepted and returned                      | **PASS**    | S0 exited 0 and `end.sessionId` equalled the assigned UUID.                     |
| 2   | S1, S2, and S3 resume the same session with retained context           | **BLOCKED** | S1 true/true; S2 false/false; S3 true/true.                                     |
| 3   | Ordinary SIGTERM exits under one second, inside grace, without SIGKILL | **PASS**    | S1 13 ms and S2 0 ms, neither escalated.                                        |
| 4   | Slow-tool child is gone or Phase 2 has a process-group requirement     | **PASS**    | S1 child survived; POSIX group ownership is required.                           |
| 5   | S4 native Windows follows Archon's real launch path                    | **BLOCKED** | No native Windows evidence.                                                     |
| 6   | Minimum supported version is explicit                                  | **PASS**    | Exact tested build is the floor.                                                |
| 7   | Usage presence is recorded without fabricated spend                    | **PASS**    | S0 has standalone/final usage; interrupted turns record only observed presence. |

## Cleanup

- Sessions deleted: 3; UUIDs are omitted because all deletes succeeded.
- Session deletions failed: 0.
- Temporary repository removed: true.
- Surviving S1 child: exact PID reaped by the spike.

## Verdict for Phase 2

**BLOCKED.** Do not enable `GROK_CAPABILITIES.interrupt = 'stream-abort'` and do not begin the production seam until an explicit product/architecture decision revises the earliest-stop promise or a newer Grok CLI proves S2, and a native Windows S4 run proves Archon's real `.exe`/`.cmd`/`cmd.exe` launch path. Phase 2 must also include the evidenced POSIX process-group requirement if it is ever unblocked.
