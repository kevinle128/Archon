---
phase: 3
title: 'Web operator rows in both shells'
status: pending
priority: P1
effort: '1 session'
dependencies: [2]
---

# Phase 3: web operator rows in both shells

## Goal

Teach the shared read model to recognise `origin: 'operator'` rows as a
distinct `operator` history item, and render that item in the Legacy node room
and the Console node room with an `operator · <name>` label, a literal `sent`
badge, and the operator's verbatim text at full strength — so the row can never
be read as assistant output and never passes through Markdown or envelope
unwrapping.

## Scout before executing

- `packages/web/src/lib/api.generated.d.ts` now carries `origin`,
  `operator_user_id`, and `operator_display_name` (Phase 2 regen). Confirm with
  `grep -n "operator_display_name\|origin?:" packages/web/src/lib/api.generated.d.ts`.
- `packages/web/src/lib/agent-history.ts`: the `AgentHistoryItem` union
  (`:27-61`, closing just before `export interface AgentHistory`),
  `presentedText` (`:103-119`), and the `message.kind === 'text'`
  push inside `buildAgentHistory` (`:330-339`).
- `packages/web/src/lib/agent-history.test.ts`: the `textRow(id, seq, text, metadata)`
  fixture helper and the `buildAgentHistory` `describe` (`:162`).
- Legacy shell `packages/web/src/components/workflows/NodeRoom.tsx`:
  `AssistantHistory` (`:246-267`), `LifecycleHistory` (`:269-281`), `renderItem`
  (`:1053-1078`), and the `lastRowMarker`/`lastRowRing` helpers (`:1043-1051`).
- Console shell
  `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`:
  `historyItemRowVisible` (`:53-60`), `AssistantHistory` (`:195-216`),
  `renderItem` (`:1000-1035`).
- Legacy tests render `NodeRoom` through `renderRoom`/`loadMessages` in
  `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` (`:962+`);
  Console tests assert on `host.textContent` in
  `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
  (`:1135-1240` exercise the `showToolCalls`/`showSystem` filters).
- Nothing else enumerates item kinds: `occurrence-groups.ts:155` reads only
  `lifecycle`; `ConsoleNodeRoom.tsx:685,856` and `NodeTranscriptPane.tsx:470`
  narrow only to `tool`.

## Files

| File | Action |
|------|--------|
| `packages/web/src/lib/agent-history.ts` | Add the `operator` union member and the `buildAgentHistory` branch. |
| `packages/web/src/lib/agent-history.test.ts` | Read-model tests (written first). |
| `packages/web/src/components/workflows/NodeRoom.tsx` | Add `OperatorHistory` and its `renderItem` branch. |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx` | Legacy render tests. |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Add `OperatorHistory` and the `renderItem` branch (`historyItemRowVisible` needs no change). |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Console render + filter tests. |

Do not touch `project-text-transcript.ts`, `pair-tool-transcript.ts`,
`occurrence-groups.ts`, the dock components, or `steering-dock.ts`.

## TDD sequence

### Step 1 — read model (red → green)

Tests in `agent-history.test.ts` inside `describe('buildAgentHistory')`:

- `projects an origin=operator text row as an operator item with verbatim text`
  — row `textRow('op-1', 4, '  fix the  **title** \n', { origin: 'operator', operator_user_id: 'user-a', message_id: 'uuid-1', execution: … })`
  plus the wire field `operator_display_name: 'Dale'` → item
  `{ kind: 'operator', id: 'op-1', seq: 4, role: 'operator', text: '  fix the  **title** \n', operatorUserId: 'user-a', operatorDisplayName: 'Dale', messageId: 'uuid-1', delivery: 'sent', execution }`.
- `never unwraps an operator row through the output_format envelope` — pass
  an `outputFormat` with one string property and an operator row whose text is
  exactly `{"summary":"x"}` → text stays `{"summary":"x"}`; a sibling assistant
  row with the same text is unwrapped to `x` (proves the branch order).
- `keeps a null identity and a missing display name as null` —
  `operator_user_id: null`, no `operator_display_name` → both nulls;
  `messageId` null when `message_id` is absent.
- `does not coalesce an operator row into adjacent assistant deltas` — delta,
  operator, delta with the same `message_id` on the deltas → three items in
  seq order, middle is `operator`.
- `leaves operator rows out of todo folding and keeps assistant items unchanged`
  — the existing first test's expectations hold with an operator row inserted.

Then implement in `agent-history.ts`:

```ts
| {
    kind: 'operator';
    id: string;
    seq: number;
    role: 'operator';
    /** The operator's prose, verbatim — never trimmed, unwrapped, or rendered as Markdown. */
    text: string;
    operatorUserId: string | null;
    /** Server-projected display name (users.display_name or short id); null when identity-less. */
    operatorDisplayName: string | null;
    /** Caller-stamped send id, the Story 2.11 reconciliation key. */
    messageId: string | null;
    /** Literal until gate G1 — no v1 provider advances a row to `delivered`. */
    delivery: 'sent';
    execution: TranscriptExecution | null;
  }
```

and in `buildAgentHistory`, before the assistant push:

