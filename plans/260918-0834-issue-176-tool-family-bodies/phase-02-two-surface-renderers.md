---
phase: 2
title: 'Phase 2: Legacy and Console family bodies'
status: pending
priority: P1
effort: '1.5d'
dependencies: [1]
---

# Phase 2: Legacy and Console family bodies

## Goal

Render the Phase 1 lazy body contract in the Story 1.2 presented-body slot on Legacy and Console, with the approved anatomy, safe stored-content rendering, responsive behavior, and no changes to Raw or full-output semantics.

## Pre-execution coordination gate

Issue #175 is open and its current plan targets the same ToolHistory body blocks and tests. Before changing either renderer:

1. inspect the code actually merged for #175; do not assume its draft names or DOM;
2. if #175 is not merged, coordinate ownership or defer renderer edits;
3. rebase and run #175's focused Raw tests before adding bodies;
4. record the final swap-slot anchor/state names in the implementation evidence.

This is a merge-conflict gate, not a Story 1.3 product dependency. Phase 1 does not wait on it.

## Verified design authority

- `EXPERIENCE.md` Component Patterns and State Patterns.
- `DESIGN.md` body-box tokens, layout at 460px, component specifications, and resolved contrast decisions.
- `mockups/key-transcript-states.html` §D family states and §F Raw swap.
- `mockups/key-console-node-room.html` and `key-legacy-node-room.html` for surrounding room geometry.

The mockups' body content is authoritative for anatomy and visual roles, but later-story todo/task/diff examples do not expand this story's scope.

## Rendering architecture

Each surface owns a small local `ToolBody` switch and stored-markdown component. Console must not import Legacy components.

```text
ToolHistory
  presentation = existing current/full-output summary
  details open state
    body bar: family/facts                         # #175 owns Raw placement/state
    Raw open -> exact raw payload box              # #175
    Raw closed + row open ->
      toolBodyPresentation(current payload, presentation.family)
      -> local ToolBody(body, presentation status)
    full-output / error / Retry below              # existing behavior
```

Call `toolBodyPresentation()` only in an execution path gated by `open && !rawOpen`; do not calculate it unconditionally above JSX. A closed row and a Raw-open row must not invoke it. When `hasFullOutput` becomes true, pass `fullOutput`; otherwise pass `item.output`.

Import only `ToolBody` types/resolver from `@/lib/tool-presentation`. `@/lib/tool-presentation` is already in the Console isolation allowlist, so no allowlist edit is expected.

## Shared visual rules

- Body container: `.tool-family-body`, `surface-inset`, 1px border, 6px radius, 8px 10px padding, 11.5px/1.5 mono, `white-space: pre-wrap`, `overflow-wrap: anywhere`, `min-width: 0`.
- Body rail/indent/bar/Raw placement stay as implemented by #175. The bar opens with the family, keeps facts to its left, and keeps Raw at the far right without wrapping at 460px.
- Terminal: `$` in node-bash, bounded command and output, explicit `running`/`no output`/`output unreadable — open Raw`; failure uses both word/glyph and error color.
- File: path in node-command, preview preformatted, explicit `no preview` or unreadable copy.
- Matches: pattern and optional scope, path in node-command, `:line` in text-secondary, then match text. Text-only items remain visible. Paths: one node-command path per line. Show `+n more` for exact omitted counts and `more results omitted` for an inexact capped tail.
- Code: source through a collision-safe fenced markdown block; language token restricted to `[A-Za-z0-9_+.-]+`; result in a second body box 6px below. Unknown languages render unhighlighted source.
- Web: URL as inert visible text, optional title, then safe markdown/results. It is not an anchor.
- Generic: key column width `11ch`, value text-primary, no more than three rows total; optional safe text output follows without JSON serialization.
- Null body (todo/task): render no placeholder box. Body bar and Raw remain available.

## Stored-markdown security boundary

Do not reuse the existing assistant-message `ReactMarkdown` component configuration blindly. Tool output is untrusted stored content and requires a local restricted component map on both surfaces:

- no `rehype-raw` and no `dangerouslySetInnerHTML`;
- `a` renders its label plus a visible parenthesized destination as inert text, omitting the duplicate destination when a bare autolink's label already equals it; it has no `href`, click handler, or target;
- `img` renders alt text plus `[image omitted]`, never an `<img>` and never initiates a request;
- headings, paragraphs, lists, blockquotes, inline code, and fenced code remain available;
- `rehype-highlight` remains the only rehype plugin for code, with language auto-detection disabled; unknown languages are allowed and non-fatal.

Tests must include explicit markdown links, autolinks, images, raw HTML, `javascript:` URLs, and external image URLs, and assert no active anchor/image/raw element reaches the DOM.

## Syntax highlighting

Add only scoped overrides in `packages/web/src/index.css` under `.tool-family-body` so agent prose and other existing code blocks do not change:

- keyword/title/built-in groups: `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))` (the resolved contrast decision);
- strings/literals where appropriate: `var(--success)`;
- comments/annotations: `var(--text-secondary)`;
- base code: `var(--text-primary)` and transparent background.

Do not add a new named token or dependency. Measure the rendered mix against each surface's `surface-inset`; record >=4.5:1.

## Files

| Path                                                                                       | Action                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | add Legacy local safe markdown and ToolBody; call resolver lazily  |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | static anatomy/content/security tests                              |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | disclosure, Raw swap, full-output, keyboard tests                  |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | add Console local safe markdown and ToolBody; call resolver lazily |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Console anatomy/interaction/security tests                         |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | change only if the merged #175 path asserts ToolHistory bodies     |
| `packages/web/src/index.css`                                                               | add scoped highlight token mapping                                 |

