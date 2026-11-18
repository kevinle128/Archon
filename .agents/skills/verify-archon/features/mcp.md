# MCP server

## Sub-features

Protocol discovery, the workflow tool list, an empty run list, the status-event catalog, a rejected protocol header, and a rejected browser origin.

## How to get to it (user POV)

POST `/mcp` on the running server. Send JSON-RPC with `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method` set to the body method.
Call `server/discover`, then `tools/list`. Call `tools/call` for `list_runs` with `Mcp-Name: list_runs`. Call `events/list` for the events extension.
A request without the protocol header is refused. A browser `Origin` that is not loopback and not `ARCHON_PUBLIC_URL` is refused.

## Driving it with the HTTP harness

Run `mcp.discovery`.
The recipe starts the real server with a private SQLite database and the built Web UI.
It checks discovery (server name `archon`, protocol `2026-07-28`, both extensions), the three tool names, a real `list_runs` result, and `events/list`.
It checks that a missing protocol header returns 400 with JSON-RPC `-32020`, and that `Origin: https://evil.example.com` returns 403.
The evidence records each request, response, and resource cleanup.

## Gotchas

Port 13400 must be available.
This recipe uses solo mode and does not prove login.
It does not start a workflow, answer a gate, cancel a task, or hold `events/stream`.
The target Web UI must compile, because the isolated server requires the built bundle.
