# Story 1.1 — Visual Acceptance Report: Readable Tool-Call Row

Issue #174 / `agent-node-room` Story 1.1. Verifies the compact readable
`details[data-tool-id]` row in both the Console agent-history room and the
Legacy node room against the approved mockups and the shared presentation
policy.

**Evidence sources**

- `e2e/ui/agent-tool-row-visual.spec.ts` — 6 HITL Playwright cases, all passing
  (Chromium, @playwright/test 1.60.0). Captures live in `evidence/` beside this
  report and as `testInfo` attachments / `outputPath` files.
- `e2e/ui/workflow-run-hitl-visual.spec.ts` — legacy whole-view suite; only its
  readiness locator changed (`details[data-tool-id] > summary`, visible direct
  summary — no hidden-payload dependence).
- Component suites: `NodeRoom.test.tsx` (Legacy markup), `ConsoleNodeRoom.test.tsx`
  (Console markup), `tool-presentation.test.ts`, `agent-history.test.ts`.
- Real fixture: `e2e-hitl-run` stored workflow, fake `Read` tool
  (`HITL_TOOL_INPUT.txt` → `HITL_TOOL_OUTPUT`), succeeded outcome.

## 1. Geometry matrix (computed styles, both surfaces)

All values are `getComputedStyle` assertions in the new spec — no class-name
string matching. Room measured to **460 ± 2 px** before every narrow assertion
via the production split ratio (`archon.run-room.ratio.<surface>` localStorage →
`readRoomRatio` on remount; asserted on the rendered region, never the ratio).

| Element                 | Contract                                          | Console                                                 | Legacy                           | Result                                |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------- | -------------------------------- | ------------------------------------- |
| Transcript list padding | 10px vert / 12px horiz                            | `10px / 12px` (`px-3 py-2.5`)                           | `10px / 12px`                    | ✅ (Console fixed: was `p-3` = 12/12) |
| Adjacent collapsed rows | flush, no card gap                                | shared parent column, no inter-row margin               | same                             | ✅                                    |
| Summary                 | min-height 24px, pad 4/6, gap 8, radius 6         | `24px`, `4px/6px`, `8px`, `6px`                         | same                             | ✅                                    |
| Summary font            | 12px mono, weight 400                             | `12px`, `400`                                           | same                             | ✅                                    |
| Chevron column          | 9px wide, 10px text                               | `9px`, `10px`                                           | same                             | ✅                                    |
| Status glyph column     | 12px wide, 12px bold                              | `12px`, `12px`, `700`                                   | same                             | ✅                                    |
| Family chip             | 11px mono, 1px border, 1/7 pad, 4 radius, ≤24ch   | `11px`, `1px`, `1px/7px`, `4px`, `max-width 24ch`       | same                             | ✅                                    |
| Headline                | one line, elides                                  | `whitespace-nowrap`, `text-ellipsis`, `overflow-hidden` | same                             | ✅                                    |
| Badge group             | no-wrap; duration first to shrink                 | `whitespace-nowrap`; duration `flex-[0_1_auto]`         | same                             | ✅                                    |
| Body margin             | ~`2px 0 8px 29px`                                 | `mt-0.5 mb-2 ml-[29px]`                                 | same                             | ✅                                    |
| Body rail               | 2px left border, 10px left pad, 10.5px mono facts | `border-l-2`, `pl-2.5`, `text-[10.5px]`                 | same                             | ✅                                    |
| Focus ring              | 2px solid opaque `--accent-bright`                | `2px solid oklch(0.64 0.295 330)`                       | `2px solid oklch(0.72 0.18 250)` | ✅                                    |
| Focus offset            | **+2px Console / −2px Legacy** (documented delta) | `2px`                                                   | `-2px`                           | ✅                                    |

## 2. One-line at 460 px

At the measured 460 px room width on both surfaces:

- Summary height 24–30 px (single line).
- All direct children inside the summary's vertical band.
- `scrollWidth ≤ clientWidth` — nothing clipped horizontally.
- Every badge-group text fragment shares one top edge — no wrap.
- Elision anatomy: `path`-kind headlines render head (secondary, `text-ellipsis`
  shrinks first) + tail (primary, `flex-none`, `max-w-full` cap) so the file name
  survives; text-kind headlines elide on the whole span; duration is the first
  shrinkable badge (`flex-[0_1_auto]`).

## 3. Viewport sweep + zoom

`1440×1000`, `1024×900`, `768×900`, `390×844`, and a 200%-zoom emulation
(`Emulation.setDeviceMetricsOverride`, `deviceScaleFactor: 2`, logical width
720 px) on **both** surfaces:

- Row summary visible, single line, Enter toggles open, Space toggles closed.
- Room region stays inside the viewport; room has no internal horizontal
  scroll; no element inside the room overflows the page edge.

**Known pre-existing (not Story 1.1):** at 390 px the Legacy page has ~300 px
of page-level horizontal scroll caused by TopNav `A.flex` anchors (app chrome,
untouched by this story — verified by the offender scan; zero offenders live
inside the room region). Recorded here and in the progress blocker ledger.

## 4. Disclosure behavior + motion

- Row mounts closed for the succeeded fixture; `Input`/`Output` nested
  disclosures and `HITL_TOOL_OUTPUT` payload are hidden.
- `Enter` opens, `Space` closes — native `<summary>` activation, no custom
  key handler. `document.activeElement` stays on the summary through both.
- `ArrowDown` does nothing (no roving tabindex); `Tab` follows DOM order into
  the first diagnostic control (`Input` summary).
- Chevron transition: `transition-duration 0.12s` normally; under
  `prefers-reduced-motion` the `motion-reduce:transition-none` rule computes
  `transition-property: none` (the only row animation is removed; duration
  keeps its authored value — asserted on `transition-property`).

## 5. Focus visibility

- Keyboard activation produces `:focus-visible` on the summary on both surfaces.
- 2 px solid opaque `--accent-bright` (see §7 contrast).
- Console `outline-offset: +2px`; Legacy `-2px` — the single documented surface
  delta, asserted in computed style.

**Story 1.1 fix recorded:** the unlayered `.console-root :focus-visible` theme
rule (`outline: 2px solid var(--accent-ring)`, 30 % alpha) beat the layered
utility on Console. The summary now uses `focus-visible:outline-accent-bright!`
so the row's focus ring is the required opaque accent — verified computed
`oklch(0.64 0.295 330)` on Console, `oklch(0.72 0.18 250)` on Legacy.

## 6. Chromium accessibility-tree evidence (AT channel)

Via CDP `Accessibility.queryAXTree` on the row's `<details>`:

- Accessible name present, ordered **state → family·tool → target → facts**
  (`"succeeded file · Read HITL_TOOL_INPUT.txt …"`).
- Chevron and glyph are decorative (`aria-hidden`) — absent from the name.
- The `expanded` state on the row's own AX node (matched by
  `backendDOMNodeId`, not a nested diagnostic) reads `false` closed and `true`
  after Enter (polled — Chromium updates the AX tree lazily).

## 7. Contrast (resolved token/color-mix through the browser)

`evidence/tool-row-contrast.json` — every value resolved to OKLCH through the
real page canvas, ratio = WCAG relative luminance vs effective backgrounds
(rest = first non-transparent ancestor fill; hover = `--surface-hover`).

| Tone                                        | Console rest | Console hover | Legacy rest | Legacy hover | Floor  |
| ------------------------------------------- | ------------ | ------------- | ----------- | ------------ | ------ |
| search/glob chip text (`--node-prompt` mix) | **6.86**     | **6.17**      | **6.81**    | **5.65**     | 4.5 ✅ |
| nonzero exit digits (`--error` mix)         | **8.02**     | **7.21**      | **6.45**    | **5.35**     | 4.5 ✅ |
| neutral badge text (`--text-secondary`)     | 8.37         | 7.52          | 6.14        | 5.10         | 4.5 ✅ |
| succeeded glyph (`--success`)               | 9.50         | 8.54          | 6.70        | 5.56         | 4.5 ✅ |
| focus outline (`--accent-bright`)           | 4.85         | 4.35          | 7.85        | 6.51         | 3.0 ✅ |

