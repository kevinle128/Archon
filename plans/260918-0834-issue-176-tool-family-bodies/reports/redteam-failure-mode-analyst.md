# Red-team: Failure Mode Analyst (Murphy's Law) — Issue 176 tool family bodies

Scope: `plans/260918-0834-issue-176-tool-family-bodies/{plan.md,phase-01-start.md,phase-02-two-surface-renderers.md,phase-03-audit-gate-and-verification.md}`, cross-checked against the live repo at HEAD `7a66a288` on branch `archon/thread-c192ed5c`.

---

## Finding 1: Audit script can execute against the real `~/.archon/archon.db` the moment its module is imported by a test

- **Severity:** Critical
- **Location:** Phase 3, section "Requirements" / "Implementation steps" (`scripts/audit-generic-fallback.ts`, `scripts/audit-generic-fallback.test.ts`)
- **Flaw:** The plan never states that the script must be driven as a subprocess in its own test, and its architecture sketch (`parse args → open SQLite readonly → SELECT … → tally → write | --check`) matches the codebase's own precedent for a script that invokes `main()` unconditionally at module scope, parsing `process.argv` at load time.
- **Failure scenario:** `scripts/migrate-state-dir.ts` is the explicit precedent the plan cites for "docblock, dry-run default, exit codes" (`scripts/migrate-state-dir.ts:96` parses `process.argv` at module scope; `:346` calls `main()` unconditionally at module scope). Its own test file (`scripts/migrate-state-dir.test.ts:1-10`) explains it is "driven as a SUBPROCESS rather than by importing internals" *precisely because* importing it would run the CLI immediately. If the audit script's test (or any other test/tool) imports `audit-generic-fallback.ts` directly instead of spawning it — e.g. to unit-test a helper function — the module's top-level `main()`/arg-parse executes with the test runner's real `process.argv` (no `--db`), falling through to the documented default `${ARCHON_HOME ?? ~/.archon}/archon.db`. That is the exact production database the task instructions for this review explicitly forbid touching, and it would happen from a "read-only replay" script whose write mode (default invocation, no flag) also *writes* `docs/release-audits/generic-fallback.json` — a script accidentally invoked in write mode against a live corpus is not just a read risk.
- **Evidence:** `scripts/migrate-state-dir.ts:96,346`; `scripts/migrate-state-dir.test.ts:1-27` (docblock explaining the subprocess requirement and why); Phase 3 "Related code files" cites `scripts/migrate-state-dir.ts:1-40` as the precedent but only for "docblock, dry-run default, exit codes," not for the import-vs-subprocess lesson; Phase 3 risk table only guards "Root `bun test ./scripts/` leg picks up the script test with a real DB" by requiring the *test* to pass `--db`, which does not protect against a different caller importing the module.
- **Suggested fix:** State explicitly in Phase 3 that `audit-generic-fallback.test.ts` must drive the script as a subprocess (`Bun.spawn`/`execFile`), never `import`, mirroring `migrate-state-dir.test.ts`'s documented rationale — and add a requirement that the module never invokes its CLI entry point except via a `import.meta.main` (or equivalent) guard.

---

## Finding 2: Body computation is unmemoized on a 3-second poll, for every row (open or closed), doubled by Console's own documented double-mount

