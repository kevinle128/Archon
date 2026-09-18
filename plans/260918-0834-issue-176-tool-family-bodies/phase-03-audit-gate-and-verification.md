---
phase: 3
title: 'Phase 3: Audit, verification, and closeout'
status: blocked
priority: P1
effort: '1d after decision'
dependencies: [1, 2, audit-authority-decision]
---

# Phase 3: Audit, verification, and closeout

## Goal

Implement the read-only generic-fallback audit against the owner-designated corpus, wire a fresh-record threshold check into release before any version mutation, prove the shipped body path end to end and visually, run full validation, and close Story 1.3.

## Blocking decision

Repository history traces the original “production/deployment corpus” to a read-only measurement on 2026-09-09 of a 1.7 GB Mac mini SQLite database at `/Users/agent/.archon/archon.db` (22,867 tool rows across 31 runs and 2,369 names). It does not establish that machine as the continuing release authority. Archon is one single-tenant install per client, supports both SQLite and PostgreSQL, and now presents split call/result rows as logical cards. There is no existing release-audit directory, central corpus, denominator-migration decision, record freshness policy, or safe dialect-neutral read-only connection. The current local database cannot be substituted silently for the historical deployment.

Before the record or release hook is implemented, the product/release owner must decide:

- which install/corpus is authoritative;
- whether the historical raw-row denominator remains authoritative or the logical-card denominator below is ratified for current paired storage;
- which dialect(s) the command must support;
- how a releaser gets read-only access without putting credentials on the command line or in the record;
- the durable record path, retention policy, maximum age, and refresh owner;
- whether aggregate generic tool names may be committed, or only anonymous counts;
- for PostgreSQL, whether the approved read-only path is existing `psql` tooling or a declared root audit dependency; relying on the transitive `pg` install or importing `PostgresAdapter` is not acceptable.

Recommended decision: ratify one logical UI card per invocation as the denominator; use explicit read-only arguments for both deployed dialects; no implicit `~/.archon`/`DATABASE_URL` target; explicit `--record`; record version, UTC snapshot time, non-secret source identifier, dialect, denominator definition, generic/total counts, fraction, audit-source hash, and approved aggregates; release rejects missing, stale, source-hash-mismatched, empty, or `>=2%` records. If the intended policy retains raw rows or one designated SQLite reference corpus, document that narrower decision and implement it explicitly.

This blocker does not prevent Phases 1 and 2. It blocks audit implementation/tests that would bake in a denominator, choosing the live connection, committing a supposedly authoritative result, editing the release skill, and marking the story done. Do not implement both candidate metrics speculatively.

## Proposed audit semantics (requires denominator ratification)

The command must reproduce the UI's logical tool-card population, not count raw storage rows:

1. open the selected database in enforced read-only mode without importing Archon's adapters (they apply schema on construction);
2. start a consistent read-only snapshot/transaction appropriate to the selected dialect;
3. from `kind = 'tool'` rows, select only `id`, `workflow_run_id`, `node_id`, `seq`, payload `id`/`name`/`input`, an **output-key-present boolean**, and metadata `tool_phase`/execution occurrence/attempt, ordered by `(workflow_run_id, node_id, seq)`; use dialect-specific JSON projection so output bodies and unrelated metadata never leave the database;
4. validate those projections and construct the minimal structural `PairableMessage`, using an inert sentinel only when the output key was present so legacy result detection matches `payload.output !== undefined` without reading output content;
5. group per `(workflow_run_id, node_id)` and call `projectToolTranscript()` so current call/result rows pair exactly as the UI does;
6. for every projected `tool-card`, call `toolPresentation({name,input,output:undefined})` and count one denominator row; count `family === 'generic'` in the numerator;
7. aggregate generic sent names only if the owner approves them for the record;
8. fail closed on malformed rows or a zero-card corpus; never silently omit them.

Pending call-only and legacy result-only cards count because the UI presents each as one card. Text/status rows do not. Output is deliberately omitted: Phase 1 proves it cannot reclassify, and the audit must not pay body-normalization cost.

For scalability, page in stable keyset order inside the snapshot and hold only the current node group plus aggregates. Enforce a documented maximum tool-row count per node and fail with an actionable error before exceeding it; this preserves exact `projectToolTranscript()` semantics while bounding a pathological node. Do not load the entire corpus into memory. Page size and the per-node ceiling are fixed and tested, including a page boundary that splits a call/result pair.

Compare the threshold with integer arithmetic (`genericCards * 100 >= logicalCards * 2`) so exactly 2% fails without floating-point/rounding ambiguity.

## Command safety contract

The final flags depend on the blocking decision, but these behaviors do not:

