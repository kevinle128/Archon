# See This Run's Uncommitted Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Source Control tab to the legacy DAG run screen that fetches and lists the selected run's live uncommitted files as `M`, `A`, or `D`, with manual refresh, quiet empty/error states, and no client-supplied checkout path.

**Architecture:** `@archon/git` owns the read-only `git status --porcelain=v1 -z` projection and revision fingerprint.
The server resolves the existing run row, performs the adopted container/no-checkout gate, canonicalizes `workflow_runs.working_path`, and exposes one OpenAPI JSON route.
Focused web components own the tab, request lifecycle, frozen displayed snapshot, and accessible Changes list so the existing 885-line `WorkflowExecution.tsx` receives only a small integration edit.

**Tech Stack:** Bun, strict TypeScript, `child_process.execFile` through `@archon/git` `execFileAsync`, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, Radix Tabs, and Bun tests.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md` Story 1.1.
**Companion decisions:** `_bmad-output/specs/spec-archon-source-control/SPEC.md`, `_bmad-output/specs/spec-archon-source-control/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-6, AD-7, and AD-9, and `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-08-31/EXPERIENCE.md`.
**Readiness:** `_bmad-output/planning-artifacts/epics-source-control/implementation-readiness-report-2026-09-06.md`.
**Issue:** [#75](https://github.com/anhle128/Archon/issues/75), tracker key `1-1-see-this-runs-uncommitted-files`.

## Global Constraints

- Story 1.1 is list-only, so do not add History, a viewer, `react-diff-view`, a 30/70 split, or an empty viewer pane.
- The v1 surface is `/legacy/workflows/runs/:id`; do not import from or change `packages/web/src/experiments/console/`.
- The client sends only `runId`; it never sends `working_path`, an absolute path, or a file reference in this story.
- The server reads the existing `workflow_runs.working_path`; do not add a column and do not reconstruct the checkout from isolation metadata.
- Git commands use `execFileAsync` with an argv array; never use `exec`, a shell command string, or caller-controlled interpolation.
- JSON routes use the local `registerOpenApiRoute(createRoute(...), handler)` wrapper.
- Web response types are generated from the running server into `packages/web/src/lib/api.generated.d.ts`; do not hand-edit that generated file.
- Auth matches the existing run-detail and artifact routes: the global `/api/*` gate only, with no `requireWebUser` and no per-run owner ACL.
- CAP-6 is HTTP 200 with `emptyReason: "container" | "no_checkout"`; it is not a 404.
- A missing conversation, a null `conversation.isolation_env_id`, or a missing isolation-environment row skips only the container branch and continues to the host checkout gate.
- The container branch is exactly `provider === "container"` and is independent of environment and run status.
- `worktree`, `vm`, `remote`, and unknown provider values continue to the host checkout gate.
- Host availability is decided at request time from a non-null path, directory existence, successful `realpath`, and a git-work-tree check.
- Live git is the source of truth; do not derive the list from `workflow_events`.
- The exposed status set is exactly `M`, `A`, and `D`.
- Locked projections are untracked to `A`, rename to old-path `D` plus new-path `A`, copy to new-path `A`, and type-change or unmerged to `M`.
- No stage, unstage, edit, discard, commit, or other write control is present.
- Git data is fetched only while the Source Control body is mounted and only after the user selects the tab.
- The existing three-second run-detail status poll must never invalidate or refetch the git query.
- Pino events use `domain.action_state`, pair started with completed or failed, and never log checkout paths, remotes, file contents, or error messages that can contain a path.
- User copy is terse and non-alarming; do not introduce `Error:`, `unsupported`, or `⚠️`.
- Do not add a table, process, environment variable, deployable, package, or dependency.
- `mock.module()` merges over the real module in Bun 1.3.11, so every existing `@archon/git` mock factory must stub the new exports and every server isolation-environment mock must stub the newly called existing export.
- Server test files with distinct `mock.module()` graphs must run in separate Bun processes through `packages/server/package.json`.
- The mounted web query test must also run in its own Bun process so its happy-dom globals cannot pollute the existing component suite.
- Every production behavior follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Every full Markdown sentence in this plan stays on one physical line.

## Scope Reconciliation for the Story 1.1 Containment Bullet

Story 1.1 accepts no file-reference parameter and does not read file contents.
Therefore this story proves confinement by resolving the root from `runId`, canonicalizing that trusted database path, and ignoring a hostile `working_path` query parameter.
It also proves that valid colon, leading-dash, glob, space, and newline filenames survive the NUL-delimited git list.
A candidate-file symlink escape, encoded `..` file reference, invalid OID, and unreachable OID first become executable behaviors in Story 1.2's file/diff routes.
Do not create an unused `git-path.ts` or tests for a helper with no Story 1.1 caller; the implementation-readiness report explicitly assigns `changedFiles` to Story 1.1 and `fileDiff`/`fileAt` to Story 1.2.

## File Structure

- Create `packages/git/src/changed-files.ts` for porcelain parsing, status projection, checkout probing, live changed-file reads, and revision fingerprints.
- Create `packages/git/src/changed-files.test.ts` for literal parser cases plus a real temporary git repository.
- Modify `packages/git/src/index.ts` to publish only the Story 1.1 git functions and types.
- Modify the 30 existing `mock.module('@archon/git')` factories listed in Task 1 to stub both new functions.
- Create `packages/server/src/routes/git/checkout-gate.ts` for the reusable AD-6 run-checkout gate.
- Create `packages/server/src/routes/git/checkout-gate.test.ts` for container, fallback, missing-path, realpath, and provider cases.
- Create `packages/server/src/routes/schemas/git.schemas.ts` for the route's generated OpenAPI contract.
- Create `packages/server/src/routes/git/changes-route.ts` for the `createRoute` definition.
- Create `packages/server/src/routes/git/changes-handler.ts` for run lookup, gate delegation, serialization, and safe logging.
- Create `packages/server/src/routes/api.git-changes.test.ts` for the isolated HTTP contract.
- Modify `packages/server/src/routes/api.ts` only to import and register the route.
- Modify `packages/server/package.json` to isolate the two new server test files.
- Modify the 12 server isolation-environment mock factories listed in Task 3 to stub `getById`.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from the running server.
- Modify `packages/web/src/lib/api.ts` to export generated response types and the client function.
- Create `packages/web/src/lib/api.git-changes.test.ts` for URL encoding and the runId-only request boundary.
- Create `packages/web/src/components/workflows/source-control/source-control-state.ts` for frozen/pending snapshot state.
- Create `packages/web/src/components/workflows/source-control/source-control-state.test.ts` for initial, unchanged, divergent, CAP-6, and accept-pending transitions.
- Create `packages/web/src/components/workflows/source-control/changed-file-row.tsx` for one accessible file row.
- Create `packages/web/src/components/workflows/source-control/source-control-panel.tsx` for loading, empty, error, stale, list, and keyboard presentation.
- Create `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx` for rendered copy, semantics, read-only chrome, and keyboard-index behavior.
- Create `packages/web/src/components/workflows/source-control/source-control-tab.tsx` for TanStack Query and snapshot orchestration.
- Create `packages/web/src/component-integration/source-control-tab.test.tsx` for the mounted real-client query and two-step stale flow in an isolated process.
- Create `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx` for the legacy DAG tab strip.
- Create `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx` for Source Control placement and optional Chat.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx` to use the two focused components and to mount Source Control only while selected.
- Modify `packages/web/package.json` to isolate the mounted happy-dom test.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance and repository gate passes.

## Locked Wire Contract

```ts
type GitEmptyReason = 'container' | 'no_checkout';
type GitChangedFileStatus = 'M' | 'A' | 'D';

type GitChangedFile = {
  path: string;
  status: GitChangedFileStatus;
};

type GitChangesResponse =
  | {
      emptyReason?: never;
      files: GitChangedFile[];
      revision: string;
    }
  | {
      emptyReason: GitEmptyReason;
      files: [];
      revision: '';
    };
```

A populated or clean live-checkout response has a 64-character lowercase hexadecimal SHA-256 revision of the list projection.
The revision input is `headSha + NUL + the exact porcelain stdout string returned by execFileAsync`; an unborn repository uses an empty `headSha`.
A CAP-6 response always has `files: []` and `revision: ""`.
A missing run is HTTP 404 with `{ error: "Workflow run not found" }`.
A post-gate git failure is HTTP 500 with `{ error: "Could not read git changes" }`.
Unknown query parameters, including `working_path`, are ignored and never influence checkout resolution.

## Open Questions

### OQ-1 — Divergence detection without polling

The approved UX requires `Changed on disk — Reload` but intentionally forbids background polling, so divergence can first be observed only during a manual request.
**Provisional default:** the first Reload performs a network refetch; if its snapshot fingerprint differs, retain the displayed snapshot and show a clickable `Changed on disk — Reload` button.
**Provisional default:** activating that button applies the already-fetched pending snapshot without issuing another request.
**Provisional default:** a later ordinary Reload repeats the comparison.
This applies to ready, clean, and `no_checkout` snapshots so a disappearing or newly appearing checkout never silently replaces the current view.

### OQ-2 — Compound porcelain XY states

The approved material fixes the special projections but does not define one badge for every remaining two-column index/worktree combination.
**Provisional default:** after rename, copy, unmerged, and type-change handling, any deletion wins over any addition, any addition wins over ordinary modification, and all remaining changed states become `M`.
This makes `AD` display `D`, `DA` display `D`, and ordinary `MM` display `M`.

### OQ-3 — Sequential non-DAG runs

The existing legacy tab strip exists only when `isDag` is true, while the approved wording calls Source Control the fourth tab beside Graph, Logs, and Chat.
**Provisional default:** add Source Control to that existing DAG tab strip only and do not invent a new tab model for sequential runs in Story 1.1.
A product decision to expose Source Control on sequential runs should be a follow-up because it changes the legacy screen's information architecture beyond the approved fourth-tab slice.

### OQ-4 — Keyboard bindings

The approved accessibility floor requires keyboard operation but leaves exact keys open.
**Provisional default:** the listbox keeps DOM focus and uses `aria-activedescendant`; ArrowUp and ArrowDown move one row, Home and End jump to the boundary, and Enter and Space are consumed without opening anything because Story 1.1 has no viewer.

---

### Task 1: Add the public `changedFiles` git read

**Files:**
- Create: `packages/git/src/changed-files.ts`
- Create: `packages/git/src/changed-files.test.ts`
- Modify: `packages/git/src/index.ts`
- Modify: the 30 exact mock-factory files in Step 4.

**Interfaces:**
- Consumes: `execFileAsync` and the existing `RepoPath`/`WorktreePath` brands.
- Produces: `parsePorcelainV1Z(stdout: string): PorcelainEntry[]`.
- Produces: `projectChangedFiles(entries: readonly PorcelainEntry[]): ChangedFile[]`.
- Produces: `isGitWorkTree(workingPath: RepoPath | WorktreePath): Promise<boolean>`.
- Produces: `changedFiles(workingPath: RepoPath | WorktreePath): Promise<ChangedFilesResult>`.

- [ ] **Step 1: Write the failing parser and real-git tests**

Create `packages/git/src/changed-files.test.ts` with this complete content:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import {
  changedFiles,
  isGitWorkTree,
  parsePorcelainV1Z,
  projectChangedFiles,
} from './changed-files';
import { toWorktreePath } from './types';

describe('parsePorcelainV1Z and projectChangedFiles', () => {
  test('maps ordinary, untracked, deleted, type-change, and every unmerged state', () => {
    const stdout =
      [
        ' M src/a.ts',
        '?? new.ts',
        'D  gone.ts',
        'T  file.bin',
        'DD both-deleted.ts',
        'AA both-added.ts',
        'UU conflict.ts',
      ].join('\0') +
      '\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'both-added.ts', status: 'M' },
      { path: 'both-deleted.ts', status: 'M' },
      { path: 'conflict.ts', status: 'M' },
      { path: 'file.bin', status: 'M' },
      { path: 'gone.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
      { path: 'src/a.ts', status: 'M' },
    ]);
  });

  test('projects rename as old D plus new A and copy as new A', () => {
    const stdout = 'R  new-name.ts\0old-name.ts\0C  copy.ts\0source.ts\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'copy.ts', status: 'A' },
      { path: 'new-name.ts', status: 'A' },
      { path: 'old-name.ts', status: 'D' },
    ]);
  });

  test('uses the provisional deletion-before-addition precedence for compound states', () => {
    const stdout = 'AD staged-then-deleted.ts\0MM twice-modified.ts\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'staged-then-deleted.ts', status: 'D' },
      { path: 'twice-modified.ts', status: 'M' },
    ]);
  });

  test('preserves spaces and newlines because records are NUL-delimited', () => {
    const stdout = '?? path with space.ts\0?? line\nbreak.ts\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'line\nbreak.ts', status: 'A' },
      { path: 'path with space.ts', status: 'A' },
    ]);
  });

  test('fails fast on malformed porcelain records', () => {
    expect(() => parsePorcelainV1Z('??\0')).toThrow('Malformed git status output');
    expect(() => parsePorcelainV1Z('R  new.ts\0')).toThrow('Malformed git status output');
  });
});

describe('changedFiles and isGitWorkTree', () => {
  let root = '';
  let repoPath = '';
  let plainPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-changed-files-'));
    repoPath = join(root, 'repo');
    plainPath = join(root, 'plain');
    await mkdir(repoPath);
    await mkdir(plainPath);
    await execFileAsync('git', ['init', repoPath]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('lists special filenames and changes the revision when porcelain changes', async () => {
    await writeFile(join(repoPath, ':colon.ts'), 'x\n');
    await writeFile(join(repoPath, '-dash.ts'), 'x\n');
    await writeFile(join(repoPath, 'foo*.ts'), 'x\n');
    await writeFile(join(repoPath, 'line\nbreak.ts'), 'x\n');

    const first = await changedFiles(toWorktreePath(repoPath));

    expect(first.files).toEqual([
      { path: '-dash.ts', status: 'A' },
      { path: ':colon.ts', status: 'A' },
      { path: 'foo*.ts', status: 'A' },
      { path: 'line\nbreak.ts', status: 'A' },
    ]);
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(repoPath, 'z-new.ts'), 'x\n');
    const second = await changedFiles(toWorktreePath(repoPath));
    expect(second.revision).not.toBe(first.revision);
  });

  test('distinguishes a git work tree from a plain directory', async () => {
    expect(await isGitWorkTree(toWorktreePath(repoPath))).toBe(true);
    expect(await isGitWorkTree(toWorktreePath(plainPath))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/git/src/changed-files.test.ts
```

Expected: FAIL because `./changed-files` does not exist.
A parser assertion failure caused by malformed fixture syntax is not the expected RED; correct the fixture until the missing module is the cause.

- [ ] **Step 3: Implement the minimal git module**

Create `packages/git/src/changed-files.ts` with this complete content:

```ts
import { createHash } from 'crypto';

import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export type ChangedFileStatus = 'M' | 'A' | 'D';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
}

export interface PorcelainEntry {
  xy: string;
  path: string;
  origPath?: string;
}

export interface ChangedFilesResult {
  files: ChangedFile[];
  revision: string;
}

function isRenameOrCopy(xy: string): boolean {
  return xy.includes('R') || xy.includes('C');
}

const UNMERGED_STATES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function parsePorcelainV1Z(stdout: string): PorcelainEntry[] {
  const records = stdout.split('\0');
  const entries: PorcelainEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === '') continue;
    if (record === undefined || record.length < 4 || record[2] !== ' ') {
      throw new Error('Malformed git status output');
    }

    const xy = record.slice(0, 2);
    const path = record.slice(3);
    if (path.length === 0) throw new Error('Malformed git status output');

    if (isRenameOrCopy(xy)) {
      const origPath = records[index + 1];
      if (!origPath) throw new Error('Malformed git status output');
      entries.push({ xy, path, origPath });
      index += 1;
      continue;
    }

    entries.push({ xy, path });
  }

  return entries;
}

function projectStatus(xy: string): ChangedFileStatus {
  if (UNMERGED_STATES.has(xy) || xy.includes('T')) return 'M';
  if (xy.includes('D')) return 'D';
  if (xy === '??' || xy.includes('A')) return 'A';
  return 'M';
}

export function projectChangedFiles(entries: readonly PorcelainEntry[]): ChangedFile[] {
  const files: ChangedFile[] = [];

  for (const entry of entries) {
    if (entry.xy === '!!') continue;

    if (entry.xy.includes('R')) {
      if (!entry.origPath) throw new Error('Malformed git status output');
      files.push({ path: entry.origPath, status: 'D' });
      files.push({ path: entry.path, status: 'A' });
      continue;
    }

    if (entry.xy.includes('C')) {
      files.push({ path: entry.path, status: 'A' });
      continue;
    }

    files.push({ path: entry.path, status: projectStatus(entry.xy) });
  }

  return files.sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return left.status < right.status ? -1 : left.status > right.status ? 1 : 0;
  });
}

export async function isGitWorkTree(
  workingPath: RepoPath | WorktreePath
): Promise<boolean> {
  try {
    const result = await execFileAsync('git', [
      '-C',
      workingPath,
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    return result.stdout.trim() === 'true';
  } catch {
    // Intentional CAP-6 probe: missing, unreadable, and non-git paths are unavailable checkouts.
    return false;
  }
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath
): Promise<ChangedFilesResult> {
  const status = await execFileAsync('git', [
    '-C',
    workingPath,
    '--literal-pathspecs',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);

  let headSha = '';
  try {
    const head = await execFileAsync('git', ['-C', workingPath, 'rev-parse', '--verify', 'HEAD']);
    headSha = head.stdout.trim();
  } catch {
    // Intentional safe fallback: an unborn repository has status data but no HEAD commit.
  }

  return {
    files: projectChangedFiles(parsePorcelainV1Z(status.stdout)),
    revision: createHash('sha256').update(headSha).update('\0').update(status.stdout).digest('hex'),
  };
}
```

Do not catch or log the `git status` failure in this package.
The server owns request-scoped logging and the opaque user-facing error.
Do not include a path in an error event or error response.

- [ ] **Step 4: Export the module and update every merging git mock**

Add this block next to the branch exports in `packages/git/src/index.ts`:

```ts
export {
  changedFiles,
  isGitWorkTree,
  parsePorcelainV1Z,
  projectChangedFiles,
} from './changed-files';
export type {
  ChangedFile,
  ChangedFileStatus,
  ChangedFilesResult,
  PorcelainEntry,
} from './changed-files';
```

Add these exact properties to every existing `mock.module('@archon/git', () => ({ ... }))` factory:

```ts
changedFiles: mock(async () => ({ files: [], revision: '0'.repeat(64) })),
isGitWorkTree: mock(async () => false),
```

Use a plain async function only in a factory that intentionally does not use Bun's `mock`.
Update all 30 files:

1. `packages/adapters/src/community/forge/gitea/adapter.test.ts`
2. `packages/adapters/src/community/forge/gitlab/adapter.test.ts`
3. `packages/adapters/src/forge/github/adapter.test.ts`
4. `packages/adapters/src/forge/github/context.test.ts`
5. `packages/cli/src/commands/isolation.test.ts`
6. `packages/cli/src/commands/workflow-command-contract.test.ts`
7. `packages/cli/src/commands/workflow.test.ts`
8. `packages/core/src/db/workflows.test.ts`
9. `packages/core/src/operations/isolation-operations.test.ts`
10. `packages/core/src/operations/workflow-retry.test.ts`
11. `packages/core/src/orchestrator/orchestrator-agent.test.ts`
12. `packages/core/src/orchestrator/orchestrator-isolation.test.ts`
13. `packages/core/src/orchestrator/orchestrator.test.ts`
14. `packages/core/src/orchestrator/post-message-reminder.test.ts`
15. `packages/core/src/services/cleanup-service.test.ts`
16. `packages/isolation/src/pr-state.test.ts`
17. `packages/server/src/routes/api.auth.test.ts`
18. `packages/server/src/routes/api.codebases.test.ts`
19. `packages/server/src/routes/api.health.test.ts`
20. `packages/server/src/routes/api.messages.test.ts`
21. `packages/server/src/routes/api.provider-keys.test.ts`
22. `packages/server/src/routes/api.providers.test.ts`
23. `packages/server/src/routes/api.usage.test.ts`
24. `packages/server/src/routes/api.user-ai-prefs.test.ts`
25. `packages/server/src/routes/api.workflow-runs.test.ts`
26. `packages/workflows/src/executor-preamble.test.ts`
27. `packages/workflows/src/executor.test.ts`
28. `packages/workflows/src/runtime-check.test.ts`
29. `packages/workflows/src/script-node-deps.test.ts`
30. `packages/workflows/src/subrun.test.ts`

- [ ] **Step 5: Verify GREEN and package compatibility**

Run:

```bash
bun test packages/git/src/changed-files.test.ts
bun --filter @archon/git test
bun run type-check
```

Expected: all commands exit 0 with no warnings.

- [ ] **Step 6: Commit the git read**

Stage only the files named in this task, including all 30 mock files, and commit:

```bash
git add \
  packages/git/src/changed-files.ts \
  packages/git/src/changed-files.test.ts \
  packages/git/src/index.ts \
  packages/adapters/src/community/forge/gitea/adapter.test.ts \
  packages/adapters/src/community/forge/gitlab/adapter.test.ts \
  packages/adapters/src/forge/github/adapter.test.ts \
  packages/adapters/src/forge/github/context.test.ts \
  packages/cli/src/commands/isolation.test.ts \
  packages/cli/src/commands/workflow-command-contract.test.ts \
  packages/cli/src/commands/workflow.test.ts \
  packages/core/src/db/workflows.test.ts \
  packages/core/src/operations/isolation-operations.test.ts \
  packages/core/src/operations/workflow-retry.test.ts \
  packages/core/src/orchestrator/orchestrator-agent.test.ts \
  packages/core/src/orchestrator/orchestrator-isolation.test.ts \
  packages/core/src/orchestrator/orchestrator.test.ts \
  packages/core/src/orchestrator/post-message-reminder.test.ts \
  packages/core/src/services/cleanup-service.test.ts \
  packages/isolation/src/pr-state.test.ts \
  packages/server/src/routes/api.auth.test.ts \
  packages/server/src/routes/api.codebases.test.ts \
  packages/server/src/routes/api.health.test.ts \
  packages/server/src/routes/api.messages.test.ts \
  packages/server/src/routes/api.provider-keys.test.ts \
  packages/server/src/routes/api.providers.test.ts \
  packages/server/src/routes/api.usage.test.ts \
  packages/server/src/routes/api.user-ai-prefs.test.ts \
  packages/server/src/routes/api.workflow-runs.test.ts \
  packages/workflows/src/executor-preamble.test.ts \
  packages/workflows/src/executor.test.ts \
  packages/workflows/src/runtime-check.test.ts \
  packages/workflows/src/script-node-deps.test.ts \
  packages/workflows/src/subrun.test.ts
git diff --cached --name-only
git commit -m "feat(git): list live uncommitted files"
```

Confirm no file outside this task appears before committing.

---

### Task 2: Add the reusable AD-6 checkout gate

**Files:**
- Create: `packages/server/src/routes/git/checkout-gate.ts`
- Create: `packages/server/src/routes/git/checkout-gate.test.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: injected conversation lookup, environment lookup, directory probe, `realpath`, and git-work-tree probe.
- Produces: `resolveRunCheckout(input: ResolveRunCheckoutInput): Promise<CheckoutGateResult>`.

```ts
export type GitEmptyReason = 'container' | 'no_checkout';

export type CheckoutGateResult =
  | { kind: 'run_not_found' }
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'ready'; workingPath: string };
```

- [ ] **Step 1: Write the failing gate tests**

Create `packages/server/src/routes/git/checkout-gate.test.ts` with this complete content:

```ts
import { describe, expect, test } from 'bun:test';

