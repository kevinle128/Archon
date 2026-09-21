---
phase: 4
title: 'Capability matrix, compatibility docs, validation, and closeout'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1, 2, 3]
---

# Phase 4: capability matrix, compatibility docs, validation, and closeout

## Goal

Publish only the capability proved by Phases 1-3, give operators actionable version/behaviour guidance, run the full repository gate, review the completed work against the product contract, and mark the story done last.

## Files

| File                                                                       | Action      | Purpose                                                                                                  |
| -------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md`    | regenerate  | Show Grok `stream-abort` from static capabilities                                                        |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`      | modify      | Document Stop/same-session continuation, minimum CLI version, written-file semantics, and update command |
| `packages/providers/src/grok/config.ts`                                    | modify      | Own the minimum supported stream-abort CLI version constant                                              |
| `packages/cli/src/commands/doctor.ts`                                      | modify      | Give configured older Grok CLIs an actionable compatibility diagnosis                                    |
| `packages/cli/src/commands/doctor.test.ts`                                 | modify      | Supported, older, and unparsable version cases                                                           |
| `plans/reports/acceptance-260920-0243-issue-186-grok-interrupt.md`         | create      | Map every acceptance criterion to evidence                                                               |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify last | Move only Story 2.6 from `backlog` to `done`                                                             |

The minimum-version value should have one owner. Prefer exporting a small constant from the Grok capability/config surface and importing it into doctor rather than duplicating a literal in production files. The generated capability matrix remains host-independent; do not make static capabilities depend on `process.platform`.

## Documentation requirements

The Grok guide must state:

- `Stop` ends the current Grok workflow turn and keeps the node running for `Send now` on the same session;
- an in-flight tool is shown as interrupted, and file changes already made by tools are not rolled back;
- this is interrupt-then-continue, not hook-based soft injection;
- the exact minimum Grok CLI version established by Phase 1 and how to check/update it;
- supported platforms exactly match Phase 1 evidence—do not claim Windows by inference;
- a forced termination or failed persistence is reported as a provider failure, not a successful interrupt;
- no-end interrupted turns may lack aggregate token/USD accounting because Grok emits authoritative spend on `end`; do not promise estimated cost.

The capability reference is generated. Change the capability constant, run the generator, and do not hand-edit its table cell.

## Doctor compatibility check

`checkGrok` already runs `grok --version` before `grok models`. Parse the documented version format, compare it with the Phase 1 floor without adding a dependency, and fail with an upgrade command/message before the authenticated-model probe when the version is older. If version output cannot be parsed, fail closed with the raw non-secret version string and upgrade guidance; do not claim stream-abort compatibility. This is an operator diagnostic when `archon doctor` (or setup's doctor pass) runs, not a hidden per-turn subprocess.

Tests cover:

1. exact minimum and newer versions pass and continue to `models`;
2. an older version fails before `models` with the required version and actual version;
3. unparsable output fails clearly;
4. unconfigured Grok still skips;
5. authentication failure behaviour remains unchanged after a supported version.

## Closeout sequence

1. Run focused CLI/provider/workflow tests and regenerate the capability matrix.
2. Update the Grok guide and run docs formatting/link checks included by repository validation.
3. Run `bun run validate`. Do not run `bun test` from the repository root; the root command bypasses package isolation and is explicitly unsupported.
4. Write the acceptance report with exact test names/commands, spike report link, tested platforms/version, known accounting boundary, and rollback.
5. Review the result again from all required perspectives:
   - product goal and user outcome;
   - architecture and technical correctness;
   - public and internal contracts;
   - security, reliability, and data integrity;
   - performance and scalability;
   - implementation completeness;
   - testing and verification;
   - operations, compatibility, migration, and rollback;
   - simplicity and long-term maintainability.
6. Resolve every review finding or record a blocker. Re-run affected focused checks and `bun run validate` after fixes.
7. Change only `2-6-interrupt-and-redirect-a-running-grok-agent` to `done` in `sprint-status.yaml`.
8. If opening a PR, use `.github/pull_request_template.md`, remove unused conditional sections/comments, include the spike and acceptance evidence, and add `Closes #186`. No Workflow Language Constitution citation is needed because YAML syntax is unchanged.

## Verification

```bash
cd packages/providers
bun test src/grok/event-parser.test.ts
bun test src/grok/provider.test.ts
bun test src/grok/usage-contract.test.ts
bun test src/registry.test.ts

cd ../workflows
bun test src/dag-executor.test.ts -t 'interrupt'
bun run test

cd ../cli
bun test src/commands/doctor.test.ts

cd ../..
bun run generate:capability-matrix
bun run check:capability-matrix
bun run validate
```

No schema file changes are planned, so `check:schema-upgrades` is not applicable. If implementation unexpectedly changes a schema or migration, stop and revise the plan before continuing.

## Acceptance report contents

- goal and final behaviour;
- AC-by-AC evidence from [plan.md](./plan.md);
- Phase 1 report path, exact CLI version, platforms, grace interval, and process-group outcome;
- focused and full validation commands with pass/fail status;
- docs/capability/doctor evidence;
- explicit statement that no route, schema, YAML surface, or UI source changed;
- accounting limitation for no-end interrupts;
- rollback steps and any residual risk.

## Completion checklist

- [ ] Capability matrix regenerated and check passes
- [ ] Grok guide documents behaviour, minimum version, platform support, and failure/accounting boundaries
- [ ] Doctor gives actionable compatibility results and tests pass
- [ ] Focused provider/workflow/CLI suites pass
- [ ] `bun run validate` passes without hidden or retried failures
- [ ] Acceptance report maps every criterion to evidence
- [ ] Nine-perspective final review completed and findings resolved
- [ ] Sprint status changed to `done` last
- [ ] PR template and `Closes #186` used if a PR is opened

## Rollback

Revert the capability to `false`, regenerate the matrix, and revert the user guide/doctor minimum check if the feature is withdrawn. No database or session-data rollback is required.
