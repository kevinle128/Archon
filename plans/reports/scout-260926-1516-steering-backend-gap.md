# Steering Backend Gap Analysis

## Summary

The steering backend is **PARTIAL** across all in-scope stories. The in-memory registry (process-local) is fully implemented with interrupt, idle-await, and FIFO queue logic. The send, interrupt, keepalive, and queue-read routes are defined. However, **durable storage is completely missing** — the contracts require database tables and a steering-store interface, but no migrations exist. Draft persistence, auto-send durability, recovery-required state transitions, and the full message delivery state machine require schema and store implementation. Provider adapters still map interruptSignal but lack full endpoint-to-endpoint conformance evidence.

---

## 1. File Map: Current Steering Implementation

### Live Registry (In-Memory, Process-Local)

| File                                               | Role                                                             | Key Lines                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `packages/workflows/src/steering-registry.ts`      | Volatile FIFO queue, per-turn interrupt handle, idle-await timer | 619–742 (singleton), 202–617 (NodeSteeringHandle) |
| `packages/workflows/src/steering-registry.test.ts` | Registry tests: enqueue/withdraw, interrupts, idle expiry        | Full coverage of in-memory state machine          |

### API Routes (Defined but Partially Registered)

| Route                 | Method | Path                                                           | Status             | Defined | Registered | Handler   |
| --------------------- | ------ | -------------------------------------------------------------- | ------------------ | ------- | ---------- | --------- |
| Send (queue/send_now) | POST   | `/api/workflows/runs/{runId}/nodes/{nodeId}/send`              | ✓ DONE             | 1608    | 5397       | 5398–5493 |
| Interrupt             | POST   | `/api/workflows/runs/{runId}/nodes/{nodeId}/interrupt`         | **PARTIAL**        | 1644    | ❌ NOT YET | —         |
| Keepalive             | POST   | `/api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`         | **PARTIAL**        | 1677    | ❌ NOT YET | —         |
| Queue Read            | GET    | `/api/workflows/runs/{runId}/nodes/{nodeId}/queue`             | **MISSING fields** | 1737    | ❌ NOT YET | —         |
| Withdraw              | DELETE | `/api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}` | ✓ DONE             | 1709    | 5676       | 5677–5756 |
| **Draft Read**        | GET    | `/api/workflows/runs/{runId}/nodes/{nodeId}/draft`             | **MISSING**        | —       | —          | —         |
| **Draft Write**       | PUT    | `/api/workflows/runs/{runId}/nodes/{nodeId}/draft`             | **MISSING**        | —       | —          | —         |
| **Draft Delete**      | DELETE | `/api/workflows/runs/{runId}/nodes/{nodeId}/draft`             | **MISSING**        | —       | —          | —         |
| **Auto-send Write**   | PUT    | `/api/workflows/runs/{runId}/nodes/{nodeId}/auto-send`         | **MISSING**        | —       | —          | —         |

**Queue storage:** In-memory only; `NodeSteeringHandle.pending` (registry.ts:204) holds `QueuedOperatorMessage[]`. No durable backing — server restart loses all queued items, drafts, and auto-send settings.

### Web/Client Steering UI

| File                                         | Role                                             | Status                                         |
| -------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `packages/web/src/lib/steering-dock.ts`      | Composer logic, state machine, draft persistence | Web-side only (sessionStorage); no server sync |
| `packages/web/src/lib/steering-dock.test.ts` | Draft and queue interaction tests                | Aligned with in-memory + session flow          |

### Executor Integration

