# Scout: composer dock for a RUNNING node room (Legacy + Console) + E2E infra

Goal recap: add a bottom-pinned composer dock (`Queue` button, Cmd/Ctrl+Enter submit,
plain Enter newline, `QUEUED · n` list, `this tab only` draft label, `aria-disabled` +
`aria-describedby` block reason, `prefers-reduced-motion`) calling a new
`POST /api/workflows/runs/:runId/nodes/:nodeId/send`, in both node-room shells, plus
what the E2E fake provider / runtime need for a proof.

## 1. Component tree, props, live-update mechanism

### Legacy shell

`WorkflowExecution.tsx` (route-level) → `LegacyGraphLogsPane.tsx` → `LegacyNodeRoom.tsx`
→ `NodeTranscriptPane.tsx` (agent nodes only) → `NodeRoom.tsx` (`embedded`).

- `runId` is a plain string prop threaded from `WorkflowExecution.tsx` down every level
  (`LegacyNodeRoomProps.runId`, `NodeTranscriptPaneProps.runId`,
  `packages/web/src/components/workflows/NodeTranscriptPane.tsx:72`).
- Per-node status: `LogRow.status` (`'pending'|'running'|'awaiting'|'completed'|'failed'|'skipped'`),
  built by `buildLogRows` from DAG node state; passed as `row: LogRow | null`
  (`packages/web/src/components/workflows/LegacyNodeRoom.tsx:37-38`,
  `NodeTranscriptPane.tsx:73`). `NodeTranscriptPane` derives `rowStatus = row?.status ?? 'completed'`
  (`NodeTranscriptPane.tsx:145`) — this is what a dock's "node is running" gate should read.
- Run-level status: `runStatus: WorkflowRunStatus` prop (`NodeTranscriptPane.tsx:74`), sourced from
  `WorkflowRunQueryData.workflowState.status` in `WorkflowExecution.tsx:104-160` (react-query, see below).
- Live-update mechanism is **two independent pollers**, no per-node SSE:
  1. Run-level REST poll: `useQuery({ queryKey: ['workflowRun', runId], refetchInterval: status→3000ms or false when terminal })`
     (`WorkflowExecution.tsx:433-445`). This is what refreshes `pendingInteractions`, `nodeStates`, `approval`.
  2. Node-message poll owned by `NodeTranscriptPane` itself: a `setTimeout` loop that calls
     `drainNodeMessages` every **1000ms** while `isLiveRunStatus(runStatus)` is true
     (`transcriptRefetchInterval` returns `1000` for `pending|running|paused`, `false` for terminal —
     `NodeTranscriptPane.tsx:40-55`, loop at `NodeTranscriptPane.tsx:157-218`).
  3. Additionally there IS a global SSE store (`useWorkflowStore`, fed by `useSSE()` connected to the
     **chat conversation** stream, not a per-run/per-node stream) that merges into `WorkflowExecution.tsx`'s
     `initialData` as `liveWorkflow` (`WorkflowExecution.tsx:376,540-602`). Handlers:
     `onWorkflowStatus`, `onWorkflowArtifact`, `onDagNode`, `onLoopIteration`, `onToolActivity`,
     `onTaskActivity`, `onHookActivity` (`packages/web/src/stores/workflow-store.ts:580-596`). This SSE
     stream is opportunistic/best-effort (missed events tolerated, REST is source of truth) — a dock
     should NOT depend on it for correctness, only for snappier status flips.
- Composer dock mount point (Legacy): inside `NodeTranscriptPane`'s returned
  `<RoomRegion nodeId={row.nodeId} scrollable={false}>`, as a new sibling **after** `{jumpButton}`
  (`NodeTranscriptPane.tsx:422-428`):
  ```tsx
  return (
    <RoomRegion nodeId={row.nodeId} scrollable={false}>
      {todos.length > 0 ? <TodoStrip key={resolvedScopeKey} phases={todos} /> : null}
      {scroller}
      {jumpButton}
      {/* new: <ComposerDock .../> here, sibling to scroller, still inside RoomRegion */}
    </RoomRegion>
  );
  ```
  `scroller` is a `flex-1` scrolling div (`data-testid="node-transcript-scroll"`,
  `NodeTranscriptPane.tsx:374-405`); a dock added as the next flex child with `flex-none` will
  naturally pin to the bottom of the region without extra positioning. `RoomRegion` itself is
  `flex min-h-0 flex-1 flex-col` (`NodeRoom.tsx:207-226`).