Distinction held: the **real fixture** renders a `file`/`Read` row (chip text,
succeeded glyph, neutral badges, focus ring measured on the live row).
Search/glob chip text and nonzero-exit-digit tones do not occur in the fixture;
they are measured as resolved **production token values** against the real
rest/hover backgrounds — no screenshot claims a state the fixture lacks.

## 8. Five-status evidence

| Status      | Evidence                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| succeeded   | Real E2E fixture row — closed, `✓`, `succeeded` word, chip `file · Read`, headline `HITL_TOOL_INPUT.txt` (both surfaces, captured)                                                                                      |
| failed      | `NodeRoom.test.tsx` five-outcome matrix (open=true, `✕`); `ConsoleNodeRoom.test.tsx` "untouched row that turns failed opens once" + "poll-updated failure flips an untouched drained row open once" — production markup |
| running     | `tool-presentation.test.ts` "running shows elapsed…" (`running · <elapsed>` badge, suppresses premature `missing`); `ConsoleNodeRoom.test.tsx` "running badge and glyph use the console --running token"                |
| interrupted | `NodeRoom.test.tsx` five-outcome matrix (`⚠`, closed); `tool-presentation.test.ts` interrupted badge + keeps recorded `truncated` marker                                                                                |
| unknown     | `NodeRoom.test.tsx` five-outcome matrix (`–`, closed); `tool-presentation.test.ts` "unknown shows output unknown as its state"                                                                                          |

## 9. Mockup comparison at 460 px

Mockup rows measured inside a test-only 460 px panel override (authored files
unchanged): `key-transcript-states.html` (.panel), `key-console-node-room.html`
(#node-panel, authored 520 px → asserted at 460), `key-legacy-node-room.html`
(#node-panel), `full-transcript-review.html` (.room).

- Every mock's row summary anatomy = `chev → gl → fam → hl → bd` — the same
  order the product summary renders (asserted in both DOM and accessible name).
- Captures: `evidence/mockup-*.png`, `evidence/*-tool-row-460.png`,
  `evidence/*-room-460.png`, `evidence/*-context-1440.png`.

**Expected later-story deltas (documented, not failures):** no Raw control; no
family-specific bodies; no diff/todo/task/occurrence UI; the temporary
closed-by-default Input/Output bridge remains; leaner badge set.

## 10. Manual assistive-technology pairings — BLOCKED

Required pairings could not be executed in this environment:

- **Windows + Chromium + NVDA** — no Windows VM available (Parallels absent on
  this host); cannot install or reach one from the worktree.
- **macOS + Chromium/Safari + VoiceOver** — this session has no assistive
  access: TCC denies `osascript`/AX API automation and VoiceOver cannot be
  driven non-interactively.

Recorded fields that _were_ obtainable: the exact name/role/state channel both
ATs consume (Chromium AX tree, §6) — closed/open names, ordering, expanded
state, decorative glyph/chevron exclusion, Enter/Space activation, focus
retention, DOM-order Tab — all verified programmatically. Spoken-announcement
wording ("collapsed"/"expanded" phrasing) still needs a human pairing and is a
**blocker for full sign-off**, not waived. Recommended session: Windows 11 +
NVDA 2024.x + Chromium, and macOS 15 + VoiceOver + Chromium/Safari, on the
`e2e-hitl-run` room.

## Result

All automated gates green; one Story-1.1 geometry defect (Console transcript
padding) and one Story-1.1 focus-color defect (Console 30 %-alpha ring) found
by this verification and fixed. Manual AT sign-off remains an open blocker
recorded above; everything else passes.
