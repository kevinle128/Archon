---
phase: 3
title: 'Web: Queue composer dock in both shells'
status: pending
priority: P1
dependencies: [2]
---

# Phase 3: Web Queue dock in both shells

## Outcome

Legacy and Console node rooms render the Story 2.1 composer while the selected live agent node is generating. The operator can queue non-blank guidance by button or guarded shortcut, immediately see accepted receipts in order under `QUEUED · n`, and continue typing without disturbing the current turn. Ask-paused nodes keep the dock visible but block submission with an accessible reason. A canonical 422 replaces the dock with the adopted detached disclosure.

This phase uses the POST response as its only queue evidence. It does not add polling, queue rehydration, cross-tab convergence, delivered state, terminal `NEVER SENT`, Stop, or per-item delete controls.

## Files

| File                                                                           | Change                                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/web/src/lib/api.ts`                                                  | Add typed Legacy `sendNodeGuidance`.                                       |
| `packages/web/src/lib/steering-dock.ts`                                        | New framework-free state/predicate/shortcut helpers.                       |
| `packages/web/src/lib/steering-dock.test.ts`                                   | State reducer, idempotent retry, and shortcut tests.                       |
| `packages/web/src/components/workflows/ComposerDock.tsx`                       | New Legacy renderer.                                                       |
| `packages/web/src/components/workflows/ComposerDock.test.tsx`                  | Legacy interaction/accessibility tests.                                    |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                 | Mount the full-bleed band/dock after the transcript scroller/jump control. |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`            | Visibility, position, and ask wiring.                                      |
| `packages/web/src/experiments/console/skills/runs.ts`                          | Add typed Console send helper through the approved request layer.          |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`      | New Console renderer.                                                      |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | Console interaction/accessibility tests.                                   |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`          | Mount the band/dock in the same flex position.                             |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`     | Visibility, position, and ask wiring.                                      |
| `packages/web/src/experiments/console/console-isolation.test.ts`               | Add the new room file and approve only the shared steering helper import.  |

Use the regenerated declarations from Phase 2. `@archon/web` must not import runtime values from server or workflows packages.

## Shared state and submission behavior

Keep transport injection framework-free so both shell renderers use identical rules while retaining their package boundaries.

Suggested state:

```ts
interface LocalSentReceipt {
  readonly messageId: string;
  readonly message: string;
  readonly state: 'queued';
}

interface PendingSubmission {
  readonly messageId: string;
  readonly message: string;
}

interface SteeringDockState {
  readonly sent: readonly LocalSentReceipt[];
  readonly inFlight: boolean;
  readonly pendingRetry: PendingSubmission | null;
  readonly refusal: { code: string; message: string } | null;
}
```

Required behavior:

- Reject blank-only drafts locally without a request, but send the original non-blank string unchanged.
- Allow one request at a time. Button and shortcut call the same guarded action.
- Stamp a UUID once per submission. If the response is lost or a request fails ambiguously, preserve the text and id; retrying unchanged text reuses that id. Editing the draft creates a new submission/id.
- On 200, append once by `message_id`, in successful acceptance order; clear the draft and pending retry; keep focus in the textarea. A replayed success must not duplicate the local row.
- Keep local `sent` receipts for the mounted live room. Do not remove them based on time or infer delivery. Clear them only when the component changes execution/unmounts; Story 2.9 will replace this with authoritative queue projection.
- Persist the unsent draft and ambiguous retry id in `sessionStorage`, scoped by run and namespaced node id. Do not persist accepted queue items in browser storage.
- Render operator text as an ordinary escaped React text node with end elision; never feed it to Markdown, HTML, or `dangerouslySetInnerHTML`.
- On 422 `not_steerable_here`, preserve the draft/retry data and switch to detached disclosure. On 409 or another failure, preserve the field text and announce the error; terminal read-only reconciliation belongs to Story 2.11.
- A pending ask or `awaiting` row blocks send before transport. The exact reason is `answer the agent's question first`. A sibling node's ask must not block this node.
- A terminal/unknown selected execution renders no dock. A non-live historical execution must never issue a steering request.

Expose small pure helpers for visibility, blocked reason, storage key, header/count wording, announcement wording, and shortcut detection. Avoid a polling controller and request-race counters because there is no read request in this story.

## API helpers

Add only `sendNodeGuidance(runId, nodeId, body)`:

- Legacy uses the existing `fetchJSON` layer in `lib/api.ts`;
- Console uses its approved `requestJson` path in `experiments/console/skills/runs.ts`;
- both return the generated success type and surface the nested steering `status/code/message` in a typed error the component can distinguish;
- neither retries automatically (the caller controls UUID reuse) nor logs the message.

## Layout and visual contract

Final `EXPERIENCE.md`/`DESIGN.md` override older co-located mock details.

### Placement

- Keep each `RoomRegion` a flex column. The transcript scroller remains the flexible child. Render the full-width queue band, when non-empty, immediately above the composer dock and outside the dock's padded column; render the dock as the final fixed sibling. It must reduce the transcript viewport, never overlay transcript rows.
- Preserve the todo strip, transcript follow/jump behavior, focused-row scroll position, ask card, and shell-specific framing.

### Queue band

- Do not render an empty band.
- Full-bleed `surface-elevated`, one-pixel top rule, using the todo strip's header idiom and item geometry; it is not an inset rounded well.
- Lowercase DOM header `queued · n` with CSS uppercase, phase-label tracking/weight, and text-secondary.
- A labelled list named `Queued messages, n`; one list item per local accepted receipt in order; each item includes the visible word `sent`, never a color-only indicator.
- Internal scrolling above `33vh`; rows stay compact and readable. There are no delete/keep controls in Story 2.1.
- `this tab only` never labels this band; it applies only to unsubmitted draft text.

