---
phase: 2
title: 'Web read model and both shell renderers'
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: web read model and both shell renderers

## Goal

Make the web reader understand an operator row before the executor emits one,
then render it consistently in Legacy and Console using the final approved
design. Correct the paired assistant treatment required to distinguish human
prose from agent prose without relying on color.

## Design authority

The final `DESIGN.md`, `EXPERIENCE.md`, canonical
`mockups/key-steering-dock.html`, and both shipping-surface prototypes in
`claude-design/design_handoff_node_room_transcript_steering/` agree on the
relevant anatomy. The handoff README makes `DESIGN.md` authoritative wherever
a prototype differs:

- operator and assistant prose are sans, 12.5px, line-height 1.55;
- assistant prose is text-secondary; operator prose is text-primary;
- both role labels are 10px, tracking 0.07em, text-secondary, and lowercase DOM
  text transformed to uppercase by CSS;
- `sent` is 11px text-secondary, lowercase and right-aligned on the role line;
- there is no operator bubble, border, status pill, avatar, or role hue;
- 460px is the authoritative narrow room width; the transcript declares no
  responsive breakpoint.

The previous draft's 9.5px tertiary label, `text-sm` body, medium weight, and
bordered uppercase status pill are not approved and must not be implemented.

## Files

| File                                                                                  | Change                                                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/web/src/lib/agent-history.ts`                                               | Add the render-neutral operator item and projection branch.                             |
| `packages/web/src/lib/agent-history.test.ts`                                          | Prove verbatim projection, compatibility fallback, and isolation from other transforms. |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                  | Add Legacy operator renderer/branch and align assistant anatomy.                        |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                       | Assert semantics, exact tokens/classes, ordering, escaping, and last-row behavior.      |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Add Console operator renderer/branch and align assistant anatomy.                       |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`            | Assert parity and visibility under filters.                                             |

Do not change `project-text-transcript.ts`, `pair-tool-transcript.ts`,
`occurrence-groups.ts`, steering dock state, or create a cross-shell component.
The architecture intentionally keeps the two thin DOM renderers local.

## Implementation sequence

### 1. Add the shared operator item first

Extend `AgentHistoryItem` with one explicit member:

```ts
{
  kind: 'operator';
  id: string;
  seq: number;
  role: 'operator';
  text: string;
  operatorUserId: string | null;
  operatorDisplayName: string | null;
  messageId: string | null;
  delivery: 'sent';
  execution: TranscriptExecution | null;
}
```

Inside `buildAgentHistory`, after tool-card handling but before the generic text
branch, recognize `message.kind === 'text' &&
message.metadata?.origin === 'operator'`. Map:

- `text` directly from `message.payload.text` with no trim or transform;
- `operatorUserId` from metadata or null;
- `operatorDisplayName` from a non-blank response field, otherwise the first
  eight characters of a non-null sender id, otherwise null;
- `messageId` and execution scope from metadata or null;
- `delivery: 'sent'` as a literal.

The short-id fallback is compatibility defense, not a client join. It performs
no request and should normally be redundant with Phase 1's server projection.

Write read-model tests before implementation:

- verbatim leading/trailing whitespace, repeated spaces, newline, and Markdown
  markers survive;
- a one-property `output_format` envelope stays serialized for the operator
  while an adjacent assistant row is still presented normally;
- response display name wins, blank/missing response falls back to eight id
  characters, and null identity stays null;
- `message_id` and execution scope survive;
- an operator row between assistant deltas is a separate item in `seq` order;
- todo folding ignores operator prose and existing assistant/tool expectations
  remain unchanged.

The test helper's optional argument populates metadata, not the top-level wire
field. Build the enriched fixture explicitly or spread the helper row and add
`operator_display_name`; do not hide the response shape in an unsafe cast.

### 2. Implement the Legacy renderer and paired assistant correction

Add an `OperatorHistory` component beside `AssistantHistory` and an explicit
`item.kind === 'operator'` branch before the final lifecycle branch. Reuse the
existing row wrapper, focus ring, `data-last-row`, and `renderAfterItem`
behavior.

Required DOM/tokens:

