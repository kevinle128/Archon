# Preview Deterministic Workflow Routing

Run a deterministic workflow lets a user execute `e2e-deterministic` — bash and script nodes, `$node.output` substitution, `when:`, and `trigger_rule` — with zero AI provider calls.

## Automated Coverage

The current `workflows.dry-run` scenario proves a completed simulation with
explicit stubs and an unchanged persisted run listing. It does not execute node
bodies or establish real workflow completion. The executable helper supplies
`scenarios/e2e-deterministic.stubs.json`; the optional operations below are not
part of its PASS verdict.

## Sub-features

- `dry-run-control-flow` simulates DAG routing without creating a run.
- `dry-run-exec-code` executes trusted local bash/script nodes during dry-run.
- `run-real` creates a real run and reaches a terminal state without a provider.
- `run-json-detach` is the fire-and-forget shape used for long AI runs; not required here.

## How to get to it (user POV)

- Run `archon workflow run e2e-deterministic --dry-run --stubs .agents/skills/verify-archon/scenarios/e2e-deterministic.stubs.json --json` from the tooling repo.
- Add `--exec-code` when the local bash/script nodes are trusted (they are, in this checkout).
- Run `archon workflow run e2e-deterministic --no-worktree` to create a real run in the live checkout (user must accept that).
- Default `workflow run` creates a git worktree. Prefer that unless the user asked for `--no-worktree`.

## Driving it with verify-archon

Preconditions:

- `verify-archon doctor` passed.
- `e2e-deterministic` appears in `verify-archon cli -- workflow list --json`.
- Isolated `ARCHON_HOME` is set so run rows do not land in the operator's `~/.archon`.
- `uv` is optional. Without it, the `script-python` node fails a real run and `--exec-code`. Stubbed dry-run still proves completed routing; a bare `--dry-run --json` (no stubs, no `--exec-code`) emits a routing trace with `missingStubs` and exits `78`. Without `--json`, the same routing failure prints the trace and exits `1`.

- **Dry-run routing.** Run `verify-archon prove --scenario workflows.dry-run`. It supplies stubs, asserts `outcome: completed`, and compares the complete before/after run listings. A missing stub or changed listing fails.
- **Confirm dry-run isolation.** Observe that no provider was contacted and no new run id appeared. Run `verify-archon cli -- workflow runs --json` again. The run count matches the pre-dry-run count.
- **Optional exec-code.** Execute trusted nodes. Run `verify-archon cli -- workflow run e2e-deterministic --dry-run --exec-code --json`. Exit code `0` if `bun` and `uv` both exist. If `uv` is missing, record the `script-python` failure (`Executable not found … uv`) and do not claim that node ran. Still no run row.
- **Optional real run.** Create a run only when proving this feature live (not required for the generator's one-feature pass). Run `verify-archon cli -- workflow run e2e-deterministic --no-worktree --json` is **not** a clean JSON document unless `--detach` is also set. Prefer the human stream, then `workflow runs --json` / `workflow get <id> --json`. `result.state` is `completed` and `result.terminal` is true on success.
- **Proof.** The automated recipe keeps `dry-run.cli.json` and the unchanged listing (`runs-before.cli.json` / `runs-after-dry-run.cli.json`). A manual bare dry-run also records `dry-run.cli.exit`. Optional exec-code writes `dry-run-exec-code.cli.json`.

## Gotchas

- `--dry-run` does not execute bash/script nodes unless `--exec-code` is set. A green stubbed dry-run proves routing, not node bodies. A bare `--dry-run --json` that emits a trace (exit `78` / `missingStubs` on this workflow) is also routing proof — do not treat that exit as instance death. Without `--json`, expect exit `1` for the same missing-stub failure.
- `--exec-code` can write files. Only use it on this repo's `e2e-deterministic` nodes, never on an untrusted workflow.
- A real run can emit progress before its JSON envelope. Read its structured final envelope, not a detached acknowledgement or prose status.
- Detached ack has `conversationId` and `logPath`, not the run id. Wait for `workflow runs --json` and match `worker_platform_id`.
- Default isolation creates a worktree. Cleanup of a real run must not `git clean -fd` and must not delete evidence.
- Mini remote is the wrong place to create throwaway runs unless the user asked.
