---
phase: 2
title: 'Phase 2: Legacy and Console body renderers'
status: todo
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: Legacy and Console body renderers

## Goal

Render the shared task or generic body on every node-room surface with the accepted content, disclosure behavior, styling, and safety. The two shells may differ only in existing surface tokens; they must not re-interpret provider input or presentation facts.

## Pre-edit integration check

Read the current versions of these files and their latest history before editing:

- `packages/web/src/components/workflows/NodeRoom.tsx`
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
- their focused tests
- `plans/260918-1038-issue-175-raw-payload-toggle/plan.md` and current production code, to determine whether Story 1.2 has actually landed

Choose the existing-state integration, not the sibling plan's prediction:

- **Current Story 1.1 body:** place readable task/generic content after the body bar and before the temporary Input/Output disclosures.
- **Story 1.2 already present:** readable task/generic content is the non-Raw branch; the Raw panel replaces it while open. Keep full-output loading/retry controls where Story 1.2 placed them.

In either state, preserve the outer disclosure's guarded `onToggle`. If a test says a tool row contains no nested `<details>`, narrow it to the obsolete Input/Output disclosures or use a non-task fixture; a task card is intentionally nested.

## Files

| Path                                                                                       | Action                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                       | Modify local Legacy body markup               |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                  | Static task/generic anatomy and content tests |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | DOM interaction/state tests                   |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`      | Modify local Console body markup              |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Selected-room anatomy and interaction tests   |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Inline-history parity case                    |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Verify only                                   |

Do not add a shared React component under `components/`; Console's lint boundary forbids that dependency. Import shared types/helpers from `@/lib` only where needed.

## Markup contract

### Body bar

Both renderers must replace their local reconstruction from `presentation.badges` with the already-complete `presentation.bodyBarText`:

```text
bodyBarText
```

Expected task-fact prefixes are exact:

- OMP one/many: `task · batch · 1 subtask` / `task · batch · 2 subtasks`
- Claude: `task · single dispatch`

The collapsed row still shows `N subagent(s)` and normal runtime badges. The shared presentation appends applicable state/exit/output-state/duration facts to the task bar so facts dropped under width pressure remain reachable; it omits the redundant subagent count. Render that string verbatim. Non-task body bars remain byte-for-byte compatible through Phase 1's fallback construction.

### Task context

- Render only when `body.context` is non-empty.
- Use `ReactMarkdown` with the renderer's existing GFM, breaks, syntax-highlight, and safe URL behavior. Do not enable raw HTML.
- Provide task-context component overrides that keep paragraphs/headings/lists compact at 11.5px mono and `text-secondary`; the full assistant-prose spacing is too large for a subtask cluster.
- Override `img` to render nothing. Links retain the current safe external-link behavior. Add tests for markdown emphasis/list semantics, ignored raw HTML, absent image elements, and absent executable `javascript:` URLs.
- The simple fixture is a single line above the first card. Multi-block markdown may wrap vertically; no arbitrary one-line truncation is allowed.

### Subtask card

For each `TaskSubtask`, render one native `<details data-subtask-index="N">` scoped inside its owning tool row. Use array index as the local key because tool input order is the identity and is immutable for a tool call; do not emit a global `id` or reference the index outside that row.

Collapsed summary order:

```text
▶  [agent ·] subtask name — prompt excerpt
```

- Chevron is `aria-hidden`, fixed 9px, 10px, rotating 90 degrees in 120ms; `motion-reduce` removes the transition. Bind rotation to that card's own disclosure state (for example a named `group/subtask`), so the already-open outer tool row cannot rotate a closed card's chevron.
- Agent is present only when non-null, uses `node-approval`, 11.5px/600.
- The separator after agent appears only with agent. The subtask name is bold according to the component-specific DESIGN rule. The excerpt is `text-secondary` and is consumed from the shared `TaskSubtaskCard` without local derivation.
- Summary is one line, at least 24px high, and uses `min-w-0`/overflow rules so the chevron and focus affordance survive narrow panels. The full strings remain React text, not attributes.
- Focus outline is 2px `accent-bright`, offset -2px Legacy and +2px Console, matching the existing tool row on each surface.

Open content:

- Add the exact `prompt` as a React text node in a mono `<pre>`-style `surface-inset` box inside the card.
- Use pre-wrap and word breaking so long unbroken text cannot create horizontal room overflow.
- Do not add per-subtask status, output, controls, provider name, or fabricated label.

Card container: `surface-elevated`, 1px `border`, 6px radius, 6px vertical / 9px horizontal padding, 5px top margin. Use existing tokens/classes only.

### Generic fallback

When `body.kind === 'generic'`, render the projected `fields` as the canonical compact key/value list: key in `text-secondary`, value in `text-primary`, at most three rows. Values such as `{…}` and `[n]` are literal projection markers, never parsed or expanded. If `fields` is empty, render no invented message; the body bar remains the stable disclosure content.

### Outer row interaction

- Keep the outer row controlled by its existing identity/touched/initial-open state.
- Keep `event.target !== event.currentTarget` in the outer `onToggle`; update only a stale comment if necessary.
- Subtask cards are native, initially closed, and need no React state.
- A polling rerender of the same tool item/index must retain the browser's card-open state. A different tool item gets fresh closed cards.
- Existing full-output load/error/retry behavior and the current Input/Output or Raw behavior remain unchanged.

## Tests first

### Legacy static anatomy — `NodeRoom.test.tsx`

Using the existing `AgentHistoryItem`/presentation builders rather than hand-writing a divergent presentation:

- OMP fixture with no runtime facts: collapsed row contains `2 subagents`; opened body bar is exactly `task · batch · 2 subtasks`; context markdown precedes exactly two cards; both cards show agent, bold name, and excerpt; prompt is in each nested body but not in the card summary.
- Claude fixture with no runtime facts: bar `task · single dispatch`; one card; no context wrapper. Repeat with `agent: null` and assert no orphan `·`.
- Singular OMP wording.
- A valid boundary batch renders all 64 cards with no omission notice; the over-limit generic path stays covered by Phase 1 and the malformed component case.
- Malformed fixture: generic field rows render, there are no subtask cards or count badge, and no JSON dump.
- Context markdown renders emphasis/list content, no `<img>`, no raw HTML element, and no executable link target.
- The task card/class anatomy carries the documented radius, padding, margin, font, focus, chevron, and reduced-motion classes.
- Existing failed-row auto-open and non-task body-bar tests remain green.

### Legacy interaction — `LegacyNodeRoom.test.tsx`

- Click card summary open/closed while the outer row remains open and its touched state is not changed by the nested toggle.
- A closed card's chevron remains unrotated while the outer row is open; only that card's open state rotates it.
- Press Enter and Space on a focused card summary; happy-dom does not synthesize native summary activation, so use the repository's established keydown-plus-click test pattern rather than claiming keydown alone proves browser behavior.
- Focus remains on the card summary after toggling.
- Same tool identity/poll rerender retains a card the user opened; a replacement item identity starts with closed cards.
- Tab order follows DOM order: after the outer summary, Story 1.2's Raw button comes first when present; card summaries then follow in input order; the temporary Input/Output and full-output controls retain their relative positions afterward.

### Console selected room — `ConsoleNodeRoom.test.tsx`

Repeat the same OMP, Claude/no-agent, malformed, markdown-safety, nested-toggle, keyboard, polling, and identity cases through the selected Console room. Also prove that hiding tool calls hides their task bodies.

### Console inline history — `ConsoleExecutionHistory.test.tsx`

One OMP fixture is sufficient to prove the second Console mount receives the same body bar, context, and card count. Scope every `data-subtask-index` query inside its owning `details[data-tool-id]`; duplicate row-local indexes on one page are valid.

### Console boundary

Run `console-isolation.test.ts` unchanged. No Console file may import from `@/components/*` or `@/lib/api`.

## Implementation order

1. Complete the integration check and note the actual Story 1.2 state in the implementation report/PR.
2. Add Legacy static and interaction tests; confirm targeted failures.
3. Implement Legacy local helpers and body selection.
4. Add Console selected/inline tests; confirm targeted failures.
5. Implement the matching Console helpers without importing Legacy code.
6. Compare both DOM structures side by side and remove accidental wording/order differences.
7. Run all component/Console suites, isolation, lint, and type-check.

## Commands

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/
bun run test
bun run type-check

cd ../..
bun run lint
```

## Visual acceptance carried into Phase 3

Phase 2 is not complete merely because strings exist. The following must be measurable in the production DOM on both surfaces:

| State                      | Required evidence                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| OMP row closed             | `2 subagents` visible; single-line row                                                        |
| OMP row open, cards closed | exact batch bar, markdown context, two card summaries in order                                |
| OMP card open              | complete prompt in inset box; outer row still open                                            |
| Claude row/card            | exact single-dispatch bar, one card, no context; unknown agent remains readable               |
| Malformed row              | bounded generic fields, no partial subtask cards, no crash                                    |
| Reference/narrow/zoom      | Legacy 460px, Console 520px, 390px viewport, and 200% zoom without horizontal room overflow   |
| Keyboard/motion            | native disclosure semantics, visible focus, correct order, reduced-motion transition disabled |

## Exit criteria

- Both renderers consume presentation data verbatim and match in content/order.
- Every task/generic/static/interactive case above passes.
- Existing row, full-output, and Console-isolation tests remain green.
- No raw input parsing or provider branch exists in JSX.

## Risks and safeguards

- **Sibling merge conflict:** resolve to one readable-vs-Raw slot and rerun both stories' focused tests; do not keep duplicate body trees.
- **Nested toggle regression:** retain the current target/currentTarget guard and prove it through both interactive mounts.
- **Markdown beacon/script:** no raw HTML, suppress images, and assert link sanitization in tests and Playwright network observations.
- **Responsive overflow:** full prompt wraps; summary flex children shrink in defined order; Phase 3 checks actual scroll geometry.
- **Visual drift between shells:** duplicate markup is allowed only because of the enforced boundary; the same scenario matrix and Playwright measurements bind both copies.

## Handoff to Phase 3

Phase 3 must exercise the real built app with stored tool messages. Static React markup or a credential-dependent live Claude run is not sufficient proof.