### Console shell

`RunDetailPage.tsx` → `ConsoleInspectPane.tsx` → `ConsoleNodeRoom.tsx` (self-contained; no
separate transcript-pane split — one file does paging + rendering + region).

- `run: Run` object prop carries `run.id` (`ConsoleNodeRoomProps.run`,
  `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:61`); `nodeId: string | null`
  is separate (`:63`).
- Per-node status: `row.status` from `inspectRow()` — prefers `selectedRow` (a `LogRow`), else falls
  back to `nodeStates.find(...)?.status ?? 'pending'` (`ConsoleNodeRoom.tsx:513-524`). `rowStatus`
  local var at `ConsoleNodeRoom.tsx:568`.
- Run "live" flag: `isLive: boolean` prop, computed by the caller from run status, gates both the
  message-drain poll and the `1000ms` refresh timer (`ConsoleNodeRoom.tsx:520-561`, same shape as
  Legacy's `isLiveRunStatus`). No separate `runStatus` enum prop is threaded into `ConsoleNodeRoom`
  itself — only the boolean `isLive`.
- Live-update mechanism: **REST polling only, no SSE inside Console's node room.** `RunDetailPage.tsx`
  does its own run-level polling (own `getRun()` call, see `packages/web/src/experiments/console/skills/runs.ts:88-105`)
  and passes `isLive`/`nodeStates`/`events`/`pendingInteractions` down as props; `ConsoleNodeRoom`
  additionally runs its own 1000ms node-message drain loop identical in shape to Legacy's
  (`ConsoleNodeRoom.tsx:519-563`). (Console does have a generic `lib/sse.ts` used elsewhere in the
  experiment, e.g. `RunDetailPage.tsx`/`ChatPage.tsx`, but the node-room component itself is
  poll-driven.)
- Composer dock mount point (Console): inside the returned `<RoomRegion nodeId={nodeId} allowOutsetFocus={showTodoStrip}>`,
  as a new sibling **after** the `Jump to latest` button (`ConsoleNodeRoom.tsx:883-905`):
  ```tsx
  <RoomRegion nodeId={nodeId} allowOutsetFocus={showTodoStrip}>
    {showTodoStrip ? <ConsoleTodoStrip key={resolvedScopeKey} phases={agentHistory.todos} /> : null}
    <div ref={scrollRef} data-testid="console-node-room-scroll" className="min-h-0 flex-1 overflow-y-auto" ...>
      {body}
    </div>
    {!follow.follow && (rowStatus === 'running' || rowStatus === 'awaiting') ? (
      <button ...>Jump to latest</button>
    ) : null}
    {/* new: <ConsoleComposerDock .../> here */}
  </RoomRegion>
  ```
  Local `RoomRegion` here is Console's OWN copy (`ConsoleNodeRoom.tsx:147-167`), not imported from
  Legacy — same `flex min-h-0 flex-1 flex-col` shape but with `overflow-clip` instead of Legacy's
  scrollable variant, and an extra `allowOutsetFocus` margin behavior.

## 2. Pending AskHuman/permission — source of truth

**Per-run, not per-node**, in both shells: fetched once as part of the run-detail payload
(`pending_interactions` field on the OpenAPI `WorkflowRunDetail`/run-detail response) and filtered
down to "does this affect node X" client-side.

- Legacy: `WorkflowRunQueryData.pendingInteractions: PendingInteraction[]` mapped from
  `data.pending_interactions` in `mapWorkflowRunDetail()` (`WorkflowExecution.tsx:108,154`), refetched
  on the same 3000ms run-level poll as everything else. Passed all the way down to
  `NodeTranscriptPane` as `pendingInteractions: readonly PendingInteraction[]`
  (`NodeTranscriptPane.tsx:76`), then narrowed with `selectVisibleNodeAskInteractions({ pending, nodeId: row.nodeId, selection: row.selection, allMessages, visibleMessages, ownsUnscopedInteractions })`
  (`NodeTranscriptPane.tsx:246-256`, helper in `./merge-agent-room-items`). `PendingInteraction` has a
  `status` field (`'pending'` checked at `NodeTranscriptPane.tsx:272-287`) and a `tool_use_id` that
  anchors it to a specific tool call inside that node's transcript.
- Console: identical shape — `ConsoleRunDetail.pendingInteractions` from `res.pending_interactions ?? []`
  (`packages/web/src/experiments/console/skills/runs.ts:82,102`), threaded as
  `pendingInteractions: readonly PendingInteraction[]` prop into `ConsoleNodeRoom`
  (`ConsoleNodeRoom.tsx:83`), filtered via Console's own
  `./ask/select-visible-node-ask-interactions` (`ConsoleNodeRoom.tsx:41`).
- **Implication for the dock**: a per-node "block send" gate should reuse each shell's existing
  `selectVisibleNodeAskInteractions` filter (or equivalent) against the already-fetched
  `pendingInteractions` prop, then check `.status === 'pending'` on the result — no new fetch needed,
  and it stays consistent with what AskCard already shows as "awaiting answer" in that room. There is
  no separate "permission" collection distinct from `pending_interactions` in the web layer — the
  AGENTS.md `pending_interactions` DB table backs BOTH AskHuman (`kind: 'ask'`) and permission
  (`kind: 'permission'`) rows; the web types (`PendingInteraction`) don't appear to discriminate kind
  in these call sites (worth confirming against `components['schemas']['PendingInteraction']` in
  `api.generated.d.ts` when implementing — grep found only ask-shaped consumption in the room files).

## 3. Test harness

- Runner: **`bun:test`** (not Jest/Vitest). `packages/web/package.json:11` test script:
  `bun test src/lib/ && ... && NODE_ENV=development bun test src/components/ && ... && NODE_ENV=development bun test src/experiments/console/`
  — note `NODE_ENV=development` is required specifically for `src/components/` and
  `src/experiments/console/` (React dev-mode `act()`/warning behavior).
- DOM: **happy-dom**, installed by hand per test file — no `@testing-library/react`, no `jsdom`.
  - Legacy pattern: `import { Window } from 'happy-dom'` inline in the test file, manual
    `Object.assign(globalThis, {...})` of a fixed key allowlist, `createRoot`/`act` from
    `react-dom/client` (`packages/web/src/components/workflows/NodeRoom.test.tsx:1-20,858-935`).
  - Console pattern: shared helper `installHappyDom()`/`restoreHappyDom()` in
    `packages/web/src/experiments/console/test/install-happy-dom.ts` (same technique, slightly larger
    global key list including `HTMLTextAreaElement`, `HTMLFormElement`, `localStorage` — already
    covers what a composer textarea/form would need). Imported by
    `ConsoleNodeRoom.test.tsx:21`.
- Rendering/assertion style: mostly `renderToStaticMarkup` + regex/string assertions on the markup for
  static anatomy (e.g. `expect(loading).toContain('aria-label="review room"')`,
  `NodeRoom.test.tsx:278`), and `createRoot` + `act()` + real DOM queries
  (`host.querySelector(...)`) + native `dispatchEvent` for interaction tests.
- **Accessibility assertion example** (`NodeRoom.test.tsx:975,984,992`):
  ```ts
  expect(button.getAttribute('aria-expanded')).toBe('false');
  // ...click...
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(body.hasAttribute('hidden')).toBe(false);
  expect((win.document.activeElement as unknown) === button).toBe(true);
  ```
- **Keyboard-event assertion example** (`ConsoleNodeRoom.test.tsx:1389-1399`):
  ```ts
  await act(async () => {
    summary.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event
    );
  });
  // ... then a ' ' (space) key variant right after, same pattern.
  ```
  For Cmd/Ctrl+Enter specifically, `new win.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })`
  would follow the same shape; the production precedent for that exact combo (handling, not test) is
  `packages/web/src/experiments/console/components/ApprovalPanel.tsx:116-118`:
  ```ts
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void confirmReject();
  }
  ```
  and its plain-Enter/Escape/IME-guard siblings at `ApprovalPanel.tsx:96-104` (Enter submits a
  single-line `<input>`, guarded by `e.nativeEvent.isComposing || e.keyCode === 229` for IME) and
  `ApprovalPanel.tsx:107-118` (Escape cancels, Cmd/Ctrl+Enter submits a `<textarea>` reject reason —
  this is the closest existing analogue to "Cmd/Ctrl+Enter submits, plain Enter is newline" since a
  bare `<textarea>` with no Enter handler already inserts a newline by default; the dock only needs to
  intercept the Cmd/Ctrl+Enter case, not plain Enter, which needs no code at all in a `<textarea>`).

## 4. `lib/api.ts` wrapping and where a new POST helper goes

- `packages/web/src/lib/api.ts` is hand-written, not generated. It imports `type { components } from '@/lib/api.generated'` and re-exports/aliases individual schema types (e.g. `export type ConversationResponse = components['schemas']['Conversation']`, `api.ts:41`). Runtime functions are plain `async function` wrappers around a local `fetchJSON<T>(url, options)` helper (`api.ts:75-79`) which does `fetch` + `assertApiResponseOk` (throws an `Error` with `.status` attached on non-2xx, `api.ts:63-72`) + `res.json()`.
- Closest existing precedent for a per-node POST write action — `answerAskHuman` (`api.ts:450-462`):
  ```ts
  export async function answerAskHuman(
    runId: string,
    requestId: string,
    body: AskAnswerBody
  ): Promise<WorkflowRunActionResponse> {
    return fetchJSON(
      `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  }
  ```
  A new `sendToNode(runId, nodeId, body)` helper for
  `POST /api/workflows/runs/:runId/nodes/:nodeId/send` would follow this exact shape — path mirrors the
  existing sibling GET route already used by the room, `getWorkflowNodeMessages` at
  `/api/workflows/runs/:runId/nodes/:nodeId/messages` (`api.ts:704-731`), and the E2E helper
  `e2e/lib/playwright/run-detail.ts:52-55` confirms that exact path shape is the one already
  round-tripped in tests.
- `api.generated.d.ts` **is committed** (confirmed via `git log -1 -- .../api.generated.d.ts` returning
  a real commit) and regenerated via `bun --filter @archon/web generate:types`
  (`packages/web/package.json:12`: `openapi-typescript http://localhost:3090/api/openapi.json -o src/lib/api.generated.d.ts`)
  — requires the dev server already running per AGENTS.md. Adding the new server route + Zod schema
  first, then regenerating, is the required order (this scout was read-only in `packages/web`; the
  server-side route/schema is out of scope for this report — see `scout-server` agent).
