---
title: 'Issue 176 tool family bodies'
description: 'Verified implementation plan for Story 1.3: bounded family-shaped tool bodies on Legacy and Console, plus a read-only generic-fallback release audit.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/anhle128/Archon/issues/176'
branch: archon/thread-c192ed5c
tags: [issue-176, agent-node-room, web, tdd, epic-1, feature, frontend]
blockedBy: []
blocks: []
created: 2026-09-18
revised: 2026-09-18
baseline: 1466e2ca97a2a925c13cfd4606b560989d298d8f
---

# Issue 176 tool family bodies

## Goal and user outcome

When an operator expands a tool row, show a bounded, readable body appropriate to the resolved family instead of serialized provider data:

- shell: full command, output, and the existing exit/outcome facts;
- search: matches, paths, or a generic count body according to grep mode;
- glob: flat paths;
- code: bounded highlighted source and result;
- web: requested URL, optional title/results, and safe markdown;
- file: path plus preview until Story 1.4 owns inline diffs;
- unknown tools: at most three scalar `key: value` rows, with objects and arrays represented by `{…}` and `[n]`.

Raw remains the only serialized-payload view. Both Legacy and Console must behave the same. A read-only release audit must measure the generic fraction over an owner-ratified corpus and denominator and fail the release at `>= 2%`; the recommended denominator is one logical UI tool card per invocation, but the historical raw-row metric must be reconciled first.

This is Story 1.3 / FR2 / CAP-2 / UX-DR3. It is a presentation and release-verification change. It does not change stored rows, APIs, schemas, generated types, providers, or the workflow engine.

## Acceptance boundary

In scope:

- a pure, provider-agnostic, bounded output normalizer;
- a lazy body resolver that consumes the already-resolved family without changing it;
- family bodies on both room surfaces in Story 1.2's Raw/presented-body swap;
- safe markdown and scoped syntax colors matching the approved design artifacts;
- a read-only generic-fallback audit, its tests, and release integration after the corpus/denominator authority blocker is resolved;
- reconciliation of the machine contract/test plan where the repository sources currently contradict each other;
- focused unit/component/E2E/visual/a11y evidence and story-close records.

Out of scope:

- Story 1.4 diffs, Story 1.5 todo folding, Story 1.6 task cards, Story 1.7 occurrence grouping, and steering;
- inventing temporary todo/task bodies; until their owning stories land, those families retain the body bar and Raw access but no presented family body;
- changing the four-tier family resolver, summary-row anatomy, full-output fetch contract, persistence, database schema, or provider serialization;
- new frontend/runtime dependencies. If the owner selects direct PostgreSQL audit support, any audit-only connector/tooling dependency must be an explicit part of that decision rather than an incidental transitive import;
- a shared React component between Legacy and Console.

## Evidence inspected

The plan was re-derived from repository state, not from the previous draft:

- Story and capability authority: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (Story 1.3), `_bmad-output/specs/spec-agent-node-room/SPEC.md` (CAP-2), `tool-presentation-contract.md`, and `test-plan.md`.
- Design authority: `EXPERIENCE.md`, `DESIGN.md`, `mockups/key-transcript-states.html`, `key-console-node-room.html`, and `key-legacy-node-room.html` under `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`.
- Current end-to-end path: provider serializers; `packages/web/src/lib/pair-tool-transcript.ts`, `agent-history.ts`, and `tool-presentation.ts`; both ToolHistory renderers and their tests; `packages/web/src/index.css`; Console isolation; full-output routes; the 3-second room polling path; and the HITL/visual Playwright fixtures.
- Provider contracts: pinned `@anthropic-ai/claude-agent-sdk@0.3.209` `sdk-tools.d.ts`, OMP/Devin/Grok/Codex serializers, and read-only sampling of the local SQLite corpus. Corpus counts are live observations, not plan constants.
- Corpus provenance: `plans/260909-2130-live-interactive-agent-view/findings.md` and the readable-transcript `.memlog.md` trace the 22,867-row measurement to a 1.7 GB Mac mini SQLite database at `/Users/agent/.archon/archon.db` on 2026-09-09. They do not establish that machine as the continuing release authority or reconcile raw rows with the current call/result pairing model.
- Operational path: `scripts/migrate-state-dir.ts` and its subprocess tests, root scripts/validation, `.github/workflows/test.yml`, and `.claude/skills/release/SKILL.md`.
- Coordination state on 2026-09-18: issue #175 is open with `status:processing` and has no PR; the current renderers still show the Story 1.1 Input/Output bridge. Issue #176 declares only Story 1.1 as a product dependency.

