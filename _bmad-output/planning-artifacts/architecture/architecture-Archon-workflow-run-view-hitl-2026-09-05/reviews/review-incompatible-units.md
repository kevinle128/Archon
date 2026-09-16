---
type: adversarial-review
method: incompatible-units
spine: ARCHITECTURE-SPINE.md
scope: Archon Workflow Run View HITL (CAP-1–7 + Permission envelope)
method_detail: Two independent units one level down, each obeying every AD to the letter, then compared for build-time or runtime incompatibility
verdict: NEEDS FIXES — 5 incompatible pairs found; each requires a new or tightened AD
date: 2026-09-05
brownfield_used:
  - NativeTool.handler is (input) => Promise<string>; Claude/Pi adapters wrap it as SDK tools that expect a string result
  - Concurrent nodes keep streaming when run is paused (shouldContinueStreamingForStatus)
  - IWorkflowStore is the engine's only DB port; core implements it
  - Console must not import production web UI / react-query / @/lib/api functions
  - metadata.approval is single-slot per run
  - Node status is event-sourced, no node status column
  - pauseWorkflowRun(id, approvalContext) always writes metadata.approval and matches WHERE status='running'
  - createWorkflowEvent must not throw
  - Claude/Pi NativeTool schema converters accept only flat string / string-enum / boolean
---

# Adversarial Review — Incompatible Units

## Verdict

**NEEDS FIXES.** Five incompatible pairs were constructed. Each unit fully obeys every adopted AD in isolation. The conflicts are underspecified shared shapes (pairs 1, 3), two owners of one entity (pairs 2, 4, 5), and conflicting state-mutation paths (pairs 2, 5). None require changing the paradigm or dropping an AD; each requires a new or tightened clause so two packages cannot pick different legal implementations.

---

## Pair 1 — `pending_interaction` has a name, not a shape

**ADs obeyed:** AD-1 (keyed `(workflow_run_id, node_id, tool_use_id)`, lifecycle `pending → answered | purged`, engine via `IWorkflowStore` only), AD-7 (ask answer keyed `request_id`; permission confirm keyed `call_id`; responses stay split), AD-8 (additive tables, ER columns present), consistency convention ("one `pending_interaction` shape for Ask + Permission").

**Unit A — `@archon/workflows` (ask-human + schemas)**

Owns `pendingInteractionSchema` per the Types convention. Stores the Ask form in a single JSON `payload` column:

```ts
{
  kind: 'ask',
  status: 'pending',
  tool_use_id: '<sdk id>',
  payload: { question: string, fields: Array<{ id, type, label }> },
  provider_session_id: string,
}
```

`request_id` is not a column — the convention says `request_id = tool_use_id`, so the handler never writes a separate id. Permission (dormant) would reuse `kind: 'permission'` inside the same blob. `IWorkflowStore.insertPending(row)` is the only engine write.

**Unit B — `@archon/server` + both UI surfaces**

Owns route Zod in `packages/server/src/routes/schemas/` (same Types convention). Models the OpenAPI answer body and a GET-run embedding with **first-class columns** the ER diagram never forbade adding:

```ts
{
  kind: 'AskHuman',           // not 'ask'
  request_id: string,         // separate UUID, not tool_use_id
  call_id: string | null,     // permission
  question: string,
  options: string[],
  answers: Array<{ key: string, value: string }>,
}
```

