---
phase: 2
title: 'Phase 2: Legacy and Console renderers'
status: todo
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: Legacy and Console renderers

## Goal

Render `presentation.body` of kind `task` on both node-room surfaces — context markdown, one collapsible subtask card per entry, and the `N subtasks not shown` line — with identical anatomy, surface-specific tokens, and no change to the row, the toggle guard, the Input/Output bridge, or the full-output flow.

## Context links

- [plan.md](./plan.md) decisions: "Cards are nested native `<details>`", "Context renders as markdown", "Insertion point in both repository states".
- Legacy: `packages/web/src/components/workflows/NodeRoom.tsx` — `ToolHistory` `:314-476`; body container `:431`; body bar `:432-434`; bridge `:435-450`; toggle guard `:367-376`; markdown stack `:42-46` (`REMARK_PLUGINS`, `REHYPE_PLUGINS`, `MARKDOWN_COMPONENTS`) used at `:172`.
- Console: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — `ToolHistory` `:238-385`; body container `:340`; body bar `:341-343`; bridge `:344-359`; toggle guard `:286-295`; markdown stack `:35-38` used at `:105`. Boundary: `console-isolation.test.ts:7-14, :67-72`.
- Visual spec: `DESIGN.md:608-611` (card), `:248-254` (tokens), `:95-97` (`subtask-agent`), `:119` (`subcard-pad`), `:103` (radius); mockup `key-transcript-states.html:76-78, :293-311`.
- Behaviour: `EXPERIENCE.md:123` (Subtask card), `:340` (Flow 1).

## Deep-mode scout pass (run before editing)

