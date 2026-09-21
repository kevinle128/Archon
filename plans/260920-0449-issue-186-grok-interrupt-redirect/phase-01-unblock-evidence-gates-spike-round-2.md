---
phase: 1
title: 'Runtime evidence gate'
status: blocked
priority: P1
effort: 'implementation plus three native-host runs'
dependencies: []
---

# Phase 1: runtime evidence gate

## Goal

Repair the round-one diagnostic and determine whether the current Grok Build headless transport can satisfy Story 2.6 as written. This phase changes no production provider, executor, capability, route, or UI behavior.

The output is a sanitized report and completed `plan.md` validation log proving or blocking:

- a production-observable safe interrupt boundary `M`;
- current-turn prompt retention on new, resumed, and forked sessions;
- complete Stop settlement below 1,000 ms;
- exact descendant cleanup on POSIX and Windows; and
- the exact CLI build and native hosts tested.

## Starting evidence and corrections

Cherry-pick commit `2fb341bd` only. It contains:

- `packages/providers/src/grok/interrupt-resume-spike.ts`;
- `packages/providers/package.json` (`spike:interrupt:grok`); and
- `plans/reports/spike-260920-0243-grok-interrupt-resume.md`.

Do not cherry-pick PR #217's old plan, PRD, progress ledger, or checkpoint commits. Before extending the runner, reproduce its S0/S1/S2/S3 facts on native macOS and record any drift.

The round-one runner is not sufficient as written:

- it treats same-id resume with an **older** marker as proof for an interrupted resumed turn, so it does not prove that turn's current prompt survived;
- it never exercises `--resume <source> --fork-session --session-id <target>`;
- it measures SIGTERM after spawn and after first text, but does not find the earliest production-observable safe boundary;
- it uses spike-only sandbox/feature flags and a Node spawn shape rather than the production `buildGrokArgs`/Bun spawn path;
- its gate permits a surviving child merely by saying a process group will be needed; round two must actually prove the chosen tree-kill mechanism; and
- it does not test the approved sub-second end-to-end acknowledgement.

## Files

| File                                                               | Action                                              |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `packages/providers/src/grok/interrupt-resume-spike.ts`            | Cherry-pick, then refactor and extend.              |
| `packages/providers/package.json`                                  | Cherry-pick the diagnostic script only.             |
| `plans/reports/spike-260920-0243-grok-interrupt-resume.md`         | Preserve as immutable round-one evidence.           |
| `plans/reports/spike-<timestamp>-grok-interrupt-resume-round-2.md` | Add the sanitized native-host results and verdict.  |
| `plans/260920-0449-issue-186-grok-interrupt-redirect/plan.md`      | Fill the validation log only from the final report. |

Do not add a permanent credentialed GitHub Actions workflow. The diagnostic is operator-run from a reviewed commit on trusted macOS, Linux, and Windows hosts. That avoids making arbitrary branch code eligible to execute with `XAI_API_KEY`.

## Diagnostic design

### Use the production argument and spawn contracts

- Build each invocation through `buildGrokArgs()` and `buildSpawnCommand()` rather than maintaining a second flag implementation. Export only the minimal direct-module helper needed by the diagnostic; do not add a package-barrel export.
- Model safety restrictions as ordinary production node options (`allowed_tools`/`denied_tools`) so the actual argument builder owns them. Run in a disposable git repository with a fixed benign prompt.
- Disable the CLI auto-updater for reproducibility using the officially documented automation flag or environment variable and record that one deliberate difference. Do not assert that `--sandbox workspace` is semantically neutral; it already changed Linux startup behavior in round one, so it is not used for contract evidence.
- Add a `legacy` and `owned-tree` spawn mode. `owned-tree` must match the proposed production shape: a detached process group on POSIX and the exact Windows tree-control primitive being evaluated. Record exact parent and descendant process fingerprints, not process names.

### Make prompt-retention checks turn-specific

Every prompt plants a unique non-secret marker. A continuation succeeds only when it returns the exact markers expected for that session:

- fresh: current marker;
- resumed: inherited marker **and** current resumed-turn marker;
- fork: inherited source marker **and** current fork-turn marker; and
- repeated interrupt: every marker from the retained conversation, including the latest interrupted turn.

The report records booleans only, never marker values or model output. A same id with a missing current marker is a failure.

### Candidate boundary and latency sampling

Replace the `interruptImmediately` / `interruptOnFirstText` booleans with a typed trigger:

- `spawn` (negative control);
- `first-stdout-event` with the raw event type recorded;
- `first-event:<type>` for `available_commands`, `thought`, `text`, and `tool_call` as observed; and
- `pid-file` for the long-running tool scenario.

Separate the operator Stop request from the eventual termination trigger. The runner must support requesting Stop immediately after listener registration while deferring the actual tree signal until a candidate boundary. It records spawn-to-request, request-to-boundary, request-to-signal, signal-to-exit, request-to-provider-settlement, exit code, escalation, expected id, reported id, resume result, marker-retention booleans, and exact descendant cleanup.

Choose `M` as the earliest explicit event predicate that passes all identity and current-prompt checks for text-only, reasoning-first, and tool-first turns. A content-dependent event that some turns omit is not a valid boundary by itself; an `end` that arrives before `M` is natural completion. Then run at least 10 new-session, 10 resumed-session, and 10 forked-session samples per required host with Stop requested before `M` and termination deferred to `M`. Every request-to-settlement sample must be below 1,000 ms; report min/median/max by turn kind and host. There is no 30-second fallback or percentile-based waiver.