The POST path is `/ask/:requestId/answer` — no `node_id`. Unit B looks up by `request_id` alone. Console hand-writes this shape (AD-4 forbids `@/lib/api` function imports; it does not grant `api.generated.d.ts` either, so console does not share Unit A's Zod). Legacy consumes `api.generated.d.ts` from Unit B's route schema.

**The incompatibility:** Core's store-adapter is the only implementation of `IWorkflowStore` and also the HTTP CAS writer (`workflow-operations.ts`). It cannot satisfy both shapes. If it persists Unit A's `payload` blob, OpenAPI cards render empty `question`/`options`. If it persists Unit B's columns, the executor/handler cannot round-trip `provider_session_id` or the field list it closed over. `kind: 'ask'` vs `kind: 'AskHuman'` fails `safeParse` on one side. Two concurrent asks on different nodes can share a `request_id` lookup that ignores `node_id` (route has no node id) while the unique key includes `node_id` — or Unit B's separate UUID never matches the handler's `tool_use_id`. Permission `call_id` has no column in Unit A's row and no specified equality with `tool_use_id`.

Two Zod homes are explicitly sanctioned; nothing says they must be the same type. No GET pending list is in the route seed, so each surface also invents a read DTO.

**AD to add/tighten:** Name **one** canonical `pendingInteractionSchema` in `packages/workflows/src/schemas/`. Server route schemas **import** it (or `.extend` it); they do not fork it. Enumerate DB columns: `workflow_run_id`, `node_id`, `tool_use_id` (this **is** Ask `request_id` and Permission `call_id`), `kind` (`'ask' | 'permission'`), `status`, `envelope` JSON (form/prompt; no answer body), `answer` JSON nullable, `provider_session_id`, `created_at`, `resolved_at`, `resolved_by`. GET `/api/workflows/runs/:runId` includes `pending_interactions: PendingInteraction[]` (the card read path). Lookup for POST answer/confirm is `(run_id, tool_use_id)` — `tool_use_id` unique per run, so the path param is unambiguous without `node_id`. Console may import `api.generated.d.ts` **types only**.

---

## Pair 2 — Two owners of run pause/resume, and `pauseWorkflowRun` still stamps `metadata.approval`

**ADs obeyed:** AD-1 (AskHuman never rides the approval slot; declared gates keep `ApprovalContext`), AD-2 (on Ask: persist pending, tear down that node's `sendQuery`, `pauseWorkflowRun`; last pending row resolves → `resumeWorkflowRun`; siblings may finish via `shouldContinueStreamingForStatus`), AD-5 (handler persists + throws; executor catches), AD-7 (operations CAS on answer).

**Unit A — `@archon/workflows` dag-executor**

The only pause primitive on `IWorkflowStore` is:

```ts
pauseWorkflowRun(id: string, approvalContext: ApprovalContext, extraMetadata?: Record<string, unknown>): Promise<void>
```

Brownfield: that function **always** writes `metadata.approval` and `UPDATE … WHERE status = 'running'`. Unit A obeys AD-2 by calling it. To compile, it passes a synthetic `ApprovalContext` `{ nodeId, message: question, type: 'ask' }` — the pending **table** is still the Ask source of truth, so they argue they did not "ride the slot." First Ask pauses the run. A concurrent sibling (still streaming, AD-2 / brownfield) also invokes AskHuman: persist a second pending row, catch branded error, call `pauseWorkflowRun` again → **zero rows** (`status` is already `paused`) → throw → sibling node **fails**. AD-2 said siblings may finish; it did not say a second Ask is a legal no-op pause.

Unit A does **not** call `resumeWorkflowRun`. It treats pause like `executeApprovalNode`: leave the run paused and wait for an external resume.

**Unit B — `@archon/core` workflow-operations**

HTTP answer CAS-updates the pending row (AD-7). When `count(pending)=0`, it calls `resumeWorkflowRun` — the existing gate resume, which clears `metadata.approval` / `approval_response` and expects a paused run. If Unit A wrote a synthetic approval, resume also clears that object (side-effect on a slot AD-1 said Ask must not use). If a declared gate later in the DAG had left a real `ApprovalContext` (it shouldn't have started — next layer halted — but a prior resolved gate's object can still sit in metadata until the next pause overwrites it), Ask-resume mutates gate state.

Unit B is a legal owner: AD-7 puts CAS in operations; AD-2 says the run resumes when the last pending resolves. Nothing says the executor must not **also** resume after `interaction_resolved`. If the executor is later wired to resume on that event, first caller wins and the second throws `WorkflowNotResumableError`.

**The incompatibility:** Ask pause **cannot** be implemented without writing `metadata.approval` unless the port changes — and AD-1 forbids sharing that slot. Concurrent Asks cannot pause twice. Resume has two lawful callers (executor last-pending watcher vs operations CAS). `IWorkflowStore` is the engine's only DB port, but operations live in core and may SQL-update `pending_interactions` **and** call `resumeWorkflowRun` directly, bypassing any new store methods Unit A added for "last pending → resume" atomicity. Result: dummy approval slot pollution, failed sibling nodes, or double-resume.

**AD to add/tighten:** Split pause reasons. `pauseWorkflowRun` for Ask **must not** write `metadata.approval` (optional `approvalContext`; Ask passes none). Ask pause is **idempotent**: already-`paused` + insert another pending row is success, not `not in running state`. **One resume owner for Ask:** `workflow-operations` CAS that transitions the last `pending` row to `answered|purged` is the only caller of `resumeWorkflowRun` for this feature; it must be one transaction with the row update. The executor never resumes an Ask pause itself — it only re-enters on the existing hydrate-when-running path. Declared-gate pause/resume is unchanged and still owns `metadata.approval`. Concurrent sibling Ask: persist + teardown that node; do not fail the node if the run is already paused.

---

## Pair 3 — `AskHuman` handler throw vs provider string wrap (and a schema the converters reject)

**ADs obeyed:** AD-5 (`NativeTool.handler` stays `Promise<string>`; handler must **not** return a normal tool-result string; persist pending, abort that node's `sendQuery`, throw a branded awaiting error the executor catches; providers **only register**), AD-6 (unsupported providers never reach mid-run).

**Unit A — `@archon/workflows` ask-human.ts**

Defines `AskHuman` with a form-capable `inputSchema` (question plus an array of fields — the model must be able to describe what it wants). Handler: persist pending via store, then `throw new AskHumanAwaitingError(...)`. Never returns a string. `manage_run` is untouched. Injected on every capable agent node.

**Unit B — `@archon/providers` Claude + Pi (register only)**

Does not special-case `AskHuman` (AD-5: providers only register). Existing wrappers:

- Claude `buildArchonMcpServer`: `text: await spec.handler(args)` into MCP `CallToolResult`
- Pi `buildPiNativeToolDefinitions`: same, into `{ content: [{ type: 'text', text }] }`

`NativeTool` docs: handler is expected to return text rather than throw; adapters add no safety net. A throw becomes an SDK tool-error result (or an uncaught agent-loop failure) — **not** a `sendQuery` rejection the executor catches. Persist already ran → pending row exists, run still `running`, no `pauseWorkflowRun`.

Independently, both converters accept only **flat string / string-enum / boolean**. Unit A's array/object `inputSchema` throws at MCP/Pi tool build time. Because AD-5 injects AskHuman **by default** on Claude/Pi, **every** agent node fails at `sendQuery` setup, including runs that never ask.

**The incompatibility:** The durable trigger is "intercept the tool invocation," but the brownfield wrap turns the handler into a string-returning SDK tool. Unit A cannot abort `sendQuery` from inside that callback; it can only throw. Unit B must not catch/stringify if the executor is to see the brand — but "only register" forbids a special case. The input schema the workflows unit needs is illegal in the provider converters the register-only path will use. Split brain (pending row, no pause) **or** total inability to start capable agent nodes.

**AD to add/tighten:** Promote `AskHumanAwaitingError` into the `sendQuery` / `NativeTool` contract in `@archon/providers/types`. Provider wrappers **must not** convert this class into a tool-result string; they abort the in-flight query and **reject** `sendQuery` with the same error. Other throws remain tool errors. Persist-then-throw in the handler is the atomic handshake (store write first; abort is the reject). `AskHuman.inputSchema` is constrained to the converters' flat string/enum/boolean subset **or** the converters are extended in this same change — pick one in the AD; do not leave it to each package. `manage_run` still returns `Promise<string>`.

---

## Pair 4 — Three lawful projectors of `awaiting`, and no specified card read path

**ADs obeyed:** AD-1 (`awaiting` added to `nodeStateSchema` / `workflowStepStatusSchema` only; no node status column), AD-3 (room reads `workflow_node_messages` only), AD-4 (pure run-graph; each surface owns its shell), AD-7 (events `node_awaiting` / `interaction_resolved`; surfaces refetch REST, do not reconstruct cards from the SSE buffer), AD-8 (run chrome = `paused` ∧ count(pending)>0; node chrome = `nodeState === 'awaiting'`).

Brownfield: node state is event-sourced. `projectLatestEffectiveNodeStates` maps `node_started` → `running`, `node_completed` → `completed`, and ignores unknown types. Server `workflowNodeStateSchema.status` is `pending|running|completed|failed|skipped` (a **third** enum, not `nodeStateSchema`). Legacy `buildDagNodeStatesFromEvents` maps unknown `node_*` events to **`skipped`**, and overwrites a previous `running` when `status !== 'running'`. `createWorkflowEvent` must not throw — `node_awaiting` can vanish while the pending row remains.

**Unit A — `@archon/workflows` projector + executor**

Adds `awaiting` to engine `nodeStateSchema`. Emits `node_awaiting` (AD-7). Updates `projectLatestEffectiveNodeStates` so `node_awaiting` → `awaiting` and `interaction_resolved` does not complete the node. Resume hydrate uses this projector. Engine-internal `NodeState` is correct.

**Unit B — `@archon/server` GET run + `@archon/web` WorkflowExecution + console**

AD-7 says refetch REST; the only seeded routes are the two POSTs. Unit B therefore:

- Leaves `workflowNodeStateSchema.status` without `awaiting` (AD-1 said add it to **engine** schemas; the server schema is a parallel OpenAPI enum). GET `nodeStates[].status` stays `running` (last lifecycle event is still `node_started`).
- Legacy continues to rebuild DAG nodes from `events` for loop enrichment (`buildWorkflowDagNodeStates`). A `node_awaiting` event becomes `skipped`, overwriting `running`.
- Console cannot import `@/lib/api` functions (AD-4). It fetches GET run with a hand-typed client. Run chrome uses AD-8 (`paused` + it counts `events` of type `node_awaiting` minus `interaction_resolved`) because `pending_interactions` is not on the payload (Pair 1). Transcript `status` kinds (AD-3) are a third overlay for the room card.

Graph input (AD-4) is unspecified. Legacy passes `nodeStates` with `running`/`skipped`. Console passes a structure that includes `awaiting` derived from pending counts. Taken-path classification disagrees: awaiting node is on-path in console, skipped/idle in legacy.

**The incompatibility:** Node chrome never agrees. Engine hydrate thinks the node is `awaiting` (re-enter). GET run says `running`. Legacy graph says `skipped`. Run chrome may show "awaiting input" while the node card shows a skipped/running agent. Cards have no mandated GET field, so one surface stitches Ask cards from transcript `kind: 'status'` rows and the other from event pairs — AD-3 said the room reads the transcript table **only**, which lets a surface **refuse** to read the pending table for cards (put a status row in the transcript instead). Two owners of the card entity: pending table vs transcript status rows.

If `node_awaiting` is lost (`createWorkflowEvent` swallows), Unit A's projector never sees awaiting; Unit B's pending-count chrome still does.

**AD to add/tighten:** One projector function in `@archon/workflows` is the only node-state SoT (`node_started`→`running`, `node_awaiting`→`awaiting`, no `node_completed` until the node actually completes, `interaction_resolved` does not change node state). Server `workflowNodeStateSchema.status` **must** include `awaiting` and GET `nodeStates` **must** use that projector. Surfaces **must not** re-project node status from raw events (legacy `buildDagNodeStatesFromEvents` is not a second lifecycle projector). Cards are **not** transcript rows: they come from `pending_interactions` on GET run (Pair 1). Graph module input type includes `nodeState: NodeState` (with `awaiting`); taken-path treats `awaiting` as active/on-path, never skipped. `node_awaiting` event write must not be best-effort-swallowed relative to the pending insert — same transaction as the pending row, or the projector also reads the pending table.

---

## Pair 5 — "Re-enter the awaiting node" (singular) vs N concurrent Asks, two injectors

**ADs obeyed:** AD-2 (run resumes only when the **last** pending row for the run resolves; re-enter the awaiting node with session restore; do not write `node_completed`; `shouldContinueStreamingForStatus` lets siblings finish — and therefore also Ask), AD-5 (inject on all capable agent nodes in the layer), AD-6 (Claude: new user message, no tool re-issue; Pi: `Agent.continue()` + `ToolResultMessage`; same-process seamless is an optimization), CAP-5 concurrency.

**Unit A — `@archon/workflows` dag-executor resume hydrate**

Two parallel agent nodes both Ask. Two pending rows; neither node has `node_completed`. Last answer → `resumeWorkflowRun`. Hydrate skip-completed re-executes **every** incomplete node in the layer (today's resume). Unit A injects the human payload itself: concatenates `answers[]` into the next `sendQuery` **prompt** as a user message (Claude durable recipe). Session id is read from `workflow_node_sessions` / interactive_loop precedent — not from the pending row. If two answered rows exist for one node (two tool calls in one turn), it injects only the last. Pi gets the same prompt-shaped injection (AD-6's Pi path is "provider," so the executor does not call `continue()`).

**Unit B — `@archon/providers` Claude/Pi sendQuery**

AD-6 binds resume injection to the providers. On the next `sendQuery` with a restored session, each provider loads **answered** pending rows for `(runId, nodeId)` via a new store callback (or a field on `SendQueryOptions`) and injects: Claude = new user message, Pi = `continue()` + `ToolResultMessage`. Executor is expected to call `sendQuery` as a normal re-entry (no answer in the prompt), matching interactive_loop.

**The incompatibility:**

1. **How many nodes re-enter?** AD-2's singular "the awaiting node" lets Unit A instead re-enter only the node whose pending row was last resolved, writing a synthetic `node_completed` for the other awaiting node so skip-completed ignores it — but AD-2 forbids `node_completed` on an asking node. Unit B's hydrate re-enters **both**. One implementation drops a finished Ask's continuation; the other double-runs the last-resolved node if operations already continued it in-process (AD-6 optimization).
2. **Who injects?** If both units ship, Claude sees the answer twice (executor prompt + provider user message). Pi sees a prompt-shaped user turn **and** a `ToolResultMessage`, which is not a valid tool-result continuation. If only Unit A ships, Pi never gets `continue()` + tool result — AD-6 is violated even though the executor "did resume injection."
3. **Session id.** Pending row vs `workflow_node_sessions` vs synthetic `metadata.approval.sessionId` (Pair 2) — three legal places, none named. Wrong session → "resume that cannot re-enter **fails the node and keeps the answer**" (AD-2): one unit fails the node, the other starts a **fresh** session and loses the ask context while keeping the answer, so the model never sees it.

**AD to add/tighten:** On Ask-resume, re-enter **every** node that has no `node_completed` and has ≥1 `answered` pending row (all concurrent awaiting nodes), same layer, same concurrency as the original wave. Do not synthesize `node_completed` for a sibling Ask. **Injection is provider-owned:** executor passes `SendQueryOptions.resumeInteractions: Array<{ tool_use_id, payload, declined }>` (all answered rows for that node, `created_at`/`seq` order) and does **not** stuff answers into the prompt. Claude maps the array to one new user message; Pi maps each item to `ToolResultMessage` + `continue()`. `provider_session_id` is written on the pending row at ask time and is the resume session id; `workflow_node_sessions` is not a second SoT for this path. Same-process seamless resume may skip teardown but must still persist pending and use the same `resumeInteractions` contract.

---

## Summary

| #   | Incompatible pair                                                                                                                                             | Units                                                                         | Governs                            | New / tightened AD                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pending row + OpenAPI + console each invent a different envelope (`payload` blob vs first-class columns; `request_id` ≠ `tool_use_id`; `kind` fork)           | `@archon/workflows` schemas vs `@archon/server` routes (+ console hand types) | AD-1, AD-7, AD-8, Types convention | One `pendingInteractionSchema`; listed columns; `tool_use_id` **is** `request_id`/`call_id`; GET run embeds `pending_interactions` |
| 2   | Ask pause writes `metadata.approval` (only port); second concurrent Ask's pause throws; executor and operations both may `resumeWorkflowRun`                  | dag-executor vs core `workflow-operations`                                    | AD-1, AD-2, AD-7                   | Pause without `ApprovalContext`; idempotent Ask pause; operations CAS is the only Ask resume owner                                 |
| 3   | Handler throw never leaves `sendQuery`; Ask `inputSchema` arrays crash Claude/Pi converters; default inject then breaks every capable agent node              | `@archon/workflows` AskHuman vs `@archon/providers` wrappers                  | AD-5, AD-6, NativeTool brownfield  | Branded error is a `sendQuery` reject; wrappers must not stringify it; schema subset **or** converter extension named in the AD    |
| 4   | Engine projector → `awaiting`; GET `nodeStates` stays `running`; legacy event rebuild → `skipped`; cards read transcript **or** events because no GET pending | workflows projector vs server OpenAPI vs legacy/console shells                | AD-1, AD-3, AD-4, AD-7, AD-8       | One projector; OpenAPI status includes `awaiting`; no second event projector; cards from pending embed, not transcript             |
| 5   | Singular "re-enter the awaiting node" vs N concurrent Asks; executor prompt-injects vs provider AD-6 inject; three session-id homes                           | dag-executor hydrate vs Claude/Pi `sendQuery`                                 | AD-2, AD-5, AD-6                   | Re-enter all awaiting nodes; `SendQueryOptions.resumeInteractions`; pending row owns `provider_session_id`                         |

---

## Out of scope (not counted)

- Permission live cards (explicitly deferred).
- CLI/chat/`manage_run` answer UX (deferred; same REST/store).
- Changing `NativeTool.handler` return type (deferred; Pair 3 keeps `Promise<string>` and tightens propagation instead).
- Per-node independent scheduling past a sibling ask (deferred). The pairs above assume v1 run-level pause, which is enough to break concurrent Asks **inside** that rule.
- `seq` assignment races on `workflow_node_messages` (two writers: executor stream vs pending-status insert) — real, but closing Pair 4's "cards are not transcript rows" removes the status-writer; leftover seq monotonicity can be a one-line store-assigned `seq` when those ports are named.
