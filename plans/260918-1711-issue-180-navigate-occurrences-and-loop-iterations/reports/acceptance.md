# Acceptance report — Story 1.7 / CAP-6 (issue #180)

Navigate transcript occurrences and loop iterations. B1 reachability mode:
**compatibility-only** (recorded 2026-09-19, AD-7 amendment). There is no
aggregate "all iterations" entry point; Story 2.10 remains blocked on a future
reachability decision.

## Reachability and evidence types

- **Component tests are the primary multi-occurrence proof** — they drive the
  grouping library and both room components directly.
- **`e2e/ui/occurrence-navigation.spec.ts` is renderer-integration evidence**:
  lifecycle events and transcript rows are seeded into the worker's real SQLite
  store, so the server request path, the `json_extract` occurrence filter, the
  run-detail execution projection, pagination drain, and both shells are real —
  but no modern-loop executor currently produces a node-scoped
  multi-occurrence selection, so this fixture models the durable persisted
  shape rather than claiming executor reachability.
- **Limitation:** no real E2E exists for a modern aggregate loop because B1
  adopted compatibility-only; none is claimed. The `occ-multi` fixture's
  unscoped execution row is the compatibility path a pre-occurrence run
  produces naturally.

## AC-by-AC evidence

### 1. Integration evidence matches the recorded B1 mode

- `[P1] [V:occurrence-nav.console-scopes]` (e2e): the room's default
  node-scoped request is observed with `occurrenceId=null` (no filter);
  selecting an occurrence execution issues exactly `occurrenceId=<uuid>` +
  `attemptId=<uuid>` and renders one group — no headings, no navigator.
  Returning to the unscoped row restores the unfiltered request.
- `[P1] [V:occurrence-nav.legacy]` (e2e): identical request-scope contract on
  the Legacy shell, driven by row-button clicks whose opener ids embed the
  encoded rowId (no label ambiguity).
- Component suites (primary proof):
  `occurrence-groups.test.ts` (grouping, labels, disambiguation, prefix
  attachment), `NodeTranscriptPane.test.tsx`, `NodeRoom.test.tsx`,
  `LegacyNodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx`,
  `ConsoleExecutionHistory.test.tsx` — all green (see Gates).
- Aggregate mode: not applicable — B1 recorded compatibility-only, so the
  aggregate bullet (real-path entry, 3,465-row budget) is intentionally
  unexercised; Story 2.10 stays blocked.

### 2. Regression evidence preserved

- Two individual iteration selections issue two distinct occurrence-filtered
  requests: e2e request observer (`observeNodeMessagePages`) plus
  `NodeTranscriptPane`/`ConsoleNodeRoom` component tests.
- Execution select filters/refetches and persists selection: covered by the
  room component tests and the e2e scope-switch assertions.
- Pagination high-watermark/refresh/scope-abort/partial failure:
  `node-message-pages` behavior exercised by the room test suites; the live
  e2e test also forces a 500 on a refresh poll and verifies loaded groups
  remain with an incomplete notice + Retry.
- Todos pinned, Ask cards scoped/anchored/actionable: existing room component
  tests unchanged and green (no story edits to those paths).
- Live follow / manual hold / restored scroll / `Jump to latest`: e2e
  `[V:occurrence-nav.live]` proves navigator jump disengages follow, a live
  append does not move the viewport (scrollTop delta ≤ 2px), `Jump to latest`
  appears on the running row and re-pins to the bottom (≤ 2px from end).
- Console tool/system toggles: `[V:occurrence-nav.console-filters]` toggles
  both filters against real rendered groups.
- Console import isolation: `console-isolation.test.ts` in the third focused
  suite, green.

### 3. Visual matrix — both shells, nine states, required layouts

Command: `(cd e2e && bun run test:ui -- occurrence-navigation.spec.ts)` —
6 tests, all pass. Artifacts in `reports/evidence/`.

| Planned state                             | Evidence                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero/unscoped historical metadata → flat  | `[V:occurrence-nav.flat]` — `occ-none` node (metadata-less rows) renders flat with no headings and no navigator on **both** shells: `console-unscoped-flat.png`, `legacy-unscoped-flat.png`                                                                                           |
| Single occurrence → flat                  | `console-single-occurrence-flat.png`, `legacy-single-occurrence-flat.png` (occurrence-scoped selection: one group, no headings/navigator)                                                                                                                                             |
| Multiple retry occurrences with suffixes  | `Run 1 · failed` + `Run 2 · retry · failed` rendered and navigable: `console-occurrence-room-460w-1430x560.png` (System on), `legacy-occurrence-room-460w-1150x560.png`                                                                                                               |
| Multiple loop occurrences `Iteration N`   | `Iteration 1`, `Iteration 2` headings + options, both shells, same artifacts                                                                                                                                                                                                          |
| Colliding route/nested labels resolved    | B4 ancestry-node-id qualifier exercised by seeded nested loops: `Iteration 1 › Iteration 1 · loopX` vs `… · loopY` — distinct names, no raw ids, both shells                                                                                                                          |
| Console filtered to one displayable group | `[V:occurrence-nav.console-filters]` — hiding Tool calls leaves one displayable group → headers and navigator removed: `console-filtered-flat.png`                                                                                                                                    |
| Partial/error with loaded groups          | `[V:occurrence-nav.live]` — forced 500 on the refresh poll: groups persist, `Failed to load node transcript` + `Retry` render: `console-partial-error.png`                                                                                                                            |
| Live append after navigation              | same test — appended row arrives, viewport holds (manual hold), `Jump to latest` re-pins: `console-live-append-hold.png`                                                                                                                                                              |
| Target removed on filter/scope change     | filters test — hiding System after navigating to `Run 2 · retry · failed` returns the select to the `2 occurrences` placeholder; focus stays on the toggle used (never `<body>`). The non-interactive heading-removal redirect (select, else scroller) is covered by component tests. |

