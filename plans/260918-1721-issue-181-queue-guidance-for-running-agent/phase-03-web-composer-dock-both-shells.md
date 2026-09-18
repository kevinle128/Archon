---
phase: 3
title: 'Web: Queue composer dock in both shells'
status: pending
priority: P1
effort: '6h'
dependencies: [2]
---

# Phase 3: Web: Queue composer dock in both shells

## Outcome

Both node rooms (Legacy `NodeTranscriptPane` and Console `ConsoleNodeRoom`) mount a composer dock pinned to the bottom of the node panel while the node is `running` or `awaiting`. In the `generating` state the field is enabled, the send control reads `Queue`, `Cmd`/`Ctrl`+`Enter` submits, plain `Enter` inserts a newline, accepted messages show in a `QUEUED · n` band in receipt order with the word `sent`, and the unsent draft is labelled `this tab only`. A pending ask for this node makes Send `aria-disabled` with `answer the agent's question first` via `aria-describedby`, and the shortcut uses the same guard. A running node with no live handle shows only the disclosure line. Shared logic lives in `packages/web/src/lib/steering-dock.ts`; the JSX is written twice, thin.

Cook-time scout: re-read `NodeTranscriptPane.tsx` (`RoomRegion scrollable={false}` return block), `ConsoleNodeRoom.tsx` (local `RoomRegion`, `rowStatus`, `pendingInteractions` filter), `ask-answer-controller.ts` in both shells, and `console-isolation.test.ts`'s approved-lib allowlist.

## Context links

- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` lines 89-94 (copy table), 128-140 (dock anatomy), 178 (ask-parked node), 184 (draft is per tab), 187 (state 8), 204-206 (shortcut and queue scope), 241-250 (live region, focus, accessible name, uppercase via CSS).
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` lines 298-354 (dock spacing, field, controls), 365-383 (draft box), 475-481 (contrast), 495-501 (focus ring), 624-651 (state table).
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/review-accessibility-steering.md` (serialized polite region, `aria-disabled` never `disabled`, shortcut gate, reduced motion).
- `plans/reports/scout-260919-0007-web-dock-and-e2e.md` (mount points `NodeTranscriptPane.tsx:406-428`, `ConsoleNodeRoom.tsx:883-905`; pollers; `ApprovalPanel.tsx:116` shortcut precedent; `motion-reduce:` precedent; `aria-describedby` id convention).
- `plans/reports/scout-260919-0007-ux-dock-generating-state.md`.

## Shared logic (`packages/web/src/lib/steering-dock.ts`)

Framework-free; add `@/lib/steering-dock` to the Console approved-lib allowlist in `console-isolation.test.ts`.

```ts
export type DockVisibility = 'hidden' | 'disclosure' | 'composer';
export interface DockInputs {
  rowStatus: 'pending' | 'running' | 'awaiting' | 'completed' | 'failed' | 'skipped';
  hasPendingAskForNode: boolean;
  steerable: boolean | null;   // null until the first queue read
}
export function selectDockVisibility(i: DockInputs): DockVisibility;
// running|awaiting → 'composer' unless (running && steerable === false && !hasPendingAskForNode) → 'disclosure'; else 'hidden'
export function selectSendBlock(i: DockInputs): { blocked: boolean; reason: string | null };
// hasPendingAskForNode || rowStatus === 'awaiting' → { blocked: true, reason: 'answer the agent\'s question first' }
export function isSubmitShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean }): boolean;
export function formatQueuedHeader(n: number): string;          // 'queued · 3' (CSS uppercases)
export function formatQueuedAnnouncement(n: number): string;    // '3 messages pending delivery' / '1 message pending delivery'
export const DISCLOSURE_NOT_STEERABLE = "not steerable here · this node's live session is not in this server process";
export function draftStorageKey(runId: string, nodeId: string): string; // 'archon:steer-draft:<runId>:<nodeId>' (sessionStorage — per tab)
export function newMessageId(): string; // crypto.randomUUID()

