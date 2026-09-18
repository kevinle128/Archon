---
title: 'Issue 175 raw payload toggle'
description: 'Implementation-ready plan for Story 1.2: a closed-by-default Raw toggle that is the only place serialized tool JSON appears, on Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
tags: [issue-175, agent-node-room, web, tdd, epic-1]
created: 2026-09-18
issue: 'https://github.com/kevinle128/Archon/issues/175'
---

# Issue 175 raw payload toggle

## Goal and user outcome

Story 1.2 gives an operator who needs exact diagnostic data one control per tool row — `Raw` — that reveals the original persisted payload (`name`, `input`, `output`) as pretty-printed JSON. The control is closed by default, lives at the far right of the expanded body bar, and is the **only** place serialized JSON appears in the transcript. The temporary closed Input/Output disclosures that Story 1.1 shipped as a bridge are removed. The existing `canLoadFullOutput` flow (`View full output`, inline error, `Retry`) keeps working, and a failed load never replaces the readable row.

This is FR7 / CAP-7 and NFR3 from the Agent Node Room epic. It is a presentation-only slice over data already stored: no schema, migration, backend, API, or generated-type change.

## Evidence and authority

When sources differ, use them in this order:

1. Story 1.2 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:236-259` and CAP-7 in `_bmad-output/specs/spec-agent-node-room/SPEC.md:78-80`, plus the read-half constraint at `SPEC.md:121`.
2. `_bmad-output/specs/spec-agent-node-room/test-plan.md:80-89` (renderer test: Raw present, closed by default, reveals the payload) and `tool-presentation-contract.md:139` (the untouched Codex name stays available behind Raw).
3. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` — Raw toggle row (`:113`), Output truncated (`:156`), Raw open (`:170`), keyboard (`:196-197`), Flow 3 (`:358-366`), Q&A (`:393`, `:396`).
4. `.../DESIGN.md` — `raw-toggle` and `body-box` tokens (`:201-226`), Raw toggle and Body box component specs (`:573`, `:587-597`), contrast row (`:471`), target size (`:697`).
5. Mockup `.../mockups/key-transcript-states.html` §F (`:325-336`) and `.raw` / `.box` CSS (`:67-69`).
6. Current product code and tests for behavior the story keeps.

Verified repository facts:

- Both surfaces render the same temporary bridge: a body bar (`family · facts`) then two closed nested `<details>` (`Input`, `Output`) whose `<pre>` bodies call `formatToolIo()`, then a sibling `View full output` button and inline error/`Retry` — Legacy `packages/web/src/components/workflows/NodeRoom.tsx:430-476`, Console `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:339-385`.
- The full-output control is already a **sibling after** the Output disclosure, not inside it, so "the position it has today" is: visible whenever the row is open, independent of any nested disclosure (`NodeRoom.tsx:451-459`, `ConsoleAgentHistoryList.tsx:360-368`).
- After a successful load both shells rebuild the presentation with `outputState: 'full'` from `fullOutput` (`NodeRoom.tsx:334-343`, `ConsoleAgentHistoryList.tsx:253-262`); the raw box must read the same `hasFullOutput ? fullOutput : item.output` value.
- `onToggle` ignores bubbled toggle events from nested disclosures (`NodeRoom.tsx:368-376`, `ConsoleAgentHistoryList.tsx:287-295`). A `<button>` never fires `toggle`, so the guard is idle after this story, but later stories put collapsible subtask cards inside the same body (EXPERIENCE `:123`), so the guard stays and only its comment changes to state the invariant.
- `renderAfterItem` output is a sibling of the row's `<details>`, not a descendant (`NodeRoom.tsx:526-531`, `ConsoleAgentHistoryList.tsx:447-452`), so extension slots cannot bubble into the row today.
- `formatToolIo()` (`packages/web/src/lib/pair-tool-transcript.ts:75-78`) has four production call sites in two files — `NodeRoom.tsx:440,448` and `ConsoleAgentHistoryList.tsx:349,357`, all inside the bridges above — and one unit `describe` (`pair-tool-transcript.test.ts:95-102`). It returns a **string value verbatim** and JSON-encodes everything else; the new helper always JSON-encodes, so a string output gains an escape pass (see Resolved source conflicts).
- The full-output detail route returns the stored row with no size cap (`packages/server/src/routes/api.ts:5321-5342`); the bridge today renders every row's payload unconditionally (React mounts `<details>` children even when closed), so the DOM already holds hidden serialized JSON for every row. The new design renders the JSON only while Raw is open.
- No masking or redaction exists between persisted tool payloads and the browser (grep `mask|redact` in `packages/workflows/src`, `packages/server/src`: only unrelated webhook/condition hits). Raw neither adds nor removes exposure; it concentrates the same bytes behind one labelled control. Recorded as the accepted posture; a future masking pass has its trigger here.
- CI gap: `.github/workflows/test.yml:5-7` triggers the `e2e-hitl` job on `[main, dev]`, but this fork's remote HEAD is `develop` (`git remote show origin`) and #196/#197 merged into `develop`. A PR into `develop` therefore never runs the HITL Playwright specs in CI; `pr-e2e-verify.yml` triggers on `develop` but does not run the fixed suite. The local HITL run is the real gate for this story (see Open questions).
- The persisted tool payload is `{ name, id, input?, output? }` (`packages/workflows/src/schemas/node-message.ts:16-22`); the projected item exposes `name` (untouched, wrapper intact), `input`, `output`, `toolUseId`, `messageId` (`packages/web/src/lib/agent-history.ts:30-45`).
- `ConsoleAgentHistoryList` mounts twice on one page (selected room + inline execution history), so any element id derived only from `toolUseId` can duplicate; use React `useId()`.
- Tests that encode the bridge and must be rewritten: `NodeRoom.test.tsx:283-285, :383-384, :582-615`; `LegacyNodeRoom.test.tsx:1128-1129, :1281-1308, :1330-1423`; `ConsoleNodeRoom.test.tsx:262-300 (asserts JSON present in closed details), :1063-1068, :1328-1329, :1481-1508, :1620-1701`; E2E `workflow-run-hitl.spec.ts:97-98, :123-124`, `workflow-run-hitl-room.spec.ts:180-182, :249-250, :643-654`, `agent-tool-row-visual.spec.ts:376-378, :519-523`.
- Issue #175 is open with no PR, no branch, and no worktree; Story 1.1 merged as #197 (`0fb1fd04`). The 1.1 plan directory still reads `status: pending` in its frontmatter although its work shipped — flagged, not edited here.

## Resolved source conflicts

- **Raw JSON text colour — owner decision 2026-09-18: text-primary.** For text-primary: the `body-box` token binding `text-legacy`/`text-console` (DESIGN `:226-227`), the Body box component paragraph "text-primary content with secondary annotations" (`:590`), and its per-arm line `Raw: text-primary JSON` (`:597`). For text-secondary: the "Do" list (`:666`), EXPERIENCE `:170`, and the contrast row (`:471`). The mockup's inline tertiary loses to both documents. The owner chose the token binding; `RAW_TEXT_CLASS = 'text-text-primary'` on both surfaces, and Phase 3 measures text-primary on `surface-inset`.
- **Generic-fallback corpus audit.** `test-plan.md:38` labels the < 2 % audit "Story 1.2", but the epic's FR coverage map assigns FR2/CAP-2 to Story 1.3 (`epics.md:173`) and the 1.1 plan already deferred it. The epic wins: **out of scope** here.
- **Swap, not append.** EXPERIENCE `:113` and `:396`: opening Raw replaces the presented body; it never renders the same bytes twice. In 1.2 the presented body is empty (family arms arrive in 1.3), so the swap slot is designed now and filled later.
- **Where the full-output control lives.** EXPERIENCE `:156`/`:393`: "where it is today, under the output block; it does not join Raw in the body bar". Today it is a sibling below the disclosures. Decision: render it **once, after the swap slot, independent of Raw state**, so it is reachable whether Raw is open or closed and `getByRole('button', { name: 'View full output' })` keeps `toHaveCount(1)`.
- **Raw shape for string outputs — owner decision 2026-09-18: pure JSON object.** Raw is exactly the persisted representation `{ name, input, output }`; a string output appears as an escaped JSON string (newlines as `\n`), which is what the spec, mockup §F, and EXPERIENCE Flow 3 describe. Readable text is Story 1.3's terminal/text body. Known cost, accepted: escaped strings inside Raw (a screen-reader user hears the escapes), and a one-time escape pass when Raw opens on a large loaded string.
- **Interim expanded body — owner decision 2026-09-18: accept bar-only.** Between 1.2 and 1.3 an expanded row with Raw closed shows the body bar and, when applicable, `View full output`. Family bodies stay in 1.3; revisit signal is 1.2 shipping alone for more than one sprint.
- **CI HITL gap — owner decision 2026-09-18: local run is the gate.** `test.yml` stays untouched in this story; the recorded local `bun run --cwd e2e test:ui:hitl` run is a required PR item; the `develop` trigger mismatch is logged as a separate follow-up.

