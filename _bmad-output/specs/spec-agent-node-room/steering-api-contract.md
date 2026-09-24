# Steering API contract

The typed wire contract for durable drafts, queued guidance, auto-send, Stop, keepalive, withdrawal, and queue reads.

The durable steering store is authoritative for draft and queue data.

The live registry is authoritative only for the active provider turn handle and its per-turn interrupt signal.

All routes register through `registerOpenApiRoute(createRoute({...}), handler)` so the OpenAPI spec, runtime validation, and `api.generated.d.ts` stay aligned.
Identity resolves through `resolveAuthContext`. Steering carries its own actor grant (owner-ratified 2026-09-15, AD-11): any **authenticated** identity may call these routes, attributed by `operator_user_id`; unauthenticated → 401; a run with no `user_id` (solo / identity-less install) → allowed. This broadens HITL/AD-7 for the steering routes only — the retry / cancel / approve rules are unchanged.
Schemas live in `packages/server/src/routes/schemas/`; derive types with `z.infer`.

## Routes

| Method + path                                                      | Purpose                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/workflows/runs/:runId/nodes/:nodeId/draft`               | Read the acting operator's server-side draft and auto-send setting.                                                                                |
| `PUT /api/workflows/runs/:runId/nodes/:nodeId/draft`               | Upsert the acting operator's draft after debounced composer changes.                                                                               |
| `DELETE /api/workflows/runs/:runId/nodes/:nodeId/draft`            | Clear the acting operator's saved draft idempotently.                                                                                              |
| `PUT /api/workflows/runs/:runId/nodes/:nodeId/auto-send`           | Persist the acting operator's auto-send setting for this node.                                                                                     |
| `POST /api/workflows/runs/:runId/nodes/:nodeId/send`               | Persist a queued message or request immediate delivery of a persisted item.                                                                        |
| `POST /api/workflows/runs/:runId/nodes/:nodeId/interrupt`          | End the active agent turn through `interruptSignal`; the node and provider session remain available.                                               |
| `POST /api/workflows/runs/:runId/nodes/:nodeId/keepalive`          | Re-arm the live idle-after-interrupt inactivity timer without delivering a message.                                                                |
| `DELETE /api/workflows/runs/:runId/nodes/:nodeId/queue/:messageId` | Withdraw a durable queued message before it is claimed.                                                                                            |
| `GET /api/workflows/runs/:runId/nodes/:nodeId/queue`               | Read the durable node queue in server FIFO order, including delivery state and whether live execution requires the existing Resume action.          |

## Request schemas

- **draft write** — `{ message: string }`; an empty string is represented by the idempotent DELETE route rather than a second clear shape.
- **auto-send write** — `{ enabled: boolean }`.
- **send** — `{ message: string (non-empty), message_id: string (caller-stamped uuid), intent: 'queue' | 'send_now', queued_message_id?: string }`.
  `message_id` is the durable identity and delivery-correlation key. `queued_message_id` selects an existing durable item for per-item Send now and must belong to the same node.
- **interrupt** — `{}` (no body); the target is the live turn on the registry handle.
- **keepalive** — no request body; it only re-arms the timer (AD-4 inactivity timer, SC 2.2.1). This is AD-4's composing keepalive, within AD-11's Send/Interrupt route family — not a new grant.
- **withdraw** — `{}` (no body); `message_id` is the path parameter. Removes that message from the durable queue if it is still claimable.
- **queue read** — bodyless GET: no request body and no query parameters; `runId`/`nodeId` are the only path parameters.

## Response schemas

- **draft read/write** — `{ success: true, draft: { message: string, updated_at: string } | null, auto_send: boolean }`.
- **draft clear** — `{ success: true }`.
- **auto-send write** — `{ success: true, enabled: boolean }`.
- **send** — `{ success: true, message_id: string, state: 'queued' | 'awaiting_send_now' | 'dispatching' | 'sent' | 'delivered' | 'delivery_unknown' }`.
  A queue response is returned only after the durable write commits. Immediate delivery reports only evidence known at response time and never infers `delivered` from prose.
- **withdraw** — `{ success: true, message_id: string }`; idempotent — success whether the message was still queued (now removed) or had already drained (nothing to remove).
- **interrupt** — `{ success: true, sub_state: 'idle-after-interrupt' | 'generating' }`.
  `idle-after-interrupt` when the interrupt landed mid-turn; **`generating`** when the turn already ended naturally before the interrupt landed (interrupt spent, AD-2) and a queued message auto-drained into turn N+1. If the turn ended naturally with an **empty** queue the node has completed — the route then returns 409 `node_finished` (below), not a success shape.
- **keepalive** — `{ success: true }` on every successful call against a live handle:
  - live idle → re-arms the inactivity timer (private; not exposed on the wire);
  - live generating / between-turn / queue-only → 200 no-op (timer not armed or already settled);
  - durable recovery state without a live handle → **409** `recovery_required`;
  - terminal run/node or closed handle → **409** `node_finished`;
  - unknown run/node → **404**; unauthenticated → **401**.
    Bodyless POST; writes no durable row; same steering actor grant as send/interrupt.
- **queue read** — `{ success: true, execution_state: 'live' | 'recovery_required' | 'finished', queued: [{ message_id: string, message: string, state: 'queued' | 'awaiting_send_now' | 'dispatching' | 'sent' | 'delivered' | 'delivery_unknown' }] }`.
  `queued` contains durable node items in server FIFO order. A restart returns the same rows with `execution_state: 'recovery_required'` until the existing Resume flow establishes a live executor. Author attribution remains on transcript receipts and authorized server records rather than being inferred by the browser.
  Every queue-read outcome — 200 and each error status — carries `Cache-Control: no-store` so a live queue snapshot is never served from a shared cache.

`delivered` is current scope where a provider returns verified acknowledgement for the stamped message id.

## Error schema and status codes

One error shape across all routes: `{ success: false, error: { code: string, message: string } }`, so a consumer classifies by `code`, never by prose.

| Condition                                     | HTTP      | `error.code`                    |
| --------------------------------------------- | --------- | ------------------------------- |
| No resolved identity                          | 401 / 403 | `unauthenticated` / `forbidden` |
| Unknown `runId` / `nodeId`                    | 404       | `not_found`                     |
| Malformed or schema-invalid payload           | 400       | `invalid_request`               |
| Node no longer running                        | 409       | `node_finished`                 |
| Durable node requires existing Resume action  | 409       | `recovery_required`             |
| Message outcome became ambiguous after loss   | 409       | `delivery_unknown`              |

The API never infers process origin from a missing live handle.

After server restart it returns the typed `recovery_required` state while continuing to serve durable draft and queue reads.

The user invokes the existing Resume action to re-establish execution.

## Idempotency and races

- **Duplicate `message_id`** — the send is idempotent through the durable unique identity and replays the current receipt instead of inserting another queue entry.
- **Per-item `send_now` claim** — `queued_message_id` atomically claims exactly the selected queued message for the current active provider turn.
  The selected item receives its stamped identity, leaves the queued collection, and becomes `sent` pending verified acknowledgement without invoking Stop.
  Every non-selected queued item keeps its identity, content, relative order, and `queued` state unchanged.
- **Repeated interrupt while already `idle-after-interrupt`** — an idempotent no-op returning the current `sub_state`; no second interrupt fires.
- **Withdraw of an already-delivered, withdrawn, or unknown `message_id`** — an idempotent success no-op; there is no message-level 404.
- **Withdraw during recovery-required state** — DELETE may remove a still-queued item because it manages durable guidance rather than the missing provider process.
- **Send while an interrupt is in flight** — the message lands durably in the queue and waits for `Send now`.
- **Node goes terminal mid-request** — the route returns 409 `node_finished`; the teardown queue check is the last gate (AD-11).
- **Every rejected request leaves the node, queue, and transcript unchanged** — a refusal is never a partial mutation.
- **Read racing a send/withdraw** — a queue read reflects the last committed durable order. The initiating client never replaces a newer mutation response with an older snapshot.
- **Process loss during dispatch** — a claimed message whose provider acknowledgement cannot be proven becomes `delivery_unknown` and is never automatically resent.
- **Reads never mutate or log contents** — draft and queue reads perform no workflow or transcript mutation, and operator message text is never logged.

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
- The keepalive route carries no message and writes no transcript row; it only touches the live idle-await timer.
- Draft and queue routes own durable steering state, while the executor remains the sole writer of delivered operator transcript rows.
