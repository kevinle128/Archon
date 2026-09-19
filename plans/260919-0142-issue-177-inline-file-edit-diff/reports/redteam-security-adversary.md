# Red-team (security adversary): Issue 177 inline file-edit diff plan

Scope reviewed: `plans/260919-0142-issue-177-inline-file-edit-diff/{plan.md,phase-01-start.md,phase-02-two-surface-renderers.md,phase-03-verification-and-closeout.md}`, cross-checked against the current tree and the two pinned library research reports. Threat model: `old_string`/`new_string`/`content`/`new_content` are attacker-influenced (a compromised/malicious tool provider, a prompt-injected coding agent, or repository content the agent is told to paste) flowing into a browser-rendered, human-approval-facing surface.

---

## Finding 1: The differ is not actually bounded to "every 3-second poll" — it runs on every unmemoized re-render of the transcript pane

- **Severity:** Critical
- **Location:** Phase 1, decision 2 / "Contract to implement"; Phase 2 "Markup contract"; plan.md Decision 2 ("summary-time... runs during the 3-second poll")
- **Flaw:** The plan's entire performance argument for putting `diffHunks()` on the summary path rests on the claim that it "runs during the 3-second poll" (plan.md Decision 2) and is therefore cheap/rare. In the actual mount points, `buildAgentHistory()` — which calls `toolRowPresentation()` for every tool row, and after this change will call `diffHunks()` for every file-edit row — is invoked **directly in the render body**, not inside a `useMemo`, and is keyed on `Date.now()`, which is fresh on every call.
- **Failure scenario:** Any re-render of `NodeTranscriptPane`/`ConsoleNodeRoom`/`ConsoleExecutionHistory` for a reason unrelated to new data (scroll-follow state changes, focus changes, an unrelated sibling row's local `useState` bubbling a parent re-render, a todo-strip update, a window resize) re-executes `buildAgentHistory()` and therefore `diffHunks()` for **every** file-edit row currently in the visible message window — not just the row the operator is looking at, and not just once per 3-second tick. For a long-running agent session with many `Edit`/`Write` calls open in one node room, this multiplies the cost analyzed in Findings 2–4 by an unbounded, un-throttled render frequency instead of the "every 3s" the plan assumes when it justifies the design as safe.
- **Evidence:**
  - `packages/web/src/components/workflows/NodeTranscriptPane.tsx:258-268`:
    ```
    const nowMs = Date.now();
    const agentHistory: AgentHistory =
      row === null
        ? { items: [], todos: [] }
        : buildAgentHistory({ rows: visibleMessages, events, nodeId: row.nodeId, nowMs });
    ```
    (called in the render body, not `useMemo`)
  - `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:644-654` — identical pattern.
  - `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:205-211` — identical pattern.
  - `packages/web/src/lib/agent-history.ts:198-201` — `toToolItem()` calls `toolRowPresentation(...)` unconditionally for every card, which is where `diffHunks()` will be reached per Phase 1's contract.
- **Suggested fix:** Either wrap `buildAgentHistory()` in a `useMemo` keyed on row identity (not `Date.now()`), or move the `diffHunks()` call out of the always-executed summary/badge path into something explicitly gated on visibility/mount, before relying on "runs on the poll" as the safety argument. At minimum, Phase 3's Playwright proof must include a scenario that forces several unrelated re-renders of an open room with a large diff mounted and asserts no more than N recomputes — the current plan has no such test.

---

## Finding 2: The byte-ceiling check itself is explicitly _not_ memoized, defeating the cache on the hot path Finding 1 exposes

- **Severity:** Critical
- **Location:** Phase 1, "Rules the implementation must obey" #1
- **Flaw:** The contract text is unambiguous about ordering: _"Refuse before working... Otherwise measure `new TextEncoder().encode(side).byteLength` for each side and return `null` if either exceeds the ceiling. **Only then build the memo key.**"_ This means the `TextEncoder().encode()` pass over up to 65,536 UTF-16 code units **per side, per call**, runs unconditionally before any memo lookup — including for pairs that will ultimately hit the memo and return the identical cached object. The memoization in decision 11 only saves the `structuredPatch` computation; it does nothing for the byte-ceiling measurement, which re-executes on every single invocation.
- **Failure scenario:** Combined with Finding 1 (every re-render calls `diffHunks()` for every visible file-edit row), every re-render of the transcript pane re-runs a full UTF-8 encode of up to ~131,072 code units (both sides near the ceiling) for every large file-edit row in view — even for rows whose diff result is already cached and unchanged. An attacker (or a legitimately large agent session) that produces several `Edit` calls near the 64 KiB ceiling turns ordinary scrolling/UI interaction into a sustained, uncached CPU cost with no backoff.
- **Evidence:** Phase 1 file, "Rules the implementation must obey" item 1 (quoted above); `phase-01-start.md` lines 78-80. `DIFF_MEMO_ENTRIES`/`MAX_DIFF_SIDE_BYTES` constants at `phase-01-start.md:52-58`.
- **Suggested fix:** Perform the memo lookup _first_ using a cheap, bounded key (e.g., a hash or the raw string references if the same object identities recur, which they will for unchanged historical rows since `input.input`/`input.output` come from the same polled/cached row data), and only pay the byte-ceiling cost on an actual cache miss.

---

## Finding 3: Worst-case single-diff cost is unbounded relative to "byte ceiling" framing — up to ~131M edit-graph steps

- **Severity:** High
- **Location:** Phase 1, "Rules the implementation must obey" #3; plan.md Decision 5
- **Flaw:** The plan treats `MAX_DIFF_SIDE_BYTES = 65_536` and `MAX_DIFF_EDIT_LENGTH = 2_000` as independent, comfortable bounds, but jsdiff's `structuredPatch` tokenizes by **line**, and Myers' algorithm cost is `O((N+M)·D)` where `N`, `M` are line counts and `D` is edit distance (bounded here by `maxEditLength`). The byte ceiling bounds total _characters_, not line count: an attacker-controlled `old_string`/`new_string` pair built from single-character lines (`"a\nb\nc\n..."`) can pack up to ~32,768 lines into 65,536 bytes per side, i.e. `N+M ≈ 65,536`. With every line different (trivially achievable and exactly the shape the `maxEditLength` refusal test in Phase 1 already constructs — "`MAX_DIFF_EDIT_LENGTH + 1` distinct lines → all replaced"), the algorithm must explore up to `D = 2,000` before jsdiff gives up and returns `undefined`. Worst-case work is on the order of `65,536 × 2,000 ≈ 131,000,000` edit-graph steps for a **single** diff call, run synchronously on the browser's main thread.
- **Failure scenario:** A malicious or prompt-injected agent emits one `Edit` tool call whose `old_string`/`new_string` are two ~64 KiB blobs of maximally-divergent short lines. The very first render of that row (and, per Finding 1, every subsequent re-render until the cache holds and stays warm) pays this ~131M-step cost before the UI can even show the "content too different, falling back" state — there is no `timeout` (decision 5 explicitly forbids one "so the same pair yields the same answer on every machine"), so there is no wall-clock escape hatch; the only bound is the edit-graph exploration itself, which the plan does not benchmark anywhere in Phase 1–3.
- **Evidence:** `phase-01-start.md:52-58` (constants), `phase-01-start.md:81` (`structuredPatch(..., { context: DIFF_CONTEXT_LINES, maxEditLength: MAX_DIFF_EDIT_LENGTH })`, no `timeout`); jsdiff research report `research-jsdiff-9.md` ("`timeout` — no default... No `AbortSignal` support exists").
- **Suggested fix:** Add a line-count ceiling (not just a byte ceiling) to the refusal check, since line count — not byte count — drives the algorithmic cost. Benchmark the actual worst-case wall-clock time on representative hardware and record it in Phase 3's evidence file; the plan currently asserts "no timeout involved... returns promptly" (Phase 1 test table, "edit-length bound" row) without ever measuring what "promptly" means for the adversarial shape described above.

---

## Finding 4: 64-entry memo under sustained adversarial load causes indefinite eviction/recompute cycling — a genuine sustained DoS, not a one-time cost

- **Severity:** High
- **Location:** Phase 1, "Rules the implementation must obey" #2; plan.md Decision 11
- **Flaw:** `DIFF_MEMO_ENTRIES = 64` is a hard, fixed cap shared by the _entire app_ (`diffHunks` is a module-level singleton, plan.md line 74: "The shared instance every production caller uses"). A long-running agent session that performs more than 64 large file edits — entirely plausible for a multi-file refactor task, and trivially forceable by an adversarial tool-call stream — guarantees the earliest entries are evicted. Per Finding 1, the summary badges/facts for **every visible row** are recomputed on every re-render, so once eviction begins, the evicted rows' diffs are recomputed from scratch (Finding 3's cost) on every subsequent re-render for the remaining lifetime of the open room, not once.
- **Failure scenario:** An operator monitoring a long agent run that edits >64 files near the byte ceiling experiences sustained main-thread jank for as long as the room stays open, with no way to disable or throttle it — every idle re-render (scroll, focus, unrelated state change per Finding 1) pays the eviction-churn cost across all evicted large-diff rows. Memory-wise, each memo entry retains a key of up to ~2×65,536 code units plus a `DiffHunksResult` whose `hunks[].changes[]` can contain tens of thousands of small change objects in the maximally-divergent case from Finding 3 — plausibly several MB per entry once V8 object overhead for ~65k change records is counted, so 64 entries is not merely "8 MB" as a naive string-only estimate suggests but can reach tens of MB per open room, multiplied per concurrently-open run/tab.
- **Evidence:** `phase-01-start.md:58` (`DIFF_MEMO_ENTRIES = 64`); plan.md:74 (single shared instance); plan.md:157 ("the body arm is a cache hit" — assumes warm cache, which eviction defeats).
- **Suggested fix:** Size the memo relative to the visible row count (or key it per-room instead of globally), and add an explicit test that forces >64 distinct large pairs and asserts bounded aggregate recompute cost across repeated `toolRowPresentation` calls simulating re-renders — the current test table ("determinism and memo identity") only proves _correctness_ of eviction, not that eviction under adversarial load stays cheap.

