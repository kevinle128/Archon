---
phase: 4
title: 'Capability, docs, and closeout'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1, 2, 3]
---

# Phase 4: capability, docs, and closeout

## Goal

Publish only the behavior proved by Phases 1–3: flip the static Grok interrupt capability as the final runtime change, regenerate the canonical matrix, document the tested semantics and failure boundaries, run full validation, write acceptance evidence, and move Story 2.6 to `done` last.

## Entry gate

All of the following are mandatory:

- the Phase 1 report is PASS on native macOS, Linux, and Windows;
- the validation log names `M`, exact build, host versions, tree primitives, latency samples, and grace;
- Phase 2 provider/parser suites pass with the capability still false;
- Phase 3 direct/AI-loop conformance and all existing interrupt tests pass; and
- no unresolved spec/UX conflict remains.

If any item is absent, do not flip the capability or mark the sprint row done.

## Files

| File                                                                       | Change                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/providers/src/grok/capabilities.ts`                              | Change `interrupt` from `false` to `'stream-abort'` as the final runtime edit. |
| `packages/providers/src/registry.test.ts`                                  | Assert Grok's published interrupt mode.                                        |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md`    | Regenerate; never hand-edit.                                                   |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`      | Add a concise Grok interrupt-and-redirect section.                             |
| `plans/reports/acceptance-<timestamp>-issue-186-grok-interrupt.md`         | Map every acceptance criterion to tests/evidence.                              |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Change only Story 2.6 from `backlog` to `done`, last.                          |

No `archon doctor` or version-floor constant is part of this story. `checkGrok()` already reports the installed version and verifies authentication. One successful build does not establish the oldest compatible build, and an advisory doctor failure would not enforce the runtime capability.

## Capability publication

1. Change `GROK_CAPABILITIES.interrupt` to `'stream-abort'`.
2. Update the Grok registry assertion to include `interrupt: 'stream-abort'`.
3. Run `bun run generate:capability-matrix` and inspect that only the Grok Turn interrupt cell changes as expected.
4. Run the provider and workflow focused suites again after the flip, because the executor now registers Grok steering handles in ordinary tests/runtime.

Do not make the capability platform-dependent. Phase 1 is cross-platform specifically because the registry metadata is static.

## Documentation contract

Under `## Grok Build`, document:

- `Stop` ends only the current Grok workflow turn; the node remains running and `Send now` continues the same session;
- queued guidance precedes the newly typed guidance in receipt order;
- an in-flight tool is shown as `⚠ interrupted` and files already written are not rolled back;
- this is interrupt-then-continue, not Grok hook/interjection soft-inject;
- the exact Grok build and native platforms validated by Phase 1, phrased as tested compatibility rather than an invented minimum version;
- how to check and update Grok (`grok --version`, `grok update --stable`) using the current official CLI surface;
- normal Stop acknowledgement is sub-second; inability to materialize a resumable session or graceful tree shutdown fails the node explicitly rather than silently starting fresh;
- a forced kill or session-id mismatch is a genuine provider failure, not a successful interrupt; and
- interrupted turns without a terminal `end` event may have no token/USD accounting because Archon does not estimate missing spend.

Do not document internal marker prompts, session storage paths, exact kill commands, unsupported host caveats, or a 30-second Stop wait. The separate existing idle-after-interrupt 30-minute **operator inactivity** timer is unchanged and should not be confused with provider shutdown.

## Acceptance report

Create a concise report containing:

- exact implementation commit, Grok/Bun versions, three native hosts, and Phase 1 report link;
- Story 2.6 criteria mapped to Phase 1 gates, P/T provider tests, G executor tests, generated matrix, and guide anchors;
- proof of same id and current-prompt retention on fresh/resumed/forked turns;
- min/median/max Stop latency and exact descendant-cleanup verdict per host;
- focused and full validation commands/results;
- known operational boundaries (no undo, no fabricated spend, provider failure on forced/unmaterialized/mismatch); and
- rollback steps.

Do not include credentials, prompts, model output, marker text, home paths, raw session contents, or report-only UUIDs that do not need manual cleanup.

## Final review checklist

Review the completed diff from these perspectives before changing sprint status:

1. **Product:** Stop affects one Grok turn, node remains running, explicit `Send now`, same-session continuation.
2. **Architecture:** optional provider signal/result only; no durable steering state or provider-id executor branch.
3. **Contracts:** no-signal args unchanged; exact result subtype; capability/matrix/docs agree.
4. **Security/reliability:** trusted-host evidence; bounded secret-free reports; exact tree targeting; Cancel/natural/fault precedence; no fresh fallback.
5. **Performance:** no background polling, per-turn version probe, daemon, or wait beyond the sub-second bound.
6. **Completeness:** fresh/resumed/forked, direct/AI-loop, mid-tool, races, all required native hosts.
7. **Testing:** focused, package, generated-doc, docs build, type/lint/format, and full validate pass.
8. **Operations/compatibility:** exact tested build/hosts documented; rollback starts with capability false; no migration.
9. **Maintainability:** one provider state machine, one exact normalized predicate, platform termination encapsulated behind the process wrapper.

Fix verified findings and rerun affected gates. Record any unresolved evidence as a blocker; do not waive it in the acceptance report.

## Validation sequence

```bash
cd packages/providers
bun test src/grok/event-parser.test.ts
bun test src/grok/provider.test.ts
bun test src/grok/usage-contract.test.ts
bun test src/registry.test.ts
bun run type-check

cd ../workflows
bun test src/dag-executor.test.ts -t 'grok conformance'
bun test src/dag-executor.test.ts -t 'interrupt'
bun run test

cd ../..
bun run generate:capability-matrix
bun run check:capability-matrix
bun run build:docs
bun run validate
```

Never run root `bun test`; `bun run validate` uses the repository's package-isolated test commands.

## Closeout order

1. Complete the acceptance report and nine-angle review.
2. Confirm the worktree diff contains only intended code/tests/docs/evidence/status changes and no credentials or raw live output.
3. Change only `2-6-interrupt-and-redirect-a-running-grok-agent` to `done` in `sprint-status.yaml`.
4. Re-run the lightweight generated-doc/status checks affected by the last edit.
5. Open the PR from this feature branch to `develop` using `.github/pull_request_template.md` and `Closes #186`; link both spike reports and the acceptance report.
6. Do not merge PR #217 with its current `Closes #186` body. Close it as superseded after its diagnostic commit/report are preserved here, or remove its closing keyword if repository history requires it to remain open.

## Rollback

Set Grok interrupt back to `false` first and regenerate the capability matrix. This prevents the executor from supplying `interruptSignal`, which restores the pre-feature spawn path. Revert the Grok predicate and guide section, then the dormant provider/parser seam if necessary. No data rollback or session rewrite is required.
