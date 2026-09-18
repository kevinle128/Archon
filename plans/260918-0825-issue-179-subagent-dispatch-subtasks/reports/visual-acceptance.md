# Story 1.6 — Visual Acceptance Report: Subagent Dispatch Task Body

Issue #179 / `agent-node-room` Story 1.6. Verifies that a stored OMP `Task`
batch dispatch and a stored Claude `Agent` single dispatch render readable
bodies — markdown context plus one collapsible card per subtask — on both the
Console agent-history room and the Legacy node room, against the approved
mockups and the shared presentation policy.

**Verify command** (exact):

```bash
cd e2e
env -i HOME="$HOME" PATH="$PATH" ARCHON_E2E_PROOF=1 \
  npx playwright test -c playwright.config.ts ui/task-dispatch-body.spec.ts
```

Result: **5/5 passed** (Chromium, @playwright/test 1.60.0) — behavior+geometry
per surface, responsive/zoom per surface, contrast across surfaces.

**Commit**: produced on the US-004 working tree atop `e9c14777`
(`feat: deterministic e2e task-dispatch fixture and runtime helper`); this
report lands in the US-004 story commit alongside `e2e/ui/task-dispatch-body.spec.ts`.

**Evidence sources**

- `e2e/ui/task-dispatch-body.spec.ts` — 5 Playwright cases. Captures live in
  `evidence/` beside this report and as `testInfo` attachments:
  `legacy-task-body-460.png`, `console-task-body-520.png`,
  `legacy-claude-task-460.png`, `console-claude-task-520.png`,
  `legacy-room-460.png`, `console-room-520.png`, `task-card-contrast.json`,
  `legacy-task-card-geometry.json`, `console-task-card-geometry.json`.
- Real stored fixture: `e2e-task-dispatch` workflow (`e2e/fixtures/workflows/`),
  e2e-fake provider — `omp-dispatch` emits one `Task` call (`context` markdown +
  2 tasks), `claude-dispatch` emits one `Agent` call (description + multiline
  prompt, `subagent_type` absent). Both nodes completed `succeeded`.
- Component suites: `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`,
  `ConsoleNodeRoom.test.tsx`, `ConsoleExecutionHistory.test.tsx`,
  `tool-presentation.test.ts`, `task-normalize.test.ts`, `agent-history.test.ts`.
