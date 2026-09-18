---
title: 'Issue 176 tool family bodies'
description: 'Implementation-ready plan for Story 1.3: expanded tool-call bodies shaped for the tool family, edge-normalized provider output, and the read-only generic-fallback release audit, on Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/anhle128/Archon/issues/176'
branch: archon/thread-c192ed5c
tags: [issue-176, agent-node-room, web, tdd, epic-1, feature, frontend]
blockedBy: []
blocks: []
created: 2026-09-18
---

# Issue 176 tool family bodies

## Goal and user outcome

Story 1.3 gives an operator who expands a tool row a body shaped for the kind of action it was: a terminal block for shell, a match list or a path list for search (chosen by `output_mode`), a flat path list for glob, highlighted source for code, URL plus markdown for web, and — for a tool that matches no family — at most three scalar `key: value` pairs with `{…}` / `[n]` for objects and arrays. Serialized JSON never appears as a default presentation; the Raw toggle from Story 1.2 stays the only place it shows. The story also ships the read-only corpus audit that measures the generic-fallback fraction on the deployment database and the release gate that fails at 2% or more.

This is FR2 / CAP-2, UX-DR3 and NFR3 from the Agent Node Room epic. It is a presentation-only slice over data already stored: no schema, migration, backend, API, or generated-type change.

## Evidence and authority

When sources differ, use them in this order:

1. Story 1.3 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:261-288` and CAP-2 in `_bmad-output/specs/spec-agent-node-room/SPEC.md:58-60`.
2. `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` (module shape `:6-52`, four tiers `:65-151`, expanded body table `:176-189`) and `test-plan.md` (`:12-36` unit table, `:38-44` corpus audit).
3. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` body rows (`:112-124`) and `DESIGN.md` body-box tokens (`:219-236`), component specs (`:587-597`), key-value list (`:256-257`, `:613`).
4. Current product code and tests for behaviour the story keeps, including the Story 1.2 plan at `plans/260918-1038-issue-175-raw-payload-toggle/` for the body-area structure this story fills.

Verified repository facts (all `file:line` against `develop` at `7a66a288`):