- importing `scripts/audit-generic-fallback.ts` performs no argument parsing, connection, output, or file write; `main()` runs only under `import.meta.main`;
- no implicit database target and no default record write;
- default live invocation prints JSON/result only;
- recording requires an explicit output path/flag and atomic temp-file rename;
- record checking reads only the record and the current classification/pairing source set; it never opens a database;
- the release check validates schema, audit-source hash, freshness, nonzero denominator, and `<2%` before version/changelog mutation; the hash covers the classification and logical-pairing source files used by the audit, not just the CLI wrapper;
- SQLite uses a true readonly handle plus `PRAGMA query_only`; PostgreSQL, if selected, uses a direct client/session with read-only transaction—not `PostgresAdapter`;
- credentials, inputs/payload bodies, prompts, file paths, database URLs, and absolute database paths never enter stdout intended for commit or the record;
- errors use nonzero exit codes: policy failure distinct from invocation/data/access failure.

A versioned record should resemble the following, with location and optional names decided by the owner:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-18T00:00:00.000Z",
  "source": "approved-non-secret-id",
  "dialect": "sqlite",
  "denominator": "logical-tool-cards-v1",
  "auditSourceSha256": "...",
  "logicalCards": 1000,
  "genericCards": 10,
  "fraction": 0.01
}
```

`fraction` is informational; the checker recomputes from integers and rejects disagreement. The final record schema names the exact source files covered by `auditSourceSha256` in its versioned documentation.

## Files

| Path                                                                                | Action                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `scripts/audit-generic-fallback.ts`                                                 | create import-safe CLI, projection, aggregation, record/check behavior                            |
| `scripts/audit-generic-fallback.test.ts`                                            | create pure and subprocess safety/threshold/paging tests                                          |
| durable audit record path                                                           | create only after owner decision; do not use `docs/` for a stateful audit by default              |
| `.claude/skills/release/SKILL.md`                                                   | add pre-mutation record check only after authority/freshness are defined                          |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                             | replace Input/Output expectations with deterministic Read/file body and Raw swap on both surfaces |
| `e2e/ui/agent-tool-row-visual.spec.ts`                                              | extend Story 1.1 evidence for expanded file body, Raw state, 460px geometry/contrast/focus        |
| `plans/260918-0834-issue-176-tool-family-bodies/reports/implementation-evidence.md` | create commands/results, audit identity, screenshots/measurements                                 |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`          | move Story 1.3 to `done` only after all gates pass                                                |
| optional Story 1.3 evidence file                                                    | create only if a convention exists on the implementation baseline; none exists in this checkout   |

Do not add a package script alias unless the resolved release command is materially clearer with one. If added, test and use that exact alias in the release skill.

## Audit tests

After the denominator decision, use pure fixtures for projection/aggregation and subprocess tests for CLI safety. The table below assumes the recommended logical-card denominator. If the owner retains raw-row weighting, replace the first three pairing cases with fixtures proving the exact approved raw-row/name aggregation while retaining every safety, threshold, record, privacy, and scale case. Any SQLite fixture database lives in a temp directory, is passed explicitly, and is removed in `finally`. Scrub `ARCHON_HOME` and `DATABASE_URL` so a failed parse cannot fall through to user state.

| Priority | Case                                                                                     | Expected result                                                                        |
| -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| critical | two modern call/result pairs, a pending call, a legacy result-only row, text/status rows | four logical cards; raw rows are not denominator                                       |
| critical | call/result split across keyset pages                                                    | one paired card, no duplicate or loss                                                  |
| critical | same tool id in different nodes/runs                                                     | never cross-paired                                                                     |
| critical | exact 2%, below, above                                                                   | fail/pass/fail using integer comparison                                                |
| critical | default invocation                                                                       | prints only; no record created or changed                                              |
| critical | explicit record                                                                          | atomic versioned record with recomputable fraction/source hash                         |
| critical | import module in child process                                                           | no DB/file access and no output                                                        |
| critical | readonly fixture                                                                         | main DB bytes unchanged; no script-created journal/WAL/SHM; attempted write impossible |
| high     | missing/stale/hash-mismatched/malformed/zero record                                      | release check fails with actionable message                                            |
| high     | malformed payload/metadata row                                                           | audit fails closed and reports row identity without payload contents                   |
| high     | row with a very large output body                                                        | query projects only presence; output bytes never enter the audit process               |
| high     | generic names tied counts                                                                | deterministic count-desc/name-asc order, cap, and privacy policy enforced              |
| high     | selected dialect access failure                                                          | no fallback to another database or write-capable adapter                               |
| medium   | large generated fixture and node above the row ceiling                                   | bounded page/node memory, deterministic totals, and fail-closed ceiling                |

If PostgreSQL support is selected, add a test against the repository's existing PostgreSQL CI service or an isolated local test database with `default_transaction_read_only`; do not turn the SQLite fixture into false proof of both dialects.

## Release integration

After the owner decision and a real authoritative record:

1. put the record in the approved durable non-evergreen location;
2. add a mandatory `/release` step after repository-state validation and before version/changelog changes;
3. run only the record checker there—release must not unexpectedly connect to a client database;
4. failure explains how the authorized operator refreshes the record against the designated corpus;
5. never suggest lowering the threshold. A failed fraction requires inspecting measured generic names, adding evidence-backed aliases/tests in a separate scoped change, refreshing the record, and retrying release.