- Mockups: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups/{key-transcript-states,full-transcript-review,key-console-node-room,key-legacy-node-room}.html`.

All fixture text is synthetic (`e2e.invalid`, staged-diff review prose).

## 1. Mapping / content results

| Stored shape                           | Row chip | Closed badge                           | Body bar (measured)                                                                                            | Body content                                                                                              |
| -------------------------------------- | -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| OMP `Task` `{context, tasks:[2]}`      | `Task`   | `2 subagents` (+ `1ms`/`0ms` duration) | `task · batch · 2 subtasks · Nms` — every bar fact after the prefix is a runtime fact; the count never repeats | markdown context block, then exactly 2 `details[data-subtask-index]` cards                                |
| Claude `Agent` `{description, prompt}` | `Agent`  | `1 subagent` (+ `0ms`)                 | `task · single dispatch · 0ms` — count never repeats                                                           | exactly 1 card; no `[data-task-context]` block; no orphan `·` separator before the name (agent is `null`) |

Card summary anatomy measured in DOM and AX tree:
`agent · subtask-name — prompt excerpt` (agent omitted cleanly when absent;
decorative `▶` is `aria-hidden`). Card body (`<pre>`) renders the complete
multiline prompt verbatim — asserted `textContent ===` the stored `task` /
`prompt` string, byte for byte.

## 2. Geometry matrix (computed styles, both surfaces)

All values are `getComputedStyle` / `getBoundingClientRect` assertions — no
class-name string matching. Room measured to the surface's design width
(**Legacy 460 ± 2 px, Console 520 ± 2 px**) through the production split ratio
(`archon.run-room.ratio.<surface>` → `readRoomRatio` on remount; asserted on the
rendered region, never the ratio). No task-specific breakpoint was introduced;
the room uses the same `ROOM_SPLIT` bounds (24–60) as every other node room.

| Element            | Contract                                                                   | Console                                                          | Legacy                                          | Result |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | ------ |
| Closed row summary | one line 24–30px, no clipped content                                       | `28.5px`                                                         | `28.5px`                                        | ✅     |
| Card container     | `--surface-elevated` bg, 1px border, 6px radius, 6/9px pad, 5px top margin | `oklch(0.205 0.009 265)`, `1px`, `6px`, `6px/9px`, `5px`         | `oklch(0.22 0.01 260)`, same metrics            | ✅     |
| Card summary       | min-height 24px, 11.5px mono, one line                                     | `24px`, `11.5px`                                                 | same                                            | ✅     |
| Agent span         | weight 600, `--node-approval`                                              | `600`, `oklch(0.72 0.17 40)`                                     | same token, same value                          | ✅     |
| Subtask name       | bold (`700`)                                                               | `700`                                                            | `700`                                           | ✅     |
| Excerpt            | `--text-secondary`                                                         | `oklch(0.745 0.014 265)`                                         | `oklch(0.65 0.01 260)`                          | ✅     |
| Card chevron       | 9px column, 10px type, 120ms transform                                     | `9px`, `10px`, `0.12s`, `transform, translate, scale, rotate`    | same                                            | ✅     |
| Prompt box         | `--surface-inset`, `pre-wrap`, no horizontal overflow                      | `oklch(0.13 0.006 265)`, `pre-wrap`, `scrollWidth ≤ clientWidth` | `oklch(0.12 0.005 260)`, same                   | ✅     |
| Card focus ring    | solid 2px `--accent-bright`, +2px Console / −2px Legacy                    | `solid 2px oklch(0.64 0.295 330)`, offset `2px`                  | `solid 2px oklch(0.72 0.18 250)`, offset `-2px` | ✅     |

## 3. Contrast (resolved token colors through the browser)

Computed colors resolved via a canvas probe (`color-mix`/`oklch` handled
natively by Chromium), luminance per WCAG 2.x, against the effective ancestor
background. Full data: `evidence/task-card-contrast.json`.

| Text                            | Background                | Console ratio | Legacy ratio | Result  |
| ------------------------------- | ------------------------- | ------------- | ------------ | ------- |
| agent (`--node-approval`)       | card `--surface-elevated` | **6.78**      | **6.53**     | ✅ ≥4.5 |
| subtask name (`--text-primary`) | card `--surface-elevated` | **16.72**     | **14.08**    | ✅      |
| excerpt (`--text-secondary`)    | card `--surface-elevated` | **7.90**      | **5.33**     | ✅      |
| prompt (`--text-primary`)       | box `--surface-inset`     | **18.77**     | **16.52**    | ✅      |

## 4. Keyboard / focus / accessibility findings

- DOM-order Tab from the open row's summary walks every focusable inside the
  body in order — context link → card summary 0 → card summary 1 → `INPUT` →
  `OUTPUT` (5 focusables measured on both surfaces; no Raw button — Story 1.2
  is not shipped).
- `Enter` on a card summary opens the card (`open=true`), focus stays on the
  card summary (`activeElement ===` asserted), the outer row stays open.
- `Space` closes it again with focus preserved; the outer row stays open.
- Chromium AX evidence (CDP `Accessibility.queryAXTree`, scoped to the room
  region — the console page renders the same row in its execution history, so
  the query is anchored at `[aria-label="<node> room"]`): each card summary is
  a `DisclosureTriangle` named e.g.
  `reviewer · correctness-review — Review the staged diff for correctness. Check boundary conditions and error paths. Report each finding on its own line.`
  The `▶` glyph never appears in the accessible name.
- Focused card summary carries `:focus-visible` — measured
  `solid 2px` `--accent-bright` outline, `+2px` offset on Console,
  `-2px` on Legacy.
- Manual AT pairing (VoiceOver/NVDA): not run in this environment — the CDP
  accessibility-tree assertions above are the executable proxy; recommended for
  manual pass before release, same caveat as Story 1.1.

## 5. Reduced motion

`page.emulateMedia({ reducedMotion: 'reduce' })` → card chevron
`transition-property: none` (measured; normal value
`transform, translate, scale, rotate` at `0.12s`). ✅

## 6. Request observation / security

- `page.on('request')` registered before navigating to `omp-dispatch`; the
  fixture image URL `https://e2e.invalid/task-dispatch-diagram.png` is never
  requested (`imageRequested: false` in evidence JSON).