Do not modify `agent-history.ts`, pair projection, API types, provider code, or backend routes. Do not add `@/lib/tool-output` to Console imports unless a concrete need appears; prefer the public presentation boundary.

## Implementation sequence

1. Pass the #175 coordination gate and characterize the merged Raw swap with focused tests.
2. Add red renderer tests on both surfaces for every Phase 1 body arm, null bodies, lazy invocation, safe markdown, and full-output recomputation.
3. Implement Legacy local body renderer and restricted markdown map.
4. Implement Console local body renderer with equivalent semantics and Console's established focus-offset convention.
5. Add scoped highlight CSS and contrast/geometry assertions.
6. Run focused Legacy and Console tests, isolation tests, then all web tests/typecheck/lint/format.

## Test matrix

| Priority | State                                                                | Assertions on both surfaces                                                                                         |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| critical | closed row                                                           | body resolver not called; no body content mounted                                                                   |
| critical | open shell success/failure                                           | `$`, complete bounded command, text output, outcome/exit facts, no `"stdout"` object dump                           |
| critical | matches / search paths / glob paths                                  | correct anatomy; no invented line number in paths; pattern/scope present; overflow visible                          |
| critical | unknown generic                                                      | <=3 combined rows; `{…}`/`[n]` allowed; no serialized object; full sent name remains in header/title                |
| critical | Raw toggle                                                           | family body unmounted/replaced when Raw opens and restored when it closes; resolver skipped while Raw open          |
| critical | stored markdown attacks                                              | no active `a`, `img`, raw HTML, navigation, or network-capable element; prose structure preserved                   |
| high     | file normal/empty/unreadable                                         | path/preview/copy match contract; no diff UI                                                                        |
| high     | code known/unknown language and source containing long backtick runs | collision-safe fence; highlighted token classes only when known; source exact up to cap; result 6px below; no throw |
| high     | WebFetch/WebSearch                                                   | URL/title/result visible, markdown structured, links/images inert                                                   |
| high     | truncated-at-rest / transport full-output                            | salvage or unreadable state honest; summary badge stays; loaded full output recomputes body once                    |
| high     | todo/task                                                            | no fabricated generic/body box; body bar and Raw still work                                                         |
| medium   | 460px geometry                                                       | summary and body bar do not wrap; body content wraps; no panel-level horizontal overflow                            |
| medium   | keyboard/a11y                                                        | row summary, Raw, full output, Retry order; names/status announced; focus ring visible; reduced motion unchanged    |
| medium   | duplicate Console mount/poll rerender                                | normalization happens only for each actually open presented body, not every historical row                          |

Avoid assertions such as “body contains no `{`”; code and `{…}` are valid. Assert absence of serialized keys/object formatting instead.

## Visual acceptance evidence

Capture or assert both Legacy and Console at the contractual 460px panel width for:

1. shell failed/open;
2. matches with path/line annotations and overflow;
3. path list;
4. code known-language plus result and unknown-language fallback;
5. web markdown with inert link/image content;
6. generic with scalar/object/array markers;
7. empty and unreadable body;
8. truncated row before and after full-output load;
9. Raw open.

Compare structure/content/states to `key-transcript-states.html`; compare surrounding width and rail geometry to the two room mockups. Later-story todo/task/diff visuals are explicitly excluded.

Use deterministic transcript responses fulfilled at the Playwright route layer in `agent-tool-row-visual.spec.ts` for the family/degraded-state gallery; this exercises production React/CSS without changing the fake provider or production server. Keep those cases labelled as browser visual fixtures, not server end-to-end coverage. Phase 3 separately proves the real persisted Read row.

Record:

- computed body-box size/padding/type;
- no horizontal panel scroll at 460px;
- text-primary, text-secondary, syntax keyword, path, string, and focus-ring contrast on both surfaces;
- keyboard sequence and a screen-reader pass for one terminal and one matches body;
- reduced-motion behavior.

## Verification

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test
bun run type-check
bun run lint --max-warnings 0
bun run format:check
```

## Completion criteria

- [ ] #175 merged implementation was re-scouted/rebased or ownership coordinated.
- [ ] Every in-scope body arm and degraded state is deterministic on both surfaces.
- [ ] Closed and Raw-open rows skip the body resolver.
- [ ] Stored markdown cannot navigate, execute raw HTML, or fetch images.
- [ ] 460px and contrast evidence meet the design authority.
- [ ] Raw, full-output, Retry, disclosure, focus, and Console isolation regressions remain green.
- [ ] Web-wide verification passes.

## Risks and responses

| Risk                                  | Detection                                        | Response                                              |
| ------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| #175 DOM/state differs from its draft | pre-execution scout                              | adapt to landed contract; do not recreate Raw state   |
| Markdown creates active content       | malicious component fixtures                     | restricted local component map and no raw HTML plugin |
| Highlight theme overrides design      | computed-style/contrast evidence                 | narrowly scoped `.tool-family-body .hljs-*` rules     |
| Body work returns to polling path     | resolver spy on closed/re-rendered rows          | keep call inside open + presented branch              |
| Two renderers drift                   | identical table fixtures and semantic assertions | duplicate JSX only; shared data contract              |

## Rollback

Remove the two local ToolBody renderers and scoped CSS. #175's Raw view, current summary rows, full-output flow, and shared Phase 1 pure code remain independently revertible.