- Console does **not** import `@/lib/api` at all (enforced by
  `packages/web/src/experiments/console/console-isolation.test.ts:66-73`: `isForbiddenSpec()` treats
  `@/lib/api` and `@/lib/api/*` as violations). Console instead has its own thin wrapper
  `requestJson<T>()` in `packages/web/src/experiments/console/lib/http.ts`, and its own
  `skills/runs.ts` module re-exporting types from `@/lib/api.generated` (type-only import is allowed;
  runtime import of `@/lib/api.generated` is NOT — `console-isolation.test.ts:88-91`). Console's own
  `answerAskHuman` lives at `packages/web/src/experiments/console/skills/runs.ts:192-204`, byte-for-byte
  parallel to Legacy's. A new `sendToNode` for Console goes in `skills/runs.ts` next to it, using
  `requestJson` not `fetchJSON`.
  - Additionally, `console-isolation.test.ts:100-141` enforces an **approved-lib allowlist** for the
    specific room files (`ConsoleNodeRoom.tsx`, `ConsoleInspectPane.tsx`, etc. — see list at
    `console-isolation.test.ts:102-111`): any new `@/lib/*` import from a composer-dock module used
    inside those files must be added to the `approved` Set at `console-isolation.test.ts:114-133`, or
    kept self-contained inside `experiments/console/` with no `@/lib/*` import at all.