- No `<img>` exists anywhere in the tool row (readable body or disclosures).
- The `javascript:` context link renders with `href=""` — no executable target.
- (Scoped to the readable body as designed: the temporary `INPUT` diagnostic
  intentionally dumps the raw stored payload, which contains the hostile
  fixture strings — that is expected and unchanged.)

## 7. Responsive + zoom

Per surface, OMP row and card:

| State                                                                  | Result                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reference width (460 Legacy / 520 Console) in 1440×1000                | row + card summaries one line; card opens; prompt wraps, `scrollWidth ≤ clientWidth`; no task-body element overflows the page; room has no horizontal scroll |
| 390×844 via the production responsive layout                           | same invariants hold                                                                                                                                         |
| 200% zoom via `Emulation.setDeviceMetricsOverride` (720 CSS px, DSF 2) | `window.innerWidth === 720` confirmed; same invariants hold                                                                                                  |

No task-specific breakpoint added — the layout path is the existing
`ROOM_SPLIT` ratio + each surface's own narrow/zoom handling.

## 8. Mockup comparison + delta dispositions

References: `key-transcript-states.html` §D (OMP batch + Claude single
examples), `full-transcript-review.html` (same rows in a full transcript), and
the collapsed task rows in `key-console-node-room.html` /
`key-legacy-node-room.html`.

| Delta                  | Mockup                                                  | Implementation                                                         | Disposition                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OMP row chip           | `task` (family, lowercase)                              | `Task` (label)                                                         | **Contract wins** — `chipLabel` uses the tool label for single-token names ≤24ch; the Claude row uses `Agent` the same way, matching its mockup. Mockup predates the chip contract. |
| OMP headline           | `Scout retry call sites and CI config` (invented title) | first subtask name (`correctness-review`)                              | **Contract wins** — `taskHeadline` = `tasks[0].name`; recorded in Story 1.5 tests.                                                                                                  |
| Body bar runtime facts | `task · batch · 2 subtasks` (+ Raw button)              | `task · batch · 2 subtasks · Nms` (duration appended, no Raw)          | **Contract wins** — the composed bar carries runtime facts once after the prefix; Raw belongs to Story 1.2 (not shipped).                                                           |
| Sub-card               | always-expanded `div.sub-card`                          | collapsed `<details data-subtask-index>` that opens to the full prompt | **AC wins** — "complete prompts available when cards are opened"; the mockup itself shows only the collapsed summary line.                                                          |
| Claude card agent      | `Explore · Scout retry-backoff call sites`              | name only — no `·` separator when `subagent_type` absent               | **AC wins** — the fixture deliberately omits `subagent_type`; the card must not render an orphan separator.                                                                         |
| Context                | single `.ctx` line                                      | full markdown block (emphasis, list, sanitized link, suppressed image) | **AC wins** — context renders as safe markdown.                                                                                                                                     |
| Excerpt ellipsis       | `…` always shown                                        | `…` only when the prompt exceeds 160 code points                       | **Contract wins** — `taskPromptExcerpt` adds ellipsis only on omission; fixture prompts fit under the cap so none renders.                                                          |
| Collapsed row anatomy  | `chev + glyph + fam + hl + bd`, flush single line       | identical anatomy in `details[data-tool-id] > summary`                 | **Aligned** — no delta.                                                                                                                                                             |

## Result

**Accepted.** Both stored provider shapes map to the shared task body on both
surfaces; closed rows stay single-line with the correct subagent badge; cards
are collapsed named disclosures that reveal complete prompts under
keyboard-only interaction; all security, contrast, motion, responsive, and
network-quietness assertions pass with measured values attached.
