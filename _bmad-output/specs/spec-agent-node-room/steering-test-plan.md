# Steering test plan

Coverage that decides whether the write half (CAP-8…13) is met.
The read half is covered by `test-plan.md` (CAP-1…7); this companion covers everything steering changes — engine turn loop, provider interrupt, routes, registry, timer, reconciliation, and the dock on both shells.
`bun run validate` is the pre-PR gate; do not run root `bun test`.

## Fixtures and rule

Build provider fixtures from the SDK type declarations and the measured payloads in `findings.md`, as the read plan does.
**Every applicable table below carries at least one Claude fixture and one non-Claude (omp or codex) fixture** — the providers disagree on interrupt mechanism and on soft-inject transport, so a single-provider table would pass while the other renders or behaves wrong.
Timer tests use fake timers; never a real 30-minute wait.
Process-boundary tests exercise both in-process (web dispatch) and detached (no live handle).

## Engine — the per-node turn loop

- a steering interrupt aborts a **fresh per-turn** signal (`AbortSignal.any` with the node-level one), never the one-shot `nodeAbortController`; the `:3124` Cancel check is not tripped and the node stays `running`
- `operatorInterrupt` placement: `canReask` (`:3032`) also stops on it; validation is skipped on the interrupted turn; the branch sits after the `:3124` Cancel check so a co-firing Cancel wins by position; the flag resets at turn N+1 (a stale flag never mis-routes a later turn)
- the **end-cause five-case rule** (`:2533`, not result-presence alone): (1) `result` with no abort marker → **natural**, spent (no idle-await, no partial validated); (2) `result` with an abort marker (DeepSeek `deepseek_aborted`) + `operatorInterrupt` → **interrupted** → idle-await; (3) a thrown abort (OMP `Query aborted`) caught at `:3332` + `operatorInterrupt` → **interrupted** → idle-await, never `dag_node_failed`; (4) a throw with the flag unset → real `node_failed`; (5) Cancel dominates. Assert the adapter does not suppress the abort `result`
- natural end auto-drains (queued message → turn N+1; empty queue → node completes); interrupted end enters idle-await and drains only on `Send now`
- multi-turn on one session: turn N+1 runs via `attemptResumeId` (`:2290`) with the flushed queue in written order
- the executor writes a single `interrupted` status row at idle-await entry, on every provider
- the sub-state projection emits **exactly two** values (`generating` | `idle-after-interrupt`); `interrupting` never appears in the projected field
- **every engine turn-loop assertion above also runs against `executeLoopNode`** (AI loop nodes are steerable in v1): registry key, per-turn signal, the end-cause rule, sub-state projection, idle-await; plus the loop-only case — `Send now` continues the **interrupted iteration** on the same session before the normal loop-completion check

## Engine — idle-await lifecycle (fake timers)

- 30-minute inactivity expiry takes the explicit fail branch (`interrupted by operator, no redirect received`), never the completing idle timeout
- the timer re-arms on composer keepalive activity (keystroke / focus / keepalive route — **not** `Send now`, which resolves idle-await) and fails only after 30 minutes of genuine inactivity
- the idle-await cancel-poll lets `/workflow cancel` reach the node while no stream exists
- idle-await resolves exactly once — the first of `Send now`, cancel-poll, or timer wins; the other two tear down
- rerunning a 30-minute-failed node via `workflow retry-node` re-runs it with a fresh session

## Providers — interrupt conformance

One fixture per in-use provider; each proves the turn ends and the session survives for a follow-up run.

- claude — native `interrupt()` (in the pinned SDK); the abort yields no terminal `result`
- codex — stream-abort → `resumeThread` re-runs the resumed thread; fixture pins its abort terminal shape (result vs throw vs clean end)
- omp — stream-abort: its abort **throws** `Query aborted` (`provider.ts:317,450`) → fixture asserts the executor routes the throw (with `operatorInterrupt` set) to idle-await, not `dag_node_failed` (its RPC soft-inject is G2, not tested here)
- grok — stream-abort (`interject` unreachable; hooks are G3); fixture pins its abort terminal shape
- deepseek — cancel-and-continue, partial retained: its abort emits a terminal `result` (`stopReason:'aborted'` / `errorSubtype:'deepseek_aborted'`, `acp-client.ts:105`) → fixture asserts the executor classifies it as an **interrupted** end, not natural completion