import { resolveRunCheckout } from './checkout-gate';

type GateInput = Parameters<typeof resolveRunCheckout>[0];

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    run: { conversation_id: 'conv-1', working_path: '/checkout' },
    getConversationById: async () => ({ isolation_env_id: null }),
    getIsolationEnvById: async () => null,
    pathExists: async () => true,
    realpathFn: async path => path,
    isGitWorkTree: async () => true,
    ...overrides,
  };
}

describe('resolveRunCheckout', () => {
  test('returns run_not_found before database or filesystem work', async () => {
    let lookupCount = 0;
    const result = await resolveRunCheckout(
      input({
        run: null,
        getConversationById: async () => {
          lookupCount += 1;
          return null;
        },
      })
    );

    expect(result).toEqual({ kind: 'run_not_found' });
    expect(lookupCount).toBe(0);
  });

  test('returns container before checking a null or stale host path', async () => {
    let pathProbeCount = 0;
    const result = await resolveRunCheckout(
      input({
        run: { conversation_id: 'conv-1', working_path: null },
        getConversationById: async () => ({ isolation_env_id: 'env-1' }),
        getIsolationEnvById: async () => ({ provider: 'container' }),
        pathExists: async () => {
          pathProbeCount += 1;
          return false;
        },
      })
    );

    expect(result).toEqual({ kind: 'empty', emptyReason: 'container' });
    expect(pathProbeCount).toBe(0);
  });

  test('falls through when conversation, env id, or env row is missing', async () => {
    expect(
      await resolveRunCheckout(input({ getConversationById: async () => null }))
    ).toEqual({ kind: 'ready', workingPath: '/checkout' });

    expect(
      await resolveRunCheckout(
        input({ getConversationById: async () => ({ isolation_env_id: null }) })
      )
    ).toEqual({ kind: 'ready', workingPath: '/checkout' });

    expect(
      await resolveRunCheckout(
        input({
          getConversationById: async () => ({ isolation_env_id: 'missing' }),
          getIsolationEnvById: async () => null,
        })
      )
    ).toEqual({ kind: 'ready', workingPath: '/checkout' });
  });

  test('returns no_checkout for null, missing, unresolvable, and non-git paths', async () => {
    expect(
      await resolveRunCheckout(
        input({ run: { conversation_id: 'conv-1', working_path: null } })
      )
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });

    expect(
      await resolveRunCheckout(input({ pathExists: async () => false }))
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });

    expect(
      await resolveRunCheckout(
        input({
          realpathFn: async () => {
            throw new Error('gone');
          },
        })
      )
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });

    expect(
      await resolveRunCheckout(input({ isGitWorkTree: async () => false }))
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });
  });

  test('returns the canonical realpath to the caller', async () => {
    const result = await resolveRunCheckout(
      input({ realpathFn: async () => '/canonical/checkout' })
    );

    expect(result).toEqual({ kind: 'ready', workingPath: '/canonical/checkout' });
  });

  test('only container is CAP-6 before the host probe', async () => {
    for (const provider of ['worktree', 'vm', 'remote', 'future-provider']) {
      const result = await resolveRunCheckout(
        input({
          getConversationById: async () => ({ isolation_env_id: 'env-1' }),
          getIsolationEnvById: async () => ({ provider }),
        })
      );
      expect(result).toEqual({ kind: 'ready', workingPath: '/checkout' });
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/server/src/routes/git/checkout-gate.test.ts
```

Expected: FAIL because `./checkout-gate` does not exist.

- [ ] **Step 3: Implement the gate**

Create `packages/server/src/routes/git/checkout-gate.ts` with this complete content:

```ts
export type GitEmptyReason = 'container' | 'no_checkout';

export type CheckoutGateResult =
  | { kind: 'run_not_found' }
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'ready'; workingPath: string };

export interface ResolveRunCheckoutInput {
  run: { conversation_id: string; working_path: string | null } | null;
  getConversationById: (id: string) => Promise<{ isolation_env_id: string | null } | null>;
  getIsolationEnvById: (id: string) => Promise<{ provider: string } | null>;
  pathExists: (path: string) => Promise<boolean>;
  realpathFn: (path: string) => Promise<string>;
  isGitWorkTree: (path: string) => Promise<boolean>;
}

export async function resolveRunCheckout(
  input: ResolveRunCheckoutInput
): Promise<CheckoutGateResult> {
  if (!input.run) return { kind: 'run_not_found' };

  const conversation = await input.getConversationById(input.run.conversation_id);
  const envId = conversation?.isolation_env_id ?? null;
  if (envId) {
    const environment = await input.getIsolationEnvById(envId);
    if (environment?.provider === 'container') {
      return { kind: 'empty', emptyReason: 'container' };
    }
  }

  const workingPath = input.run.working_path;
  if (!workingPath) return { kind: 'empty', emptyReason: 'no_checkout' };
  if (!(await input.pathExists(workingPath))) {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  let canonicalPath: string;
  try {
    canonicalPath = await input.realpathFn(workingPath);
  } catch {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  if (!(await input.isGitWorkTree(canonicalPath))) {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  return { kind: 'ready', workingPath: canonicalPath };
}
```

In `packages/server/package.json`, insert `bun test src/routes/git/checkout-gate.test.ts` immediately after `bun test src/routes/api.workflow-runs.test.ts` in `scripts.test`.
Keep every existing test invocation and its order otherwise unchanged.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun --filter @archon/server type-check
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the gate**

```bash
git add packages/server/src/routes/git/checkout-gate.ts packages/server/src/routes/git/checkout-gate.test.ts packages/server/package.json
git commit -m "feat(server): gate run-scoped git checkouts"
```

---

### Task 3: Add `GET /api/workflows/runs/{runId}/git/changes`

**Files:**
- Create: `packages/server/src/routes/schemas/git.schemas.ts`
- Create: `packages/server/src/routes/git/changes-route.ts`
- Create: `packages/server/src/routes/git/changes-handler.ts`
- Create: `packages/server/src/routes/api.git-changes.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/package.json`
- Modify: the 12 exact isolation-environment mock factories in Step 4.

**Interfaces:**
- Consumes: `resolveRunCheckout`, `changedFiles`, `isGitWorkTree`, `workflowDb.getWorkflowRun`, `conversationDb.getConversationById`, and `isolationEnvDb.getById`.
- Produces: the locked `GitChangesResponse` HTTP contract.

- [ ] **Step 1: Write the failing isolated HTTP contract**

Create `packages/server/src/routes/api.git-changes.test.ts` with this complete content:

```ts
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { ConversationLockManager } from '@archon/core';
import type { ChangedFilesResult } from '@archon/git';
import type { WorkflowRun } from '@archon/workflows/schemas/workflow-run';

import type { WebAdapter } from '../adapters/web';
import { mockAllWorkflowModules } from '../test/workflow-mock-factories';
import { validationErrorHook } from './openapi-defaults';

const REVISION = 'a'.repeat(64);

const mockGetWorkflowRun = mock(
  async (_id: string): Promise<WorkflowRun | null> => null
);
const mockGetConversationById = mock(
  async (_id: string): Promise<{ isolation_env_id: string | null } | null> => null
);
const mockGetById = mock(
  async (_id: string): Promise<{ provider: string } | null> => null
);
const mockChangedFiles = mock(
  async (_workingPath: string): Promise<ChangedFilesResult> => ({
    files: [],
    revision: REVISION,
  })
);
const mockIsGitWorkTree = mock(async (_workingPath: string): Promise<boolean> => true);

const mockLogger = {
  fatal: mock((_object?: unknown, _message?: string): void => undefined),
  error: mock((_object?: unknown, _message?: string): void => undefined),
  warn: mock((_object?: unknown, _message?: string): void => undefined),
  info: mock((_object?: unknown, _message?: string): void => undefined),
  debug: mock((_object?: unknown, _message?: string): void => undefined),
  trace: mock((_object?: unknown, _message?: string): void => undefined),
  child: mock(function (this: unknown): unknown {
    return this;
  }),
  bindings: mock((): Record<string, string> => ({ module: 'test' })),
  isLevelEnabled: mock((_level: string): boolean => true),
  level: 'info',
};

mock.module('@archon/core/db/workflows', () => ({
  getWorkflowRun: mockGetWorkflowRun,
}));
mock.module('@archon/core/db/conversations', () => ({
  getConversationById: mockGetConversationById,
}));
mock.module('@archon/core/db/isolation-environments', () => ({
  getById: mockGetById,
}));
mock.module('@archon/git', () => ({
  changedFiles: mockChangedFiles,
  isGitWorkTree: mockIsGitWorkTree,
}));
mock.module('@archon/paths', () => ({
  createLogger: (): typeof mockLogger => mockLogger,
}));
mockAllWorkflowModules();

import { registerApiRoutes } from './api';

let checkoutDir = '';

function runRow(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflow_name: 'test',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'test',
    metadata: {},
    started_at: new Date('2026-09-06T00:00:00.000Z'),
    completed_at: null,
    last_activity_at: null,
    working_path: checkoutDir,
    user_id: null,
    parent_run_id: null,
    output_root: null,
    ...overrides,
  };
}

function makeApp(): OpenAPIHono {
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });
  const webAdapter = {
    setConversationDbId: mock((_platformId: string, _dbId: string): void => undefined),
    emitSSE: mock(async (): Promise<void> => undefined),
    emitLockEvent: mock(async (): Promise<void> => undefined),
  } as unknown as WebAdapter;
  const lockManager = {
    acquireLock: mock(async (_id: string, callback: () => Promise<void>) => {
      await callback();
      return { status: 'started' as const };
    }),
    getStats: mock(() => ({ active: 0, queued: 0 })),
  } as unknown as ConversationLockManager;
  registerApiRoutes(app, webAdapter, lockManager);
  return app;
}

beforeEach(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), 'archon-git-route-'));
  mockGetWorkflowRun.mockReset();
  mockGetConversationById.mockReset();
  mockGetById.mockReset();
  mockChangedFiles.mockReset();
  mockIsGitWorkTree.mockReset();
  mockGetWorkflowRun.mockImplementation(async (): Promise<WorkflowRun> => runRow());
  mockGetConversationById.mockImplementation(
    async (): Promise<{ isolation_env_id: null }> => ({ isolation_env_id: null })
  );
  mockGetById.mockImplementation(async (): Promise<null> => null);
  mockChangedFiles.mockImplementation(
    async (): Promise<ChangedFilesResult> => ({ files: [], revision: REVISION })
  );
  mockIsGitWorkTree.mockImplementation(async (): Promise<boolean> => true);
  mockLogger.fatal.mockClear();
  mockLogger.error.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.info.mockClear();
  mockLogger.debug.mockClear();
  mockLogger.trace.mockClear();
});