## Corrected decisions

1. **Story 1.2 is a code-concurrency gate, not a product dependency.** Phase 1 can proceed. Before editing either renderer, rebase onto #175's merged implementation or coordinate file ownership; do not implement against its draft plan. The separate audit-authority blocker still governs Phase 3.
2. **Do not attach bodies to `ToolPresentation`.** `buildAgentHistory()` and Console history projections run during polling, and Console can mount the same history in more than one place. Keep summary presentation cheap. Add `toolBodyPresentation(input, resolvedFamily)` and call it only while the row is open and Raw is closed. A full-output load recomputes the body from the loaded output.
3. **Output never reclassifies the family.** Family resolution and the audit remain name/input only. Output parsing selects content within that family.
4. **Normalization exposes semantic channels, not a first-hit union.** One payload can supply text, paths, structured matches, counts, title, web results, and scalar fields simultaneously. Recognize only documented structural paths; do not search arbitrary nested values or branch on provider identity.
5. **Grep mode precedence is explicit input -> recognized output mode/shape -> alias default.** Exact Claude `Grep` with no mode defaults to `files_with_matches`/paths, matching its pinned SDK contract. Lowercase `grep` and other content-search aliases with no mode default to matches. Explicit `count` uses the generic **body arm** and count badge while the resolved family remains `search`. Update the contradictory absent-mode test-plan sentence.
6. **Pinned declarations are the Claude fixture authority.** No exploratory model run or temporary workflow is required. Use the exact SDK output declarations for Bash, file tools, Glob, Grep, WebFetch, and WebSearch, plus observed OMP/Devin/Codex shapes.
7. **Truncated JSON salvage is narrow.** A bounded tokenizer may recover only allowlisted semantic string values (`stdout`, `stderr`, `text`, `content`, `result`) and must handle incomplete escapes and a trailing lone surrogate. It never returns an arbitrary last string literal. Otherwise the body reports unreadable and points to Raw.
8. **All body content is bounded.** Cap source, command, output text, decoded byte arrays, paths/matches/results, keys scanned, and rendered fields with exported constants. Apply ANSI stripping during bounded text production, not after creating an unbounded intermediate string. Over-cap JSON degrades; it is not synchronously parsed on the UI thread.
9. **Generic has one three-row budget.** Merge eligible input fields and normalized output fields in stable order, stopping at three total. Objects use `{…}`, arrays `[n]`. Tests forbid serialized object syntax/quoted JSON keys, not the required `{…}` marker or legitimate braces in prose/source.
10. **Markdown is stored-data-safe.** Reuse `ReactMarkdown`, `remark-gfm`, `remark-breaks`, and `rehype-highlight`, never `rehype-raw` or `dangerouslySetInnerHTML`. Override `a` to inert label/destination text and `img` to alt text plus an omitted marker so stored output cannot navigate or make network requests. WebSearch results are flattened into this inert presentation.
11. **Syntax colors require scoped CSS.** The global highlight.js theme does not implement the design's token mapping. Add `.tool-family-body .hljs-*` overrides in `packages/web/src/index.css`: keywords from the approved node-prompt/primary mix, strings from success, comments/annotations from text-secondary; preserve unknown-language plain code.
12. **The proposed corpus denominator is logical cards, pending owner ratification.** Query rows ordered and grouped by `(workflow_run_id, node_id)`, parse them to the structural message type, and call `projectToolTranscript()`. Count each projected `tool-card` once, including pending call-only and legacy result-only cards. This matches what the UI presents and avoids double-counting modern call/result rows, but it differs from the literal raw-row wording behind the historical 22,867-row threshold; Phase 3 treats that as a blocker, not an implicit contract rewrite.
13. **The audit is non-mutating by default.** Default prints a result. An explicit record flag is the only file write; database handles are read-only; the module has an `import.meta.main` guard; subprocess tests provide a temp database and a scrubbed environment. Never import the normal Archon database connection because both adapters apply schema on construction.
14. **Audit authority remains a blocker.** The repository names the historical Mac mini measurement, but this single-tenant SQLite/PostgreSQL product does not say that install remains authoritative and defines no continuing access path, denominator migration, record location, freshness rule, or releaser procedure. The old draft silently substituted the current developer SQLite DB and `docs/release-audits/`. Phase 3 records the required decisions rather than guessing.

