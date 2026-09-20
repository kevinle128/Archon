# Scout: ComposerDock idle-after-interrupt surfaces for Story 2.12 (30-minute keepalive)

Scope: `packages/web/src/components/workflows/ComposerDock.tsx` (Legacy), `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` (Console), `packages/web/src/lib/steering-dock.ts` + its test file, `packages/web/src/lib/api.ts`, `packages/web/src/lib/api.generated.d.ts`. Read-only; no files modified.

## 1. Legacy `ComposerDock.tsx` and Console `ConsoleComposerDock.tsx`

The two files are near-identical renderers (Console uses joined className arrays instead of `cn()` and imports its wire types from `../skills/runs` instead of `@/lib/api`, but the JSX structure, state wiring, and line numbers track each other almost 1:1 — Console is offset roughly +6 lines from Legacy throughout). Both import all steering logic from the shared framework-free module `packages/web/src/lib/steering-dock.ts`.

### How `idle-after-interrupt` renders

`idle-after-interrupt` is not a `SteeringDockMode` value (`hidden | blocked | detached | composer | finished-iteration | finished`, `steering-dock.ts:85-91`) — it is a `SteeringSubState` (`steering-dock.ts:31`) folded into the `composer` mode. The dock derives a finer-grained `SteeringAgentMode` (`'queue-only' | 'generating' | 'interrupting' | 'idle'`, `steering-dock.ts:94`) via `steeringAgentMode()` (`steering-dock.ts:177-185`): `dock.subState === 'idle-after-interrupt'` → `'idle'`.

Both components compute `const agentMode = steeringAgentMode(dock);` then `const idle = agentMode === 'idle';` — Legacy `ComposerDock.tsx:515,742`, Console `ConsoleComposerDock.tsx:521,748`. `idle` gates three render decisions, all inside the same composer-mode JSX branch (no separate mode branch exists for idle-after-interrupt):

- **Disclosure line** (existing): `{idle ? <p>{STEERING_INTERRUPT_DISCLOSURE}</p> : null}` — Legacy `ComposerDock.tsx:823-827`, Console `ConsoleComposerDock.tsx:829-833`. `STEERING_INTERRUPT_DISCLOSURE` (`steering-dock.ts:102-103`) reads `"stopped after the last completed tool call · files already written stay written"`. **This is the natural attachment point for a new 30-minute/typing-keeps-it-open disclosure line** — either appended as a second `<p>` in the same conditional block, or as a new shared string constant in `steering-dock.ts` rendered alongside it, matching how `STEERING_DETACHED_DISCLOSURE`/`STEERING_NEVER_SENT_DISCLOSURE` are already centralized constants shared by both renderers.
- **Stop button visibility**: `showStop = agentMode === 'generating' || agentMode === 'interrupting'` — Legacy `:747`, Console `:753`. `idle` implies `showStop === false` (Stop is hidden once idle-after-interrupt is reached).
- **Submit button label / accessible name / band headers**: `{idle ? 'Send now' : 'Queue'}` (Legacy `:899`, Console `:905`); `aria-label={idle ? sendNowButtonAccessibleName(...) : queueButtonAccessibleName(...)}` (Legacy `:884-888`, Console `:890-894`); band header `idle ? willSendBandHeader(...) : queueBandHeader(...)` (Legacy `:761`, Console `:767`) and list label `idle ? willSendListLabel(...) : queueListLabel(...)` (Legacy `:766-767`, Console `:772-773`).

### Where "Send now" / "Will send" text lives