afterEach(async () => {
  await rm(checkoutDir, { recursive: true, force: true });
});

test('returns 404 for a missing run', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);
  const response = await makeApp().request(
    '/api/workflows/runs/missing/git/changes'
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
});

test('returns container CAP-6 before any git probe', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'container',
    files: [],
    revision: '',
  });
  expect(mockIsGitWorkTree).not.toHaveBeenCalled();
  expect(mockChangedFiles).not.toHaveBeenCalled();
});

test('returns no_checkout for a null working_path', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce({ ...runRow(), working_path: null });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    files: [],
    revision: '',
  });
});

test('uses the canonical database checkout and ignores a hostile working_path query', async () => {
  const canonical = await realpath(checkoutDir);
  mockChangedFiles.mockResolvedValueOnce({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/changes?working_path=%2e%2e%2fetc'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });
  expect(mockChangedFiles).toHaveBeenCalledWith(canonical);
  expect(mockLogger.info.mock.calls).toContainEqual([
    { runId: 'run-1', fileCount: 1 },
    'git.changes_completed',
  ]);
});

test('returns a ready clean-worktree envelope rather than CAP-6', async () => {
  mockChangedFiles.mockResolvedValueOnce({ files: [], revision: REVISION });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ files: [], revision: REVISION });
});

