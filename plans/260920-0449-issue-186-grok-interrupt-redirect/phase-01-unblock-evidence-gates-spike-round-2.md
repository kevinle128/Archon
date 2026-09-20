---
phase: 1
title: "Unblock evidence gates (spike round 2)"
status: pending
priority: P1
effort: "1-1.5d"
dependencies: []
---

# Phase 1: Unblock evidence gates (spike round 2)

## Goal

Turn the two BLOCKED release gates from PR #217 into PASS-with-evidence or an explicit recorded decision, and measure the four numbers Phase 2 hard-codes: the session-materialization boundary `M`, `INTERRUPT_ARM_TIMEOUT_MS`, the interrupt grace, and the process-group/Windows termination path. No production code changes in this phase.

## Context links

- Spike round 1 evidence: issue #186 comment (2026-09-20) and `plans/reports/spike-260920-0243-grok-interrupt-resume.md` on branch `archon/thread-e5318172`.
- Spike runner: `packages/providers/src/grok/interrupt-resume-spike.ts` (same branch; `runGrokTurn` at ~L394, `runS2` at ~L768, gate table at ~L885).
- Production spawn and argv: `packages/providers/src/grok/provider.ts:58-74` (`defaultSpawner`), `:83-88` (`buildSpawnCommand`), `:110-154` (`buildGrokArgs`).
- Executor fail-fast on missing interrupted session id: `packages/workflows/src/dag-executor.ts:3554-3561` (direct), `:7176` (loop).
- Sibling spikes for shape: `packages/providers/src/claude/interrupt-resume-spike.ts`, `packages/providers/src/codex/interrupt-resume-spike.ts`, `packages/providers/src/community/deepseek/interrupt-resume-spike.ts`.

## Key insights from round 1

- S2 exited in 0 ms after SIGTERM with `firstStdoutAtMs === null`: the CLI never started, so no session could have been written. The gate as written ("context retained") is unsatisfiable for a turn whose prompt never reached the model. Round 2 must locate the **earliest event after which the assigned session resumes**, not retest 0 ms.
- S1 (mid-tool) and S3 (mid-text, repeated Stop) resume the same id with retained context — the boundary lies between "no stdout" and "first assistant text".
- Gate 3: signal→exit was 6 ms / 7 ms; the 5 000 ms grace is cleanup insurance, not latency.
- Gate 4: the slow-tool grandchild survived. Bun 1.3.14 in this worktree accepts `Bun.spawn({ detached: true })`, and `process.kill(-pid, 'SIGTERM')` reaps the grandchild (verified 2026-09-20 with a `sh -c 'sleep 30 & …'` probe).
- The round-1 runner passed `--sandbox workspace` and `--no-auto-update`; production `buildGrokArgs` passes neither. Round 2 must run the **production argv shape** (plus `--session-id`) for the signal/session path so the evidence matches what ships; the sandbox and tool-restriction flags stay as the one recorded spike-only delta (see Refactor step 1).
- CI has no Windows runner (`.github/workflows/test.yml:17`; comment at `:64` notes it may be re-added).

## Files to create / modify

| File | Action | Size | Test impact |
|------|--------|------|-------------|
| `packages/providers/src/grok/interrupt-resume-spike.ts` | cherry-pick from `archon/thread-e5318172`, then modify | +150–250 lines | diagnostic only, not in `test` script |
| `packages/providers/package.json` | cherry-pick `spike:interrupt:grok` script | 1 line | none |
| `plans/reports/spike-260920-0243-grok-interrupt-resume.md` | cherry-pick (round-1 evidence, unchanged) | — | none |
| `.github/workflows/grok-interrupt-spike-windows.yml` | create (`workflow_dispatch` only, `windows-latest`) | ~60 lines | not part of `test.yml`; never runs on push/PR |
| `plans/reports/spike-<yymmdd-hhmm>-grok-interrupt-resume-round-2.md` | create | ~120 lines | evidence artifact |
| `plans/260920-0449-issue-186-grok-interrupt-redirect/plan.md` | modify (record Phase 1 values in the Validation Log) | small | — |

## Requirements

- [ ] R1 Find `M`: the earliest stream event after which `--resume <assigned-id>` succeeds and the planted context token is retained.
- [ ] R2 Re-prove S1/S3 under the production spawn shape (`detached: true`, group SIGTERM, production argv) — resume and child-reap both hold.
- [ ] R3 Measure `firstStdoutAtMs` across ≥5 cold runs to set `INTERRUPT_ARM_TIMEOUT_MS` with margin.
- [ ] R4 Produce native Windows S4 evidence under the real `cmd.exe /d /s /c grok.cmd` launch path, or record precisely why it could not be produced.
- [ ] R5 Re-confirm the version floor against the build under test; if a newer stable build is available, also run S2/S2b/S2c on it.
- [ ] R6 Sanitized report with a gate table; no prompts, model output, home paths, or session contents; delete only spike-created sessions.

