# Grok interrupt/resume spike evidence

- **Overall**: **BLOCKED**
- **Date**: 2026-09-20
- **Issue**: #186
- **CLI version (exact)**: `grok 1.0.34 (3736acbc8658) [stable]`
- **Binary basename**: `grok`
- **Proposed grace**: 5000 ms (matches production `TERMINATION_GRACE_MS`)

## Environments

| Host               | Kind                                      | Result                 | Notes                                                                                                    |
| ------------------ | ----------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| macOS Darwin arm64 | native                                    | ran S0–S4 (S4 skipped) | primary evidence below                                                                                   |
| Linux arm64        | Docker container (`linuxkit`), not native | attempted S0–S2        | `--sandbox workspace` refuses start (`hooks-paths` verify / bwrap); not counted as native Linux evidence |
| Windows            | not available                             | S4 not run             | no native Windows host / Parallels VM in this environment                                                |

## Minimum version decision

Minimum supported CLI version floor: grok 1.0.34 (3736acbc8658) [stable] (exact tested build). Older builds unproven — doctor should fail below this floor until re-spiked.

## Process-group decision

Phase 2 MUST add POSIX process-group ownership — exact child PID survived parent exit

## Blocking questions (Phase 1)

1. **Does SIGTERM preserve a resumable session when Stop arrives immediately after spawn?** **NO on macOS 1.0.34.** S2 exits 143 in <1ms without SIGKILL, but same-ID resume fails (`resumeExit=1`, `resumeSameSession=false`). Earliest-stop same-session continuation is **not** proven — gate 2 BLOCKED.
2. **Does the real native Windows launch path exit gracefully and preserve the same session?** **UNPROVEN.** No native Windows host available in this run — gate 5 BLOCKED.
3. **Does Grok reap a long-running tool child and what grace interval reliably permits persistence?** Parent exits on SIGTERM in **~6ms** (well under 1s / 5s grace) **without SIGKILL**. Exact slow-tool child PID **survived** parent exit — Phase 2 **must** take POSIX process-group ownership. Resume after mid-tool Stop **does** work on the same session ID.
4. **What minimum CLI version can be supported and diagnosed honestly?** Tested floor: **`grok 1.0.34 (3736acbc8658) [stable]`**. Older builds unproven. Doctor should fail below this floor until re-spiked. Capability must **not** flip to `stream-abort` while gates 2 and 5 remain BLOCKED.

## macOS experiment table

| ID  | Passed | Exit | Signal→exit ms | SIGKILL | Session equal | Resume same/retained | Child alive | Standalone usage | Final usage |
| --- | ------ | ---- | -------------- | ------- | ------------- | -------------------- | ----------- | ---------------- | ----------- |
| S0  | True   | 0    | None           | False   | True          | None/None            | None        | True             | True        |
| S1  | False  | 143  | 6              | False   | None          | True/True            | True        | True             | False       |
| S2  | False  | 143  | 0              | False   | None          | False/False          | None        | False            | False       |
| S3  | True   | 143  | 7              | False   | None          | True/True            | None        | False            | False       |
| S4  | False  | None | None           | False   | None          | None/None            | None        | False            | False       |

### Event types (no payloads)

- **S0**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, available_commands, usage, end
- **S1**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, tool_call, tool_call_update, tool_call, tool_call_update, tool_call_update, tool_call_update, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, tool_call, tool_call_update, tool_call_update, resume:available_commands, resume:available_commands, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:thought, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:text, resume:available_commands, resume:usage, resume:end
  - notes: exact-child-pid-required-manual-sigkill | S1 checks: sigkill=false signalToExitMs=6 exit=143 childAlive=true resumeExit=0 resumeSame=true
- **S2**: (none)
  - notes: S2 checks: sigkill=false signalToExitMs=0 exit=143 resumeExit=1 resumeSame=false
- **S3**: available_commands
- **S4**: (none)
  - notes: not-run-on-non-windows-host

## Release gates

| #   | Gate                                                               | Status      | Evidence                                                                                                                                                                    |
| --- | ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | caller-assigned session IDs accepted and returned                  | **PASS**    | S0 exit=0 sessionIdEqual=True                                                                                                                                               |
| 2   | S1/S2/S3 resume same session with retained context                 | **BLOCKED** | S1resume=True/True S2resume=False/False S3resume=True/True                                                                                                                  |
| 3   | ordinary SIGTERM exits <1s inside grace without SIGKILL            | **PASS**    | S1ms=6 S2ms=0 sigkill=False                                                                                                                                                 |
| 4   | slow-tool child gone after parent exit (or process-group required) | **PASS**    | child survived parent exit — Phase 2 MUST own a POSIX process group and signal it                                                                                           |
| 5   | S4 native Windows under real launch path                           | **BLOCKED** | not-run-on-non-windows-host                                                                                                                                                 |
| 6   | minimum supported CLI version/floor explicit                       | **PASS**    | Minimum supported CLI version floor: grok 1.0.34 (3736acbc8658) [stable] (exact tested build). Older builds unproven — doctor should fail below this floor until re-spiked. |
| 7   | standalone/final usage presence recorded without inventing spend   | **PASS**    | S0:standalone=True,final=True; S1:standalone=True,final=False; S2:standalone=False,final=False; S3:standalone=False,final=False; S4:standalone=False,final=False            |

## Cleanup

- sessions deleted: 3 (UUIDs omitted when delete succeeded)
- sessions delete failed: 0
- temp dir removed: True

## Commands (shape only)

```text
grok --version
grok --single <nonce-prompt> --verbatim --cwd <temp-git-repo> \
  --output-format streaming-json --permission-mode bypassPermissions \
  --no-auto-update --sandbox workspace --session-id <uuid> \
  [--resume <uuid>] [--tools run_terminal_command]
# mid-tool: temporary slow_tool.sh writes its own PID; spike SIGTERMs parent; checks that exact PID
grok sessions delete <uuid>   # from the matching temp cwd only
```

## Runner

- `packages/providers/src/grok/interrupt-resume-spike.ts` (diagnostic-only; not exported; not CI)
- `packages/providers` script: `bun run spike:interrupt:grok`
- Optional env: `GROK_SPIKE_ONLY`, `GROK_SPIKE_REPORT_PATH`, `GROK_SPIKE_HOST_KIND`, `GROK_SPIKE_BIN_PATH`

## Sanitization

No credentials, prompt/model output, home paths, or session transcript contents. Session UUIDs listed only on delete failure.

## Verdict for Phase 2

**BLOCKED.** Do not flip `GROK_CAPABILITIES.interrupt` to `stream-abort`. Do not start Phase 2 production seam until:

1. earliest-stop (S2) same-session resume is proven on supported platforms, or product explicitly revises the promise;
2. native Windows S4 is proven under Archon’s real `.exe`/`.cmd`/`cmd.exe` launch path;
3. Phase 2 plans POSIX process-group ownership (child survival is already evidenced on macOS).