```ts
if (message.kind === 'text' && message.metadata?.origin === 'operator') {
  items.push({
    kind: 'operator', id: message.id, seq: message.seq, role: 'operator',
    text: message.payload.text,
    operatorUserId: message.metadata.operator_user_id ?? null,
    operatorDisplayName: message.operator_display_name ?? null,
    messageId: message.metadata.message_id ?? null,
    delivery: 'sent',
    execution: message.metadata.execution ?? null,
  });
  continue;
}
```

`NodeMessageRow` is the generated `WorkflowNodeMessage` union; the first
conjunct `message.kind === 'text'` narrows `message` so
`message.operator_display_name` type-checks once Phase 2's regen puts the
field on the text variant. Scout note: `textRow(id, seq, body, metadata?)` in
`agent-history.test.ts:19-24` accepts only `metadata` — build the operator
fixture row by hand (or spread `{ ...textRow(...), operator_display_name }`)
for the tests that need the wire-level field.

Run: `cd packages/web && bun test src/lib/agent-history.test.ts`.

### Step 2 — Legacy shell (red → green)

Tests in `LegacyNodeRoom.test.tsx` `describe('LegacyNodeRoom dispatcher')`
after `drained tool calls mount as collapsed disclosure rows`:

- `renders an operator row with its role label, sender, sent badge, and verbatim text`
  — `loadMessages` returns an interrupted tool pair, an operator text row
  (`operator_display_name: 'Dale'`), then an assistant row; assert
  `host.querySelector('[data-operator-row]')` exists, its label element's
  `textContent` is `operator · Dale` (lowercase DOM), it contains an element
  with text `sent`, the body `textContent` equals the raw text including the
  double space and `**title**` (no `<strong>` rendered), and `document
  order` is tool → operator → assistant.
- `renders a bare operator label when the row has no identity` — no
  `operator_display_name` → label `operator`, no ` · `.
- `marks an operator row as the focusable last row` — operator row last →
  wrapper has `data-last-row` and `tabindex="-1"`.

Implement in `NodeRoom.tsx` next to `AssistantHistory`:

```tsx
function OperatorHistory({ item }: { item: Extract<AgentHistoryItem, { kind: 'operator' }> }) {
  return (
    <div data-operator-row="" className="max-w-none text-sm" style={{ overflowWrap: 'anywhere' }}>
      <div className="mb-1 flex items-center gap-2 text-[9.5px] tracking-[0.06em] text-text-tertiary">
        <span data-operator-label="">
          <span className="uppercase">operator</span>
          {item.operatorDisplayName !== null ? ` · ${item.operatorDisplayName}` : ''}
        </span>
        <span
          data-operator-delivery=""
          className="rounded-sm border border-border px-1 uppercase text-text-secondary"
        >
          {item.delivery}
        </span>
      </div>
      <p className="whitespace-pre-wrap font-medium text-text-primary">{item.text}</p>
    </div>
  );
}
```

and a `renderItem` branch mirroring the assistant one (same `my-1.5`, ring,
marker, and `renderAfterItem` treatment). Use only existing tokens
(`text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `border-border`)
— no new colours.

Run: `cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx`.

### Step 3 — Console shell (red → green)

Tests in `ConsoleNodeRoom.test.tsx` near the filter tests (`:1135-1240`):

- `renders an operator row with label, sender, sent badge, and verbatim text on Console`
  — same assertions as Legacy through `host`.
- `keeps operator rows visible when tool calls and system rows are hidden` —
  `showToolCalls: false, showSystem: false` → `[data-operator-row]` still
  present while the tool row and lifecycle text are absent. This is the only
  visibility test: `historyItemRowVisible` (`:53-60`) already returns `true`
  for every kind other than `tool`/`lifecycle`, so no code change there.

Implement in `ConsoleAgentHistoryList.tsx`: the same `OperatorHistory`
component (Console uses the same token classes; keep the two copies local to
each shell exactly as `AssistantHistory` is today) and the `renderItem`
branch. Leave `historyItemRowVisible` untouched.

Run: `cd packages/web && NODE_ENV=development bun test src/experiments/console/`.

## Verification

```bash
cd packages/web
bun test src/lib/
NODE_ENV=development bun test src/components/
NODE_ENV=development bun test src/experiments/console/
cd ../.. && bun run type-check && bun run lint
```

## Success criteria

- [ ] Five read-model tests green; existing `buildAgentHistory` tests unchanged.
- [ ] Legacy: three render tests green; DOM role text is lowercase `operator`.
- [ ] Console: two render tests green, including visibility under both
      filters off.
- [ ] `bun run type-check` proves the union is exhaustive where narrowed
      (`renderItem` in both shells compiles without a fallthrough cast).
- [ ] No new colour, font, or spacing tokens introduced.

## Risks and rollback

Purely additive UI. If the renderers were reverted while Phase 1's executor
write stayed, an `operator` item would fall through both shells' final
`renderItem` block into `LifecycleHistory` (`NodeRoom.tsx:1070-1075`) — a
bare system-style row with no attribution and, since `LifecycleHistory` reads
`item.state`, no text at all. That is a silently lost receipt rather than
assistant-looking prose, and still violates the spec's cross-half rule, so a
rollback of Phase 3 must accompany a rollback of Phase 1's executor write.