1. `git log --oneline -3 -- packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` — has Story 1.2 (#175) merged?
2. If **not**: insert the task body between the body bar and the first nested `<details className="mt-1">` (Input) on both surfaces.
3. If **yes**: insert inside the Raw swap slot — `rawOpen ? <pre …raw…/> : <TaskBody …/>` — drop the bridge-related assertions from the tests below, and re-scope any 1.2 assertion of the form "no `<details>` inside a tool row" / `querySelectorAll('details').length === 0` to exclude `[data-subtask-index]` cards (1.2's fixtures are non-task rows, so they stay green, but the invariant text must say "no Input/Output disclosures", not "no nested details"). <!-- Updated: Red Team 2026-09-18 — finding F3 -->
3b. If **no** (this story lands first): the reciprocal note added to `plans/260918-1038-issue-175-raw-payload-toggle/plan.md` ("Coordination with Story 1.6") tells 1.2's implementer to keep `TaskBody`/`SubtaskCard` and rewire the one conditional into the swap slot. Confirm that note is still present. <!-- Updated: Red Team 2026-09-18 — finding F2 -->
4. Re-verify `presentation.badges` still feeds the body bar as `[family, ...facts]`; the `N subagents` badge from Phase 1 rides along with no renderer change.

## File inventory

| Path | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/web/src/components/workflows/NodeRoom.tsx` | Modify | +~70 lines (one `TaskBody` + one `SubtaskCard` local function) | `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx` |
| `packages/web/src/components/workflows/NodeRoom.test.tsx` | Modify | +~60 lines | static anatomy |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` | Modify | +~120 lines | interaction |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Modify | +~70 lines | `ConsoleNodeRoom.test.tsx`, `ConsoleExecutionHistory.test.tsx` |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Modify | +~120 lines | anatomy + interaction on the selected room |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify | +~25 lines | inline mount renders cards |
| `packages/web/src/experiments/console/console-isolation.test.ts` | Verify only | 0 | must stay green |

## Required DOM and interaction contract (both surfaces)

Inside the existing body container, immediately after the body bar:

```tsx
{presentation.body?.kind === 'task' ? <TaskBody body={presentation.body} /> : null}
```

`TaskBody` renders, in order:

1. **Context** — only when `body.context !== null`: a `<div>` with `ReactMarkdown` (`remarkPlugins={REMARK_PLUGINS}`, `rehypePlugins={REHYPE_PLUGINS}`, `components={CONTEXT_MARKDOWN_COMPONENTS}`), text-secondary, 11.5px, `mb-0.5`, `max-w-[78ch]`. Wrapped in the same `chat-markdown`-style class the assistant block uses so headings/lists inherit spacing. `CONTEXT_MARKDOWN_COMPONENTS = { ...MARKDOWN_COMPONENTS, img: () => null }` per surface: a dispatch brief is model-authored text that may echo untrusted content, and a markdown image would fire a network request the instant the row opens (an exfiltration beacon). Links keep the existing `a` override; `react-markdown` ^9 (`packages/web/package.json:43`) applies `defaultUrlTransform`, which blanks every scheme except `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`, so `javascript:` hrefs are already neutralized. <!-- Updated: Red Team 2026-09-18 — finding S1 -->
2. **Cards** — one `<details data-subtask-index={i}>` per `body.subtasks[i]`, keyed by index, uncontrolled (native open state, no React state — the card has no failure policy to drive). `data-subtask-index` is a **row-scoped** index, never a page-global id: `ConsoleAgentHistoryList` mounts twice on one page (`ConsoleInspectPane.tsx:264-266` inline history and `:313` selected room), so the same dispatch can render twice; no `id` attribute is emitted and no ARIA cross-reference needs one. Every test query for cards is scoped inside the row's `details[data-tool-id="…"]`, never page-wide. <!-- Updated: Red Team 2026-09-18 — finding F5 --> Its `<summary>`:
   - decorative chevron `▶` (`aria-hidden`, 9px column, 10px text, text-tertiary, `rotate-90` when open via `[details[open]>summary>&]` / group-open selector, 120ms transition, `motion-reduce:transition-none`);
   - `agent` span only when `agent !== null`: node-approval colour, weight 600, followed by a decorative ` · `;
   - `name` span in bold (`font-semibold`) only when `name !== ''`, followed by a decorative ` — ` when `excerpt !== ''`;
   - `excerpt` span in text-secondary, single line, `min-w-0 overflow-hidden text-ellipsis whitespace-nowrap`.
   - Summary styling: `flex min-h-[24px] cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden`, mono 11.5px, focus-visible 2px `--accent-bright` outline (Legacy offset −2px; Console offset +2px, mirroring the row summaries at `NodeRoom.tsx:386` / `ConsoleAgentHistoryList.tsx:312`).
   - Card box: `mt-[5px] rounded-[6px] border border-border bg-surface-elevated px-[9px] py-1.5` (`subcard-pad: 6px 9px`).
   - Open body: `<pre className="mt-1.5 rounded-[6px] border border-border bg-surface-inset px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-text-primary whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</pre>` — the body-box tokens the Raw box also uses.
3. **Not-shown lines** — after the cards, text-secondary 10.5px mono: when `body.unscanned > 0`, `${unscanned} subtask${unscanned === 1 ? '' : 's'} not shown`; when `body.dropped > 0`, `${dropped} malformed subtask${dropped === 1 ? '' : 's'} skipped`. Either, both, or neither. <!-- Updated: Red Team 2026-09-18 — findings S5/A3/F4 -->

Accessibility rules:

- The card summary's accessible name is `agent · name — excerpt` (bounded by Phase 1); the full `prompt` never appears in a `<summary>`, `title`, or `aria-label`.
- No `role`/`tabindex` shim on `<summary>`; native Enter/Space.
- Tab order: outer row summary → (its body controls in DOM order) → card 1 summary → card 2 summary → … → `View full output` (when present) → next row.
- Toggling a card must not reach the outer row's state: the existing guard `if (event.target !== event.currentTarget) return;` already handles it; rewrite that guard's comment to name subtask cards as the nested disclosure it protects against (Story 1.2's plan does the same edit — take theirs if it has landed).

Both surfaces implement the JSX independently (Console never imports from `@/components/`); the only shared code is the Phase 1 module. Console keeps its string-concatenated class style (no `cn`).

## Tests before (red first)

### Fixtures (add to each test file's helpers)

```ts
const OMP_DISPATCH = {
  context: 'Read-only. **Do not edit.**',
  tasks: [
    { name: 'ScoutBackoff', agent: 'scout', task: 'every call site of retry_backoff\nwith the argument range' },
    { name: 'ScoutCI', agent: 'scout', task: 'where CARGO_BUILD_JOBS is pinned' },
  ],
};
const CLAUDE_DISPATCH = { description: 'Scout retry-backoff call sites', prompt: 'Find every caller of retry_backoff()', subagent_type: 'Explore' };
const CLAUDE_NO_AGENT = { description: 'Scout', prompt: 'x' };
const MALFORMED_DISPATCH = { tasks: 'nope' };
```

Build items through `buildAgentHistory`/`toolRowPresentation` as the existing tests do, never by hand-writing `presentation`.

### `NodeRoom.test.tsx` (Legacy static, `renderToStaticMarkup`)

- Open task row with `OMP_DISPATCH`: markup contains the context rendered as markdown (`<strong>Do not edit.</strong>`), exactly two `data-subtask-index` cards, each summary text `scout · ScoutBackoff — every call site of retry_backoff…` / `scout · ScoutCI — where CARGO_BUILD_JOBS is pinned`; each card contains a `<pre>` with the full prompt; body bar text starts `task · 2 subagents`.
- `CLAUDE_DISPATCH`: no context block, exactly one card `Explore · Scout retry-backoff call sites — Find every caller of retry_backoff()`.
- `CLAUDE_NO_AGENT`: card summary is `Scout — x` with no leading `·`.
- `MALFORMED_DISPATCH`: zero cards, no context, no `subagent` badge; the bar and (pre-1.2) Input/Output bridge render as for any other row.
- Cap: a 70-element batch renders 64 cards, the text `6 subtasks not shown`, and the badge `70 subagents`.
- Malformed mix: `{ tasks: [valid, null, null] }` renders 1 card, `2 malformed subtasks skipped`, and the badge `1 subagent` (never `3 subagents`).
- A 5000-character single-line prompt yields a summary whose text is 160 characters plus `…` and a `<pre>` holding the full prompt.
- Full prompt appears only inside `<pre>`, never inside a `<summary>`.
- A non-task row (`Read`) renders no `data-subtask-index`.

### `LegacyNodeRoom.test.tsx` (happy-dom, interactive)

- Cards start closed; clicking a card summary opens it, reveals the `<pre>` prompt; clicking again closes it.
- Toggling a card does **not** mark the outer row touched: open row (untouched, `succeeded`), toggle a card, then rerender the same identity as `failed` → the outer row stays open only via the auto-open path and a subsequent close-by-user still works; mirror the structure of `:1281` "nested Input/Output toggles do not mark the outer row touched".
- Toggling a card never flips the outer `open` (assert `details[data-tool-id].open` unchanged before/after).
- Keyboard: focus a card summary, press Enter → opens; Space → closes; focus stays on the summary. happy-dom does not implement `<summary>`'s keydown→click activation, so dispatch the `keydown` **and** the synthetic `click` real browsers synthesize — copy the pattern at `LegacyNodeRoom.test.tsx:1156-1158` (and its Console twin in `ConsoleNodeRoom.test.tsx`). <!-- Updated: Red Team 2026-09-18 — finding A2 -->
- Identity reset: a new tool identity with a different dispatch renders its own cards closed.
- Polling re-render with the same identity preserves a card the user opened (native state survives because the `<details>` element is stable and keyed by index).

### `ConsoleNodeRoom.test.tsx` (selected room) — same static + interactive matrix

Same cases as the two Legacy files, adapted to the Console mount (`ConsoleNodeRoom` with `showToolCalls: true`). The `Tool` toggle hides cards together with their rows.

### `ConsoleExecutionHistory.test.tsx` (inline history mount)

- The inline mount renders the same cards for a task row (one case, OMP fixture, two cards), queried inside that row's `details[data-tool-id]`.

### `console-isolation.test.ts`

- Unchanged; run to prove Console imports only `@/lib/task-normalize` transitively through `@/lib/tool-presentation`.

Run and confirm red:

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx && NODE_ENV=development bun test src/experiments/console/
```

## Refactor (protected changes)

1. Legacy `NodeRoom.tsx`: add `SubtaskCard` and `TaskBody` local functions below `ToolBadge`; insert the one-line conditional after the body bar; update the toggle-guard comment.
2. Console `ConsoleAgentHistoryList.tsx`: same two functions in Console idiom; same insertion; same comment update.
3. Nothing else in either `ToolHistory` changes — no new state, no new props, no change to `loadFull`, `onToggle`, or the summary.

## Tests after

- Both component suites green; `console-isolation.test.ts` green; `bun run type-check` green; `bun run lint` zero warnings.
- Manually eyeball one Legacy and one Console task row in the dev server (Phase 3 records the evidence).

## Regression gate

```bash
cd packages/web && bun run test && bun run type-check && cd ../.. && bun run lint
```

## Test scenario matrix

| Priority | Scenario | Test |
| --- | --- | --- |
| Critical | OMP → context + 2 cards; Claude → 1 card, no context (AC1, AC2) | static tests, both surfaces |
| Critical | Card toggle isolated from outer row (touched/open) | interactive tests, both surfaces |
| Critical | Malformed → bar-only, no crash (AC3) | static tests, both surfaces |
| High | `agent: null` drops segment; `name: ''` drops segment | static tests |
| High | Full prompt only in `<pre>`; summary name bounded | static tests |
| High | Cap surfaced as `N subtasks not shown` | static tests |
| Medium | Keyboard Enter/Space, focus retention | Legacy + Console interactive |
| Medium | Identity reset, polling survival | interactive |
| Medium | Second Console mount | `ConsoleExecutionHistory.test.tsx` |

## Dependency map

- Consumes Phase 1's `presentation.body` and badge.
- Touches the same body regions as Story 1.2 (#175) — see scout pass above; the whole insertion is one conditional line per surface so the rebase is mechanical.
- Produces the DOM Phase 3 measures (`details[data-subtask-index]`).

## Todo

- [ ] Deep-mode scout pass done; insertion point chosen and noted in the PR; 1.2 coordination note verified (or 1.2's `no <details>` assertions re-scoped if 1.2 landed first).
- [ ] Red tests on Legacy (static + interactive).
- [ ] Red tests on Console (selected room + inline history).
- [ ] Implement Legacy `TaskBody`/`SubtaskCard`.
- [ ] Implement Console `TaskBody`/`SubtaskCard`.
- [ ] Toggle-guard comments updated on both surfaces.
- [ ] Regression gate green.

## Success criteria

Every scenario-matrix row passes on both surfaces; no `<summary>` contains a full prompt; the outer row's disclosure state machine tests from Story 1.1 still pass untouched.

## Risk assessment

- **Merge conflict with #175** — mitigated by the one-line insertion and the scout pass.
- **Nested `<details>` toggle bubbling** — already guarded; covered by a dedicated test on each surface.
- **Markdown in context renders headings that dwarf the card** — the context block reuses `MARKDOWN_COMPONENTS` and text-secondary at 11.5px; if a heading still dominates, override `h1–h3` to inline weight in the context wrapper only.
- **Long agent/name strings** — `name` and `agent` are provider identifiers; the summary is `overflow-hidden` with ellipsis on the excerpt span, and the name span gets `max-w-full truncate` so an adversarial name cannot push the chevron out.

## Security considerations

`ReactMarkdown` renders `context` through the same pipeline already used for assistant prose (no `rehype-raw`, no `dangerouslySetInnerHTML`), with two facts stated honestly: markdown link/image syntax **does** produce `href`/`src` attributes from payload text. `javascript:` and other non-allowlisted schemes are blanked by `react-markdown` ^9's default `urlTransform`; images are suppressed by the context-only `img: () => null` override so an expanded row never fires a network request on the reader's behalf. Prompts, names, agents, and excerpts render as React text nodes; none reach `title`, `aria-label`, or `id`. All strings are already capped by Phase 1. <!-- Updated: Red Team 2026-09-18 — finding S1 -->

## Next steps

Phase 3 measures and records; it also flips the sprint status.
