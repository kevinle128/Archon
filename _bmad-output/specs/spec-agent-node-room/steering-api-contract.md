# Steering API contract

The typed wire contract for the steering surface — the Send, Interrupt, keepalive, Withdraw, and queue-read routes the composer dock calls.
It closes the readiness gap where the routes were named (`engine-integration.md` §3, steering AD-11) but had no request, response, or error schema, which forced implementation to invent a public API during coding and blocked generated web types. The GET queue route is the read half added by Story 2.9 (#189): it lets every mounted dock hydrate and converge on the one authoritative registry queue without mutating anything.

All routes register through `registerOpenApiRoute(createRoute({...}), handler)` so the OpenAPI spec, runtime validation, and `api.generated.d.ts` stay aligned.
Identity resolves through `resolveAuthContext`. Steering carries its own actor grant (owner-ratified 2026-09-15, AD-11): any **authenticated** identity may call these routes, attributed by `operator_user_id`; unauthenticated → 401; a run with no `user_id` (solo / identity-less install) → allowed. This broadens HITL/AD-7 for the steering routes only — the retry / cancel / approve rules are unchanged.
Schemas live in `packages/server/src/routes/schemas/`; derive types with `z.infer`.

## Routes

| Method + path                                                      | Purpose                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/workflows/runs/:runId/nodes/:nodeId/send`               | **Dispatch** the operator's message onto the live node's registry queue — called at `Queue`-press (`intent: 'queue'`) and on `Send now` (`intent: 'send_now'`), not at the drain moment. The pre-`Queue` draft (text still being composed) is the per-tab client draft; a queued message is server-side. |
| `POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt`          | End the agent's current turn; the session stays alive.                                                                                                                                                                                                                                                   |
| `POST /api/workflows/runs/:runId/nodes/:nodeId/keepalive`          | Re-arm the idle-await inactivity timer without delivering a message.                                                                                                                                                                                                                                     |
| `DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId` | **Withdraw** a queued message from the registry queue before it drains — this is the delete of a queued item. Idempotent.                                                                                                                                                                                |
| `GET /api/workflows/runs/:runId/nodes/:nodeId/queue`               | **Read** the node's still-pending queue snapshot — called at dock mount and on the ~1s reconcile poll so every tab/operator converges on the same ordered queue. Mutation-free; `Cache-Control: no-store` on every outcome.                                                                              |

## Request schemas

- **send** — `{ message: string (non-empty), message_id: string (caller-stamped uuid), intent: 'queue' | 'send_now' }`.
  `message_id` is the correlation key for terminal reconciliation (CAP-11 / AD-11) and, post-G1, for `delivered`.
- **interrupt** — `{}` (no body); the target is the live turn on the registry handle.
- **keepalive** — `{}` (no body); it only re-arms the timer (AD-4 inactivity timer, SC 2.2.1). This is AD-4's composing keepalive, within AD-11's Send/Interrupt route family — not a new grant.
- **withdraw** — `{}` (no body); `message_id` is the path parameter. Removes that message from the registry queue if it is still present.
- **queue read** — bodyless GET: no request body and no query parameters; `runId`/`nodeId` are the only path parameters.

## Response schemas

- **send** — `{ success: true, message_id: string, state: 'queued' | 'awaiting_send_now' }`.
  `queued` when accepted onto the registry queue at `Queue`-press, to drain at the next natural boundary (turn N+1); `awaiting_send_now` when accepted into an `idle-after-interrupt` node's registry queue to await `Send now`.
  Delivery itself — the drain into turn N+1 — is the executor's, reported via the node sub-state stream, not the send response.
- **withdraw** — `{ success: true, message_id: string }`; idempotent — success whether the message was still queued (now removed) or had already drained (nothing to remove).
- **interrupt** — `{ success: true, sub_state: 'idle-after-interrupt' | 'generating' }`.
  `idle-after-interrupt` when the interrupt landed mid-turn; **`generating`** when the turn already ended naturally before the interrupt landed (interrupt spent, AD-2) and a queued message auto-drained into turn N+1. If the turn ended naturally with an **empty** queue the node has completed — the route then returns 409 `node_finished` (below), not a success shape.
- **keepalive** — `{ success: true }`.
- **queue read** — `{ success: true, queued: [{ message_id: string (uuid), message: string }] }`.
  `queued` contains only the handle's current pending items, in server receipt order — drained or withdrawn ids and accepted-id memory never appear on the wire. No `operator_user_id`, `received_at`, handle phase, or durable version is exposed. Live AND parked handles return 200 with their retained rows; a closed handle is 409; a known non-terminal node with no in-process handle is 422.
  Every queue-read outcome — 200 and each error status — carries `Cache-Control: no-store` so a live queue snapshot is never served from a shared cache.

Every message stays `sent` in the UI at the v1 floor; no response reports `delivered` (that is G1, claude-only, post-SDK-bump).

## Error schema and status codes

One error shape across all routes: `{ success: false, error: { code: string, message: string } }`, so a consumer classifies by `code`, never by prose.

| Condition                                     | HTTP      | `error.code`                    |
| --------------------------------------------- | --------- | ------------------------------- |
| No resolved identity                          | 401 / 403 | `unauthenticated` / `forbidden` |
| Unknown `runId` / `nodeId`                    | 404       | `not_found`                     |
| Malformed or schema-invalid payload           | 400       | `invalid_request`               |
| Node no longer running                        | 409       | `node_finished`                 |
| No live handle in this process (detached run) | **422**   | `not_steerable_here`            |

**Decision — detached-run status code.**
409 is already the terminal-state conflict (`node_finished`), where the draft stays in the browser and re-running is `workflow retry-node`.
The detached case is different: the run exists and is **non-terminal**, but its live session is in another process, so it is unreachable from here — a capability limit, not a terminal conflict.
Reusing 409 for both would conflate two conditions a machine consumer must tell apart.
**This contract uses 422 `not_steerable_here`.** (Alternative considered: 409 with a discriminated `error.code`; rejected because the two conditions have different client behavior — `node_finished` keeps the draft as a finished-node read-only box, `not_steerable_here` keeps the dock but discloses steering is unavailable, EXPERIENCE.md state 8.)

## Idempotency and races

- **Duplicate `message_id`** — the send is idempotent: it replays the original receipt (same `state`), never a second queue entry.
- **Repeated interrupt while already `idle-after-interrupt`** — an idempotent no-op returning the current `sub_state`; no second interrupt fires.
- **Withdraw of an already-drained or unknown `message_id`** — an idempotent success no-op; there is no message-level 404 (404 is only an unknown `runId`/`nodeId`).
- **Withdraw from a parked retained queue** — DELETE may remove an already-accepted item from a parked retained queue because it manages the queue, not the live provider session; new sends remain refused while parked, and a closed handle still returns `node_finished`.
- **Send while an interrupt is in flight** — the message lands in the registry queue and waits for `Send now`; the queue absorbs the race with no 409 (AD-11).
- **Node goes terminal mid-request** — the route returns 409 `node_finished`; the teardown queue check is the last gate (AD-11).
- **Every rejected request leaves the node, queue, and transcript unchanged** — a refusal is never a partial mutation.
- **Read racing a send/withdraw** — a queue read reflects the registry at the snapshot tick: it may include a message whose send response is still in flight, or omit one whose withdraw landed first. The initiating client never loses its own mutation — the dock tags each read with its local mutation generation and discards any snapshot captured before its own successful send/withdraw (`queueGeneration` in `steering-dock.ts`).
- **Reads never mutate or log contents** — the queue read performs no run, event, message, or pending-interaction write; the hot path is one run lookup plus one in-memory handle snapshot. Operator message text is never logged.

## Transcript operator row (read model)

Stored operator receipt (written by the **executor**, never by a steering route — AD-6):

- ordinary `text` row
- strict metadata triple: `origin: 'operator'`, `operator_user_id: string | null`, `message_id`
- no fourth persisted identity/name field

Response-only derived field on the text variant of the node-message read API:

- `operator_display_name: string | null` (optional on non-operator rows — omitted entirely)
- non-null sender → trimmed current `users.display_name`, else first 8 characters of the id
- `null` only when `operator_user_id` is null (identity-less)
- lookup failure fails open to the short-id map; transcript list/detail still return 200
- the web never fetches users for this field (compat short-id guard only)

## Boundary notes

- `@archon/web` consumes these types through `api.generated.d.ts` / `lib/api.ts`; it never imports server or workflow packages.
- The keepalive route carries no message and writes no row; it only touches the in-process idle-await timer.
- No route is a delivery vehicle for the record — the executor writes the operator row (AD-6); these routes drive the live session and the registry queue.