## Scope

### In scope

- One pure, bounded helper in `packages/web/src/lib/tool-presentation.ts` that produces the raw JSON string for a tool item, and its unit tests.
- Removal of the temporary Input/Output disclosures and of `formatToolIo()` (dead after removal).
- A `Raw` disclosure button in the body bar of both surfaces, with identical anatomy, wording, semantics, keyboard behaviour, and surface-specific tokens.
- A conditionally rendered raw body box; the JSON string is not in the DOM until Raw is open.
- Preserved full-output loading, error, and retry behaviour; the raw box reflects loaded full output in place.
- Unit, component, E2E, geometry, focus, reduced-motion, contrast, and manual screen-reader evidence.

### Out of scope

- Story 1.3+ family bodies, generic key-value body, `awaiting output`, diff, todo strip, task cards, occurrence headers, corpus audit, steering.
- Backend, API, persistence, schema, migration, generated types, provider, workflow-engine, or dependency changes.
- Chat tool cards, Run Stream `ToolCallItem`, and any other surface than the two node rooms.
- A shared React component across surfaces, new design tokens, or a new styling system.

## End-to-end design

```text
AgentHistoryItem (kind: 'tool')  ── name / input / output / canLoadFullOutput / messageId
        |
        |  toolRawPayloadJson({ name, input, output })  ← pure, in lib/tool-presentation.ts
        v
<details data-tool-id>                       (Story 1.1, unchanged)
  <summary>…row…</summary>
  <div body>
    <div body-bar>  family · facts        [Raw] / [Raw ▾]   ← <button aria-expanded aria-controls>
    {rawOpen ? <pre id={rawId} body-box>{json}</pre>         ← swap slot; presented body is empty until 1.3
             : null}
    {canLoadFullOutput ? <button>View full output</button>}  ← once, after the slot, any Raw state
    {loadError ? error + Retry}
  </div>
</details>
```

Each surface owns its JSX and tokens (Console never imports `@/components/`); the helper is the only shared code. Raw state is per-row local React state keyed by the existing stable item identity, independent of the row's `open` state; it survives polling re-renders and the full-output load, and a new item identity starts closed.

## Acceptance criteria

### Behaviour and contracts

- [ ] Every tool row's expanded body bar ends with a `Raw` button pushed to the far right; the collapsed summary never contains it.
- [ ] Raw is closed on first render for every outcome (succeeded, failed, running, interrupted, unknown), including auto-opened failed rows.
- [ ] Activating Raw renders one body box containing `JSON.stringify({ name, input, output }, null, 2)` for that row and flips the button to `Raw ▾` with `aria-expanded="true"`; activating again removes the box and restores `Raw`.
- [ ] While every Raw is closed, the room DOM contains no serialized-data text from any payload (`"name":`, `"input":`, `"output":`, quoted keys, braces produced by serialization); opening one Raw adds it for that row only.
- [ ] The raw JSON uses the untouched sent name (a Codex `/bin/zsh -lc '…'` wrapper stays), omits `input`/`output` when they are `undefined`, keeps `null`, and shows a string output as a JSON string.
- [ ] `View full output` renders once per loadable row whether Raw is open or closed; a successful load updates the row badges and the open raw box in place; a failed load — including a response that carries no tool output — shows the inline error and `Retry` under the body without changing the summary, the disclosure state, the raw state, or the `truncated` badge.
- [ ] Loaded output stays hidden while Raw is closed, on both surfaces, proven end-to-end on a real run (load first, assert hidden, then open Raw).
- [ ] Raw state survives polling re-renders and the full-output load, does not carry across item identities, and a Raw click never marks the outer row touched or flips its `open` state. The row's toggle handler keeps ignoring bubbled `toggle` events from any nested disclosure, so a later story's nested `<details>` cannot mark the row touched.
- [ ] `Input`, `Output`, and nested `<details>` no longer exist inside a tool row; `formatToolIo` is removed with its test.