## Scenario matrix

| ID  | Scenario                                                                                              | Required result                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0  | New assigned session completes naturally                                                              | Exit 0; `end.sessionId` equals the assigned UUID; continuation returns the current marker.                                                                                                                     |
| B1  | New assigned session interrupted at spawn                                                             | Negative control: record failure/success without redefining the contract. It must never be counted as `M` unless current marker retention and latency both pass.                                               |
| B2  | New assigned session; Stop requested before each candidate boundary, signal deferred to that boundary | Identify earliest valid `M`; resume same id with the current marker; no KILL escalation; complete request-to-settlement path under 1,000 ms. Repeat with text-only, reasoning-first, and tool-first prompts.   |
| B3  | Existing session resumed; Stop requested before `M`, plus immediate-signal comparison at/after `M`    | Resume the same id and retain inherited + current markers. This decides whether resumed turns may signal immediately or must also wait for `M`; every production candidate stays under the full request bound. |
| B4  | Existing source forked with caller-assigned target; Stop requested before `M`                         | Target id resumes with inherited + fork markers; source session still resumes without the fork marker; full request-to-settlement path stays under 1,000 ms.                                                   |
| B5  | Repeated Stop on the same retained session                                                            | Each interrupted turn retains its new marker and one session id; no stale trigger/listener contaminates the next turn.                                                                                         |
| B6  | Mid-tool Stop in `legacy` mode                                                                        | Characterize whether the exact tool child survives; this is comparison evidence only.                                                                                                                          |
| B7  | Mid-tool Stop in `owned-tree` mode                                                                    | Parent and exact tool descendants exit; same target session and current marker resume; no manual cleanup required.                                                                                             |
| B8  | Natural completion races Stop                                                                         | Natural terminal `end` wins without a kill or an abort classification.                                                                                                                                         |
| B9  | Node-Cancel tree termination shape                                                                    | Exact descendants exit within the bounded grace; this does not need session resume.                                                                                                                            |
| W1  | B0–B9 through native Windows resolution (`.exe` or `.cmd`/`cmd.exe`)                                  | Same semantic results and exact tree cleanup using the recorded Windows primitive.                                                                                                                             |

Run the full matrix on native macOS, native Linux, and native Windows. Containers and WSL may be recorded as supplemental evidence but do not replace the corresponding native host. Use the same reviewed runner commit and Grok release version on all three; record any platform-specific build identifiers separately. A cross-version comparison is supplemental and cannot replace one common release passing all required hosts.

## Decision rules

Phase 2 may begin only when all of these are true:

1. B0–B9 pass on native macOS and Linux, and W1 passes on native Windows.
2. `M` is a production-parser predicate that covers every exercised first-progress shape without reading undocumented session internals or model prose.
3. Fresh, resumed, and forked continuations retain the interrupted turn's current marker.
4. Every pre-`M` Stop request-to-settlement sample for new, resumed, and forked turns is under 1,000 ms.
5. The exact process tree is gone after Stop and Cancel without broad process-name cleanup.
6. The report contains exact build/host/Bun versions, command shape, timing summary, and sanitized gate table.

If any rule fails, keep the plan status `blocked`, keep `GROK_CAPABILITIES.interrupt` false, and record the exact failed gate. Do not choose a later-but-slow boundary, POSIX-only publication, prompt-loss caveat, or fresh-session fallback. A transport change such as ACP would require a new evidence/design pass because it changes the existing provider contract.

One successful build establishes the **validated build**, not a minimum-version range. Check the official changelog/current stable and record both. Do not add a doctor rejection or support-floor constant from this phase alone.

## Security and cleanup

- Run only fixed diagnostic prompts in a disposable repository. The one tool scenario invokes a fixed sleep/PID helper created inside that repository.
- Scope `XAI_API_KEY` to the diagnostic process. Do not print environment values, raw stderr, prompts, markers, model text, session contents, absolute home paths, or command payloads.
- Bound stdout/stderr capture. Reports contain event types and booleans only.
- Delete only UUIDs created by the runner, from the matching disposable cwd. On failure, report unsafely retained UUIDs for manual cleanup without deleting unrelated sessions.
- Track and terminate only exact child fingerprints created by the runner. Verify start identity before cleanup to avoid PID-reuse damage.
- Remove the temporary repository in `finally`; report cleanup failures.

## Validation

```bash
cd packages/providers
bun run type-check
bun test src/grok/provider.test.ts
bun test src/grok/event-parser.test.ts

# Operator-run separately on each required native host.
GROK_SPIKE_REPORT_PATH=<host-specific-report> bun run spike:interrupt:grok

cd ../..
bun run lint --max-warnings 0
bun run format:check
```

The diagnostic is intentionally outside the package `test` script because it requires credentials, network access, and API spend. The offline gates still prove it compiles and does not alter current Grok behavior.

## Exit artifacts

- Immutable round-two report with a PASS/BLOCKED gate table.
- Completed validation log in `plan.md`.
- A concise issue #186 comment linking the sanitized report and stating the verdict.
- If PASS, the exact `M`, resumed-turn policy, tree primitives, grace, and timing ceiling copied into Phase 2 before production edits.