## 5. E2E fake provider capability audit

File: `packages/providers/src/e2e-fake/provider.ts` (511 lines), tests in
`packages/providers/src/e2e-fake/provider.test.ts` (448 lines), capabilities in
`packages/providers/src/e2e-fake/capabilities.ts`.

**Scenario DSL** (`scenarioSchema`, `provider.ts:128-153`), all fields optional, `.strict()`
(unrecognized keys throw — see the `UnsupportedSetupError` catch pattern in
`e2e/lib/playwright/archon-runtime.ts:486-536` for how tests degrade gracefully when a target's
older provider build rejects a new key):

| field                            | effect                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `emitTool: boolean`              | yields one assistant text + N tool/tool_result pairs (`E2E_FAKE_TOOL_NAME`/`_INPUT`/`_OUTPUT`)                   |
| `emitTodo: boolean`              | yields the 4-call deterministic todo sequence (`E2E_FAKE_TODO_INPUTS`)                                           |
| `askHuman: boolean`              | calls the real `AskHuman` native tool handler, then throws (provider.ts:495-500) — this is what pauses the run   |
| `delayMs: number`                | `await waitUnlessAborted(delayMs, abortSignal)` **before any yield** (provider.ts:396)                           |
| `doneWhenPromptIncludes: string` | if the (directive-stripped) prompt contains this string, yields `E2E_FAKE_LOOP_DONE` — used to end `loop:` nodes |
| `repeatTool: number`             | repeats the `emitTool` tool/tool_result pair N times, distinct `toolCallId`s                                     |
| `largeLastToolOutput: boolean`   | pads the last tool's output to ~20KB                                                                             |
| `taskDispatch: 'omp'             | 'claude'`                                                                                                        | emits a fixed Task/Agent tool pair instead of the generic tool |