## End-to-end design

```text
stored transcript rows
  -> projectTextTranscript()
  -> projectToolTranscript()            # one logical card per call/result pair
  -> toolRowPresentation()              # existing cheap family/headline/badges
  -> closed row: no body parsing
  -> open row + Raw closed:
       toolBodyPresentation(payload, item.presentation.family)
         -> normalizeToolOutput(output) # bounded semantic channels
         -> terminal | file | matches | paths | code | web | generic | null
       -> local Legacy/Console ToolBody JSX
  -> Raw open: Story 1.2 exact payload view replaces presented body
  -> full output loaded: body resolves again against fetched output
```

Proposed shared contract (names may adjust to local TypeScript style, semantics may not):

```ts
interface NormalizedToolOutput {
  text: string | null;
  paths: BoundedList<string>;
  matches: BoundedList<{ path: string | null; line: number | null; text: string }>;
  webResults: BoundedList<{ title: string | null; url: string }>;
  fields: { key: string; value: string }[];
  counts: { matches: number | null; files: number | null };
  mode: 'content' | 'files_with_matches' | 'count' | null;
  unreadable: boolean;
}

interface BoundedList<T> {
  items: T[];
  /** 0 when complete, a positive exact count when known, null when a capped tail is inexact. */
  omitted: number | null;
  truncated: boolean;
}

type ToolBody =
  | { kind: 'terminal'; command: string; output: string | null; unreadable: boolean }
  | { kind: 'file'; path: string; preview: string | null; unreadable: boolean }
  | {
      kind: 'matches';
      pattern: string;
      scope: string | null;
      items: MatchItem[];
      omitted: number | null;
      truncated: boolean;
    }
  | {
      kind: 'paths';
      pattern: string;
      scope: string | null;
      items: string[];
      omitted: number | null;
      truncated: boolean;
    }
  | {
      kind: 'code';
      language: string | null;
      source: string;
      result: string | null;
      truncated: boolean;
    }
  | {
      kind: 'web';
      url: string;
      title: string | null;
      markdown: string | null;
      omitted: number | null;
      truncated: boolean;
    }
  | { kind: 'generic'; fields: ToolField[]; markdown: string | null; unreadable: boolean };
```

`toolBodyPresentation()` returns `null` for todo/task and must catch malformed/adversarial values, returning a safe generic/unreadable representation without throwing. Count extraction needed by collapsed badges remains a small independently bounded summary operation; it must not run the full normalizer.

## Design acceptance