### Safety, performance, and compatibility

- [ ] The helper never throws: schema-parsed JSON always serializes; an unrepresentable value (unreachable today) yields a safe fallback string that still names the tool. The fallback is documented with a comment explaining why it is safe.
- [ ] The JSON string is computed only while Raw is open (no serialization cost for closed rows, no JSON in the DOM). This is a net reduction: the bridge serialized every row on every render.
- [ ] React text nodes remain the only rendering path; no HTML injection or sanitizer. No payload text is placed in `title`, `aria-label`, or `id` attributes.
- [ ] Exposure posture is unchanged and recorded: the same authorized viewer sees the same stored bytes; no masking layer exists today and none is added.
- [ ] No change to `buildAgentHistory()`, `pair-tool-transcript` projection, server routes, schemas, or generated types.

### Visual, responsive, and accessible behaviour

- [ ] Raw button: `10.5px` mono, transparent background, 1 px `border` colour border, radius 4 px, padding 1 px/7 px, `min-height: 24px`, text-secondary; hover and focus-visible use `border-bright` + text-primary; open state uses text-primary + `border-bright` + a `▾` suffix that is `aria-hidden` so the accessible name stays `Raw` (SC 2.5.3).
- [ ] Raw body box: `surface-inset`, 1 px `border`, radius 6 px, padding 8 px/10 px, `11.5px`/1.5 mono, text-primary (`RAW_TEXT_CLASS`, one constant per surface), `white-space: pre-wrap`, `overflow-wrap: anywhere`; it never widens the 460 px room or introduces horizontal page scroll.
- [ ] Focus outline on the Raw button matches the surface: 2 px `--accent-bright`, offset −2 px Legacy / +2 px Console. Chevron animation and reduced-motion behaviour are unchanged.
- [ ] Keyboard: `Tab` from an open row's summary lands on its Raw button; `Enter`/`Space` toggle it; `Tab` continues to `View full output` when present, then the next row. No custom key handling.
- [ ] Accessible name/state: `button` named `Raw` with `aria-expanded` and `aria-controls` pointing at the box's `useId()`-derived id; the box is a plain `<pre>`. No live region is introduced: a button with `aria-expanded` is the WAI-ARIA disclosure pattern and announces its own state change. Tests resolve `aria-controls` with `document.getElementById`, never a concatenated CSS selector — React 19 `useId` ids are not selector-safe.
- [ ] Contrast of Raw text and JSON text clears 4.5:1 on both surfaces (recorded), target size clears 24 × 24 (measured).

## Phases

| #   | Phase                                                                                  | Depends on | Output                                                                                   |
| --- | -------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| 1   | [Shared raw contract and red outside-in tests](./phase-01-start.md)                    | None       | Pure helper + unit tests, `formatToolIo` removal, red E2E contract                       |
| 2   | [Legacy and Console renderers](./phase-02-two-surface-renderers.md)                    | Phase 1    | Red component tests then green Raw toggle on both surfaces, bridge removed               |
| 3   | [End-to-end and visual verification](./phase-03-end-to-end-and-visual-verification.md) | Phases 1–2 | Green E2E, geometry/contrast/keyboard/screen-reader evidence, `bun run validate`, report |

## Global file inventory