| File                                        | Key Changes                                                                                | Status                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/workflows/src/dag-executor.ts`    | `beginTurn()` at line 2475, `interruptSignal` in options (2476), idle-await at 3575 & 7209 | **PARTIAL** — interruptSignal wired; operator rows and classification code needs review |
| `packages/workflows/src/node-transcript.ts` | Text row with `origin: 'operator'` + `operator_user_id` + `message_id`                     | Receives operator rows from executor; no schema rows yet                                |

### Schemas (Defined in workflow.schemas.ts)

| Schema                                | Lines   | Status                                                                                                                                                                 |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendWorkflowNodeBodySchema`          | 546–555 | ✓ Matches contract except **missing `queued_message_id?`** for per-item Send now (Story 10.2)                                                                          |
| `sendWorkflowNodeResponseSchema`      | 564–572 | **DIVERGENCE**: `state: queued \| awaiting_send_now` (2 states) vs contract's 6-state enum (queued, awaiting_send_now, dispatching, sent, delivered, delivery_unknown) |
| `interruptWorkflowNodeResponseSchema` | 582–589 | ✓ Correct: `sub_state: idle-after-interrupt \| generating`                                                                                                             |
| `keepaliveWorkflowNodeResponseSchema` | 598–605 | ✓ `{ success: true }`                                                                                                                                                  |
| `steeringErrorSchema`                 | 611–619 | ✓ Nested `{ success: false, error: { code, message } }`                                                                                                                |
| `withdrawWorkflowNodeResponseSchema`  | 641–645 | ✓ Correct                                                                                                                                                              |
| `readWorkflowNodeQueueResponseSchema` | 683–689 | **MISSING**: `execution_state: 'live' \| 'recovery_required' \| 'finished'`; response omits `state` per item                                                           |
| `queuedGuidanceMessageSchema`         | 671–677 | **MISSING**: `state: queued \| awaiting_send_now \| dispatching \| sent \| delivered \| delivery_unknown` per item                                                     |

---

## 2. Routes: Current vs Contract

### Implemented Routes

#### POST `/api/workflows/runs/:runId/nodes/:nodeId/send`

**Request body:** `sendWorkflowNodeBodySchema` (line 546–555)

```zod
{ message: string (non-empty), message_id: uuid, intent: 'queue' | 'send_now' }
```

**Missing:** `queued_message_id?: string` — required for Story 10.2 (per-item Send now in generating state). Contract §§ "Send" row states "Per-item `send_now` claim — `queued_message_id` atomically claims exactly the selected queued message..."

**Response:** `sendWorkflowNodeResponseSchema` (564–572)

```zod
{ success: true, message_id: uuid, state: 'queued' | 'awaiting_send_now' }
```

**Divergence:** Response state enum has 2 states; contract defines 6 (queued, awaiting_send_now, dispatching, sent, delivered, delivery_unknown). Current implementation returns only the inbound acceptance state, not the durable delivery state. Story 7.1 ("Add durable steering storage") and 10.3 ("Preserve every unmatched message") require this distinction.

**Handlers:** Line 5397–5493. Correctly checks lifecycle, validates run/node, gates on handle existence (422 `not_steerable_here` if no live handle). **Missing durable store:** no database write before returning 200 — all state is in-memory.

#### POST `/api/workflows/runs/:runId/nodes/:nodeId/interrupt`

**Status:** Defined (1644–1675) but **NOT REGISTERED** in the route table (~5500).

**Response:** `interruptWorkflowNodeResponseSchema` (582–589)

```zod
{ success: true, sub_state: 'idle-after-interrupt' | 'generating' }
```

**Contract alignment:** ✓ Correct. Returns the actual classified outcome after the interrupt settles, not a guess.

**Missing handler registration.** Handler stub at line 1709+ awaits the registry's `interrupt()` promise. No handler code yet for the async settlement.

#### POST `/api/workflows/runs/:runId/nodes/:nodeId/keepalive`

**Status:** Defined (1677–1707) but **NOT REGISTERED**.

**Response:** `keepaliveWorkflowNodeResponseSchema` (598–605)

```zod
{ success: true }
```

**Contract alignment:** ✓ Correct. Bodyless, no durable write, only re-arms the live idle-await timer.

**Missing handler code and registration.**

#### DELETE `/api/workflows/runs/:runId/nodes/:nodeId/queue/{messageId}`

**Status:** ✓ **DONE** — Defined (1709) and registered (5676).

**Schema:** `withdrawWorkflowNodeParamsSchema` (629–635), response `withdrawWorkflowNodeResponseSchema` (641–645).

**Handler:** 5677–5756. Correctly validates run/node, checks handle, calls `handle.withdraw(messageId)`. No durable store — in-memory only.