- Body bar starts with resolved family, retains existing badges/facts, keeps Raw at the far right, and does not wrap or drop the family word at the 460px contractual panel width.
- Body box uses `surface-inset`, 1px border, 6px radius, 8px x 10px padding, 11.5px/1.5 mono text, and `pre-wrap`; long tokens wrap without panel-level horizontal scrolling.
- Terminal `$` uses node-bash and failed state remains text plus error styling; paths use node-command; match line numbers/comments use text-secondary; code keywords/strings/comments use the approved mappings.
- Search body shows pattern and optional scope, then structured `path:line: text` items; glob/path mode never invents line numbers. A capped list shows `+n more` when the exact omitted count is known and `more results omitted` otherwise.
- Code result is a second body box 6px below source. Unknown languages render plain source and never throw.
- Web URL is visible inert text, optional title follows, and markdown headings/lists/code render. Links render label plus a non-clickable destination (without duplicating a bare URL), and images render alt text plus an omitted marker; neither can navigate or fetch.
- Generic keys occupy the documented `11ch` column and no more than three combined rows render.
- Empty/running/unreadable states are explicit and do not fabricate output. Full-output and Retry controls remain below the presented/Raw body.
- The transcript defines no new responsive breakpoint. At 460px on both surfaces: summary stays one line, body bar stays one line, content wraps inside the body box, controls remain reachable, and no panel-level horizontal scrollbar appears.
- Existing keyboard order remains summary -> Raw -> full-output/retry controls; Raw and row retain 24x24 minimum target, focus visibility, reduced-motion behavior, and accessible status text.

## Implementation phases

| #   | Phase                                                                          | Dependency                                            | Deliverable                                                                       |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | [Shared normalizer and lazy body contract](./phase-01-start.md)                | Story 1.1 only                                        | pure bounded normalizer/body resolver, corrected specs, table tests               |
| 2   | [Legacy and Console renderers](./phase-02-two-surface-renderers.md)            | Phase 1; coordinate/rebase after #175                 | safe family bodies and scoped styling on both surfaces                            |
| 3   | [Audit, verification, and closeout](./phase-03-audit-gate-and-verification.md) | Phases 1-2; audit-authority decision for release hook | read-only audit, conditional record/release hook, E2E/visual/a11y/full validation |

## Global file inventory