Directives are delimited blocks embedded directly in the node's `prompt:` YAML text
(`<<E2E_SCENARIO>>{...}<</E2E_SCENARIO>>`, see `e2e/fixtures/workflows/e2e-todo-strip.yaml:9-10`), parsed
per-call from whatever prompt string is sent that turn (`extractDelimitedBlock`, `provider.ts:267-291`).

### (a) Can it capture+echo the prompt of a RESUMED turn?

**Only for the AskHuman-answer resume path, not generically.** `requestOptions?.resumeInteractions`
(`provider.ts:402-417`) is populated when the run resumes after an AskHuman/permission answer; if
present, the provider short-circuits and yields `[e2e-fake] ask answered {...}` / `[e2e-fake] ask
declined`, ignoring the rest of the scenario logic entirely, then immediately yields a `result` chunk
with `resumed: true`. It does **not** echo the raw `prompt` string anywhere in this branch or any other
— the only prompt-derived behavior anywhere in the file is the `doneWhenPromptIncludes` substring check
(boolean, not echo) and the literal directive extraction (which is stripped, not surfaced). **There is
currently no scenario flag that echoes the received prompt as assistant text.** This must be added
(see estimate below) to prove "queued message N delivered as turn N+1 body" — currently the fake can
only prove a resume happened at all (via the fixed `[e2e-fake] ask answered ...` string), not what data
rode along.

### (b) Can it hold a turn "running" long enough to queue a message?

Yes, via `delayMs`, but with two caveats:

1. The delay happens **before the first yield** (provider.ts:396), so nothing streams to the transcript
   until it elapses — the node will show as started (workflow event `node_started` fires before the
   provider is even invoked, at the executor level, so "running" status is independent of any yields)
   but the transcript pane will show nothing until the delay ends. This is fine for "hold the turn open
   so a human can act" purposes — the room's status badge flips to `running` immediately regardless.
2. `delayMs` is currently exercised only in a **unit test** (`provider.test.ts:431-433`,
   `throws Query aborted during delayMs`), never in an e2e fixture — no existing `.yaml` fixture under
   `e2e/fixtures/workflows/` uses `delayMs`. A new fixture is needed.