## Registry and routes

Per `steering-api-contract.md`.

- register `(runId, nodeId) → handle + queue` on node start; tear down on any terminal; a node with no handle is not steerable
- send / interrupt / keepalive match the typed schemas; identity resolves via `resolveAuthContext`
- **actor grant (any authenticated user):** starter → allow, other authenticated member → allow, admin → allow, unauthenticated → 401, identity-less run (`user_id` NULL) → allow — asserted on send AND interrupt AND keepalive
- **interrupt-response race:** a mid-turn interrupt → `sub_state:'idle-after-interrupt'`; a turn that ended naturally with a queued message → `sub_state:'generating'` (auto-drained turn N+1); a natural end with an empty queue → 409 `node_finished`
- 409 `node_finished` (draft stays in the browser); 422 `not_steerable_here` for a detached run (Cancel and `/workflow resume` still work)
- Send during an interrupt in flight waits in the queue for `Send now` — no 409, nothing lost
- invalid run/node id → 404; unauthenticated → 401/403; malformed payload → 400; duplicate `message_id` → idempotent receipt replay; repeated interrupt while idle → idempotent no-op; node goes terminal mid-request → 409
- **withdraw route** (`DELETE …/queue/:messageId`): removes a still-queued message from the registry queue; withdraw of an already-drained or unknown `message_id` → idempotent success no-op; unknown run/node → 404
- every rejected request leaves the node, queue, and transcript unchanged (assert all three)

## Operator row and reconciliation

- the executor is the sole writer; the row is a `text` row with `metadata` `{ origin='operator', operator_user_id, message_id }`; no new table, no widened `kind`; placed by `seq` between the turn it redirected and the turn it caused
- the message stays `sent` on every provider (v1 floor); nothing advances past `sent`
- terminal reconciliation runs **only** on actual node-terminal evidence (persisted `node_completed`/`node_failed`, or exact-scope purged-Ask projection): each observed ledger id matches a written `message_id`; an unmatched id returns as `NEVER SENT`; assert it never runs on a live refetch or on run-level terminal status alone (a Cancel mid-flight must not mis-mark a delivered message)
- **Story 2.11 focused coverage** — core: `packages/web/src/lib/steering-dock.test.ts` (T1.1–T1.22 ledger/reconcile/finished mode); docks: `ComposerDock.test.tsx` + `ConsoleComposerDock.test.tsx` (T2.1–T2.18); server projection: `packages/server/src/routes/workflow-execution-history.test.ts` (T3.1–T3.4 exact-scope purged Ask + nested owners, answered resume guard, fail-closed ambiguity); parents: `execution-room-model.test.ts`, `WorkflowExecution.test.tsx`, `RunDetailPage.test.tsx` (T3.5–T3.14 raw-history helpers + 3 s catch-up); panes: `NodeTranscriptPane.test.tsx` + `ConsoleNodeRoom.test.tsx` (T3.15–T3.26 node-terminal pass-through + node-wide drain); E2E: `e2e/ui/agent-never-sent.spec.ts` (E4.1–E4.5, E4.7–E4.8 Cancel/observer/idle-queue/draft/finished-iteration/focus/visual on both shells), natural-drain negative in `agent-queue-guidance.spec.ts` (E4.6), finished-iteration observer in `agent-finished-iteration.spec.ts`
- display-name projection (AD-12 / Story 2.8): the served operator row carries `operator_display_name` from the read-time join; a non-null sender always gets a trimmed name or the 8-char short id (server-owned fallback); `null` is reserved for identity-less rows; the web does not fetch users

## Concurrent operators