export interface SteeringDockDeps {
  send(runId: string, nodeId: string, body: { message: string; message_id: string; intent: 'queue' }): Promise<{ success: true; message_id: string; state: string }>;
  fetchQueue(runId: string, nodeId: string): Promise<{ steerable: boolean; queued: QueuedItem[] }>;
}
export class SteeringDockController {
  constructor(deps: SteeringDockDeps, runId: string, nodeId: string, onChange: (s: DockState) => void);
  state: DockState; // { queued: QueuedItem[]; steerable: boolean | null; inFlight: boolean; lastError: { code: string; message: string } | null }
  queue(text: string): Promise<'accepted' | 'refused'>; // trims, stamps id, dedupes concurrent submits, optimistic append, reconciles on refetch
  refresh(): Promise<void>;                             // GET …/queue; replaces `queued`, sets `steerable`
  dispose(): void;
}
```

Behavior rules:

- `queue()` refuses (returns `'refused'`, no request) when the text trims to empty or a submit is in flight. On 200 it appends the receipt optimistically and triggers `refresh()`; on any error it restores the text to the composer (front of the draft) and records `lastError` for the `role="alert"`.
- `refresh()` carries a monotonic request counter and discards any response that is not the latest issued, so a timer-triggered GET that resolves after a send-triggered GET cannot regress `queued` and make a just-sent message vanish for a tick. <!-- Updated: Red Team Session 1 -->
- Poll cadence: 1000 ms while `steerable` is `true` or `null`; 3000 ms once `steerable === false` (detached/parked nodes cost a server-side event projection per miss).
- A parked node (pending ask) shows the still-queued messages returned by `GET …/queue` under `QUEUED · n` with Send blocked — they were accepted and will drain after the answer.
- Pending-ask precedence: `selectDockVisibility` returns `'composer'` (with Send blocked) for an ask-parked node even though the server would say `steerable: false` — the ask reason wins over the disclosure (EXPERIENCE.md:178).
- Message ids are stamped once per submit and retried with the same id (idempotent).

API helpers: `sendNodeGuidance(runId, nodeId, body)` and `getNodeQueue(runId, nodeId)` in `packages/web/src/lib/api.ts` (Legacy, via `fetchJSON`) and the same two in `packages/web/src/experiments/console/skills/runs.ts` (Console, via `requestJson`), typed from `api.generated`.

## Renderers

Legacy `packages/web/src/components/workflows/ComposerDock.tsx` and Console `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`; each owns a 1000 ms `refresh()` loop while `rowStatus` is `running`/`awaiting` (same `setTimeout` shape as the message drain loop) and disposes on unmount or node change.

Anatomy (both shells, tokens only):

- Container: `flex-none`, last child of `RoomRegion`, `bg-surface-elevated`, top `border-border`, padding 8px 10px, gap 6px, `data-testid="composer-dock"`.
- Disclosure state: one line of `text-text-secondary` text, `DISCLOSURE_NOT_STEERABLE`, no field, no controls.
- Draft box (only when `queued.length > 0`): header `queued · n` as lowercase DOM text with `uppercase tracking-[0.07em] text-[10px] font-bold text-text-secondary`; list items in receipt order, `text-text-secondary`, each with the word `sent` (no dot), min 24 px rows, scrolls internally past `33vh`; no per-item controls in 2.1 (D12).
- Field: `<textarea>` with a visually hidden `<label>` `message to <nodeId>` (accessible name states the node), `min-h-[56px]`, sans, `bg-surface-inset`, 6 px radius, focus ring `outline-2 outline-accent-bright`; a hint line `Cmd/Ctrl+Enter to send · this tab only` in `text-text-secondary` (the `this tab only` label attaches to the unsent draft only).
- Send control: `<button type="button">` bordered (`border-border-bright`, transparent fill, `text-text-primary`, weight 500, 11.5 px, `min-h-[32px] min-w-[84px]`, right edge), visible text `Queue` first in the accessible name, `aria-keyshortcuts="Meta+Enter Control+Enter"`; when blocked: `aria-disabled="true"` (never `disabled`), dimmed to `text-text-secondary`, `aria-describedby` pointing at a `<p id={`${useId()}:send-blocked-reason`}>` with the reason text; click and shortcut are no-ops while blocked (same predicate).
- Live regions: one `role="status"` polite region per dock announcing `formatQueuedAnnouncement(n)` when the count changes; one `role="alert"` for a refused/failed send (`could not queue · <message>`).
- Keyboard: `onKeyDown` — `isSubmitShortcut(e)` and not blocked → `preventDefault` and `queue(text)`; plain `Enter` is untouched (native newline); IME-composing guard (`e.nativeEvent.isComposing || keyCode === 229`).
- Focus: after a successful queue, focus stays in the textarea and it is cleared; never programmatic focus to `<body>`.
- Motion: no animation is introduced; any transition added later uses `motion-reduce:transition-none`.
- Draft persistence: `sessionStorage` under `draftStorageKey`; read on mount, write on change, clear on successful queue.

Mount points:

- Legacy: in `NodeTranscriptPane.tsx`'s `<RoomRegion nodeId={row.nodeId} scrollable={false}>` return, after `{jumpButton}`; props `runId`, `nodeId={row.nodeId}`, `rowStatus`, `hasPendingAskForNode` derived from the existing `selectVisibleNodeAskInteractions(...)` result having any `status === 'pending'`.
- Console: in `ConsoleNodeRoom.tsx`'s local `RoomRegion`, after the `Jump to latest` button; same props from `run.id`, `nodeId`, `rowStatus`, and Console's `select-visible-node-ask-interactions`.
- Non-live executions (a different run selected) never mount the dock — `rowStatus` there is terminal.

## Tests before (red first)

`packages/web/src/lib/steering-dock.test.ts`:

- visibility table: every `rowStatus` × `steerable` × `hasPendingAsk` combination (pending/completed/failed/skipped → hidden; running+false+noAsk → disclosure; running+null → composer; awaiting → composer blocked; running+false+ask → composer blocked).
- `isSubmitShortcut`: Meta+Enter and Ctrl+Enter true; plain Enter, Shift+Enter, composing false.
- header/announcement formatting incl. singular.
- controller: `queue('')` refused without a call; double submit while in flight makes one request; success appends receipt then refresh replaces list; failure restores text and sets `lastError`; ids are uuids and stable across retry; `refresh` sets `steerable`; `dispose` stops loops; an older in-flight `refresh` resolving after a newer one is discarded (counter); cadence is 1000 ms then 3000 ms after `steerable: false`.

`ComposerDock.test.tsx` (Legacy) and `ConsoleComposerDock.test.tsx` (Console), each with happy-dom (`installHappyDom` helper on Console; inline `Window` on Legacy) and a stubbed deps object:

- generating: field enabled, button text starts with `Queue`, accessible name contains the shortcut, `this tab only` present, no Stop control, no per-item delete.
- Cmd+Enter and Ctrl+Enter dispatch a send with `intent: 'queue'`; plain Enter does not and the textarea value gains a newline.
- after send: draft box header text `queued · 1`, item text and `sent` word present, textarea empty, `document.activeElement` is the textarea, `role="status"` text is `1 message pending delivery`.
- two sends keep order; a refetch that drops the first (drained) renders `queued · 1` with the second.
- blocked (ask): `aria-disabled="true"`, no `disabled` attribute, `aria-describedby` resolves to the reason text, click and Cmd+Enter make no request.
- disclosure: exact `DISCLOSURE_NOT_STEERABLE` text, no textarea, no button.
- hidden: nothing rendered for a completed node.
- failure: send rejects → textarea restored to the text, `role="alert"` rendered.
- `sessionStorage` round-trip of the draft.
- uppercase is CSS: DOM text is `queued · 1`, class list contains `uppercase`.

Shell mount tests (`NodeTranscriptPane.test.tsx`, `ConsoleNodeRoom.test.tsx`): dock present for a running row, absent for a completed row, inside the room landmark as the last child, Send blocked when the room has a pending ask for that node.

`console-isolation.test.ts`: add `components/ConsoleComposerDock.tsx` to the `roomFiles` array **and** `@/lib/steering-dock` to the `approved` set — the first test only forbids `@/lib/api`, `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`; the positive allowlist test scans only the files listed in `roomFiles`, so a new file that is not listed is never checked. <!-- Updated: Red Team Session 1 -->

## Refactor (protected changes)

- `NodeTranscriptPane` and `ConsoleNodeRoom` gain only the mount and the two derived props; their scroll, follow, todo strip, and ask-card behaviour is untouched (existing tests stay green).

## Tests after

- `bun run --cwd packages/web type-check` and `lint`; all `src/components/` and `src/experiments/console/` suites green.
- Manual check at 460 px (Legacy) and the Console panel width: the scroller scrolls behind the dock; the dock never wraps its control off-screen.

## Regression gate

```bash
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check && bun run lint)
```

## Test scenario matrix

| Path | Priority | Case |
|------|----------|------|
| Queue press → receipt | Critical | 200 → band, focus stays, status announcement |
| Shortcut guard | Critical | Cmd/Ctrl+Enter sends; plain Enter newline; blocked → no-op |
| Ask block | Critical | `aria-disabled` + `aria-describedby`, no `disabled` |
| Drain reflected | High | refetch drops delivered item, count updates |
| Disclosure | High | exact copy, no controls |
| Failure path | High | text restored, alert |
| Boundary | Medium | Console isolation allowlist |
| Draft persistence | Medium | sessionStorage per tab |

## Todo

- [ ] `steering-dock.ts` + tests
- [ ] api helpers (Legacy + Console)
- [ ] `ComposerDock.tsx` + tests; mount in `NodeTranscriptPane`
- [ ] `ConsoleComposerDock.tsx` + tests; mount in `ConsoleNodeRoom`; allowlist
- [ ] shell mount tests; suites green; type-check/lint clean

## Success criteria

Story 2.1's dock acceptance criteria (composer enabled, `Queue`, `QUEUED · n`, `this tab only`, shortcut, ask block with reason, reduced motion) each have a passing component test in both shells.

## Risk assessment

- **Two renderers drift**: the shared predicates keep semantics identical; the two test files assert the same table.
- **Polling cost**: one extra 1000 ms GET per open live node room; stops when the node leaves `running`/`awaiting`.
- **Optimistic vs server order**: the server snapshot always wins on refresh.

## Security considerations

The dock sends operator prose to a route that already applies the actor grant; no secrets are stored; `sessionStorage` holds only the unsent draft.

## Next steps

Phase 4 proves the loop end to end and collects visual/a11y evidence.