3. Separately, `E2E_FAKE_LOOP_DONE`/loop nodes are the only existing multi-turn construct
   (`e2e-hitl-run.yaml`'s `inspect-twice` loop, 2 iterations via `until: E2E_LOOP_DONE`), but loop
   iterations are driven by the workflow engine re-invoking the SAME node with
   `$LOOP_PREV_OUTPUT`/`$LOOP_USER_INPUT` substitution, not by `persist_session`/`resumeSessionId` —
   different mechanism than a queued-message resume, and probably not what "turn N+1 on the same
   session" means here. `persist_session: true` (workflow-level `persist_sessions: true`) is the
   correct AGENTS.md-documented mechanism for "provider session continuity across separate node
   invocations", and `E2eFakeProvider.sendQuery(prompt, cwd, resumeSessionId, options)` already threads
   `resumeSessionId` (provider.ts:374,393-394: `sessionId = resumeSessionId ?? new`, `resumed = resumeSessionId !== undefined ? true : undefined`) so session resume plumbing works today.

### (c) `sessionResume` capability

**Confirmed `true`.** `E2E_FAKE_CAPABILITIES.sessionResume = true`
(`packages/providers/src/e2e-fake/capabilities.ts:16`), with an explanatory comment that it's on
specifically because `provider.ts` "actually calls `NativeTool.handler`, propagates
`AskHumanAwaitingError`, and consumes `resumeInteractions`" — i.e. today's `sessionResume: true` is
justified by the AskHuman-answer resume path, not by a generic "resume with new prompt" path. Test
`provider.test.ts:441-446` asserts `sessionResume`/`nativeTools`/`askHuman` are the only capabilities on.

### What must be added for "hold turn open N seconds, then end; on resumed turn echo the prompt"

Estimate (read-only scout — no code written):

1. **New scenario field**, e.g. `echoPromptOnResume: boolean` (or reuse a delay + unconditional echo),
   added to `scenarioSchema` in `provider.ts:128-139` with a `.superRefine` compatibility check similar
   to the existing `taskDispatch` mutual-exclusion block (`provider.ts:140-153`) if it should be
   mutually exclusive with `emitTool`/`askHuman`.
2. **New branch** in `sendQuery` alongside the existing `resumeInteractions` early-return
   (`provider.ts:402-417`): when `resumeSessionId !== undefined` AND `resumeInteractions` is
   empty/undefined AND the scenario carries the new flag, yield an assistant chunk containing the
   (directive-stripped) `promptOutsideDirectives` value computed at `provider.ts:483-487` — that
   computation already exists later in the function for the `doneWhenPromptIncludes` check and would
   need to move earlier or be duplicated for this branch — then yield the terminal `result` chunk with
   `resumed: true`.
3. **A held-open first turn**: reuse `delayMs` on the FIRST invocation (no `resumeSessionId`) so the
   node stays `running` long enough for Playwright to drive the queue action through the new dock/API
   before the first turn ends. The first turn must end (yield `result`) with `resumed` unset/false and
   a real `sessionId`, and the workflow node must be configured with `persist_session: true` so a
   SECOND invocation of the same node (triggered by the new `/send` endpoint appending/queuing a
   follow-up turn) resumes with `resumeSessionId` set to that same session id.
4. **New e2e fixture YAML** under `e2e/fixtures/workflows/`, e.g. `e2e-composer-dock.yaml`, single node,
   `persist_session: true`, prompt directive
   `{"delayMs": 3000}` on turn 1. How the SECOND turn's prompt/directive is supplied depends entirely on
   how the new `/send` endpoint is wired server-side (out of scope here — see `scout-server`); at
   minimum the fake needs the new echo flag present in whatever prompt text that second invocation
   receives.
5. **Runtime plumbing** in `e2e/lib/playwright/archon-runtime.ts`: a new `startXWorkflow()` following
   the exact non-blocking `startHitlWorkflow` shape (`archon-runtime.ts:598-620`: `spawnCli` instead of
   awaited `runCli`, returns `{ pid, runId: waitForRunId(...), wait }` so Playwright can poll while the
   CLI process is still running) — the existing `runTodoStripWorkflow`/`runHitlWorkflow` helpers all
   `await` the CLI to full completion, which is unusable for "interact while running." `waitForRunStatus(runId, 'running', ...)`
   (`archon-runtime.ts:653-668`, currently only used with `'paused'`) is already generic enough to poll
   for `'running'` directly with no change.

## 6. Where the dock mounts (co-location precedent)

Both shells already have a **bottom-anchored conditional element inside the same `RoomRegion`** that
the dock should sit beside/after:

- Legacy: the "Jump to latest" button (`NodeTranscriptPane.tsx:406-411`), rendered conditionally when
  `!follow.follow && (rowStatus === 'running' || rowStatus === 'awaiting')`, mounted as the last child
  of `RoomRegion`, sibling to the scroller. The dock should mount as a new sibling immediately after it
  (or after `{scroller}` if the two should swap order — jump button arguably wants to stay visually
  just above the dock, not below it).
- Console: the same button, same condition, same position, at `ConsoleNodeRoom.tsx:895-903`, last child
  of its local `RoomRegion`.
- The AskHuman answer UI (`AskCard`/`ConsoleAskCard`) is NOT bottom-anchored — it renders **inline in
  the transcript**, anchored to its tool call via `renderAfterItem`
  (`NodeTranscriptPane.tsx:394-401`, `ConsoleNodeRoom.tsx` equivalent) or appended at the end via
  `renderAtEnd` for unanchored asks (`NodeTranscriptPane.tsx:402`). It is therefore NOT the layout
  precedent for "pinned to the bottom of the panel" — the Jump button is. But it IS the precedent for
  the write-action controller shape (see below) and for the disabled/blocked-styling question.
- Both `RoomRegion` implementations are `flex ... flex-col`; a `flex-none` dock as the final child will
  pin correctly without new CSS. Legacy's variant used by the transcript pane passes `scrollable={false}`
  (`overflow-hidden` on the region — the scroller div inside owns scrolling), Console's region always
  uses `overflow-clip` — in both cases the region, not the window, clips, so a `flex-none` dock at the
  bottom stays visible without extra `position: sticky`/`fixed` hacks.

## 7. Brand tokens / controls to reuse; existing `aria-disabled` and motion-reduce precedent

- Buttons: shadcn `Button` component with `cva`-based `variant`/`size` props at
  `packages/web/src/components/ui/button.tsx:7-56` (`data-variant` attr set for styling hooks). Ad hoc
  buttons elsewhere in these rooms instead use raw `<button type="button" className="...">` with
  utility classes directly (e.g. `text-xs text-primary`, `NodeTranscriptPane.tsx:408`;
  `rounded-md border border-border px-3 py-2 text-sm text-text-primary`, `AskCard.tsx:351-357`) — both
  patterns coexist; either is acceptable precedent, `Button` is more consistent with newer code.
- `font-mono` + small-caps-style labels: e.g. `TodoStrip.tsx:109-111`
  (`text-[10px] font-bold uppercase tracking-[0.07em] text-text-secondary`) is the established
  "eyebrow label" style — a good match for a `this tab only` or `QUEUED · n` label.
- Muted/secondary text: `text-text-secondary` / `text-text-tertiary` tokens used throughout
  (`NodeRoom.tsx` badge tones, `TodoStrip.tsx` meter tones) — no raw hex values anywhere, all via CSS
  custom properties defined in `packages/web/src/index.css:9-31` (`--text-secondary`, `--text-tertiary`,
  `--warning`, `--accent-bright`, `--running` (Console-only), etc.), consumed via Tailwind's
  `@theme inline` mapping further down the same file.
- `aria-disabled` precedent: **none found** in `packages/web/src` — every existing disable-on-condition
  case uses the native `disabled` attribute (e.g. `<Button disabled={!draftValid}>` `AskCard.tsx:368`,
  `<fieldset disabled={lockAnswers}>` `AskCard.tsx:273`). The dock's `aria-disabled` + focusable-with-reason
  requirement (so a screen-reader user can discover _why_ Queue is blocked via `aria-describedby`) is a
  **new pattern for this codebase**, not a reuse of an existing one — implement it as `aria-disabled={true}`
  (NOT the native `disabled` prop, which would drop it from the tab order and make the reason
  undiscoverable) plus a manual `onClick`/`onKeyDown` no-op guard.
- `aria-describedby` id-pairing precedent: `ConsoleAskCard.tsx:365-374` /
  `AskCard.tsx` decline-dialog equivalent — `aria-describedby={\`${interaction.id}:decline-description\`}`
  paired with a `<p id={...}>` — same colon-suffixed id-scoping convention should be reused for the
  block-reason text (e.g. `` `${nodeId}:send-blocked-reason` ``), generated via `useId()` per existing
convention (`TodoStrip.tsx:90`, `NodeRoom.tsx` `rawPanelId = useId()`).
- `prefers-reduced-motion`: **no global `@media (prefers-reduced-motion)` block exists** in
  `packages/web/src/index.css`. The established pattern is Tailwind's `motion-reduce:` variant applied
  per animated element: `motion-reduce:transition-none` on the todo-strip caret rotation
  (`TodoStrip.tsx:147`) and on the tool-row disclosure chevron rotation
  (`NodeRoom.tsx:583` / `SubtaskCard` chevron). Any transition the dock adds (e.g. a queue-count pulse,
  a slide-in) should follow this same per-element `motion-reduce:` utility rather than introducing a
  new global media query.

## Precedent for the send/queue controller logic

`ask-answer-controller.ts` (Legacy: `packages/web/src/components/workflows/ask-answer-controller.ts`;
Console: `packages/web/src/experiments/console/components/ask/ask-answer-controller.ts`, byte-for-byte
parallel) is the closest existing shape for a per-node write-action controller and should likely be the
template for a new `send-controller.ts`:

- `submit(requestId, answer)` — here it would be `submit(nodeId, text)` or similar.
- `inFlight: Set<string>` dedupe guard so a double-click/double Cmd+Enter doesn't double-post.
- Phase state machine (`'sending' | 'accepted' | 'rejected-late' | 'error'`) — for the dock this maps to
  something like each queued message getting its own lifecycle, feeding the `QUEUED · n` count.
- 409 handling via `getApiErrorStatus(error) === 409` (`api.ts` exports `getApiErrorStatus`,
  `ask-answer-controller.ts:57-61`) is the existing pattern for "the interaction resolved out from under
  you elsewhere" — likely relevant if a pending AskHuman/permission appears mid-type and the send should
  now be rejected/blocked.
- `invalidate: () => Promise<void>` callback pattern to trigger a react-query refetch after a successful
  write (`ask-answer-controller.ts:23-38`) — the dock's `submit` should likely invalidate the same
  `['workflowRun', runId]` query key (Legacy) / trigger Console's equivalent refetch so `pendingInteractions`
  and node status reflect the new queued/sent state promptly instead of waiting for the next poll tick.

Status: DONE
Summary: Mapped both node-room shells' component trees, live-update pollers, and the exact `RoomRegion` mount point for a bottom-pinned dock (after the Jump-to-latest button, still inside the region); found precedent for the API helper (`answerAskHuman`), the write-action controller (`ask-answer-controller.ts`), Cmd/Ctrl+Enter keyboard handling (`ApprovalPanel.tsx:116`), and `motion-reduce:` usage — and confirmed the e2e-fake provider has no prompt-echo-on-resume path today, needs a new scenario flag plus a non-blocking CLI-spawn runtime helper (mirroring `startHitlWorkflow`) to prove a queued message reaches turn N+1.
Concerns/Blockers: The server-side `/send` route and its Zod schema are out of scope for this (web-only) scout — `api.generated.d.ts` must be regenerated (`bun --filter @archon/web generate:types` against a running dev server) only after that route exists, and Console's `console-isolation.test.ts` approved-lib allowlist (line ~114) will need the new dock's `@/lib/*` imports (if any) added explicitly or the dock kept self-contained.