### Composer and controls

- Dock: fixed bottom sibling, `surface-elevated`, top border, design-token padding/gap.
- Textarea: real label `message to <node name or id>`, sans body text, `surface-inset`, border, medium radius, at least 56px high, and the shell's documented high-contrast focus ring.
- Hint: `Cmd/Ctrl+Enter to send · this tab only` in text-secondary.
- Queue control: bordered/transparent in **both** shells, right aligned, at least 32px high and 84px wide, text-primary, visible label `Queue`. Its accessible name starts with `Queue` and includes the shortcut and current waiting count; set `aria-keyshortcuts="Meta+Enter Control+Enter"`.
- No Stop control and no per-item delete control.
- Ask-blocked Queue remains focusable with `aria-disabled="true"` (not native `disabled`), text-secondary as the contrast floor, and `aria-describedby` pointing to the exact visible reason. Click and shortcut use the same no-op guard.

### Keyboard, focus, status, and motion

- `Cmd`/`Ctrl`+`Enter` submits only when non-blank, not blocked, not in flight, and not composing. Guard both `nativeEvent.isComposing` and key code 229.
- Plain Enter and Shift+Enter retain native newline behavior.
- Successful send clears the textarea but leaves focus there. A rejected send never sends focus to `<body>`.
- Use one polite `role="status"` region per node room for queue-count changes; use `role="alert"` for a failed/refused submission. Do not create one live region per list item.
- Add no animation. Any incidental transition must honor reduced motion.

### Detached disclosure

After a canonical 422, replace the band, field, hint, and controls with the final adopted line exactly:

`not steerable here · this run was started detached, so its live session is not in this process`

Use text-secondary and preserve the draft/retry in tab-local storage. Proactive discovery before the first POST is not possible without the Story 2.9 read contract; do not invent one.

## Mounting rules

- Legacy: mount after the existing jump-to-latest control in `NodeTranscriptPane`'s `RoomRegion`. Pass `runId`, namespaced `row.nodeId`, row status, display label, and whether `selectVisibleNodeAskInteractions(...)` has a pending ask for this exact node.
- Console: mount in the analogous position in `ConsoleNodeRoom` using its existing filtered pending-interaction data and request helper.
- Show composer for `running`; show it blocked for this node's `awaiting`/pending-ask state; hide it for pending-not-started, completed, failed, skipped, cold/unknown, or a historical non-live execution.
- The post-422 disclosure has precedence over generating composer state. A real pending ask has its blocked reason rather than detached copy because no request should have been made from that state.

## Tests first

### Shared logic

- visibility table for all row statuses, same-node ask, sibling ask, and 422 disclosure;
- Meta+Enter/Ctrl+Enter versus plain/Shift+Enter and IME composition;
- blank-only text refused locally while original non-blank whitespace is sent;
- one in-flight request, stable UUID on ambiguous retry, new UUID after edit, replayed 200 deduped locally;
- success ordering, draft clearing, error preservation, 422 disclosure, and sessionStorage round trip;
- header, accessible name/count, and singular/plural announcement wording.

### Component parity in both shells

- generating/empty: field and bordered Queue visible; `this tab only`; no queue band, Stop, or delete;
- accepted one/two: full-bleed labelled list, ordered text, lowercase DOM header with CSS uppercase, visible `sent`, correct count/status announcement;
- shortcut submits, plain Enter adds a newline, composing shortcut does nothing;
- success keeps textarea focus; failed/409 send preserves draft and renders alert;
- ask block uses `aria-disabled`, no `disabled` attribute, valid `aria-describedby`, text-secondary class, and no request from click or shortcut;
- 422 renders only the exact disclosure while retaining sessionStorage draft;
- terminal/historical/cold state renders no dock;
- mount is a sibling after the scroller/jump control, not inside the scrolling transcript; queue band is outside the padded composer well.

Update `console-isolation.test.ts` so the new Console component is actually included in the positive file list and only imports the approved shared logic/request seams.

## Visual acceptance

Capture/inspect both shells in these states: generating empty, generating with two receipts, ask-blocked with reason, and detached after 422.

- Legacy: verify the node panel at 460 CSS px wide in the normal desktop shell.
- Console: verify at a 1440×900 desktop viewport and record the actual rendered node-panel width; also constrain the component harness to 460 CSS px to compare dock behavior directly with Legacy.
- At each width: no horizontal overflow or clipped Queue control; the field remains at least 56px high; the band caps at 33vh and scrolls internally; the transcript's last row can be revealed above the dock; focus rings are not clipped.
- Text/background and focus-ring contrast use the final design tokens and meet the documented 4.5:1 text and 3:1 non-text floors. The ask-blocked label must use text-secondary, not tertiary.
- With `prefers-reduced-motion: reduce`, state changes introduce no motion and retain identical content/order.

If implementation evidence contradicts the final design prose, stop and record the conflict; do not resolve it from an older mockup.

## Verification

```bash
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check)
bun x eslint packages/web/src/lib/steering-dock.ts packages/web/src/lib/steering-dock.test.ts packages/web/src/components/workflows/ComposerDock.tsx packages/web/src/components/workflows/ComposerDock.test.tsx packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/components/ConsoleComposerDock.tsx packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx packages/web/src/experiments/console/console-isolation.test.ts --max-warnings 0
```

## Exit criteria

- Both shells implement identical Story 2.1 semantics through their approved boundaries.
- All required dock states, view widths, keyboard/focus paths, list/live-region semantics, contrast, and reduced-motion behavior have automated or captured evidence.
- The diff contains no queue GET/polling, Stop/delete, delivered inference, transcript reconciliation, or terminal read-only UI.
