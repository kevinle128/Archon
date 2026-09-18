# Story 1.5 (CAP-3) — Visual Acceptance Report: Pinned Todo Strip

## 1. Commit, baseline, and evidence sources

- **Code under test**: `27971448` (US-004 renderers) plus the two US-005
  cause-aligned fixes recorded in §11: `ConsoleNodeRoom.tsx` room region
  `overflow-clip` + `[overflow-clip-margin:4px]`, and `ConsoleTodoStrip.tsx`
  section `p-[4px]`. The metrics file's `meta.commit` field reads `27971448`
  because the evidence run predates this story's own commit.
- **Run under test**: dedicated synthetic `e2e-todo-strip` run
  (`e2e/fixtures/workflows/e2e-todo-strip.yaml` → `archon.runTodoStripWorkflow()`).
  `todo-plan` emits init(12) → done → block → drop; `no-todo` emits tool calls
  only. All captures contain synthetic fixture strings only.
- **Spec**: `e2e/ui/agent-todo-strip.spec.ts` — 15 Phase-2 behavior cases plus
  the evidence cases added here; helpers are file-local;
  `agent-tool-row-visual.spec.ts` untouched.
- **Captures** (this directory's `evidence/`):
  `legacy-todo-collapsed-460.png`, `legacy-todo-expanded-460.png`,
  `legacy-todo-scrolled-room.png`, `console-todo-collapsed-460.png`,
  `console-todo-expanded-460.png`, `console-todo-scrolled-room.png`,
  `todo-strip-metrics.json` (geometry, overflow, resolved tokens, contrast
  ratios).

## 2. Behavior matrix by surface

| Behavior                                                                            | Legacy        | Console       |
| ----------------------------------------------------------------------------------- | ------------- | ------------- |
| Exactly one `section[aria-label="Todo"]` inside `todo-plan` room; none in `no-todo` | PASS          | PASS          |
| Collapsed default: label + `◐ Map the message path` + `1/12` + caret                | PASS          | PASS          |
| Enter expands; five statuses listed; Space collapses                                | PASS          | PASS          |
| Meter: 12 decorative cells (`aria-hidden`)                                          | PASS          | PASS          |
| Todo calls stay one-line transcript summaries (no inline checklist)                 | PASS          | PASS          |
| Strip pinned while transcript scrolls (geometric)                                   | PASS          | PASS          |
| Body scrolls internally (168 px cap, `scrollHeight 329 > clientHeight 167`)         | PASS          | PASS          |
| Geometry/anatomy at measured 460±2 px room width                                    | PASS (459.67) | PASS (460.00) |
| Viewport sweep 1440/1024/768/390 + 200 % zoom                                       | PASS          | PASS          |
| Keyboard/focus/motion, scope remount                                                | PASS          | PASS          |
| One accessible Todo region in AX tree                                               | PASS          | PASS          |
| Strip survives Console "Tool calls" toggle                                          | n/a           | PASS          |
| Contrast floors (text ≥4.5:1, focus ring ≥3:1)                                      | PASS          | PASS          |

## 3. Geometry table (contract vs measured, 460 px)

| Property      | Contract                                                             | Legacy                                           | Console                         | Result |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------- | ------ |
| Container     | full-width, flex-none, surface-elevated, no radius, 1 px bottom rule | flex 0 0, elevated, 0 px radius, 1 px            | same                            | PASS   |
| Header        | one line, 6/10 padding, ≥24 px target, 8 px gaps, surface-hover      | `6px 10px`, gap 8, min-h 24 (29.25), nowrap      | same                            | PASS   |
| Label         | 10 px / 700 / uppercase / 0.07 em                                    | all present                                      | all present                     | PASS   |
| Summary       | 11.5 px mono, elided, fixed glyph                                    | 11.5 JetBrains Mono, hidden/ellipsis/nowrap, `◐` | 11.5 Geist Mono, same           | PASS   |
| Meter         | 12 cells, 3 px high, 2 px gap, status tokens, aria-hidden            | 12 / 3 px / 2 px                                 | same                            | PASS   |
| Count / caret | 10 px mono; 9 px caret, 0°/180°                                      | 10 px; caret 9 px wide, rotate none→180          | same                            | PASS   |
| Body          | 4/10/8 padding, top rule, 168 px cap, real overflow                  | `4px 10px 8px`, 1 px top rule, max-h 168, `auto` | same                            | PASS   |
| Phase heading | 10 px / 0.07 em / 4 px top margin                                    | all present                                      | all present                     | PASS   |
| Item          | 11.5 px / 1.85 line-height                                           | 11.5 / 21.275 px                                 | same                            | PASS   |
| Current row   | surface bg + 2 px inset running marker                               | surface bg + `2px 0 0` inset accent              | same (running token)            | PASS   |
| Focus ring    | Legacy −2 px inside; Console +2 px outset, visible all sides         | −2 px (never clipped)                            | +2 px outset fully painted (§6) | PASS   |

One deliberate deviation is recorded in §11 (Console section `p-[4px]`).

## 4. Fixed-strip and two-scroll-container proof

For each surface the spec captures the strip box, the transcript scroller box,
and `scrollTop`, then scrolls the transcript to a settled bottom:

- first/last visible transcript `details[data-tool-id]` rows change while the
  strip's top/left/width/height stay within 1 px — on both surfaces;
- the strip bottom stays `≤` the scroller top before and after the scroll
  (non-overlap), and the Jump-to-latest control is never covered;
- scrolling the transcript back to zero and repeating the same assertions
  passes;
- the expanded 12-item body reports `scrollHeight 329 > clientHeight 167`;
  scrolling the body to its bottom reveals the final item while the transcript
  `scrollTop` and the strip container box do not move — two independent scroll
  containers proven.

`{legacy,console}-todo-scrolled-room.png` show the strip pinned at the room top
with the transcript at its settled bottom.

## 5. Responsive and zoom results

Viewport matrix on both surfaces (1440×1000, 1024×900, 768×900, 390×844) plus
Chromium 200 % zoom:

- header stays one line; the representative text elides before the count or
  caret are lost;
- section and body stay inside the room; `scrollWidth <= clientWidth` for the
  room and the body; page-level overflow ≤1 px;
- all interactive targets ≥24×24 px;
- expand/collapse never covers the transcript's first row — non-overlap holds
  unconditionally;
- at 200 % zoom (720×500 effective CSS) the expanded strip compresses the
  Legacy transcript scroller to ~7 px, so no 28.5 px transcript row can fit
  inside it — a viewport squeeze, not an overlay. The first-row-visibility
  assertion is conditional on scroller height ≥28.5 px; strip/scroller
  non-overlap and positive scroller height remain unconditional;
- the internal body scroll remains usable at the narrowest viewport.

## 6. Keyboard, focus, and motion results

- The Todo header is the first focusable control inside the room region on
  both surfaces; while collapsed, no hidden body child enters the tab order.
- Enter opens, Space closes, click toggles; focus stays on the button through
  each activation.
- Focus outline: `2px solid` opaque accent (`--accent-bright` resolves to
  `oklch(0.72 0.18 250)` on Legacy, `oklch(0.64 0.295 330)` on Console).
  Legacy keeps the contracted −2 px inset; Console keeps the designed +2 px
  outset — see §11 for the clip-chain defect this surfaced and the fix.
- Caret transition: 120 ms under normal motion; under
  `prefers-reduced-motion` the transition-property is `none` (the authored
  duration is not required to become 0 s). Tailwind v4's `rotate-180` uses
  the standalone `rotate` property, so the spec asserts `rotate` and
  `transition-property` containing `rotate`, not `transform`.
- A same-scope live update preserves focus and expansion; navigating the room
  to a different node remounts a fresh collapsed control.

## 7. Contrast

All ratios were resolved through the browser (computed colors vs effective
backgrounds) and written to `evidence/todo-strip-metrics.json` → `contrast.*`.
Floors: text/glyphs ≥4.5:1, focus ring ≥3:1. Summary:

| Element                                         | Legacy       | Console      |
| ----------------------------------------------- | ------------ | ------------ |
| TODO label / count (text-secondary on elevated) | 5.33         | 7.90         |
| Representative (text-primary on elevated)       | 14.08        | 16.72        |
| Completed glyph / item text                     | 5.81 / 5.33  | 8.97 / 7.90  |
| In-progress glyph / item text (on surface)      | 7.39 / 15.28 | 7.72 / 17.72 |
| Pending glyph / item text                       | 6.48 / 6.48  | 9.24 / 9.24  |
| Blocked glyph / item text                       | 9.21 / 6.48  | 11.17 / 9.24 |
| Abandoned glyph / item text                     | 6.48 / 6.48  | 9.24 / 9.24  |
| Focus ring on elevated / on hover               | 6.80 / 6.51  | 4.57 / 4.35  |

The meter cells (5.81 / 8.97) and the 2 px inset running marker are redundant
decoration — the text count, glyph, and spoken status phrase carry status — so
they are not the sole channel. No token failed; nothing was escalated.

## 8. Chromium accessibility-tree evidence

`page.accessibility.snapshot()` walks the real Chromium AX tree per surface:

- exactly one region named `Todo`, inside the node-room region
  (`<nodeId> room`);
- header exposes role `button` with an assembled name
  (`TODO in progress Map the message path 1/12`), `expanded` false → true, and
  `controls` → the body id;
- collapsed: no heading/list nodes below the strip; expanded: two phase
  headings and a list of 12 listitems appear;
- heading names arrive uppercase (`RESEARCH`, `IMPLEMENT`) because Chromium AX
  honors `text-transform: uppercase` — the spec lowercases before comparing;
- listitem names are empty; each item's spoken phrase lives in descendant
  `StaticText` nodes (walked via `childIds`) — exactly one status phrase per
  item, the blocked reason appears exactly once, abandoned status exactly
  once;
- decorative middot suffixes, dropped markers, glyphs, meter cells, and the
  caret are absent from the AX tree;
- no agent text appears in ids/labels/titles;
- focus is retained across activation and live re-render.

## 9. Manual visual comparison — canonical top placement vs prototype anatomy

The prototypes (`claude-design/design_handoff_node_room_transcript_steering/*.dc.html`)
place the strip between transcript and dock and end it with a footer bar; the
SPEC/epic/architecture spine override that placement — the strip is pinned at
the **top** of the transcript panel as a flex sibling of the scroller, and the
footer/Raw bar is deliberately not built (Raw belongs to individual tool rows;
the folded checklist has no single raw payload). What IS adopted from the
prototypes — collapsed default, current-item summary, segmented meter, 168 px
body cap, current-row emphasis, 120 ms caret — matches §3's measurements. The
top-vs-bottom ordering difference is authority-resolved, not a visual failure.
The expanded Console capture also records the prototype's chosen −2 px outline
superseded by the designed +2 px outset (now fully visible — §6/§11).

## 10. Manual assistive-technology pairings — BLOCKED

Required pairings could not be executed in this environment:

- **Windows + Chromium + NVDA** — no Windows VM or NVDA runtime is available
  (`prlctl`, `VBoxManage`, `vmrun`, `limactl`, and `nvda` are all absent);
  cannot install or reach a pairing from the worktree.
- **macOS 26.6 (arm64) + Chromium/Safari + VoiceOver** — this session has no
  assistive access: `System Events` reports `UI elements enabled = false`, so
  TCC denies AX automation and VoiceOver cannot be driven non-interactively.

What _was_ obtained: the exact name/role/state channel both ATs consume —
the Chromium AX tree in §8 (region/button/expanded/controls, heading + list +
12 listitems, one status phrase per item, decorative exclusion), DOM-order tab
behavior, focus retention, and reduced-motion semantics — all verified
programmatically. Spoken-announcement wording ("collapsed"/"expanded"
phrasing) still needs a human pairing and is a **blocker for full sign-off**,
not waived. Recommended session: Windows 11 + NVDA 2024.x + Chromium, and
macOS + VoiceOver + Chromium/Safari, on the `e2e-todo-strip` run.

## 11. Commands, results, deviations, and final status

Commands run (all green, in the required order):

| Gate                   | Command                                                         | Result                                                                                                  |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Focused spec           | `bun run --cwd e2e test:ui -- --grep 'todo strip'`              | 24 passed                                                                                               |
| HITL regression        | `bun run --cwd e2e test:ui:hitl`                                | 36 passed, 3 env skips                                                                                  |
| Web unit + types       | `(cd packages/web && bun run test && bun run type-check)`       | 908+454+53 pass, 0 fail; tsc clean                                                                      |
| Providers unit + types | `(cd packages/providers && bun run test && bun run type-check)` | 0 fail across all files; tsc clean                                                                      |
| E2E types              | `(cd e2e && npm run typecheck)`                                 | clean                                                                                                   |
| Lint                   | `bun run lint --max-warnings 0`                                 | 0 errors, 0 warnings                                                                                    |
| Validate               | `bun run validate`                                              | all steps pass (check:\* ×5, type-check all packages, lint, format:check, test:install, `bun run test`) |

Regression record: the focused spec covers no-todo rooms (no strip, room
landmark intact), Console Tool-calls toggle isolation, and non-agent rooms;
the HITL suite (36 pass) covers history pagination, live refresh, error/retry,
scroll restoration, stick-to-bottom, and Jump; the Story 1.1 visual spec
(`agent-tool-row-visual.spec.ts`, 6 tests inside the HITL grep) is green.
Provider behavior with `emitTodo` absent is covered by `no-todo` plus the
fold-library unit tests.

Deviations / cause-aligned fixes made during this story:

1. **Console +2 px focus outline was being clipped** (real defect the gate was
   written to catch). Chain: room region `overflow-hidden`, then
   `console-inspect-room`, the react-resizable-panels panel (`overflow:auto`)
   and group (`overflow:hidden`), all flush with the strip's edges — and the
   room panel is flush with the window's right edge, so no ancestor clip-margin
   can paint past the viewport. Fix: region → `overflow-clip` +
   `[overflow-clip-margin:4px]` (`ConsoleNodeRoom.tsx`), and the Console strip
   section gained `p-[4px]` (`ConsoleTodoStrip.tsx`) so the full-bleed chrome
   (elevated bg, bottom rule, zero radius, full width) is unchanged while the
   button gains the 4 px paint room the +2 px outset ring requires on all four
   sides. Recorded here rather than silently switching to the prototype's −2 px.
2. Tailwind v4 `rotate-180` → standalone `rotate` property (spec asserts
   `rotate`, not `transform`).
3. Chromium AX names reflect `text-transform: uppercase` (spec lowercases
   before comparing); listitem accessible names are empty — status phrases live
   in descendant `StaticText` (spec walks `childIds`).
4. 200 % zoom Legacy squeeze: conditional first-row visibility when the
   scroller band <28.5 px (§5); non-overlap stays unconditional.
5. **Unblock commits** (pre-existing, proven on clean base):
   `3f430b81` regenerated `bundled-defaults.generated.ts` for the fixture
   `32e610ef` had restored; `c6e832a4` prettier-formatted a stale table in
   `prd.md`; `915cf18c` restored `speckit-feature.yaml` +
   `speckit-ralph-native-feature.yaml` (absent on this branch's lineage, present
   at `80268f5c`) fixing 7 `dag-executor.test.ts` failures, with the generated
   file regenerated (30→32 workflows).

**Final status: automated acceptance PASSED; story sign-off BLOCKED on two
items this loop cannot own:**

- Manual AT pairings (§10) — no Windows/NVDA and no scriptable VoiceOver in
  this environment; per the story's own note, `passes` stays `false` until a
  pairing passes or an authorized owner accepts an alternative.
- PR formation — the AC asks for a PR from `.github/pull_request_template.md`
  targeting `develop` with `Closes #178`; this Ralph loop is contractually
  forbidden from opening PRs (the parent workflow owns PR lifecycle), so this
  criterion is delegated to the parent, with this report linked for the body.
