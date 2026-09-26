# Phase E — Files changed and Git attribution

Branch: `worktree-agent-a904da4cc0030786b` (worktree of `develop-2`)
Stories: 5.1 (run-level Files Changed panel), 5.2 (deterministic Git attribution)

## Outcome

Both stories are implemented, tested, and verified end to end against a real
workflow run in an isolated Archon home. `bun run validate` passes in full.

## Design

### 5.2 — Attribution evidence

A new table, `remote_agent_workflow_node_execution_evidence`, holds one row
per node execution attempt (`packages/core/src/db/workflow-node-execution-evidence.ts`,
schema in `migrations/000_combined.sql` and `packages/core/src/db/adapters/sqlite.ts`).
A row is inserted with `INSERT` (not upserted by a `(run, node, epoch)` key) so a
node that runs more than once in the same run and epoch — a loop body, a
reactivated route target — gets its own row instead of overwriting a sibling
attempt's evidence.

The executor (`packages/workflows/src/node-execution-evidence.ts`, wired into
`packages/workflows/src/dag-executor.ts`) captures a git snapshot at node start
and again at node end, reusing the same commit-then-bookmark technique as the
existing retry-checkpoint mechanism (`@archon/git`'s `createGitVisibleChangesCommit`)
via a new sibling ref namespace, `refs/archon/evidence/<runId>/<executionId>/<start|end>`
(`packages/git/src/execution-evidence.ts`). The pre-existing retry checkpoint is
untouched; the two systems are independent so a git-attribution bug can never
break `workflow retry-node`. Both captures are best-effort: any failure is
logged and leaves that execution's evidence incomplete — it never fails the
node. The end capture runs from a `finally` block around the existing per-node
dispatch closure in `dag-executor.ts`, gated by a flag set only when the start
capture actually ran, so a skipped/blocked/cached node never gets stray evidence.

The server computes attribution (`packages/server/src/routes/git/execution-attribution.ts`)
using only `@archon/git` functions (a new `diffCommitRange` alongside the
existing `changedFiles`) — never provider prose or tool names. Two rules
handle the cases a reviewer flagged before implementation:

- **Repeated/retried executions.** Only the highest retry epoch of each node
  is considered — an earlier attempt's start commit was reset away by
  `workflow retry-node` and is no longer an ancestor of the current checkout.
- **Concurrent executions.** Nodes in the same DAG layer can run concurrently
  on one shared checkout, so two executions whose recorded time ranges overlap
  cannot each be trusted to own the diff between their own commits. Any pair
  with an overlapping range is excluded from confident attribution entirely
  for every path — verified by `execution-attribution.test.ts`, including the
  case where an unrelated, non-overlapping third execution keeps its own
  confident attribution.

Timestamps are computed in application code (`new Date().toISOString()`), not
via SQL `NOW()`/`datetime('now')`, because SQLite's `datetime('now')` has only
whole-second precision — coarse enough that two fast, genuinely sequential
executions could look like they overlapped and lose provable attribution for
no real reason.

### 5.1 — Files Changed panel

`GET /api/workflows/runs/{runId}/files-changed` (schema in
`packages/server/src/routes/schemas/files-changed.schemas.ts`) returns the
CAP-6 empty envelope when there is no checkout, an empty `files: []` when no
node execution ever proved a checkout snapshot, or the attributed path list
otherwise. The run-level "what changed" baseline is the start snapshot of the
temporally earliest execution still relevant to the checkout's current state,
diffed against `HEAD` — fully evidence-anchored, with no dependency on the
live working tree (which the executor's own checkpoint commits keep clean
between nodes).

Both shells get a "Files changed" tab next to their existing tabs (Legacy:
`packages/web/src/components/workflows/source-control/files-changed-tab.tsx`;
Console: `packages/web/src/experiments/console/components/FilesChangedPanel.tsx`),
each a thin, independent component per the project's Console/Legacy split
rule. Shared, render-neutral logic (middle-eliding a path, describing an
executions list, the empty-state copy) lives in `packages/web/src/lib/files-changed.ts`,
imported by both; Console does not import from `@/components/`.

## Files changed

New:

- `packages/git/src/execution-evidence.ts` (+ test)
- `packages/workflows/src/node-execution-evidence.ts` (+ test)
- `packages/core/src/db/workflow-node-execution-evidence.ts` (+ test)
- `packages/server/src/routes/git/execution-attribution.ts` (+ test)
- `packages/server/src/routes/git/files-changed-route.ts`
- `packages/server/src/routes/git/files-changed-handler.ts`
- `packages/server/src/routes/schemas/files-changed.schemas.ts`
- `packages/server/src/routes/api.files-changed.test.ts`
- `packages/web/src/lib/files-changed.ts` (+ test)
- `packages/web/src/components/workflows/source-control/files-changed-tab.tsx` (+ test)
- `packages/web/src/experiments/console/components/FilesChangedPanel.tsx` (+ test)

Modified (additive):

- `migrations/000_combined.sql`, `packages/core/src/db/adapters/sqlite.ts`,
  `packages/core/src/db/adapters/sqlite.test.ts`,
  `packages/core/src/db/bundled-schema.generated.ts` (regenerated) — new table
- `packages/git/src/index.ts`, `packages/git/src/retry-refs.ts` — new exports,
  evidence ref prefix added to run-deletion cleanup
- `packages/workflows/src/store.ts`, `packages/workflows/src/dag-executor.ts` —
  new optional store methods, ~15 lines at two call sites (flag, begin call,
  finally block); no existing line changed
- `packages/core/src/workflows/store-adapter.ts` — wires the new store methods
- `packages/server/src/routes/api.ts` — registers the new route (2 lines +
  imports), touching only lines adjacent to the existing git routes
- `packages/web/src/lib/api.ts`, `packages/web/src/lib/api.generated.d.ts`
  (regenerated), `packages/web/src/components/workflows/WorkflowExecution.tsx`
  (+ test), `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx`,
  `packages/web/src/experiments/console/components/StreamToolbar.tsx`,
  `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`,
  `packages/web/src/experiments/console/routes/RunDetailPage.tsx`,
  `packages/web/src/experiments/console/skills/runs.ts`,
  `packages/web/src/experiments/console/store/keys.ts`
- `packages/workflows/package.json`, `packages/core/package.json`,
  `packages/server/package.json` — new test files added to the mock-isolation
  test script chains, each in its own segment where its mocking needs that

## Tests

New unit/integration coverage: `packages/git/src/execution-evidence.test.ts`
(5), `packages/workflows/src/node-execution-evidence.test.ts` (4),
`packages/core/src/db/workflow-node-execution-evidence.test.ts` (5),
`packages/server/src/routes/git/execution-attribution.test.ts` (13, including
the overlap and retry-epoch cases), `packages/server/src/routes/api.files-changed.test.ts`
(6), `packages/web/src/lib/files-changed.test.ts` (9),
`packages/web/src/components/workflows/source-control/files-changed-tab.test.tsx` (5),
`packages/web/src/experiments/console/components/FilesChangedPanel.test.tsx` (4).

- Type check: pass (`bun run type-check`, every package)
- Lint: pass (`bun run lint --max-warnings 0`)
- Format: pass (`bun run format:check`)
- Full test suite: pass (`bun run test` — root, every package, zero failures)
- `check:bundled`, `check:bundled-schema`, `check:bundled-skill`,
  `check:pi-vendor-map`, `check:capability-matrix`, `test:install`: pass
- `check:schema-upgrades`: skipped — no reachable PostgreSQL in this
  environment (`pg_isready` not installed)

## End-to-end verification

Isolated Archon home at a scratch path (copied from `~/.archon`), server on
port 3321, web on port 5191, a scratch git repo with a 3-node workflow
(`edit-one` → `edit-two` → `review` approval gate). `edit-one` and `edit-two`
each touched `shared.txt`; `edit-one` alone touched `one.txt`; `edit-two`
alone created `two.txt`; `review` is the approval node with no checkpointable
evidence by design.

`GET .../files-changed` after the run completed:

```json
{
  "files": [
    { "path": "one.txt", "status": "M", "executions": [{ "nodeId": "edit-one", ... }] },
    { "path": "shared.txt", "status": "M", "executions": [
        { "nodeId": "edit-one", ... }, { "nodeId": "edit-two", ... }
    ] },
    { "path": "two.txt", "status": "A", "executions": [{ "nodeId": "edit-two", ... }] }
  ]
}
```

`shared.txt` lists both executions in chronological order, proving the
multi-attribution path; the `review` node has zero rows in the evidence table
(confirmed directly against the SQLite file), proving the no-evidence path.
Screenshots of both shells rendering this exact result:
`plans/260926-1521-agent-node-room-completion/evidence/phase-e/legacy-files-changed.png`
and `.../console-files-changed.png`.

## Commits

Two commits, per story:

- `feat(workflows): attribute git changes to node executions` (5.2 — evidence
  capture, attribution algorithm)
- `feat(web): add a run-level files changed panel` (5.1 — API route and both
  shells' UI)

## Unresolved questions

- `check:schema-upgrades` could not run in this environment; a reachable
  PostgreSQL should run it before merge, per `AGENTS.md`.
- The approval node used to prove "no evidence" hit a pre-existing, unrelated
  warning (`ARCHON_PUBLIC_URL is required for approval callbacks`) when the
  executor tried to enqueue an external event for the approval request. It did
  not block the run and is outside this phase's scope — noting it here in case
  another phase's verification run trips over the same log line.