- **Global order is `accept()` order** at `NodeSteeringHandle.accept()` — not browser click order, request-creation order, response-completion order, or any timestamp sort. The node queue is shared and deliberately visible to every permitted reader.
- **Within-sender order** holds only when one dock/request stream waits for its prior send response before sending the next. Two tabs for the same identity are separate streams; the server promises only receipt order across them.
- **No cross-user leakage** means no sender substitution on a written or displayed row (`operator_user_id` / display name stay bound to the originating request). It does **not** mean private per-user queues.
- **Queue GET intentionally omits attribution** — public items are exactly `{ message_id, message }`. Attribution lives on the handle snapshot and on transcript operator rows (`origin`, `operator_user_id`, `message_id`).
- **Characterization map (Story 2.13 / #193):**
  - mixed-sender registry FIFO, idempotent cross-sender duplicate-id replay, and idle `send_now` wake-batch order — `packages/workflows/src/steering-registry.test.ts`
  - deterministic overlapping Hono-route streams (hold A at identity resolution, let B finish, release A) — `overlapping identity streams preserve accept order and request attribution` in `packages/server/src/routes/api.workflow-runs.test.ts`
  - strengthened direct natural-drain, idle `send_now`, and loop-drain mixed-sender paths — `packages/workflows/src/dag-executor.test.ts`
  - full-chain two-operator journeys on both shells — `[V:steer.concurrent-operators-console]` and `[V:steer.concurrent-operators-legacy]` in `e2e/ui/agent-queue-convergence.spec.ts` (observed pre-drain queue order is the oracle for transcript + DOM; sibling node isolation in the same journey)

## Steering UI — end-to-end, both shells

Extend the node-room E2E on **Legacy and Console**.

- **Story 2.10 finished iteration** — `steer.finished-iteration-legacy` and
  `steer.finished-iteration-console` in
  `e2e/ui/agent-finished-iteration.spec.ts` run the existing
  `e2e-queue-guidance-loop` fixture through a real first completed iteration and
  second live iteration. They select the completed row through `Execution`, prove
  the exact read-only disclosure, ordered shared queue band, one successful
  node-scoped queue GET and zero send/withdraw/interrupt mutations, then use
  keyboard Go to restore the live textarea, stored draft, and queue order. They
  record 460px/1440px overflow, button-height, full-width-band, and `33vh`-cap
  measurements with screenshots. The #188 operator-row assertion remains in its
  owning closure gate until that issue lands; it is not claimed by this journey.

- dock states across `generating` (`Stop` / `Queue`), the `interrupting` transient (`Stopping…` `aria-disabled`, never native disabled), `idle-after-interrupt` (`Send now`, `WILL SEND`), `generating again`, finished (`NEVER SENT` read-only), and the detached-run disclosure (state 8)
- **the queue dispatches at `Queue`-press:** pressing `Queue` fires the send route (`intent:'queue'`) and the message is server-side at once; a later `x` fires the **withdraw route** for that `message_id`; a withdraw after the message has drained is a success no-op
- interrupt → `Send now` → the agent continues on the same session against the redirected work
- the interrupted tool call renders `⚠ interrupted`, not `✕ failed`, on a non-Claude provider (proves the reader fold)
- accessibility: colour-free status glyph, per-transition polite live-region announcement, assertive delivery-failure `role="alert"`, focus transfer on dock change (never `<body>`), `Enter` inserts a newline and never sends, `prefers-reduced-motion`, `aria-describedby` on the ask-blocked Send
- visual checks at **460px** (Legacy) and the Console panel width

- **Story 2.11 never-sent E2E** — `e2e/ui/agent-never-sent.spec.ts` covers Cancel two-milestone waits (`cancelled` without box → `node_failed` + failed execution → ordered `Never sent, n`), cross-tab observation ledger, idle-after-interrupt `intent:'queue'` without Send now, half-typed draft fold-in, finished-iteration observer recovery, single `role="alert"` + transcript focus handoff, and 460px/1440px visual evidence under `plans/260920-1136-issue-191-recover-never-sent-messages/reports/evidence/`

## Boundary checks

- `@archon/web` imports nothing from `@archon/workflows`; wire types come from `api.generated`
- Console imports nothing from `@/components/`; the dock JSX is written twice, thin