- wrapper: `data-operator-row`, safe `overflow-wrap: anywhere`;
- role line: flex, full width, 10px, tracking 0.07em, uppercase transform,
  text-secondary, with the high-fidelity `10px 2px 3px` margins;
- label: `data-operator-label`, text node `operator` plus
  ` · ${operatorDisplayName}` only when non-null;
- status: `data-operator-delivery`, `margin-left: auto`, `flex-shrink: 0`,
  11px, normal case, normal tracking, text-secondary, literal `sent`;
- body: `data-operator-body`, `font-sans`, 12.5px, line-height 1.55,
  normal weight, text-primary, `whitespace-pre-wrap`, and `0 2px 6px`
  margins; render `{item.text}` directly rather than `ReactMarkdown`.

Update the existing `AssistantHistory` in the same file to lowercase DOM
`assistant`, a 10px/0.07em text-secondary role line, and
12.5px/1.55 text-secondary body. Keep its existing Markdown behavior; only
operator prose is plain text.

Legacy component tests must prove:

- label, right-aligned lowercase `sent`, raw body text, and no `<strong>`,
  `<img>`, or other element created from operator input;
- display names containing markup-like text are escaped and remain text;
- tool/interrupted -> operator -> assistant document order via
  `compareDocumentPosition`, not screen coordinates;
- null identity renders exactly `operator`, with no separator;
- operator as the final item keeps `data-last-row` and `tabindex=-1`;
- class/token assertions encode the approved size, line height, weight,
  strengths, casing mechanism, and lack of border/pill;
- assistant label source is lowercase and its body uses text-secondary.

### 3. Mirror the renderer in Console

Add the same local `OperatorHistory` and explicit render branch to
`ConsoleAgentHistoryList.tsx`, and apply the same assistant correction.

Do not modify `historyItemRowVisible`: it intentionally returns true for every
kind other than tool/lifecycle, so the new operator kind is already visible
when `showToolCalls` and `showSystem` are false. Add a component assertion for
that behavior rather than dead code.

Console tests repeat the contract-bearing DOM/class assertions rather than
assuming Legacy coverage proves a separately implemented renderer. Also put an
operator item last under hidden filters and prove focus-marker selection still
uses it.

### 4. Review every item-kind consumer

Run a repository search for `AgentHistoryItem`, `item.kind`, and explicit
assistant/tool/lifecycle switches after adding the union member. The current
known indirect consumers (`occurrence-groups`, transcript panes, and filter
logic) either use ids/execution or narrow only the kind they need, but the
type-check—not the draft—is authoritative. Add no branch where the current
fallback semantics are already correct.

## Focused verification

```bash
cd packages/web
bun test src/lib/agent-history.test.ts
NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx
bun run type-check
cd ../.. && bun run lint --max-warnings 0
```

Then run the package's normal isolated test script to catch another item-kind
consumer:

```bash
bun --filter @archon/web test
```

## Visual acceptance to carry into Phase 4

For each surface at 460x900 and 1440x900:

- role line reads `operator · e2e-starter` in source text, visually using the
  uppercase label treatment; `sent` remains lowercase at the right edge;
- role/status remain on one line while a long name or body wraps safely;
- body computed style is 12.5px, line-height approximately 19.375px (1.55),
  normal weight, sans, text-primary;
- adjacent assistant body is the same size/line height but text-secondary;
- long multiline text preserves line breaks, introduces no horizontal room
  overflow, and remains fully copyable;
- no transcript breakpoint, bubble, border, badge pill, or new color appears.

## Exit criteria

- The shared history core can no longer interpret an operator row as assistant
  output.
- Both shells have explicit, parity-tested operator branches.
- Operator input is escaped plain text and is never Markdown-rendered.
- The assistant correction supplies the required second authorship channel.
- The full web type-check and isolated package tests pass before Phase 3 turns
  on the writer.

## Rollback note

This phase is additive until the writer lands. After Phase 3, reverting these
branches alone would route the new union member into the lifecycle fallback and
hide its prose. Roll back the executor writer at the same time, while retaining
the widened metadata schema for persisted rows.