#### GET `/api/workflows/runs/:runId/nodes/:nodeId}/queue`

**Status:** ✓ **DEFINED** (1737–?), **NOT REGISTERED** yet.

**Response schema:** `readWorkflowNodeQueueResponseSchema` (683–689)

```zod
{ success: true, queued: [{ message_id: uuid, message: string }] }
```

**Divergences from contract:**

1. **Missing `execution_state` field** — contract requires `execution_state: 'live' | 'recovery_required' | 'finished'` on every response to distinguish live handles from recovery-required durable restoration (Story 7.4).
2. **No `state` field per item** — contract requires each queued item to carry its delivery state: `'queued' | 'awaiting_send_now' | 'dispatching' | 'sent' | 'delivered' | 'delivery_unknown'`. Currently only message_id and text are returned.
3. **No `Cache-Control: no-store` header** — contract mandates this on every outcome (live/error) to prevent cache poisoning on shared proxies.

**Handler:** Not yet registered. Will need to project execution_state and construct per-item state from durable store + live handle state.

### Missing Routes Entirely

#### GET `/api/workflows/runs/:runId/nodes/:nodeId}/draft`

**Contract:** Read the acting operator's server-side draft and auto-send setting.
**Response:** `{ success: true, draft: { message: string, updated_at: string } | null, auto_send: boolean }`

**Current state:** ❌ **NOT IMPLEMENTED**. Web stores draft in sessionStorage only (steering-dock.ts:99 `STEERING_SEND_HINT = '… this tab only'`).

**Needed for:** Story 7.2 (Save and restore composer drafts).

#### PUT `/api/workflows/runs/:runId/nodes/:nodeId}/draft`

**Contract:** Upsert the acting operator's draft after debounced composer changes.
**Request:** `{ message: string }`
**Response:** `{ success: true, draft: { message: string, updated_at: string } | null, auto_send: boolean }`

**Current state:** ❌ **NOT IMPLEMENTED**. No server persistence.

**Needed for:** Story 7.2.

#### DELETE `/api/workflows/runs/:runId/nodes/:nodeId}/draft`

**Contract:** Clear the acting operator's saved draft idempotently.
**Response:** `{ success: true }`

**Current state:** ❌ **NOT IMPLEMENTED**.

**Needed for:** Story 7.2.

#### PUT `/api/workflows/runs/:runId/nodes/:nodeId}/auto-send`

**Contract:** Persist the acting operator's auto-send setting for this node.
**Request:** `{ enabled: boolean }`
**Response:** `{ success: true, enabled: boolean }`

**Current state:** ❌ **NOT IMPLEMENTED**. No durable setting storage.

**Needed for:** Story 7.5 (Support durable auto-send mode).

---

## 3. Per-Story Implementation Status

### Epic 7: Make Drafts and Guidance Durable

#### Story 7.1: Add durable steering storage

**Acceptance Criteria:** Additive schema for drafts, queue, delivery state, timestamps, auto-send settings; both SQLite/PostgreSQL parity.

**Status:** ❌ **MISSING**

**Needed Changes:**

