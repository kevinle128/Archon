---
title: API Reference
description: REST API endpoints for programmatic access to Archon.
category: reference
area: server
audience: [developer]
sidebar:
  order: 6
---

Archon exposes a REST API via a [Hono](https://hono.dev/) server with OpenAPI spec generation. All endpoints are prefixed with `/api/`.

## Base URL

By default, the API server runs at:

```
http://localhost:3090/api/
```

Override the port with the `PORT` environment variable or let Archon auto-allocate when running inside a worktree (range 3190-4089).

## OpenAPI Specification

A machine-readable OpenAPI 3.0 spec is available at:

```
GET /api/openapi.json
```

You can feed this into tools like Swagger UI or use it to generate typed API clients.

## Authentication

None. Archon is a single-developer tool -- there is no authentication on the API by default. If you expose Archon on a network, use a reverse proxy or firewall to restrict access.

---

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Basic health check |
| GET | `/api/health` | API-level health check |

```bash
curl http://localhost:3090/health
# {"status":"ok"}

curl http://localhost:3090/api/health
# {"status":"ok","adapter":"...","concurrency":{...},"runningWorkflows":0}
```

---

## Conversations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List conversations |
| GET | `/api/conversations/{id}` | Get a single conversation |
| POST | `/api/conversations` | Create a new conversation |
| PATCH | `/api/conversations/{id}` | Update a conversation (rename) |
| DELETE | `/api/conversations/{id}` | Soft-delete a conversation |
| GET | `/api/conversations/{id}/messages` | List messages in a conversation |
| POST | `/api/conversations/{id}/message` | Send a message to a conversation |

### List Conversations

```bash
curl http://localhost:3090/api/conversations
```

Query parameters:
- `codebase_id` (optional) -- Filter by codebase
- `include_deleted` (optional) -- Include soft-deleted conversations

### Create a Conversation

```bash
curl -X POST http://localhost:3090/api/conversations \
  -H "Content-Type: application/json" \
  -d '{}'
```

Optionally specify a codebase:

```bash
curl -X POST http://localhost:3090/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"codebase_id": "your-codebase-id"}'
```

Returns the created conversation with its `platform_conversation_id`.

### Send a Message

```bash
curl -X POST http://localhost:3090/api/conversations/{id}/message \
  -H "Content-Type: application/json" \
  -d '{"message": "What does this codebase do?"}'
```

The message is dispatched to the orchestrator asynchronously. The response confirms dispatch -- actual AI responses arrive via SSE streaming or can be polled via the messages endpoint.

### Get Messages

```bash
curl http://localhost:3090/api/conversations/{id}/messages
```

Query parameters:
- `limit` (optional) -- Number of messages to return
- `before` (optional) -- Cursor for pagination

### Update a Conversation

```bash
curl -X PATCH http://localhost:3090/api/conversations/{id} \
  -H "Content-Type: application/json" \
  -d '{"title": "My feature discussion"}'
```

### Delete a Conversation

```bash
curl -X DELETE http://localhost:3090/api/conversations/{id}
```

Performs a soft delete -- the conversation is hidden but not destroyed.

---

## Codebases

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/codebases` | List registered codebases |
| GET | `/api/codebases/{id}` | Get a single codebase |
| POST | `/api/codebases` | Register a codebase (clone or local path) |
| DELETE | `/api/codebases/{id}` | Delete a codebase and clean up resources |
| GET | `/api/codebases/{id}/environments` | List isolation environments for a codebase |

### List Codebases

```bash
curl http://localhost:3090/api/codebases
```

### Register a Codebase

Clone from a URL:

```bash
curl -X POST http://localhost:3090/api/codebases \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/user/repo"}'
```

Register a local path:

```bash
curl -X POST http://localhost:3090/api/codebases \
  -H "Content-Type: application/json" \
  -d '{"path": "/home/user/projects/my-repo"}'
```

### Delete a Codebase

```bash
curl -X DELETE http://localhost:3090/api/codebases/{id}
```

Removes the codebase registration and cleans up associated worktrees and isolation environments.

### List Environments

```bash
curl http://localhost:3090/api/codebases/{id}/environments
```

Returns the isolation environments (worktrees) associated with a codebase.

---

## Workflows

### Definitions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workflows` | List available workflows |
| GET | `/api/workflows/{name}` | Get a single workflow definition |
| POST | `/api/workflows/validate` | Validate a workflow definition (in-memory, no save) |
| PUT | `/api/workflows/{name}` | Save (create or update) a workflow |
| DELETE | `/api/workflows/{name}` | Delete a user-defined workflow |

#### List Workflows

```bash
curl http://localhost:3090/api/workflows
```

Query parameters:
- `cwd` (optional) -- Working directory to discover project-specific workflows

When `cwd` is omitted, Archon returns bundled default workflows and any from `~/.archon/workflows/` (home-scoped). Project-specific workflows require either the `cwd` query param or a registered codebase, so the endpoint is useful on first launch before any project is registered.

Returns `{ workflows: [...], recommended: [...], errors?: [...] }`.

- `workflows[]` — each entry is `{ workflow, source, parseWarnings? }`. `parseWarnings` contains warning messages identifying the keys the engine silently dropped from that workflow's YAML, each with the node it was found on and what to write instead (see [Unknown keys](/guides/authoring-workflows/#unknown-keys-are-reported-not-rejected)); it is **omitted entirely** when the workflow is clean, so its presence alone is the signal.
- `recommended[]` — repo-owner-curated workflow names from `.archon/config.yaml`, filtered to discovered names and kept in declared order. Empty when there is no project context.
- `errors[]` — YAML parsing failures encountered during discovery. Unlike `parseWarnings`, these workflows did **not** load.

#### Get a Workflow

```bash
curl http://localhost:3090/api/workflows/archon-assist
```

Query parameters:
- `cwd` (optional) -- Working directory for project-specific lookup

Returns `{ workflow, filename, source: "project" | "global" | "bundled" }`. The endpoint auto-discovers across all three scopes in order (project → home-scoped → bundled). `source: "global"` is returned when the workflow comes from `~/.archon/workflows/`.

#### Validate a Workflow

```bash
curl -X POST http://localhost:3090/api/workflows/validate \
  -H "Content-Type: application/json" \
  -d '{"definition": {"name": "my-wf", "description": "Test", "nodes": [{"id": "a", "prompt": "hello"}]}}'
```

Returns `{ valid: true }` or `{ valid: false, errors: ["..."] }`. Does not save anything.
Workflow definitions can include `route_loop` DAG controller nodes with `from`, `condition`, `max_iterations`, and `routes.positive` / `routes.negative` / `routes.exhausted`.
Invalid route-loop shapes are rejected during validation before execution.

#### Save a Workflow

```bash
curl -X PUT http://localhost:3090/api/workflows/my-workflow \
  -H "Content-Type: application/json" \
  -d '{"definition": {"name": "my-workflow", "description": "My custom workflow", "nodes": [{"id": "plan", "prompt": "Plan the feature"}]}}'
```

Query parameters:
- `cwd` (optional) -- Target directory (must have `.archon/workflows/`)
- `source` (optional, enum: `project` \| `global`) -- Scope to write the workflow to. Defaults to `project` (writes to `<cwd>/.archon/workflows/`). Pass `source=global` to write to the home-scoped location (`~/.archon/workflows/`). Returns `400 "Invalid workflow source"` if any other value is supplied.

Validates the definition before saving. Returns the saved workflow.

#### Delete a Workflow

```bash
curl -X DELETE http://localhost:3090/api/workflows/my-workflow
```

Query parameters:
- `cwd` (optional) -- Target directory (must have `.archon/workflows/`)
- `source` (optional, enum: `project` \| `global`) -- Scope to delete from. Defaults to `project`. Pass `source=global` to delete from `~/.archon/workflows/`. Returns `400 "Invalid workflow source"` if any other value is supplied.

Only user-defined workflows can be deleted. Bundled defaults cannot be removed.

### Workflow ENVs (overlays)

Named, **install-wide** overlays for a workflow. An ENV stores a bounded patch map of node execution fields. Selecting an ENV at Start freezes that row onto the run; later edits or deletes do **not** change existing runs. ENVs are not workflow-language surface and are not selectable from the CLI.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workflows/{name}/envs` | List ENV summaries for a workflow (no patch bodies) |
| GET | `/api/workflows/{name}/envs/{envId}` | Get one ENV including `patches` |
| POST | `/api/workflows/{name}/envs` | Create an ENV (`201`) |
| PATCH | `/api/workflows/{name}/envs/{envId}` | Replace name and/or the complete `patches` map |
| DELETE | `/api/workflows/{name}/envs/{envId}` | Delete an ENV (`{ deleted: true }`) |
| GET | `/api/workflows/{name}/env-preview` | Preview targets + resolved request metadata |

**Identity.** Rows are keyed by `(workflow_name, name)` install-wide — not per project. `created_by_user_id` is provenance only (no per-resource ACL beyond the normal web API gate).

**Patch document.** Each target key is a top-level node id after include expansion (for example `quality__review`). Allowed fields depend on node kind:

| Node kind | Patchable fields |
|-----------|------------------|
| `prompt` | `provider`, `model`, `effort`, `thinking`, `prompt` |
| `command` | `provider`, `model`, `effort`, `thinking` |
| `loop` | `provider`, `model`, `effort` |
| `loop_group` | `provider`, `model` (group body nodes are **not** patch targets) |
| `bash` | `bash` |
| other | none |

Bounds: ≤256 targets, ≤1 MiB UTF-8 `JSON.stringify(patches)`, non-empty per-node patch, no reserved keys (`__proto__`, …). Empty `{}` patches are valid. Prompt/bash bodies are **plaintext** install-visible data — not secrets and not encrypted.

**List / detail.** List responses omit `patches`. Detail, create, and update return camelCase `{ id, workflowName, name, patches, createdAt, updatedAt, createdByUserId }`. Name conflict → `409` with `{ error, detail? }`. Missing row → `404`. Corrupt stored patches → `500 env_store_corrupt` (id-only logs).

**PATCH replacement.** `patches` on update is a whole-document replace, not a deep merge. Sending `{}` clears the map. Omitting `patches` leaves them unchanged when only renaming.

**Preview.**

```bash
curl "http://localhost:3090/api/workflows/feature/env-preview?cwd=/path/to/repo&envId=optional-uuid"
```

- `cwd` is **required** and must resolve under a registered project root (root or descendant).
- Omitting `envId` returns the YAML baseline (no overlay).
- With `envId`, the row must belong to the route workflow name (and the discovered canonical name); otherwise `400 env_not_found` or `400 env_workflow_mismatch`.
- Response includes `targets` (top-level nodes + `allowedFields`), `skippedNodeIds`, and `resolved` provider-turn rows through the same resolution path as runtime `node_started` request fields. `preview: true`, `authoritative: false` — the live ENV, workflow, or model profile may change before Start.
- Errors never echo prompt/bash bodies.

CRUD does **not** require `cwd` or that the workflow be currently discoverable. Preview does.


### Runs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workflows/{name}/run` | Run a workflow (JSON or multipart) |
| GET | `/api/workflows/runs` | List workflow runs |
| GET | `/api/workflows/runs/{runId}` | Get run details with events and server-derived DAG node states |
| GET | `/api/runs/{runId}/artifacts` | List artifact files produced by a run |
| GET | `/api/workflows/runs/by-worker/{platformId}` | Look up a run by worker conversation ID |
| POST | `/api/workflows/runs/{runId}/cancel` | Cancel a running workflow |
| POST | `/api/workflows/runs/{runId}/resume` | Resume a failed or paused workflow |
| POST | `/api/workflows/runs/{runId}/nodes/{nodeId}/retry` | Retry one DAG node in a failed/cancelled/completed run |
| POST | `/api/workflows/runs/{runId}/abandon` | Abandon a run (running, paused, or failed); cascade-cancels non-terminal `workflow:` sub-run descendants |
| POST | `/api/workflows/runs/{runId}/approve` | Approve a paused workflow (400 if paused blocked on a `workflow:` child — approve the child) |
| POST | `/api/workflows/runs/{runId}/reject` | Reject a paused workflow (400 if paused blocked on a `workflow:` child — reject the child) |
| DELETE | `/api/workflows/runs/{runId}` | Delete a terminal run and its events |
| GET (WebSocket) | `/api/workflows/runs/{runId}/terminal` | Interactive run terminal (not in OpenAPI) |

#### Run a Workflow

```bash
# JSON (no attachments)
curl -X POST http://localhost:3090/api/workflows/archon-assist/run \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain the auth module", "conversationId": "conv-123"}'

# JSON with a frozen Workflow ENV overlay
curl -X POST http://localhost:3090/api/workflows/archon-assist/run \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain the auth module", "conversationId": "conv-123", "envId": "<env-uuid>"}'

# multipart (with file attachments — max 5 files, ≤10 MB each)
curl -X POST http://localhost:3090/api/workflows/archon-assist/run \
  -F "conversationId=conv-123" \
  -F "message=Investigate this trace" \
  -F "envId=<env-uuid>" \
  -F "files=@stacktrace.txt" \
  -F "files=@screenshot.png"
```

**Optional `envId`.** Omitted or empty → YAML-only (no overlay). When present, Start loads that install-wide ENV row **after** parsing fields and **before** file upload or run-start message persistence, freezes a copy of its patches onto the dispatch context, and never re-reads the live row for that run. Missing id → `400 env_not_found`; row workflow mismatch → `400 env_workflow_mismatch`; corrupt row fails before Start side effects. Compatibility / provider / graph errors from applying the overlay surface on dispatch/SSE rather than as a synchronous Start body validation (Start keeps its multipart exception and does not OpenAPI-validate the run body).

There is **no** CLI `--env` flag and no chat natural-language ENV selection — console/HTTP only.

**Resume / retry.** Overlay-bearing runs replay only `metadata.envOverlay` on the run row (pending form at first insert, complete resolved snapshot before DAG execution). Editing or deleting the ENV after Start has no effect. Originally skipped node ids never begin applying later; ids that disappear from YAML after Start appear in `latestMissingNodeIds` without mutating frozen patches. Fresh `workflow:` child runs do **not** inherit the parent overlay.

**Supplying declared inputs.** A workflow that declares [`inputs:`](/guides/authoring-workflows/#running-a-workflow-that-declares-inputs) takes their values through an optional `inputs` map — a flat object of string values. Omit a name to take its declared `default:`.

```bash
# JSON: inputs is a nested object
curl -X POST http://localhost:3090/api/workflows/review-block/run \
  -H "Content-Type: application/json" \
  -d '{"message": "review it", "conversationId": "conv-123",
       "inputs": {"diff": "...", "style": "terse"}}'

# multipart: form fields are strings, so the same map travels JSON-encoded
curl -X POST http://localhost:3090/api/workflows/review-block/run \
  -F "conversationId=conv-123" \
  -F "message=review it" \
  -F 'inputs={"diff":"...","style":"terse"}' \
  -F "files=@context.md"
```

Values are validated against the workflow's declaration before any worktree, clone, or AI cost: a missing **required** input and an **undeclared** name are both refused up front, through the same contract a composing `with:` map goes through. `400` if `inputs` is not an object of strings (or, on multipart, not valid JSON). An empty object is the same as omitting the field.

#### List Run Artifacts

```bash
curl http://localhost:3090/api/runs/{runId}/artifacts
```

Walks the run's on-disk artifact directory (dotfiles skipped) and returns `{ files: [{ path, size, modifiedAt }] }`. Used by the run detail page's Artifacts tab. Returns `{ files: [] }` when the run has no codebase or the codebase name is not in `owner/repo` form; 400 on invalid run id or path-escape attempt, 404 if the run does not exist.

#### Resume a Failed or Paused Run

```bash
curl -X POST http://localhost:3090/api/workflows/runs/{runId}/resume
```

Resumes the workflow from where it left off, skipping already-completed nodes. Equivalent to `archon workflow resume <run-id>` from the CLI. Plain `archon workflow run <name>` invocations never resume implicitly.

#### Retry a Failed DAG Node

```bash
curl -X POST http://localhost:3090/api/workflows/runs/{runId}/nodes/{nodeId}/retry
```

Retries the selected node and its current DAG descendants in the same run. The run must be failed, cancelled, or completed, the node's latest effective status must be `failed` or `completed`, and Web retry only applies to web-created runs with a web parent conversation. CLI-created or non-web runs should use `archon workflow retry-node <run-id> <node-id>`.
Route-loop controller nodes are rejected as direct retry targets.
Retry a source dependency listed in the controller's `depends_on` so the refreshed source output reaches the controller again.

Success returns `{ success, message, runId, nodeId, retryEpoch, invalidatedNodes, safetyCommitSha? }`. The `safetyCommitSha` field is present when Archon created a safety ref before resetting the checkout.

#### Run Detail Route Events

`GET /api/workflows/runs/{runId}` includes raw workflow events and server-derived node states.
Route-loop decisions appear as `node_routed` events with snake_case route metadata:

```json
{
  "event_type": "node_routed",
  "step_name": "review-router",
  "data": {
    "from": "review",
    "outcome": "negative",
    "to": "fix",
    "condition": "$review.output.result == '<redacted>'",
    "condition_result": false,
    "negative_count": 1,
    "max_iterations": 3,
    "attempt": 1,
    "execution_seq": 4
  }
}
```

The `condition` value is a safe redacted string, not the raw author expression.
Historical route attempts remain in `events`, while current node summaries project the latest completed attempt.

#### Approve / Reject a Paused Run

```bash
# Approve (optionally with a comment)
curl -X POST http://localhost:3090/api/workflows/runs/{runId}/approve \
  -H "Content-Type: application/json" \
  -d '{"comment": "Looks good, proceed"}'

# Reject (optionally with a reason)
curl -X POST http://localhost:3090/api/workflows/runs/{runId}/reject \
  -H "Content-Type: application/json" \
  -d '{"reason": "Please add error handling first"}'
```

**Sub-run child gates (#2121 Phase 2):** when a `workflow:` sub-run pauses at its own gate, its parent run pauses "blocked on child". Approve/reject the **child** run (its id is in the parent's block message) — the parent auto-resumes when the child completes. A child gate is the exception: it works for a 1:1 sub-run, but a child that pauses inside a `fan_out:` expansion **fails the node** instead — a parent has one approval slot and cannot hand it to N children, so gate before or after the fan-out node rather than inside a child of it. Calling approve/reject on the *parent's* id while it is blocked on a child returns **400** with a redirect to the child id. `abandon` on a parent cascade-cancels its non-terminal sub-run descendants; the response's `cascadeFailures` is non-zero if part of the tree could not be reached, and `blockedParentRunId` is set when the abandoned run was itself a child stranding a paused parent.

#### Run Terminal WebSocket

This WebSocket is **not** represented in the OpenAPI document (`GET /api/openapi.json`) and is not a `registerOpenApiRoute` REST endpoint.

```
GET /api/workflows/runs/{runId}/terminal
```

Optional query: `resume` — an opaque 64-character lowercase hex token issued by the server on `ready`. Malformed tokens are treated as absent.

**Same-origin.** The upgrade requires a browser `Origin` header that matches `WEB_UI_ORIGIN` when that value is a concrete HTTP/HTTPS origin, or the request `Host` hostname when `WEB_UI_ORIGIN` is unset or `*`. Missing, malformed, opaque (`null`), and mismatched origins return `403` `{ "error": "Forbidden origin" }`.

**Identity.** Resolution matches the existing API gate: Better Auth session first, then the trusted `ARCHON_WEB_AUTH_HEADER` header (default `X-Archon-User`).
When either identity resolves, the terminal session is keyed by the canonical `remote_agent_users.id`.
When neither identity resolves and the API gate is enabled, the upgrade returns `401` `{ "error": "Authentication required" }`.
When neither identity resolves and the API gate is disabled, the session key uses the solo identity `solo`.

**Server-only targets.** The client cannot supply or override a working path, isolation environment ID, or container handle.
The server resolves the PTY from `workflow_runs.working_path` and the referenced isolation row: a host worktree or folder, a live managed container, or a locked unavailable state (`no_checkout`, `container_missing`, `container_stopped`, `unsupported_provider`).
A missing or stopped container never falls back to a host shell.

**Frames.** Client and server control frames are UTF-8 JSON text. PTY output frames are binary.

Client control messages:

```json
{ "type": "input", "data": "…" }
{ "type": "resize", "cols": 80, "rows": 24 }
{ "type": "close" }
```

- `input.data` is capped at 64 KiB UTF-8.
- `resize` requires integer `cols` in 1–500 and `rows` in 1–200.
- Extra keys on any client frame are ignored and never used for target resolution.
- Binary client frames are rejected.

Server control messages:

```json
{ "type": "ready", "resumeToken": "<64-hex>", "cols": 80, "rows": 24 }
{ "type": "exit", "code": 0, "signal": null }
{ "type": "unavailable", "reason": "no_checkout", "message": "…" }
{ "type": "error", "message": "…" }
```

**Session lifecycle.** One in-memory PTY exists per user and run.
A second active tab takes over the existing PTY, receives bounded replay (newest 256 KiB), and closes the previous socket with code `4001`.
A disconnected session may reconnect with the matching resume token for two minutes; after that, or after `close`, process exit, overflow, or server shutdown, the PTY is destroyed.
No terminal input, output, command history, resume tokens, or session rows are persisted.

---

## Commands

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/commands` | List available command names |

```bash
curl http://localhost:3090/api/commands
```

Query parameters:
- `cwd` (optional) -- Working directory for project-specific commands

Returns `{ commands: [{ name, source: "bundled" | "project" }] }`.

---

## Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/runs` | List enriched workflow runs for the dashboard |

Query parameters include status filters, date ranges, and pagination. Used by the Command Center UI.


## Usage

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/usage` | Installation-wide workflow usage report (direct runs only) |

Reuses the core `usageReport` contract (same defaults, filters, grouping, and
ledger coverage as [`archon usage`](/reference/cli/#usage)).

**Query parameters**

| Param | Notes |
|-------|-------|
| `from` / `to` | Half-open UTC `[from, to)`. Both required or both omitted. Instants are RFC 3339 with `Z` or numeric offset; fractional seconds optional and limited to 1–3 digits (millisecond precision — longer fractions are rejected, not truncated). Default without `runId`: current UTC calendar month. With `runId` alone: entire run (`from`/`to` null). Cross-run ranges capped at 366 days. |
| `codebaseId` | Project filter |
| `agentProvider` | Archon agent id (`claude`, `codex`, …) |
| `provider` / `model` | Upstream provider and model |
| `kind` | `unclassified` \| `advisor` \| `subagent` (`unclassified` maps to SQL null) |
| `runId` | Direct run only — **no child rollup** |
| `nodeId` | Exact persisted step name; requires `runId` |
| `groupBy` | `agent` \| `provider` (default) \| `model` \| `project` \| `run` \| `day` \| `node` (`node` requires `runId`) |

Response shape is camelCase `UsageReport`: nullable token/request/USD sums,
missing-value counts, separate `totals.reportedUsd` and `totals.estimatedUsd`,
group rows, and conservative coverage (`hasRecordedUsage`,
`unledgeredEventCount`, `historicalBackfill: false`).
More than 500 groups returns **400** (no silent truncation). Validation and
overflow errors are **400**.

Run detail (`GET /api/workflows/runs/{runId}`) includes nullable `usage` for
the same direct run with `groupBy=node`. A usage-query failure returns the
rest of the detail with `usage: null` rather than 500. Old runs without
ledger data return empty coverage (`hasRecordedUsage: false`), not zeros.

```bash
# Current UTC month by upstream provider
curl 'http://localhost:3090/api/usage'

# One run, per node
curl 'http://localhost:3090/api/usage?runId=<run-id>&groupBy=node'
```

See [Workflow usage and cost tracking](/getting-started/ai-assistants/#workflow-usage-and-cost-tracking)
and [Pricing (global only)](/reference/configuration/#pricing-global-only).

---

## Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Get read-only configuration (safe subset) |
| PATCH | `/api/config/assistants` | Update the default assistant and per-provider model defaults |
| PATCH | `/api/config/tiers` | Update model-tier presets (`small`/`medium`/`large`) |
| PATCH | `/api/config/aliases` | Update `@custom` model aliases (per-key merge; `null` unsets) |
| GET | `/api/providers/pi/models` | Pi's model catalog (cost/reasoning metadata; best-effort, `[]` on failure) |

`GET /api/config` returns the safe config subset, now including the configured `tiers`, the built-in `tierDefaults` for the current default provider (what an unset tier resolves to), and the configured `aliases`.

These config routes are **ungated** -- they write non-secret model config to `~/.archon/config.yaml` and work on solo installs (no `TOKEN_ENCRYPTION_KEY` required). Contrast with the [AI Provider Credentials](#ai-provider-credentials) routes below, which require an identity.

```bash
# Read current config (includes `tiers` + `tierDefaults`)
curl http://localhost:3090/api/config

# Set the default assistant
curl -X PATCH http://localhost:3090/api/config/assistants \
  -H "Content-Type: application/json" \
  -d '{"assistant": "claude"}'

# Or update per-provider model defaults
curl -X PATCH http://localhost:3090/api/config/assistants \
  -H "Content-Type: application/json" \
  -d '{"assistants": {"claude": {"model": "opus"}}}'

# Set a model tier (a `null` tier value unsets it, falling back to the built-in default)
curl -X PATCH http://localhost:3090/api/config/tiers \
  -H "Content-Type: application/json" \
  -d '{"tiers": {"large": {"provider": "claude", "model": "opus"}}}'

# Set a @custom alias (a `null` value unsets it)
curl -X PATCH http://localhost:3090/api/config/aliases \
  -H "Content-Type: application/json" \
  -d '{"aliases": {"@fast": {"provider": "claude", "model": "haiku"}}}'
```

---

## Per-User AI Preferences

Each user can override the install-wide model config with **personal** tiers, `@custom` aliases, and a default assistant — the highest-precedence resolver layer, applied to runs and chats *they* start. These routes require a resolved web identity (`X-Archon-User` header or a Better Auth session) but **no** `TOKEN_ENCRYPTION_KEY` — model names aren't secrets. Without an identity they return `401`, and model resolution stays config-only (solo installs are unchanged).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me/ai-prefs` | The current user's stored prefs (raw layer, not merged) |
| PATCH | `/api/auth/me/ai-prefs/tiers` | Update personal tier presets (per-key merge; `null` unsets) |
| PATCH | `/api/auth/me/ai-prefs/aliases` | Update personal `@custom` aliases (per-key merge; `null` unsets) |
| PATCH | `/api/auth/me/ai-prefs/default` | Set (or clear with `null`) the personal default assistant + default chat model (`{ provider, model? }` — written atomically; an omitted `model` clears any pin, and `model` without a `provider` is rejected) |

```bash
# Point YOUR `large` tier at opus without touching the install config
curl -X PATCH http://localhost:3090/api/auth/me/ai-prefs/tiers \
  -H "X-Archon-User: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{"tiers": {"large": {"provider": "claude", "model": "opus"}}}'
```

All writes validate the provider (registered), effort (provider vocabulary), and alias names (`@` prefix, not a reserved tier keyword), and return the updated prefs. The console exposes the same scopes as the **"This install / Just me"** toggle on AI Settings; the CLI as `archon ai … --scope user`.

---

## AI Provider Credentials

Per-user provider credentials let each user bill their runs and chats to **their own** API key or subscription instead of the shared install key. Unlike the config routes above, these endpoints are **gated**: they require `TOKEN_ENCRYPTION_KEY` (a 64-char hex secret) to be set *and* a resolved web identity (the `X-Archon-User` header, or a Better Auth session). On a solo install with no `TOKEN_ENCRYPTION_KEY`, `GET /api/auth/providers` returns `enabled: false` and the write routes return `404`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/providers` | List the current user's connected credentials (metadata only) |
| PUT | `/api/auth/providers/{provider}` | Connect (upsert) an API key for a provider |
| DELETE | `/api/auth/providers/{provider}` | Disconnect a provider credential (idempotent) |
| POST | `/api/auth/providers/{provider}/oauth/start` | Begin a subscription (OAuth) login |
| POST | `/api/auth/providers/{provider}/oauth/poll` | Poll a subscription login session |

Credentials are encrypted at rest; **no endpoint ever returns a secret value** -- responses carry only `provider`/`kind`/`label` metadata.

### List Connected Providers

```bash
curl http://localhost:3090/api/auth/providers \
  -H "X-Archon-User: your-user-id"
```

Returns `{ enabled, connections: [{ provider, kind, label }], available, subscriptionAvailable, agents }`:
- `available` -- every **vendor** id you can connect an API key for (`anthropic`, `openai`, `github-copilot`, plus the Pi backends). Legacy `claude`/`codex`/`copilot` ids are accepted on writes and normalized.
- `subscriptionAvailable` -- the subset that supports subscription (OAuth) login: **`anthropic`**, **`openai`**, and **`github-copilot`**. (The ChatGPT/Codex subscription runs an Archon-owned PKCE flow that captures the `id_token` the Codex CLI requires -- see [#1924](https://github.com/coleam00/Archon/issues/1924).)
- `agents` -- the agent -> credential matrix: per registered agent `{ id, displayName, catalog: 'static'|'dynamic', ready, credentials: [{ vendor, displayName, kinds, connected, subscriptionAvailable, installEnv, ambientConfigured? }] }`. `installEnv`/`ambientConfigured` report server-side detection so readiness renders on solo installs too; OpenCode is `catalog:'dynamic'` (introspect via `GET /api/providers/opencode/credentials`).

### Connect an API Key

```bash
curl -X PUT http://localhost:3090/api/auth/providers/openrouter \
  -H "X-Archon-User: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-...", "label": "personal"}'
```

Returns `{ success, provider, kind: "api_key", label }`. An unknown provider or a blank key returns `400`.

### Disconnect a Provider

```bash
curl -X DELETE http://localhost:3090/api/auth/providers/openrouter \
  -H "X-Archon-User: your-user-id"
```

Idempotent -- disconnecting a provider that was never connected still returns `{ success: true }`.

### Subscription Login (OAuth)

Subscription login is a two-step `start` -> `poll` flow held server-side. `start` returns a `mode`:
- `manual` (`anthropic`, Claude Pro/Max) -- show the returned `url`; the user authorizes in a browser and pastes the resulting code back via `poll`.
- `device` (`github-copilot`) -- show `userCode` + `verificationUri`; `poll` until connected.

```bash
# 1. Start a login session
curl -X POST http://localhost:3090/api/auth/providers/anthropic/oauth/start \
  -H "X-Archon-User: your-user-id"
# {"sessionId":"...","mode":"manual","url":"https://...","expiresIn":600}

# 2. Poll (pass the pasted `code` once, for manual flows)
curl -X POST http://localhost:3090/api/auth/providers/anthropic/oauth/poll \
  -H "X-Archon-User: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "...", "code": "the-pasted-code"}'
# {"status":"connected"}
```

`poll` returns `{ status: "pending" | "connected" | "error", detail? }`. A provider that does not support subscription login returns `400` on `start`.

The CLI equivalent of this whole surface is [`archon ai`](/reference/cli/#ai). For the end-to-end setup walkthrough, see [Per-user credentials and AI Settings](/getting-started/ai-assistants/#per-user-credentials-and-ai-settings).

---

## System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/update-check` | Check for available updates (binary builds only) |

Returns `{ updateAvailable, currentVersion, latestVersion, releaseUrl }`. For non-binary (source) builds, always returns `updateAvailable: false` without making external requests.

---

## SSE Streaming

| Path | Description |
|------|-------------|
| `/api/stream/{conversationId}` | Real-time events for a conversation |
| `/api/stream/__dashboard__` | Multiplexed workflow events across all conversations |

These are Server-Sent Events (SSE) endpoints -- connect with `EventSource` in a browser or any SSE client.

```bash
# Listen to a conversation stream
curl -N http://localhost:3090/api/stream/your-conversation-id
```

Events are JSON-encoded with a `type` field. See the [Web UI documentation](/adapters/web/#sse-streaming) for the full list of event types.
Live `node_routed` workflow events are forwarded as `dag_node` SSE payloads with `status: "completed"` and a `routeDecision` object containing the same route metadata.

---

## Common Patterns

### Create a Conversation and Send a Message

```bash
# 1. Create a conversation
CONV_ID=$(curl -s -X POST http://localhost:3090/api/conversations \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.platform_conversation_id')

# 2. Send a message
curl -X POST http://localhost:3090/api/conversations/$CONV_ID/message \
  -H "Content-Type: application/json" \
  -d '{"message": "/status"}'

# 3. Poll for messages
curl http://localhost:3090/api/conversations/$CONV_ID/messages
```

### Run a Workflow via the API

```bash
# 1. Create a conversation scoped to a codebase
CONV_ID=$(curl -s -X POST http://localhost:3090/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"codebase_id": "your-codebase-id"}' | jq -r '.platform_conversation_id')

# 2. Start the workflow
curl -X POST http://localhost:3090/api/workflows/archon-assist/run \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"How does auth work?\", \"conversationId\": \"$CONV_ID\"}"

# 3. Monitor via SSE
curl -N http://localhost:3090/api/stream/$CONV_ID
```