| Path                                                                                                    | Action                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-output.ts` / `.test.ts`                                                      | create bounded semantic normalizer and fixtures                                                   |
| `packages/web/src/lib/tool-presentation.ts` / `.test.ts`                                                | add lazy body contract/resolver; preserve summary resolver                                        |
| `packages/web/src/components/workflows/NodeRoom.tsx` and tests                                          | Legacy ToolBody in #175 swap slot                                                                 |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` and Console tests | Console ToolBody in #175 swap slot                                                                |
| `packages/web/src/index.css`                                                                            | scoped syntax-token overrides only                                                                |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`                                 | reconcile lazy body API and file/web arms                                                         |
| `_bmad-output/specs/spec-agent-node-room/test-plan.md`                                                  | correct story/grep/`{…}` assertions; record audit-denominator decision                            |
| `scripts/audit-generic-fallback.ts` / `.test.ts`                                                        | create non-mutating audit after Phase 3 decision                                                  |
| `.claude/skills/release/SKILL.md` and durable audit record                                              | conditional on the authority/record decision                                                      |
| `e2e/ui/workflow-run-hitl-room.spec.ts`, `agent-tool-row-visual.spec.ts`                                | assert the deterministic Read/file body and Raw swap; visual states                               |
| plan `reports/`, `sprint-status.yaml`, story evidence file                                              | implementation evidence and closeout; exact evidence convention re-scouted at implementation time |

No Console isolation allowlist change is needed if both renderers import only `@/lib/tool-presentation`, which is already approved. Add a direct `tool-output` import only if implementation proves it necessary, then update the allowlist deliberately.

## Audit decision blocker

Before recording a result or editing the release skill, the product/release owner must choose and document:

1. the authoritative single-tenant install/corpus;
2. whether the historical raw-row threshold is retained or the recommended logical-card denominator is ratified for the paired storage model;
3. whether the gate must support SQLite, PostgreSQL, or both;
4. the durable non-evergreen record path and retention policy;
5. maximum record age and who refreshes it before a release;
6. whether tool names may be committed in `topGenericNames` or only aggregate counts;
7. for PostgreSQL, whether the approved read-only path is existing `psql` tooling or an explicitly declared root audit dependency; do not rely on `@archon/core`'s transitive `pg` installation or its schema-applying adapter.

Recommended option: ratify logical UI cards as the denominator, support both deployed dialects through explicit read-only connection arguments, require an explicit record command, store only snapshot time/dialect/counts/fraction, an audit-source hash covering classification and logical pairing, and approved aggregate names; make `/release` reject a missing/stale/source-mismatched/`>= 0.02` record before any version mutation. If the historical raw-row metric or only a designated reference SQLite corpus is intended, record that product decision and implement exactly that policy rather than silently comparing unlike populations or auditing the wrong install.

## Measurable acceptance criteria

- [ ] Every enumerated Story 1.3 body family plus file preview has unit and both-surface component coverage; todo/task are unchanged and explicitly tested as not receiving placeholder bodies.
- [ ] Family resolution is identical with and without output; exact Claude `Grep` absent mode resolves paths while lowercase OMP `grep` absent mode resolves matches.
- [ ] Default presented bodies contain no serialized provider object/array. Required `{…}`/`[n]`, source-code braces, and prose are not falsely rejected.
- [ ] All parsing/rendering limits and overflow indicators have boundary/adversarial tests; closed rows do not call the body resolver.
- [ ] Safe markdown tests prove anchors/images are inert and raw HTML is not interpreted; unknown code languages are safe.
- [ ] Both surfaces match the design criteria at 460px for normal, empty, unreadable, truncated, failed, Raw-open, and full-output-loaded states.
- [ ] Audit fixture tests prove logical pairing, legacy rows, pending calls, malformed rows, read-only access, print-only default, explicit record, threshold equality (`0.02` fails), stale/missing record behavior, and no import side effect.
- [ ] The existing deterministic HITL Read row shows path/preview and Raw swapping on both surfaces. Other arms are proven by unit/component tests and deterministic Playwright route-layer visual fixtures rather than expanded fake-provider behavior.
- [ ] `bun --filter @archon/web test`, script tests, `bun run validate`, and `bun run --cwd e2e test:ui:hitl` pass and are recorded. Do not run root `bun test` directly.
- [ ] Release integration is completed only after the audit blocker is resolved; sprint status moves to `done` only when every Story 1.3 criterion, including the release gate, is satisfied.

## Compatibility, rollout, and rollback

- Old and current call/result shapes continue through `projectToolTranscript`; malformed, absent, truncated-at-rest, and transport-truncated output must degrade without throwing. No data migration or backfill exists.
- New parsing is lazy, capped, and local to expanded rows, preventing each poll from reparsing the transcript. The audit streams/groups only required tool columns and must document memory behavior for the selected corpus.
- Rollout is a normal web/release-tool change. Keep Raw and full-output paths untouched so every degraded presentation remains inspectable.
- Rollback is a focused revert of the body resolver/renderers/style/audit hook. Stored data and public API remain compatible.

## Final review checklist

- **Product:** expanded rows answer “what ran and what came back?” without requiring Raw.
- **Architecture/contracts:** one pure resolver feeds both renderers; output does not alter family; docs and tests agree.
- **Security/data integrity:** stored content is inert, parsing bounded, audit read-only, no payloads leaked into the record.
- **Performance/scalability:** no closed-row body work; list/text bounds and audit corpus behavior are explicit.
- **Completeness/testing:** all verified provider shapes, degraded states, surfaces, 460px layout, keyboard/a11y, E2E, and release threshold are covered.
- **Operations/compatibility:** #175 coordination, corpus authority, dialect, freshness, local HITL gap, rollback, and closeout are explicit.
- **Maintainability:** provider differences stop at a pure normalizer; renderer JSX stays surface-local; no speculative todo/task/diff abstraction is added.

## Task tracking

The phase files are the execution checklist. No external task-management surface is available in this session.