1. **New tables in `migrations/000_combined.sql` (additive-only, both dialects):**
   - `remote_agent_steering_drafts` (runId, nodeId, user_id → draft, updated_at)
   - `remote_agent_steering_queue_entries` (runId, nodeId, message_id → message, user_id, state, timestamps, attempt_count, last_error)
   - `remote_agent_steering_auto_send` (runId, nodeId, user_id → enabled)
   - Indexes in trailing "Indexes and column comments" section (per AGENTS.md #2508 rule)

2. **New store interface** at `packages/core/src/db/steering-store.ts`:
   - Draft CRUD: saveDraft, getDraft, clearDraft
   - Queue CRUD: queueMessage, updateMessageState, withdrawMessage, readQueue
   - Auto-send: setAutoSend, getAutoSend
   - Restoration after restart: getRecoveryState

3. **Schema mirror** in `packages/core/src/db/adapters/sqlite.ts` `createSchema()` — SQLite is hand-maintained.

4. **Generated files:** Run `bun run generate:bundled-schema` after migration changes.

5. **Parity test:** `packages/core/src/db/sqlite.test.ts` will verify both dialects match columns/indexes.

6. **CI validation:** `bun run check:schema-upgrades` requires live PostgreSQL.

#### Story 7.2: Save and restore composer drafts

**Acceptance Criteria:** Draft persisted per (operator, run, node); restored on reload/restart; cleared on send/delete.

**Status:** ❌ **PARTIAL**

**Current:** Web sessionStorage only (steering-dock.ts).
**Missing:** Server persistence routes and store operations.

**Needed Changes:**

1. Draft schema table (Story 7.1 prerequisite).
2. Routes: GET/PUT/DELETE `/api/workflows/runs/:runId/nodes/:nodeId/draft`.
3. Handler logic: Auth context resolves `operator_user_id`; store operations scoped to (runId, nodeId, operator_user_id).
4. Web integration: Call PUT on blur/debounce; GET on mount to restore; DELETE on send.
5. Executor: On recovery (Story 7.4), restore draft from store for display.

#### Story 7.3: Preserve the shared queue and FIFO order

**Acceptance Criteria:** One durable queue with transactional FIFO order; idempotent on message_id; concurrent withdrawal is atomic.

**Status:** ❌ **PARTIAL**

**Current:** In-memory registry with `Map<messageId, Entry>` and `pending: QueuedOperatorMessage[]` (registry.ts:204). No durability, lost on restart.

**Missing:**

1. Queue schema table with FIFO ordering (sequenced PK or timestamp + messageId composite).
2. Durable accept/withdraw operations atomic in one transaction.
3. Per-item state tracking: 'queued' | 'awaiting_send_now' | 'dispatching' | 'sent' | 'delivered' | 'delivery_unknown'.
4. Failure evidence recording (last_error column) for delivery-unknown and failed states.

**Needed Changes:**

1. Queue schema (Story 7.1).
2. Store operations: atomically accept (idempotent on messageId), atomically withdraw.
3. Executor: Load durable queue on run resume; reconstruct live handle state from durable rows.
4. API response: Include `state` field per item in queue read (fixes readWorkflowNodeQueueResponseSchema).

#### Story 7.4: Recover guidance after server restart

**Acceptance Criteria:** Durable data restored; no live provider assumed; Node Room read-only, directs to Resume.

**Status:** ❌ **PARTIAL**

**Current:** Executor can call `register()` to restore a handle, but only in-memory. No durable state restoration, no "recovery_required" state projection.

**Missing:**

1. On server startup: Load pending durable queue/drafts from DB for every non-terminal run+node pair.
2. Route responses: Detect "no live handle but durable content exists" → return 409 `recovery_required` (currently returns 422 `not_steerable_here`).
3. Node Room: Project `execution_state: 'recovery_required'` when durable data exists but no live handle; show read-only "restored after server restart · Resume the workflow to continue" and no composer.
4. Executor resume: On Resume, if steering durable data exists, transfer it to the newly registered live handle. Do NOT automatically resume or re-send.

**Concrete changes:**

- Executor startup: Call `steeringStore.listRecoveryState()` for durable guidance not yet delivered.
- Route logic: Check `steeringStore.hasPendingGuidance(runId, nodeId)` when live handle is absent → return `recovery_required`.
- API response schema: Add `execution_state` to queue read and other steering responses.
- Web dock: When `execution_state: 'recovery_required'`, hide all mutation controls and show the recovery message.

#### Story 7.5: Support durable auto-send mode

**Acceptance Criteria:** Auto-send setting survives reload/restart; after natural reply, claims one FIFO entry; disabled on Stop; failed dispatch returns item to queue front.

**Status:** ❌ **MISSING**

**Current:** No durable storage.

**Needed Changes:**

1. Auto-send schema table (Story 7.1) per (runId, nodeId, operator_user_id).
2. Route: PUT `/api/workflows/runs/:runId/nodes/:nodeId/auto-send` with body `{ enabled: boolean }`.
3. Executor logic: After each natural turn end, check `steeringStore.isAutoSendEnabled(runId, nodeId)` → atomically claim and dispatch next FIFO item without invoking Stop.
4. Failure handling: If dispatch fails before delivery proven, record failure evidence in queue item state and return it to queue front (not a re-send, a re-ordering).
5. Stop exemption: Interrupted turns never trigger auto-send (per control-states.md).

---

### Epic 8: Stop and Redirect Turns Across Core Providers

#### Story 8.1: Implement the provider-neutral Stop contract

**Acceptance Criteria:** Executor supplies fresh per-turn signal; interruptSignal wired to each adapter; five-case classification; interrupted status distinct from failed.

**Status:** ✓ **MOSTLY DONE** with gaps

**Current:**

- Registry: beginTurn/endTurnStream/settleTurn/enterIdle in place (registry.ts:253–373).
- Executor: Calls `beginTurn()` at 2475, stores token in `passTurn.token`, sets `passOptions.interruptSignal` at 2476.
- dag-executor.ts has classification logic comment at line 567 describing five cases.
- Web: Control-states.md defines `Stop` + `Queue` / `Send now` UI (approved, not yet rendered).

**Provider status:**

| Provider                         | interruptSignal        | Status     | Evidence                                      |
| -------------------------------- | ---------------------- | ---------- | --------------------------------------------- |
| Claude                           | ✓ Observed in SDK      | ❓ PARTIAL | Agent SDK accepts it; no conformance test yet |
| Codex                            | ✓ Should abort turn    | ❓ PARTIAL | No verified turn-abort adapter proof          |
| OMP                              | ✓ Should interrupt RPC | ❓ PARTIAL | RPC mode interrupt not verified               |
| Grok                             | ✓ Should abort stream  | ❓ PARTIAL | No adapter proof                              |
| DeepSeek                         | ✓ Should abort + mark  | ❓ PARTIAL | Abort marker handling unverified              |
| Pi, Copilot, OpenCode, Qoder CLI | ❓ UNKNOWN             | ❌ MISSING | No adapter wiring found                       |

**Missing:**

1. Full executor five-case classification code (comment exists, implementation not verified to completion).
2. Provider adapters: No conformance tests proving each provider's interrupt behavior.
3. Transcript rows for interrupted tools: No evidence found that executor writes `status: 'interrupted'` on completion of an interrupted turn.
4. The `wasOperatorInterrupted()` query at registry.ts:309 is defined but used by the executor for classification — need to verify this is called.

**Needed Changes:**

1. **Executor classification logic** (dag-executor.ts, around line 567 comment):
   - Verify `wasOperatorInterrupted(token)` call after turn settle.
   - Implement five cases: (1) natural, (2) abort + interrupt flag → interrupted, (3) abort exception + flag → interrupted, (4) exception without flag → failure, (5) node-level termination.
   - Write `interrupted` status row via transcript/executor for interrupted turns.

2. **Provider adapters:**
   - Each adapter's `sendQuery()` must observe `options.interruptSignal` and map to native interrupt/abort.
   - Adapter must return/throw provider-normalized evidence (abort result, abort marker in result, abort exception) that the executor can classify.
   - Tests: Provider conformance fixtures for each (Story 8.3–8.7, 9.1–9.4).

#### Story 8.2: Expose Stop through the API and both Node Room shells

**Acceptance Criteria:** Typed route returns current control state; idempotent; `recovery_required` on no live handle; UI shows `Stopping…` transient.

**Status:** ❌ **BLOCKED** (depends on 7.4 `recovery_required` state).

**Route:** Defined but not registered. Handler at ~1644–1675 awaits `handle.interrupt()`. Handler stub assumes registration will happen.

**Needed Changes:**

1. Register `interruptWorkflowNodeRoute` in the route table (after 5676).
2. Implement handler: Resolve auth, check run/node lifecycle, call `handle.interrupt()` and await settlement, return typed response with actual sub_state.
3. Replace 422 `not_steerable_here` with 409 `recovery_required` when durable data exists (Story 7.4 prerequisite).
4. Web UI: Add Stop button to steering dock; show `Stopping…` with `aria-disabled` transient; shift focus predictably on completion.

#### Story 8.3–8.7: Complete provider-specific Stop and soft injection

**Acceptance Criteria:** Each adapter proves Stop, session continuation, optional soft injection, optional delivery acknowledgement through conformance.

**Status:** ❌ **PARTIAL TO MISSING**

**Current:** Adapters accept interruptSignal but conformance is not proven.

**Needed Changes:**

Per provider (8.3 Claude, 8.4 Codex, 8.5 Grok, 8.6 DeepSeek, 8.7 OMP):

1. Adapter: Wire `options.interruptSignal` to native interrupt/abort mechanism.
2. Adapter: Preserve abort result/exception for executor classification.
3. Tests: Conformance fixtures that prove (a) stop targets current turn, (b) next turn not aborted, (c) node+run+session stay active, (d) abort evidence reaches executor, (e) durable queue order preserved.
4. **Soft injection** (per-item Send now): Not in v1 scope except soft injection transport validation. Stories 8.3, 8.5, 8.7 mention this but mark it gated post-v1.
5. **Delivery acknowledgement**: Story 8.3 (Claude) and others mark this also gated post-v1 (G1 gate = SDK version update).

---

### Epic 10: Complete the Approved Mockup Contract

#### Story 10.2: Deliver one selected queued message without Stop

**Acceptance Criteria:** Auto-send indicator; per-item Send now when provider proven; atomic claim; no Stop; `sent` state.

**Status:** ❌ **PARTIAL**

**Current:** Queue read lacks `state` per item; send route lacks `queued_message_id` parameter.

**Needed Changes:**

1. **Schema updates (story 7.1 prerequisite):** Queue item `state` column to track delivery lifecycle.
2. **Send route enhancement:**
   - Add optional `queued_message_id?: string` to `sendWorkflowNodeBodySchema`.
   - Handler logic: If `queued_message_id` provided, atomically claim that item from durable queue and deliver immediately (soft injection) without invoking Stop.
   - If `queued_message_id` absent and `intent: 'send_now'`, behave as current (queue if idle-after-interrupt; queue if generating).

3. **Executor:** When soft injection is used, the provider adapter must accept the message without interrupting the current turn. Return a `sent` state without emitting a turn-start event.

4. **Web UI:** Show per-item `Send now` button only when provider capability is proven (soft injection = true). Read from provider registry.

5. **Response state:** Include `'dispatching'` and `'sent'` states in response schema (currently missing from sendWorkflowNodeResponseSchema).

#### Story 10.3: Preserve every unmatched message at terminal boundaries

**Acceptance Criteria:** Reconciliation at terminal boundaries; unmatched → `NEVER SENT` read-only record; preserved draft/queue on timeout.

**Status:** ❌ **PARTIAL**

**Current:** Executor teardown exists (dag-executor.ts ~3920) but reconciliation logic missing. Web has `reconcileNeverSent()` but lacks durable rows to reconcile against.

**Needed Changes:**

1. **Executor terminal gate:** Before teardown, reconcile durable queue items against written operator transcript rows:
   - Load all `remote_agent_steering_queue_entries` where `state IN ('queued', 'awaiting_send_now', 'dispatching', 'sent')` (not yet delivered/withdrawn).
   - Load all persisted operator rows from transcript for this run+node.
   - For each durable item without a matching transcript row: set `state: 'never_sent'` and record termination timestamp.

2. **Web reconciliation:** On node terminal event, fetch durable queue and compare against observed transcript. Emit "NEVER SENT" alert via role="alert" for unmatched items.

3. **Idle-await timeout (Story 7.5 prerequisite):** When 30-minute inactivity expires, resolve idle-await as `{ kind: 'expired' }`. Executor catches this, fails the node, and reconciliation applies (marks pending items as never_sent).

4. **Web display:** Show `NEVER SENT` items as read-only rows in terminal dock; no send/withdraw/interrupt controls.

---

## 4. Schema Proposal: Additive-Only Constraints

**Migration file:** `migrations/000_combined.sql` (both SQLite/PostgreSQL applied on every boot, idempotent).

**Required changes:**

1. **Add `remote_agent_steering_drafts` table:**

   ```sql
   CREATE TABLE IF NOT EXISTS remote_agent_steering_drafts (
     id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
     run_id TEXT NOT NULL,
     node_id TEXT NOT NULL,
     user_id TEXT,
     message TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(run_id) REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
     UNIQUE(run_id, node_id, user_id)
   );
   ```

2. **Add `remote_agent_steering_queue_entries` table:**

   ```sql
   CREATE TABLE IF NOT EXISTS remote_agent_steering_queue_entries (
     id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
     run_id TEXT NOT NULL,
     node_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     message TEXT NOT NULL,
     user_id TEXT,
     state TEXT NOT NULL DEFAULT 'queued',
     /* states: queued, awaiting_send_now, dispatching, sent, delivered, delivery_unknown, withdrawn, never_sent, failed */
     queue_order INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     last_error TEXT,
     delivery_proof_id TEXT,
     FOREIGN KEY(run_id) REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
     UNIQUE(run_id, node_id, message_id)
   );
   ```

3. **Add `remote_agent_steering_auto_send` table:**
   ```sql
   CREATE TABLE IF NOT EXISTS remote_agent_steering_auto_send (
     id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
     run_id TEXT NOT NULL,
     node_id TEXT NOT NULL,
     user_id TEXT,
     enabled BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(run_id) REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
     UNIQUE(run_id, node_id, user_id)
   );
   ```

**Indexes (trailing "Indexes and column comments" section, per AGENTS.md #2508):**

```sql
CREATE INDEX IF NOT EXISTS remote_agent_steering_queue_entries_run_node
  ON remote_agent_steering_queue_entries(run_id, node_id);
CREATE INDEX IF NOT EXISTS remote_agent_steering_queue_entries_order
  ON remote_agent_steering_queue_entries(run_id, node_id, queue_order);
```

**Mirror into SQLite:** Update `packages/core/src/db/adapters/sqlite.ts` `createSchema()` function with the same table definitions (hand-maintained, not auto-generated for SQLite).

**Generated files after edit:**

- `bun run generate:bundled-schema` — embeds schema in `packages/workflows/src/defaults/bundled-defaults.generated.ts`.
- `bun run check:schema-upgrades` — validates both dialects; requires live PostgreSQL; tests upgrade from historical releases.

**Parity test:** `packages/core/src/db/sqlite.test.ts` verifies SQLite schema matches PostgreSQL after applying both full schemas.

---

## 5. Risks and Unresolved Questions

### Risks

1. **Ambiguous dispatch at restart** — If process crashes after claiming a queue item but before provider delivery, the item becomes `delivery_unknown`. Current design never auto-resends (correct per #1216 principle), but API must reliably return `delivery_unknown` state so the UI can show "NEVER SENT" or "delivery unknown". **Verify:** Executor records attempted delivery before the provider result is final, or only after?

2. **Message state transitions** — The six-state enum (queued → awaiting_send_now → dispatching → sent → delivered or delivery_unknown) assumes a linear path, but soft injection and per-item Send now may reorder transitions (e.g., skip awaiting_send_now). **Need:** Clear state machine diagram in executor comments.

3. **Operator row attribution** — Web resolves `operator_display_name` from `operator_user_id` with a fallback to short-id (steering-api-contract.md §106–110). If the user is deleted, the lookup still works via fallback. **Verify:** Web does not fetch `users` table for this; it uses the short-id fallback. If it does fetch, that's an N+1 issue on large queues.

4. **Draft ownership** — Draft is per (user_id, run_id, node_id). If two operators edit the same node's draft sequentially, later edits overwrite. Contract says "another operator cannot read or overwrite it" but the UNIQUE constraint allows only one per tuple, so this is "cannot read" but can overwrite if they know the tuple. **Clarify:** Is this expected, or should drafts be append-only?

5. **Recovery-required detection** — After restart, routes must detect "durable content exists but no live handle" to return 409. This requires querying `remote_agent_steering_*` tables on every send/interrupt/queue-read call to check if durable rows exist for a non-terminal node. **Risk:** Query cost on high-volume installs. **Mitigation:** Index on (run_id, node_id) and cache in handle registration (if durable data exists on register, populate the handle with it).

6. **30-minute idle-await timer** — This is a product rule (fixed, not configurable). The timer is process-local; server restart discards it. **Verify:** Executor does not autonomously resume or fail the node after restart if idle-await was armed. Node Room shows "recovery required · Resume" and waits for user action.

### Unresolved Questions

1. **Executor writes operator rows before or after provider confirms?** — Story 7.4 mentions "ambiguous dispatch" when the process disappears "after an item is claimed but before delivery can be proven." Does this mean the executor has already written an operator row with `state: 'dispatching'` or `'sent'`, or only after the provider responds? If before, reconciliation must handle existing rows. If after, the durable item becomes `delivery_unknown` and no transcript row is written. **Action:** Read dag-executor.ts around line 3928 ("Counts only — operator message text is never logged") and verify the write-path order.

2. **Which current route returns `recovery_required`?** — Contract defines the 409 status, but current routes return 422 `not_steerable_here` for "no live handle." **Check:** Do any routes already detect durable-only state and return the right code, or is this completely new logic?

3. **Does the executor ever call `steeringStore.recovery()` on Resume?** — Story 7.4 acceptance says "durable values are restored" on restart. The executor must load them. Is this already in dag-executor, or must we add it?

---

## Summary Table: Per-Story Status

| Story                            | Coverage    | Blocker       | Evidence                                                                       |
| -------------------------------- | ----------- | ------------- | ------------------------------------------------------------------------------ |
| 7.1 (Durable storage)            | **MISSING** | None (first)  | Zero schema tables, zero store interface                                       |
| 7.2 (Draft persistence)          | **PARTIAL** | 7.1           | Web sessionStorage; no server routes/store                                     |
| 7.3 (Durable queue)              | **PARTIAL** | 7.1           | In-memory registry exists; no durable backing                                  |
| 7.4 (Recovery after restart)     | **PARTIAL** | 7.1, 7.3      | No `recovery_required` state; no durable restoration logic                     |
| 7.5 (Auto-send mode)             | **MISSING** | 7.1, 7.4      | No schema, no routes, no executor logic                                        |
| 8.1 (Stop contract)              | **PARTIAL** | None          | Registry + executor skeleton in place; adapter conformance missing             |
| 8.2 (Stop API + UI)              | **PARTIAL** | 7.4           | Route defined, not registered; needs `recovery_required` state                 |
| 8.3–8.7 (Provider conformance)   | **PARTIAL** | 8.1, 8.2      | No conformance tests; adapters accept interruptSignal but unverified           |
| 10.2 (Per-item Send now)         | **PARTIAL** | 7.1, 8.3+     | Send route lacks `queued_message_id`; soft injection gates provider capability |
| 10.3 (Never sent reconciliation) | **PARTIAL** | 7.1, 7.4, 7.5 | Executor gate missing; web `reconcileNeverSent` exists but needs durable rows  |

---

## Implementation Roadmap

**Phase 1 (Foundation):**

1. Add schema tables (Story 7.1).
2. Create steering-store interface.
3. Register interrupt/keepalive/queue-read routes; implement handlers.

**Phase 2 (Durability):**

1. Implement draft routes (PUT/GET/DELETE).
2. Integrate store into send route (write durable queue entry).
3. Implement recovery_required state detection and projection.

**Phase 3 (Auto-send & Terminal Reconciliation):**

1. Add auto-send route and executor logic.
2. Implement terminal reconciliation in executor.
3. Complete 30-minute idle-await timeout path.

**Phase 4 (Provider Conformance):**

1. Adapter conformance tests for each provider.
2. Executor five-case classification completion and verification.
3. Capability matrix updates.

---

## Status

**Status: DONE_WITH_CONCERNS**

**Summary:** In-memory steering registry and basic send route are implemented. Durable storage, draft persistence, recovery after restart, and full provider conformance are completely missing or partial. Route registration for interrupt/keepalive/queue-read is pending. Schema must be created (both SQLite and PostgreSQL) before durable feature work can begin. Recommend starting with Story 7.1 (schema) as a blocking foundation.
