---
phase: 2
title: 'Phase 2: Read-only NEVER SENT box in both dock renderers'
status: pending
priority: P1
effort: '4h'
dependencies: [1]
gate: 'Phase 1 green (steering-dock.test.ts, type-check, lint)'
---

# Phase 2: Read-only NEVER SENT box in both dock renderers

## Goal

Given a `writtenOperatorMessageIds` prop, both `ComposerDock` (Legacy) and
`ConsoleComposerDock` (Console) reconcile once, and render the finished-node
treatment: a read-only labelled list headed `never sent · n` (CSS uppercase),
one item per restored message keeping its text and `data-message-id`, the
folded draft last, and a single assertive `role="alert"` disclosure. No
field, no controls, no dock when nothing is undelivered. Both shells keep
identical anatomy, order, and wording (UX-DR8); only token roots differ.

## Scout checklist (deep mode — re-verify before editing)

- [ ] `ComposerDock.tsx`: confirm `controlsMounted(mode)` is the single place
      that decides focus hand-off when controls leave the DOM, and that the
      queue band `<section aria-labelledby={bandHeaderId}>` / `<h3>` /
      `<ul aria-label>` / `<li data-message-id>` classes are the ones to reuse.
- [ ] `ConsoleComposerDock.tsx`: confirm it mirrors the same anatomy with
      Console classes (`outline-accent-bright!` focus ring, surface tokens)
      and imports only `@/lib/steering-dock` + Console API helpers (no Legacy
      imports — `console-isolation.test.ts` enforces this).
- [ ] Both dock test files: locate the existing `finished-iteration` and
      `terminal hides the dock` tests to place the new `describe('never sent')`
      block after them; reuse their `render`/`flush`/`storage` helpers.
- [ ] `steering-dock.ts` exports from Phase 1 are present:
      `reconcileNeverSent`, `neverSentBandHeader`, `neverSentListLabel`,
      `STEERING_NEVER_SENT_DISCLOSURE`, `NeverSentEntry`.

## Files to Create / Modify

- Modify: `packages/web/src/components/workflows/ComposerDock.tsx`
- Modify: `packages/web/src/components/workflows/ComposerDock.test.tsx` (tests first)
- Modify: `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` (tests first)

## Test-first design

Write the matrix below into **both** dock test files (same names, same
assertions; the Console file uses its own render helper). Run each file red,
then implement, then green. Drive `sent` receipts through the existing test
seams: a `readQueue` stub returning `{ queued: [...] }` while
`rowStatus: 'running'`, or a `send` stub resolving `{ message_id, state }`
followed by a Queue press. Then re-render the same mounted dock (same `key`)
with `rowStatus: 'completed'` / `live: false` and the
`writtenOperatorMessageIds` prop.

### Test matrix