- **Severity:** High
- **Location:** Phase 2, "Architecture" and "Risk assessment" ("Large bodies slow the room with many open failed rows")
- **Flaw:** The plan's only stated mitigation for render slowness is "Bodies are capped in Phase 1; render `+n more` instead of the tail" — a per-call content-size bound. It does not address call *frequency*: `presentation.body` is a field computed unconditionally inside `resolveToolPresentation`/`toolRowPresentation` for every tool-history item, not lazily only for rows a user has expanded.
- **Failure scenario:** `packages/web/src/components/workflows/WorkflowExecution.tsx:434-443` polls the whole run via `refetchInterval: 3000` while the run is non-terminal. `packages/web/src/lib/agent-history.ts:186` calls `toolRowPresentation` with no `useMemo` while building the item list from that polled data — meaning every 3 seconds, for every tool-call row in the room (not just the open ones — `<details>` keeps closed rows in the React tree, it only hides them via the browser, per the existing `NodeRoom.tsx:376` `<details data-tool-id=… open={open}>` structure), the plan's new JSON-parse + salvage-scan + ANSI-strip + byte-array-decode pipeline (`tool-output.ts`) re-runs from scratch. Phase 2's own context links confirm `ConsoleAgentHistoryList` "mounts twice on one page (selected room + inline execution history)" (`plans/260918-1038-issue-175-raw-payload-toggle/plan.md:43`), so on the Console surface this cost is paid twice per poll tick. A run with a few hundred tool calls (not unusual for a long agentic session) recomputing bounded-but-nontrivial parsing work for every row, twice, every 3 seconds, is exactly the "render-thread stall on large output" scenario the bounds in Phase 1 were meant to prevent per-call — but the bounds don't prevent aggregate cost across many rows on a tight polling cadence.
- **Evidence:** `packages/web/src/components/workflows/WorkflowExecution.tsx:434-443`; `packages/web/src/lib/agent-history.ts:12,186` (no memoization); `packages/web/src/components/workflows/NodeRoom.tsx:314-334` (`ToolHistory`'s `presentation` is a plain derived value recomputed every render, not memoized); `plans/260918-1038-issue-175-raw-payload-toggle/plan.md:43` (two-mount fact).
- **Suggested fix:** Add a requirement to Phase 1 or 2 that body resolution is memoized per `(toolUseId, name, input, output)` (e.g. `useMemo` at the row level, or a module-level cache keyed by a stable identity) so a poll tick that doesn't change a given row's data doesn't re-run its body pipeline; extend the "40 open rows" risk scenario to "200 rows, closed, across two Console mounts, over 10 poll ticks."

---

## Finding 3: The release gate validates a frozen snapshot, not the live corpus — `--check` alone cannot catch drift

- **Severity:** High
- **Location:** Phase 3, "Requirements" (audit record + `--check`) and the release-skill integration
- **Flaw:** The release step the plan specifies is `bun run scripts/audit-generic-fallback.ts --check`, and the plan's own spec for `--check` is: "reads the committed record and exits `1` when it is missing, malformed, or `fraction >= 0.02`." It does **not** replay the corpus. Freshness depends entirely on a human remembering to first run the script in its *default* (write) mode against the deployment database and commit the new record — a step described only as prose ("with the instruction to re-run the audit against the deployment database first") with no mechanical enforcement (e.g., no max-age check on `snapshotDate`, no CI step that runs the write mode itself).
- **Failure scenario:** The first committed record (`docs/release-audits/generic-fallback.json`, ≈1.02% from the 2026-09-18 local corpus) sits in the repo. Every subsequent release runs `--check`, which passes against that same 1.02% figure indefinitely, even if the real deployment corpus has since drifted past 2% (new provider onboarded, a new bulk-generic tool name introduced, etc.) — because nobody is forced to regenerate the record. This is qualitatively weaker than the codebase's existing release-gate pattern: Step 1.5 ("Pre-flight compiled-binary smoke test") is described in the release skill as "MANDATORY," is actually re-executed every release, and the skill's own guidance says "NEVER skip Step 1.5 … the ~30s cost is paid to keep the failure mode local." The new audit step has no equivalent forcing function.
- **Evidence:** Phase 3 requirements bullet: "`--check` reads the committed record and exits `1` when it is missing, malformed, or `fraction >= 0.02`… Default invocation replays and writes the record"; `.claude/skills/release/SKILL.md:69` ("### Step 1.5: Pre-flight compiled-binary smoke test (MANDATORY before any other step)"), `:779-780` ("NEVER skip Step 1.5 … abort the release").
- **Suggested fix:** Make the release step run the script in its default (replay + write) mode, not `--check`, so every release measures the *current* deployment corpus and the diff shows up in the release PR; reserve `--check` for CI/local sanity only. Alternatively, add a `snapshotDate` staleness check (e.g. reject a record older than N days) so `--check` fails loud rather than silently passing forever.

---

## Finding 4: The plan's PR target branch is not covered by the CI job that runs the new unit/component tests

- **Severity:** High
- **Location:** Plan-wide (Success criteria: "`bun run validate` … green" as the stated verification gate) and Phase 3 (E2E/HITL gap already partially acknowledged)
- **Flaw:** The plan explicitly notes one CI gap ("the HITL job in `.github/workflows/test.yml` does not trigger for PRs into `develop`") and compensates for it with a local run requirement. It does not notice that the **same trigger clause** governs the primary `test` job — the one that runs `bun run test`, i.e. every unit/component test this plan adds (`tool-output.test.ts`, `tool-presentation.test.ts`, `NodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx`, `audit-generic-fallback.test.ts`).
- **Failure scenario:** `.github/workflows/test.yml:3-7` declares `on: pull_request: branches: [main, dev]` for the whole workflow (both the `test` job and the `e2e-hitl` job share this trigger — neither job overrides `on`). The repository's actual live branch is `develop` (`git branch -a` shows `origin/HEAD -> origin/develop`), a *different* branch from `dev` (`git rev-parse dev develop` returns two different SHAs), and there is a dedicated, separately-named workflow (`.github/workflows/pr-e2e-verify.yml`, "Single UI merge-gate on PRs into `develop`") that only runs a UI-path-gated Playwright DAG, not `bun run test`/`bun run validate`. So a PR from this branch into `develop` gets no automatic run of the standard unit-test suite from GitHub Actions; the only backstop is whoever runs `bun run validate` locally before merging. If that step is skipped, run against a stale checkout, or a later rebase silently reintroduces a regression, nothing in CI catches it before merge.
- **Evidence:** `.github/workflows/test.yml:1-40` (trigger + `test` job body: `run: bun run test`); `.github/workflows/pr-e2e-verify.yml:1-27` ("Single UI merge-gate on PRs into `develop`", `on.pull_request.branches: [develop]`, UI-path-filtered); `git branch -a` (`remotes/origin/HEAD -> origin/develop`; both `dev` and `develop` present as distinct branches); `git rev-parse dev develop` → two distinct SHAs (`6cb3f8e2…` vs `7a66a288…`).
- **Suggested fix:** Confirm with the maintainer which branch this PR actually targets and, if it is `develop`, either retarget `test.yml`'s trigger to include `develop` or explicitly document (as the plan already does for HITL) that the entire unit-test suite is a manual-only gate for this PR, not a CI-verified one.

---

## Finding 5: Salvage-scanner design only anticipates escape-sequence cuts, not surrogate-pair cuts, at exactly the truncation points the plan's own evidence traces to

- **Severity:** Medium
- **Location:** Phase 1, "Architecture" (salvage scanner description) and "Risk assessment" ("Salvage scanner mis-decodes an escape at the cut")
- **Flaw:** The described mitigation is "Treat an incomplete escape as end of text; assert no throw," and the paired test scenario is "Test with a cut inside `\u00` or `\n`." Neither the design nor the risk table considers a cut that splits a raw (unescaped) UTF-16 surrogate pair — e.g. an emoji or other astral-plane character appearing literally inside `stdout`/`content` — which is a distinct failure mode from an incomplete `\uXXXX` escape.
- **Failure scenario:** The plan's own evidence traces every "truncated at rest" JSON string to `.slice()`-based truncation that operates on UTF-16 code units, not code points: `packages/providers/src/claude/provider.ts:922` (`output.slice(0, maxLen) + '...'`, `maxLen = 10_000`) and, independently, the SSE transport cap `packages/server/src/adapters/web/truncate.ts:23` (`output.slice(0, MAX_TOOL_OUTPUT_CHARS)`, `16_384`). Either cut point can fall in the middle of a two-code-unit character, leaving a lone surrogate in the persisted/transported string. The plan's salvage scanner, walking the string to find the cut literal, will decode "the literal's content" up to that lone surrogate and hand it to `text`/React — producing a mojibake glyph (typically rendered as U+FFFD or a tofu box) with no test coverage anywhere in the matrix confirming this doesn't visually corrupt the row or, worse, interact badly with a later bounded regex/tokenizer step in an unanticipated way.
- **Evidence:** `packages/providers/src/claude/provider.ts:918-926` (`.slice()` truncation, code-unit-based); `packages/server/src/adapters/web/truncate.ts:10-29` (`.slice()` truncation, code-unit-based, independently confirmed 16 KiB transport cap the plan itself cites); Phase 1 risk table row "Salvage scanner mis-decodes an escape at the cut … Test with a cut inside `\u00` or `\n`" (no surrogate-pair case named); existing `truncateCodePoints` helper in `tool-presentation.ts:274-283` shows the codebase already has a code-point-safe truncation pattern available but the new `tool-output.ts` constants are explicitly named `*_CODE_UNITS`, suggesting a naive `.slice()` is intended there too.
- **Suggested fix:** Add an explicit test case: a persisted output truncated exactly mid-surrogate-pair (high surrogate as the last code unit), and specify that the salvage scanner strips a trailing lone surrogate before returning `text`.

---

## Finding 6: Extending count badges to the `paths` arm (glob) is a real behavior change with no test that would catch its absence or a regression

- **Severity:** Medium
- **Location:** Phase 1, "Refactor" ("Count badge: replace the raw-output `countBadge(input.output)` … with counts from the normalized output — `N matches` on the matches arm, `N files` on the paths arm")
- **Flaw:** Today, `countBadge` is only invoked from the `search` case (`packages/web/src/lib/tool-presentation.ts:460`); `glob` (`:464-467`) never calls it. The plan's stated design ("`N files` on the paths arm") implies `glob` — the family whose body is `paths` — should now also get a count badge, a family that currently gets none. No test in Phase 1's or Phase 2's scenario matrices exercises this, and the one existing regression test that could plausibly catch an unintended widening — `describe('count fact') → 'count does not attach to non-search families'` — only asserts on `Read` (family `file`), never on `glob`. If the refactor accidentally attaches counts to `glob` outputs in cases the design didn't intend (e.g. a glob output that happens to carry a `count`-shaped field for unrelated reasons), or conversely fails to attach the intended `files` badge, neither outcome is asserted anywhere.
- **Evidence:** `packages/web/src/lib/tool-presentation.ts:413-417` (`countBadge`, hardcoded `"${count} matches"` text, no family/kind parameter today); `:458-467` (`countBadge` called only in `case 'search'`, not `case 'glob'`); `packages/web/src/lib/tool-presentation.test.ts:620-624` (`'count does not attach to non-search families'` tests only `Read`); no `glob` row appears anywhere in the `describe('count fact')` block (`packages/web/src/lib/tool-presentation.test.ts:558-624`).
- **Suggested fix:** Add an explicit glob/paths count-badge fixture and assertion to Phase 1's test scenario matrix (both "glob output includes a files count → badge present" and "glob output has no derivable count → no badge, existing behavior preserved"), and rename or extend the existing "count does not attach to non-search families" test so it still says something true post-change.

---

## Finding 7: The "evidence convention" phase 3 asks to mirror does not exist in this checkout

- **Severity:** Medium
- **Location:** Plan.md, "Evidence and authority" bullet ("Story 1.1 recorded its evidence at `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md`…"); Phase 3 requirements ("`1-3-evidence.md` records…")
- **Flaw:** The plan asserts, without a hedge, that Story 1.1's evidence file exists and that this story should "mirror" it. It does not.
- **Failure scenario:** `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` is absent from the working tree even though `sprint-status.yaml:58` records `1-1-scan-a-tool-call-as-one-readable-row: done`. The plan does hedge the *commit* reference ("`b261a00e`, not in this checkout") but states the evidence-file path as settled fact. Whoever executes Phase 3 and goes looking for the "convention" to mirror (format, sections, level of detail) will find nothing to copy from, and may either skip writing meaningful evidence (weakening the "close the story" success criterion) or invent a format that isn't actually validated against any prior instance — the opposite of "confirmed" the rest of the plan is careful to mark elsewhere (e.g. "Confirmed in the validation interview" tags on other resolved conflicts).
- **Evidence:** `ls _bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` → no such file; `sed -n '58,62p' _bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` shows `1-1-…: done` and `1-3-read-expanded-details-shaped-for-the-tool-family: backlog` at line 60 (this specific line citation is otherwise accurate).
- **Suggested fix:** Either locate the actual evidence artifact (it may live in a different commit/branch not checked out here) and confirm its shape before Phase 3 starts, or drop the "mirrors that" framing and specify the evidence file's required contents directly in Phase 3 (which the requirements section mostly already does — "focused tests, package tests, validate, HITL run, and the audit numbers" — so the fix is cheap).

---

### Verification Results

Method: sampled `file:line` / symbol / path / command claims across the three phase files, `grep -n` / direct read against the working tree at `archon/thread-c192ed5c` (HEAD `7a66a288`).

**Phase 1 (11 claims checked):**
1. `tool-presentation.ts:59-69` (`ToolPresentation` interface, no `body`, docblock) — VERIFIED (exact)
2. `tool-presentation.ts:419-503` (`resolveToolPresentation`) — VERIFIED (exact)
3. `tool-presentation.ts:588-594` (spread into row) — VERIFIED (exact)
4. `tool-presentation.ts:460`, `:413-417` (`countBadge`) — VERIFIED (exact)
5. `tool-presentation.ts:325-347` (`extractCount`) — VERIFIED (exact)
6. `tool-presentation.ts:506-520` (`safePresentation`) — VERIFIED (exact)
7. `packages/providers/src/claude/provider.ts:917-926` — VERIFIED (matches within 1-2 lines)
8. `packages/providers/src/community/omp/event-parser.ts:37-44` (`serializeToolResult`) — VERIFIED (exact)
9. `packages/providers/src/community/devin/event-bridge.ts:51-61` (`toolOutputFromUpdate`) — VERIFIED (function spans 51-60, off by one at tail, immaterial)
10. `packages/providers/src/codex/provider.ts:642-659` — VERIFIED (matches within a couple lines)
11. `packages/web/src/experiments/console/console-isolation.test.ts:114-126` (`@/lib/tool-output` absent from `approved`) — VERIFIED

**Phase 2 (7 claims checked):**
1. `NodeRoom.tsx` `ToolHistory` at `:314-476` — VERIFIED (`ToolHistory` starts at line 314)
2. `NodeRoom.tsx` markdown pipeline `:43-95` — VERIFIED (plugins declared at lines 42-43, consistent)
3. `ConsoleAgentHistoryList.tsx` `ToolHistory` at `:237-385` — VERIFIED (function starts at line 238, off by one)
4. `ConsoleAgentHistoryList.tsx` markdown pipeline `:35-38` — VERIFIED (plugins at lines 35-36)
5. "Console mounts twice on one page" claim, sourced to the 1.2 plan — VERIFIED (`plans/260918-1038-issue-175-raw-payload-toggle/plan.md:43`)
6. 1.2 plan's "End-to-end design" with body bar + Raw + swap slot — VERIFIED (present in `plan.md`)
7. `packages/web/src/components/workflows/WorkflowExecution.tsx` 3s poll while non-terminal (used to support Finding 2, not a plan citation but load-bearing for this review) — VERIFIED (`:434-443`)

**Phase 3 (10 claims checked):**
1. `scripts/migrate-state-dir.ts:1-40` (docblock/dry-run precedent) — VERIFIED
2. `scripts/node-ref-parity.test.ts` (cross-package import precedent) — VERIFIED (file exists)
3. `.claude/skills/release/SKILL.md:69` (Step 1.5) — VERIFIED (exact)
4. `.claude/skills/release/SKILL.md:130` (Step 2) — VERIFIED (exact)
5. `e2e/package.json:9` (`test:ui:hitl`) — VERIFIED (exact)
6. Root `bun test ./scripts/` leg runs from repo root — VERIFIED (`package.json:29`)
7. Root `bunfig.toml` `coverage = true`, `root = "./packages"` — VERIFIED
8. `sprint-status.yaml:60` → Story 1.3 line — VERIFIED (exact, currently `backlog`)
9. `epics.md:261-288` (Story 1.3 AC block) — VERIFIED (exact bounds)
10. `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` exists — **FAILED** (file not found; see Finding 7)

**Tally:** 28 claims checked, 27 VERIFIED, 1 FAILED, 0 UNVERIFIED.

Status: DONE
Summary: Seven evidence-backed findings, ranging from a real risk of the audit script hitting the production database if tested by import rather than subprocess, through an under-mitigated render-thread cost from unmemoized body computation on a 3-second poll (doubled by Console's documented double-mount), a release gate that only checks a frozen snapshot, a CI branch-trigger mismatch that may leave this plan's own new tests unrun in GitHub Actions, a surrogate-pair gap in the salvage scanner's own risk table, an untested count-badge behavior change for glob, and a cited evidence-file precedent that does not exist in this checkout.
Concerns/Blockers: None blocking this review; Findings 1 and 4 warrant direct maintainer confirmation before Phase 3 execution (script testing discipline, and actual PR target branch / CI coverage).