Required layouts:

- **Authoritative room width 460px:** Console measured **460px** at a 1430×560
  viewport (`console-occurrence-room-460w-1430x560.png`); Legacy measured
  **460px** at 1150×560 (`legacy-occurrence-room-460w-1150x560.png`).
  `measuredRoomWidth` asserts 452–468px; the screenshot filename and the test
  annotation record the measured value. Heading tokens asserted via computed
  styles (`expectHeadingTokens`): 10.5px mono uppercase, letter-spacing
  0.84px (= 0.08em at 10.5px), `10px 0 5px` margins, 1px rule to the right
  edge; `expectNoHorizontalOverflow` asserts no scroller/page overflow.
- **Host small-viewport breakpoint:** 390×844 (`[V:occurrence-nav.narrow]`) —
  both room navigators remain operable (option committed, heading focused)
  with no horizontal overflow:
  `console-occurrence-room-narrow-390x844-390w.png` and
  `legacy-occurrence-room-narrow-390x844-390w.png`. The transcript declares no
  breakpoint; the select end-elides like the `Execution` select.
- **Keyboard/focus state:** `console-focus-select.png` /
  `legacy-focus-select.png` (Tab-reached select carrying the shell focus
  ring) and `console-focus-heading.png` / `legacy-focus-heading.png` (focus
  moved to the target `h3` after commit).

### 4. Accessibility evidence (automated)

- One `h3` per rendered occurrence with the exact visible name, asserted with
  `getByRole('heading', { level: 3, exact: true })` on both shells; the
  metadata-less prefix row renders before the first heading with no heading of
  its own (`expectDomOrderMatchesVisual` bounding-box order check).
- Navigator: accessible name is the visible `Jump to` `<label>`
  (`getByLabel('Jump to')`), disabled `N occurrences` placeholder with the
  real count at rest, option names identical to headings including
  disambiguation qualifiers, `aria-controls` naming the target heading `id`
  after commit — all asserted in both shell tests.
- DOM/accessibility order matches visual group order (same bounding-box
  assertion).
- Keyboard-only traversal and activation identical on both shells: Tab from
  `Close` reaches the select in DOM order; commit on `change` moves focus to
  the heading and scrolls.
- No per-row live-region announcements: zero `[aria-live]`, `role="status"`,
  `role="alert"` inside the transcript scroller after navigation
  (`expectNoLiveRegion`).
- Manual AT (VoiceOver/NVDA): **unavailable in this environment** — recorded
  as unavailable, not passed.

### 5. Documentation synced to the accepted decisions

- `EXPERIENCE.md`: Execution-filter vs navigator-scroll distinction already
  correct; residual-tie wording corrected to the shipped rule (`· occurrence
K` where K is the group's 1-based position in transcript order — verified
  against `occurrence-groups.test.ts` expectations).
- `DESIGN.md` delta 5 paragraph reconciled to shipped anatomy: `Jump to`
  label is `text-xs` text-secondary (not phase-label uppercase); the select
  shares the `Execution` select's class string verbatim; control row padding
  `px-3 py-2`; 24px SC 2.5.8 floor cleared by `py-0.5` + border.
- `ARCHITECTURE-SPINE.md` AD-7 + AD-12.7 re-verified: compatibility-only
  amendment present, no aggregate wording, Story 2.10 still recorded as
  blocked. No edits required.
- `mockups/key-legacy-node-room.html` and `mockups/key-console-node-room.html`
  gained the delta-5 control row (`Jump to` + select) both lacked.
- No generated types, schemas, unrelated specs, or sprint-status files
  edited.

### 6. This report

`reports/acceptance.md` — this file — plus `reports/evidence/*.png` captured
by the spec (filenames record viewport and measured room width; tests also
emit `evidence` annotations).

### 7. Gates

| Gate                      | Command                                                                                                                                                                                                                                        | Result                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Focused lib tests         | `(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts src/lib/occurrence-groups.test.ts)`                                                                                                        | 51 pass                                                                                                                          |
| Legacy room tests         | `(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)`                                          | 113 pass                                                                                                                         |
| Console room tests        | `(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)` | 96 pass                                                                                                                          |
| Web type-check            | `(cd packages/web && bun run type-check)`                                                                                                                                                                                                      | clean                                                                                                                            |
| Lint                      | `bun run lint --max-warnings 0`                                                                                                                                                                                                                | clean, 0 warnings                                                                                                                |
| E2E typecheck             | `(cd e2e && bun run typecheck)`                                                                                                                                                                                                                | clean                                                                                                                            |
| Renderer-integration spec | `(cd e2e && bun run test:ui -- occurrence-navigation.spec.ts)`                                                                                                                                                                                 | 6/6 pass                                                                                                                         |
| Repo validate             | `bun run validate`                                                                                                                                                                                                                             | pass — required `chore(unblock)` for pre-existing prettier drift in two committed plan docs (see Blocker Ledger in progress.txt) |

### 8. PR and workflow handoff (parent-owned)

This worktree intentionally does not open the PR. Ready state for the parent
workflow: branch `archon/thread-499eb44c`, base `develop` (B3), title
`feat(web): navigate transcript occurrences`, body built from
`.github/pull_request_template.md` explicitly. `Closes #180` is warranted —
every accepted issue criterion now has evidence above. No sprint-status
mutation performed here; the owning BMad workflow moves the story to done.
