# Workflow control

## Sub-features

Execution and artifact persistence, failed-node retry, approval and rejection, resume and cancellation, and invalid input.

## How to get to it (user POV)

Use `archon workflow run <name> --no-worktree`, then `workflow get <run-id> --json`.
Use `workflow retry-node <run-id> <node-id>` for a failed node.
Use `workflow approve`, `reject`, `resume`, or `cancel` with the run ID to control it.

## Driving it with the CLI harness

Run `workflow.execution` to check completed output, persisted workflow events, artifact bytes, and failure followed by successful retry.
Run `workflow.governance` to check a paused gate, JSON approval without inline execution, blocking resume, rejection, and cancellation.
Run `workflow.invalid-input` to check missing arguments and unknown workflows or runs through public JSON output and exit codes.
Each recipe invokes the real CLI and inspects its isolated persisted state.
Retain its command transcript and cleanup result.

## Gotchas

JSON approval records a decision; it does not execute the next node.
Use the blocking resume command to prove continuation.
These recipes use deterministic script nodes and do not prove provider reasoning or external platform delivery.