- The shipped presenter is the Story 1.1 row subset: `ToolPresentation` has no `body` (`packages/web/src/lib/tool-presentation.ts:59-69`); its docblock says "bodies arrive in a later story" (`:59`) and must be rewritten without story references. Resolution runs in `resolveToolPresentation` (`:419-503`) and `toolRowPresentation` spreads the content presentation into the row model (`:588-594`), so a `body` added to `ToolPresentation` reaches every row and every `hasFullOutput` re-run for free.
- `countBadge` receives the raw output value (`:460`, `:413-417`), and `extractCount` only inspects a top-level `count` key or a digit-only string (`:325-347`). Every provider persists `output` as a **string**, so the count fact can fire today only for a digit-only string.
- Every provider stores `output` as a string; most are `JSON.stringify` of provider-private shapes. Claude: `PostToolUse` stringifies `tool_response` and truncates to 10,000 chars + `...` at rest (`packages/providers/src/claude/provider.ts:917-926`). OMP: `serializeToolResult` (`packages/providers/src/community/omp/event-parser.ts:37-44`). Devin/ACP: `toolOutputFromUpdate` stringifies `rawOutput` (`packages/providers/src/community/devin/event-bridge.ts:51-61`). Grok: `serialize(output)` (`packages/providers/src/grok/event-parser.ts:22-29`, `:283`). Codex: plain `aggregated_output` plus a `\n[exit code: N]` suffix when non-zero (`packages/providers/src/codex/provider.ts:642-659`).
- Measured on the local deployment corpus (`/Users/agent/.archon/archon.db`, read-only, 2026-09-18): 3,794 tool rows, 1,966 call rows. Observed output shapes: Claude `Bash` → `{"stdout","stderr","interrupted","isImage","noOutputExpected"}`; Claude `Read` → `{"type":"text","file":{"filePath","content",…}}`; Claude `Write` → `{"type":"create","filePath","content"}`; Claude `Edit` → `{"filePath","oldString","newString","originalFile","structuredPatch",…}`; OMP `read`/`grep` → `{"content":[{"type":"text","text":…}]}` or plain numbered text; OMP `exec` → plain text with ANSI escapes; Devin `read_file` → `{"type":"ReadFile","FileContent":{"content",…}}`, `run_terminal_command` → `{"type":"Bash","output":[…bytes]}` (107 rows), `list_dir` → `{"type":"ListDir","Content":{"content"}}` (indented tree text), `search_replace` → `{"type":"SearchReplace","EditsApplied":{…}}`; Codex → plain text. Claude `Grep`, `Glob`, `WebFetch`, `WebSearch` have **zero** local rows — their output shapes are `[UNVERIFIED]` until Phase 1 captures them.
- 53 of 725 JSON-looking outputs (7.3%) are truncated at rest and fail `json_valid` (33 `Bash`, 10 `Edit`, 6 `Read`, 4 `Write`). Their metadata carries `truncated: true, output_state: 'truncated'` with **no** `full_output_available`, so `View full output` cannot recover them: an unparseable `{"stdout":"…` string is a main-path degraded state, not an edge case. The separate 16 KiB transport cap (`packages/server/src/adapters/web/truncate.ts:10`, `:22-31`) appends a `… [truncated N KB …]` marker and **does** set `full_output_available` (`packages/server/src/routes/api.ts:5219-5228`), so those rows recover on load.
- With the shipped resolver replayed over the 1,966 local call rows (`toolPresentation({ name, input, output: undefined })`), 20 resolve to `generic` — **1.02%**, under the 2% gate. The generic names are `get_output` (12), `get_command_or_subagent_output` (4), `StructuredOutput` (3), `Skill` (1). Family resolution uses name and input only; output never reclassifies — the audit depends on that invariant.
- Both renderers already own a markdown pipeline (`ReactMarkdown` + `remarkGfm`/`remarkBreaks` + `rehypeHighlight`, Legacy `packages/web/src/components/workflows/NodeRoom.tsx:43-95`, Console `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:35-38`). `rehype-highlight@^7` leaves an unknown fence language unhighlighted without throwing (probed 2026-09-18 through `ReactMarkdown` in `packages/web`). The only direct `highlight.js` caller is `packages/web/src/components/workflows/source-control/syntax-highlight.tsx:1-6`, which Console cannot import.
- Design tokens the bodies need exist on both surfaces: `--surface-inset`, `--node-command`, `--node-prompt`, `--node-bash`, `--success` (`packages/web/src/index.css:20-30`, `:82-90`; `packages/web/src/experiments/console/theme.css:26`, `:77`, `:85`). No new token is required.
- Console's run-room files may import only the `approved` `@/lib/*` set in `packages/web/src/experiments/console/console-isolation.test.ts:114-126`; a new lib module must be added there.
- Root scripts import web lib modules by relative path through `scripts/tsconfig.json` (`@/*` → `packages/web/src/*`, precedent `scripts/node-ref-parity.test.ts`); `tool-presentation.ts` imports only `./format`, which is browser-free.
- Story 1.2 (#175) is `status:processing` with an `ak-implement` run in flight. Its plan removes the Input/Output bridge and `formatToolIo`, adds a body bar with a `Raw` button and a swap slot (`plans/260918-1038-issue-175-raw-payload-toggle/plan.md`, "End-to-end design"), and states "the presented body is empty until 1.3". This plan fills that slot.
- Story 1.1 recorded its evidence at `_bmad-output/implementation-artifacts/agent-node-room/1-1-evidence.md` and flipped `sprint-status.yaml` in the closing commit (`b261a00e`, not in this checkout); this story mirrors that with `1-3-evidence.md` and `sprint-status.yaml:60`.
- `bun run validate` does not run Playwright; the HITL job in `.github/workflows/test.yml` does not trigger for PRs into `develop` (finding recorded in the 1.2 plan). The local `bun run --cwd e2e test:ui:hitl` run is the E2E gate.

## Resolved source conflicts

- **The contract's `body` union is narrower than its own rendering table.** `tool-presentation-contract.md:42-49` declares no `web` arm and no non-diff `file` arm, while `:176-189`, EXPERIENCE `:114-124` and DESIGN `:591-597` specify both, and the Story 1.3 AC names web. This plan closes the gap with `{ kind: 'web' }` and `{ kind: 'file' }` (path plus preview) arms; it is a spec gap being closed, recorded here, not an invention.
- **File path-plus-preview belongs to this story.** Story 1.4 owns the diff arm and the "one side → never fabricate" rule; FR2 ("every family renders its declared arm") maps to 1.3. File is the largest family (583 of 1,966 local calls) and would otherwise be the only bar-only family. **Confirmed in the validation interview** (see `## Validation Log`).
- **Todo and task rows get the generic key-value body** until Stories 1.5 and 1.6 replace it. Their family, chip, headline and badges are unchanged from 1.1.
- **Output normalization lives in `lib/`, computed inside the presenter.** The body is derived in `toolPresentation()` so the existing `hasFullOutput` re-run refreshes the body, not only the badges, and neither renderer learns a provider name. An unrecognized JSON object degrades to at most three scalar `key: value` pairs, never to preformatted JSON.
- **Truncated-at-rest JSON is salvaged, not shown as a fragment.** A JSON-looking string that fails to parse is scanned with a bounded tokenizer; the unterminated string literal at the cut (almost always `stdout` or `content`) is decoded and shown as text. A cut outside a string literal yields an `unreadable` state and the body says so, pointing at Raw.
- **Code highlighting goes through the existing `ReactMarkdown` + `rehypeHighlight` pipeline**, rendering the source as a fenced block whose fence is longer than any backtick run in the source and whose language is sanitized to `[A-Za-z0-9_+.-]`. This keeps both surfaces on React text nodes (no `dangerouslySetInnerHTML`, matching the 1.2 posture), reuses the `.hljs` CSS already loaded, and needs no Console-forbidden import. Unknown languages render unhighlighted (probed).
- **ANSI SGR sequences are stripped from displayed terminal text** (OMP `exec` output carries them); the bytes stay behind Raw. Bounded regex over the capped text.
- **Grep arm precedence:** `input.output_mode` → the captured Claude output `mode` field (if the Phase 1 capture confirms it) → `matches`. Count badges become reachable once output is parsed: `N matches` on the matches arm, `N files` on the paths arm.
- **Sequencing with Story 1.2.** This plan assumes 1.2's landed structure. If 1.2's PR is not on `develop` when cook starts, **stop and coordinate**: both stories rewrite the same component tests and body area.
- **Audit record location and gate hook:** `docs/release-audits/generic-fallback.json`, checked by `bun run scripts/audit-generic-fallback.ts --check` as a new release-skill step before Step 2. **Confirmed in the validation interview**.

## Scope

### In scope

- `ToolPresentation.body` union with seven arms (`terminal`, `file`, `matches`, `paths`, `code`, `web`, `generic`), computed in the pure presenter with exported bounds.
- A pure, React-free output normalizer `packages/web/src/lib/tool-output.ts` that turns every persisted output string into text, a list, scalar fields, or an explicit unreadable state.
- Family bodies rendered in the Story 1.2 swap slot on Legacy and Console with existing tokens; body tests on both surfaces.
- `scripts/audit-generic-fallback.ts` (read-only replay, record, `--check` gate), the committed record, and the release-skill step.
- Unit, component, E2E/visual, and accessibility evidence; `sprint-status.yaml` → `done`; `1-3-evidence.md`.

### Out of scope

- Story 1.4 diff arm and `diff-hunks.ts`; Story 1.5 todo fold and pinned strip; Story 1.6 task normalizer and subtask cards; Story 1.7 occurrence grouping; steering.
- Changes to the body bar, Raw toggle, or full-output flow beyond placing the family body in the slot.
- Backend, API, persistence, schema, migration, generated types, provider, workflow-engine, or dependency changes.
- New design tokens, a shared React component across surfaces, or a new styling system.

## End-to-end design

```text
persisted tool payload { name, input?, output? }  (output is always a string)
        |
        v
tool-output.ts  normalizeToolOutput(output)  →  text | list | fields | unreadable | empty
        |          (JSON parse under cap → content blocks / stdout+stderr / file.content /
        |           filenames / byte-array decode / salvage of truncated literal)
        v
tool-presentation.ts  toolPresentation({name,input,output})
        family (1.1, unchanged) + label + headline + contentBadges (+ count from parsed output)
        + body: terminal | file | matches | paths | code | web | generic
        |
        v
agent-history.ts  toToolItem  (unchanged: presentation already flows into the item)
        |
        v
<details data-tool-id>                      (1.1)
  <summary>row</summary>
  <div body>
    <div body-bar> family · facts   [Raw]   (1.2)
    {rawOpen ? <pre raw> : <ToolBody body={presentation.body} …/>}   ← this story fills the slot
    View full output / error / Retry        (1.1 / 1.2, unchanged)
  </div>
</details>
```

Each surface owns its JSX (Console never imports `@/components/`). The shared code is the two lib modules.

## Phases

| #   | Phase                                                                                         | Depends on | Output                                                                                     |
| --- | --------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 1   | [Shared body contract and output normalizer](./phase-01-start.md)                            | None       | `tool-output.ts`, `body` on `ToolPresentation`, captured Claude fixtures, red→green tables |
| 2   | [Legacy and Console family bodies](./phase-02-two-surface-renderers.md)                       | Phase 1    | Family bodies in the 1.2 swap slot on both surfaces, component tests green                 |
| 3   | [Corpus audit, release gate, and verification](./phase-03-audit-gate-and-verification.md)     | Phases 1–2 | Audit script + record + release step, E2E/visual/a11y evidence, `bun run validate`, close  |

## Global file inventory

| Path                                                                                          | Action                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/web/src/lib/tool-output.ts`                                                         | Create: pure output normalizer + bounds                                    |
| `packages/web/src/lib/tool-output.test.ts`                                                    | Create: provider-shape table (Claude, OMP, Devin, Codex), salvage, bounds  |
| `packages/web/src/lib/tool-presentation.ts`                                                   | Modify: `ToolBody` union, body resolution per family, count from output    |
| `packages/web/src/lib/tool-presentation.test.ts`                                              | Modify: body tables per family, grep arm precedence, no-JSON assertions    |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                          | Modify: Legacy `ToolBody` in the swap slot                                 |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`         | Modify: body anatomy + interaction tests                                   |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`        | Modify: Console `ToolBody` in the swap slot                                |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                    | Modify: body anatomy + interaction tests                                   |
| `packages/web/src/experiments/console/console-isolation.test.ts`                              | Modify: allow `@/lib/tool-output`                                          |
| `scripts/audit-generic-fallback.ts`                                                           | Create: read-only replay, record writer, `--check` gate                    |
| `docs/release-audits/generic-fallback.json`                                                   | Create: first recorded audit                                               |
| `.claude/skills/release/SKILL.md`                                                             | Modify: add the audit gate step                                            |
| `e2e/ui/*.spec.ts` (HITL room/visual specs)                                                   | Modify: body-content assertions                                            |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`, `1-3-evidence.md` | Modify / Create: close the story                                           |

## Success criteria

- [ ] Every Story 1.3 AC in `epics.md:261-288` has a passing test or recorded evidence.
- [ ] No default presentation on either surface contains serialized JSON; the direct assertions (`{`, `\n  "`) pass on generic and unrecognized-output cases.
- [ ] Every unit table carries at least one Claude row and one OMP row, plus a Devin row where the shape differs.
- [ ] The audit record exists, the `--check` gate passes on the recorded corpus, and the release skill runs it.
- [ ] `bun run validate` and the local HITL run are green; `sprint-status.yaml:60` reads `done`.

## Task tracking

No live task-management surface is available in this session; the phase files' checkboxes are the authority for progress.
