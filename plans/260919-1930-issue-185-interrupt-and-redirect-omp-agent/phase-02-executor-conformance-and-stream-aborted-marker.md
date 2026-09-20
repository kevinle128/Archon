---
phase: 2
title: 'Executor conformance and the stream_aborted marker'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1]
---

# Phase 2: Executor conformance and the `stream_aborted` marker

## Goal

Add OMP's deterministic graceful-interrupt marker to the existing five-case classifier and prove that direct and AI-loop executions idle, redirect, and continue on the same session without changing unrelated executor behavior.

## Files

| File                                          | Change                                             |
| --------------------------------------------- | -------------------------------------------------- |
| `packages/workflows/src/dag-executor.ts`      | import shared marker, extend marker set/comment    |
| `packages/workflows/src/dag-executor.test.ts` | OMP-shaped direct and AI-loop conformance fixtures |

No server, route, registry, persistence, or UI production file changes are expected. Stop and reassess the plan if implementation requires one.

## Implementation contract

- Import `STREAM_ABORTED_TERMINAL_REASON` from `@archon/providers/types` and add it to `INTERRUPT_TERMINAL_REASONS`.
- Update the nearby comment to describe two provider-native Claude reasons plus a provider-normalized stream-abort reason. Keep the rule deterministic: never match assistant prose, stderr substrings, or prefixes.
- Do not change `isAbortLikeStreamError`; `Query aborted` remains a recognized defensive thrown shape.
- Do not branch on `'native'` versus `'stream-abort'`. The existing capability check `interrupt !== false` and common idle-await behavior own both.
- Do not alter queue ordering, Cancel placement, validation bypass, status persistence, idle timeout, or session selection.

The #183 test helper currently accepts only `claude | pi` and special-cases Pi configuration. Widen it narrowly for OMP and add `omp: {}` in the test config; the OMP provider is already registered at module load while `getAgentProvider` remains mocked, so no binary is launched. Do not parameterize the full Claude matrix or add a loop-group duplicate.

## Test matrix

Use OMP-shaped async generators that react to the supplied per-turn `interruptSignal`.

| Scenario                                                          | Path               | Required evidence                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marked result after Stop                                          | direct             | idle reached; node still running; open tool settles `interrupted` once; one interrupted status; no `node_failed`; `Send now` drains old then new messages; second call uses the same session id and completes |
| marked result after Stop                                          | AI loop            | current iteration idles; no iteration/completion check is consumed before redirect; second call uses the same session id; loop then completes normally                                                        |
| marked result lacks first-turn session                            | direct and AI loop | each path's explicit “no session id to resume” failure fires; no fresh session or silent guidance loss                                                                                                        |
| marked result has `isError: true`                                 | direct             | marker plus operator flag wins and idles, preserving the established case-2 rule                                                                                                                              |
| marked result without operator flag                               | direct             | natural result path; no idle and no interrupted status                                                                                                                                                        |
| force-kill/unmarked provider error with operator flag             | direct             | existing error path fails the node; the flag alone cannot convert failure to interrupt                                                                                                                        |
| natural result races Stop                                         | direct             | natural completion/queued auto-drain behavior remains unchanged                                                                                                                                               |
| thrown `Query aborted` after an earlier result supplied a session | direct             | case 3 idles and resumes that known id; no `node_failed`                                                                                                                                                      |
| thrown `Query aborted` with no known session                      | direct             | interrupt classification occurs but the existing explicit session safety check fails                                                                                                                          |
| redirected result reports `resumed: false` and a new observed id  | direct             | existing cold-resume warning is recorded; executor uses the observed id and remains governed by current compatibility behavior                                                                                |
| OMP capability pin                                                | direct             | mock provider receives a defined interrupt signal and the projected sub-state is `generating`                                                                                                                 |

Also assert the terminal marked result carries no `structuredOutput` into output validation and that usage/model captured before classification remains accounted once; these are shared-contract regressions already covered for Claude but must be pinned for the OMP-shaped result.

## Test order

1. Run the existing `interrupt and redirect` subset and record a clean baseline.
2. Add the unflagged-marker and unmarked-force-kill cases first; both must remain natural/failure after the marker is recognized.
3. Add direct and AI-loop OMP cases and confirm they fail because `stream_aborted` is not yet recognized.
4. Make the marker-set/comment change only.
5. Run the focused subset, full executor file, steering registry tests, and workflows type-check.

## Commands

```bash
cd packages/workflows
bun test src/dag-executor.test.ts -t 'interrupt and redirect'
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts
bun run type-check
```

## Completion gate

- Every matrix row is green in both independently implemented executor paths.
- Existing #183 cases remain green and no loop-group behavior changes.
- Production executor diff is limited to the shared marker import/set/comment.
