# Phase B report — durable steering store and provider-neutral Stop contract

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-ae890a6d67a20fb1f`
Branch: `worktree-agent-ae890a6d67a20fb1f` (from `develop-2`)
Scope: backend only — durable steering storage and the provider-neutral Stop
contract on server, engine, and API. Stories 7.1–7.5, 8.1–8.2, and the
backend halves of 10.2 and 10.3.

## Commits

1. `4fadd479` feat(workflows): add durable steering store and move queue authority off the live registry
2. `eedeeeac` test(providers): assert softInjection and deliveryAck capability flags
3. `8069a843` feat(server): add steering draft and auto-send routes, rework send/queue/withdraw
4. `15576089` fix(server): stop a settings-only row from classifying as recovery_required
5. `cb4e75c3` docs(core): drop stale boot-sweep wording from steering store comments
6. `2ebc8ab8` feat(web): regenerate API types and add steering draft/auto-send clients

Nothing pushed.

## Architecture

The control plane (drafts, guidance queue, delivery state, auto-send
settings) is now fully durable in SQLite/PostgreSQL, independent of the
in-memory execution plane (the live provider turn handle held by
`NodeSteeringHandle` in `packages/workflows/src/steering-registry.ts`). A
node registers a durable settings row (stamped with its resolved
`provider_id`) the moment the executor gives it a live handle; from then on
every route can tell three states apart from durable data alone:

- **live** — an in-process handle exists right now.
- **recovery_required** — the settings row has a `provider_id` (proof the
  node once registered a live handle) but no handle exists in this
  process's registry — the common shape after a restart.
- **not_steerable_here** — the node exists (or a settings-only row exists)
  but never registered a live handle at all.

## Schema (Stories 7.1, 7.4)

Three additive tables in `migrations/000_combined.sql` (Postgres) mirrored by
hand in `packages/core/src/db/adapters/sqlite.ts` (SQLite):

- **`remote_agent_steering_drafts`** — one draft per `(workflow_run_id,
node_id, operator_user_id)`, `operator_user_id` using the `''` sentinel
  for an unauthenticated/no-identity caller (NULL cannot participate in a
  UNIQUE constraint the way an empty string can). `message TEXT NOT NULL`,
  `updated_at`.
- **`remote_agent_steering_queue_entries`** — one row per queued/claimed/
  terminal guidance message. `fifo_position INTEGER NOT NULL CHECK (>= 1)`
  assigned via `SELECT COALESCE(MAX(position),0)+1` inside a transaction
  with retry-once on a unique-position conflict (same pattern as
  `workflow-node-messages.ts`'s `seq`). `state` is an open-ended VARCHAR
  validated in Zod, not a DB CHECK, to avoid a future SQLite table rebuild
  when a new state is added. `UNIQUE(workflow_run_id, node_id, message_id)`
  makes idempotent replay a DB-level guarantee, not just an application
  convention.
- **`remote_agent_steering_node_settings`** — one durable row per
  `(workflow_run_id, node_id)`: `auto_send_enabled`, `updated_by_user_id`,
  and `provider_id` (nullable — only the executor's own registration write
  ever sets it).

All three cascade-delete with their owning `workflow_runs` row. New indexes
and `COMMENT ON COLUMN` statements live in the trailing "Indexes and column
comments" section per house style. `bun run generate:bundled-schema` was run
and `bundled-schema.generated.ts` is in sync (`check:bundled-schema` passes).
The `sqlite.test.ts` schema-parity test passes — both dialects agree on
every table and column.

**`check:schema-upgrades` was not run.** No local PostgreSQL is available in
this environment (`pg_isready`: command not found, no reachable server) —
per the task instructions this is noted rather than skipped silently. The
CI job that runs it against real upgrade baselines is the gate that will
actually exercise these three new `CREATE TABLE IF NOT EXISTS` blocks against
every prior schema vintage.

## Store and engine (Stories 7.1, 7.3, 7.5)

`packages/core/src/db/workflow-steering.ts` implements `IWorkflowSteeringStore`
(declared in `packages/workflows/src/store.ts`, 11 methods) with real SQL —
every claim/CAS operation is SELECT-then-UPDATE-by-id (the SQLite adapter
rejects `RETURNING` on `UPDATE`, only on `INSERT`). `claimSteeringQueue`
takes `FOR UPDATE` on Postgres only. `packages/workflows/src/schemas/steering.ts`
is the canonical Zod source for every wire and store shape; `@archon/core`
re-exports it rather than duplicating it.

`packages/workflows/src/steering-registry.ts` was trimmed to a pure
execution-plane handle: `wakeForSendNow()` / `awaitSendNowAgain()` for the
idle-after-interrupt/Send-now dance, `interrupt()`, and phase/substate
snapshot. It no longer owns `enqueue`/`accept`/`drain`/`withdraw` — those are
gone in favor of the durable store. `packages/workflows/src/dag-executor.ts`
(both the direct-node and loop-node paths) now claims from the durable queue
at natural turn boundaries via `deps.store.claimSteeringQueue`, stamps the
node settings row with `provider_id` at registration, and calls
`markSteeringMessagesSent`/`reconcileNeverSentSteering` at the right points
(the latter only on genuine terminal outcomes, never at a resumable pause
like an AskHuman park).

Auto-send (Story 7.5) is a durable per-node setting, not per-operator: once
set, every permitted observer of the node sees the same value, and the
executor claims exactly one durable FIFO entry after each natural agent
reply when it is on. An interrupted turn never auto-sends — this matches
`engine-integration.md`'s documented contract ("If auto-send is disabled,
the normal Queue contract determines the next-turn batch; enabled = one FIFO
item per natural reply; interrupted never auto-sends"), confirmed against
the spec source before implementation.

## Routes

All under `packages/server/src/routes/api.ts`, registered via
`registerOpenApiRoute(createRoute({...}), handler, steeringValidationErrorHook)`.
Every steering route's error body is `{ success: false, error: { code,
message } }`; every success body starts `{ success: true, ... }`.

### `GET /api/workflows/runs/{runId}/nodes/{nodeId}/draft`

Returns the **acting operator's own** draft (private — another operator
never sees or overwrites it) plus the node's shared `auto_send` value.
`draft: null` when never saved, cleared, or sent. Available on a terminal
node — a saved draft is never discarded.

- 200 `{ success, draft: {message, updated_at} | null, auto_send }`
- 404 `not_found` — unknown run (node existence is never checked; a draft
  can legitimately be pre-set before a node starts)

### `PUT /api/workflows/runs/{runId}/nodes/{nodeId}/draft`

Body `{ message: string }` (empty string accepted and stored verbatim).
Upserts the caller's own draft.

- 200 same shape as GET
- 404 `not_found` — unknown run

### `DELETE /api/workflows/runs/{runId}/nodes/{nodeId}/draft`

Idempotent clear — a repeat call on an already-cleared or never-saved draft
is still 200.

- 200 `{ success: true }`
- 404 `not_found` — unknown run

### `PUT /api/workflows/runs/{runId}/nodes/{nodeId}/auto-send`

Body `{ enabled: boolean }`. Durable, shared setting; disabling it never
withdraws or discards any already-queued entry.

- 200 `{ success: true, enabled }`
- 404 `not_found` — unknown run
- 409 `node_finished` — run already terminal

### `POST /api/workflows/runs/{runId}/nodes/{nodeId}/send` (reworked)

Body `{ message, message_id, intent: 'queue' | 'send_now', queued_message_id?
}`. Idempotent-replay-by-`message_id` is checked ahead of the parked-handle
rejection so a duplicate always replays the original receipt even against a
handle that would otherwise refuse a _new_ message. `queued_message_id`
selects an existing durable entry for per-item soft injection into the
active turn (Story 10.2) — honored only when the live provider's
`softInjection` capability is `true` and the handle is mid-turn
(`generating`); otherwise 409 `soft_injection_unavailable`. No built-in
provider declares `softInjection: true` yet (verified conformance is a
later, per-provider story), so this path is currently always refused — by
design, not by omission.

- 200 `{ success: true, message_id, state }`
- 404 `not_found`, 409 `node_finished` / `recovery_required` / `soft_injection_unavailable`, 422 `not_steerable_here`

### `POST /api/workflows/runs/{runId}/nodes/{nodeId}/interrupt`

Bodyless. Stops the live turn, returns the settled substate.

- 200 `{ success: true, state: 'idle-after-interrupt' | 'generating' }`
- 404 `not_found`, 409 `node_finished` / `recovery_required`, 422 `not_steerable_here`

### `POST /api/workflows/runs/{runId}/nodes/{nodeId}/keepalive`

Bodyless. Re-arms the idle-await inactivity timer only when live and
`idle-after-interrupt` with a pending waiter; otherwise a successful no-op.

- 200 `{ success: true }` (or the shape reflecting the no-op case)
- 404 `not_found`, 409 `node_finished` / `recovery_required`, 422 `not_steerable_here`

### `DELETE /api/workflows/runs/{runId}/nodes/{nodeId}/queue/{messageId}` (reworked)

Withdraws one still-claimable durable entry. Works during `recovery_required`
too (it manages durable data, not the live process). Never 404s on an
unknown node or message id — withdrawing something never durably queued is
an idempotent no-op, not an error. Only run/node terminal state gates it.

- 200 `{ success: true, message_id }`
- 404 `not_found` — unknown run, 409 `node_finished`

### `GET /api/workflows/runs/{runId}/nodes/{nodeId}/queue` (reworked)

Bodyless, `Cache-Control: no-store` on every outcome. Returns the durable
FIFO queue plus `execution_state` (`live` | `recovery_required` | `finished`)
and provider `capabilities` (`soft_injection`, `delivery_ack`). A terminal
node/run is **200 `finished`**, never a 409 — durable history (including
`never_sent` records) must stay readable after the run ends.

- 200 `{ success, execution_state, auto_send, capabilities, queued: [{message_id, message, operator_user_id, state}] }`
- 404 `not_found`, 422 `not_steerable_here`

## The classification fix (Story 7.4 correctness)

`classifySteeringLifecycle` (send/interrupt/keepalive) and the queue-read
handler's own equivalent both originally treated **any** durable settings
row as proof a node had once registered a live handle. The auto-send route
writes that same row for any `nodeId` with no check the node ever ran, so an
operator pre-setting auto-send — or a typo'd node id — produced a row whose
mere _existence_ made both code paths report `recovery_required` (and the
UI would show a "Resume" prompt) for a node that had never registered
anything. Found via a second advisor review before declaring the routes
done; fixed by discriminating on `provider_id` (only ever written by the
executor's own registration) instead of row existence:

- `provider_id` non-null + no live handle → genuine `recovery_required`
- `provider_id` null, node never ran → `not_found`
- `provider_id` null, node ran (e.g. a bash node) but never registered
  steering → `not_steerable_here`

Verified against real, already-contaminated data in the manual-verification
scratch database (see below) as well as three new automated tests.

## Dead code removed

`reconcileDispatchingSteeringMessagesOnBoot` — a boot-time-only sweep for
`dispatching` rows — was implemented per an earlier design pass but never
wired to any caller. Reading `packages/server/src/index.ts`'s own comment
about orphaned-run cleanup deliberately _not_ running at boot (it would
kill parallel runs the CLI or an adapter owns) surfaced the same hazard
here: the CLI drives the same executor against the same database as the
server (single-tenant-per-install means one install, not one writer
process), so a table-wide sweep at server startup could reclassify a row a
live CLI run still owns — exactly what "No Autonomous Lifecycle Mutation
Across Process Boundaries" forbids. The function was never wired in the
first place, so nothing behavioral changes; it is now deleted (AGENTS.md
YAGNI: no export without a caller) with its reasoning folded into
`reconcileNeverSentSteeringMessages`'s docblock. The client's visibility
into an ambiguous claim comes from the queue read's `execution_state:
'recovery_required'` plus a `queued` item's own `dispatching` state — both
truthful, unmutated reads, no sweep required.

## Tests

- `packages/core/src/db/workflow-steering.test.ts` — 22 tests against a real
  `SqliteAdapter(':memory:')` (only the `./connection` module is redirected
  to it; the store code under test is the real implementation), covering
  FIFO position assignment under concurrency, `message_id` idempotency,
  claim/CAS state transitions, terminal reconciliation, and cascade delete.
- `packages/workflows/src/steering-registry.test.ts`, `dag-executor.test.ts`,
  `subrun.test.ts`, `node-transcript.test.ts` — rewritten for the trimmed
  registry and durable-store wiring.
- `packages/server/src/routes/api.workflow-runs.test.ts` — full route-level
  coverage via a real `OpenAPIHono` app with a stateful `mock.module` for
  the DB layer only; business logic in `api.ts` runs for real. Added in
  this phase: 9 tests for the draft routes, 5 for auto-send, and 3 targeted
  regression tests for the classification fix (a genuine post-restart
  `provider_id`-stamped row correctly reads `recovery_required`; a
  settings-only row on a never-run node correctly reads `not_found`; a
  settings-only row on a real non-steerable node correctly reads
  `not_steerable_here`).
- `packages/providers/*` — 5 provider capability test files updated for the
  two new `ProviderCapabilities` fields.

Full-monorepo `bun run test`: **0 failures** across every package (verified
twice — once before the classification fix, once after — by grepping every
` fail$` line in the log for anything other than `0 fail`). Per-package
`bun run test` for `core`, `server`, `workflows`, and `providers`
individually: 0 failures each.

## Validate

`bun run type-check`, `bun run lint` (`--max-warnings 0`), `bun run
format:check`, `check:bundled`, `check:bundled-schema`, `check:pi-vendor-map`,
`check:capability-matrix` all pass at the whole-monorepo level with one
exception, described next.

### Cross-phase type break (needs orchestrator attention)

`@archon/web`'s type-check fails in exactly two files, both outside this
phase's ownership:

- `packages/web/src/components/workflows/ComposerDock.tsx` (+ its `.test.tsx`)
- `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` (+ its `.test.tsx`)

The widened Stop/queue wire contract this phase implements — the queue
item's `state` enum growing from `queued | awaiting_send_now` to the full
7-value durable set, `operator_user_id` becoming a required field on each
queued item, and the send response's `state` gaining `sent | dispatching |
delivered | delivery_unknown` beyond the original two — breaks these two
components (and their test fixtures), which were written against the
narrower pre-existing shape. This is the intended, spec-required contract
(Story 10.3's `never_sent` state and per-operator attribution are load-
bearing, not incidental widening), so the fix is on the UI side, not a
revert here. Per file-ownership rules I did not touch either file; both
need an update from whichever agent owns `packages/web/src/**` node-room
UI before the web package will type-check clean again.

## Manual verification (isolated scratch server)

Copied `~/.archon/archon.db` (`sqlite3 ... .backup`), `config.yaml`, and
`credential-key` into a distinctly-named scratch home
(`$SCRATCHPAD/phase-b-archon-home`, chosen to avoid the `archon-home`,
`archon-home-phaseA`, and `phase-e-archon-home` directories already in use
by other agents in this session) and ran the real server from
`packages/server` on `PORT=3319` — never touching 3317/3318/3090. Two boot
cycles (before and after the classification fix, plus a third to enable
`ARCHON_E2E_FAKE_PROVIDER=1`).

**Draft save/restore** — GET before any save returned `draft: null`; PUT
saved and echoed the exact text; a second GET restored it byte-for-byte;
DELETE cleared it (200, idempotent on repeat); a subsequent GET confirmed
the clear never reverted. A draft saved by one `X-Archon-User` was
invisible to a GET from a different one.

**Auto-send toggle** — PUT `enabled: true`/`false` on a real paused run's
node committed and echoed correctly; PUT on a real terminal (`failed`) run
returned 409 `node_finished`; a GET-draft as a different observer showed
the same shared `auto_send` value.

**Classification fix against real contaminated data** — the earlier
auto-send toggle above had, before the fix, produced exactly the leaking
row (`auto_send_enabled: true`, `provider_id: null`) on the paused run's
`plan` node. Re-querying `GET .../queue` and `POST .../send` against that
same real row after the fix now both return 422 `not_steerable_here`
instead of the pre-fix 409 `recovery_required` — the fix verified against
production-shaped data, not only mocks.

**Live FIFO, natural-turn delivery, and terminal reconciliation** — enabled
`ARCHON_E2E_FAKE_PROVIDER=1` (Archon's own env-gated fake provider built for
exactly this: driving the real executor without a paid AI call) and ran a
one-node `provider: e2e-fake` workflow with an `interruptible: true`,
`delayMs: 90000` scenario directive against a freshly created scratch git
repo (registered as a codebase, bound to a `POST /api/conversations`
conversation, run via `POST /api/workflows/{name}/run`). `GET .../queue`
confirmed `execution_state: 'live'` with a real in-process handle.
`POST .../send` twice produced two entries in exact FIFO order
(`fifo_position` 1 then 2) on a live `GET .../queue` read. The node's single
turn then completed naturally, claiming both queued entries at the natural
turn boundary and delivering them to `state: 'sent'` — real, unmocked proof
of the Story 7.3/7.5 claim-at-natural-boundary wiring. Once the run reached
its terminal state, `GET .../queue` correctly reported `execution_state:
'finished'`, a duplicate `POST .../send` on the now-terminal node correctly
returned 409 `node_finished` (terminal-run classification takes precedence
over idempotent-replay, which only applies to a still-live node — a
distinct and correct case from the already-tested "replay wins over a
parked handle"), and `DELETE .../queue/{messageId}` likewise returned 409
`node_finished`.

**Restart recovery with a real executor-stamped `provider_id`** — started a
second `e2e-fake` run, confirmed via direct SQLite query that the executor
had stamped `remote_agent_steering_node_settings.provider_id = 'e2e-fake'`
for that run's node while it was live, then killed the server process
(`kill <pid>`) and restarted it against the same `ARCHON_HOME`/database.
`GET .../queue` on the now-orphaned run correctly reported
`execution_state: 'recovery_required'` (the run row itself stayed
`running` in the database — never mutated, consistent with this phase's
decision not to run a boot-time sweep). `POST .../send` on the same node
correctly returned 409 `recovery_required`, while `PUT .../draft` and
`PUT .../auto-send` — which never require a live handle — both still
succeeded during that same recovery-required window, exactly as designed.

All scratch processes and the workflow/conversation/codebase test fixtures
created for this verification live only in the scratchpad directory and the
scratch copy of the database; nothing was written to the real
`~/.archon/archon.db`. The scratch server process (final PID 8235) was
stopped after verification completed.

## Fields the UI must consume (new/changed wire shapes)

- `SteeringDraftResponse` — `{ success, draft: {message, updated_at} | null, auto_send }`
- `ClearSteeringDraftResponse` — `{ success }`
- `PutAutoSendResponse` — `{ success, enabled }`
- `queued[].operator_user_id` — now present on every queue item (was absent
  before); `null` for an unauthenticated/no-identity caller.
- `queued[].state` — now one of the full 7-value durable set (`queued`,
  `awaiting_send_now`, `sent`, `dispatching`, `delivered`,
  `delivery_unknown`, `never_sent`), not just the original two.
- Send response `state` — now one of `queued | awaiting_send_now | sent |
dispatching | delivered | delivery_unknown` (was `queued |
awaiting_send_now` only).
- Queue-read `execution_state` — `live | recovery_required | finished`; a
  terminal node/run is now a 200 with `finished`, never a 409.
- Queue-read `capabilities` — `{ soft_injection, delivery_ack }`, both
  currently `false` for every built-in provider (no provider has completed
  its own soft-injection/delivery-ack conformance story yet).
- `draft.updated_at` / queue timestamps — a pre-existing, dialect-dependent
  quirk affects these too: on SQLite the raw `datetime('now')` string
  (`"2026-09-26 12:36:03"`, UTC, no `T`/`Z`) passes through the shared
  `toISOString()` helper verbatim (it only converts real `Date` objects);
  on PostgreSQL the driver returns a true `Date` and the field is real ISO 8601. This already affects every other timestamp field returned by this
  API on SQLite installs (e.g. `/api/health`'s `appliedAt`) — it is not new
  to this phase. **The UI must not `new Date()` this field naively**; doing
  so parses the SQLite shape as local time, producing a skew equal to the
  server's UTC offset.

## Unresolved / needs orchestrator attention

- The `ComposerDock`/`ConsoleComposerDock` type break described above needs
  the UI-owning agent to update those two components (and their test
  fixtures) to the widened contract. I did not touch them.
- `check:schema-upgrades` was not run — no local PostgreSQL available. The
  three new tables are additive-only (`CREATE TABLE IF NOT EXISTS`, every
  `ADD COLUMN` — none needed here since these are new tables — would have
  carried a `DEFAULT`), so an upgrade run is expected to pass, but only CI's
  real-baseline run can confirm it.
