# Open a Commit's Files in the Same Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator select a commit on the legacy Source Control History graph, expand that commit's `M` / `A` / `D` files inline, and open them in the existing shared viewer as `parent → commit`.

**Architecture:** `@archon/git` extends the existing `changedFiles`, `fileDiff`, and `fileAt` read paths with a full commit object name that must be a commit reachable from the run checkout's `HEAD`.
The server reuses `loadRunCheckout` and the CAP-6 gate, and it accepts a lowercase full object name on the existing JSON changes/diff routes plus the raw file wildcard without accepting a checkout path from the client.
The web keeps Changes pinned at the top, expands one commit inline in History with the same `ChangedFilesList` widget, and loads the already-mounted `FileViewer` with `scope: "commit"` and `ref` equal to that object name.

**Tech Stack:** Bun 1.3, strict TypeScript, Node `execFile` through `@archon/git`, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, installed `@tanstack/react-virtual` 3, installed `react-diff-view` 3.3.3, and Bun tests.
Do not add a dependency.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md`, Story 2.2.

**Approved brainstorm record:** `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-08-31/.memlog.md`, especially the locked inline-expand, shared-viewer, Changes-pinned, and no-Back decisions.

**Canonical design:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-2, CAP-3, CAP-4, CAP-5, CAP-6; `_bmad-output/specs/spec-archon-source-control/viewer-rules.md`; `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1 through AD-7 and AD-9; `_bmad-output/planning-artifacts/prds/prd-source-control/addendum.md`; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-08-31/DESIGN.md` `commit-graph-row.expand`; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-08-31/EXPERIENCE.md` Inspect a commit / Return to Now.