test('returns an opaque 500 and logs no path-bearing error message', async () => {
  mockChangedFiles.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret`));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read git changes' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(checkoutDir);
  expect(mockLogger.error.mock.calls.at(-1)?.[1]).toBe('git.changes_failed');
});
```

This isolated file intentionally lets Bun merge unmentioned real exports while replacing only the called database, git, and logger boundaries.
Do not add a mock for `fs/promises.realpath` or `fs/promises.stat`.

- [ ] **Step 2: Run the HTTP test and verify RED**

Run:

```bash
bun test packages/server/src/routes/api.git-changes.test.ts
```

Expected: FAIL because the route is not registered and Hono returns its default 404 rather than the asserted route response.

- [ ] **Step 3: Define the exact OpenAPI contract and handler**

Create `packages/server/src/routes/schemas/git.schemas.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const gitEmptyReasonSchema = z.enum(['container', 'no_checkout']).openapi('GitEmptyReason');
export type GitEmptyReason = z.infer<typeof gitEmptyReasonSchema>;

export const gitChangedFileStatusSchema = z
  .enum(['M', 'A', 'D'])
  .openapi('GitChangedFileStatus');

export const gitChangedFileSchema = z
  .object({
    path: z.string().min(1),
    status: gitChangedFileStatusSchema,
  })
  .openapi('GitChangedFile');
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);

const gitReadyChangesResponseSchema = z.object({
  emptyReason: z.never().optional(),
  files: z.array(gitChangedFileSchema),
  revision: revisionSchema,
});

const gitEmptyChangesResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
  files: z.array(gitChangedFileSchema).max(0),
  revision: z.literal(''),
});

export const gitChangesResponseSchema = z
  .union([gitReadyChangesResponseSchema, gitEmptyChangesResponseSchema])
  .openapi('GitChangesResponse');
export type GitChangesResponse = z.infer<typeof gitChangesResponseSchema>;
```

Create `packages/server/src/routes/git/changes-route.ts`:

```ts
import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitChangesResponseSchema } from '../schemas/git.schemas';

export const gitChangesRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/changes',
  tags: ['Workflows'],
  summary: "List a run's uncommitted git changes",
  request: {
    params: z.object({ runId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitChangesResponseSchema } },
      description: 'Live changes or a CAP-6 empty envelope',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Workflow run not found',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
```

Create `packages/server/src/routes/git/changes-handler.ts`:

```ts
import { realpath, stat } from 'fs/promises';
import type { Context } from 'hono';

import * as conversationDb from '@archon/core/db/conversations';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as workflowDb from '@archon/core/db/workflows';
import { changedFiles, isGitWorkTree, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { GitChangesResponse } from '../schemas/git.schemas';
import { resolveRunCheckout } from './checkout-gate';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function handleGitChanges(
  c: Context,
  apiError: (c: Context, status: 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.changes_started');

  try {
    const run = await workflowDb.getWorkflowRun(runId);
    const gate = await resolveRunCheckout({
      run: run
        ? { conversation_id: run.conversation_id, working_path: run.working_path }
        : null,
      getConversationById: async id => {
        const conversation = await conversationDb.getConversationById(id);
        return conversation ? { isolation_env_id: conversation.isolation_env_id } : null;
      },
      getIsolationEnvById: async id => {
        const environment = await isolationEnvDb.getById(id);
        return environment ? { provider: environment.provider } : null;
      },
      pathExists,
      realpathFn: realpath,
      isGitWorkTree: path => isGitWorkTree(toWorktreePath(path)),
    });

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.changes_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      const body: GitChangesResponse = {
        emptyReason: gate.emptyReason,
        files: [],
        revision: '',
      };
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.changes_completed');
      return c.json(body);
    }

    const result = await changedFiles(toWorktreePath(gate.workingPath));
    const body: GitChangesResponse = {
      files: result.files,
      revision: result.revision,
    };
    getLog().info({ runId, fileCount: result.files.length }, 'git.changes_completed');
    return c.json(body);
  } catch (error) {
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.changes_failed'
    );
    return apiError(c, 500, 'Could not read git changes');
  }
}
```

The branded-argument adapter around `isGitWorkTree` is required; passing that function directly to a `(path: string) => Promise<boolean>` dependency is not strict-function-type compatible.
Do not add `workingPath` or the raw error to any log object.

- [ ] **Step 4: Register the route and repair merging isolation mocks**

In `packages/server/src/routes/api.ts`, import `gitChangesRoute` and `handleGitChanges`.
Inside `registerApiRoutes`, immediately after the existing `getWorkflowRunRoute` registration, add:

```ts
registerOpenApiRoute(gitChangesRoute, async c => {
  return handleGitChanges(c, apiError);
});
```

Do not call `requireWebUser`.
Do not add a query schema for `working_path`.

Add `getById: mock(async () => null)` to every `mock.module('@archon/core/db/isolation-environments', ...)` factory in these 12 files:

1. `packages/server/src/routes/api.auth.test.ts`
2. `packages/server/src/routes/api.codebases.test.ts`
3. `packages/server/src/routes/api.conversations.test.ts`
4. `packages/server/src/routes/api.health.test.ts`
5. `packages/server/src/routes/api.messages.test.ts`
6. `packages/server/src/routes/api.provider-keys.test.ts`
7. `packages/server/src/routes/api.providers.test.ts`
8. `packages/server/src/routes/api.usage.test.ts`
9. `packages/server/src/routes/api.user-ai-prefs.test.ts`
10. `packages/server/src/routes/api.workflow-envs.test.ts`
11. `packages/server/src/routes/api.workflow-runs.test.ts`
12. `packages/server/src/routes/api.workflows.test.ts`

Convert each current empty factory to `() => ({ getById: mock(async () => null) })`.
Keep all existing keys in non-empty factories.

In `packages/server/package.json`, insert `bun test src/routes/api.git-changes.test.ts` immediately after the checkout-gate test invocation.
The relevant sequence must be:

```text
bun test src/routes/api.workflow-runs.test.ts && bun test src/routes/git/checkout-gate.test.ts && bun test src/routes/api.git-changes.test.ts && bun test src/routes/api.usage.test.ts
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun --filter @archon/server type-check
```

Expected: all commands exit 0.
The route test must prove the canonical realpath reaches `changedFiles`, the hostile query is ignored, container skips every git call, and the 500 response and logger omit the checkout path.

- [ ] **Step 6: Commit the HTTP slice**

Stage only the files named in this task and commit:

```bash
git add \
  packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/changes-route.ts \
  packages/server/src/routes/git/changes-handler.ts \
  packages/server/src/routes/api.git-changes.test.ts \
  packages/server/src/routes/api.ts \
  packages/server/package.json \
  packages/server/src/routes/api.auth.test.ts \
  packages/server/src/routes/api.codebases.test.ts \
  packages/server/src/routes/api.conversations.test.ts \
  packages/server/src/routes/api.health.test.ts \
  packages/server/src/routes/api.messages.test.ts \
  packages/server/src/routes/api.provider-keys.test.ts \
  packages/server/src/routes/api.providers.test.ts \
  packages/server/src/routes/api.usage.test.ts \
  packages/server/src/routes/api.user-ai-prefs.test.ts \
  packages/server/src/routes/api.workflow-envs.test.ts \
  packages/server/src/routes/api.workflow-runs.test.ts \
  packages/server/src/routes/api.workflows.test.ts
git diff --cached --name-only
git commit -m "feat(server): expose run git changes"
```

Confirm no file outside this task appears before committing.

---

### Task 4: Generate the web contract and add the API client

**Files:**
- Regenerate: `packages/web/src/lib/api.generated.d.ts`
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/api.git-changes.test.ts`

**Interfaces:**
- Consumes: generated `components['schemas']['GitChangesResponse']`.
- Produces: `getWorkflowRunGitChanges(runId: string): Promise<GitChangesResponse>`.

- [ ] **Step 1: Write the failing client test**

Create `packages/web/src/lib/api.git-changes.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { getWorkflowRunGitChanges } from './api';

const REVISION = 'a'.repeat(64);

function mockFetchSuccess() {
  return spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        files: [{ path: 'a.ts', status: 'M' }],
        revision: REVISION,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );
}

let fetchSpy: ReturnType<typeof mockFetchSuccess> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe('getWorkflowRunGitChanges', () => {
  test('GETs the encoded run-scoped URL without a checkout path', async () => {
    fetchSpy = mockFetchSuccess();

    const response = await getWorkflowRunGitChanges('run/one');

    expect(response).toEqual({
      files: [{ path: 'a.ts', status: 'M' }],
      revision: REVISION,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('working_path');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/lib/api.git-changes.test.ts
```

Expected: FAIL because `getWorkflowRunGitChanges` is not exported.

- [ ] **Step 3: Regenerate OpenAPI types from the implemented server**

In one terminal, start the server:

```bash
bun run dev:server
```

After the server reports that port 3090 is listening, run this in a second terminal:

```bash
bun --filter @archon/web generate:types
```

Stop only the server process started for this task.
Do not hand-edit `packages/web/src/lib/api.generated.d.ts`.
Verify generation produced the route and component:

```bash
rg -n '"/api/workflows/runs/\\{runId\\}/git/changes"|GitChangesResponse' packages/web/src/lib/api.generated.d.ts
```

Expected: both the path and schema name are present.

- [ ] **Step 4: Add the generated-type re-exports and client**

Immediately after `getWorkflowRun` in `packages/web/src/lib/api.ts`, add:

```ts
export type GitChangesResponse = components['schemas']['GitChangesResponse'];
export type GitChangedFile = components['schemas']['GitChangedFile'];
export type GitEmptyReason = components['schemas']['GitEmptyReason'];

export async function getWorkflowRunGitChanges(runId: string): Promise<GitChangesResponse> {
  return fetchJSON(`/api/workflows/runs/${encodeURIComponent(runId)}/git/changes`);
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/web/src/lib/api.git-changes.test.ts
bun --filter @archon/web type-check
```

Expected: both commands exit 0 and the fetch spy is restored after the test.

- [ ] **Step 6: Commit the generated contract and client**

```bash
git add packages/web/src/lib/api.generated.d.ts packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts
git commit -m "feat(web): add run git changes client"
```

---

### Task 5: Add frozen snapshot state

**Files:**
- Create: `packages/web/src/components/workflows/source-control/source-control-state.ts`
- Create: `packages/web/src/components/workflows/source-control/source-control-state.test.ts`

**Interfaces:**
- Consumes: generated `GitChangesResponse`.
- Produces: `toSourceControlSnapshot`, `sourceControlSnapshotReducer`, `INITIAL_SOURCE_CONTROL_STATE`, and the state/action types used by Task 7.

- [ ] **Step 1: Write the failing state tests**

Create `packages/web/src/components/workflows/source-control/source-control-state.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import {
  INITIAL_SOURCE_CONTROL_STATE,
  sourceControlSnapshotReducer,
  toSourceControlSnapshot,
} from './source-control-state';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

describe('sourceControlSnapshotReducer', () => {
  test('displays the first successful snapshot', () => {
    const snapshot = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const state = sourceControlSnapshotReducer(INITIAL_SOURCE_CONTROL_STATE, {
      type: 'received',
      snapshot,
    });

    expect(state).toEqual({ displayed: snapshot, pending: null });
  });

  test('clears pending state when a refetch matches the displayed revision', () => {
    const displayed = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const pending = toSourceControlSnapshot({
      files: [{ path: 'new.ts', status: 'A' }],
      revision: REVISION_B,
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending },
      { type: 'received', snapshot: displayed }
    );

    expect(state).toEqual({ displayed, pending: null });
  });

  test('freezes the displayed list and stores a divergent ready snapshot as pending', () => {
    const displayed = toSourceControlSnapshot({
      files: [{ path: 'old.ts', status: 'M' }],
      revision: REVISION_A,
    });
    const next = toSourceControlSnapshot({
      files: [{ path: 'new.ts', status: 'A' }],
      revision: REVISION_B,
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: next }
    );

    expect(state).toEqual({ displayed, pending: next });
  });

  test('treats a ready-to-no_checkout transition as divergence', () => {
    const displayed = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const next = toSourceControlSnapshot({
      emptyReason: 'no_checkout',
      files: [],
      revision: '',
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: next }
    );

    expect(state).toEqual({ displayed, pending: next });
  });

  test('applies the pending snapshot only after explicit acceptance', () => {
    const displayed = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const pending = toSourceControlSnapshot({
      emptyReason: 'no_checkout',
      files: [],
      revision: '',
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending },
      { type: 'accept_pending' }
    );

    expect(state).toEqual({ displayed: pending, pending: null });
  });
});
```

- [ ] **Step 2: Run the state test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-state.test.ts
```

Expected: FAIL because `./source-control-state` does not exist.

- [ ] **Step 3: Implement the minimal reducer**

Create `packages/web/src/components/workflows/source-control/source-control-state.ts`:

```ts
import type {
  GitChangedFile,
  GitChangesResponse,
  GitEmptyReason,
} from '@/lib/api';

export type SourceControlSnapshot =
  | {
      emptyReason?: never;
      files: readonly GitChangedFile[];
      revision: string;
    }
  | {
      emptyReason: GitEmptyReason;
      files: readonly [];
      revision: '';
    };

export interface SourceControlSnapshotState {
  displayed: SourceControlSnapshot | null;
  pending: SourceControlSnapshot | null;
}

export type SourceControlSnapshotAction =
  | { type: 'received'; snapshot: SourceControlSnapshot }
  | { type: 'accept_pending' }
  | { type: 'reset' };

export const INITIAL_SOURCE_CONTROL_STATE: SourceControlSnapshotState = {
  displayed: null,
  pending: null,
};

export function toSourceControlSnapshot(
  response: GitChangesResponse
): SourceControlSnapshot {
  if (response.emptyReason !== undefined) {
    return {
      emptyReason: response.emptyReason,
      files: [],
      revision: '',
    };
  }

  return {
    files: response.files,
    revision: response.revision,
  };
}

function fingerprint(snapshot: SourceControlSnapshot): string {
  return snapshot.emptyReason === undefined
    ? `ready:${snapshot.revision}`
    : `empty:${snapshot.emptyReason}`;
}

export function sourceControlSnapshotReducer(
  state: SourceControlSnapshotState,
  action: SourceControlSnapshotAction
): SourceControlSnapshotState {
  if (action.type === 'reset') return INITIAL_SOURCE_CONTROL_STATE;

  if (action.type === 'accept_pending') {
    return state.pending
      ? { displayed: state.pending, pending: null }
      : state;
  }

  if (!state.displayed) {
    return { displayed: action.snapshot, pending: null };
  }

  if (fingerprint(state.displayed) === fingerprint(action.snapshot)) {
    return { displayed: state.displayed, pending: null };
  }

  return { displayed: state.displayed, pending: action.snapshot };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the snapshot state**

```bash
git add packages/web/src/components/workflows/source-control/source-control-state.ts packages/web/src/components/workflows/source-control/source-control-state.test.ts
git commit -m "feat(web): freeze source-control snapshots"
```

---

### Task 6: Add the accessible Changes panel

**Files:**
- Create: `packages/web/src/components/workflows/source-control/changed-file-row.tsx`
- Create: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Create: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`

**Interfaces:**
- Consumes: `SourceControlSnapshot`.
- Produces: `SourceControlPanel(props)` and `nextChangedFileIndex(key, currentIndex, fileCount)`.

- [ ] **Step 1: Write the failing rendered and keyboard tests**

Create `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx` with this complete content:

```tsx
import { describe, expect, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  nextChangedFileIndex,
  SourceControlPanel,
} from './source-control-panel';

type PanelProps = ComponentProps<typeof SourceControlPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}): string {
  return renderToStaticMarkup(
    <SourceControlPanel
      snapshot={null}
      loadState="idle"
      stale={false}
      onReload={(): void => undefined}
      onAcceptPending={(): void => undefined}
      {...overrides}
    />
  );
}

describe('SourceControlPanel', () => {
  test('renders M/A/D as letter-carried options and no write or History chrome', () => {
    const html = renderPanel({
      snapshot: {
        files: [
          { path: 'src/a.ts', status: 'M' },
          { path: 'new.ts', status: 'A' },
          { path: 'gone.ts', status: 'D' },
        ],
        revision: 'a'.repeat(64),
      },
    });

    expect(html).toContain('Changes');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-activedescendant="sc-file-0"');
    expect(html).toContain('>M<');
    expect(html).toContain('>A<');
    expect(html).toContain('>D<');
    expect(html).not.toContain('History');
    expect(html).not.toContain('Stage');
    expect(html).not.toContain('Discard');
    expect(html).not.toContain('Commit');
  });

  test('shows explicit loading without flashing the clean-worktree copy', () => {
    const html = renderPanel({ snapshot: null, loadState: 'loading' });
    expect(html).toContain('Loading changes');
    expect(html).not.toContain('No uncommitted changes');
  });

  test('shows the clean-worktree region message only after a ready snapshot', () => {
    const html = renderPanel({
      snapshot: { files: [], revision: 'a'.repeat(64) },
    });
    expect(html).toContain('No uncommitted changes');
    expect(html).not.toContain('No worktree available');
  });

  test('shows container copy with no Reload control', () => {
    const html = renderPanel({
      snapshot: { emptyReason: 'container', files: [], revision: '' },
    });
    expect(html).toContain('No files to show');
    expect(html).toContain(
      'This run executed inside a container — its working files aren&#x27;t on the host to read.'
    );
    expect(html).not.toContain('>Reload<');
  });

  test('shows no_checkout copy with Reload', () => {
    const html = renderPanel({
      snapshot: { emptyReason: 'no_checkout', files: [], revision: '' },
    });
    expect(html).toContain('No worktree available');
    expect(html).toContain(
      'This run&#x27;s checkout isn&#x27;t available or readable right now — it may not be ready yet, or it may have been cleaned up.'
    );
    expect(html).toContain('>Reload<');
  });

  test('keeps a previous list during an in-region refresh error', () => {
    const html = renderPanel({
      snapshot: {
        files: [{ path: 'keep.ts', status: 'M' }],
        revision: 'a'.repeat(64),
      },
      loadState: 'error',
    });
    expect(html).toContain('keep.ts');
    expect(html).toContain('Could not refresh changes.');
    expect(html).toContain('>Reload<');
    expect(html).not.toContain('Error:');
    expect(html).not.toContain('unsupported');
    expect(html).not.toContain('⚠️');
  });

  test('renders divergence as a clickable quiet reload affordance', () => {
    const html = renderPanel({
      snapshot: { files: [], revision: 'a'.repeat(64) },
      stale: true,
    });
    expect(html).toContain('>Changed on disk — Reload<');
  });

  test('moves the active descendant with Arrow, Home, and End keys', () => {
    expect(nextChangedFileIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextChangedFileIndex('ArrowDown', 2, 3)).toBe(2);
    expect(nextChangedFileIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextChangedFileIndex('Home', 2, 3)).toBe(0);
    expect(nextChangedFileIndex('End', 0, 3)).toBe(2);
    expect(nextChangedFileIndex('Enter', 1, 3)).toBe(1);
  });
});
```

Import and exercise the real `SourceControlPanel` and `nextChangedFileIndex`; do not read source text.

- [ ] **Step 2: Run the panel test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
```

Expected: FAIL because the panel module does not exist.

- [ ] **Step 3: Implement the row**

Create `packages/web/src/components/workflows/source-control/changed-file-row.tsx`:

```tsx
import type { ReactElement } from 'react';

import type { GitChangedFile } from '@/lib/api';

export function ChangedFileRow(props: {
  file: GitChangedFile;
  id: string;
  active: boolean;
}): ReactElement {
  const statusLabel =
    props.file.status === 'M'
      ? 'M, modified'
      : props.file.status === 'A'
        ? 'A, added'
        : 'D, deleted';

  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.active}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
        props.active ? 'bg-surface-elevated' : 'hover:bg-surface-hover'
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-text-primary">
        {props.file.path}
      </span>
      <span
        aria-label={statusLabel}
        className="shrink-0 rounded bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium text-text-primary"
      >
        {props.file.status}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Implement the panel**

Create `packages/web/src/components/workflows/source-control/source-control-panel.tsx`:

```tsx
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';

import { ChangedFileRow } from './changed-file-row';
import type { SourceControlSnapshot } from './source-control-state';

export type SourceControlLoadState = 'idle' | 'loading' | 'error';

export interface SourceControlPanelProps {
  snapshot: SourceControlSnapshot | null;
  loadState: SourceControlLoadState;
  stale: boolean;
  onReload: () => void;
  onAcceptPending: () => void;
}

export function nextChangedFileIndex(
  key: string,
  currentIndex: number,
  fileCount: number
): number {
  if (fileCount <= 0) return 0;
  if (key === 'ArrowDown') return Math.min(fileCount - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return fileCount - 1;
  return Math.min(fileCount - 1, Math.max(0, currentIndex));
}

export function SourceControlPanel(props: SourceControlPanelProps): ReactElement {
  const files = props.snapshot?.files ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex =
    files.length === 0 ? 0 : Math.min(files.length - 1, activeIndex);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  if (props.snapshot?.emptyReason === 'container') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No files to show</h2>
        <p className="text-sm">
          This run executed inside a container — its working files aren't on the host to read.
        </p>
      </div>
    );
  }

  if (props.snapshot?.emptyReason === 'no_checkout') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No worktree available</h2>
        <p className="text-sm">
          This run's checkout isn't available or readable right now — it may not be ready yet, or it may have been cleaned up.
        </p>
        {props.loadState === 'error' ? <p className="text-xs">Could not refresh changes.</p> : null}
        <button
          type="button"
          onClick={props.stale ? props.onAcceptPending : props.onReload}
          className="text-xs text-primary transition-colors hover:text-accent-bright"
        >
          {props.stale ? 'Changed on disk — Reload' : 'Reload'}
        </button>
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
    }
    setActiveIndex(nextChangedFileIndex(event.key, clampedActiveIndex, files.length));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
        <h2 className="text-sm font-medium text-text-primary">Changes</h2>
        <button
          type="button"
          onClick={props.onReload}
          className="text-xs text-primary transition-colors hover:text-accent-bright"
        >
          Reload
        </button>
      </div>

      {props.stale ? (
        <button
          type="button"
          onClick={props.onAcceptPending}
          className="mx-4 mt-2 self-start text-xs text-text-secondary hover:text-text-primary"
        >
          Changed on disk — Reload
        </button>
      ) : null}

      {props.loadState === 'loading' ? (
        <p role="status" className="px-4 py-3 text-sm text-text-secondary">
          {props.snapshot ? 'Refreshing changes' : 'Loading changes'}
        </p>
      ) : null}

      {props.loadState === 'error' ? (
        <p role="status" className="px-4 py-2 text-xs text-text-secondary">
          Could not refresh changes.
        </p>
      ) : null}

      {props.snapshot && files.length === 0 ? (
        <p role="status" className="px-4 py-3 text-sm text-text-secondary">
          No uncommitted changes
        </p>
      ) : null}

      {files.length > 0 ? (
        <div
          role="listbox"
          aria-label="Uncommitted changes"
          aria-activedescendant={`sc-file-${String(clampedActiveIndex)}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-auto p-2"
        >
          {files.map((file, index) => (
            <ChangedFileRow
              key={`${file.status}:${file.path}`}
              id={`sc-file-${String(index)}`}
              file={file}
              active={index === clampedActiveIndex}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
bun --filter @archon/web type-check
```

Expected: both commands exit 0.
The test must exercise behavior or rendered semantics, not source text.

- [ ] **Step 6: Commit the panel**

```bash
git add packages/web/src/components/workflows/source-control/changed-file-row.tsx packages/web/src/components/workflows/source-control/source-control-panel.tsx packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
git commit -m "feat(web): render accessible source-control changes"
```

---

### Task 7: Add the fetch-on-mount Source Control body

**Files:**
- Create: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- Create: `packages/web/src/component-integration/source-control-tab.test.tsx`
- Modify: `packages/web/package.json`

**Interfaces:**
- Consumes: `getWorkflowRunGitChanges`, `SourceControlPanel`, and the Task 5 reducer.
- Produces: `SourceControlTab({ runId }: { runId: string })`.

- [ ] **Step 1: Write the failing mounted integration test**

Create `packages/web/src/component-integration/source-control-tab.test.tsx` with this complete content:

```tsx
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { GitChangesResponse } from '@/lib/api';

import { SourceControlTab } from '../components/workflows/source-control/source-control-tab';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function installHappyDom(): Window {
  const win = new Window({ url: 'https://localhost/' });
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    HTMLButtonElement: win.HTMLButtonElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    navigator: win.navigator,
    location: win.location,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    Event: win.Event,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, globals);
  return win;
}

function mockFetchResponses(responses: readonly GitChangesResponse[]) {
  let index = 0;
  return spyOn(globalThis, 'fetch').mockImplementation(async (): Promise<Response> => {
    const payload = responses[index];
    if (!payload) throw new Error(`Unexpected fetch number ${String(index + 1)}`);
    index += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

async function waitFor(
  predicate: () => boolean,
  description: string
): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

let win: Window;
let host: Element;
let root: Root;
let queryClient: QueryClient;
let fetchSpy: ReturnType<typeof mockFetchResponses> | undefined;

function requireButton(text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(
    candidate => candidate.textContent === text
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${text}`);
  }
  return button;
}

async function renderTab(runId: string): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SourceControlTab, { runId })
      )
    );
  });
}

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  win = installHappyDom();
  const element = win.document.createElement('div');
  win.document.body.appendChild(element);
  host = element as unknown as Element;
  root = createRoot(host);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  queryClient.clear();
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  win.close();
});

describe('SourceControlTab', () => {
  test('fetches once on mount with encoded runId and renders the response', async () => {
    fetchSpy = mockFetchResponses([
      {
        files: [{ path: 'src/live.ts', status: 'M' }],
        revision: REVISION_A,
      },
    ]);

    await renderTab('run/one');
    await waitFor(
      () => host.textContent?.includes('src/live.ts') === true,
      'the initial changed file'
    );

    expect(host.textContent).toContain('src/live.ts');
    expect(host.textContent).toContain('M');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflows/runs/run%2Fone/git/changes'
    );

    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('keeps the displayed list until the divergent snapshot is accepted', async () => {
    fetchSpy = mockFetchResponses([
      {
        files: [{ path: 'old.ts', status: 'M' }],
        revision: REVISION_A,
      },
      {
        files: [{ path: 'new.ts', status: 'A' }],
        revision: REVISION_B,
      },
    ]);

    await renderTab('run-1');
    await waitFor(
      () => host.textContent?.includes('old.ts') === true,
      'the initial snapshot'
    );

    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => host.textContent?.includes('Changed on disk — Reload') === true,
      'the divergence affordance'
    );

    expect(host.textContent).toContain('old.ts');
    expect(host.textContent).not.toContain('new.ts');

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(
      () => host.textContent?.includes('new.ts') === true,
      'the accepted snapshot'
    );

    expect(host.textContent).not.toContain('old.ts');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('updates aria-activedescendant when the focused list receives ArrowDown', async () => {
    fetchSpy = mockFetchResponses([
      {
        files: [
          { path: 'one.ts', status: 'M' },
          { path: 'two.ts', status: 'A' },
        ],
        revision: REVISION_A,
      },
    ]);

    await renderTab('run-1');
    await waitFor(
      () => host.querySelector('[role="listbox"]') !== null,
      'the changed-files listbox'
    );
    const listbox = host.querySelector('[role="listbox"]');
    if (!(listbox instanceof HTMLElement)) {
      throw new Error('Missing changed-files listbox');
    }
    expect(listbox.getAttribute('aria-activedescendant')).toBe('sc-file-0');

    await act(async () => {
      listbox.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
    });

    expect(listbox.getAttribute('aria-activedescendant')).toBe('sc-file-1');
    expect(host.querySelector('#sc-file-1')?.getAttribute('aria-selected')).toBe(
      'true'
    );
  });
});
```

Do not add `mock.module()` to this test.
The restored fetch spy is the only external boundary substitution, so the test exercises the real API client, query, reducer, panel, and keyboard handler.

- [ ] **Step 2: Run the mounted test and verify RED**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: FAIL because `source-control-tab.tsx` does not exist.

- [ ] **Step 3: Implement the query body**

Create `packages/web/src/components/workflows/source-control/source-control-tab.tsx`:

```tsx
import { useCallback, useEffect, useReducer, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getWorkflowRunGitChanges } from '@/lib/api';

import { SourceControlPanel, type SourceControlLoadState } from './source-control-panel';
import {
  INITIAL_SOURCE_CONTROL_STATE,
  sourceControlSnapshotReducer,
  toSourceControlSnapshot,
} from './source-control-state';

export function SourceControlTab({ runId }: { runId: string }): ReactElement {
  const [snapshotState, dispatch] = useReducer(
    sourceControlSnapshotReducer,
    INITIAL_SOURCE_CONTROL_STATE
  );

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['workflowRunGitChanges', runId],
    queryFn: () => getWorkflowRunGitChanges(runId),
    refetchInterval: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [runId]);

  useEffect(() => {
    if (!data) return;
    dispatch({
      type: 'received',
      snapshot: toSourceControlSnapshot(data),
    });
  }, [data]);

  const onReload = useCallback((): void => {
    void refetch();
  }, [refetch]);

  const onAcceptPending = useCallback((): void => {
    dispatch({ type: 'accept_pending' });
  }, []);

  const loadState: SourceControlLoadState = isError
    ? 'error'
    : isFetching
      ? 'loading'
      : 'idle';

  return (
    <SourceControlPanel
      snapshot={snapshotState.displayed}
      loadState={loadState}
      stale={snapshotState.pending !== null}
      onReload={onReload}
      onAcceptPending={onAcceptPending}
    />
  );
}
```

Do not add an `enabled` option here.
Fetch-on-click is achieved by mounting this component only in the selected Source Control branch in Task 8.
Do not call `invalidateQueries` for this query from the three-second workflow-run polling path.

- [ ] **Step 4: Isolate the mounted test in the package script**

In `packages/web/package.json`, add this separate invocation immediately after `bun test src/components/`:

```text
NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx
```

Do not move the file under `src/components/`, because that would make the happy-dom test run in the shared component process as well.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
bun --filter @archon/web type-check
```

Expected: both commands exit 0.
The mounted test must prove that a divergent refetch preserves the old rendered list until the user activates the stale affordance.

- [ ] **Step 6: Commit the query body**

```bash
git add packages/web/src/components/workflows/source-control/source-control-tab.tsx packages/web/src/component-integration/source-control-tab.test.tsx packages/web/package.json
git commit -m "feat(web): load frozen source-control snapshots"
```

---

### Task 8: Wire the fourth tab into the legacy DAG run screen

**Files:**
- Create: `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx`
- Create: `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`

**Interfaces:**
- Consumes: `SourceControlTab`.
- Produces: `WorkflowRunView = 'graph' | 'logs' | 'chat' | 'source-control'`.
- Produces: `DagRunTabs` with the fourth Source Control trigger.

- [ ] **Step 1: Write the failing tab-strip tests**

Create `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DagRunTabs } from './dag-run-tabs';

function render(parentPlatformId: string | null): string {
  return renderToStaticMarkup(
    <DagRunTabs
      activeView="graph"
      parentPlatformId={parentPlatformId}
      onValueChange={(): void => undefined}
    />
  );
}

describe('DagRunTabs', () => {
  test('renders Source Control after the existing Graph, Logs, and Chat tabs', () => {
    const html = render('parent-1');
    expect(html.indexOf('Graph')).toBeLessThan(html.indexOf('Logs'));
    expect(html.indexOf('Logs')).toBeLessThan(html.indexOf('Chat'));
    expect(html.indexOf('Chat')).toBeLessThan(html.indexOf('Source Control'));
  });

  test('keeps Source Control when optional Chat is absent', () => {
    const html = render(null);
    expect(html).toContain('Graph');
    expect(html).toContain('Logs');
    expect(html).not.toContain('Chat');
    expect(html).toContain('Source Control');
  });
});
```

- [ ] **Step 2: Run the tab test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx
```

Expected: FAIL because `./dag-run-tabs` does not exist.

- [ ] **Step 3: Implement the focused tab strip**

Create `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx`:

```tsx
import { MessageSquare } from 'lucide-react';
import type { ReactElement } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type WorkflowRunView = 'graph' | 'logs' | 'chat' | 'source-control';

export interface DagRunTabsProps {
  activeView: WorkflowRunView;
  parentPlatformId: string | null;
  onValueChange: (view: WorkflowRunView) => void;
}

export function DagRunTabs(props: DagRunTabsProps): ReactElement {
  return (
    <Tabs
      value={props.activeView}
      onValueChange={(value): void => {
        props.onValueChange(value as WorkflowRunView);
      }}
    >
      <TabsList>
        <TabsTrigger value="graph">Graph</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        {props.parentPlatformId ? (
          <TabsTrigger value="chat">
            <MessageSquare className="mr-1 h-3 w-3" />
            Chat
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="source-control">Source Control</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
```

- [ ] **Step 4: Make the small integration edit**

In `packages/web/src/components/workflows/WorkflowExecution.tsx`:

1. Remove the direct `MessageSquare`, `Tabs`, `TabsList`, and `TabsTrigger` imports.
2. Import `DagRunTabs` and `WorkflowRunView` from `./source-control/dag-run-tabs`.
3. Import `SourceControlTab` from `./source-control/source-control-tab`.
4. Change the `activeView` state annotation to `useState<WorkflowRunView>('graph')`.
5. Preserve the existing `setActiveView('graph')` reset on `runId` changes.
6. Add this branch in `renderBody` after Graph and before Chat:

```tsx
if (isDag && activeView === 'source-control') {
  return <SourceControlTab key={runId} runId={runId} />;
}
```

7. Replace only the inner existing `<Tabs>...</Tabs>` block with:

```tsx
<DagRunTabs
  activeView={activeView}
  parentPlatformId={parentPlatformId}
  onValueChange={setActiveView}
/>
```

Keep the surrounding `{isDag && (...)}` condition to apply OQ-3's provisional default.
Do not pass `workingPath` to `SourceControlTab`.
Keep `workingPath` only for the existing `ChatInterface` `cwdOverride`.
Do not add query logic, snapshot state, a viewer, or a resizable panel to `WorkflowExecution.tsx`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx
bun test packages/web/src/components/workflows/WorkflowExecution.test.tsx
bun test packages/web/src/components/workflows/source-control/
bun --filter @archon/web type-check
```

Expected: all commands exit 0.
No source-text grep test is permitted; the extracted real tab strip and mounted real query body are the behavior seams.

- [ ] **Step 6: Commit the legacy-screen integration**

```bash
git add packages/web/src/components/workflows/source-control/dag-run-tabs.tsx packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(web): add Source Control run tab"
```

---

### Task 9: Run acceptance gates and update sprint status

**Files:**
- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

**Interfaces:**
- Consumes: the complete implementation from Tasks 1 through 8.
- Produces: `epic-1: in-progress` and `1-1-see-this-runs-uncommitted-files: done` only after all gates pass.

- [ ] **Step 1: Run every focused test in its intended process**

Run:

```bash
bun test packages/git/src/changed-files.test.ts
bun test packages/server/src/routes/git/checkout-gate.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
bun test packages/web/src/components/workflows/WorkflowExecution.test.tsx
```

Expected: every command exits 0 with no test failures or React act warnings.

- [ ] **Step 2: Run affected package suites**

Run:

```bash
bun --filter @archon/git test
bun --filter @archon/server test
bun --filter @archon/web test
```

Expected: all package scripts exit 0.
The server and mounted web tests must appear as their own Bun invocations in the script output.

- [ ] **Step 3: Run the mandatory repository gate**

Run:

```bash
bun run validate
git diff --check
```

Expected: both commands exit 0.
Do not mark the story done if type-check, lint with zero warnings, format-check, install smoke, any package test, or any generated-file check fails.

- [ ] **Step 4: Confirm the acceptance matrix**

| Criterion | Automated or inspection proof |
| --- | --- |
| Fourth Source Control tab on the legacy DAG run screen | `dag-run-tabs.test.tsx` plus the `WorkflowExecution.tsx` integration |
| Console untouched | scoped diff contains no `packages/web/src/experiments/console/` file |
| Changes-only surface with no viewer or History | `source-control-panel.test.tsx` and scoped diff |
| Fetch on tab selection and no git polling | `SourceControlTab` is mounted only in the selected branch; query has `refetchInterval: false`; mounted test proves the request begins on mount |
| Exact `M`/`A`/`D` projection | parser tests and rendered badge tests |
| Untracked, rename, copy, type-change, unmerged, and compound-state behavior | `changed-files.test.ts` |
| Keyboard-operable list | `nextChangedFileIndex` tests plus listbox/active-descendant markup test |
| Clean worktree region empty | panel test and ready empty HTTP test |
| CAP-6 HTTP 200 for container and no checkout | gate and HTTP tests |
| Container has no Reload and no_checkout has Reload | panel tests |
| Missing conversation/env links fall through | gate tests |
| Git/API failure keeps prior content and stays in-region | panel test, mounted state test, and opaque HTTP 500 test |
| Manual two-step stale flow never rewrites the open list | reducer and mounted tests |
| Client sends encoded `runId` only | API client test |
| Server uses the database path and canonical realpath | hostile-query HTTP test |
| Git helper uses argv and live porcelain | real temporary-repository test and implementation inspection |
| JSON route uses OpenAPI and generated web types | server type-check, generated-file grep, and web type-check |
| Global auth only | route registration contains no `requireWebUser` |
| Pino event names and path privacy | HTTP logger assertion and handler inspection |
| Special filenames survive | real temporary-repository test |
| No unused Story 1.2 file-path helper | scoped diff contains no `git-path.ts`, `fileDiff`, or `fileAt` |
| No write chrome or empty viewer column | panel test and scoped diff |

- [ ] **Step 5: Perform a legacy-screen smoke check**

Run the application:

```bash
bun run dev
```

Open the existing legacy Workflows page, select an existing DAG run, and click Source Control.
Confirm the tab was not fetched before selection, the Changes body fills the available area without a viewer pane, Reload is manual, and the browser console has no React errors.
Stop the dev processes started for this check.
If no DAG run exists in the local database, record that the automated tab, query, API, and package suites are the acceptance evidence; do not fabricate a run or broaden this story.

- [ ] **Step 6: Update sprint status only after Steps 1 through 5 pass**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

```yaml
development_status:
  epic-1: in-progress
  1-1-see-this-runs-uncommitted-files: done
```

Keep Stories 1.2 and 1.3 at `backlog`.
Keep `last_updated: 2026-09-06`, which is already the plan and implementation date.

- [ ] **Step 7: Commit the tracker update**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark uncommitted-files story done"
```

## Out of Scope

- Story 1.2 file opening, file-reference input, live candidate-path containment, hunk JSON, `fileDiff`, `fileAt`, and the shared viewer.
- Story 1.3 large-text and binary thresholds.
- Epic 2 History, commit log, per-commit files, and lane graph.
- CAP-8 durable snapshot writing.
- Container overlay reads.
- Secret redaction.
- A new tab model for sequential non-DAG runs under OQ-3's provisional default.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and use `.github/pull_request_template.md`.
Keep Problem and outcome, Review guidance, Solution, and Validation.
Include focused RED/GREEN evidence, the full validation result, the manual smoke result or its explicit no-local-run limitation, and `Closes #75`.
Do not write `N/A` sections and do not close the issue outside the PR workflow.