| ID | Test name | Setup → assertion |
|----|-----------|-------------------|
| T2.1 | `restores queued receipts that have no written row as a read-only never-sent list` | queue snapshot `[m1 'fix the path', m2 'skip doctests']`; terminal + written `Set{m1}` → exactly one `<ul aria-label="Never sent, 1">` with one `<li data-message-id="m2">` whose text is `skip doctests`; `<h3>` text is `never sent · 1`. |
| T2.2 | `keeps every restored message's original text and id in order` | receipts `[a, b, c]`, written `Set{}` → three `li` in order `a, b, c` with matching `data-message-id` and verbatim text (including a message containing `<b>` rendered as text, not markup). |
| T2.3 | `renders no field, no Stop, no Queue/Send now, no delete, and no status region in finished mode` | after T2.1 setup: `querySelector('textarea') === null`; no `button` elements inside the dock; no `[role="status"]`. |
| T2.4 | `announces once through an assertive alert with the exact disclosure` | exactly one `[role="alert"]` whose text is `node finished · none of this was sent`; a second re-render with the same props keeps exactly one alert (no duplicate announcement). |
| T2.5 | `folds a non-blank unsent draft in as the last item without an id` | type `still typing` into the field (not queued) → terminal → last `li` text `still typing`, no `data-message-id` attribute; the draft's sessionStorage record is unchanged. |
| T2.6 | `the folded draft reuses the ambiguous-retry id when unchanged` | `send` rejects with a transport error (pending retry stored), draft unchanged → terminal → last `li` has `data-message-id` equal to the posted `message_id`. |
| T2.7 | `renders no dock at all when every receipt matched a written row` | receipts `[m1]`, written `Set{m1}`, blank draft → dock renders `null` (host has no dock section, no alert). |
| T2.8 | `never reconciles while the row is still running` | receipts present, `rowStatus: 'running'`, prop `Set{}` passed anyway → composer still rendered, no never-sent list, no alert (the prop is ignored until the pane's terminal gate — but the dock must also be robust to a premature value). Note: implement by requiring `isTerminalNodeRowStatus(rowStatus) \|\| !live` inside the dock effect too. |
| T2.9 | `does not reconcile from finished-iteration mode` | mount in finished-iteration mode (descriptor + `onSelectLiveRow`), band shows queue `[m1]`; then terminal (`finishedIteration: null`, `rowStatus:'completed'`) with prop `Set{}` → no never-sent list, dock hidden. |
| T2.10 | `does not reconcile from the detached disclosure` | stored 422 refusal (detached) → terminal with prop → hidden, no list. |
| T2.11 | `reconciles from a blocked (awaiting) dock` | `rowStatus: 'awaiting'`, receipts `[m1]` → terminal → list with `m1`. |
| T2.12 | `restores a receipt this tab sent that a later snapshot dropped and no row was written for` | Queue press → 200 `m1`; then snapshot `{ queued: [] }` (drained); terminal with written `Set{}` → list contains `m1` (ledger path). |
| T2.13 | `a receipt this tab withdrew is not restored` | Queue → 200 `m1`; withdraw → 200; terminal, written `Set{}` → no list (hidden). |
| T2.14 | `the box survives a non-live run` | terminal via `live: false` + `rowStatus: 'failed'` (Cancel shape) → list renders. |
| T2.15 | `focus moves to the last transcript row when the controls leave, and the box has no focusable element` | focus the field; terminal → `focusLastRow` called once; `dock.querySelector('[tabindex], button, textarea, a[href]') === null`. |
| T2.16 | `header is lowercase DOM text with the uppercase class` | `<h3>` `textContent === 'never sent · 2'` and `classList.contains('uppercase')`. |
| T2.17 | `a scope change resets the box` | after T2.1, re-render with a different `nodeId` (running) → composer renders, no list. |
| T2.18 | `a retried node clears the never-sent box and ledger and renders the composer` | after T2.1 (box shown), re-render the **same** `nodeId`/key with `rowStatus: 'running'`, `live: true` → composer renders, no list, no alert; a fresh queue snapshot `[]` then a later terminal with written `Set{}` yields **no** list (the old ledger ids were cleared). |

The Console file adds one more: T2.18 `does not import Legacy components`
is already covered by `console-isolation.test.ts`; run it in verification.

## Tasks & Steps (apply to both docks; Console mirrors with its own classes)

1. **Props.** Add
   `writtenOperatorMessageIds?: ReadonlySet<string> | null;` with the doc
   comment: "Operator `message_id`s the pane read from a transcript drain that
   started after the node was observed terminal; `null` until then. The dock
   reconciles exactly once when it becomes non-null."
2. **Eligibility ref.** Track `lastSteerableModeRef = useRef<'composer' | 'blocked' | null>(null)`;
   in a render-phase assignment (or a layout-free effect keyed on `mode`) set
   it to `mode` when `mode === 'composer' || mode === 'blocked'`, and to
   `null` when `mode === 'finished-iteration' || mode === 'detached'`. Reset on
   scope change alongside the existing `prevScopeRef` effect.
3. **Retry/resume reset.** Extend the existing `prevScopeRef` scope-reset
   effect (or add a sibling effect immediately after it) so that when
   `dock.neverSent !== null && live && (rowStatus === 'running' || rowStatus === 'awaiting')`
   the dock resets exactly as on a scope change: `setDock({ ...createSteeringDockState(subState), pendingRetry: loadSteeringDraft(store, storageKey).pendingRetry })`,
   `lastSteerableModeRef.current = null`, and (Legacy) `setReadDetached(false); setReadNotify(null)`.
   Comment: "Story 2.11 — retry-node/resume re-runs this row under the same
   key; the box and the first attempt's ledger must not outlive it."
4. **Reconcile effect.**
   ```ts
   useEffect(() => {
     if (writtenOperatorMessageIds === null || writtenOperatorMessageIds === undefined) return;
     if (!(isTerminalNodeRowStatus(rowStatus) || !live)) return;
     if (lastSteerableModeRef.current === null) return;
     setDock(current =>
       current.neverSent === null
         ? reconcileNeverSent(current, { writtenMessageIds: writtenOperatorMessageIds, draft })
         : current
     );
   }, [writtenOperatorMessageIds, rowStatus, live, draft]);
   ```
   `draft` is read at reconcile time only; the guard on `neverSent === null`
   keeps later keystrokes (there is no field anymore) and StrictMode replays
   from re-running it.
5. **Mode.** Pass `neverSent: dock.neverSent` into `steeringDockMode`; extend
   the local `controlsMounted` union with `'finished'` (returns false) and the
   `pollingEnabled` predicate stays unchanged (finished never polls).
6. **Render branch** — insert **before** the `finished-iteration` branch and
   after the `detached` branch:
   ```tsx
   if (mode === 'finished' && dock.neverSent !== null) {
     const entries = dock.neverSent;
     return (
       <section aria-labelledby={bandHeaderId} className="flex-none border-t border-border bg-surface-elevated">
         <h3 id={bandHeaderId} className="px-[10px] pt-[6px] text-[10px] font-bold uppercase tracking-[0.07em] text-text-secondary">
           {neverSentBandHeader(entries.length)}
         </h3>
         <div className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]">
           <ul aria-label={neverSentListLabel(entries.length)}>
             {entries.map((entry, index) => (
               <li key={entry.messageId ?? `draft-${index}`} {...(entry.messageId === null ? {} : { 'data-message-id': entry.messageId })}
                   className="py-[1px] font-mono text-[11.5px] leading-[1.85] text-text-secondary">
                 <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{entry.message}</span>
               </li>
             ))}
           </ul>
         </div>
         <p role="alert" className="px-[10px] pb-[8px] font-mono text-[10.5px] leading-[1.45] text-text-secondary">
           {STEERING_NEVER_SENT_DISCLOSURE}
         </p>
       </section>
     );
   }
   ```
   Same tokens as the queue band; no error colour, no dimmed fill, no
   `sent` badge. Console uses its existing band classes and
   `text-text-secondary` equivalents.
7. **Docblock.** Add a "Story 2.11" sentence to each dock's header comment
   describing the one-shot terminal reconciliation and the read-only box.
8. Keep `finishedIterationDisclosure`, detached, blocked, and composer
   branches byte-for-byte unchanged; the existing tests must not change.

## Visual acceptance (both shells, before closing the phase)

Render the finished state with two restored items plus a folded draft at
460 px and 1280 px in each shell (Storybook-free: use the dock test render
with `document.body` sized, or the Phase 4 Playwright evidence step) and
check against `mockups/key-steering-dock.html` state 5:

- header word `NEVER SENT · 3` uppercase via CSS, tracking `0.07em`;
- items elided on one line, no controls, no badge;
- disclosure line beneath in body-bar size, text-secondary;
- no field, no control row, panel background unchanged.

## Verification

```bash
NODE_ENV=development bun test packages/web/src/components/workflows/ComposerDock.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx
bun test packages/web/src/experiments/console/console-isolation.test.ts
bun --filter @archon/web type-check && bun --filter @archon/web lint
```

Mechanical pass condition: T2.1–T2.18 pass in both files, every pre-existing
dock test still passes unchanged, isolation test passes, zero lint warnings.

## Rollback

Revert the four files; Phase 1's exports remain unused but harmless.