**Issue:** [#79](https://github.com/anhle128/Archon/issues/79), tracker key `2-2-open-a-commits-files-in-the-same-viewer`.

**Depends on:** Stories 1.1–1.3 and 2.1 are `done` in `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.

---

## Global Constraints

- Story 2.2 reuses the Story 1.2/1.3 viewer and the Story 2.1 lane graph.
- Do not add a second viewer, a second diff library, Shiki, Monaco, or any new dependency.
- The surface remains `/legacy/workflows/runs/:id`.
- No file under `packages/web/src/experiments/console/` may be imported or modified.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- The client sends only `runId`, server-issued git-relative paths, and server-issued full commit object names from `/git/log`.
- The server must independently reject a full object name that is malformed, is not a commit, or is not reachable from the run checkout's current `HEAD`; existence in the shared object store is insufficient.
- Never send `working_path`, an absolute path, `HEAD`, `live`, a short SHA, a branch name, or `oid:path`.
- The server loads existing `workflow_runs.working_path`.
- Do not add a database column and do not reconstruct the checkout from isolation metadata.
- Every git invocation uses an argv array through `execFileAsync` or `streamGitStdout`.
- Never use `exec`, a shell string, or `oid:path` syntax.
- Tree-shaped reads stay `git --literal-pathspecs ls-tree -z TREE -- PATH` then `git cat-file blob BLOB_OID`.
- `fileAt` already accepts `{ kind: 'tree', treeIsh }` for any colon-free tree-ish; Story 2.2 must not add a new `fileAt` overload.
- Commit file lists use `git diff-tree` name-status, not `git status`, not `git show`, and not `workflow_events`.
- Merge commits compare the first parent to the commit.
- Root commits use `diff-tree --root`.
- Do not hard-code the SHA-1 empty tree.
- Do not extend `execFileAsync` with stdin for this story.
- Path validation still rejects empty, NUL, POSIX absolute, Windows drive or UNC, encoded `..`, and `.git` as the first segment.
- Filenames containing a colon, a leading dash, spaces, newlines, or glob metacharacters must still work.
- JSON routes use `registerOpenApiRoute(createRoute(...), handler)`.
- The raw file route stays `app.get` because OpenAPI 3.0 cannot represent the wildcard path.
- JSON web types come from regenerated `packages/web/src/lib/api.generated.d.ts`.
- `GitFileSource` remains hand-typed because the raw wildcard route is absent from OpenAPI.
- Auth remains the global `/api/*` gate with no `requireWebUser` and no per-run owner ACL.
- Every git route still returns HTTP 200 with `{ emptyReason: "container" | "no_checkout" }` for CAP-6, including commit-scoped reads.
- There is no "history is immutable" exemption for containers.
- Now diffs stay `scope: "now"` and `ref: "live"`.
- Commit diffs use `scope: "commit"` and `ref` equal to the full lowercase object name, never `"live"`.
- `A` / `D` still use the raw content route, not the hunk endpoint.
- Commit `A` reads the commit tree.
- Commit `D` reads the first-parent tree.
- Commit `M` is diff-only except the existing Story 1.3 binary `fileFallback` path, which then reads the commit tree (the after side).
- Hunk `cursor` stays opaque.
- Story 1.3 first-paint, Load more, Cancel, inline image, hex peek, and download-only thresholds stay unchanged.
- `onLoadMore` for a commit-scoped text or diff page must keep sending that commit oid, not `worktree` / `head` / Now `live`.
- Changes stays pinned at the top.
- Clicking a commit expands or collapses that commit's file list inline beneath the graph row.
- At most one commit is expanded.
- There is no Back control.
- Return-to-Now is opening a Changes row; collapsing a commit only hides that commit's inline files and does not mutate the open viewer.
- Expanding a commit must not open the viewer.
- Opening a file from either list uses the same `FileViewer`.
- Reload still refetches Changes and History together, and it also refetches the expanded commit list when one is expanded.
- The open view is never mutated until the operator accepts `Changed on disk — Reload`.
- No stage, unstage, edit, discard, or commit chrome.
- Pino events stay `domain.action_state`, pair started with completed or failed, and never log checkout paths, remotes, file contents, file paths, object names, subjects, or path-bearing error messages.
- Failure logs contain only `runId` and a stable `errorType`.
- User copy is terse and non-alarming and must not introduce `Error:`, `unsupported`, or a warning glyph.
- Empty commit files copy is `No file changes`, not `No uncommitted changes`, and not CAP-6.
- Do not add a new package-root I/O export.
- Existing `mock.module('@archon/git')` factories therefore do not need a new stub.
- Continue using the isolated `packages/server/src/routes/api.git-changes.test.ts` process for all git HTTP routes.
- Continue using the isolated `packages/web/src/component-integration/source-control-tab.test.tsx` process for mounted behavior.
- Every behavior change follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run command blocks from the repository root, and use a subshell for commands that must execute inside a package.
- Do not run `bun test` from the repository root without a path.
- Component and mounted web tests must set `NODE_ENV=development`.
- Do not mark the tracker done until focused tests, affected package suites, `bun run validate`, `git diff --check`, and the manual acceptance check all pass.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create `packages/git/src/git-oid.ts` for full-object-name parsing, `HEAD` reachability validation, and ordered parent resolution.
- Create `packages/git/src/git-oid.test.ts` for format, reachable-commit, unreachable-existing-commit, root, and ordered-parent behavior.
- Modify `packages/git/src/changed-files.ts` to parse `diff-tree` name-status and accept `{ commit }`.
- Modify `packages/git/src/changed-files.test.ts` for parser cases plus a nested real-repository describe that does not mutate the existing Now fixture.
- Modify `packages/git/src/index.ts` to export `parseNameStatusZ` beside `parsePorcelainV1Z`.
- Do not export `parseGitObjectId`, `resolveCommitParents`, `FULL_GIT_OBJECT_ID_RE`, or `GitCommitRefError` from the package root.
- Do not modify `packages/git/src/git-log.ts`; leave its local `FULL_OID_RE` in place.
- Modify `packages/git/src/file-read.ts` so `FileDiffRequest` / `FileDiffResult` accept commit scope and a full-OID `fileAt` source is reachability-checked before the tree read.
- Modify `packages/git/src/file-read.test.ts` with a nested commit-read describe that uses its own temp repo and covers diff, raw blob, binary fallback, pagination identity, special paths, and rejection of an existing but unreachable commit.
- Modify `packages/server/src/routes/git/path-input.ts` to add `isValidGitObjectId`.
- Do not modify `packages/server/src/routes/schemas/git.schemas.ts`; the optional `ref` query lives on the route objects.
- Modify `packages/server/src/routes/git/changes-route.ts` and `changes-handler.ts` for optional `ref`.
- Modify `packages/server/src/routes/git/diff-route.ts` and `diff-handler.ts` for optional `ref`.
- Modify `packages/server/src/routes/git/file-handler.ts` so `source` may be `worktree`, `head`, or a full object name.
- Modify the Source Control route comments in `packages/server/src/routes/api.ts` so they no longer describe changes/diff as Now-only.
- Modify `packages/server/src/routes/api.git-changes.test.ts` under the existing isolated mock graph.
- Widen `handleGitChanges` `apiError` status to include `400`.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from `http://localhost:3090/api/openapi.json`.
- Modify `packages/web/src/lib/api.ts` and `packages/web/src/lib/api.git-changes.test.ts`.
- Modify `packages/web/src/components/workflows/source-control/commit-graph-row.tsx` for `aria-expanded`.
- Modify `packages/web/src/components/workflows/source-control/commit-history-graph.tsx` and `commit-history-graph.test.tsx` for inline variable-height virtual rows and descendant-key isolation.
- Modify `packages/web/src/components/workflows/source-control/source-control-panel.tsx` and `source-control-panel.test.tsx`.
- Modify `packages/web/src/components/workflows/source-control/source-control-tab.tsx`.
- Modify `packages/web/src/component-integration/source-control-tab.test.tsx`.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance gate passes.
- Do not modify any `mock.module('@archon/git')` factory outside `packages/server/src/routes/api.git-changes.test.ts`.

## Locked Contracts

```ts
export const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class GitCommitRefError extends Error {
  readonly code: 'invalid_ref';
}

export function parseGitObjectId(raw: string): string;
export async function resolveCommitParents(
  workingPath: RepoPath | WorktreePath,
  oid: string
): Promise<string[]>;

export function parseNameStatusZ(stdout: string): PorcelainEntry[];

export interface ChangedFilesRequest {
  commit?: string;
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath,
  request?: ChangedFilesRequest
): Promise<ChangedFilesResult>;

export interface FileDiffRequest {
  cursor?: string;
  signal?: AbortSignal;
  commit?: string;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now' | 'commit';
  ref: 'live' | string;
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
  fileFallback: boolean;
}
```

`ChangedFilesResult` stays `{ files: ChangedFile[]; revision: string }` with `revision` a 64-character lowercase SHA-256.

For a commit list, `revision` is `sha256(oid + '\0' + name-status stdout)`.

`resolveCommitParents` first proves commit type with `rev-parse --verify --quiet OID^{commit}`, then proves reachability with `merge-base --is-ancestor OID HEAD`, and finally returns the exact parent list from `rev-list --parents -n 1`.

An existing commit object that is not an ancestor of `HEAD` is rejected with `GitCommitRefError`; this prevents a caller from browsing unrelated objects in the shared object store.

`parents` from `rev-list --parents -n 1 OID` is ordered first parent first.

A missing `commit` option keeps today's porcelain Now path byte-for-byte, including a one-argument `changedFiles(workingPath)` call.

Transport:

- Now list: `GET /api/workflows/runs/{runId}/git/changes`
- Commit list: `GET /api/workflows/runs/{runId}/git/changes?ref=FULL_OID`
- Now diff: `GET /api/workflows/runs/{runId}/git/diff?path=GIT_PATH&cursor=OPAQUE_OPTIONAL`
- Commit diff: `GET /api/workflows/runs/{runId}/git/diff?path=GIT_PATH&ref=FULL_OID&cursor=OPAQUE_OPTIONAL`
- Raw Now added: `?source=worktree`
- Raw Now deleted: `?source=head`
- Raw commit blob: `?source=FULL_OID`

Unknown query keys including `working_path` are ignored for checkout resolution.

Malformed or unreachable `ref` / commit `source` is HTTP 400 `{ error: "Invalid commit ref" }` with `errorType: "invalid_ref"`.

`source` that is not `worktree`, `head`, or a full object name stays HTTP 400 `{ error: "Invalid file source" }`.

CAP-6 remains HTTP 200 with the existing empty envelopes.

Missing run remains HTTP 404 `{ error: "Workflow run not found" }`.

Unexpected post-gate git failures remain opaque HTTP 500 `Could not read git changes` / `Could not read git diff` / `Could not read git file`.

Commit listing argv when the commit has a first parent is exactly:

```ts
[
  '-C',
  workingPath,
  '--literal-pathspecs',
  '--no-optional-locks',
  'diff-tree',
  '--no-commit-id',
  '-r',
  '--name-status',
  '-z',
  '-M',
  '-C',
  parentOid,
  commitOid,
]
```

Commit listing argv when the commit is a root is exactly:

```ts
[
  '-C',
  workingPath,
  '--literal-pathspecs',
  '--no-optional-locks',
  'diff-tree',
  '--no-commit-id',
  '--root',
  '-r',
  '--name-status',
  '-z',
  '-M',
  '-C',
  commitOid,
]
```

Commit `M` diff argv when the commit has a first parent is exactly:

```ts
[
  '--no-optional-locks',
  '--literal-pathspecs',
  'diff-tree',
  '--no-commit-id',
  '-p',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--text',
  `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
  parentOid,
  commitOid,
  '--',
  path,
]
```

Commit `M` diff argv for a root commit uses the same array except it inserts `'--root'` immediately after `'--no-commit-id'` and omits `parentOid`.

Those commit diff streams use `acceptExitCodes: [0]`.

Now `fileDiff` keeps today's `git diff HEAD -- path` with `acceptExitCodes: [0, 1]`.

Web `GitFileSource` becomes `'worktree' | 'head' | string`, with every value other than the two sentinels required to match `FULL_GIT_OBJECT_ID_RE` before fetch.

Web viewer scope:

```ts
type ViewerScope =
  | { kind: 'now' }
  | { kind: 'commit'; oid: string; parentOid: string | null };
```

## Required Implementation Order

Execute Tasks 1 through 8 in numeric order.
Do not parallelize Tasks 1 through 4 because HTTP and generated types depend on the git helpers.
Do not start Task 6 before Task 5 is green.
Do not start Task 7 before Task 6 is green.
Update sprint status only after every Task 8 gate passes.

## Open Questions

### OQ-1 — How many commits may be expanded

The approved UX locks inline expand/collapse but does not state whether several commits may remain open.
**Safe provisional default:** use a single expanded commit so only one bounded nested file list participates in the virtualized History layout at a time.

### OQ-2 — Merge parent

Story 2.2 says `parent → commit` and does not name octopus parents.
**Safe provisional default:** compare the first parent to the merge commit, and use the first-parent blob for `D` files.

### OQ-3 — Empty commit copy

Sources distinguish region empties from CAP-6 and do not give commit-empty wording.
**Safe provisional default:** render `No file changes` under the expanded row.

These provisional defaults are implementation directives and do not require the implementer to pause.

## Resolved Implementation Choices

- Reuse `GET /git/changes?ref=FULL_OID` for a commit list instead of adding another route.
- Keep the nested file list at a maximum of eight visible 28px rows plus its existing 8px top and bottom padding, and let that `ChangedFilesList` own its scroll.
- Attach `virtualizer.measureElement` to each History virtual row so expanded height is measured from the DOM rather than guessed after data arrives.
- Preserve a commit-scoped open viewer when its row is collapsed or falls out of the bounded History window; only opening a Changes file changes the viewer back to Now.

---

### Task 1: Commit object-name parsing and commit `changedFiles`

**Files:**

- Create: `packages/git/src/git-oid.ts`
- Create: `packages/git/src/git-oid.test.ts`
- Modify: `packages/git/src/changed-files.ts`
- Modify: `packages/git/src/changed-files.test.ts`
- Modify: `packages/git/src/index.ts`

**Interfaces:**

- Consumes: `execFileAsync`, `RepoPath`, `WorktreePath`, `PorcelainEntry`, `projectChangedFiles`
- Produces: `parseGitObjectId`, `resolveCommitParents`, `GitCommitRefError`, `parseNameStatusZ`, `changedFiles(path, { commit })`

- [ ] **Step 1: Write the failing object-id and name-status tests**

Create `packages/git/src/git-oid.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import { GitCommitRefError, parseGitObjectId, resolveCommitParents } from './git-oid';
import { toWorktreePath } from './types';

describe('parseGitObjectId', () => {
  test('accepts full SHA-1 and SHA-256 object names', () => {
    const sha1 = 'a'.repeat(40);
    const sha256 = 'b'.repeat(64);
    expect(parseGitObjectId(sha1)).toBe(sha1);
    expect(parseGitObjectId(sha256)).toBe(sha256);
  });

  test('rejects empty, short, uppercase, live, HEAD, and peel syntax', () => {
    for (const value of ['', 'abc', 'A'.repeat(40), 'live', 'HEAD', 'origin/dev', `${'a'.repeat(40)}:path`]) {
      expect(() => parseGitObjectId(value)).toThrow(GitCommitRefError);
    }
  });
});

describe('resolveCommitParents', () => {
  let root = '';
  let repoPath = '';
  let rootOid = '';
  let childOid = '';
  let blobOid = '';
  let unreachableOid = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-oid-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'root']);
    rootOid = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repoPath, 'loose-blob.txt'), 'not a commit\n');
    blobOid = (
      await execFileAsync('git', ['-C', repoPath, 'hash-object', '-w', 'loose-blob.txt'])
    ).stdout.trim();
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'child']);
    childOid = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    unreachableOid = (
      await execFileAsync('git', [
        '-C',
        repoPath,
        'commit-tree',
        `${childOid}^{tree}`,
        '-p',
        rootOid,
        '-m',
        'unreachable sibling',
      ])
    ).stdout.trim();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns no parents for a reachable root and the exact parent for a reachable child', async () => {
    expect(await resolveCommitParents(toWorktreePath(repoPath), rootOid)).toEqual([]);
    expect(await resolveCommitParents(toWorktreePath(repoPath), childOid)).toEqual([rootOid]);
  });

  test('rejects a missing object, a non-commit object, and an unreachable commit', async () => {
    await expect(
      resolveCommitParents(toWorktreePath(repoPath), 'a'.repeat(40))
    ).rejects.toBeInstanceOf(GitCommitRefError);
    await expect(
      resolveCommitParents(toWorktreePath(repoPath), blobOid)
    ).rejects.toBeInstanceOf(GitCommitRefError);
    await expect(
      resolveCommitParents(toWorktreePath(repoPath), unreachableOid)
    ).rejects.toBeInstanceOf(GitCommitRefError);
  });
});
```

In `packages/git/src/changed-files.test.ts`, add `parseNameStatusZ` to the existing named import from `./changed-files`.
Then add this describe next to the porcelain parser tests, keeping the existing Now tests:

```ts
describe('parseNameStatusZ and commit changedFiles', () => {
  test('maps ordinary, added, deleted, and type-change letters', () => {
    const stdout = ['M', 'src/a.ts', 'A', 'new.ts', 'D', 'gone.ts', 'T', 'file.bin'].join('\0') + '\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'file.bin', status: 'M' },
      { path: 'gone.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
      { path: 'src/a.ts', status: 'M' },
    ]);
  });

  test('projects rename as old D plus new A and copy as new A', () => {
    const stdout = 'R100\0old-name.ts\0new-name.ts\0C100\0source.ts\0copy.ts\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'copy.ts', status: 'A' },
      { path: 'new-name.ts', status: 'A' },
      { path: 'old-name.ts', status: 'D' },
    ]);
  });

  test('preserves spaces and newlines because records are NUL-delimited', () => {
    const stdout = 'A\0path with space.ts\0A\0line\nbreak.ts\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'line\nbreak.ts', status: 'A' },
      { path: 'path with space.ts', status: 'A' },
    ]);
  });

  test('fails fast on malformed name-status records', () => {
    expect(() => parseNameStatusZ('M\0')).toThrow('Malformed git name-status output');
    expect(() => parseNameStatusZ('R100\0new.ts\0')).toThrow('Malformed git name-status output');
  });
});
```

Add this nested describe after the existing `changedFiles and isGitWorkTree` describe.
Do not write into that describe's shared `repoPath`.

```ts
describe('commit changedFiles', () => {
  let root = '';
  let repoPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-commit-changed-files-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('lists a commit against its first parent including rename and special names', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'tracked.ts'), 'old\n');
    await writeFile(join(repoPath, '-dash.ts'), 'dash\n');
    await writeFile(join(repoPath, 'path with space.ts'), 'space\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'colon\n');
      await writeFile(join(repoPath, 'glob*.ts'), 'glob\n');
      await writeFile(join(repoPath, 'line\nbreak.ts'), 'newline\n');
    }
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'root']);
    const rootOid = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const rootFiles = await changedFiles(workingPath, { commit: rootOid });
    expect(rootFiles.files).toEqual(
      expect.arrayContaining([
        { path: '-dash.ts', status: 'A' },
        { path: 'path with space.ts', status: 'A' },
        { path: 'tracked.ts', status: 'A' },
        ...(process.platform === 'win32'
          ? []
          : [
              { path: ':colon.ts', status: 'A' as const },
              { path: 'glob*.ts', status: 'A' as const },
              { path: 'line\nbreak.ts', status: 'A' as const },
            ]),
      ])
    );
    expect(rootFiles.revision).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(repoPath, 'tracked.ts'), 'changed\n');
    await writeFile(join(repoPath, 'added-in-commit.ts'), 'new\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'changed colon\n');
    }
    await execFileAsync('git', ['-C', repoPath, 'rm', '-f', '--', '-dash.ts']);
    await execFileAsync('git', ['-C', repoPath, 'mv', 'path with space.ts', 'renamed space.ts']);
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'delta']);
    const delta = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const files = await changedFiles(workingPath, { commit: delta });
    expect(files.files).toEqual(
      expect.arrayContaining([
        { path: 'tracked.ts', status: 'M' },
        { path: 'added-in-commit.ts', status: 'A' },
        { path: '-dash.ts', status: 'D' },
        { path: 'path with space.ts', status: 'D' },
        { path: 'renamed space.ts', status: 'A' },
        ...(process.platform === 'win32'
          ? []
          : [{ path: ':colon.ts', status: 'M' as const }]),
      ])
    );

    const now = await changedFiles(workingPath);
    expect(now.files.some(file => file.path === 'added-in-commit.ts')).toBe(false);

    await expect(changedFiles(workingPath, { commit: 'HEAD' })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
    await expect(changedFiles(workingPath, { commit: delta.slice(0, 7) })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
  });

  test('lists a merge against the first parent only', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'base.ts'), 'base\n');
    await execFileAsync('git', ['-C', repoPath, 'add', 'base.ts']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'base']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-b', 'feature']);
    await writeFile(join(repoPath, 'feature.ts'), 'feature\n');
    await execFileAsync('git', ['-C', repoPath, 'add', 'feature.ts']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'feature']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', 'main']);
    await writeFile(join(repoPath, 'mainline.ts'), 'main\n');
    await execFileAsync('git', ['-C', repoPath, 'add', 'mainline.ts']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'mainline']);
    await execFileAsync('git', ['-C', repoPath, 'merge', '--no-ff', 'feature', '-m', 'merge']);
    const merge = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const files = await changedFiles(workingPath, { commit: merge });
    expect(files.files).toEqual([{ path: 'feature.ts', status: 'A' }]);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/git && bun test src/git-oid.test.ts src/changed-files.test.ts )
```

Expected: FAIL because `git-oid.ts` and `parseNameStatusZ` do not exist.

- [ ] **Step 3: Implement the minimal git-oid and commit listing path**

Create `packages/git/src/git-oid.ts`:

```ts
import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class GitCommitRefError extends Error {
  readonly code = 'invalid_ref' as const;

  constructor() {
    super('Invalid git commit ref');
    this.name = 'GitCommitRefError';
  }
}

export function parseGitObjectId(raw: string): string {
  if (!FULL_GIT_OBJECT_ID_RE.test(raw)) throw new GitCommitRefError();
  return raw;
}

function hasExitCode(error: unknown, code: number): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === code;
}

export async function resolveCommitParents(
  workingPath: RepoPath | WorktreePath,
  oid: string
): Promise<string[]> {
  const parsed = parseGitObjectId(oid);
  try {
    const verified = await execFileAsync('git', [
      '-C',
      workingPath,
      '--no-optional-locks',
      'rev-parse',
      '--verify',
      '--quiet',
      `${parsed}^{commit}`,
    ]);
    if (verified.stdout.trim() !== parsed) throw new Error('Malformed git commit metadata');
  } catch (error) {
    if (hasExitCode(error, 1)) throw new GitCommitRefError();
    throw error;
  }
  try {
    await execFileAsync('git', [
      '-C',
      workingPath,
      '--no-optional-locks',
      'merge-base',
      '--is-ancestor',
      parsed,
      'HEAD',
    ]);
  } catch (error) {
    if (hasExitCode(error, 1)) throw new GitCommitRefError();
    throw error;
  }

  const result = await execFileAsync('git', [
    '-C',
    workingPath,
    '--no-optional-locks',
    'rev-list',
    '--parents',
    '-n',
    '1',
    parsed,
  ]);
  const stdout = result.stdout.trim();
  const parts = stdout.split(' ').filter(Boolean);
  if (parts[0] !== parsed) throw new Error('Malformed git commit metadata');
  const parents = parts.slice(1);
  if (parents.some(parent => !FULL_GIT_OBJECT_ID_RE.test(parent) || parent.length !== parsed.length)) {
    throw new Error('Malformed git commit metadata');
  }
  return parents;
}
```

Add `parseNameStatusZ` to `packages/git/src/changed-files.ts` and extend `changedFiles`.
Keep the current porcelain body as the no-`commit` branch.

```ts
import { parseGitObjectId, resolveCommitParents } from './git-oid';

export function parseNameStatusZ(stdout: string): PorcelainEntry[] {
  const records = stdout.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < records.length; ) {
    const status = records[index] ?? '';
    if (status.length === 0) throw new Error('Malformed git name-status output');
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const origPath = records[index + 1];
      const path = records[index + 2];
      if (!origPath || !path) throw new Error('Malformed git name-status output');
      entries.push({ xy: code, path, origPath });
      index += 3;
      continue;
    }
    const path = records[index + 1];
    if (!path) throw new Error('Malformed git name-status output');
    entries.push({ xy: code === 'U' ? 'UU' : code, path });
    index += 2;
  }
  return entries;
}

export interface ChangedFilesRequest {
  commit?: string;
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath,
  request?: ChangedFilesRequest
): Promise<ChangedFilesResult> {
  if (request?.commit !== undefined) {
    const commit = parseGitObjectId(request.commit);
    const parents = await resolveCommitParents(workingPath, commit);
    const args =
      parents[0] === undefined
        ? [
            '-C',
            workingPath,
            '--literal-pathspecs',
            '--no-optional-locks',
            'diff-tree',
            '--no-commit-id',
            '--root',
            '-r',
            '--name-status',
            '-z',
            '-M',
            '-C',
            commit,
          ]
        : [
            '-C',
            workingPath,
            '--literal-pathspecs',
            '--no-optional-locks',
            'diff-tree',
            '--no-commit-id',
            '-r',
            '--name-status',
            '-z',
            '-M',
            '-C',
            parents[0],
            commit,
          ];
    const status = await execFileAsync('git', args);
    return {
      files: projectChangedFiles(parseNameStatusZ(status.stdout)),
      revision: createHash('sha256').update(commit).update('\0').update(status.stdout).digest('hex'),
    };
  }

  // existing porcelain implementation unchanged below
}
```

Do not call `resolveCommitParents` in the Now branch.
Export `parseNameStatusZ` from `packages/git/src/index.ts` next to `parsePorcelainV1Z`, and export the `ChangedFilesRequest` type beside the existing changed-file types.
Do not export git-oid symbols from the package root.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/git && bun test src/git-oid.test.ts src/changed-files.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Confirm the Now branch stayed isolated and commit**

Keep the two explicit root/non-root argv arrays in `changed-files.ts`; a one-use builder would not satisfy the Rule of Three.
Confirm the Now branch still calls the original status and `rev-parse HEAD` sequence without calling `parseGitObjectId` or `resolveCommitParents`.

```bash
git add packages/git/src/git-oid.ts packages/git/src/git-oid.test.ts packages/git/src/changed-files.ts packages/git/src/changed-files.test.ts packages/git/src/index.ts
git commit -m "$(cat <<'EOF'
feat(git): list a commit's M/A/D files from diff-tree

EOF
)"
```

---

### Task 2: Commit-scoped `fileDiff`

**Files:**

- Modify: `packages/git/src/file-read.ts`
- Modify: `packages/git/src/file-read.test.ts`

**Interfaces:**

- Consumes: `parseGitFilePath`, `inspectTree`, `resolveCommitParents`, `parseGitObjectId`, `streamGitStdout`, `HunkPageAccumulator`, `VIEWER_DIFF_CONTEXT_LINES`
- Produces: `FileDiffRequest.commit?`, `FileDiffResult.scope: 'now' | 'commit'`, `FileDiffResult.ref: 'live' | fullOid`

- [ ] **Step 1: Write the failing commit diff tests**

Append a nested describe at the end of `packages/git/src/file-read.test.ts`.
Import `VIEWER_DIFF_CONTEXT_LINES` from `./viewer-limits` for the exact argv assertion.
Do not commit inside the existing `fileAt and fileDiff` beforeAll repo.

```ts
describe('commit fileDiff', () => {
  let root = '';
  let repoPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-commit-file-diff-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await exec.execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await exec.execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'test@example.com']);
    await exec.execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Test User']);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('commit fileDiff compares first parent to the commit and never uses live or oid:path', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'tracked.ts'), 'before line\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'before colon\n');
    }
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'tracked.ts']);
    if (process.platform !== 'win32') {
      await exec.execFileAsync('git', [
        '-C',
        repoPath,
        '--literal-pathspecs',
        'add',
        '--',
        ':colon.ts',
      ]);
    }
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'parent']);
    const parent = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repoPath, 'tracked.ts'), 'after line\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'after colon\n');
    }
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'tracked.ts']);
    if (process.platform !== 'win32') {
      await exec.execFileAsync('git', [
        '-C',
        repoPath,
        '--literal-pathspecs',
        'add',
        '--',
        ':colon.ts',
      ]);
    }
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'child']);
    const child = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const result = await fileDiff(workingPath, 'tracked.ts', { commit: child });
    expect(result.scope).toBe('commit');
    expect(result.ref).toBe(child);
    expect(result.status).toBe('M');
    expect(result.fileFallback).toBe(false);
    expect(result.hunks.some(hunk => hunk.changes.some(change => change.content.includes('after line')))).toBe(
      true
    );
    if (process.platform !== 'win32') {
      const colon = await fileDiff(workingPath, ':colon.ts', { commit: child });
      expect(colon.hunks.some(hunk => hunk.changes.some(change => change.content === 'after colon'))).toBe(true);
    }

    const now = await fileDiff(workingPath, 'tracked.ts');
    expect(now.scope).toBe('now');
    expect(now.ref).toBe('live');

    const childProcess = await import('child_process');
    const spawnSpy = spyOn(childProcess, 'spawn');
    try {
      await fileDiff(workingPath, 'tracked.ts', { commit: child });
      const spawnedArgv = spawnSpy.mock.calls.map(
        call => (call[1] as string[] | undefined) ?? []
      );
      const flat = spawnedArgv.flat();
      expect(spawnedArgv.find(args => args.includes('diff-tree'))).toEqual([
        '-C',
        workingPath,
        '--no-optional-locks',
        '--literal-pathspecs',
        'diff-tree',
        '--no-commit-id',
        '-p',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--text',
        `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
        parent,
        child,
        '--',
        'tracked.ts',
      ]);
      expect(spawnedArgv.some(args => args.includes(`${child}:tracked.ts`))).toBe(false);
      expect(flat).toContain(parent);
      expect(flat).toContain(child);
      expect(flat).not.toContain('HEAD');
    } finally {
      spawnSpy.mockRestore();
    }

    await expect(fileDiff(workingPath, 'tracked.ts', { commit: 'HEAD' })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
  });

  test('commit binary M returns fileFallback against the commit tree', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'blob.bin'), Buffer.from([0, 1, 2]));
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'blob.bin']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'binary parent']);
    await writeFile(join(repoPath, 'blob.bin'), Buffer.from([0, 9, 9]));
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'blob.bin']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'binary child']);
    const child = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    const result = await fileDiff(workingPath, 'blob.bin', { commit: child });
    expect(result).toMatchObject({
      status: 'M',
      scope: 'commit',
      ref: child,
      hunks: [],
      binary: true,
      fileFallback: true,
    });
    const raw = await fileAt(workingPath, 'blob.bin', { kind: 'tree', treeIsh: child });
    expect(Buffer.from(raw.bytes)).toEqual(Buffer.from([0, 9, 9]));
  });

  test('rejects a full commit object that exists but is not reachable from HEAD', async () => {
    const workingPath = toWorktreePath(repoPath);
    const head = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    const parent = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD^'])).stdout.trim();
    const unreachable = (
      await exec.execFileAsync('git', [
        '-C',
        repoPath,
        'commit-tree',
        `${head}^{tree}`,
        '-p',
        parent,
        '-m',
        'unreachable raw source',
      ])
    ).stdout.trim();
    await expect(
      fileAt(workingPath, 'blob.bin', { kind: 'tree', treeIsh: unreachable })
    ).rejects.toMatchObject({ name: 'GitCommitRefError', code: 'invalid_ref' });
  });

  test('pages a commit diff with a cursor tied to the parent and commit blobs', async () => {
    const workingPath = toWorktreePath(repoPath);
    const original = Array.from({ length: 25_000 }, (_unused, index) => `keep-${String(index)}`);
    await writeFile(join(repoPath, 'commit-paged.ts'), original.join('\n') + '\n');
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'commit-paged.ts']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'paged parent']);
    const changed = [...original];
    for (let index = 0; index < changed.length; index += 10) {
      changed[index] = `changed-${String(index)}`;
    }
    await writeFile(join(repoPath, 'commit-paged.ts'), changed.join('\n') + '\n');
    await exec.execFileAsync('git', ['-C', repoPath, 'add', 'commit-paged.ts']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'paged child']);
    const child = (await exec.execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const first = await fileDiff(workingPath, 'commit-paged.ts', { commit: child });
    expect(first.scope).toBe('commit');
    expect(first.ref).toBe(child);
    expect(first.truncated).toBe(true);
    expect(first.cursor.length).toBeGreaterThan(0);
    const second = await fileDiff(workingPath, 'commit-paged.ts', {
      commit: child,
      cursor: first.cursor,
    });
    expect(second.scope).toBe('commit');
    expect(second.ref).toBe(child);
    expect(second.hunks[0]?.header).not.toBe(first.hunks[0]?.header);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/git && bun test src/file-read.test.ts )
```

Expected: FAIL because `FileDiffRequest` has no `commit` field or because commit diffs still return `scope: "now"`.

- [ ] **Step 3: Implement commit `fileDiff`**

In `packages/git/src/file-read.ts`, import the commit helpers and change the types:

```ts
import {
  FULL_GIT_OBJECT_ID_RE,
  parseGitObjectId,
  resolveCommitParents,
} from './git-oid';

export interface FileDiffRequest {
  cursor?: string;
  signal?: AbortSignal;
  commit?: string;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now' | 'commit';
  ref: 'live' | string;
  hunks: DiffHunk[];
  cursor: string;
  truncated: boolean;
  binary: boolean;
  fileFallback: boolean;
}
```

At the start of the public `fileAt` implementation, after `parseGitFilePath` and before `inspectFile`, validate every full object-name tree source against the run checkout's `HEAD`.
Keep the existing `HEAD` path unchanged for Now deletions.

```ts
const path = parseGitFilePath(relativePath);
if (source.kind === 'tree' && FULL_GIT_OBJECT_ID_RE.test(source.treeIsh)) {
  await resolveCommitParents(workingPath, source.treeIsh);
}
const signal = request?.signal;
const inspected = await inspectFile(workingPath, path, source);
```

Replace `rawFallbackResult` with a scope-aware helper:

```ts
function rawFallbackResult(
  path: string,
  binary: boolean,
  scope: FileDiffResult['scope'],
  ref: FileDiffResult['ref']
): FileDiffResult {
  return {
    path,
    status: 'M',
    scope,
    ref,
    hunks: [],
    cursor: '',
    truncated: false,
    binary,
    fileFallback: true,
  };
}
```

Update the Now `fileDiff` success and fallback returns to keep `scope: 'now'` and `ref: 'live'`.
When `request?.commit` is set, do not inspect the worktree.

Commit branch shape:

```ts
if (request?.commit !== undefined) {
  const commit = parseGitObjectId(request.commit);
  const parents = await resolveCommitParents(workingPath, commit);
  const after = await inspectTree(workingPath, path, commit);
  const afterClass = await classifyInspected(after, signal);
  let before: InspectedFile | undefined;
  if (parents[0] !== undefined) {
    try {
      before = await inspectTree(workingPath, path, parents[0]);
    } catch (error) {
      if (!(error instanceof GitFileError && error.code === 'not_found')) throw error;
    }
  }
  const beforeClass = before === undefined ? undefined : await classifyInspected(before, signal);
  if (needsRawFallback(afterClass) || (beforeClass !== undefined && needsRawFallback(beforeClass))) {
    return rawFallbackResult(path, afterClass.binary || (beforeClass?.binary ?? false), 'commit', commit);
  }
  const version = hashIdentity([after.contentHash, before?.contentHash ?? '']);
  const startIndex = decodeAxisCursor(request?.cursor, 'h', version);
  const pager = new HunkPageAccumulator(startIndex);
  const args =
    parents[0] === undefined
      ? [
          '--no-optional-locks',
          '--literal-pathspecs',
          'diff-tree',
          '--no-commit-id',
          '--root',
          '-p',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--text',
          `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
          commit,
          '--',
          path,
        ]
      : [
          '--no-optional-locks',
          '--literal-pathspecs',
          'diff-tree',
          '--no-commit-id',
          '-p',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--text',
          `-U${String(VIEWER_DIFF_CONTEXT_LINES)}`,
          parents[0],
          commit,
          '--',
          path,
        ];
  const stream = streamGitStdout({ workingPath, args, signal, acceptExitCodes: [0] });
  // existing pager/readStreamChunks loop, then return scope:'commit', ref:commit
}
```

Let `GitCommitRefError` propagate unchanged so the server can map it without importing the internal class.
Do not use `git diff HEAD` in the commit branch.
Do not use `HEAD:path`.
Do not change `inspectTree`; it already uses `ls-tree -z` then `cat-file blob`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/git && bun test src/file-read.test.ts src/changed-files.test.ts src/git-oid.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/git/src/file-read.ts packages/git/src/file-read.test.ts
git commit -m "$(cat <<'EOF'
feat(git): diff a commit against its first parent

EOF
)"
```

---

### Task 3: HTTP `ref` and commit file source

**Files:**

- Modify: `packages/server/src/routes/git/path-input.ts`
- Modify: `packages/server/src/routes/git/changes-route.ts`
- Modify: `packages/server/src/routes/git/changes-handler.ts`
- Modify: `packages/server/src/routes/git/diff-route.ts`
- Modify: `packages/server/src/routes/git/diff-handler.ts`
- Modify: `packages/server/src/routes/git/file-handler.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.git-changes.test.ts`

**Interfaces:**

- Consumes: `changedFiles`, `fileDiff`, `fileAt`, `loadRunCheckout`, `isValidGitFilePath`
- Produces: optional query `ref`, `source=FULL_OID` → `{ kind: 'tree', treeIsh: oid }`

- [ ] **Step 1: Write the failing HTTP tests**

In `packages/server/src/routes/api.git-changes.test.ts`, import the `ChangedFilesRequest` type from `@archon/git` and add `_request?: ChangedFilesRequest` to the `mockChangedFiles` function signature before adding the tests below.
Add these tests after the existing log tests.
Keep every existing Now/CAP-6/path test.

```ts
const COMMIT = '1'.repeat(40);

test('Now changes omit the second changedFiles argument', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes');
  expect(response.status).toBe(200);
  expect(mockChangedFiles.mock.calls[0]?.length).toBe(1);
});

test('commit changes pass the server-issued ref into changedFiles', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockChangedFiles.mockResolvedValueOnce({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });
  const response = await makeApp().request(`/api/workflows/runs/run-1/git/changes?ref=${COMMIT}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    files: [{ path: 'src/a.ts', status: 'M' }],
    revision: REVISION,
  });
  expect(mockChangedFiles).toHaveBeenCalledWith(expect.any(String), { commit: COMMIT });
});

test('rejects a non-object-name changes ref before git', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes?ref=HEAD');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(mockChangedFiles).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(mockLogger.info.mock.calls).toEqual([
    [{ runId: 'run-1' }, 'git.changes_started'],
    [{ runId: 'run-1', errorType: 'invalid_ref' }, 'git.changes_failed'],
  ]);
});

test('rejects an explicitly empty changes ref instead of treating it as Now', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/changes?ref=');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(mockChangedFiles).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
});

test('commit CAP-6 still short-circuits changes before git', async () => {
  mockGetWorkflowRun.mockResolvedValue({ ...runRow(), working_path: null });
  const response = await makeApp().request(`/api/workflows/runs/run-1/git/changes?ref=${COMMIT}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    files: [],
    revision: '',
  });
  expect(mockChangedFiles).not.toHaveBeenCalled();
});

test('maps GitCommitRefError from changedFiles to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockChangedFiles.mockRejectedValueOnce(namedError('GitCommitRefError', 'invalid_ref'));
  const response = await makeApp().request(`/api/workflows/runs/run-1/git/changes?ref=${COMMIT}`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain(COMMIT);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(COMMIT);
  expect(mockLogger.info.mock.calls.at(-1)).toEqual([
    { runId: 'run-1', errorType: 'invalid_ref' },
    'git.changes_failed',
  ]);
});

test('commit diff passes commit into fileDiff and serializes scope commit', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileDiff.mockResolvedValueOnce({
    path: 'src/a.ts',
    status: 'M',
    scope: 'commit',
    ref: COMMIT,
    hunks: [],
    cursor: '',
    truncated: false,
    binary: false,
    fileFallback: false,
  });
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref=${COMMIT}`
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ scope: 'commit', ref: COMMIT, status: 'M' });
  expect(mockFileDiff).toHaveBeenCalledWith(expect.any(String), 'src/a.ts', {
    cursor: '',
    signal: expect.anything(),
    commit: COMMIT,
  });
});

test('Now diff omits commit from fileDiff', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  await makeApp().request('/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts');
  const request = mockFileDiff.mock.calls[0]?.[2] as { commit?: string } | undefined;
  expect(request?.commit).toBeUndefined();
});

test('rejects a malformed diff ref before checkout lookup', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref=HEAD'
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  expect(expectDiffLogPair('git.diff_failed').errorType).toBe('invalid_ref');
});

test('rejects an explicitly empty diff ref instead of treating it as Now', async () => {
  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref='
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(mockFileDiff).not.toHaveBeenCalled();
  expect(mockGetWorkflowRun).not.toHaveBeenCalled();
});

test('commit CAP-6 short-circuits diff before fileDiff', async () => {
  mockGetWorkflowRun.mockResolvedValue({ ...runRow(), working_path: null });
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref=${COMMIT}`
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'no_checkout' });
  expect(mockFileDiff).not.toHaveBeenCalled();
});

test('maps GitCommitRefError from fileDiff to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileDiff.mockRejectedValueOnce(namedError('GitCommitRefError', 'invalid_ref'));
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/diff?path=src%2Fa.ts&ref=${COMMIT}`
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
});

test('maps source=full-oid to a tree fileAt read', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=${COMMIT}`
  );
  expect(response.status).toBe(200);
  expect(mockFileAt).toHaveBeenCalledWith(
    expect.any(String),
    'src/a.ts',
    { kind: 'tree', treeIsh: COMMIT },
    expect.anything()
  );
});

test('commit CAP-6 short-circuits raw file reads before fileAt', async () => {
  mockGetWorkflowRun.mockResolvedValue({ ...runRow(), working_path: null });
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=${COMMIT}`
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ emptyReason: 'no_checkout' });
  expect(mockFileAt).not.toHaveBeenCalled();
});

test('still rejects source=HEAD as an invalid file source', async () => {
  const response = await makeApp().request('/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=HEAD');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid file source' });
  expect(mockFileAt).not.toHaveBeenCalled();
});

test('maps GitFileError invalid_ref on a commit source to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileAt.mockRejectedValueOnce(namedError('GitFileError', 'invalid_ref'));
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=${COMMIT}`
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
});

test('maps GitCommitRefError on an unreachable commit source to Invalid commit ref', async () => {
  mockGetWorkflowRun.mockResolvedValue(runRow());
  mockFileAt.mockRejectedValueOnce(namedError('GitCommitRefError', 'invalid_ref'));
  const response = await makeApp().request(
    `/api/workflows/runs/run-1/git/file/src%2Fa.ts?source=${COMMIT}`
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid commit ref' });
  expect(expectFileLogPair('git.file_failed').errorType).toBe('invalid_ref');
  expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain(COMMIT);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(COMMIT);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts )
```

Expected: FAIL because `ref` is ignored and `source` still allows only `worktree|head`.

- [ ] **Step 3: Implement transport validation and handlers**

Add to `packages/server/src/routes/git/path-input.ts`:

```ts
export function isValidGitObjectId(raw: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw);
}
```

Update `changes-route.ts` request to:

```ts
request: {
  params: z.object({ runId: z.string().min(1) }),
  query: z.object({
    ref: z.string().optional(),
  }),
},
```

Add `400` with `errorSchema` and description `Invalid commit ref`.

Widen `handleGitChanges` to `apiError(c, status: 400 | 404 | 500, message: string)`.
Read `const ref = c.req.query('ref')`.
If `ref !== undefined` and `!isValidGitObjectId(ref)`, log `git.changes_failed` with `errorType: "invalid_ref"` and return 400 `Invalid commit ref` before `loadRunCheckout`.
An explicitly empty `ref=` is invalid; only an absent query parameter selects Now.
After a live gate, call Now as `changedFiles(toWorktreePath(gate.workingPath))` with one argument.
When `ref` is defined and valid, call `changedFiles(toWorktreePath(gate.workingPath), { commit: ref })`.
In the inner catch, if `error` has `name === 'GitCommitRefError'`, return 400 `Invalid commit ref` and do not log the ref.
Log that branch as `git.changes_failed` with exactly `{ runId, errorType: 'invalid_ref' }` so the started event still has one terminal pair.
Leave unexpected commit-helper failures on the opaque 500 path.

Update `diff-route.ts` query to `{ path: z.string(), cursor: z.string().optional(), ref: z.string().optional() }` and summary to mention Now or commit hunks.
Add the same 400 invalid-ref path.

In `handleGitDiff`, after path validation, if `ref !== undefined` and invalid, return 400 `Invalid commit ref`.
Pass `commit: ref` into `fileDiff`; an absent ref remains `undefined` and an explicitly empty ref has already returned 400.
Add `invalid_ref` to `ClassifiedGitReadError`, classify `GitCommitRefError` and `GitFileError` with `code === 'invalid_ref'` to it, and map it to HTTP 400 `Invalid commit ref` with the stable `invalid_ref` log payload.

In `handleGitFile`, replace the source check with:

```ts
const sourceQuery = c.req.query('source') ?? '';
let source: FileAtSource;
if (sourceQuery === 'worktree') {
  source = { kind: 'worktree' };
} else if (sourceQuery === 'head') {
  source = { kind: 'tree', treeIsh: 'HEAD' };
} else if (isValidGitObjectId(sourceQuery)) {
  source = { kind: 'tree', treeIsh: sourceQuery };
} else {
  getLog().info({ runId, errorType: 'invalid_source' }, 'git.file_failed');
  return apiError(c, 400, 'Invalid file source');
}
```

Add the same `invalid_ref` branch to `file-handler.ts` and map `GitCommitRefError` or `GitFileError` with `code === 'invalid_ref'` to HTTP 400 `Invalid commit ref`.
Do not log `sourceQuery`.

In `packages/server/src/routes/api.ts`, update only the adjacent comments to describe `/git/changes` as Now-or-commit files and `/git/diff` as Now-or-commit hunks.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/server && bun test src/routes/api.git-changes.test.ts src/routes/git/checkout-gate.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/api.ts packages/server/src/routes/git/path-input.ts packages/server/src/routes/git/changes-route.ts packages/server/src/routes/git/changes-handler.ts packages/server/src/routes/git/diff-route.ts packages/server/src/routes/git/diff-handler.ts packages/server/src/routes/git/file-handler.ts packages/server/src/routes/api.git-changes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): accept commit refs on git changes, diff, and file

EOF
)"
```

---

### Task 4: Web git clients and generated types

**Files:**

- Modify: `packages/web/src/lib/api.generated.d.ts` via generate, never by hand
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.git-changes.test.ts`

**Interfaces:**

- Consumes: generated `GitChangesResponse` / `GitDiffResponse`
- Produces: `getWorkflowRunGitChanges(runId, { ref?, signal? })`, `getWorkflowRunGitDiff(runId, path, { ref?, cursor?, signal? })`, `GitFileSource = 'worktree' | 'head' | string`

- [ ] **Step 1: Write the failing client tests**

In `packages/web/src/lib/api.git-changes.test.ts`, add:

```ts
test('getWorkflowRunGitChanges encodes ref only when it is a full object name', async () => {
  fetchSpy = mockFetchSuccess();
  await getWorkflowRunGitChanges('run/one', { ref: '1'.repeat(40) });
  expect(fetchSpy).toHaveBeenCalledWith(
    '/api/workflows/runs/run%2Fone/git/changes?ref=' + '1'.repeat(40)
  );
});

test('getWorkflowRunGitChanges omits ref for Now', async () => {
  fetchSpy = mockFetchSuccess();
  await getWorkflowRunGitChanges('run/one');
  expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes');
});

test('getWorkflowRunGitChanges rejects every supplied non-full ref before fetch', async () => {
  fetchSpy = mockFetchSuccess();
  for (const ref of ['', 'HEAD', '1'.repeat(39), 'A'.repeat(40)]) {
    await expect(getWorkflowRunGitChanges('run/one', { ref })).rejects.toThrow(
      'Invalid commit ref'
    );
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('getWorkflowRunGitDiff rejects a supplied non-full ref before fetch', async () => {
  fetchSpy = mockFetchResponse(jsonResponse(READY_DIFF));
  await expect(getWorkflowRunGitDiff('run/one', 'src/a.ts', { ref: 'HEAD' })).rejects.toThrow(
    'Invalid commit ref'
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('getWorkflowRunGitDiff appends ref and opaque cursor', async () => {
  fetchSpy = mockFetchResponse(jsonResponse(READY_DIFF));
  await getWorkflowRunGitDiff('run/one', 'src/a.ts', {
    ref: '1'.repeat(40),
    cursor: 'opaque+token',
  });
  expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
    '/api/workflows/runs/run%2Fone/git/diff?path=src%2Fa.ts&ref=' +
      '1'.repeat(40) +
      '&cursor=opaque%2Btoken'
  );
});

test('gitFileUrl accepts a full object name as source', () => {
  expect(gitFileUrl('run-1', 'a.ts', '1'.repeat(40))).toContain('source=' + '1'.repeat(40));
  expect(gitFileUrl('run-1', 'a.ts', 'worktree')).toContain('source=worktree');
  expect(() => gitFileUrl('run-1', 'a.ts', 'HEAD')).toThrow('Invalid commit ref');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
```

Expected: FAIL because the clients do not send `ref`.

- [ ] **Step 3: Regenerate OpenAPI types**

`packages/web/package.json` `generate:types` is hardcoded to `http://localhost:3090/api/openapi.json`.
Use exactly one of the following two generation flows after Task 3 is committed.
When port 3090 is free, start this worktree's server in one terminal:

```bash
PORT=3090 bun run dev:server
```

Wait until `GET http://localhost:3090/api/health` succeeds, then run this command in a second terminal:

```bash
bun --filter @archon/web generate:types
```

When port 3090 is already bound to another checkout, do not stop that process.
Start this worktree's server on a free task-specific port such as 39079 in one terminal:

```bash
PORT=39079 bun run dev:server
```

After `GET http://localhost:39079/api/health` succeeds, run the underlying generator in a second terminal:

```bash
( cd packages/web && bun x openapi-typescript http://localhost:39079/api/openapi.json -o src/lib/api.generated.d.ts )
```

Stop only the server process started for this task.
Do not hand-edit `packages/web/src/lib/api.generated.d.ts`.
Confirm `/api/workflows/runs/{runId}/git/changes` query includes `ref` and `/git/diff` query includes `ref`.

- [ ] **Step 4: Implement the clients**

In `packages/web/src/lib/api.ts`:

```ts
const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type GitFileSource = 'worktree' | 'head' | string;

function assertCommitRef(ref: string): string {
  if (!FULL_GIT_OBJECT_ID_RE.test(ref)) throw new Error('Invalid commit ref');
  return ref;
}

export async function getWorkflowRunGitChanges(
  runId: string,
  options?: { ref?: string; signal?: AbortSignal }
): Promise<GitChangesResponse> {
  const params = new URLSearchParams();
  if (options?.ref !== undefined) params.set('ref', assertCommitRef(options.ref));
  const query = params.toString();
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/changes${query ? `?${query}` : ''}`,
    options?.signal ? { signal: options.signal } : undefined
  );
}

export async function getWorkflowRunGitDiff(
  runId: string,
  path: string,
  options?: { cursor?: string; ref?: string; signal?: AbortSignal }
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path });
  if (options?.ref !== undefined) params.set('ref', assertCommitRef(options.ref));
  if (options?.cursor) params.set('cursor', options.cursor);
  return fetchJSON(
    '/api/workflows/runs/' + encodeURIComponent(runId) + '/git/diff?' + params.toString(),
    options?.signal ? { signal: options.signal } : undefined
  );
}
```

Keep `gitFileUrl` putting `source` into `URLSearchParams`.
If `source` is not `'worktree'` or `'head'`, call `assertCommitRef(source)` before building the URL.
Do not parse `cursor`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
```

Expected: PASS.

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts packages/web/src/lib/api.generated.d.ts
git commit -m "$(cat <<'EOF'
feat(web): send commit refs on source-control git clients

EOF
)"
```

---

### Task 5: Inline commit file list in History

**Files:**

- Modify: `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`
- Modify: `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`
- Modify: `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`

**Interfaces:**

- Consumes: `ChangedFilesList`, `GitChangedFile`, `GitLogCommit`, `SourceControlSnapshot`, `COMMIT_ROW_HEIGHT`
- Produces: `expandedCommit`, `commitSnapshot`, `commitLoadState`, `onToggleCommit`, `onOpenCommitFile`

- [ ] **Step 1: Write the failing graph and panel tests**

In `commit-history-graph.test.tsx`, add:

```ts
test('renders expanded commit files inline with a distinct list prefix and no Back copy', () => {
  const html = renderToStaticMarkup(
    <CommitHistoryGraph
      commits={COMMITS}
      nowMs={NOW}
      expandedOid={D}
      commitFiles={[{ path: 'src/from-commit.ts', status: 'M' }]}
      commitFilesLoadState="idle"
      onToggleCommit={(): void => undefined}
    />
  );
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-label="Commit files"');
  expect(html).toContain('src/from-commit.ts');
  expect(html).toContain('sc-commit-' + D + '-file-0');
  expect(html).toContain('>M<');
  expect(html).not.toContain('Back');
});

test('renders bounded loading and refresh-error copy inside the expanded row', () => {
  const loading = renderToStaticMarkup(
    <CommitHistoryGraph
      commits={COMMITS}
      nowMs={NOW}
      expandedOid={D}
      commitFiles={[]}
      commitFilesLoadState="loading"
    />
  );
  expect(loading).toContain('Loading files');
  expect(loading).toContain('height:132px');
  const failed = renderToStaticMarkup(
    <CommitHistoryGraph
      commits={COMMITS}
      nowMs={NOW}
      expandedOid={D}
      commitFiles={[]}
      commitFilesLoadState="error"
    />
  );
  expect(failed).toContain('Could not refresh files.');
  expect(failed).not.toContain('No file changes');
});
```

In the same graph test, add this variable-height regression case:

```ts
test('reserves expanded-row height while the nested file list remains virtualized', () => {
  const files = Array.from({ length: 200 }, (_unused, index) => ({
    path: `commit-file-${String(index)}.ts`,
    status: 'M' as const,
  }));
  const html = renderToStaticMarkup(
    <CommitHistoryGraph
      commits={COMMITS}
      nowMs={NOW}
      expandedOid={D}
      commitFiles={files}
      commitFilesLoadState="idle"
      onToggleCommit={(): void => undefined}
    />
  );
  expect(html).toContain('height:336px');
  expect(html).toContain('height:5600px');
  expect(html).not.toContain('commit-file-199.ts');
});
```

This proves that the outer virtualizer reserves the expanded height and the nested `ChangedFilesList` still mounts only its own window.

The graph test does not assert Changes copy.
That assertion lives in the panel test.

Update the `renderPanel` helper with `expandedCommit={null}`, `commitSnapshot={null}`, `commitLoadState="idle"`, `onToggleCommit={(): void => undefined}`, and `onOpenCommitFile={(): void => undefined}` defaults.
Rename the existing selected-row test override from `selectedPath` to `selectedNowPath`.

```ts
test('keeps Changes pinned while History shows an expanded commit file list', () => {
  const html = renderPanel({
    snapshot: { files: [{ path: 'now.ts', status: 'A' }], revision: 'a'.repeat(64) },
    historySnapshot: {
      commits: [
        {
          oid: '1'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'work',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    },
    expandedCommit: {
      oid: '1'.repeat(40),
      parents: [],
      authorName: 'Ada',
      authorDate: '2026-09-06T18:09:18Z',
      subject: 'work',
    },
    commitSnapshot: {
      files: [{ path: 'then.ts', status: 'M' }],
      revision: 'b'.repeat(64),
    },
    commitLoadState: 'idle',
    onToggleCommit: (): void => undefined,
  });
  expect(html).toContain('Changes');
  expect(html).toContain('now.ts');
  expect(html).toContain('then.ts');
  expect(html).toContain('History');
  expect(html).not.toContain('Back');
  expect(html).not.toContain('Stage');
});

test('shows No file changes for an expanded empty commit', () => {
  const html = renderPanel({
    snapshot: { files: [], revision: 'a'.repeat(64) },
    historySnapshot: {
      commits: [
        {
          oid: '1'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'empty',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    },
    expandedCommit: {
      oid: '1'.repeat(40),
      parents: [],
      authorName: 'Ada',
      authorDate: '2026-09-06T18:09:18Z',
      subject: 'empty',
    },
    commitSnapshot: { files: [], revision: 'b'.repeat(64) },
    commitLoadState: 'idle',
    onToggleCommit: (): void => undefined,
  });
  expect(html).toContain('No file changes');
  expect(html).toContain('No uncommitted changes');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/commit-history-graph.test.tsx src/components/workflows/source-control/source-control-panel.test.tsx )
```

Expected: FAIL because the new props do not exist.

- [ ] **Step 3: Implement inline expand chrome**

Extend `CommitGraphRowProps` with `expanded: boolean`.
Set `aria-expanded={props.expanded}` on the row button.
Keep the row as `role="option"`.
Do not put the file list inside the button.

Extend `CommitHistoryGraphProps`:

```ts
export interface CommitHistoryGraphProps {
  commits: readonly GitLogCommit[];
  nowMs?: number;
  idPrefix?: string;
  expandedOid?: string | null;
  commitFiles?: readonly GitChangedFile[];
  commitFilesLoadState?: 'idle' | 'loading' | 'error';
  selectedPath?: string | null;
  onToggleCommit?: (commit: GitLogCommit) => void;
  onOpenFile?: (file: GitChangedFile) => void;
}
```

Do not import `SourceControlLoadState` from `source-control-panel.tsx`.
Import `ChangedFilesList`.
At the start of the History `onKeyDown`, return when `event.currentTarget !== event.target` so Arrow/Enter/Space from the nested `ChangedFilesList` cannot also move or collapse the outer History row.
Clicking a row or pressing Enter/Space while the History listbox itself has focus calls `onToggleCommit` with the active commit and still does not call `onOpenFile`.
Arrow/Home/End still only move `activeIndex`.
The row `onSelect` handler must focus the History listbox, activate that row index, and call `props.onToggleCommit?.(commit)` exactly once.

```ts
const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
  if (event.currentTarget !== event.target) return;
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Home' ||
    event.key === 'End'
  ) {
    event.preventDefault();
    const nextIndex = nextCommitIndex(event.key, clampedActiveIndex, props.commits.length);
    virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    activate(nextIndex);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const commit = props.commits[clampedActiveIndex];
    if (commit) props.onToggleCommit?.(commit);
  }
};
```

Render the inline list as a sibling of `CommitGraphRow` only for the expanded index.
Give the nested list its own `activeIndex` state so keyboard inside `Commit files` works.

```tsx
{props.expandedOid === commit.oid ? (
  props.commitFilesLoadState === 'loading' ? (
    <p role="status" className="h-9 px-4 py-2 text-xs text-text-secondary">
      Loading files
    </p>
  ) : props.commitFilesLoadState === 'error' && (props.commitFiles?.length ?? 0) === 0 ? (
    <p role="status" className="h-9 px-4 py-2 text-xs text-text-secondary">
      Could not refresh files.
    </p>
  ) : (props.commitFiles?.length ?? 0) === 0 ? (
    <p role="status" className="h-9 px-4 py-2 text-xs text-text-secondary">
      No file changes
    </p>
  ) : (
    <div
      className="flex min-h-0 flex-col pl-2"
      style={{ height: Math.min(240, (props.commitFiles?.length ?? 0) * 28 + 16) }}
    >
      {props.commitFilesLoadState === 'error' ? (
        <p role="status" className="px-2 pb-1 text-xs text-text-secondary">
          Could not refresh files.
        </p>
      ) : null}
      <ChangedFilesList
        files={props.commitFiles ?? []}
        activeIndex={commitFileActiveIndex}
        onActiveIndexChange={setCommitFileActiveIndex}
        selectedPath={props.selectedPath}
        onOpenFile={props.onOpenFile}
        ariaLabel="Commit files"
        idPrefix={`sc-commit-${commit.oid}-file`}
      />
    </div>
  )
) : null}
```

Make `estimateSize(index)` return `COMMIT_ROW_HEIGHT` for collapsed rows, `COMMIT_ROW_HEIGHT + 36` for an expanded loading/error/empty row, and `COMMIT_ROW_HEIGHT + Math.min(240, fileCount * 28 + 16)` for an expanded populated row.
Add `data-index={virtualItem.index}` and `ref={virtualizer.measureElement}` to each absolute virtual row wrapper.
Call `virtualizer.measure()` in a `useLayoutEffect` keyed by `expandedOid`, `commitFilesLoadState`, and `commitFiles?.length` so a populated or failed fetch cannot overlap the following commit.
Reset or clamp the nested active index when `expandedOid` or the commit file count changes.

Extend `SourceControlPanelProps` with `expandedCommit: GitLogCommit | null`, `commitSnapshot: SourceControlSnapshot | null`, `commitLoadState: SourceControlLoadState`, `onToggleCommit`, and `onOpenCommitFile`.
Derive the files for `CommitHistoryGraph` from `commitSnapshot` only when it is a ready snapshot, include `commitSnapshot?.emptyReason` in `displayedEmptyReason`, and pass separate `selectedNowPath` and `selectedCommitPath` props so the same path cannot appear selected in both lists.
Do not hide the Changes list when a commit is expanded.

- [ ] **Step 4: Verify GREEN**

Run the same component test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workflows/source-control/commit-graph-row.tsx packages/web/src/components/workflows/source-control/commit-history-graph.tsx packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx packages/web/src/components/workflows/source-control/source-control-panel.tsx packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): expand a commit's files inline on the history graph

EOF
)"
```

---

### Task 6: Load commit files into the shared viewer

**Files:**

- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`

**Interfaces:**

- Consumes: `getWorkflowRunGitChanges`, `getWorkflowRunGitDiff`, `getWorkflowRunGitFile`, `FileViewer`
- Produces: `ViewerScope = { kind: 'now' } | { kind: 'commit'; oid: string; parentOid: string | null }`

- [ ] **Step 1: Write the failing mounted tests**

Update `mockGitRoutes` so `/git/changes?ref=` does not increment the Now changes counter:

```ts
onCommitChanges?: (
  ref: string,
  call: number,
  init?: RequestInit
) => GitChangesResponse | Response | Promise<GitChangesResponse | Response>;
```

Add `let commitChangesCall = 0` beside the existing route counters and replace the changes branch with:

```ts
if (url.includes('/git/changes')) {
  const parsed = new URL(url, 'http://archon.local');
  const ref = parsed.searchParams.get('ref');
  if (ref !== null) {
    commitChangesCall += 1;
    if (!options.onCommitChanges) throw new Error(`Unexpected commit changes fetch: ${url}`);
    const result = await options.onCommitChanges(ref, commitChangesCall, init);
    return result instanceof Response ? result : jsonResponse(result);
  }
  changesCall += 1;
  const result = await options.onChanges(changesCall, init);
  return result instanceof Response ? result : jsonResponse(result);
}
```

Add this fixture next to `HISTORY_COMMIT`:

```ts
const CHILD_COMMIT: GitLogCommit = {
  oid: 'c'.repeat(40),
  parents: ['b'.repeat(40)],
  authorName: 'Ada',
  authorDate: '2026-09-06T18:09:18Z',
  subject: 'child subject',
};
```

Add these five tests inside `describe('SourceControlTab')`:

```ts
test('expanding a commit fetches that commit list and does not open the viewer', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: (ref) => {
      expect(ref).toBe(CHILD_COMMIT.oid);
      return { files: [{ path: 'then.ts', status: 'M' }], revision: REVISION_B };
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  const row = host.querySelector('#sc-history-commit-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing commit row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  expect(host.textContent).toContain('now.ts');
  expect(host.querySelector('[aria-label="Before"]')).toBeNull();
  expect(
    calledUrls(fetchSpy).filter(
      url => url.includes('/git/changes') && url.includes('ref=' + CHILD_COMMIT.oid)
    )
  ).toHaveLength(1);
  expect(calledUrls(fetchSpy).some(url => url.includes('/git/diff'))).toBe(false);
  expect(calledUrls(fetchSpy).some(url => url.includes('/git/file/'))).toBe(false);
  expect(calledUrls(fetchSpy).some(url => url.includes('working_path'))).toBe(false);
});

test('opening a commit M file uses parent-to-commit diff in the same viewer', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'then.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: (url) => {
      expect(url).toContain('ref=' + CHILD_COMMIT.oid);
      expect(url).toContain('path=then.ts');
      return jsonResponse({
        path: 'then.ts',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'before', oldLine: 1 },
              { type: 'insert', content: 'after', newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
        fileFallback: false,
      });
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  const row = host.querySelector('#sc-history-commit-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing commit row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.querySelector('[aria-label="Before"]') !== null, 'commit diff');
  expect(host.querySelector('[aria-label="After"]')).not.toBeNull();
});

test('collapsing History hides only the inline files and preserves the commit viewer', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'then.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: () =>
      jsonResponse({
        ...readyDiff('then.ts', 'before', 'after'),
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
      }),
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  const row = host.querySelector('#sc-history-commit-0');
  if (!(row instanceof HTMLElement)) throw new Error('missing commit row');
  await act(async () => {
    row.click();
  });
  await waitFor(() => host.querySelector('[aria-label="Commit files"]') !== null, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.querySelector('[aria-label="Before"]') !== null, 'commit diff');
  await act(async () => {
    row.click();
  });
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[aria-label="Commit files"]')).toBeNull();
  expect(host.querySelector('[aria-label="Before"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="After"]')).not.toBeNull();
});

test('opening a commit A file reads the commit oid and a D file reads the parent oid', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [
        { path: 'added.ts', status: 'A' },
        { path: 'gone.ts', status: 'D' },
      ],
      revision: REVISION_B,
    }),
    onFile: (url) => textFileResponse('body\n', HASH_A),
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('added.ts') === true, 'commit files');
  await clickOption('added.ts');
  await waitFor(
    () =>
      calledUrls(fetchSpy).some(
        url => url.includes('/git/file/added.ts') && url.includes('source=' + CHILD_COMMIT.oid)
      ),
    'commit A source'
  );
  await clickOption('gone.ts');
  await waitFor(
    () =>
      calledUrls(fetchSpy).some(
        url => url.includes('/git/file/gone.ts') && url.includes('source=' + CHILD_COMMIT.parents[0])
      ),
    'commit D parent source'
  );
});

test('a commit M raw fallback reads and downloads the after side from the commit oid', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'blob.bin', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: () =>
      jsonResponse({
        path: 'blob.bin',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [],
        cursor: '',
        truncated: false,
        binary: true,
        fileFallback: true,
      }),
    onFile: () =>
      presentedFileResponse(Uint8Array.from([0, 0x41]), HASH_A, {
        'Content-Type': 'application/octet-stream',
        'X-Archon-Git-Presentation': 'hex',
        'X-Archon-Git-Byte-Length': '2',
      }),
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
  await waitFor(() => host.textContent?.includes('blob.bin') === true, 'commit files');
  await clickOption('blob.bin');
  await waitFor(() => host.textContent?.includes('00000000') === true, 'hex fallback');
  const fileUrls = calledUrls(fetchSpy).filter(url => url.includes('/git/file/blob.bin'));
  expect(fileUrls).toHaveLength(1);
  expect(fileUrls[0]).toContain('source=' + CHILD_COMMIT.oid);
  expect(host.querySelector('a')?.getAttribute('href')).toContain('source=' + CHILD_COMMIT.oid);
  expect(host.querySelector('a')?.getAttribute('href')).toContain('download=1');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
```

Expected: FAIL because expanding a commit does not fetch `?ref=` and opening a commit file still hits Now `worktree` / `live`.

- [ ] **Step 3: Implement viewer scope in the tab**

Import `GitLogCommit`, `INITIAL_SOURCE_CONTROL_STATE`, and `SourceControlSnapshotState` from their existing modules.
Add a third `sourceControlSnapshotReducer` instance for the expanded commit so its displayed and pending lists follow the same freeze contract as Changes.
Use the expanded commit oid in the TanStack Query key; never put a viewer request into that query.

```ts
const [commitSnapshotState, dispatchCommit] = useReducer(
  sourceControlSnapshotReducer,
  INITIAL_SOURCE_CONTROL_STATE
);
const [expandedCommit, setExpandedCommit] = useState<GitLogCommit | null>(null);

const {
  data: commitData,
  isError: commitIsError,
  isFetching: commitIsFetching,
  refetch: refetchCommit,
} = useQuery({
  queryKey: ['workflowRunGitChanges', runId, expandedCommit?.oid ?? null],
  enabled: expandedCommit !== null,
  queryFn: ({ signal }) => {
    if (expandedCommit === null) throw new Error('Missing expanded commit');
    return getWorkflowRunGitChanges(runId, { ref: expandedCommit.oid, signal });
  },
  retry: false,
  refetchInterval: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Infinity,
});
```

When `commitData` arrives and `commitSnapshotState.displayed` is null, dispatch `received` with `toSourceControlSnapshot(commitData)`.
`onToggleCommit` must collapse the same oid or set the new commit, dispatch `reset` to `dispatchCommit`, and let the enabled query perform exactly one list fetch.
Collapsing or switching the expanded row must not close or reload the viewer.

Add the scope and identity helpers next to the existing viewer helpers:

```ts
type ViewerScope =
  | { kind: 'now' }
  | { kind: 'commit'; oid: string; parentOid: string | null };

interface PendingViewer {
  file: GitChangedFile;
  scope: ViewerScope;
  state: LoadedViewerState;
}

function sameViewerScope(left: ViewerScope, right: ViewerScope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'now' ||
      (right.kind === 'commit' &&
        left.oid === right.oid &&
        left.parentOid === right.parentOid))
  );
}

function rawSourceFor(file: GitChangedFile, scope: ViewerScope): GitFileSource | null {
  if (scope.kind === 'now') return file.status === 'D' ? 'head' : 'worktree';
  if (file.status !== 'D') return scope.oid;
  return scope.parentOid;
}
```

Change `pendingViewerMatchesFile` to accept a `scope` and require path, status, and `sameViewerScope(pending.scope, scope)` to match.
Update its callback use to pass `viewerScopeRef.current` and its render-time use to pass `viewerScope`, with Task 7 replacing the surrounding Now-only acceptance logic.
Keep `selectedFile` plus `viewerScope: ViewerScope` defaulting to `{ kind: 'now' }`.
Keep `viewerScopeRef`, `expandedCommitRef`, and `commitSnapshotRef` synchronized during render because paging and acceptance callbacks must read the exact current scope.
Set both `viewerScopeRef.current` and React state synchronously in an opener before starting a request; this prevents a fast Load-more click from observing the previous scope.

Replace `loadViewerFile` with a scope-aware helper:

```ts
async function loadViewerFile(
  runId: string,
  file: GitChangedFile,
  scope: ViewerScope,
  signal: AbortSignal
): Promise<LoadedViewerState> {
  if (file.status === 'M') {
    const response = await getWorkflowRunGitDiff(runId, file.path, {
      signal,
      ref: scope.kind === 'commit' ? scope.oid : undefined,
    });
    if ('emptyReason' in response) {
      return { kind: 'unavailable', file, emptyReason: response.emptyReason };
    }
    if (!response.fileFallback) {
      return {
        kind: 'diff',
        file,
        response,
        reloadFingerprint: diffReloadFingerprint(response),
      };
    }
    const source = rawSourceFor(file, scope);
    if (source === null) throw new Error('Commit deletion has no parent');
    const raw = await getWorkflowRunGitFile(runId, file.path, source, { signal });
    if (raw.kind === 'empty') {
      return { kind: 'unavailable', file, emptyReason: raw.emptyReason };
    }
    if (raw.kind === 'text') {
      return {
        kind: 'text',
        file,
        text: raw.text,
        contentHash: raw.contentHash,
        truncated: raw.truncated,
        cursor: raw.cursor,
      };
    }
    return fromRawFile(runId, file, source, raw);
  }
  const source = rawSourceFor(file, scope);
  if (source === null) throw new Error('Commit deletion has no parent');
  const response = await getWorkflowRunGitFile(runId, file.path, source, { signal });
  if (response.kind === 'empty') {
    return { kind: 'unavailable', file, emptyReason: response.emptyReason };
  }
  if (response.kind === 'text') {
    return {
      kind: 'text',
      file,
      text: response.text,
      contentHash: response.contentHash,
      truncated: response.truncated,
      cursor: response.cursor,
    };
  }
  return fromRawFile(runId, file, source, response);
}
```

Extract `onOpenScopedFile(file, scope)` from the existing `onOpenFile` body.
For a Now scope, find the pending counterpart only in `snapshotRef.current.pending`.
For a commit scope, find it only in `commitSnapshotRef.current.pending` and only when `expandedCommitRef.current?.oid === scope.oid`.
Every `setPendingViewer` call must store `{ file, scope, state }`.
Update every `loadViewerFile` call site to pass a scope so strict TypeScript remains green; use `viewerScopeRef.current` in the pre-Task-7 Reload, viewer-retry, and error paths.
The Changes wrapper calls `onOpenScopedFile(file, { kind: 'now' })`.
The commit wrapper reads `expandedCommitRef.current`, returns if it is null, and calls `onOpenScopedFile(file, { kind: 'commit', oid: commit.oid, parentOid: commit.parents[0] ?? null })`.
Do not call `loadViewerFile` from `onToggleCommit`.

Derive `commitLoadState` from `commitIsError` and `commitIsFetching` exactly as the existing two load states are derived.
Pass `expandedCommit`, `commitSnapshotState.displayed`, `commitLoadState`, `onToggleCommit`, and `onOpenCommitFile` into `SourceControlPanel`.
Pass `viewerScope.kind === 'now' ? selectedFile?.path ?? null : null` as `selectedNowPath`.
Pass `viewerScope.kind === 'commit' && viewerScope.oid === expandedCommit?.oid ? selectedFile?.path ?? null : null` as `selectedCommitPath`.
`closeViewer` and the `runId` reset effect must set both the scope ref and scope state back to Now; the same reset effect also clears `expandedCommit` and dispatches `reset` to `dispatchCommit`.
Leave scoped paging and the three-snapshot Reload transaction to Task 7 so its tests begin RED.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
```

Expected: the five new tests PASS and the existing Story 2.1 tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workflows/source-control/source-control-tab.tsx packages/web/src/component-integration/source-control-tab.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): open commit files in the shared source-control viewer

EOF
)"
```

---

### Task 7: Scope-safe paging, Reload freeze, and keyboard isolation

**Files:**

- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`

**Interfaces:**

- Consumes: `mockGitRoutes`, `CHILD_COMMIT`, `FileViewer`, the three snapshot reducers
- Produces: scope-preserving pagination, atomic Reload acceptance, return-to-Now, and nested keyboard isolation

- [ ] **Step 1: Write the failing remaining tests**

Add `const REVISION_C = 'e'.repeat(64)` beside the two existing revision fixtures.
Add:

```ts
test('selecting a Changes file returns the viewer to now/live', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'then.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: (url) => {
      if (!url.includes('ref=' + CHILD_COMMIT.oid)) {
        throw new Error(`Unexpected diff fetch: ${url}`);
      }
      return jsonResponse({
        path: 'then.ts',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'before', oldLine: 1 },
              { type: 'insert', content: 'after', newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
        fileFallback: false,
      });
    },
    onFile: (url) => {
      expect(url).toContain('source=worktree');
      expect(url).not.toContain('ref=');
      return textFileResponse('now-body\n', HASH_A);
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.querySelector('[aria-label="Before"]') !== null, 'commit diff');
  await clickOption('now.ts');
  await waitFor(() => host.textContent?.includes('now-body') === true, 'now file');
  expect(host.querySelector('[aria-label="Before"]')).toBeNull();
  expect(host.textContent).not.toContain('Back');
  expect(
    calledUrls(fetchSpy).some(url => url.includes('/git/file/now.ts') && url.includes('source=worktree'))
  ).toBe(true);
});

test('Load more keeps the commit oid and opaque cursor for commit text', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'added.txt', status: 'A' }],
      revision: REVISION_B,
    }),
    onFile: (_url, call) =>
      call === 1
        ? presentedFileResponse('first\n', HASH_A, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Archon-Git-Truncated': 'true',
            'X-Archon-Git-Cursor': 'commit+cursor',
            'X-Archon-Git-Byte-Length': '13',
            'X-Archon-Git-Presentation': 'text',
          })
        : presentedFileResponse('second\n', HASH_A, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Archon-Git-Presentation': 'text',
            'X-Archon-Git-Byte-Length': '13',
          }),
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
  await waitFor(() => host.textContent?.includes('added.txt') === true, 'commit files');
  await clickOption('added.txt');
  await waitFor(() => host.textContent?.includes('Load more') === true, 'Load more');
  await act(async () => {
    requireButton('Load more').click();
  });
  await waitFor(() => host.textContent?.includes('second') === true, 'second page');
  const fileUrls = calledUrls(fetchSpy).filter(url => url.includes('/git/file/added.txt'));
  expect(fileUrls).toHaveLength(2);
  expect(fileUrls.every(url => url.includes('source=' + CHILD_COMMIT.oid))).toBe(true);
  expect(fileUrls[1]).toContain('cursor=commit%2Bcursor');
});

test('Load more keeps the commit oid and opaque cursor for commit hunks', async () => {
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({ commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }),
    onCommitChanges: () => ({
      files: [{ path: 'large.ts', status: 'M' }],
      revision: REVISION_B,
    }),
    onDiff: (url, call) => {
      expect(url).toContain('ref=' + CHILD_COMMIT.oid);
      if (call === 2) expect(url).toContain('cursor=commit%2Bdiff');
      return jsonResponse({
        ...(call === 1 ? FIRST_DIFF_PAGE : SECOND_DIFF_PAGE),
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        cursor: call === 1 ? 'commit+diff' : '',
      });
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
  await waitFor(() => host.textContent?.includes('large.ts') === true, 'commit files');
  await clickOption('large.ts');
  await waitFor(() => host.textContent?.includes('Load more') === true, 'Load more');
  await act(async () => {
    requireButton('Load more').click();
  });
  await waitFor(() => host.textContent?.includes('second') === true, 'second hunk page');
  expect(calledUrls(fetchSpy).filter(url => url.includes('/git/diff'))).toHaveLength(2);
});

test('Reload freezes an open commit diff until Changed on disk is accepted', async () => {
  let diffCall = 0;
  fetchSpy = mockGitRoutes({
    onChanges: call =>
      call === 1
        ? { files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_A }
        : { files: [{ path: 'now.ts', status: 'A' }], revision: REVISION_B },
    onLog: call =>
      call === 1
        ? { commits: [CHILD_COMMIT], revision: REVISION_A, truncated: false }
        : {
            commits: [{ ...CHILD_COMMIT, subject: 'rewritten subject' }],
            revision: REVISION_B,
            truncated: false,
          },
    onCommitChanges: (_ref, call) =>
      call === 1
        ? { files: [{ path: 'then.ts', status: 'M' }], revision: REVISION_B }
        : {
            files: [
              { path: 'then.ts', status: 'M' },
              { path: 'pending.ts', status: 'A' },
            ],
            revision: REVISION_C,
          },
    onDiff: () => {
      diffCall += 1;
      const after = diffCall === 1 ? 'frozen-after' : 'pending-after';
      return jsonResponse({
        path: 'then.ts',
        status: 'M',
        scope: 'commit',
        ref: CHILD_COMMIT.oid,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            header: '@@ -1 +1 @@',
            changes: [
              { type: 'delete', content: 'before', oldLine: 1 },
              { type: 'insert', content: after, newLine: 1 },
            ],
          },
        ],
        cursor: '',
        truncated: false,
        binary: false,
        fileFallback: false,
      });
    },
  });
  await renderTab('run/one');
  await waitFor(() => host.textContent?.includes(CHILD_COMMIT.subject) === true, 'commit row');
  await act(async () => {
    host.querySelector('#sc-history-commit-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('then.ts') === true, 'commit files');
  await clickOption('then.ts');
  await waitFor(() => host.textContent?.includes('frozen-after') === true, 'open commit diff');
  await act(async () => {
    requireButton('Reload').click();
  });
  await waitFor(
    () => host.textContent?.includes('Changed on disk — Reload') === true,
    'stale banner'
  );
  expect(host.textContent).toContain('frozen-after');
  expect(host.textContent).not.toContain('pending-after');
  expect(host.textContent).not.toContain('pending.ts');
  expect(host.textContent).toContain(CHILD_COMMIT.subject);
  expect(host.textContent).not.toContain('rewritten subject');
  await act(async () => {
    requireButton('Changed on disk — Reload').click();
  });
  await waitFor(() => host.textContent?.includes('rewritten subject') === true, 'accepted History');
  await waitFor(() => host.textContent?.includes('pending-after') === true, 'accepted commit diff');
  expect(host.textContent).toContain('pending.ts');
  const urls = calledUrls(fetchSpy);
  expect(urls.filter(url => url.includes('/git/log'))).toHaveLength(2);
  expect(
    urls.filter(url => url.includes('/git/changes') && !url.includes('ref='))
  ).toHaveLength(2);
  expect(
    urls.filter(url => url.includes('/git/changes') && url.includes('ref=' + CHILD_COMMIT.oid))
  ).toHaveLength(2);
});
```

Replace the existing Story 2.1 History keyboard test with:

```ts
test('keyboard Enter expands files and nested Enter opens one without collapsing History', async () => {
  const secondCommit = {
    ...HISTORY_COMMIT,
    oid: '2'.repeat(40),
    subject: 'second history subject',
  };
  fetchSpy = mockGitRoutes({
    onChanges: () => ({ files: [], revision: REVISION_A }),
    onLog: () => ({
      commits: [HISTORY_COMMIT, secondCommit],
      revision: REVISION_A,
      truncated: false,
    }),
    onCommitChanges: ref => {
      expect(ref).toBe(secondCommit.oid);
      return { files: [{ path: 'nested.ts', status: 'M' }], revision: REVISION_B };
    },
    onDiff: url => {
      expect(url).toContain('ref=' + secondCommit.oid);
      return jsonResponse({
        ...readyDiff('nested.ts', 'before', 'after'),
        scope: 'commit',
        ref: secondCommit.oid,
      });
    },
  });
  await renderTab('run-1');
  await waitFor(() => host.textContent?.includes(HISTORY_COMMIT.subject) === true, 'commit row');
  const history = host.querySelector('[role="listbox"][aria-label="Commit history"]');
  if (!(history instanceof HTMLElement)) throw new Error('Missing History listbox');
  await act(async () => {
    history.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-1');
  await act(async () => {
    history.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await waitFor(() => host.textContent?.includes('nested.ts') === true, 'nested commit file');
  expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-1');
  expect(host.querySelector('#sc-history-commit-1')?.getAttribute('aria-expanded')).toBe('true');
  expect(calledUrls(fetchSpy).filter(url => url.includes('/git/diff'))).toEqual([]);
  expect(calledUrls(fetchSpy).filter(url => url.includes('/git/file/'))).toEqual([]);
  const commitFiles = host.querySelector('[role="listbox"][aria-label="Commit files"]');
  if (!(commitFiles instanceof HTMLElement)) throw new Error('Missing commit files listbox');
  await act(async () => {
    commitFiles.focus();
    commitFiles.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await waitFor(() => host.querySelector('[aria-label="Before"]') !== null, 'nested commit diff');
  expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-1');
  expect(host.querySelector('#sc-history-commit-1')?.getAttribute('aria-expanded')).toBe('true');
});
```

Keep the CAP-6 tests proving History is absent and no commit fetch occurs.

- [ ] **Step 2: Verify RED**

Run:

```bash
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
```

Expected: FAIL because commit Load-more still sends Now sources and Reload does not refetch or freeze the expanded commit list.

- [ ] **Step 3: Implement scoped paging and the three-snapshot Reload transaction**

Do not weaken assertions.
Do not allow `working_path` in any called URL.
Extend `pendingListRequestRef` with `commitOid: string | null`.
When aborting a Reload, cancel the exact Now key, log key, and `['workflowRunGitChanges', runId, commitOid]` key when `commitOid` is non-null.
Do not cancel an ordinary commit expansion from `abortCurrent`; TanStack Query owns cancellation when its key is disabled or replaced.

In `onLoadMore`, capture `const scope = viewerScopeRef.current` beside `file` and `state`.
For a text page, call `rawSourceFor(file, scope)` and set `{ kind: 'error', file }` if it returns null.
For a diff page, pass `ref: scope.kind === 'commit' ? scope.oid : undefined` with the existing opaque cursor.
Keep the existing content-hash and diff-identity checks, including `next.ref === state.response.ref`, before appending a page.
`onViewerReload` must pass `viewerScopeRef.current` to `loadViewerFile`.

Replace the Reload body with one `Promise.all` over `refetch()`, `refetchHistory()`, and `expandedCommitRef.current === null ? Promise.resolve(null) : refetchCommit()`.
Store the expanded oid in `pendingListRequestRef` before starting those calls.
Dispatch successful Now, History, and expanded-commit responses to their own reducers and never copy one response into another reducer.
Capture the selected file and viewer scope before awaiting the viewer reload.
Reload the selected file with that captured scope and place it in `pendingViewer`; never replace `viewerState` in the Reload callback.
When a pending list exists for the open scope, use its path-and-status match as the file passed to `loadViewerFile`; when the open commit is not the currently expanded commit, reuse the selected file because no commit-list response for that oid was requested.
If the refreshed viewer fingerprint and every refreshed snapshot fingerprint equal their displayed values, clear `pendingViewer`; otherwise keep all changed snapshots and the refreshed viewer pending behind the one stale banner.

In `onAcceptPending`, calculate the accepted Now, History, and commit snapshots before dispatching any action.
For a Now viewer, require a matching pending viewer when the pending Now list still contains its selected file.
For a commit viewer whose oid equals the expanded commit, apply the same requirement against the pending commit list.
If the accepted list for the open scope no longer contains the selected path/status, accept all ready snapshots and close the viewer.
If any accepted snapshot is CAP-6, accept all pending reducers and close the viewer because the checkout can no longer be read.
Otherwise dispatch `accept_pending` to every reducer that has a pending snapshot, then replace the viewer only with a `pendingViewer` whose scope matches the current viewer scope.
If the accepted History list no longer contains the expanded oid, clear `expandedCommit` and reset `dispatchCommit`, but preserve a readable commit-scoped viewer because collapse is not a Return-to-Now action.

Include `commitSnapshotState.pending` in `hasPending` and in the acceptance-readiness calculation so its stale list cannot be accepted without its matching scoped viewer.
The Changes opener must synchronously set the scope ref and state to `{ kind: 'now' }`; this is the only Return-to-Now behavior.

- [ ] **Step 4: Verify GREEN**

Run the same mounted test command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/component-integration/source-control-tab.test.tsx packages/web/src/components/workflows/source-control/source-control-tab.tsx
git commit -m "$(cat <<'EOF'
feat(web): preserve commit scope through reload and paging

EOF
)"
```

---

### Task 8: Acceptance gates and sprint status

**Files:**

- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

- [ ] **Step 1: Run focused packages**

```bash
( cd packages/git && bun test src/git-oid.test.ts src/changed-files.test.ts src/file-read.test.ts )
( cd packages/server && bun test src/routes/api.git-changes.test.ts src/routes/git/checkout-gate.test.ts )
( cd packages/web && bun test src/lib/api.git-changes.test.ts )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/source-control/commit-history-graph.test.tsx src/components/workflows/source-control/source-control-panel.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/component-integration/source-control-tab.test.tsx )
```

Expected: PASS.

- [ ] **Step 2: Run package test scripts**

```bash
( cd packages/git && bun run test )
( cd packages/server && bun run test )
( cd packages/web && bun run test )
```

Expected: all package scripts exit 0.
The server git tests and the mounted web test must appear as their own Bun invocations.

- [ ] **Step 3: Formatting and repository gate**

```bash
bun run format:check
git diff --check
bun run validate
```

Expected: all three exit 0.

- [ ] **Step 4: Confirm the acceptance matrix**

| Criterion | Proof |
| --- | --- |
| Select a commit → that commit's `M`/`A`/`D` with Now projections | git name-status tests plus mounted expand test |
| Root commit uses `--root`; merge commit uses its first parent | root and merge `changedFiles` tests plus ordered-parent helper test |
| Full object names must be reachable commits under the checkout's current `HEAD` | missing-object and existing-unreachable-object git tests plus HTTP 400 mapping tests |
| Literal special paths remain safe | colon, leading-dash, space, newline, and glob-metacharacter git tests |
| Same `FileViewer` / `ChangedFilesList` | tab wiring and distinct `idPrefix` tests |
| `M` is `parent → commit` | fileDiff argv test and mounted diff `scope: "commit"` |
| `A` raw from commit oid, `D` raw from first parent | mounted file URL test |
| Binary `M` raw fallback reads and downloads the commit after-side | git binary fallback test and mounted hex/download URL test |
| Hunk JSON `scope: "commit"` and `ref` is the full oid, never `live` | HTTP and mounted tests |
| Client sends only `runId` plus server-issued path/oid | API client tests; no `working_path` |
| Return to Now restores live scope | mounted Changes click test |
| Collapsing History hides inline files without changing the open commit view | mounted collapse test |
| Commit text and hunk pagination preserve the oid and opaque cursor | git cursor-identity test and mounted two-page URL tests |
| Reload refetches Now, History, and the expanded commit exactly once and freezes all three | mounted endpoint-count and pending-content assertions |
| Inline expand, Changes pinned, no Back | panel tests |
| Expanded History rows reserve measured height while the nested list remains virtualized | 200-file graph test with outer and inner size assertions |
| Expand does not open the viewer | mounted expand test |
| `changedFiles` / `fileDiff` / `fileAt` accept a commit ref | git tests |
| Blob reads stay `ls-tree -z` + `cat-file blob` | existing file-read argv test plus commit diff spawn test |
| CAP-6 HTTP 200 on commit-scoped routes | HTTP tests |
| JSON OpenAPI except raw file wildcard | route files |
| Keyboard: outer Enter expands, nested Enter opens, and bubbling never collapses the row | mounted keyboard test and descendant-event guard |
| No write chrome | panel tests |
| Console untouched | scoped diff contains no `packages/web/src/experiments/console/` file |
| No new dependency | `bun.lock` / package manifests unmodified |
| No new package-root I/O export | `packages/git/src/index.ts` still exports `changedFiles` / `fileDiff` / `fileAt` / `log` only as I/O |

- [ ] **Step 5: Legacy-screen smoke check**

```bash
bun run dev
```

Open `/legacy/workflows/runs/:id` for an existing DAG run, select Source Control, click a History commit, confirm its files expand under the row while Changes stays, open an `M` file as a two-pane diff, open an `A` or `D` file as a single pane, click a Changes file and see Now content, and confirm Reload does not rewrite the open pane until `Changed on disk — Reload`.
Stop only the dev processes started for this check.
If no DAG run exists in the local database, record that the automated suites are the acceptance evidence; do not fabricate a run or broaden this story.

- [ ] **Step 6: Update sprint status only after Steps 1 through 5 pass**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

```yaml
last_updated: 2026-09-07
```

and:

```yaml
  2-2-open-a-commits-files-in-the-same-viewer: done
  epic-2: done
```

Epic 2 has no Story 2.3 in this tracker, so set `epic-2: done` when 2.2 is done.

- [ ] **Step 7: Commit the tracker update**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "$(cat <<'EOF'
chore(sc): mark commit files in shared viewer story done

EOF
)"
```

## Out of Scope

- CAP-8 snapshot writing.
- Container overlay reads.
- Secret redaction.
- Hunk pagination behavior beyond reusing Story 1.3 cursors on commit diffs.
- A second History file-list widget that replaces Changes.
- `@xyflow/react` History renderer.
- Sequential non-DAG run tabs.
- Write / stage / commit chrome.
- Closing GitHub issue #79 outside the pull-request workflow.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and use `.github/pull_request_template.md`.
Keep Problem and outcome, Review guidance, Solution, and Validation.
Include focused RED/GREEN evidence, the full validation result, the manual smoke result or its explicit no-local-run limitation, and `Closes #79`.
Do not write `N/A` sections and do not close the issue outside the PR workflow.
