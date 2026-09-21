---
name: test-windows
description: Reproduce, diagnose, fix, and prevent native Windows CI failures with the local Parallels Windows VM. Use this skill for Windows-only test failures, path or line-ending defects, process behavior differences, and pre-PR Windows validation.
---

# Test Windows

Use `scripts/test-windows.ts` as the single entry point for Windows checks.
It points the read-only Parallels share `archon-src` at the current repository, syncs the current worktree into a managed Windows checkout, keeps normal Windows checkout line endings, uses the CI Bun version, and restores the VM power state.
The runner creates or updates the share only while the VM is fully stopped.
It does not edit or interrupt a VM that is running or suspended.

## Workflow

1. Reproduce the failure with the smallest end-to-end command that uses the real Windows runtime.

   ```bash
   bun run scripts/test-windows.ts -- test packages/git/src/git.test.ts
   ```

2. Read the printed log path and identify the first independent failure.
Treat later timeouts, locked files, and dangling processes as possible cascade failures.

3. Trace every caller of the failing function before editing it.
Fix the shared production seam when Windows changes real behavior.
Fix the fixture when it assumes a POSIX-only facility, such as privileged symbolic links or extensionless executables.
Do not skip a Windows test when a native equivalent can keep the same coverage.

4. Leave the smallest regression check that fails on the old behavior.
Use a focused existing end-to-end test when it already covers the branch.

5. Run the focused Windows command again.
Then run the complete Windows CI sequence.

   ```bash
   bun run scripts/test-windows.ts
   ```

6. Run the normal host validation after Windows passes.
Use `bun run test`, never `bun test` from the repository root.

7. Before the final response, remove the managed Windows checkout and test logs, even when a test failed.
Delete only `C:\dev\archon-windows` and `C:\dev\archon-windows-logs` after you have read the required logs.
If the VM is not running, start it for cleanup and restore its previous power state afterward.
Use the configured VM name and fail loudly when cleanup cannot remove either managed path.

   ```bash
   windows_vm_name="${ARCHON_WINDOWS_VM:-Windows 11}"
   windows_cleanup_command='$paths = @("C:\dev\archon-windows", "C:\dev\archon-windows-logs"); foreach ($path in $paths) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop } }'
   windows_cleanup_encoded="$(printf '%s' "$windows_cleanup_command" | iconv -f UTF-8 -t UTF-16LE | base64)"
   /usr/local/bin/prlctl exec "$windows_vm_name" --current-user powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "$windows_cleanup_encoded"
   ```

8. Add a short lesson here only when a new root cause applies to more than one test.
Do not copy failure logs into this skill.

## Durable Windows Lessons

- Use directory junctions in tests that need a directory link without Windows developer mode.
- Pass shell scripts to Git Bash as files because inline command strings can rewrite backslashes.
- Keep tests that mutate the same process-wide environment variable in separate Bun invocations.
- Do not call `unref()` on a timer that is required to settle a pending promise.
- Finalize SQLite statements before immediate test-directory cleanup.
- Use native Windows command wrappers when a test must control or terminate a child process.
- Apply worktree patches to the Git index before materializing files when the base commit contains a path that NTFS cannot represent.
- Do not install a Unix signal handler in a Windows fixture when the test relies on native hard termination.
- Await bounded cleanup retries when Windows still holds a finished fixture path.
- For interactive subprocesses, use an atomic exit sidecar and an attached Windows waiter when Bun does not report the process exit.
- Increase a timeout only when the same real integration operation passes alone and fails under CI-level process contention.

## Setup Failures

Use the VM name from `ARCHON_WINDOWS_VM` when it is not `Windows 11`.

The VM must have Bun 1.3.11, Git for Windows with Git Bash, and Python 3.
Install Python for the current Windows user with this command when it is missing:

```powershell
winget install --id Python.Python.3.13 --exact --scope user
```

The runner creates or updates a read-only Parallels share named `archon-src` when the VM is fully stopped.
If the share is stale while the VM is running or suspended, save the guest work and shut down Windows before retrying.
To configure it manually, use this command:

```bash
prlctl set "${ARCHON_WINDOWS_VM:-Windows 11}" --shf-host-set archon-src --path "$PWD" --mode ro --enable
```

Use `--shf-host-add` instead of `--shf-host-set` when the share does not exist yet.