| Path                                                                                       | Action                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/web/src/lib/tool-presentation.ts`                                                | Modify: add `toolRawPayloadJson`                           |
| `packages/web/src/lib/tool-presentation.test.ts`                                           | Modify: add raw helper table                               |
| `packages/web/src/lib/pair-tool-transcript.ts`                                             | Modify: delete `formatToolIo`                              |
| `packages/web/src/lib/pair-tool-transcript.test.ts`                                        | Modify: delete the `formatToolIo` describe                 |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | Modify: Legacy Raw toggle, remove bridge                   |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | Modify: static anatomy + no-JSON-in-DOM contract           |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify: interaction, keyboard, load/error/retry with Raw   |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Modify: Console Raw toggle, remove bridge                  |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify: same contract on the selected room                 |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Verify: inline history mount still renders one Raw per row |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Verify only                                                |
| `e2e/ui/workflow-run-hitl.spec.ts`                                                         | Modify two cases (`:97-98`, `:123-124`)                    |
| `e2e/ui/workflow-run-hitl-room.spec.ts`                                                    | Modify three sites (`:180-182`, `:249-250`, `:643-654`)    |
| `e2e/ui/agent-tool-row-visual.spec.ts`                                                     | Modify two sites (`:376-378`, `:519-523`) + Raw evidence   |
| `plans/260918-1038-issue-175-raw-payload-toggle/reports/visual-acceptance.md`              | Create during implementation                               |

`agent-history.ts`, `pair-tool-transcript.ts` projection code, `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`, `ConsoleExecutionHistory.tsx`, server routes/schemas, generated API types, and theme token files are read-only. Stop and revise the plan before expanding into them.

## Implementation preflight and order

1. Recheck issue #175, open PRs, active runs, `git status`, and worktrees for a competing owner. Branch from `dev`/`develop` per repo convention; never commit to `main`.
2. Phase 1 (red → green): write the helper's unit table, rewrite the six E2E sites to the Raw contract (they stay red until Phase 2), implement the helper.
3. Phase 2 (red → green): rewrite the component tests on both surfaces to the Raw contract, implement Legacy, implement Console, rewrite the toggle-guard comment as the invariant, add the load-resolution guard, confirm no `Input`/`Output`/nested `<details>` remain.
4. Phase 3: run the relevant Playwright specs, add the 460 px/focus/target-size/contrast evidence for the Raw button and box, do the scoped visual and screen-reader reviews, run `bun run validate`, write the report.

## Validation and proof

- Unit: `bun test src/lib/tool-presentation.test.ts` (from `packages/web`) proves key order, omission/retention, untouched name, string output, and the never-throws fallback.
- Component: Web `bun run test` proves default-closed Raw, no JSON in DOM while closed, swap on open, full-output flow under any Raw state, touched/open isolation, identity reset, both Console mounts.
- E2E: `workflow-run-hitl.spec.ts`, `workflow-run-hitl-room.spec.ts`, `agent-tool-row-visual.spec.ts` prove one real stored call on both surfaces: hidden output when closed, visible after summary → Raw, `View full output` count 1, loaded tail hidden until Raw opens, Tab order summary → Raw, 24 px minimum size, accent focus. These run **locally** (`bun run --cwd e2e test:ui:hitl`) and their pass is recorded in the PR: CI's `e2e-hitl` job does not trigger on `develop`. All Raw-box evidence uses only the synthetic HITL fixture strings (`e2e/lib/playwright/archon-runtime.ts:44`).
- Full gates: Web tests and type-check, E2E type-check, `bun run validate`. Never run root `bun test`.

## Rollout, failure handling, and rollback

- Web-only presentation change over existing data; no ordering, migration, flag, or staged rollout.
- If serialization cannot be produced safely, fail closed to the documented fallback string rather than throwing inside the transcript.
- If visual or accessibility acceptance fails on one surface, fix both surfaces together; do not ship an asymmetric bridge.
- Roll back the whole change (helper, both shells, tests, E2E) as one unit. Do not reinstate the Input/Output bridge as a desired contract on a forward branch.

## Definition of done

- [ ] Every acceptance criterion above has passing automated evidence or a named manual record.
- [ ] The six E2E sites express and pass the Raw contract; no test opens `Input`/`Output` any more.
- [ ] Both Console mounts and Legacy pass equivalent Raw tests; `console-isolation.test.ts` stays green.
- [ ] `reports/visual-acceptance.md` records the §F comparison, 460 px evidence, contrast and target-size results, and two OS screen-reader checks (Windows + macOS pairings).
- [ ] Focused tests, full Web tests, Web and E2E type checks, relevant HITL specs, and `bun run validate` pass.
- [ ] The final diff contains no unrelated, schema, API, generated, dependency, or migration change.
- [ ] Sprint status `1-2-inspect-the-raw-payload-of-a-tool-call` moves to `done` only through its owning BMad workflow after all gates pass; the PR body says `Closes #175`.

