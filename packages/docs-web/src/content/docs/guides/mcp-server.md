---
title: Archon as an MCP Server
description: Start, watch, and answer Archon workflow runs from an MCP client through the /mcp endpoint, with the tasks and events extensions.
category: guides
area: server
audience: [user, developer]
status: current
sidebar:
  order: 8
---

Archon serves the [Model Context Protocol](https://modelcontextprotocol.io/) at `POST /mcp`
on the same port as the web UI and REST API (default `3090`). An MCP client (an agent
runtime, the MCP Inspector, or a script) can start a workflow run, follow it, answer its
approval gates, and receive a push event when its status changes.

This page is about Archon **being** an MCP server. To give workflow nodes access to
**other** MCP servers, see [Per-Node MCP Servers](/guides/mcp-servers/).

## Protocol and transport

| Item | Value |
|------|-------|
| Endpoint | `POST http://<host>:3090/mcp` |
| Protocol revision | `2026-07-28` only. There is no `initialize`; clients call `server/discover` and send their capabilities in every request's `_meta`. A 2025-era `initialize` gets `400` with error `-32022`. |
| Transport | Streamable HTTP. Every request is a POST. `GET` and `DELETE` get `405`. |
| Required headers | `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: <method>`, and `Mcp-Name` (= `params.name` for `tools/call`, `events/poll`, `events/stream`; = `params.taskId` for `tasks/*`). A missing or wrong header gets `400` with `-32020`. |
| Extensions | `io.modelcontextprotocol/tasks` and `io.modelcontextprotocol/events`, both listed in `server/discover` capabilities. |

## Access boundary

`/mcp` uses the same access gate as `/api/*`:

- When web auth is off (solo installs), the endpoint is open, like the REST API. Keep the
  port on a trusted network (for example a tailnet), or put a reverse proxy in front.
- When web auth is on, every request needs a Better Auth session cookie or the trusted
  proxy header (`X-Archon-User` or `ARCHON_WEB_AUTH_HEADER`), else `401`.

The tools call the REST API in-process with the caller's identity headers, so runs are
attributed to the same user as a web UI request would be. Anyone who passes the gate can
answer an approval gate through `tasks/update`.

Browser requests are checked by `Origin`: no `Origin` header is allowed (non-browser
clients); otherwise the origin must be the `ARCHON_PUBLIC_URL` origin or a loopback origin
(`localhost`, `127.0.0.1`, `[::1]`), else `403`. This blocks DNS-rebinding attacks.

Links in results and events use `ARCHON_PUBLIC_URL` (`<url>/runs/<run_id>`). When it is
unset, results use the request's origin and events use `http://localhost:<port>`.

## Tools

`tools/list` returns these three tools in this order.

### `run_workflow`

```json
{ "workflow": "archon-assist", "codebase": "owner/repo", "message": "Explain the auth module" }
```

- `codebase` is a codebase id, a codebase name (case-insensitive), or a repository URL such
  as `github.com/owner/repo` (scheme and `.git` optional). There is no fuzzy match: no match
  or more than one match is a tool error that lists the candidates.
- The workflow must exist for that codebase.
- Each call creates a new conversation and starts the run with a server-chosen run id
  (the run route's `runId` field), then waits up to 120 s for the run row (the row is
  created after worktree isolation, which can include a slow `git fetch`).
- If the request declared `io.modelcontextprotocol/tasks`, the result is a task:
  `{ "resultType": "task", "taskId": "<run id>", "status": "working", "ttlMs": 2592000000, "pollIntervalMs": 5000, ... }`.
  Without the extension, the result is a plain tool result with
  `structuredContent: { run_id, url }`.
- If the run row does not appear in time, the result is a tool error with the run id, the
  last message Archon wrote to the conversation (for example why the workflow refused to
  start), and the hint that the run may still start with this run id: poll `get_run` or
  `tasks/get`.

### `get_run`

`{ "run_id": "<id>" }` returns
`{ run_id, workflow, status, task_status, current_node, question?, pr_url?, url, started_at, completed_at, error? }`.

### `list_runs`

`{ "workflow"?: string, "status"?: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled", "limit"?: 1-100 }`
returns `{ runs: [<get_run summary>, ...] }`, newest first (default limit 20). The `workflow`
filter is applied to the newest 200 runs.

## Tasks

The task id is the Archon run id. A task is never expired or failed because of its TTL.

| Archon run | Task status | Details |
|------------|-------------|---------|
| `pending`, `running` | `working` | `statusMessage` = the running node |
| `paused` at an approval or interactive-loop gate, not answered yet | `input_required` | `inputRequests` (below) |
| `paused`, answer recorded, resume pending | `working` | `statusMessage: "answer received"` |
| `paused` at another gate (`workflow:` child, container write-back, Plannotator) | `working` | `statusMessage` names the gate and the run URL; answer it in Archon |
| `completed` | `completed` | `result` = `{ resultType: "complete", content, structuredContent: { run_id, workflow, outcome?, pr_url?, ci?, url, output } }`. `output` is the parsed output of the workflow's `returns:` node, else of the last completed node. |
| `failed` | `failed` | `error: { code: -32603, message, data: { run_id, url, output? } }` |
| `cancelled` | `cancelled` | |

`tasks/*` requests from a client that did not declare the tasks extension get `-32021`.
A `taskId` that is not a run id (a UUID, or the 32-hex form SQLite generates) gets
`-32602`; so does an unknown run.

### Approval gates

On `input_required`, `tasks/get` returns one input request. Its key is
`approval-<nodeId>` for the first pause of that node in the run, and
`approval-<nodeId>-<n>` for the n-th pause (rework after a rejection, or another
iteration of an interactive loop). Treat keys as opaque.

```json
{
  "approval-review": {
    "method": "elicitation/create",
    "params": {
      "mode": "form",
      "message": "<approval message>\n\nRun: <url>",
      "requestedSchema": {
        "type": "object",
        "properties": {
          "decision": { "type": "string", "enum": ["approve", "reject"] },
          "comment": { "type": "string" }
        },
        "required": ["decision"]
      }
    }
  }
}
```

The request is included only when that `tasks/get` declared the `elicitation` client
capability. Otherwise `inputRequests` is `{}` and `statusMessage` holds the question and
"Answer in the Archon UI: <url>".

Answer with `tasks/update`:

```json
{ "taskId": "<run id>", "inputResponses": { "approval-review": { "action": "accept", "content": { "decision": "approve", "comment": "ok" } } } }
```

- `approve` → the run route's approve with the comment; `reject` → reject with the comment
  as the reason (default "Rejected through MCP"). Archon then resumes the run.
- `decline` / `cancel` actions, unknown keys, and keys of an earlier pause do nothing.
- An approve or reject that Archon refuses (for example the run is no longer paused) is
  returned as `-32602` with Archon's message.

`tasks/cancel` cancels a `working` run. A run waiting for an answer stays paused (the
cancel is acknowledged only), so a person can still answer it in Archon. A finished run is
acknowledged without change.

## Events

One event type, `workflow_run.status_changed`, with `poll` and `push` delivery.

- Arguments (all optional): `run_id` (a run id, else `-32602`), `workflow`. No arguments =
  every run of the install.
- Payload: `{ run_id, workflow, status, task_status, node?, question?, pr_url?, ci?, url, error? }`.
  `ci` (`{ conclusion, failed, checks_url }`) is set on the terminal event when the
  workflow's final output has it.
- One event per change of status or open gate, plus one when a PR link (`pr_url` in a node's
  JSON output) first appears while the run is still running.
- `eventId` = `<run_id>:<seq>` (seq counts from 1 per run).
- Events come from a durable log (`remote_agent_workflow_run_status_log`), so cursors stay
  valid across a restart. Changes made by other processes (for example a CLI cancel) are
  picked up within about 15 s; several changes in that window collapse into the latest state.

**Cursors** are opaque strings. One cursor is valid for any arguments, so the usual pattern
is: take a cursor with `events/poll { cursor: null }`, start the run, then open
`events/stream { arguments: { run_id }, cursor }` and receive the run's events from seq 1.
`cursor: null` means "from now" (no history). `maxAgeMs` limits replay; if it skips events,
the response says `truncated: true`. A cursor that does not parse is `-32602`; an unknown
event name is `-32023`.

`events/poll` returns `{ events, cursor, truncated, hasMore, nextPollMs }` (up to
`maxEvents`, default 50, max 200). `nextPollMs` is 5000 while a matching run is active,
else 30000.

`events/stream` answers with an SSE stream: first `notifications/events/active`, then one
`notifications/events/event` per row (each with its `cursor`), and a
`notifications/events/heartbeat` with the checked-up-to cursor every 20 s. Every frame has
`_meta["io.modelcontextprotocol/subscriptionId"]` = the request id. The stream stays open
after a terminal event; close the request to end it. Reconnect with the last cursor.

Webhook delivery (`events/subscribe`) is not offered.

## Try it

### With a script

```bash
MCP=http://localhost:3090/mcp
META='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1"},"io.modelcontextprotocol/clientCapabilities":{"elicitation":{"form":{}},"extensions":{"io.modelcontextprotocol/tasks":{},"io.modelcontextprotocol/events":{}}}}'
mcp() { # mcp <method> <mcp-name or ""> <params without the outer braces>
  local h=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream'
           -H 'mcp-protocol-version: 2026-07-28' -H "mcp-method: $1")
  [ -n "$2" ] && h+=(-H "mcp-name: $2")
  curl -sN "$MCP" "${h[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":{$3${3:+,}$META}}"
}

mcp server/discover '' ''
CURSOR=$(mcp events/poll workflow_run.status_changed '"name":"workflow_run.status_changed","cursor":null' | jq -r .result.cursor)
RUN=$(mcp tools/call run_workflow '"name":"run_workflow","arguments":{"workflow":"archon-assist","codebase":"owner/repo","message":"hello"}' | jq -r .result.taskId)
mcp tasks/get "$RUN" "\"taskId\":\"$RUN\"" | jq .result
mcp events/stream workflow_run.status_changed "\"name\":\"workflow_run.status_changed\",\"arguments\":{\"run_id\":\"$RUN\"},\"cursor\":\"$CURSOR\""
```

### With the MCP Inspector

Run `npx @modelcontextprotocol/inspector`, choose the Streamable HTTP transport, and enter
`http://localhost:3090/mcp`. The Inspector must support protocol revision `2026-07-28`;
older versions send `initialize` and get `-32022`.