All copy is centralized in `steering-dock.ts`, not duplicated per renderer:
- `willSendBandHeader(count)` → `"will send · N"` (`steering-dock.ts:239-241`)
- `willSendListLabel(count)` → `"Will send, N"` (`:247-249`)
- `willSendCountPhrase(count)` → `"N message(s) will send"` (`:230-232`)
- `sendNowButtonAccessibleName(count)` → `"Send now · Cmd/Ctrl+Enter to send · {willSendCountPhrase}"` (`:264-266`)
- `STEERING_AGENT_IDLE = 'agent idle · Send now delivers'` (`:105`) — set as `dock.notice` by `syncProjectedSubState()` (`:316-321`, fires when the projected sub-state flips to idle-after-interrupt) and by `resolveInterruptOutcome()` (`:512-525`, fires when the operator's own Stop click settles as idle-after-interrupt). This `notice` value is what ultimately renders as `statusText` in the sr-only `role="status"` div (Legacy `:902`, Console `:908`) — see accessibility section below.
- The visible button literal `'Send now'` / `'Queue'` is inlined directly in JSX (not a shared constant) at Legacy `:899` / Console `:905`.

### Composer keystroke/focus handlers

- **Keystroke (typing)**: `<textarea onChange={(event) => setDraft(event.target.value)}>` — Legacy `ComposerDock.tsx:836-838`, Console `ConsoleComposerDock.tsx:842-844`. Immediately followed by `onKeyDown` handling the `Cmd/Ctrl+Enter` submit shortcut via `isQueueShortcut()` (`steering-dock.ts:212-219`) — Legacy `:839-852`, Console `:845-858`.
- **Focus**: there is no `onFocus` on the `<textarea>` itself. Instead, the wrapping `<div ref={wellRef} onFocusCapture={...} onBlurCapture={...}>` (Legacy `:807-820`, Console `:813-826`) tracks whether focus is anywhere inside the whole composer well via `focusInsideRef.current = true/false`. This exists purely for focus-retention bookkeeping (deciding whether an unmount should move focus to the transcript, `focusLastRow`) — it is not currently wired to any network call. **This `onFocusCapture` is the natural attach point for "focus re-arms the timer"**, alongside the textarea's `onChange` for "typing re-arms it."
- Both `onChange` and `onFocusCapture` are unconditional today (fire in every dock mode where the well renders) — a keepalive implementation would need to additionally gate on `idle === true` (i.e., only while `agentMode === 'idle'` / `dock.subState === 'idle-after-interrupt'`), since the story requires the debounced keepalive only in that sub-state, not while `generating` or in ordinary `composer` queue-only mode.

### Accessibility patterns already in use

- `role="status"` (implicit `aria-live="polite"`) on a visually-hidden (`sr-only`) `<div>` that carries `statusText` — the single "polite announcement" channel for the dock (Legacy `:902-904`, Console `:908-910`). `statusText` is `blockedReason` when blocked, else `dock.notice`, else a queued-count phrase.
- `role="alert"` (implicit `aria-live="assertive"`) on refusal/disclosure paragraphs that need immediate announcement: send/withdraw refusal (Legacy `:856-858`), the detached disclosure (`:616-626`), the never-sent disclosure (`:657-663`), and finished-iteration poll-failure notices (`:694-706`). No component uses an explicit `aria-live` attribute anywhere — everything relies on the native semantics of `role="status"`/`role="alert"`.
- `aria-describedby={blocked ? reasonId : undefined}` links the submit button to the blocked-reason paragraph only while blocked (Legacy `:891`, Console `:897`); `reasonId` is a `useId()`-generated id (`:219`/`:226`).
- `aria-label` (not visible text) carries the full accessible name for icon-like or ambiguous controls — `deleteButtonAccessibleName(message)` (`steering-dock.ts:604-606`), `queueButtonAccessibleName`/`sendNowButtonAccessibleName` — keeping exact copy centralized and unit-testable in `steering-dock.ts` rather than inlined per JSX call site.
- `aria-keyshortcuts="Meta+Enter Control+Enter"` on the submit button documents the keyboard shortcut for AT users (Legacy `:889`, Console `:895`).
- Explicit focus management via refs: `detachedAlertRef` (`tabIndex={-1}` + `.focus()` when the mode flips to `detached`, `:614-626` / `:468-470`), `neverSentAlertRef`, `goButtonRef`, `fieldRef`, plus a `focusLastRow` callback prop that both components accept so that when the dock's controls unmount (terminal state, or a 422 swap to the detached disclosure) focus is deliberately moved to the transcript rather than falling to `<body>` (`:428-463`, `:472-486` in Legacy; mirrored in Console).

## 2. `packages/web/src/lib/steering-dock.ts` and its test file

This module is the framework-free state machine shared by both renderers (no React imports). Key exports relevant to Story 2.12:

- `SteeringDockMode` (`:85-91`) and `steeringDockMode()` (`:138-163`) compute visibility precedence: `finished` (nonempty `neverSent` + `nodeTerminal`) → `hidden` (`!live`) → `finished-iteration` → `hidden` (row not running/awaiting) → `blocked` (pending ask/awaiting) → `detached` (stored 422 `not_steerable_here`) → `composer`. **There is no dedicated mode for idle-after-interrupt** — it is entirely a sub-state of `composer`, surfaced only through `steeringAgentMode()`.
- `steeringAgentMode()` (`:177-185`) is the sole place `'idle-after-interrupt'` maps to a UI-facing value (`'idle'`).
- `syncProjectedSubState()` (`:306-323`) folds the server-projected `SteeringSubState` into dock state; a defined projection always wins over the local `interruptInFlight` transient.
- `beginInterrupt()` / `resolveInterruptOutcome()` / `resolveInterruptError()` (`:503-538`) implement the client side of the Stop → interrupt → idle-after-interrupt turn model. `resolveInterruptOutcome()` sets `subState: outcome` directly from the server's `sub_state` response field (not client-guessed).
- `beginSendNow()` / `resolveSendNowSuccess()` / `resolveSendNowFailure()` (`:400-500`) implement "Send now," which **resolves** idle-after-interrupt back to `generating` — confirming the story's constraint that keepalive must NOT be wired to Send now (Send now is a terminal action for that sub-state, not a re-arm).
- **2.11 never-sent reconciliation**: `reconcileNeverSent()` (`:676-720`) is a pure function; it is invoked from both `ComposerDock.tsx` (`:339-354`) and `ConsoleComposerDock.tsx` (`:345-360`) inside a `useEffect` gated on `writtenOperatorMessageIds !== null`, `nodeTerminal === true`, `dock.neverSent === null` (one-shot), and `queueWasObservableRef.current === true` (the attempt must have been in `composer`/`blocked`/`finished-iteration` mode at some point to be eligible). `collectWrittenOperatorMessageIds()` (`:727-739`) filters the node-wide transcript drain down to operator-authored text rows with a `message_id`.

**Test file** (`steering-dock.test.ts`) was not printed inline above but its presence alongside every exported pure function (mode/agentMode/submit-guard/interrupt/withdraw/reconcile transitions) confirms these are the unit-tested seams; a new 30-minute disclosure string or a new debounce helper co-located in this module would follow the same pattern (pure function + `SteeringDockState` transition + dedicated test cases), keeping Legacy/Console byte-identical copy and behavior.

## 3. `packages/web/src/lib/api.ts` — steering API functions

Four steering functions, all following one shape (URL template + `fetchJSON` + error normalization through `toSteeringRequestError`):

- `sendNodeGuidance(runId, nodeId, body)` → `POST /api/workflows/runs/:runId/nodes/:nodeId/send` (`:762-782`)
- `interruptNode(runId, nodeId)` → `POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt` (`:794-809`)
- `withdrawNodeGuidance(runId, nodeId, messageId)` → `DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId` (`:818-835`)
- `readNodeGuidanceQueue(runId, nodeId, options)` → `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` (`:844-864`)

All four import their request/response types from `@/lib/api.generated` (`import type { components } from '@/lib/api.generated';`, `api.ts:7`) via `components['schemas'][...]` type aliases declared just above each function (e.g. `:749-752`). `fetchJSON<T>()` (`:76-80`) is the shared low-level helper: plain `fetch` + `assertApiResponseOk()` (throws `Error` with `.status` on non-2xx) + `res.json()`.

**Modeling a keepalive call**: a new function would follow the identical shape — e.g. `POST /api/workflows/runs/:runId/nodes/:nodeId/keepalive` (or similar path chosen by the eventual API design), typed via a new `components['schemas']['...']` alias once the OpenAPI spec defines it, wrapped in the same `try { fetchJSON(...) } catch (error) { throw toSteeringRequestError(error); }` pattern used by `sendNodeGuidance`/`interruptNode`/`withdrawNodeGuidance`. It would sit in `api.ts` next to the other four steering functions (after `readNodeGuidanceQueue`, before `getWorkflowRunByWorker` at `:866`).

## 4. `packages/web/src/lib/api.generated.d.ts` — steering route types

This file is machine-generated (`bun --filter @archon/web generate:types`, requires a running server) and must not be hand-edited. Confirmed steering route entries and line numbers:

- `"/api/workflows/runs/{runId}/nodes/{nodeId}/send"` — path key `:2544`, `SendWorkflowNodeBody`/`SendWorkflowNodeResponse` schema refs `:2569,2579`
- `"/api/workflows/runs/{runId}/nodes/{nodeId}/interrupt"` — `:2644`, `InterruptWorkflowNodeResponse` ref `:2675`
- `"/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}"` (DELETE, withdraw) — `:2740`, `WithdrawWorkflowNodeResponse` ref `:2773`
- `"/api/workflows/runs/{runId}/nodes/{nodeId}/queue"` (GET, read) — `:2846`, `ReadWorkflowNodeQueueResponse` ref `:2875`

Schema bodies (`components['schemas']`):
- `SendWorkflowNodeResponse` (`:5577-5584`): `{ success: true; message_id: string; state: "queued" | "awaiting_send_now" }`
- `SteeringError` (`:5585-5592`): `{ success: false; error: { code: string; message: string } }` — the nested shape `toSteeringRequestError()`/`toSteeringRefusal()` in `steering-dock.ts` parse
- `SendWorkflowNodeBody` (`:5593-5599`): `{ message: string; message_id: string; intent: "queue" | "send_now" }`
- `InterruptWorkflowNodeResponse` (`:5600-5605`): `{ success: true; sub_state: "idle-after-interrupt" | "generating" }` — this is the **only** place `"idle-after-interrupt"` appears as a wire-level string literal in the generated types today
- `WithdrawWorkflowNodeResponse` (`:5606-5611`), `ReadWorkflowNodeQueueResponse` (`:5612-5616`), `QueuedGuidanceMessage` (`:5617-5621`)

There is currently no keepalive route, no timeout/expiry field, and no "30 minute" reference anywhere in this file. A new keepalive endpoint requires: (1) the server-side OpenAPI route registered via `registerOpenApiRoute(createRoute({...}), handler)` per the repo's Zod/OpenAPI convention, (2) the dev server running, then (3) `bun --filter @archon/web generate:types` to regenerate this file before `api.ts` can reference the new `components['schemas'][...]` types.

## Answers to the four questions

**Q1 — Is there already polling/interval while idle-after-interrupt, or is it purely event-driven?**
There IS an existing recurring network call: `startQueuePolling()` (`steering-dock.ts:802-868`) runs a serial, non-overlapping GET-queue poll (default `pollIntervalMs = 1000`, prop default in both `ComposerDock.tsx:209` and `ConsoleComposerDock.tsx:216`) whenever `pollingEnabled = mode === 'composer' || mode === 'blocked' || mode === 'finished-iteration'` (Legacy `:361`, Console `:367`). Because `idle-after-interrupt` is a sub-state *within* `composer` mode (not a distinct `SteeringDockMode`), this 1-second `GET .../queue` poll keeps running unmodified through idle-after-interrupt. However, it is **unconditional** — it fires every second regardless of whether the operator is typing or focused, and it is a read-only `GET`, not any kind of activity/keepalive signal. So while there is continuous background traffic during idle-after-interrupt that a server *could* choose to treat as liveness evidence, it does not by itself implement "typing/focus re-arms a 30-minute timer" semantics — that requires a new debounced, event-gated call as the story specifies. Everything else (send, interrupt, withdraw) is purely event-driven (fired only on user action), with no other interval timers in these two dock components.

**Q2 — Where exactly does the dock know it is in idle-after-interrupt (component + prop/state)?**
The render gate is `const agentMode = steeringAgentMode(dock); const idle = agentMode === 'idle';` — Legacy `ComposerDock.tsx:515` and `:742`, Console `ConsoleComposerDock.tsx:521` and `:748`. `dock` is local `useState<SteeringDockState>` (Legacy `:240-243`, Console `:246-249`) whose `subState: SteeringSubState | null` field is set either (a) from the `subState` prop via `syncProjectedSubState()` in a `useEffect` (Legacy `:325-327`, Console `:331-333` — the authoritative server-projected value passed down from the parent room component), or (b) locally by `resolveInterruptOutcome()` after the operator's own Stop click resolves (Legacy `:565-587`, `stop()` function; Console `:571-593`). `steeringAgentMode({subState: dock.subState, interruptInFlight: dock.interruptInFlight})` (`steering-dock.ts:177-185`) is the single function that turns `subState === 'idle-after-interrupt'` into the `'idle'` UI mode both the disclosure and the keepalive gate would key off of.

**Q3 — What debounce utilities already exist in packages/web?**
None are shared/centralized. There is no `lib/debounce.ts`, no lodash dependency, and no generic `debounce()`/`throttle()` helper exported anywhere. Every "debounce" in the codebase is an inline, local `useRef<ReturnType<typeof setTimeout>>` + manual `clearTimeout`/`setTimeout` pair, re-implemented per call site: `routes/DashboardPage.tsx:69,135-138` (300ms search-input debounce) and `hooks/useBuilderValidation.ts:189` (`debouncedIssues` state via a similar timer pattern). A Story 2.12 keepalive debounce would need to either add a new small shared helper (e.g. in `steering-dock.ts`, following that module's "framework-free, unit-tested pure function" convention) or replicate the local `useRef`+`setTimeout` pattern directly inside `ComposerDock.tsx`/`ConsoleComposerDock.tsx` (duplicated once per shell, matching how the rest of the dock's imperative logic is already duplicated/mirrored across the two files).

**Q4 — How does the client currently detect node-terminal to run 2.11 reconciliation, and does a 30-min server fail-terminal flow through it automatically?**
`nodeTerminal` is computed identically in both parent panes — `LegacyGraphLogsPane.tsx:283-284` and `ConsoleInspectPane.tsx:250-251` — as `hasTerminalNodeEvidence(nodeExecutions, selectedNodeId)`, defined in `lib/execution-room-model.ts:453-463`: true only when the selected node has ≥1 raw execution and *every* one of them has a terminal `status` per `isTerminalNodeExecutionStatus()` (`:403-405`: `'completed' | 'failed' | 'skipped'`). `nodeExecutions` (`components['schemas']['NodeExecution'][]`) is part of the run-detail payload that both panes poll on an interval computed by `resolveRunDetailRefetchIntervalMs()` (`:439-447`): every 3 seconds while the run is live, continuing at 3s even after the run reaches a terminal *run* status if any node execution is still unsettled. `nodeTerminal` is threaded down as a prop into `LegacyNodeRoom.tsx`/`ConsoleNodeRoom.tsx` → `NodeTranscriptPane.tsx`/`ConsoleNodeRoom.tsx`'s own `nodeTerminal` handling, which fires the node-wide reconcile drain effect (`NodeTranscriptPane.tsx:301-346`, mirrored in `ConsoleNodeRoom.tsx` around `:653-697`) that calls `drainNodeMessages()` and, on a complete error-free drain, `collectWrittenOperatorMessageIds()` → feeds `writtenOperatorMessageIds` into the dock, which runs `reconcileNeverSent()`. **This entire path is generic to node-execution status, not steering-specific**: a server-side 30-minute abandoned-redirect failure would (per the existing convention) mark that node execution's `status` as `'failed'`, which the next 3-second run-detail poll would surface in `nodeExecutions`, making `hasTerminalNodeEvidence()` return true and `nodeTerminal` flip to `true` — automatically arming the same 2.11 reconciliation effect with no new client wiring required, as long as the 30-minute failure is expressed as a `node_failed`/terminal `NodeExecution.status` event through the normal workflow-event pipeline.

## Unresolved questions

- No server-side timer/route for the 30-minute idle-after-interrupt limit was located in this scout (out of scope — only `packages/web/*` was read). Confirming where that timer lives and what shape a keepalive endpoint would take (path, auth, rate-limit) needs a server-side scout before implementation.
- Whether the new disclosure text and keepalive gating belong in `steering-dock.ts` (shared, testable, single source of truth like `STEERING_INTERRUPT_DISCLOSURE`) or split per-shell was not decided here — flagging for the plan step given the existing strong precedent for centralizing copy/logic in `steering-dock.ts`.
