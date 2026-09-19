# Red Team: Assumption Destroyer — Issue 177 inline file-edit diff

Scope: `plan.md`, `phase-01-start.md`, `phase-02-two-surface-renderers.md`, `phase-03-verification-and-closeout.md`, plus the two research reports (treated as sourced). All findings below are backed by direct reads of the current tree at commit `81ba296f` (baseline pinned in `plan.md`).

---

## Finding 1: The "summary-time diff is free because it's memoized" justification is false — the differ runs on every React render, not on a 3-second poll

- **Severity:** Critical
- **Location:** `plan.md` Decision 2 ("The diff is the one sanctioned summary-time computation"); `phase-01-start.md` Rules 1–2 in the `diff-hunks.ts` contract.
- **Flaw:** Decision 2 justifies doing full-diff work inside `toolPresentation()` — which Story 1.3 otherwise forbids at summary time — on the premise that it "runs during the 3-second poll" and the memo makes `toolBodyPresentation()` "reuse it for free." Neither half of that premise holds. The actual call sites never poll-gate or memoize the call to `buildAgentHistory` (which invokes `toolRowPresentation` → `toolPresentation` → `diffHunks` for **every** tool row in the visible transcript, not just the open one):
  - `packages/web/src/components/workflows/NodeTranscriptPane.tsx:263-269`
  - `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:645-652`
  - `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:206-211`

  All three call `buildAgentHistory({ rows, events, nodeId, nowMs })` **directly in the render body**, with `const nowMs = Date.now();` computed inline on the line above — not inside `useMemo`, not gated by a poll timer. Any re-render of these components (scroll, hover, focus change, unrelated local state, a sibling row's toggle) re-runs the full presentation pipeline, including the new diff computation, for every `file` row currently in history.

- **Failure scenario:** In a long agentic-coding node room (the product's core scenario per `AGENTS.md`: "controlling Claude Code / Codex against repos"), a transcript with many tool rows re-derives `AgentHistory` — and hence calls `diffHunks` — on every unrelated re-render, not once per 3s tick. The plan's stated bound ("this is different in kind... the result is memoized... so `toolBodyPresentation()` reuses it for free") is only true for the _body_ re-derivation; it says nothing about the _summary_ re-derivation happening far more often than the plan assumes, on the full row list every time.
- **Evidence:**
  ```
  packages/web/src/components/workflows/NodeTranscriptPane.tsx:262-269
    const nowMs = Date.now();
    const agentHistory: AgentHistory =
      row === null ? { items: [], todos: [] } : buildAgentHistory({ rows: visibleMessages, events, nodeId: row.nodeId, nowMs });
  ```
  (identical pattern at `ConsoleNodeRoom.tsx:645` and `ConsoleExecutionHistory.tsx:206`)
- **Suggested fix:** Wrap `buildAgentHistory` (or at least the presentation mapping) in `useMemo` keyed on the actual row/event identity, not `Date.now()`, in all three call sites — or explicitly narrow decision 2's claim to "the diff runs once per unique pair per render, and renders can be far more frequent than the 3s poll," and re-justify the summary-time cost against that real frequency.

---

## Finding 2: The differ's own contract contradicts itself on which refusals are memoized — the cheapest-sounding case is the one that is NOT cached

- **Severity:** High
- **Location:** `phase-01-start.md`, "Contract to implement" → `diff-hunks.ts`, Rules 1 and 2.
- **Flaw:** Rule 1 says: "If `before.length > MAX_DIFF_SIDE_BYTES` ... return `null` immediately ... Otherwise measure `new TextEncoder().encode(side).byteLength` for each side and return `null` if either exceeds the ceiling. **Only then** build the memo key." Rule 2 says: "Refusals (`null`) are memoized too so a pathological pair costs the ceiling check once per eviction window at most." These are mutually exclusive for the byte-ceiling path: if the memo key is built _only after_ the ceiling check passes, a pair that fails the ceiling check never reaches the memo `Map` at all, so it is never stored and never memoized — directly contradicting Rule 2's blanket claim.
- **Failure scenario:** Consider the plan's own "byte ceiling, multibyte" test case: `'é'.repeat(MAX_DIFF_SIDE_BYTES / 2 + 1)` — a ~32,769 UTF-16-code-unit string whose `.length` is under `MAX_DIFF_SIDE_BYTES` (65,536), so the cheap pre-check in Rule 1 does not fire; the function must fall through to `new TextEncoder().encode(side).byteLength` for **both** sides — an O(n) encode over ~32KB+ of text — before it can even build the memo key. Because refusal happens before the key is built, this ~32–65KB double-encode cost is **not cached** and re-runs on every single call. Combined with Finding 1 (every render, not every poll), a single large multibyte `Write`/`Edit` row sitting anywhere in a long transcript pays this encode cost on every unrelated re-render of the node room, indefinitely — the opposite of "costs the ceiling check once per eviction window at most."
- **Evidence:** `phase-01-start.md` verbatim: "If `before.length > MAX_DIFF_SIDE_BYTES`... return `null` immediately... **Only then** build the memo key" (Rule 1) vs. "Refusals (`null`) are memoized too" (Rule 2). The test table's "byte ceiling, multibyte" row only asserts "the injected patch function... is not invoked" — it never asserts the memo was populated or that a second call skips the `TextEncoder.encode` step, so this contradiction can ship and pass every specified test.
- **Suggested fix:** Either (a) build the memo key before the ceiling check (memoize on raw string identity before measuring), or (b) explicitly scope Rule 2's memoization claim to only the `maxEditLength`/throw refusal paths (which do occur after key construction), and add a test that asserts the encode step itself is not repeated for a cached over-ceiling multibyte pair.

---

## Finding 3: `DIFF_MEMO_ENTRIES = 64` with FIFO (not LRU) eviction is shared process-wide and will thrash in the plan's own target scenario

- **Severity:** High
- **Location:** `phase-01-start.md`, `diff-hunks.ts` contract, `DIFF_MEMO_ENTRIES = 64` and Rule 2 ("evicts the oldest entry when `size > memoEntries`").
- **Flaw:** The memo is a single shared instance (`export const diffHunks: DiffHunksFn`) used by every row on every surface in the whole app, capped at 64 entries, evicted in **insertion order** (not access/recency order — confirmed by the test description "a third distinct pair on a `memoEntries: 2` instance evicts the first ... calling the first pair again returns ... `not.toBe`"). This is a FIFO cache, not an LRU cache: an entry that is still being actively re-rendered (per Finding 1, on every render) gets evicted purely because 64 _other_ distinct pairs were computed after it, regardless of how recently or frequently it was accessed.
- **Failure scenario:** Archon's flagship use case is a long-running coding agent session doing dozens of file edits (`AGENTS.md`: "Its most mature surface today is agentic coding... controlling Claude Code / Codex against repos"). Once a session accumulates more than 64 distinct before/after pairs (very plausible for a multi-hour agentic refactor), the FIFO eviction guarantees the early rows are evicted even though they remain visible and still re-rendered on every scroll/poll (Finding 1). From that point on, **every** render of the transcript re-runs `structuredPatch` (bounded to 65,536 bytes/side and 2,000 edits) for every evicted-but-visible row, contradicting decision 2's premise that the memo makes this free. A true LRU (recency-based) cache would at least protect actively-viewed rows; FIFO does not.
- **Evidence:** `phase-01-start.md` Rule 2, "evicts the oldest entry when `size > memoEntries`"; `plan.md` Decision 2, "the result is memoized on the pair so `toolBodyPresentation()` reuses it for free"; `plan.md` Decision 11, "insertion-ordered `Map`... evicting the oldest entry past the cap."
- **Suggested fix:** Either size the shared cache to the realistic long-session row count, or switch to LRU (`Map` re-insertion on hit — `Map` iteration order already gives this "for free" by deleting-then-reinserting on every hit), or scope the memoization claim honestly to "short sessions" and record the eviction behavior as a documented risk (it currently is not called out in "Risks and safeguards" for any phase).

---

## Finding 4: Adding a required `diff` field to the `ToolBody` file member breaks an existing test the plan's own exit criterion claims will still pass

- **Severity:** Medium
- **Location:** Phase 1, section "`tool-presentation.ts`" (ToolBody file member becomes `{ kind: 'file'; path; preview; unreadable; diff: FileDiff | null }`); Phase 1 exit criteria ("all pre-existing `tool-presentation.test.ts` cases still pass").
- **Flaw:** `packages/web/src/lib/tool-presentation.test.ts:1262-1269` (describe `'file body'`) contains:
  ```ts
  test('shows the path and normalized preview text', () => {
    const b = body('Read', { file_path: '/a.ts' }, { file: { content: 'line1\nline2' } }, 'file');
    expect(b).toEqual({
      kind: 'file',
      path: '/a.ts',
      preview: 'line1\nline2',
      unreadable: false,
    });
  });
  ```
  This is a strict `toEqual` on the full object shape. Once the `file` member gains a mandatory `diff` field, the actual return value will include `diff: null` (a `Read` call has no `old_string`/`new_string` pair) and this assertion will fail deep-equality, because `toEqual` treats an extra key on the actual object as a mismatch. The plan lists `tool-presentation.test.ts` under "new tables" for Phase 1 but never explicitly calls out updating this **existing** assertion; the only explicit "fix existing assertions" instruction in Phase 1's implementation order is scoped to `ToolRowBadgeTone` enumeration ("Fix any existing assertion that enumerated `ToolRowBadgeTone` members"), not to `ToolBody` shape assertions.
- **Failure scenario:** An implementer following the phase file literally treats "new tables" as additive and does not think to search for this pre-existing strict-equality assertion; `bun test src/lib/tool-presentation.test.ts` fails, and the exit criterion "all pre-existing `tool-presentation.test.ts` cases still pass" is unreachable without an unscoped edit.
- **Evidence:** `packages/web/src/lib/tool-presentation.test.ts:1262-1269`; `phase-01-start.md` §"Implementation order" step 4 only mentions `ToolRowBadgeTone`.
- **Suggested fix:** Add an explicit line to Phase 1's file list / implementation order: "update the existing `'file body'` describe block's `toEqual` assertions to include `diff: null`."

---

## Finding 5: `bodyBarText`'s `isTaskBody` gate removal is claimed "behavior-preserving" but is verified only by absence of counterexamples today, not by any invariant the plan enforces going forward

- **Severity:** Medium
- **Location:** `plan.md` Decision 9; `phase-01-start.md` §"`tool-presentation.ts`" ("replace `...(isTaskBody ? content.bodyFacts : [])` with `...content.bodyFacts`").
- **Flaw:** This edit is currently safe only because, as verified by reading the full `switch (family)` block in `toolPresentation()` (`packages/web/src/lib/tool-presentation.ts:562-634`), exactly one case (`'task'`) assigns a non-empty `bodyFacts` today, and Phase 1 adds a second (`'file'`). Nothing in the type system or a test enforces that a _third_ future family case can't populate `bodyFacts` without updating `toolRowPresentation()`'s bar composition — the "only task and file rows ever populate them" invariant is a comment, not a check. This is a load-bearing but unenforced assumption: the plan is generalizing a previously-gated code path from 1 case to 2 by simply deleting the gate, on the strength of a hand-verified snapshot of the current switch statement.
- **Failure scenario:** A future change (outside this plan, but enabled by this plan's precedent) adds `bodyFacts` to, say, the `search` or `code` case for an unrelated reason; because the gate is gone, every `search`/`code` row's body bar silently starts showing those facts with no test catching the regression, since Phase 1's own tests only assert the two known-good cases.
- **Evidence:** `packages/web/src/lib/tool-presentation.ts:562-634` (only the `'task'` case sets `bodyFacts`); `plan.md` Decision 9 comment "(a behavior-preserving generalization: only task and file rows ever populate them)" — stated as fact, not enforced.
- **Suggested fix:** Not blocking for this plan's own scope, but worth a one-line boundary test asserting `bodyFacts` stays `[]` for every family other than `task`/`file`, so the invariant this decision relies on is actually guarded.

---

## Finding 6: The Codex "no-input" acceptance clause is satisfied by a fake-provider fixture that cannot exercise the real Codex code path it claims to cover

- **Severity:** Medium
- **Location:** `plan.md` Decision 12 ("No Codex change... satisfied by the one-sided and no-input `file` rows"); Phase 3 §"Deterministic fixture design" (`edit-no-input` / `bare` variant).
- **Flaw:** The plan's own authority section states, correctly, that "Codex serializes `file_change` items as a `system` message, never as a tool row" (verified: `packages/providers/src/codex/provider.ts` ~line 709 per the plan's citation). This means real Codex file edits **never reach** `toolPresentation`/`ToolBodySwitch` at all — they are not tool rows and are invisible to this entire feature, diff or no diff. The Phase 3 `edit-no-input` fixture (`bare` → tool name `edit` with no `toolInput`) is a synthetic e2e-fake construction that proves the presentation layer degrades gracefully for a tool-row shape Codex never actually produces. It is a legitimate defensive test for a hypothetical no-input row, but it does not verify anything about Codex, and the plan's own framing ("Codex edit without input" acceptance case) risks being read as closing a Codex-specific gap when no such gap is exercised or closed by any test in this plan.
- **Failure scenario:** If Story 1.4's acceptance criteria (in `epics.md`) actually require operators to see _some_ rendering of Codex file edits (even as a system message) without a fabricated diff, this plan does not verify that claim at all — it only proves an unrelated synthetic tool-row shape doesn't crash. Anyone auditing "was the Codex clause satisfied" against this plan's evidence will find a fixture that never touches Codex's actual `system`-message path.
- **Evidence:** `plan.md` §"Current code" bullet on Codex; `phase-03-verification-and-closeout.md` §"Fake-provider scenario" (`bare` variant description).
- **Suggested fix:** Either explicitly confirm (with a citation to the spec) that Codex `file_change` system messages are out of Story 1.4's scope entirely, or add a narrow assertion (unit or component) that a Codex-style `system` message renders unchanged by this feature — closing the gap the plan currently only gestures at.

---

### Verification Results

**Tier:** Standard (Fact Checker + Contract Verifier, 10 claims/phase)

**Phase 1 claims checked (8):**

1. `BEFORE_AFTER_PAIRS` at `tool-presentation.ts:142` — VERIFIED (`packages/web/src/lib/tool-presentation.ts:142-145`)
2. `bodyBarText` gated on `isTaskBody` today — VERIFIED (`packages/web/src/lib/tool-presentation.ts:805,815`)
3. `ToolRowBadgeTone` lacks `success` today — VERIFIED (`packages/web/src/lib/tool-presentation.ts:64`)
4. `git-hunk-adapter.ts` imports types from `@/lib/api` — VERIFIED (`packages/web/src/components/workflows/source-control/git-hunk-adapter.ts:3`)
5. `ToolBody` file member shape has no `diff` field today — VERIFIED (`packages/web/src/lib/tool-presentation.ts:847`)
6. `diff` undeclared in `@archon/web` deps; lockfile hoists `diff@8.0.3` — VERIFIED (`packages/web/package.json`, `bun.lock:2163`)
7. `GitDiffChange` discriminated union (`insert`→`newLine`, `delete`→`oldLine`, `normal`→both) — VERIFIED (`packages/web/src/lib/api.generated.d.ts:5711-5726`)
8. Rule 1/Rule 2 memoization ordering as quoted — VERIFIED as an internal self-contradiction in the phase text itself (see Finding 2)

**Phase 2 claims checked (6):** 9. `BADGE_TONE`/`GLYPH_TONE` maps and `succeeded: 'text-success'` in both renderers — VERIFIED (`NodeRoom.tsx:318-333`, `ConsoleAgentHistoryList.tsx:259-267`) 10. `console-isolation.test.ts` approved set includes `@/lib/tool-presentation`, `@/lib/tool-output` with `#176` precedent comment — VERIFIED (`console-isolation.test.ts:115-129`) 11. `eslint.config.mjs` bans `@/components/**` and named imports from `@/lib/api` for `experiments/console/**` — VERIFIED (`eslint.config.mjs:122-154`) 12. `ToolBodySwitch` `useMemo` deps `[input.name, input.input, input.output, presentation.family]` (no `statusLabel`) — VERIFIED (`NodeRoom.tsx:505-508`, `ConsoleAgentHistoryList.tsx` equivalent) 13. Only `virtualized-diff.tsx` and its test import `git-hunk-adapter` today — VERIFIED (no other consumer found) 14. `diff`/`structuredPatch` not currently imported anywhere in `packages/web/src` — VERIFIED

**Phase 3 claims checked (2):** 15. `archon-runtime.ts` task-dispatch registration precedent (`E2E_TASK_DISPATCH_WORKFLOW_NAME`, `runTaskDispatchWorkflow`) — VERIFIED (`e2e/lib/playwright/archon-runtime.ts:87,567-576`) 16. `e2e-fake` `scenarioSchema` is `.strict()` with `superRefine` exclusivity keyed on `taskDispatch` — VERIFIED (`packages/providers/src/e2e-fake/provider.ts:128-153`)

**Failures:** none of the sampled factual claims about current code were factually wrong; the defects found are internal contradictions and unstated consequences within the plan's own new contract (Findings 1, 2, 3, 4), not misreadings of the existing codebase.

**Unverified:** jsdiff 9.0.0 and react-diff-view 3.3.3 library-internals claims were treated as sourced per task instructions (not independently re-fetched from npm/GitHub in this pass).

---

Status: DONE
Summary: Found one critical and two high-severity findings that undermine the plan's central performance justification (Decision 2: "the diff is free because it's memoized") — the differ actually runs on every render across three unmemoized call sites, its own refusal-memoization rule contradicts itself for the multibyte-ceiling path, and its 64-entry FIFO cache will thrash in exactly the long coding-session scenario this product targets. Also found a concrete existing-test breakage the plan's Phase 1 exit criterion doesn't account for, plus two medium-severity scope/invariant gaps.
Concerns/Blockers: Findings 1–3 compound: an implementer who ships Phase 1/2 as written will pass every specified unit test while leaving a real, unbounded-by-the-plan's-own-logic CPU cost on the transcript render path for long sessions with large or numerous file edits — recommend resolving Findings 1 and 2 before Phase 2 implementation starts, since Phase 2's rendering work builds directly on the assumption that the summary-time diff is cheap.