## Open questions

None. The four owner decisions are recorded in the Validation Log and applied above.

Follow-ups outside this story (not blockers): `.github/workflows/test.yml:5-7` should gain `develop` so `e2e-hitl` runs on this fork's PRs; the Story 1.1 plan directory `plans/260917-1011-issue-174-readable-tool-call-row/` still carries `status: pending` although #197 shipped.

## Red Team Review

### Session — 2026-09-18

**Findings:** 12 (12 accepted — 3 deferred to the owner, 2 accepted with modification; 0 rejected)
**Severity breakdown:** 2 Critical, 5 High, 5 Medium
**Reviewers:** Assumption Destroyer, Failure Mode Analyst, Security Adversary (Standard tier: Fact Checker + Contract Verifier; 64 claims checked, 58 verified, 2 failed and corrected, 4 unverified line-drift/unread ranges — drifts corrected)

| #   | Finding                                                                                             | Severity | Disposition             | Applied To           |
| --- | --------------------------------------------------------------------------------------------------- | -------- | ----------------------- | -------------------- |
| 1   | CI `e2e-hitl` triggers on `[main, dev]`; fork works on `develop`, so HITL specs never run on the PR | Critical | Accept — owner decides  | plan.md, Phases 1, 3 |
| 2   | Raw JSON colour tally undercounted the token binding and component spec for text-primary            | Critical | Accept — owner decides  | plan.md, Phase 2     |
| 3   | Helper JSON-escapes string outputs; `formatToolIo` passed them verbatim; risk note claimed parity   | High     | Accept — owner decides  | plan.md, Phase 1     |
| 4   | Screen-reader impact of escaped `\n` in string outputs was unstated                                 | Medium   | Accept (merged into 3)  | plan.md              |
| 5   | E2E rewrite dropped the loaded-output-hidden check before Raw opens                                 | High     | Accept                  | Phase 1 step 6       |
| 6   | Deleting the bubbled-toggle guard leaves a landmine for later nested `<details>` (1.3 / 1.6)        | High     | Accept (modified: keep) | Phase 2              |
| 7   | A load resolving without a tool output sets `hasFullOutput` and Raw silently omits `output`         | High     | Accept (modified)       | Phase 2, plan.md AC  |
| 8   | "NFR8 stories" is not a source for deferring a live region                                          | High     | Accept                  | plan.md AC           |
| 9   | Raw-box screenshot evidence needs a synthetic-fixture-only rule                                     | Medium   | Accept                  | Phase 3, plan.md     |
| 10  | `aria-controls` verification must use `getElementById`; React 19 `useId` ids are not selector-safe  | Medium   | Accept                  | Phase 3, plan.md AC  |
| 11  | Record the accepted exposure posture (no masking exists; Raw concentrates the same bytes)           | Medium   | Accept (documented)     | plan.md              |
| 12  | "two callers" is four call sites in two files; two cited line ranges drifted                        | Medium   | Accept                  | plan.md, Phase 1     |

### Whole-Plan Consistency Sweep

Decision delta: keep the toggle guard (was: delete); wrong-kind load → inline error (was: silent `full`); loaded-output-hidden E2E check restored; `aria-controls` resolved by `getElementById`; synthetic-only Raw evidence; raw colour, string-output shape, and CI trigger moved from "resolved" to owner decisions; call-site count and two line ranges corrected; live-region justification reworded.