The release skill is a tracked source file and `check:bundled-skill` may require regeneration of its bundled derivative. Follow that command's diagnostics and include any machine-owned generated update; do not hand-edit generated output.

## E2E and visual verification

The deterministic fake provider currently emits one `Read` call with input path `HITL_TOOL_INPUT.txt` and output `HITL_TOOL_OUTPUT_VISIBLE`. Do not claim shell/generic E2E coverage or expand provider behavior solely for this story.

On both Console and Legacy:

- open the real Read row; assert file family, path header, visible preview output, and absence of Input/Output diagnostic disclosures;
- open Raw; assert the presented file body is replaced, exact payload is accessible, and closing Raw restores the file body;
- confirm the row remains collapsed initially and no body content exists before open;
- retain full-output behavior where the fixture supports it.

Extend the visual spec rather than creating a second harness. Its family/degraded-state gallery uses deterministic Playwright route fulfillment for transcript responses, exercising production React/CSS without changing the provider/server and without being mislabeled as server end-to-end coverage:

- at a measured 460px room width, assert body bar one-line geometry, Raw far right, body-box padding/radius/type, wrapped long content, and no room/page horizontal overflow;
- retain its existing viewport sweep (1440x1000, 1024x900, 768x900, 390x844) and assert the body remains usable without introducing a transcript breakpoint;
- measure text-primary/text-secondary/path/focus colors against the effective body background; syntax keyword/string/comment contrast is covered by deterministic rendered component or browser fixture evidence from Phase 2;
- verify Raw and summary accessibility name/expanded state, keyboard order, 24px targets, focus, and reduced-motion;
- write captures through Playwright `testInfo`, then link artifacts/measurements from the plan report.

All other body arms and attacks stay in deterministic unit/component tables. E2E proves integration, not every normalizer branch.

## Execution sequence

1. Obtain and record the audit-authority decision.
2. Add red pure/subprocess audit tests for the approved denominator, including page boundaries and import safety.
3. Implement the selected dialect access, approved denominator/aggregation, print/record/check paths, and run against a non-authoritative fixture.
4. Run against the authorized corpus, review sanitized aggregates, and explicitly record the result.
5. Add the pre-mutation release check and any required bundled-skill generated update.
6. Update HITL/visual specs for the actual merged #175 DOM; run locally because Playwright is outside `bun run validate`.
7. Run focused tests, full validation, and HITL. Create `reports/implementation-evidence.md` with exact commands/results and visual/audit identity, not payload contents.
8. Re-read Story 1.3 AC; only then move sprint status to `done` and close/link the issue through the normal PR workflow.

## Verification commands

Final audit commands are filled in after the decision; the invariant gates are:

```bash
bun test ./scripts/audit-generic-fallback.test.ts
bun run validate
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui:hitl
```

Do not run `bun test` from the repository root. `bun run validate` already invokes package-isolated tests plus `bun test ./scripts/`.

## Completion criteria

- [ ] Audit owner/corpus/dialect/access/record/freshness/privacy decision is recorded.
- [ ] Audit implements the owner-approved denominator exactly and fails closed on malformed/empty input.
- [ ] Default/import/check paths are non-mutating; live access is enforced read-only.
- [ ] Authoritative record is current, source-hash matched, nonzero, and below 2%.
- [ ] Release skill checks it before mutations and bundled-skill verification passes.
- [ ] Real HITL Read/file body and Raw swap pass on both surfaces.
- [ ] 460px, viewport sweep, contrast, focus, keyboard, a11y, and reduced-motion evidence is recorded.
- [ ] Focused tests, `bun run validate`, E2E typecheck, and local HITL pass.
- [ ] Evidence report exists and Story 1.3 sprint status is `done` only after every preceding item.

## Risks and responses

| Risk                                                 | Detection                                     | Response                                                                    |
| ---------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| A developer DB is mistaken for production authority  | source has no owner/policy                    | remain blocked; do not commit a misleading record                           |
| Audit mutates schema/database                        | constructor or query opens write-capable path | direct read-only client, query-only/read-only transaction, subprocess tests |
| Stale record passes after resolver changes           | source hash/freshness mismatch                | release check fails and requires authorized refresh                         |
| Modern rows are double-counted                       | fixture call+result denominator too large     | use `projectToolTranscript()` per run/node                                  |
| Corpus growth exhausts memory                        | generated fixture/page-boundary test          | keyset pages and one node buffer                                            |
| Playwright is green in validate but not actually run | command log lacks HITL                        | run and record standalone E2E command; CI job is additional evidence        |

## Rollback

Remove the release step and audit files/record while retaining UI bodies if audit operations must be rolled back. Remove the renderer/body commits separately if UI rollback is required. No schema, persisted row, or API rollback is needed.
