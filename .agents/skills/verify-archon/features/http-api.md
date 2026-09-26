# HTTP lifecycle

## Sub-features

Projects and conversations, workflow definition CRUD, input errors, and answering a real Ask request.

## How to get to it (user POV)

Use the running server's `/api/codebases`, `/api/conversations`, and `/api/workflows/<name>` routes.
Inspect `/api/workflows/runs/<run-id>` and answer its pending Ask through `/api/workflows/runs/<run-id>/ask/<tool-use-id>/answer`.

## Driving it with the HTTP harness

Run `http.lifecycle`.
The recipe starts the real server with a private SQLite database and checks `/api/health` and `/api/auth/status`.
Create a project and conversation, update the title, and read it back.
Save, update, read, and delete a workflow; confirm malformed input returns 400 and a deleted workflow returns 404.
Start a web workflow, answer its real pending Ask, confirm a duplicate answer returns 409, and wait for completion.
Read the retained answer back from the run.
The evidence records requests, responses, persisted outcomes, and resource cleanup.

## Gotchas

Port 13400 must be available.
This recipe uses solo mode and does not prove login or multi-user authorization.
The target Web UI must compile, and the E2E dependencies must be installed.