Swept `plan.md` and all three phase files for: "remove the guard", "simplify onToggle", "three statements", "Decision: text-secondary", "exactly two", "same bytes were already rendered", "NFR8 stories", the drifted line ranges, and any literal colour class on the raw `<pre>`. Remaining hits are only the history rows in this table. No unresolved contradictions.

## Validation Log

### Session 1 — 2026-09-18

**Trigger:** `--deep` mode validation after the red-team session; the three owner-deferred findings plus the interim-body trade-off.
**Questions asked:** 4

#### Questions & Answers

1. **[Architecture]** For a tool whose output is a plain string, what should the Raw box show?
   - Options: A. Pure JSON object (Recommended) | B. JSON header + verbatim string | C. Defer: ship A, revisit if 1.3 slips
   - **Answer:** A. Pure JSON object
   - **Rationale:** Raw is the exact persisted representation; readability is Story 1.3's body. Fixes the helper contract (one shape), the unit table, and the accepted screen-reader/escape-pass cost.
2. **[Tradeoffs]** Which text colour should the raw JSON use inside its body box?
   - Options: A. text-primary (Recommended) | B. text-secondary
   - **Answer:** A. text-primary
   - **Rationale:** Follows the `body-box` token binding and component spec; `RAW_TEXT_CLASS = 'text-text-primary'` on both surfaces; Phase 3 measures it.
3. **[Risks]** How should the story handle CI not running the HITL suite on `develop`?
   - Options: A. Local run is the gate (Recommended) | B. Add `develop` to test.yml in this PR | C. Separate trigger PR first
   - **Answer:** A. Local run is the gate
   - **Rationale:** Keeps the story's diff web/E2E-only; the recorded local run is a required PR item; the trigger mismatch is a logged follow-up.
4. **[Scope]** Between Story 1.2 and 1.3, is an expanded row that shows only the body bar and the Raw button acceptable?
   - Options: A. Accept bar-only body (Recommended) | B. Pull 1.3's generic key-value body forward
   - **Answer:** A. Accept bar-only body
   - **Rationale:** Matches the epic's story split; no duplicated presenter work; revisit signal is 1.2 shipping alone for more than one sprint.

#### Confirmed Decisions

- Raw content: `JSON.stringify({ name, input, output }, null, 2)` for every payload shape.
- Raw colour: text-primary via one `RAW_TEXT_CLASS` constant per surface.
- CI: `test.yml` untouched; local HITL run recorded in the PR.
- Interim body: bar + Raw only until Story 1.3.

#### Action Items

- [x] Phase 1: drop the conditional wording on the string-output unit row and in the escape-pass risk.
- [x] Phase 2: set `RAW_TEXT_CLASS` to `'text-text-primary'`; drop the verbatim-string-arm note.
- [x] Phase 3: measure text-primary on `surface-inset`; local HITL run is the gate.
- [x] plan.md: Resolved source conflicts, AC, Open questions, and Validation and proof updated.

#### Impact on Phases

- Phase 1: helper contract fixed to one shape; risk wording final.
- Phase 2: colour constant fixed; no two-shape rendering branch.
- Phase 3: contrast row measures text-primary; CI note final.

### Verification Results

- **Tier:** Standard (3 phases)
- **Claims checked:** 64 across the three red-team reviewers (Fact Checker + Contract Verifier)
- **Verified:** 58 | **Failed:** 2 (both corrected: `formatToolIo` string passthrough; CI trigger branch) | **Unverified:** 4 (two line drifts corrected; two spec ranges re-read by the lead and confirmed)
- **Failures remaining:** 0

### Whole-Plan Consistency Sweep

Decision delta from this session: string-output shape = pure JSON; colour = text-primary; CI = local gate; interim body = accepted. Swept `plan.md` and all three phase files for "owner decides", "per the owner's decision", "verbatim string arm", "must confirm", "text-secondary" on the raw `<pre>`, and "pending interview". No unresolved contradictions.

<!-- slug: issue-175-raw-payload-toggle -->