---

## Finding 5: Diff content is deliberately unsanitized, reintroducing a control-character/CR trust-surface regression on Archon's human-approval review surface

- **Severity:** High
- **Location:** Phase 1, "Contract to implement" → "`tool-presentation.ts`" ("Do not sanitize the diff sides..."); Risks and safeguards ("CRLF content keeps its `\r` inside line content")
- **Flaw:** Every other text surface computed by `tool-presentation.ts` runs through `sanitizeBounded()`, which strips ANSI escape sequences and C0/C1 control bytes before rendering (e.g. today's `file` preview at `packages/web/src/lib/tool-presentation.ts:1104`: `const bounded = sanitizeBounded(written, MAX_OUTPUT_TEXT_CODE_UNITS);`, and the `shell` command at line 1089). The plan explicitly opts the new diff path out of this: _"Do not sanitize the diff sides: they are rendered as React text nodes by react-diff-view, and stripping escape sequences would misreport what the edit contained."_ Confirmed against the pinned jsdiff source (`research-jsdiff-9.md`): CRLF content is preserved verbatim except for the final `\n` strip, so a line ending `\r\n` reaches the renderer as `...\r`. The react-diff-view `.diff-code` cell is `white-space: pre-wrap` both by the library's own default CSS (per `research-react-diff-view-3.3.3.md`) and by Phase 2's own override (`phase-02-two-surface-renderers.md:150`), and under CSS Text's segment-break rules a bare `\r` inside `pre-wrap` content is treated as a preserved line break — so an attacker-controlled `old_string`/`new_string` can make one _numbered_ diff line visually render as two lines inside the same `<td>`, without a second gutter number or marker, deceiving a reviewer about how many lines actually changed. This is the same class of attack as CVE-2021-42574 (Trojan Source), applied here to a diff surface Archon uses specifically for human approval before code changes land (AGENTS.md: "human approval gates and full audit trails").
- **Failure scenario:** A compromised provider or prompt-injected agent crafts an `Edit` call whose `new_string` contains an embedded `\r` (or Unicode bidi-override characters, which `sanitizeBounded` also would not strip, but which the rest of the codebase at least applies _some_ filtering discipline to, via the C0/C1 strip) positioned to make the rendered diff look benign while the actual bytes written to disk differ from what the reviewer visually approved. No test in Phase 2/3 verifies the _rendered visual line count_ matches the _declared line-number count_ for a line containing an embedded control character — the CRLF test row in Phase 1 only asserts the hunk data structure, not the DOM rendering.
- **Evidence:** `packages/web/src/lib/tool-presentation.ts:1101-1111` (existing sanitization pattern this feature diverges from); `phase-01-start.md:103` ("Do not sanitize the diff sides..."); `plan.md:164` ("CRLF content keeps its `\r` inside line content... an LF→CRLF rewrite honestly shows every line changed"); `research-jsdiff-9.md` ("a CRLF input keeps its `\r` at the end of the line content"); `research-react-diff-view-3.3.3.md` (`.diff-code { ... white-space: pre-wrap; word-break: break-all }`).
- **Suggested fix:** At minimum, strip or visibly escape bare `\r` (and other C0/C1 control bytes that aren't part of a legitimate line ending) from diff line `content` before rendering — this does not require touching jsdiff's line-splitting semantics (which the plan correctly wants to keep honest for the _counted_ changed-line set), only the final text handed to the DOM. Add a Phase 2/3 test asserting one declared line renders as exactly one `<tr>`/table row regardless of embedded control characters.

---

## Finding 6: The "own top-level keys only" guarantee is asserted but not enforced by any written test, and the closest existing precedent in the same file does not check ownership

- **Severity:** Medium
- **Location:** Phase 1, "Contract to implement" → `fileEditPair` description; plan.md line 144 ("pair detection reads own top-level keys only")
- **Flaw:** The plan states `fileEditPair` "scans `BEFORE_AFTER_PAIRS` in order and returns the first pair whose **both** keys are own-property strings," and plan.md's acceptance criteria claim "pair detection reads own top-level keys only" as a tested guarantee. But the only test that exercises this (`tool-presentation.test.ts` "Family invariance" row) only proves that a **nested** object's `old_string`/`new_string` don't count — it does not test prototype-chain-inherited top-level properties. The existing sibling function in the same file that the new code is modeled on, `inferFamily()`'s `BEFORE_AFTER_PAIRS` scan, uses plain bracket access with no ownership check:
  ```
  for (const [before, after] of BEFORE_AFTER_PAIRS) {
    if (record[before] !== undefined && record[after] !== undefined) return 'file';
  }
  ```
  (`packages/web/src/lib/tool-presentation.ts:468-471`). If `fileEditPair` is implemented by mirroring this established, in-file precedent — the natural and likely path for an implementer following existing style — the written "own-property" guarantee is silently unenforced.
- **Failure scenario:** Practically, tool-call input arrives via `JSON.parse`, so classic `__proto__`-injection via JSON is neutralized by modern JS engines (JSON.parse assigns `__proto__` as an own key, not as the prototype). The realistic risk is a _different_ bug elsewhere in this large SPA polluting `Object.prototype` with an enumerable `new_string`/`old_string`-shaped property (e.g. via a vulnerable merge/deep-clone utility), which would then cause `fileEditPair` to spuriously match on **every** `file`-family row in the app (not just ones the author intended), fabricating diff badges from whatever polluted value is inherited — a correctness/data-integrity failure the plan's own stated guarantee was supposed to prevent, with no regression test to catch it if the guarantee isn't actually implemented as described.
- **Evidence:** `packages/web/src/lib/tool-presentation.ts:468-471` (unowned-check precedent); `phase-01-start.md:95` ("returns the first pair whose **both** keys are own-property strings"); `plan.md:144` (acceptance criterion, nested-object test only).
- **Suggested fix:** Require `Object.hasOwn(record, before) && Object.hasOwn(record, after)` explicitly in the implementation, and add a test that pollutes `Object.prototype` (or uses `Object.create({old_string: 'x', new_string: 'y'})` as the input) and asserts no diff badge appears — proving ownership is actually checked, not just nesting.

---

## Finding 7: Console isolation guards have zero coverage of third-party runtime/CSS imports — this plan gives Console its first non-trivial third-party UI dependency with no boundary test

- **Severity:** Medium
- **Location:** Phase 2, "Pre-edit integration check" / "Imports (each renderer)"; plan.md "Current code" bullet on Console isolation
- **Flaw:** Both enforcement mechanisms for Console's NFR4 isolation are scoped exclusively to first-party `@/*` specifiers:
  - `eslint.config.mjs:129-165` — `no-restricted-imports` patterns are `@/components/**`, `@/contexts/**`, `@/hooks/**`, `@/routes/**`, `@/stores/**`, `@/lib/api`, `@tanstack/react-query`.
  - `console-isolation.test.ts` — `FORBIDDEN_SPEC_PREFIXES` and the `approved` allowlist are both `@/*`-only; `isForbiddenSpec()` never inspects bare npm specifiers.
    Neither guard has ever had to reason about a third-party package before, because Console currently imports zero `react-diff-view`-class dependencies (`grep -rln "react-diff-view" packages/web/src/experiments/` returns nothing on the current tree). Phase 2's own "Imports (each renderer)" block puts `import 'react-diff-view/style/index.css';` and the runtime `Diff`/`Hunk`/`Decoration` import directly into `ConsoleAgentHistoryList.tsx`, pulling in `react-diff-view`'s own dependency tree (`classnames`, `diff-match-patch`, `gitdiff-parser`, `lodash`, `shallow-equal`, `warning` — `bun.lock:3081`) with no test anywhere in the plan asserting this stays bounded.
- **Failure scenario:** The plan's own documented rationale for Console isolation (README, cited in eslint's comment: "must not couple to the production web UI's state/components so that it can be extracted or discarded cleanly") is about more than avoiding `@/components` imports — it's about keeping Console a genuinely separable, low-blast-radius spike. A heavyweight third-party dependency (bringing in `lodash` — a library the rest of `@archon/web` may or may not already carry, and which has its own history of prototype-pollution CVEs, e.g. CVE-2019-10744/CVE-2020-8203) landing in Console with no boundary test means nothing prevents this pattern from repeating and silently growing Console's bundle/dependency surface in ways NFR4 exists to prevent, and no CI signal will ever catch it because the isolation test literally cannot see it.
- **Evidence:** `eslint.config.mjs:129-165`; `packages/web/src/experiments/console/console-isolation.test.ts` (`FORBIDDEN_SPEC_PREFIXES`, `approved` set, both `@/*`-scoped); `phase-02-two-surface-renderers.md:43-51` (Console import block); `bun.lock:3081` (`react-diff-view` dependency list).
- **Suggested fix:** If Console is meant to stay extractable, either add an explicit allowlist test for third-party runtime imports under `experiments/console/**` (mirroring the `@/lib/*` allowlist pattern already in place), or accept and document that NFR4 was never meant to cover third-party coupling and adjust the contract doc language accordingly so future reviewers don't assume a guarantee that isn't tested.

---

### Verification Results

**Tier:** Standard (Fact Checker + Contract Verifier), 10 claims checked.

| #   | Claim                                                                                             | Result                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `inferFamily`'s `BEFORE_AFTER_PAIRS` scan uses plain (non-own) bracket access                     | VERIFIED (`packages/web/src/lib/tool-presentation.ts:468-471`)                                                             |
| 2   | `asRecord`/`stringField`/`firstStringField` exist as described, no ownership checks               | VERIFIED (`packages/web/src/lib/tool-presentation.ts:201-224`)                                                             |
| 3   | Both `toolPresentation()` and `toolBodyPresentation()` wrap internals in try/catch                | VERIFIED (`packages/web/src/lib/tool-presentation.ts:679-685`, `1206-1216`)                                                |
| 4   | `sanitizeBounded` exists and strips ANSI/C0/C1 control bytes, used for today's file preview       | VERIFIED (`packages/web/src/lib/tool-output.ts:191-216`; `packages/web/src/lib/tool-presentation.ts:1101-1111`)            |
| 5   | `eslint.config.mjs` Console guard patterns are `@/*`-scoped only                                  | VERIFIED (`eslint.config.mjs:122-165`)                                                                                     |
| 6   | `console-isolation.test.ts` allowed/forbidden sets are `@/*`-scoped only, no third-party coverage | VERIFIED (full file read; `FORBIDDEN_SPEC_PREFIXES`, `approved` set)                                                       |
| 7   | `packages/web/package.json` declares `react-diff-view: 3.3.3` and no `diff` dependency today      | VERIFIED (`packages/web/package.json:41`; no `"diff"` line present)                                                        |
| 8   | `bun.lock` hoists an unrelated `diff@8.0.3` from `astro`/`shadcn` devDependencies                 | VERIFIED (`bun.lock:2163` bare entry; `bun.lock:1945` astro `"diff": "^8.0.3"`; `bun.lock:3221` shadcn `"diff": "^8.0.2"`) |
| 9   | `git-hunk-adapter.ts` types come from `@/lib/api` today (pre-move), not `api.generated`           | VERIFIED (`packages/web/src/components/workflows/source-control/git-hunk-adapter.ts:3`)                                    |
| 10  | `structuredPatch` does not currently appear anywhere in `packages/web/src` production code        | VERIFIED (only unrelated hits are a JSON field name in `tool-output.test.ts`)                                              |

**Additional facts verified via live source fetch (react-diff-view@3.3.3, not present in the two research reports as an explicit claim):**

- `esm/Hunk/UnifiedHunk/UnifiedChange.js` and `esm/Hunk/CodeCell.js` contain no `dangerouslySetInnerHTML`; without `tokens`/`renderToken` (which the plan correctly omits), `CodeCell` renders `text || ' '` as a plain React child. This rules out a classic XSS vector for the diff body text — noted as a verified non-issue, not a finding.

**Contract Verifier — consumers of interfaces this plan changes:**

- `ToolBody` (`file` member gains `diff: FileDiff | null`): consumers are `packages/web/src/components/workflows/NodeRoom.tsx` (`file` arm switch) and `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` (`file` arm switch) — both enumerated correctly in Phase 2's file table.
- `ToolRowBadgeKind`/`ToolRowBadgeTone` (gain `'diff'`/`'success'`): consumers are both surfaces' `BADGE_TONE` maps (`NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`) — the plan itself notes this is a compile-time break requiring both maps to be updated (Phase 1 step 5), correctly identified.
- `git-hunk-adapter.ts` exports (`toChangeData`, `toHunkData`, `hunksForSide`): current consumer is `virtualized-diff.tsx` only (`import { hunksForSide, toHunkData } from ...`, confirmed no other production consumer via `grep -rln`); after the move, Phase 2 adds `NodeRoom.tsx` and `ConsoleAgentHistoryList.tsx` as new consumers of `toHunkData` — all three are enumerated in the plan's file tables. No missed consumer found.
- `buildAgentHistory()` (unchanged signature, but now transitively heavier via `toolRowPresentation` → `diffHunks`): three call sites found and none are memoized — `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`, `ConsoleExecutionHistory.tsx`. This consumer list is **not enumerated anywhere in the plan**, which is the root cause of Finding 1.

Status: DONE
Summary: Seven evidence-backed findings; the two most severe (Findings 1–2, closely related) show the plan's core performance safety argument — "the differ runs at summary time on the 3-second poll" — does not match how `buildAgentHistory()` is actually mounted (unmemoized, in three render bodies), and that the byte-ceiling check is explicitly excluded from memoization by the plan's own written algorithm, together turning attacker-sized Edit payloads into a sustained, un-throttled main-thread cost rather than the one-time bounded cost the plan assumes.
