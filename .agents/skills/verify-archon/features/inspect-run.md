# Inspect a workflow run

Inspect a workflow run lets a user list recent runs for this project, open one run, and read its lifecycle state after a workflow has actually executed.

## Automated Coverage

`runs.inspection` creates a real CLI-origin HITL run in the isolated home, then
asserts the same paused run ID in CLI get/status/list and HTTP detail/list.
It does not prove abandonment or a completed run's terminal state. The steps
below are additional manual exploration, not extra guarantees from this recipe.

## Sub-features

- `runs-list` lists recent runs via CLI and `GET /api/workflows/runs`.
- `run-get` shows one run's state, terminal flag, and node summaries.
- `run-status` lists non-terminal (running/paused) runs.
- `run-abandon` cancels a non-terminal run the user asked to stop. `--json` still performs the cancel and prints a one-line ack; it is not a record-only flag (unlike `approve` / `reject` / `resume --json`). This recipe lists but does not drive abandon.

## How to get to it (user POV)

- Run `archon workflow runs --json` after a `workflow run`.
- Run `archon workflow get <run-id> --verbose --json`.
- Run `archon workflow status --json` for active runs.
- Open `/console` or `/console/p/<projectId>/r/<runId>`. Console run **detail** reads `GET /api/workflows/runs/:id` (same as this recipe). Console run **list** reads `GET /api/dashboard/runs`, not `GET /api/workflows/runs`.

## Driving it with verify-archon

Preconditions:

- `verify-archon doctor` passed.
- At least one real run exists in the isolated home. The automated recipe creates its own; a dry-run does not create one. Never invent a run row.
- You have the full run id from `workflow runs` / `workflowRunRef.runId`, not a detached ack.

- **List runs.** Ask for recent runs. Run `verify-archon cli -- workflow runs --json`. Exit code `0`. The `runs` array contains the expected id.
- **HTTP list.** Read the same list from the server. Run `verify-archon http /api/workflows/runs`. Status `200`. The payload includes the same run id.
- **Get one run.** Inspect lifecycle. Run `verify-archon cli -- workflow get <run-id> --verbose --json`. `result.state` is a known status (`completed`, `failed`, `running`, `paused`, `cancelled`, …). `result.terminal` is a boolean. `workflowRunRef.runId` equals `<run-id>`.
- **Status of actives.** List live work. Run `verify-archon cli -- workflow status --json`. A completed deterministic run does not appear as running.
- **Proof.** Evidence contains `runs.cli.json`, `runs.http.json`, `get.cli.json`, and `status.cli.json`. The get payload's id matches the list.

## Gotchas

- Read `result.state` and `result.terminal` from `workflow get --json`, not from log prose.
- `approve` / `reject` / `resume` with `--json` do not continue execution inline. After a gate, resume only when `resumable` is true.
- Never mark a running or paused run abandoned because it looks stale. That is a cross-process lifecycle mutation.
- HTTP `GET /api/workflows/runs` is install-wide; CLI `workflow runs` defaults to this project cwd. Compare ids, not list length. Console's visible list is `GET /api/dashboard/runs` and can differ in shape and pagination.
- `--all` on `workflow runs` ignores cwd scope. Do not use it unless you intend a cross-project view.