## Tests before (characterization gates that must still hold)

Run the cherry-picked runner unchanged first to confirm round-1 results reproduce on this machine before adding scenarios:

```bash
cd packages/providers
GROK_SPIKE_ONLY=S0,S1,S3 bun run spike:interrupt:grok
```

Expected: S0 PASS (id echoed), S1 resume same/retained = true/true with `childAlive=true`, S3 same/retained = true/true. If S1's grandchild no longer survives, the round-1 process-group decision is stale — record it, do not skip D2.

## Refactor (runner changes)

1. **Production argv parity, one recorded delta.** Replace the runner's `buildHeadlessArgs` with a call into the real `buildGrokArgs` (export is already public) plus the `--session-id` flag, so the signal/session path matches what ships. The spike then **always appends** `--sandbox workspace`, `--no-auto-update`, and an explicit tool allow/deny list (`--tools run_terminal_command` only for S1/S1g, `--disallowed-tools` shell for the others). Record this as the single deliberate delta from production in the report: the sandbox confines file access and does not touch signal or session semantics, and the spike's threat model (real credential, `bypassPermissions`, CI runner) is not production's trusted single-tenant runtime (red-team #1).
2. **Production spawn shape.** Add a `spawnMode: 'legacy' | 'detached-group'` switch. `detached-group` uses `Bun.spawn({ detached: true, … })` and signals with `process.kill(-pid, sig)`; `legacy` keeps the Node `child_process` path for A/B comparison. Default to `detached-group`.
3. **Boundary scenarios** in `runGrokTurn` via a single `interruptAt` option replacing `interruptImmediately` / `interruptOnFirstText`:
   - `'spawn'` (S2, retained for comparison),
   - `'first-stdout-line'` (**S2b**: any event, typically `available_commands`),
   - `'first-event:thought'` (**S2c**),
   - `'first-event:text'` (S3 equivalent),
   - `'pid-file'` (S1),
   - `'spawn'` with `resumeSessionId` set (**S3b**).
   Each records `firstStdoutAtMs`, `interruptAtMs`, `signalToExitMs`, `usedSigkill`, exit code, `resumeExit`, `resumeSameSession`, `resumeContextRetained`.
4. **S1g** — S1 under `detached-group`: assert the exact grandchild PID is gone within 1 s of parent exit without manual SIGKILL, and that same-id resume still works.
5. **Cold-start sampling** — `S0×5` loop recording `firstStdoutAtMs`; report min/median/max.
6. **Gate table update.** Gate 2 becomes "S1g, S2b-or-S2c, S3 resume same session with retained context" and names the chosen `M`. Add gate 8: "M boundary identified and ≤ 2 s after first stdout". Keep gates 1, 3–7 as round 1 defined them.
7. **Windows job.** `.github/workflows/grok-interrupt-spike-windows.yml`: `on: workflow_dispatch` only; `runs-on: windows-latest`; hardened per red-team #1/#4/#5:
   - `permissions: contents: read`; checkout with `persist-credentials: false` (repo convention, see `.github/workflows/e2e-smoke.yml`); bind the job to a protected `environment:` requiring manual approval so a dispatch on an arbitrary ref cannot run with the secret unreviewed.
   - Install Bun and the Grok CLI **pinned to the floor release with a checksum** (confirm the public installer/package name from the Grok docs — a Phase 1 task) in a step that runs **before** any secret is in scope.
   - Export `XAI_API_KEY` from the repository secret only in the spike step; `echo "::add-mask::"` it first. Run `GROK_SPIKE_ONLY=S0,S4 GROK_SPIKE_HOST_KIND=native bun run spike:interrupt:grok` with stdout/stderr captured to files.
   - A post-step fails the job if the captured stdout, stderr, or rendered report contains the secret value (`Select-String -SimpleMatch` on the literal); only then upload the report as an artifact.
   - Fail loudly if the secret is absent rather than skipping S4 silently.

## Tests after (round-2 experiments — these are the phase's tests)

| ID | Host | Scenario | PASS condition |
|----|------|----------|----------------|
| S0×5 | macOS native (+ Linux native if available) | cold start, assigned id | exit 0, id echoed, `firstStdoutAtMs` recorded per run |
| S1g | macOS native | mid-tool SIGTERM, `detached-group` | exit 143, no SIGKILL, grandchild gone ≤ 1 s, resume same/retained |
| S2 | macOS native | SIGTERM at spawn (control) | recorded; expected to still FAIL resume |
| S2b | macOS native | SIGTERM at first stdout line | exit 143/130, no SIGKILL, resume same = true; retained recorded |
| S2c | macOS native | SIGTERM at first `thought` | same as S2b |
| S3 | macOS native | repeated Stop on S1g session, `detached-group` | resume same/retained |
| **S3b** | macOS native | resumed turn on the S1g session, SIGTERM **at spawn** (pre-stdout) | exit 143/130, no SIGKILL, `--resume <same-id>` succeeds and the S1g context token is retained (red-team #16) |
| S4 | **windows-latest** (native) | S1-style and S2b-style under `cmd.exe … grok.cmd` | graceful exit, same-id resume, no orphaned `node`/`grok` process (check with `tasklist`) |

Decision rules:

- `M` = the earliest of {first-stdout-line, first `thought`, first `text`} whose scenario passes resume **same session**. Context retention at `M` is recorded; if the prompt was not yet persisted at `M`, Phase 2 documents that a Stop before the first model output loses the original prompt text (the operator's `Send now` message becomes the turn's content) — this is acceptable only if `M` is also before any model output, otherwise choose the later marker.
- Resumed-turn policy: if S3b passes, Phase 2 fires Stop immediately on resumed turns (no `stop-pending`) and settles on `resumeSessionId`; if it fails, resumed turns use the same `M`-armed path as fresh turns.
- `INTERRUPT_ARM_TIMEOUT_MS` = max(30 000, 3 × max observed `firstStdoutAtMs`), rounded to the nearest 5 s. Record the samples in the report.
- Interrupt grace stays 5 000 ms unless any graceful exit exceeded 1 000 ms; then double the slowest observed and justify.
- Process group: D2 stands if S1 (legacy) shows a surviving child **or** S1g shows the group kill is required. Record the Windows termination path from S4 (expected: `taskkill /T /PID` equivalent or Bun's own tree kill — whatever S4 proves; nothing is inferred).

## Implementation steps

1. `git fetch origin archon/thread-e5318172` and cherry-pick the commit(s) that add the runner, the package script, and the round-1 report. Do **not** bring `plans/260919-1924-…` or `prd.*`/`progress.txt`.
2. Run the "Tests before" reproduction.
3. Apply the runner refactor (steps 1–6 above); type-check the providers package.
4. Run S0×5, S1g, S2, S2b, S2c, S3, S3b on macOS native. Repeat on native Linux if a host is available (Docker with `--sandbox workspace` is not evidence and is no longer needed once argv parity drops the flag — retry Docker Linux once; if it runs, record it as *container*, not native).
5. Check `grok --version` against the latest stable; if newer, install side-by-side (`GROK_SPIKE_BIN_PATH`) and repeat S2/S2b/S2c.
6. Create the Windows workflow; ask the repository owner to add `XAI_API_KEY` as a secret and trigger it once; download the artifact. If the secret or an xAI credential cannot be provided, record that verbatim as the reason gate 5 stays open.
7. Write the round-2 report and update the plan's Validation Log with: build tested, `M`, arm timeout, grace, group decision, resumed-turn policy (S3b), Windows verdict, floor.
8. Post the sanitized gate table as an issue #186 comment (same format as round 1).

## Todo

- [ ] Cherry-pick runner + script + round-1 report
- [ ] Reproduce S0/S1/S3 unchanged
- [ ] Runner: argv parity, `detached-group`, `interruptAt`, S1g, S0×5, gate table
- [ ] macOS native run of all scenarios
- [ ] Newer-build check and rerun if applicable
- [ ] Windows `workflow_dispatch` job + one triggered run (or recorded blocker)
- [ ] Round-2 report + Validation Log values + issue comment

## Regression gate

```bash
cd packages/providers && bun run type-check && bun test src/grok/provider.test.ts src/grok/event-parser.test.ts
cd ../.. && bun run lint --max-warnings 0 && bun run format:check
```

The spike file is excluded from the package `test` script; the gate proves it compiles and did not disturb the existing Grok suites.

## Exit criteria (stop-or-decide)

Phase 2 may start only when one of these is true and recorded in `plan.md` → `## Validation Log`:

1. Gates 1–8 all PASS (Windows included), or
2. Gates 1–4, 6–8 PASS and the operator has recorded a Windows decision from the validation interview: *(a)* block until native evidence exists, *(b)* ship POSIX-only with a documented runtime posture for win32 (Phase 2 then adds the explicit win32 branch the decision names), or *(c)* scope Windows out of Story 2.6.

If S2b **and** S2c both fail resume, stop: options are a newer Grok CLI (step 5) or a product revision of the promise ("Stop is honoured from the first model output"). Bring that fork to the operator; do not pick `M = first text` silently.

## Risk assessment

- **xAI credential in CI** — an API key secret is the only way to run S4 headlessly. Mitigation: the job is `workflow_dispatch` only and uploads a sanitized report; the runner never prints tokens or prompts.
- **Auto-update drift** — Grok CLI self-updates; record the exact build string in every report and pin `GROK_SPIKE_BIN_PATH` where possible.
- **Session dir side effects** — the runner deletes only the UUIDs it created via `grok sessions delete`, from the same temp cwd.

## Security considerations

Spike prompts are nonce tokens, not user data. Reports omit credentials, prompt/model text, home paths, and session contents. The Windows job must not echo `XAI_API_KEY`.

## Next steps

Phase 2 copies the recorded values into its "Entry gate" block before touching production code.
