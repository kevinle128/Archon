# Walk This Run's Commit History as a Lane Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a keyboard-operable History region below Changes on the legacy Source Control tab and render this run checkout's commits as a branch/merge lane graph driven by `log` records that include `parents[]`, including commits that never landed on `dev`.

**Architecture:** `@archon/git` owns a read-only `log` helper that walks `HEAD` through `execFileAsync` argv arrays.
The server reuses `loadRunCheckout`, applies the same CAP-6 gate as every other git route, and exposes `GET /api/workflows/runs/{runId}/git/log` as OpenAPI JSON.
The web app fetches that log on tab mount, freezes it beside the existing Changes snapshot, assigns lanes in a pure function, and paints one virtualized row per commit with a bespoke SVG lane column.
Moving to or clicking a commit highlights the row only; opening that commit's files is Story 2.2.

**Tech Stack:** Bun, strict TypeScript, `child_process.execFile` through `@archon/git` `execFileAsync`, Hono OpenAPI, Zod from `@hono/zod-openapi`, React 19, TanStack Query 5, `@tanstack/react-virtual` 3, and Bun tests.
Do not add a dependency.
Do not import `@xyflow/react` into the Source Control folder.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md` Story 2.1.
**Canonical design:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-1, CAP-4, CAP-6; `_bmad-output/planning-artifacts/prds/prd-source-control/addendum.md` log row; `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-6, AD-7, AD-9; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-08-31/DESIGN.md` `commit-graph-row`; `_bmad-output/planning-artifacts/ux-designs/ux-Archon-source-control-2026-08-31/EXPERIENCE.md` Commit Graph.
**Issue:** [#78](https://github.com/anhle128/Archon/issues/78), tracker key `2-1-walk-this-runs-commit-history-as-a-lane-graph`.
**Depends on:** Stories 1.1–1.3 are `done` in `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`.

## Global Constraints

- Story 2.1 inserts History plus the lane graph and must not open a commit's files, list per-commit `M`/`A`/`D`, or send a commit OID to `/git/diff` or `/git/file`.
- A plain chronological list without lane topology is not an acceptable fallback.
- The surface remains `/legacy/workflows/runs/:id`.
- No file under `packages/web/src/experiments/console/` may be imported or modified.
- The client sends only `runId` on the log route; it never sends `working_path`, an absolute path, or a client-invented tree-ish.
- The server reads existing `workflow_runs.working_path`; do not add a column and do not reconstruct the checkout from isolation metadata.
- Git commands use `execFileAsync` with an argv array that includes `-C` and the trusted path; never use `exec`, a shell string, or `cwd` interpolation for this helper.
- JSON routes use the local `registerOpenApiRoute(createRoute(...), handler)` wrapper.
- Web response types are generated from the running server into `packages/web/src/lib/api.generated.d.ts`; do not hand-edit that generated file.
- Auth matches the existing git routes: the global `/api/*` gate only, with no `requireWebUser` and no per-run owner ACL.
- CAP-6 is HTTP 200 with `emptyReason: "container" | "no_checkout"` on the log route; there is no "history is immutable" exemption for containers.
- A missing conversation, a null `conversation.isolation_env_id`, or a missing isolation-environment row skips only the container branch and continues to the host checkout gate.
- Host availability is decided at request time from a non-null path, directory existence, successful `realpath`, and a git-work-tree check.
- Live git is the source of truth; do not derive history from `workflow_events`.
- `log` walks the run checkout `HEAD`, not base `dev`, so commits that never merged to `dev` are present.
- Do not pass `--first-parent` or `--all`.
- An unborn repository is a live checkout with region empty History (`No commits yet`), not CAP-6.
- Git/API failure on a valid checkout keeps the previously displayed history and shows in-region Reload; copy is not alarm (`Error:`, `unsupported`, `⚠️`).
- Fetch git log only while the Source Control body is mounted; never poll; never let the three-second run-detail status poll invalidate the log query.
- Reload refetches Changes and History together and still never rewrites the open view until the operator accepts `Changed on disk — Reload`.
- Pino events use `domain.action_state`, pair started with completed or failed, and never log checkout paths, remotes, file contents, subjects, or error messages that can contain a path.
- Lanes are not color-only: merge commits use a diamond, ordinary commits use a circle, the 7-character short OID is visible, and stroke/fill use the existing `text-primary` / `text-secondary` tokens against `surface`.
- The current legacy tokens in `packages/web/src/index.css` are `surface: oklch(0.18 0.008 260)`, `surface-elevated: oklch(0.22 0.01 260)`, `surface-hover: oklch(0.24 0.01 260)`, `text-secondary: oklch(0.65 0.01 260)`, and `text-primary: oklch(0.93 0.005 260)`.
- `text-secondary` yields approximately 5.82:1 on `surface`, 5.35:1 on `surface-elevated`, and 5.09:1 on `surface-hover`; `text-primary` yields approximately 15.30:1, 14.09:1, and 13.39:1 respectively, so every normal, active, and hovered row exceeds the ≥3:1 non-text floor.
- Do not introduce opacity on graph strokes or nodes because that would invalidate this contrast proof.
- Do not add a table, process, environment variable, deployable, package, or dependency.
- Do not import `@xyflow/react` from `packages/web/src/components/workflows/source-control/`.
- `mock.module()` merges omitted exports from the real module in Bun, so every existing `@archon/git` mock factory must stub the new public I/O export instead of allowing a future test to fall through to live `git log`.
- Keep the three existing git HTTP routes plus the new log route in the isolated `packages/server/src/routes/api.git-changes.test.ts` process.
- Keep mounted Source Control behavior in the isolated `packages/web/src/component-integration/source-control-tab.test.tsx` process.
- Every production behavior follows RED, verified RED, minimal GREEN, verified GREEN, and only then refactoring.
- Run command blocks from the repository root.
- Never run an unscoped `bun test` from the repository root.
- Every full Markdown sentence in this plan stays on one physical line.

## File Structure

- Create `packages/git/src/git-log.ts` for NUL-delimited `git log` parsing, unborn-repo detection, truncation, revision fingerprinting, and the public `log` helper.
- Create `packages/git/src/git-log.test.ts` for parser cases plus a real temporary repository with a merge and a `dev` sibling branch.
- Modify `packages/git/src/index.ts` to export the public `log`, `GIT_LOG_MAX_COMMITS`, and log types; parser/result-construction helpers remain testable from `./git-log` without becoming package-root API.
- Modify the 31 existing `mock.module('@archon/git')` factories listed in Task 1 to stub `log`.
- Modify `packages/server/src/routes/schemas/git.schemas.ts` to add `GitLogCommit` and `GitLogResponse`.
- Create `packages/server/src/routes/git/log-route.ts` for the `createRoute` definition.
- Create `packages/server/src/routes/git/log-handler.ts` with the complete checkout gate, post-read CAP-6 recheck, opaque error mapping, and paired Pino events shown in Task 2.
- Modify `packages/server/src/routes/api.ts` only to import and register the log route beside the existing git JSON routes.
- Modify `packages/server/src/routes/api.git-changes.test.ts` to stub `log` and cover the HTTP contract.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from the running server.
- Modify `packages/web/src/lib/api.ts` to re-export generated log types and add `getWorkflowRunGitLog`.
- Modify `packages/web/src/lib/api.git-changes.test.ts` for the runId-only log request.
- Create `packages/web/src/components/workflows/source-control/commit-lanes.ts` for the pure lane-assignment function and explicit incoming, through, and outgoing row edges (Spike 3 outcome).
- Create `packages/web/src/components/workflows/source-control/commit-lanes.test.ts` for literal linear, merge, convergence, octopus, root, empty, and full-page-before-windowing expectations.
- Modify `packages/web/src/components/workflows/source-control/source-control-state.ts` to freeze History snapshots with the same displayed/pending rules as Changes.
- Modify `packages/web/src/components/workflows/source-control/source-control-state.test.ts` for History fingerprint transitions.
- Create `packages/web/src/components/workflows/source-control/format-commit-time.ts` and `format-commit-time.test.ts` for relative commit timestamps.
- Create `packages/web/src/components/workflows/source-control/commit-graph-row.tsx` for one accessible graph row.
- Create `packages/web/src/components/workflows/source-control/commit-history-graph.tsx` for the virtualized History listbox plus SVG lanes.
- Create `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx` for copy, SVG topology, keyboard, and a11y.
- Modify `packages/web/src/components/workflows/source-control/source-control-panel.tsx` to render History below Changes on a live checkout.
- Modify `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx` so ready snapshots include History and CAP-6 snapshots still do not.
- Modify `packages/web/src/components/workflows/source-control/source-control-tab.tsx` to query log, combine stale, and pass History props.
- Modify `packages/web/src/component-integration/source-control-tab.test.tsx` for mounted log fetch, empty history, CAP-6, stale across both regions, and no file-open on commit select.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after every acceptance and repository gate passes.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx`, any console experiment, a database schema, a package manifest, or `bun.lock`.

## Locked Wire Contract

```ts
export const GIT_LOG_MAX_COMMITS = 500;

export interface GitLogCommit {
  oid: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
}

export interface GitLogResult {
  commits: GitLogCommit[];
  revision: string;
  truncated: boolean;
}

export function log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult>;
```

`oid` and every `parents[]` entry are lowercase hexadecimal full object names: 40 characters for SHA-1 repositories or 64 characters for SHA-256 repositories.
`parents` is empty for a root commit and ordered exactly as git `%P` (first parent first).
`authorDate` is git `%aI` (ISO-8601 with offset) copied verbatim.
`subject` is git `%s`.

A populated or empty live-checkout log response has a 64-character lowercase hexadecimal SHA-256 `revision`.
The revision input is the exact `git log` stdout string returned by `execFileAsync`.
`log` asks git for `GIT_LOG_MAX_COMMITS + 1` records, returns only the first 500, and sets `truncated` to `true` only when the sentinel 501st record exists.

A CAP-6 response is HTTP 200 with `{ emptyReason: "container" | "no_checkout", commits: [], revision: "", truncated: false }`.
A missing run is HTTP 404 with `{ error: "Workflow run not found" }`.
A post-gate git failure is HTTP 500 with `{ error: "Could not read git history" }`.
Unknown query parameters, including `working_path`, are ignored and never influence checkout resolution.

The argv for a successful read is exactly:

```ts
['-C', workingPath, '--no-optional-locks', 'log', '--date-order', '--format=%H%x00%P%x00%an%x00%aI%x00%s', '-z', `--max-count=${String(GIT_LOG_MAX_COMMITS + 1)}`, 'HEAD']
```

Parser: split stdout on `'\0'`, drop a trailing empty record, then consume groups of five fields `(oid, parentsRaw, authorName, authorDate, subject)`.
`parentsRaw` splits on ASCII space and drops empty tokens.
A remainder that is not a multiple of five, an OID that is neither 40 nor 64 lowercase hexadecimal characters, or a parent with a different object-name length than its commit throws `Malformed git log output`.

Unborn / missing `HEAD` is not thrown to the route: `log` returns `{ commits: [], revision, truncated: false }` whose revision is the SHA-256 of empty stdout.
Detect that case only via `isEmptyHistoryError` matching git stderr/message substrings `does not have any commits yet`, `unknown revision or path not in the working tree`, and `ambiguous argument 'HEAD'`.
Any other git failure throws so the handler can recheck CAP-6 or return 500.

## Spike 3 Outcome (locked for this story)

Reuse of `@xyflow/react` is rejected for History.
React Flow on this screen is a pan/zoom canvas with Controls and MiniMap (`WorkflowDagViewer.tsx`), which fights a compact keyboard listbox inside the 30% list pane.
The lane algorithm is custom either way.
The shipped renderer is a bespoke SVG lane column beside HTML commit rows, virtualized with the already-installed `@tanstack/react-virtual`.
No new dependency is added.
Lane assignment runs on the full in-memory page returned by `/git/log`; virtualization windows rows but does not recompute lanes per window.
Cursor pagination across pages is out of scope because v1 loads at most 500 commits in one response.

Before writing production code, rerun the following short renderer checkpoint from the repository root:

```bash
rg -n "ReactFlow|Controls|MiniMap|panOnScroll|zoomOnScroll" \
  packages/web/src/components/workflows/WorkflowDagViewer.tsx
rg -n "useVirtualizer|role=\"listbox\"|aria-activedescendant" \
  packages/web/src/components/workflows/source-control/changed-files-list.tsx
rg -n '"@xyflow/react"|"@tanstack/react-virtual"' packages/web/package.json
git diff --exit-code -- packages/web/package.json bun.lock
```

Record these findings in the pull request's Review guidance: React Flow remains a pan/zoom DAG canvas with Controls and MiniMap; the Source Control list already supplies listbox focus and virtualization; either renderer still needs custom parent-lane assignment; and both candidate dependencies are already installed.
If all four findings remain true, proceed with the bespoke SVG design in Tasks 4 and 6.
If any finding has changed, stop before production edits and reopen OQ-1 because the renderer comparison is no longer current.

## Required Implementation Order

Run the renderer checkpoint above first, then execute Tasks 1 through 8 in numeric order.
Do not parallelize Tasks 1 through 3 because the server contract depends on the git type and generated web types depend on the live server schema.
Do not start Task 6 before Task 4 is green, and do not start Task 7 before Tasks 3, 5, and 6 are green.
Update sprint status only after every Task 8 gate passes.

## Open Questions

### OQ-1 — Renderer

The approved material leaves `@xyflow/react` versus bespoke SVG as a pre-build spike.
**Provisional default:** bespoke SVG as locked in Spike 3 Outcome above.

### OQ-2 — Log range and cap

The approved material says `git log` of the run branch with `%H %P` plus author/date/subject, but does not pin `--max-count` or `HEAD` versus `--all`.
**Provisional default:** read `HEAD` only, use `--date-order`, request 501 records, return the newest 500, and use the extra record only to compute `truncated`; this preserves run-branch commits, keeps parent-after-child ordering usable by the lane algorithm, and bounds the response.

### OQ-3 — Keyboard bindings

The accessibility floor requires History to be keyboard-operable and leaves exact keys open.
**Provisional default:** History is a listbox with `aria-activedescendant`; ArrowUp/ArrowDown move one row; Home/End jump; Enter/Space select the commit without opening files; Tab moves between the Changes listbox and the History listbox.

### OQ-4 — Relative time

DESIGN asks for message + author + relative time and does not specify the formatter.
**Provisional default:** a tested `formatCommitTime(iso, nowMs)` uses `Intl.RelativeTimeFormat('en', { numeric: 'auto' })` for absolute deltas under 30 days and an explicit UTC `Intl.DateTimeFormat` for older dates; do not call `formatStarted`, whose `ensureUtc` helper appends `Z` to valid `%aI` offset timestamps.

### OQ-5 — Left-pane height split

UX places Changes above History and leaves the height ratio open.
**Provisional default:** the live-checkout left pane is a column flex; Changes and History each get `flex-1 min-h-0` and scroll independently.

These provisional defaults are implementation directives for this plan and do not require the implementer to pause for answers.
The CAP-6 list envelope and shared stale action are not open questions: the plan follows the existing Changes envelope plus AD-6, FR-2, and AD-9.

---

### Task 1: Add the public `log` git read

**Files:**
- Create: `packages/git/src/git-log.ts`
- Create: `packages/git/src/git-log.test.ts`
- Modify: `packages/git/src/index.ts`
- Modify: the 31 exact mock-factory files in Step 4.

**Interfaces:**
- Consumes: `execFileAsync` and the existing `RepoPath`/`WorktreePath` brands.
- Produces: `parseGitLogZ(stdout: string): GitLogCommit[]`.
- Produces internally for focused tests: `gitLogResultFromStdout(stdout: string): GitLogResult`.
- Produces: `isEmptyHistoryError(error: unknown): boolean`.
- Produces: `log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult>`.
- Produces: `GIT_LOG_MAX_COMMITS`.

- [ ] **Step 1: Write the failing parser and real-git tests**

Create `packages/git/src/git-log.test.ts` with this complete content:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileAsync } from './exec';
import {
  GIT_LOG_MAX_COMMITS,
  gitLogResultFromStdout,
  isEmptyHistoryError,
  log,
  parseGitLogZ,
} from './git-log';
import { toWorktreePath } from './types';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const SHA256_OID = 'd'.repeat(64);
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function record(oid: string, parents: readonly string[], subject: string): string {
  return `${oid}\0${parents.join(' ')}\0Ada\0${'2026-09-06T18:09:18-07:00'}\0${subject}\0`;
}

describe('parseGitLogZ', () => {
  test('parses one commit with two parents', () => {
    const stdout = record(OID_C, [OID_A, OID_B], 'merge feature');

    expect(parseGitLogZ(stdout)).toEqual([
      {
        oid: OID_C,
        parents: [OID_A, OID_B],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18-07:00',
        subject: 'merge feature',
      },
    ]);
  });

  test('parses a root commit with empty parents', () => {
    const stdout = `${OID_A}\0\0Ada\0${'2026-09-06T18:09:18Z'}\0init\0`;

    expect(parseGitLogZ(stdout)).toEqual([
      {
        oid: OID_A,
        parents: [],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18Z',
        subject: 'init',
      },
    ]);
  });

  test('accepts full SHA-256 object names', () => {
    expect(parseGitLogZ(record(SHA256_OID, [], 'sha256 root'))[0]?.oid).toBe(SHA256_OID);
  });

  test('fails fast on incomplete, non-hex, and mixed-length object names', () => {
    expect(() => parseGitLogZ(`${OID_A}\0`)).toThrow('Malformed git log output');
    expect(() =>
      parseGitLogZ(`not-an-oid\0\0Ada\0${'2026-09-06T00:00:00Z'}\0x\0`)
    ).toThrow(
      'Malformed git log output'
    );
    expect(() => parseGitLogZ(record(SHA256_OID, [OID_A], 'mixed'))).toThrow(
      'Malformed git log output'
    );
  });
});

describe('gitLogResultFromStdout', () => {
  test('does not claim truncation when the repository has exactly 500 returned commits', () => {
    const stdout = Array.from({ length: GIT_LOG_MAX_COMMITS }, (_, index) => {
      const oid = index.toString(16).padStart(40, '0');
      return record(oid, [], `commit-${String(index)}`);
    }).join('');

    const result = gitLogResultFromStdout(stdout);

    expect(result.commits).toHaveLength(500);
    expect(result.truncated).toBe(false);
  });

  test('uses the 501st record only as a truncation sentinel', () => {
    const stdout = Array.from({ length: GIT_LOG_MAX_COMMITS + 1 }, (_, index) => {
      const oid = index.toString(16).padStart(40, '0');
      return record(oid, [], `commit-${String(index)}`);
    }).join('');

    const result = gitLogResultFromStdout(stdout);

    expect(result.commits).toHaveLength(500);
    expect(result.commits[499]?.subject).toBe('commit-499');
    expect(result.commits.some(commit => commit.subject === 'commit-500')).toBe(false);
    expect(result.truncated).toBe(true);
  });

  test('returns the stable empty-content fingerprint without claiming truncation', () => {
    expect(gitLogResultFromStdout('')).toEqual({
      commits: [],
      revision: EMPTY_SHA256,
      truncated: false,
    });
  });
});

describe('isEmptyHistoryError', () => {
  test('detects unborn and missing HEAD wording', () => {
    expect(
      isEmptyHistoryError(Object.assign(new Error('x'), { stderr: 'does not have any commits yet' }))
    ).toBe(true);
    expect(
      isEmptyHistoryError(
        Object.assign(new Error("ambiguous argument 'HEAD'"), { stderr: '' })
      )
    ).toBe(true);
    expect(
      isEmptyHistoryError(
        Object.assign(new Error('x'), { stderr: 'unknown revision or path not in the working tree' })
      )
    ).toBe(true);
    expect(isEmptyHistoryError(new Error('Permission denied'))).toBe(false);
  });
});

describe('log', () => {
  let root = '';
  let repoPath = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-log-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns an empty list for an unborn repository', async () => {
    const result = await log(toWorktreePath(repoPath));
    expect(result.commits).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  test('includes merge parents and commits that never landed on dev', async () => {
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'base']);
    await execFileAsync('git', ['-C', repoPath, 'branch', 'dev']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-b', 'feature']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'feature work']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'run work']);
    await execFileAsync('git', ['-C', repoPath, 'merge', 'feature', '-m', 'merge feature']);

    const result = await log(toWorktreePath(repoPath));
    const subjects = result.commits.map(commit => commit.subject);

    expect(subjects).toContain('merge feature');
    expect(subjects).toContain('feature work');
    expect(subjects).toContain('run work');
    expect(subjects).toContain('base');

    const merge = result.commits.find(commit => commit.subject === 'merge feature');
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.parents[0]).toMatch(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    expect(merge?.parents[1]).toMatch(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    expect(result.truncated).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);

    const { stdout: devOnly } = await execFileAsync('git', [
      '-C',
      repoPath,
      'log',
      '--format=%s',
      'dev',
    ]);
    expect(devOnly).toContain('base');
    expect(devOnly).not.toContain('run work');
    expect(devOnly).not.toContain('feature work');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/git/src/git-log.test.ts
```

Expected: FAIL because `./git-log` does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/git/src/git-log.ts` with this complete content:

```ts
import { createHash } from 'crypto';

import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export const GIT_LOG_MAX_COMMITS = 500;

const FULL_OID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface GitLogCommit {
  oid: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
}

export interface GitLogResult {
  commits: GitLogCommit[];
  revision: string;
  truncated: boolean;
}

function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const err = error as { message?: unknown; stderr?: unknown };
  return `${String(err.message ?? '')} ${String(err.stderr ?? '')}`;
}

export function isEmptyHistoryError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('does not have any commits yet') ||
    text.includes('unknown revision or path not in the working tree') ||
    text.includes("ambiguous argument 'HEAD'")
  );
}

export function parseGitLogZ(stdout: string): GitLogCommit[] {
  const records = stdout.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  if (records.length % 5 !== 0) throw new Error('Malformed git log output');

  const commits: GitLogCommit[] = [];
  for (let index = 0; index < records.length; index += 5) {
    const oid = records[index] ?? '';
    const parentsRaw = records[index + 1] ?? '';
    const authorName = records[index + 2] ?? '';
    const authorDate = records[index + 3] ?? '';
    const subject = records[index + 4] ?? '';
    if (!FULL_OID_RE.test(oid)) throw new Error('Malformed git log output');
    const parents = parentsRaw === '' ? [] : parentsRaw.split(' ').filter(Boolean);
    if (parents.some(parent => !FULL_OID_RE.test(parent) || parent.length !== oid.length)) {
      throw new Error('Malformed git log output');
    }
    commits.push({ oid, parents, authorName, authorDate, subject });
  }
  return commits;
}

export function gitLogResultFromStdout(stdout: string): GitLogResult {
  const parsed = parseGitLogZ(stdout);
  return {
    commits: parsed.slice(0, GIT_LOG_MAX_COMMITS),
    revision: createHash('sha256').update(stdout).digest('hex'),
    truncated: parsed.length > GIT_LOG_MAX_COMMITS,
  };
}

export async function log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult> {
  let stdout = '';
  try {
    const result = await execFileAsync(
      'git',
      [
        '-C',
        workingPath,
        '--no-optional-locks',
        'log',
        '--date-order',
        '--format=%H%x00%P%x00%an%x00%aI%x00%s',
        '-z',
        `--max-count=${String(GIT_LOG_MAX_COMMITS + 1)}`,
        'HEAD',
      ],
      { maxBuffer: 8 * 1024 * 1024 }
    );
    stdout = result.stdout;
  } catch (error) {
    if (!isEmptyHistoryError(error)) throw error;
    stdout = '';
  }

  return gitLogResultFromStdout(stdout);
}
```

In `packages/git/src/index.ts`, immediately after the changed-files type export block, add:

```ts
// Commit log (run-branch history)
export { GIT_LOG_MAX_COMMITS, log } from './git-log';
export type { GitLogCommit, GitLogResult } from './git-log';
```

- [ ] **Step 4: Stub `log` in every `@archon/git` mock factory**

Add this key to every factory below, keeping every existing key:

```ts
log: mock(async () => ({ commits: [], revision: '0'.repeat(64), truncated: false })),
```

Files:

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
19. `packages/server/src/routes/api.git-changes.test.ts`
20. `packages/server/src/routes/api.health.test.ts`
21. `packages/server/src/routes/api.messages.test.ts`
22. `packages/server/src/routes/api.provider-keys.test.ts`
23. `packages/server/src/routes/api.providers.test.ts`
24. `packages/server/src/routes/api.usage.test.ts`
25. `packages/server/src/routes/api.user-ai-prefs.test.ts`
26. `packages/server/src/routes/api.workflow-runs.test.ts`
27. `packages/workflows/src/executor-preamble.test.ts`
28. `packages/workflows/src/executor.test.ts`
29. `packages/workflows/src/runtime-check.test.ts`
30. `packages/workflows/src/script-node-deps.test.ts`
31. `packages/workflows/src/subrun.test.ts`

In `packages/server/src/routes/api.git-changes.test.ts`, use a named mock rather than the inline stub.

Add `GitLogResult` to the existing `@archon/git` type import, declare this next to `mockChangedFiles`, pass `log: mockLog` in the factory, reset it in `beforeEach`, and restore the default implementation after reset:

```ts
const mockLog = mock(
  async (_workingPath: string): Promise<GitLogResult> => ({
    commits: [],
    revision: REVISION,
    truncated: false,
  })
);

// In mock.module('@archon/git'):
log: mockLog,

// In beforeEach:
mockLog.mockReset();
mockLog.mockImplementation(
  async (): Promise<GitLogResult> => ({ commits: [], revision: REVISION, truncated: false })
);
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/git/src/git-log.test.ts
bun --filter @archon/git test
bun --filter @archon/git type-check
bun x prettier --write packages/git/src/git-log.ts packages/git/src/git-log.test.ts packages/git/src/index.ts
bun test packages/git/src/git-log.test.ts
bun --filter @archon/git type-check
```

Expected: all commands exit 0.

- [ ] **Step 6: Refactor only while green**

Keep the argv, parser, unborn mapping, and fingerprint identical.
Re-run `bun test packages/git/src/git-log.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/git/src/git-log.ts packages/git/src/git-log.test.ts packages/git/src/index.ts \
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
  packages/server/src/routes/api.git-changes.test.ts \
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
git commit -m "feat(git): walk run-branch commit log with parents"
```

---

### Task 2: Add `GET /api/workflows/runs/{runId}/git/log`

**Files:**
- Modify: `packages/server/src/routes/schemas/git.schemas.ts`
- Create: `packages/server/src/routes/git/log-route.ts`
- Create: `packages/server/src/routes/git/log-handler.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.git-changes.test.ts`

**Interfaces:**
- Consumes: `loadRunCheckout`, `log`, `toWorktreePath`.
- Produces: OpenAPI `GitLogResponse`.

- [ ] **Step 1: Write the failing HTTP tests**

Keep the configurable `mockLog` from Task 1 in `packages/server/src/routes/api.git-changes.test.ts` and add these helpers beside `expectFileLogPair`:

```ts
function gitLogCalls(): Array<{ payload: Record<string, unknown>; event: string }> {
  return [...mockLogger.info.mock.calls, ...mockLogger.error.mock.calls]
    .filter(
      (call): call is [Record<string, unknown>, string] =>
        typeof call[1] === 'string' && String(call[1]).startsWith('git.log_')
    )
    .map(([payload, event]) => ({ payload, event }));
}

function expectGitLogPair(
  terminal: 'git.log_completed' | 'git.log_failed',
  terminalPayload: Record<string, unknown>,
  runId = 'run-1'
): void {
  const events = gitLogCalls();
  expect(events).toEqual([
    { payload: { runId }, event: 'git.log_started' },
    { payload: terminalPayload, event: terminal },
  ]);
}
```

Append these tests in the same isolated process as the existing changes, diff, and file route tests:

```ts
test('git log returns 404 for a missing run', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(null);

  const response = await makeApp().request('/api/workflows/runs/missing/git/log');

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Workflow run not found' });
  expect(mockLog).not.toHaveBeenCalled();
  expectGitLogPair('git.log_failed', { runId: 'missing' }, 'missing');
});

test('git log returns container CAP-6 before any git probe', async () => {
  mockGetConversationById.mockResolvedValueOnce({ isolation_env_id: 'env-1' });
  mockGetById.mockResolvedValueOnce({ provider: 'container' });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'container',
    commits: [],
    revision: '',
    truncated: false,
  });
  expect(mockIsGitWorkTree).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
  expectGitLogPair('git.log_completed', { runId: 'run-1', emptyReason: 'container' });
});

test('git log returns no_checkout for a null working_path', async () => {
  mockGetWorkflowRun.mockResolvedValueOnce(runRow({ working_path: null }));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    commits: [],
    revision: '',
    truncated: false,
  });
  expect(mockLog).not.toHaveBeenCalled();
  expectGitLogPair('git.log_completed', { runId: 'run-1', emptyReason: 'no_checkout' });
});

test('git log serializes HEAD commits from the canonical checkout and ignores query paths', async () => {
  const canonical = await realpath(checkoutDir);
  const commit = {
    oid: 'a'.repeat(64),
    parents: ['b'.repeat(64)],
    authorName: 'Ada',
    authorDate: '2026-09-06T18:09:18Z',
    subject: 'run work',
  };
  mockLog.mockResolvedValueOnce({ commits: [commit], revision: REVISION, truncated: false });

  const response = await makeApp().request(
    '/api/workflows/runs/run-1/git/log?working_path=%2Ftmp%2Fhostile'
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    commits: [commit],
    revision: REVISION,
    truncated: false,
  });
  expect(mockLog).toHaveBeenCalledWith(canonical);
  expectGitLogPair('git.log_completed', { runId: 'run-1', commitCount: 1 });
});

test('git log returns an empty ready history rather than CAP-6 for an unborn repository', async () => {
  mockLog.mockResolvedValueOnce({ commits: [], revision: REVISION, truncated: false });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ commits: [], revision: REVISION, truncated: false });
  expectGitLogPair('git.log_completed', { runId: 'run-1', commitCount: 0 });
});

test('git log maps a post-gate git failure to an opaque 500 without logging paths', async () => {
  mockLog.mockRejectedValueOnce(new Error(`boom at ${checkoutDir}/secret`));

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body).toEqual({ error: 'Could not read git history' });
  expect(JSON.stringify(body)).not.toContain(checkoutDir);
  expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(checkoutDir);
  expectGitLogPair('git.log_failed', { runId: 'run-1', errorType: 'Error' });
});

test('git log returns CAP-6 when the checkout vanishes during the read', async () => {
  mockLog.mockImplementationOnce(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
    throw new Error(`boom at ${checkoutDir}/secret`);
  });

  const response = await makeApp().request('/api/workflows/runs/run-1/git/log');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    emptyReason: 'no_checkout',
    commits: [],
    revision: '',
    truncated: false,
  });
  expectGitLogPair('git.log_completed', { runId: 'run-1', emptyReason: 'no_checkout' });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bun test packages/server/src/routes/api.git-changes.test.ts
```

Expected: FAIL because `/git/log` is unregistered (Hono 404) or `mockLog` is unused.

- [ ] **Step 3: Implement schema, route, handler, and registration**

Append to `packages/server/src/routes/schemas/git.schemas.ts`:

```ts
const gitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

export const gitLogCommitSchema = z
  .object({
    oid: gitObjectIdSchema,
    parents: z.array(gitObjectIdSchema),
    authorName: z.string(),
    authorDate: z.string().datetime({ offset: true }),
    subject: z.string(),
  })
  .openapi('GitLogCommit');
export type GitLogCommit = z.infer<typeof gitLogCommitSchema>;

const gitReadyLogResponseSchema = z.object({
  commits: z.array(gitLogCommitSchema),
  revision: revisionSchema,
  truncated: z.boolean(),
});

const gitEmptyLogResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
  commits: z.array(gitLogCommitSchema).max(0),
  revision: z.literal(''),
  truncated: z.literal(false),
});

export const gitLogResponseSchema = z
  .union([gitReadyLogResponseSchema, gitEmptyLogResponseSchema])
  .openapi('GitLogResponse');
export type GitLogResponse = z.infer<typeof gitLogResponseSchema>;
```

Create `packages/server/src/routes/git/log-route.ts`:

```ts
import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitLogResponseSchema } from '../schemas/git.schemas';

export const gitLogRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/log',
  tags: ['Workflows'],
  summary: "List a run checkout's commit history",
  request: {
    params: z.object({ runId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitLogResponseSchema } },
      description: 'Commit log or a CAP-6 empty envelope',
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

Create `packages/server/src/routes/git/log-handler.ts` with this complete content:

```ts
import type { Context } from 'hono';

import { log, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { GitLogResponse } from '../schemas/git.schemas';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

function emptyLogResponse(emptyReason: 'container' | 'no_checkout'): GitLogResponse {
  return { emptyReason, commits: [], revision: '', truncated: false };
}

export async function handleGitLog(
  c: Context,
  apiError: (c: Context, status: 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.log_started');

  try {
    const gate = await loadRunCheckout(runId);

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.log_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.log_completed');
      return c.json(emptyLogResponse(gate.emptyReason));
    }

    try {
      const result = await log(toWorktreePath(gate.workingPath));
      const body: GitLogResponse = {
        commits: result.commits,
        revision: result.revision,
        truncated: result.truncated,
      };
      getLog().info({ runId, commitCount: result.commits.length }, 'git.log_completed');
      return c.json(body);
    } catch (error) {
      const recheck = await loadRunCheckout(runId);
      if (recheck.kind === 'empty') {
        getLog().info({ runId, emptyReason: recheck.emptyReason }, 'git.log_completed');
        return c.json(emptyLogResponse(recheck.emptyReason));
      }
      getLog().error(
        { runId, errorType: error instanceof Error ? error.name : typeof error },
        'git.log_failed'
      );
      return apiError(c, 500, 'Could not read git history');
    }
  } catch (error) {
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.log_failed'
    );
    return apiError(c, 500, 'Could not read git history');
  }
}
```

In `packages/server/src/routes/api.ts`, import `gitLogRoute` and `handleGitLog`.
Register immediately after the changes route:

```ts
  registerOpenApiRoute(gitLogRoute, async c => {
    return handleGitLog(c, apiError);
  });
```

Do not call `requireWebUser`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test packages/server/src/routes/api.git-changes.test.ts
bun --filter @archon/server type-check
bun x prettier --write packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/log-route.ts packages/server/src/routes/git/log-handler.ts \
  packages/server/src/routes/api.ts packages/server/src/routes/api.git-changes.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun --filter @archon/server type-check
```

Expected: all commands exit 0.

- [ ] **Step 5: Refactor only while green, then commit**

```bash
git add packages/server/src/routes/schemas/git.schemas.ts \
  packages/server/src/routes/git/log-route.ts \
  packages/server/src/routes/git/log-handler.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.git-changes.test.ts
git commit -m "feat(server): expose run git log"
```

---

### Task 3: Generate the web contract and add the log client

**Files:**
- Regenerate: `packages/web/src/lib/api.generated.d.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.git-changes.test.ts`

**Interfaces:**
- Consumes: generated `components['schemas']['GitLogResponse']`.
- Produces: `getWorkflowRunGitLog(runId: string, options?: { signal?: AbortSignal }): Promise<GitLogResponse>`.

- [ ] **Step 1: Write the failing client test**

Append to `packages/web/src/lib/api.git-changes.test.ts`:

```ts
describe('getWorkflowRunGitLog', () => {
  test('GETs the encoded run-scoped log URL without a checkout path', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          commits: [
            {
              oid: 'a'.repeat(40),
              parents: [],
              authorName: 'Ada',
              authorDate: '2026-09-06T18:09:18Z',
              subject: 'init',
            },
          ],
          revision: 'a'.repeat(64),
          truncated: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await getWorkflowRunGitLog('run/one');

    expect(response).toEqual({
      commits: [
        {
          oid: 'a'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'init',
        },
      ],
      revision: 'a'.repeat(64),
      truncated: false,
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('working_path');
  });

  test('forwards the exact AbortSignal in RequestInit', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ commits: [], revision: 'a'.repeat(64), truncated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const signal = new AbortController().signal;

    await getWorkflowRunGitLog('run/one', { signal });

    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log', { signal });
  });
});
```

Import `getWorkflowRunGitLog` from `./api`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/lib/api.git-changes.test.ts
```

Expected: FAIL because `getWorkflowRunGitLog` is not exported.

- [ ] **Step 3: Regenerate OpenAPI types from the implemented server**

Start the server on the generate-types port:

```bash
PORT=3090 bun run dev:server
```

After the server reports that port 3090 is listening, run:

```bash
bun --filter @archon/web generate:types
```

Stop only the server process started for this task.
Do not hand-edit `packages/web/src/lib/api.generated.d.ts`.
Read `packages/web/src/lib/api.generated.d.ts` and confirm it contains `/api/workflows/runs/{runId}/git/log` and `GitLogResponse`.

- [ ] **Step 4: Add the generated-type re-exports and client**

In `packages/web/src/lib/api.ts`, next to the other git types, add:

```ts
export type GitLogResponse = components['schemas']['GitLogResponse'];
export type GitLogCommit = components['schemas']['GitLogCommit'];
```

Add:

```ts
export async function getWorkflowRunGitLog(
  runId: string,
  options?: { signal?: AbortSignal }
): Promise<GitLogResponse> {
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/git/log`,
    options?.signal ? { signal: options.signal } : undefined
  );
}
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
bun test packages/web/src/lib/api.git-changes.test.ts
bun --filter @archon/web type-check
bun x prettier --write packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun --filter @archon/web type-check
```

Expected: all commands exit 0.

```bash
git add packages/web/src/lib/api.generated.d.ts packages/web/src/lib/api.ts packages/web/src/lib/api.git-changes.test.ts
git commit -m "feat(web): add run git log client"
```

---

### Task 4: Implement Spike 3 lane assignment

**Files:**
- Create: `packages/web/src/components/workflows/source-control/commit-lanes.ts`
- Create: `packages/web/src/components/workflows/source-control/commit-lanes.test.ts`

**Interfaces:**
- Consumes: `{ oid: string; parents: readonly string[] }`.
- Produces: `assignCommitLanes(commits): LaneGraph`.

The algorithm is newest-first (git log order).
Maintain `active: (string | null)[]` as the object name each lane is waiting to paint next.
For commit `C`:
1. Capture every incoming lane whose reservation equals `C.oid` and every through lane whose non-null reservation belongs to another commit.
2. Paint `C` on the smallest incoming lane, or reuse the first null lane, or append a lane when the commit starts inside the bounded page.
3. Clear all incoming reservations before placing parents.
4. For each parent in git `%P` order, connect to an existing reservation for that same parent when one exists.
5. Otherwise put the first parent on `C`'s lane when it is free, then reuse another null lane or append for later parents.
6. A root commit leaves no outgoing parent reservation.

Each row records `{ oid, lane, incomingLanes, throughLanes, parentLanes, isMerge }` so the renderer can draw top-to-node convergence, unrelated vertical through-lines, and node-to-bottom parent edges without guessing from post-row state.
`laneCount` is one more than the maximum lane index seen.

This is topology assignment, not one-lane-per-named-branch.
Lane assignment runs once on the full response before the virtualizer selects mounted rows.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/workflows/source-control/commit-lanes.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { assignCommitLanes } from './commit-lanes';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const E = 'e'.repeat(40);

describe('assignCommitLanes', () => {
  test('places a linear history on lane 0', () => {
    const graph = assignCommitLanes([
      { oid: C, parents: [B] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);

    expect(graph.rows).toEqual([
      {
        oid: C,
        lane: 0,
        incomingLanes: [],
        throughLanes: [],
        parentLanes: [0],
        isMerge: false,
      },
      {
        oid: B,
        lane: 0,
        incomingLanes: [0],
        throughLanes: [],
        parentLanes: [0],
        isMerge: false,
      },
      {
        oid: A,
        lane: 0,
        incomingLanes: [0],
        throughLanes: [],
        parentLanes: [],
        isMerge: false,
      },
    ]);
    expect(graph.laneCount).toBe(1);
  });

  test('draws merge fan-out, a through lane, and later convergence with literal lanes', () => {
    const graph = assignCommitLanes([
      { oid: D, parents: [C, B] },
      { oid: C, parents: [A] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);

    expect(graph).toEqual({
      laneCount: 2,
      rows: [
        {
          oid: D,
          lane: 0,
          incomingLanes: [],
          throughLanes: [],
          parentLanes: [0, 1],
          isMerge: true,
        },
        {
          oid: C,
          lane: 0,
          incomingLanes: [0],
          throughLanes: [1],
          parentLanes: [0],
          isMerge: false,
        },
        {
          oid: B,
          lane: 1,
          incomingLanes: [1],
          throughLanes: [0],
          parentLanes: [0],
          isMerge: false,
        },
        {
          oid: A,
          lane: 0,
          incomingLanes: [0],
          throughLanes: [],
          parentLanes: [],
          isMerge: false,
        },
      ],
    });
  });

  test('keeps an octopus merge on one row with three parent lanes', () => {
    const graph = assignCommitLanes([
      { oid: E, parents: [A, B, C] },
      { oid: A, parents: [] },
      { oid: B, parents: [] },
      { oid: C, parents: [] },
    ]);
    expect(graph.rows[0]).toEqual({
      oid: E,
      lane: 0,
      incomingLanes: [],
      throughLanes: [],
      parentLanes: [0, 1, 2],
      isMerge: true,
    });
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 1, 2]);
    expect(graph.laneCount).toBe(3);
  });

  test('returns an empty graph', () => {
    expect(assignCommitLanes([])).toEqual({ rows: [], laneCount: 0 });
  });

  test('keeps literal lane continuity when callers window the already-computed rows', () => {
    const full = assignCommitLanes([
      { oid: D, parents: [C, B] },
      { oid: C, parents: [A] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);

    expect(full.rows.slice(1, 3)).toEqual([
      {
        oid: C,
        lane: 0,
        incomingLanes: [0],
        throughLanes: [1],
        parentLanes: [0],
        isMerge: false,
      },
      {
        oid: B,
        lane: 1,
        incomingLanes: [1],
        throughLanes: [0],
        parentLanes: [0],
        isMerge: false,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
```

Expected: FAIL because `./commit-lanes` does not exist.

- [ ] **Step 3: Implement `assignCommitLanes`**

Create `packages/web/src/components/workflows/source-control/commit-lanes.ts`:

```ts
export interface LaneCommitInput {
  oid: string;
  parents: readonly string[];
}

export interface LaneRow {
  oid: string;
  lane: number;
  incomingLanes: number[];
  throughLanes: number[];
  parentLanes: number[];
  isMerge: boolean;
}

export interface LaneGraph {
  rows: LaneRow[];
  laneCount: number;
}

export function assignCommitLanes(commits: readonly LaneCommitInput[]): LaneGraph {
  const active: (string | null)[] = [];
  const rows: LaneRow[] = [];
  let laneCount = 0;

  for (const commit of commits) {
    const incomingLanes: number[] = [];
    const throughLanes: number[] = [];
    for (let index = 0; index < active.length; index += 1) {
      const reservation = active[index];
      if (reservation === commit.oid) incomingLanes.push(index);
      else if (reservation !== null && reservation !== undefined) throughLanes.push(index);
    }

    let lane: number;
    if (incomingLanes.length === 0) {
      const free = active.findIndex(value => value === null);
      lane = free === -1 ? active.length : free;
      if (lane === active.length) active.push(null);
    } else {
      lane = incomingLanes[0] ?? 0;
    }

    for (const incomingLane of incomingLanes) active[incomingLane] = null;

    const parentLanes: number[] = [];
    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parent = commit.parents[parentIndex];
      if (!parent) continue;

      let parentLane = active.findIndex(value => value === parent);
      if (parentLane === -1 && parentIndex === 0 && active[lane] === null) {
        parentLane = lane;
      }
      if (parentLane === -1) {
        parentLane = active.findIndex(value => value === null);
      }
      if (parentLane === -1) {
        parentLane = active.length;
        active.push(null);
      }
      active[parentLane] = parent;
      parentLanes.push(parentLane);
    }

    rows.push({
      oid: commit.oid,
      lane,
      incomingLanes,
      throughLanes,
      parentLanes,
      isMerge: commit.parents.length > 1,
    });
    laneCount = Math.max(laneCount, active.length, lane + 1);
  }

  return { rows, laneCount };
}
```

- [ ] **Step 4: Verify GREEN, refactor only while green, commit**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
bun --filter @archon/web type-check
bun x prettier --write packages/web/src/components/workflows/source-control/commit-lanes.ts \
  packages/web/src/components/workflows/source-control/commit-lanes.test.ts
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
bun --filter @archon/web type-check
```

Expected: all commands exit 0 and the literal lane expectations remain unchanged after formatting.

```bash
git add packages/web/src/components/workflows/source-control/commit-lanes.ts \
  packages/web/src/components/workflows/source-control/commit-lanes.test.ts
git commit -m "feat(web): assign source-control commit lanes"
```

---

### Task 5: Freeze History snapshots beside Changes

**Files:**
- Modify: `packages/web/src/components/workflows/source-control/source-control-state.ts`
- Modify: `packages/web/src/components/workflows/source-control/source-control-state.test.ts`

**Interfaces:**
- Consumes: `GitLogResponse`.
- Produces: `GitLogSnapshot`, `GitLogSnapshotState`, `INITIAL_GIT_LOG_STATE`, `toGitLogSnapshot`, and `gitLogSnapshotReducer`.
- Preserves: the existing `SourceControlSnapshot` names and behavior.

Keep the existing Changes reducer unchanged and add an explicit History reducer beside it.
The small transition logic is duplicated deliberately under the project's Rule of Three, and the two reducer instances in `SourceControlTab` ensure receiving History can never rewrite Changes.

- [ ] **Step 1: Write the failing History state tests**

Keep every existing Changes test in `packages/web/src/components/workflows/source-control/source-control-state.test.ts` and extend its import with `INITIAL_GIT_LOG_STATE`, `gitLogSnapshotReducer`, and `toGitLogSnapshot`.

Append:

```ts
describe('gitLogSnapshotReducer', () => {
  test('displays the first ready History snapshot', () => {
    const snapshot = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });

    const state = gitLogSnapshotReducer(INITIAL_GIT_LOG_STATE, {
      type: 'received',
      snapshot,
    });

    expect(state).toEqual({ displayed: snapshot, pending: null });
  });

  test('freezes displayed commits and stores a divergent log revision as pending', () => {
    const displayed = toGitLogSnapshot({
      commits: [
        {
          oid: 'a'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'old subject',
        },
      ],
      revision: REVISION_A,
      truncated: false,
    });
    const pending = toGitLogSnapshot({
      commits: [
        {
          oid: 'b'.repeat(40),
          parents: ['a'.repeat(40)],
          authorName: 'Grace',
          authorDate: '2026-09-06T19:09:18Z',
          subject: 'new subject',
        },
      ],
      revision: REVISION_B,
      truncated: false,
    });

    const state = gitLogSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: pending }
    );

    expect(state).toEqual({ displayed, pending });
  });

  test('clears pending History when a refetch matches the displayed revision', () => {
    const displayed = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });
    const pending = toGitLogSnapshot({ commits: [], revision: REVISION_B, truncated: false });

    const state = gitLogSnapshotReducer(
      { displayed, pending },
      { type: 'received', snapshot: displayed }
    );

    expect(state).toEqual({ displayed, pending: null });
  });

  test('distinguishes a ready empty History from CAP-6', () => {
    const displayed = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });
    const unavailable = toGitLogSnapshot({
      emptyReason: 'no_checkout',
      commits: [],
      revision: '',
      truncated: false,
    });

    const state = gitLogSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: unavailable }
    );

    expect(state).toEqual({ displayed, pending: unavailable });
  });

  test('applies pending History only after explicit acceptance', () => {
    const displayed = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });
    const pending = toGitLogSnapshot({
      emptyReason: 'container',
      commits: [],
      revision: '',
      truncated: false,
    });

    const state = gitLogSnapshotReducer({ displayed, pending }, { type: 'accept_pending' });

    expect(state).toEqual({ displayed: pending, pending: null });
  });
});
```

- [ ] **Step 2: Run the state tests and verify RED**

```bash
bun test packages/web/src/components/workflows/source-control/source-control-state.test.ts
```

Expected: FAIL because the History snapshot exports do not exist.

- [ ] **Step 3: Add the explicit History freeze state without changing Changes behavior**

Extend the `@/lib/api` type import with `GitLogCommit` and `GitLogResponse`.

Append this code after the existing `sourceControlSnapshotReducer`:

```ts
export type GitLogSnapshot =
  | {
      emptyReason?: never;
      commits: readonly GitLogCommit[];
      revision: string;
      truncated: boolean;
    }
  | {
      emptyReason: GitEmptyReason;
      commits: readonly [];
      revision: '';
      truncated: false;
    };

export interface GitLogSnapshotState {
  displayed: GitLogSnapshot | null;
  pending: GitLogSnapshot | null;
}

export type GitLogSnapshotAction =
  | { type: 'received'; snapshot: GitLogSnapshot }
  | { type: 'accept_pending' }
  | { type: 'reset' };

export const INITIAL_GIT_LOG_STATE: GitLogSnapshotState = {
  displayed: null,
  pending: null,
};

export function toGitLogSnapshot(response: GitLogResponse): GitLogSnapshot {
  if ('emptyReason' in response) {
    return {
      emptyReason: response.emptyReason,
      commits: [],
      revision: '',
      truncated: false,
    };
  }
  return {
    commits: response.commits,
    revision: response.revision,
    truncated: response.truncated,
  };
}

function gitLogFingerprint(snapshot: GitLogSnapshot): string {
  return snapshot.emptyReason === undefined
    ? `ready:${snapshot.revision}`
    : `empty:${snapshot.emptyReason}`;
}

export function gitLogSnapshotReducer(
  state: GitLogSnapshotState,
  action: GitLogSnapshotAction
): GitLogSnapshotState {
  if (action.type === 'reset') return INITIAL_GIT_LOG_STATE;

  if (action.type === 'accept_pending') {
    return state.pending ? { displayed: state.pending, pending: null } : state;
  }

  if (!state.displayed) {
    return { displayed: action.snapshot, pending: null };
  }

  if (gitLogFingerprint(state.displayed) === gitLogFingerprint(action.snapshot)) {
    return { displayed: state.displayed, pending: null };
  }

  return { displayed: state.displayed, pending: action.snapshot };
}
```

- [ ] **Step 4: Verify GREEN, refactor only while green, and commit**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/source-control-state.test.ts
bun --filter @archon/web type-check
bun x prettier --write packages/web/src/components/workflows/source-control/source-control-state.ts \
  packages/web/src/components/workflows/source-control/source-control-state.test.ts
bun test packages/web/src/components/workflows/source-control/source-control-state.test.ts
bun --filter @archon/web type-check
```

Expected: all commands exit 0 and all pre-existing Changes reducer tests still pass.

```bash
git add packages/web/src/components/workflows/source-control/source-control-state.ts \
  packages/web/src/components/workflows/source-control/source-control-state.test.ts
git commit -m "feat(web): freeze source-control history snapshots"
```

---

### Task 6: Render the lane graph widget

**Files:**
- Create: `packages/web/src/components/workflows/source-control/format-commit-time.ts`
- Create: `packages/web/src/components/workflows/source-control/format-commit-time.test.ts`
- Create: `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`
- Create: `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`
- Create: `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`

**Interfaces:**
- Consumes: `readonly GitLogCommit[]` and `assignCommitLanes`.
- Produces: `formatCommitTime(iso: string, nowMs: number): string`.
- Produces: `nextCommitIndex(key: string, currentIndex: number, commitCount: number): number`.
- Produces: `CommitHistoryGraph` as a virtualized History listbox with topology SVG in every mounted row.

Constants: `COMMIT_ROW_HEIGHT = 24`, `LANE_WIDTH = 12`.
Each row is `role="option"` with `id={`${idPrefix}-${index}`}`.
The listbox uses `aria-label="Commit history"` and `aria-activedescendant`.
Visible text is subject, authorName, `formatCommitTime`, and `oid.slice(0, 7)`.
The lane cell is inline SVG:
- width `laneCount * LANE_WIDTH`, height `COMMIT_ROW_HEIGHT`
- vertical through-lines for `throughLanes`, incoming top-to-node paths for `incomingLanes`, and node-to-bottom paths for `parentLanes`, all with `className="stroke-text-secondary"`, `strokeWidth="1.5"`, and no opacity
- ordinary commit: `circle` filled `fill-text-primary`
- merge commit: `polygon` diamond filled `fill-text-primary`
- `aria-hidden="true"` on the SVG because the option `aria-label` names merge vs ordinary
Option `aria-label` is `${isMerge ? 'Merge commit' : 'Commit'} ${shortOid}: ${subject}; ${authorName}; ${relativeTime}`.
Do not import `@xyflow/react`.
Virtualize with `useVirtualizer` estimate 24px, same 280px initial-rect fallback pattern as `changed-files-list.tsx`.
ArrowUp, ArrowDown, Home, and End move the active row; Enter and Space keep the current row selected without triggering any external action in Story 2.1.

`formatCommitTime(iso: string, nowMs: number): string` uses `Intl.RelativeTimeFormat('en', { numeric: 'auto' })` for absolute delta under 30 days and `Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })` otherwise.
Invalid input returns `Unknown time` rather than throwing during render.

- [ ] **Step 1: Write the failing formatter tests**

Create `packages/web/src/components/workflows/source-control/format-commit-time.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { formatCommitTime } from './format-commit-time';

const NOW = Date.parse('2026-09-06T12:00:00Z');

describe('formatCommitTime', () => {
  test('formats recent past and future commits with stable English relative units', () => {
    expect(formatCommitTime('2026-09-06T12:00:00Z', NOW)).toBe('now');
    expect(formatCommitTime('2026-09-06T11:58:30Z', NOW)).toBe('2 minutes ago');
    expect(formatCommitTime('2026-09-06T15:00:00Z', NOW)).toBe('in 3 hours');
    expect(formatCommitTime('2026-08-08T12:00:00Z', NOW)).toBe('29 days ago');
  });

  test('formats older offset timestamps as a deterministic UTC date', () => {
    expect(formatCommitTime('2026-07-01T23:30:00-07:00', NOW)).toBe('Jul 2, 2026');
  });

  test('returns quiet fallback copy for invalid input', () => {
    expect(formatCommitTime('not-a-date', NOW)).toBe('Unknown time');
  });
});
```

- [ ] **Step 2: Write the failing graph markup and navigation tests**

Create `packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { GitLogCommit } from '@/lib/api';

import { CommitHistoryGraph, nextCommitIndex } from './commit-history-graph';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const NOW = Date.parse('2026-09-06T20:00:00Z');

const COMMITS: readonly GitLogCommit[] = [
  {
    oid: D,
    parents: [C, B],
    authorName: 'Ada',
    authorDate: '2026-09-06T19:00:00Z',
    subject: 'merge feature',
  },
  {
    oid: C,
    parents: [A],
    authorName: 'Grace',
    authorDate: '2026-09-06T18:00:00Z',
    subject: 'run work',
  },
  {
    oid: B,
    parents: [A],
    authorName: 'Linus',
    authorDate: '2026-09-06T17:00:00Z',
    subject: 'feature work',
  },
  {
    oid: A,
    parents: [],
    authorName: 'Margaret',
    authorDate: '2026-09-06T16:00:00Z',
    subject: 'base',
  },
];

describe('CommitHistoryGraph', () => {
  test('renders accessible commit copy and merge topology rather than a flat subject list', () => {
    const html = renderToStaticMarkup(<CommitHistoryGraph commits={COMMITS} nowMs={NOW} />);

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Commit history"');
    expect(html).toContain('aria-activedescendant="sc-history-commit-0"');
    expect(html).toContain('merge feature');
    expect(html).toContain('Ada');
    expect(html).toContain('1 hour ago');
    expect(html).toContain(D.slice(0, 7));
    expect(html).toContain('<svg');
    expect(html).toContain('<polygon');
    expect(html).toContain('<circle');
    expect(html).toContain('data-edge="incoming"');
    expect(html).toContain('data-edge="through"');
    expect(html).toContain('data-edge="parent"');
    expect(html).toContain('stroke-text-secondary');
    expect(html).toContain('fill-text-primary');
    expect(html).not.toContain('opacity');
    expect(html).not.toContain('<ol');
  });

  test('marks ordinary and merge rows in their accessible names', () => {
    const html = renderToStaticMarkup(<CommitHistoryGraph commits={COMMITS} nowMs={NOW} />);

    expect(html).toContain(`aria-label="Merge commit ${D.slice(0, 7)}: merge feature; Ada; 1 hour ago"`);
    expect(html).toContain(`aria-label="Commit ${C.slice(0, 7)}: run work; Grace; 2 hours ago"`);
  });

  test('virtualizes a large already-laid-out page', () => {
    const commits: GitLogCommit[] = Array.from({ length: 200 }, (_, index) => {
      const oid = index.toString(16).padStart(40, '0');
      const parent = (index + 1).toString(16).padStart(40, '0');
      return {
        oid,
        parents: index === 199 ? [] : [parent],
        authorName: 'Ada',
        authorDate: '2026-09-06T19:00:00Z',
        subject: `commit-${String(index)}`,
      };
    });

    const html = renderToStaticMarkup(<CommitHistoryGraph commits={commits} nowMs={NOW} />);
    const renderedOptions = html.match(/role="option"/g) ?? [];

    expect(renderedOptions.length).toBeGreaterThan(0);
    expect(renderedOptions.length).toBeLessThan(commits.length);
    expect(html).toContain('height:4800px');
    expect(html).not.toContain('commit-199');
  });
});

describe('nextCommitIndex', () => {
  test('supports Arrow, Home, and End without moving for activation keys', () => {
    expect(nextCommitIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextCommitIndex('ArrowDown', 2, 3)).toBe(2);
    expect(nextCommitIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextCommitIndex('Home', 2, 3)).toBe(0);
    expect(nextCommitIndex('End', 0, 3)).toBe(2);
    expect(nextCommitIndex('Enter', 1, 3)).toBe(1);
  });
});
```

- [ ] **Step 3: Verify RED**

```bash
bun test packages/web/src/components/workflows/source-control/format-commit-time.test.ts
bun test packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
```

Expected: both commands FAIL because the production modules do not exist.

- [ ] **Step 4: Implement the deterministic time formatter**

Create `packages/web/src/components/workflows/source-control/format-commit-time.ts`:

```ts
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_LIMIT_MS = 30 * DAY_MS;

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const absoluteFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function roundedRelativeValue(deltaMs: number, unitMs: number): number {
  if (deltaMs === 0) return 0;
  return Math.sign(deltaMs) * Math.max(1, Math.round(Math.abs(deltaMs) / unitMs));
}

export function formatCommitTime(iso: string, nowMs: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'Unknown time';

  const deltaMs = timestamp - nowMs;
  const absoluteDelta = Math.abs(deltaMs);
  if (absoluteDelta >= RELATIVE_LIMIT_MS) {
    return absoluteFormatter.format(new Date(timestamp));
  }
  if (absoluteDelta < MINUTE_MS) {
    return relativeFormatter.format(roundedRelativeValue(deltaMs, SECOND_MS), 'second');
  }
  if (absoluteDelta < HOUR_MS) {
    return relativeFormatter.format(roundedRelativeValue(deltaMs, MINUTE_MS), 'minute');
  }
  if (absoluteDelta < DAY_MS) {
    return relativeFormatter.format(roundedRelativeValue(deltaMs, HOUR_MS), 'hour');
  }
  return relativeFormatter.format(roundedRelativeValue(deltaMs, DAY_MS), 'day');
}
```

- [ ] **Step 5: Implement one topology row**

Create `packages/web/src/components/workflows/source-control/commit-graph-row.tsx`:

```tsx
import type { PointerEvent, ReactElement } from 'react';

import type { GitLogCommit } from '@/lib/api';

import type { LaneRow } from './commit-lanes';
import { formatCommitTime } from './format-commit-time';

export const COMMIT_ROW_HEIGHT = 24;
export const LANE_WIDTH = 12;

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function edgePath(fromLane: number, fromY: number, toLane: number, toY: number): string {
  return `M ${String(laneX(fromLane))} ${String(fromY)} L ${String(laneX(toLane))} ${String(toY)}`;
}

export interface CommitGraphRowProps {
  commit: GitLogCommit;
  layout: LaneRow;
  laneCount: number;
  id: string;
  active: boolean;
  nowMs: number;
  onSelect: () => void;
}

export function CommitGraphRow(props: CommitGraphRowProps): ReactElement {
  const shortOid = props.commit.oid.slice(0, 7);
  const relativeTime = formatCommitTime(props.commit.authorDate, props.nowMs);
  const nodeX = laneX(props.layout.lane);
  const nodeY = COMMIT_ROW_HEIGHT / 2;
  const accessibleKind = props.layout.isMerge ? 'Merge commit' : 'Commit';

  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      id={props.id}
      aria-selected={props.active}
      aria-label={`${accessibleKind} ${shortOid}: ${props.commit.subject}; ${props.commit.authorName}; ${relativeTime}`}
      data-active={props.active ? 'true' : 'false'}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>): void => {
        event.preventDefault();
      }}
      onClick={props.onSelect}
      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-md px-2 text-left text-xs ${
        props.active ? 'bg-surface-elevated' : 'hover:bg-surface-hover'
      }`}
      style={{ height: COMMIT_ROW_HEIGHT }}
    >
      <svg
        aria-hidden="true"
        width={Math.max(LANE_WIDTH, props.laneCount * LANE_WIDTH)}
        height={COMMIT_ROW_HEIGHT}
        viewBox={`0 0 ${String(Math.max(LANE_WIDTH, props.laneCount * LANE_WIDTH))} ${String(COMMIT_ROW_HEIGHT)}`}
      >
        {props.layout.throughLanes.map(lane => (
          <line
            key={`through-${String(lane)}`}
            data-edge="through"
            x1={laneX(lane)}
            y1={0}
            x2={laneX(lane)}
            y2={COMMIT_ROW_HEIGHT}
            className="stroke-text-secondary"
            strokeWidth="1.5"
          />
        ))}
        {props.layout.incomingLanes.map(lane => (
          <path
            key={`incoming-${String(lane)}`}
            data-edge="incoming"
            d={edgePath(lane, 0, props.layout.lane, nodeY)}
            className="fill-none stroke-text-secondary"
            strokeWidth="1.5"
          />
        ))}
        {props.layout.parentLanes.map((lane, index) => (
          <path
            key={`parent-${String(index)}-${String(lane)}`}
            data-edge="parent"
            d={edgePath(props.layout.lane, nodeY, lane, COMMIT_ROW_HEIGHT)}
            className="fill-none stroke-text-secondary"
            strokeWidth="1.5"
          />
        ))}
        {props.layout.isMerge ? (
          <polygon
            points={`${String(nodeX)},${String(nodeY - 5)} ${String(nodeX + 5)},${String(nodeY)} ${String(nodeX)},${String(nodeY + 5)} ${String(nodeX - 5)},${String(nodeY)}`}
            className="fill-text-primary"
          />
        ) : (
          <circle cx={nodeX} cy={nodeY} r="4" className="fill-text-primary" />
        )}
      </svg>
      <span className="min-w-0 truncate text-text-primary" title={props.commit.subject}>
        {props.commit.subject}
      </span>
      <span className="max-w-24 truncate text-text-secondary" title={props.commit.authorName}>
        {props.commit.authorName}
      </span>
      <time dateTime={props.commit.authorDate} className="whitespace-nowrap text-text-secondary">
        {relativeTime}
      </time>
      <code className="font-mono text-text-secondary">{shortOid}</code>
    </button>
  );
}
```

- [ ] **Step 6: Implement the full-page layout plus virtualized listbox**

Create `packages/web/src/components/workflows/source-control/commit-history-graph.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { GitLogCommit } from '@/lib/api';

import { assignCommitLanes } from './commit-lanes';
import { CommitGraphRow, COMMIT_ROW_HEIGHT } from './commit-graph-row';

export function nextCommitIndex(key: string, currentIndex: number, commitCount: number): number {
  if (commitCount <= 0) return 0;
  if (key === 'ArrowDown') return Math.min(commitCount - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return commitCount - 1;
  return Math.min(commitCount - 1, Math.max(0, currentIndex));
}

export interface CommitHistoryGraphProps {
  commits: readonly GitLogCommit[];
  nowMs?: number;
  idPrefix?: string;
}

export function CommitHistoryGraph(props: CommitHistoryGraphProps): ReactElement {
  const idPrefix = props.idPrefix ?? 'sc-history-commit';
  const nowMs = props.nowMs ?? Date.now();
  const graph = useMemo(() => assignCommitLanes(props.commits), [props.commits]);
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex =
    props.commits.length === 0 ? 0 : Math.min(props.commits.length - 1, activeIndex);
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  const virtualizer = useVirtualizer({
    count: props.commits.length,
    getScrollElement: (): HTMLDivElement | null => parentRef.current,
    estimateSize: (): number => COMMIT_ROW_HEIGHT,
    initialRect: { width: 0, height: 280 },
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const mountedIndexes = new Set(virtualItems.map(item => item.index));
  const activeDescendant = mountedIndexes.has(clampedActiveIndex)
    ? `${idPrefix}-${String(clampedActiveIndex)}`
    : undefined;

  const activate = (index: number): void => {
    const commit = props.commits[index];
    if (!commit) return;
    setActiveIndex(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
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
      activate(clampedActiveIndex);
    }
  };

  return (
    <div
      ref={parentRef}
      role="listbox"
      aria-label="Commit history"
      aria-activedescendant={activeDescendant}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto p-2"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map(virtualItem => {
          const commit = props.commits[virtualItem.index];
          const layout = graph.rows[virtualItem.index];
          if (!commit || !layout) return null;
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${String(virtualItem.start)}px)`,
              }}
            >
              <CommitGraphRow
                commit={commit}
                layout={layout}
                laneCount={graph.laneCount}
                id={`${idPrefix}-${String(virtualItem.index)}`}
                active={virtualItem.index === clampedActiveIndex}
                nowMs={nowMs}
                onSelect={(): void => {
                  parentRef.current?.focus();
                  activate(virtualItem.index);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify GREEN, refactor only while green, and commit**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/format-commit-time.test.ts
bun test packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
bun --filter @archon/web type-check
bun x prettier --write packages/web/src/components/workflows/source-control/format-commit-time.ts \
  packages/web/src/components/workflows/source-control/format-commit-time.test.ts \
  packages/web/src/components/workflows/source-control/commit-graph-row.tsx \
  packages/web/src/components/workflows/source-control/commit-history-graph.tsx \
  packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
bun test packages/web/src/components/workflows/source-control/format-commit-time.test.ts
bun test packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
bun --filter @archon/web type-check
```

Expected: all commands exit 0 and the markup contains both actual topology edges and non-color shape/OID cues.

```bash
git add packages/web/src/components/workflows/source-control/format-commit-time.ts \
  packages/web/src/components/workflows/source-control/format-commit-time.test.ts \
  packages/web/src/components/workflows/source-control/commit-graph-row.tsx \
  packages/web/src/components/workflows/source-control/commit-history-graph.tsx \
  packages/web/src/components/workflows/source-control/commit-history-graph.test.tsx
git commit -m "feat(web): render source-control commit lane graph"
```

---

### Task 7: Insert History below Changes and fetch log on tab mount

**Files:**
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx`
- Modify: `packages/web/src/components/workflows/source-control/source-control-tab.tsx`
- Modify: `packages/web/src/component-integration/source-control-tab.test.tsx`

**Interfaces:**
- Panel gains `historySnapshot: GitLogSnapshot | null` and `historyLoadState: SourceControlLoadState`.
- A CAP-6 reason from either displayed snapshot is whole-tab; `container` takes precedence over `no_checkout`, and the early return omits the History heading.
- Ready checkout renders `h2` `Changes` then `h2` `History`.
- Ready empty history shows `No commits yet` (`role="status"`).
- History loading copy is `Loading history` / `Refreshing history`.
- History error keeps the displayed graph and shows `Could not refresh history.` plus an in-region `Reload` button.
- A truncated ready response shows `Showing the newest 500 commits.` immediately above the graph.
- Tab adds `useQuery({ queryKey: ['workflowRunGitLog', runId], queryFn: ({ signal }) => getWorkflowRunGitLog(runId, { signal }), retry: false, refetchInterval: false, refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Infinity })`.
- `onReload` refetches both queries concurrently and runs both snapshot reducers while preserving the selected-file candidate guard.
- Combined `stale` is true if either snapshot or the selected viewer has an acceptable pending replacement.
- Commit activation is internal selection state only in Story 2.1 and cannot call `getWorkflowRunGitDiff` or `getWorkflowRunGitFile`.
- Do not expand inline file lists.

- [ ] **Step 1: Write the failing panel contract tests**

In `renderPanel`, add ready History defaults so every pre-existing ready-checkout test exercises the two-region panel:

```tsx
      historySnapshot={{ commits: [], revision: 'a'.repeat(64), truncated: false }}
      historyLoadState="idle"
```

Rename the first test to `renders M/A/D, History, and no write chrome`, change its History assertion to `expect(html).toContain('History')`, and retain every Stage/Discard/Commit negative assertion.

Retain the existing CAP-6 tests and add `expect(html).not.toContain('History')` to both; their explicit `snapshot` overrides prove that either CAP-6 state replaces the whole panel despite the ready History default.

Append these tests:

```tsx
  test('distinguishes an empty repository from CAP-6', () => {
    const html = renderPanel({
      snapshot: { files: [], revision: 'a'.repeat(64) },
      historySnapshot: { commits: [], revision: 'a'.repeat(64), truncated: false },
    });

    expect(html).toContain('Changes');
    expect(html).toContain('History');
    expect(html).toContain('No commits yet');
    expect(html).not.toContain('No worktree available');
    expect(html).not.toContain('No files to show');
  });

  test('uses container precedence when History reports container CAP-6', () => {
    const html = renderPanel({
      snapshot: { files: [], revision: 'a'.repeat(64) },
      historySnapshot: {
        emptyReason: 'container',
        commits: [],
        revision: '',
        truncated: false,
      },
    });

    expect(html).toContain('No files to show');
    expect(html).not.toContain('History');
    expect(html).not.toContain('>Reload<');
  });

  test('keeps the previous graph and offers Reload after a History error', () => {
    const html = renderPanel({
      historySnapshot: {
        commits: [
          {
            oid: 'b'.repeat(40),
            parents: [],
            authorName: 'Ada',
            authorDate: '2026-09-06T18:09:18Z',
            subject: 'keep this commit',
          },
        ],
        revision: 'b'.repeat(64),
        truncated: false,
      },
      historyLoadState: 'error',
    });

    expect(html).toContain('keep this commit');
    expect(html).toContain('Could not refresh history.');
    expect(html).toContain('>Reload<');
  });

  test('announces the bounded newest window', () => {
    const html = renderPanel({
      historySnapshot: {
        commits: [
          {
            oid: 'b'.repeat(40),
            parents: [],
            authorName: 'Ada',
            authorDate: '2026-09-06T18:09:18Z',
            subject: 'bounded history',
          },
        ],
        revision: 'b'.repeat(64),
        truncated: true,
      },
    });

    expect(html).toContain('Showing the newest 500 commits.');
  });
```

- [ ] **Step 2: Run the panel tests and verify RED**

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
```

Expected: FAIL because `SourceControlPanel` has no History props or region.

- [ ] **Step 3: Replace the panel with the two-region implementation**

Replace `packages/web/src/components/workflows/source-control/source-control-panel.tsx` with:

```tsx
import { useEffect, useState, type ReactElement, type Ref } from 'react';

import type { GitChangedFile, GitEmptyReason } from '@/lib/api';

import { ChangedFilesList } from './changed-files-list';
import { CommitHistoryGraph } from './commit-history-graph';
import type { GitLogSnapshot, SourceControlSnapshot } from './source-control-state';

export { nextChangedFileIndex } from './changed-files-list';

export type SourceControlLoadState = 'idle' | 'loading' | 'error';

export interface SourceControlPanelProps {
  snapshot: SourceControlSnapshot | null;
  historySnapshot: GitLogSnapshot | null;
  loadState: SourceControlLoadState;
  historyLoadState: SourceControlLoadState;
  stale: boolean;
  onReload: () => void;
  onAcceptPending: () => void;
  onOpenFile?: (file: GitChangedFile) => void;
  selectedPath?: string | null;
  ariaLabel?: string;
  idPrefix?: string;
  listRef?: Ref<HTMLDivElement | null>;
}

function displayedEmptyReason(
  snapshot: SourceControlSnapshot | null,
  historySnapshot: GitLogSnapshot | null
): GitEmptyReason | undefined {
  const reasons = [snapshot?.emptyReason, historySnapshot?.emptyReason];
  if (reasons.includes('container')) return 'container';
  return reasons.find(reason => reason === 'no_checkout');
}

export function SourceControlPanel(props: SourceControlPanelProps): ReactElement {
  const files = props.snapshot?.files ?? [];
  const commits = props.historySnapshot?.commits ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex = files.length === 0 ? 0 : Math.min(files.length - 1, activeIndex);
  const emptyReason = displayedEmptyReason(props.snapshot, props.historySnapshot);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  if (emptyReason === 'container') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No files to show</h2>
        <p className="text-sm">
          This run executed inside a container — its working files aren't on the host to read.
        </p>
      </div>
    );
  }

  if (emptyReason === 'no_checkout') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No worktree available</h2>
        <p className="text-sm">
          This run's checkout isn't available or readable right now — it may not be ready yet, or it
          may have been cleaned up.
        </p>
        {props.loadState === 'error' || props.historyLoadState === 'error' ? (
          <p className="text-xs">Could not refresh source control.</p>
        ) : null}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section aria-labelledby="source-control-changes-heading" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
          <h2 id="source-control-changes-heading" className="text-sm font-medium text-text-primary">
            Changes
          </h2>
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
          <ChangedFilesList
            files={files}
            activeIndex={clampedActiveIndex}
            onActiveIndexChange={(index: number): void => {
              setActiveIndex(index);
            }}
            selectedPath={props.selectedPath}
            onOpenFile={props.onOpenFile}
            ariaLabel={props.ariaLabel}
            idPrefix={props.idPrefix}
            listRef={props.listRef}
          />
        ) : null}
      </section>

      <section aria-labelledby="source-control-history-heading" className="flex min-h-0 flex-1 flex-col border-t border-border">
        <h2
          id="source-control-history-heading"
          className="border-b border-border px-4 py-1.5 text-sm font-medium text-text-primary"
        >
          History
        </h2>

        {props.historyLoadState === 'loading' ? (
          <p role="status" className="px-4 py-3 text-sm text-text-secondary">
            {props.historySnapshot ? 'Refreshing history' : 'Loading history'}
          </p>
        ) : null}

        {props.historyLoadState === 'error' ? (
          <div role="status" className="flex items-center gap-2 px-4 py-2 text-xs text-text-secondary">
            <span>Could not refresh history.</span>
            <button type="button" onClick={props.onReload} className="text-primary hover:text-accent-bright">
              Reload
            </button>
          </div>
        ) : null}

        {props.historySnapshot?.truncated ? (
          <p role="status" className="px-4 py-1 text-xs text-text-secondary">
            Showing the newest 500 commits.
          </p>
        ) : null}

        {props.historySnapshot && commits.length === 0 ? (
          <p role="status" className="px-4 py-3 text-sm text-text-secondary">
            No commits yet
          </p>
        ) : null}

        {commits.length > 0 ? <CommitHistoryGraph commits={commits} /> : null}
      </section>
    </div>
  );
}
```

The two `section` elements split the available height and each list retains its own overflow container.

- [ ] **Step 4: Verify the panel test is GREEN**

```bash
bun test packages/web/src/components/workflows/source-control/source-control-panel.test.tsx
```

Expected: exit 0 with existing Changes behavior preserved and the new History assertions passing.

- [ ] **Step 5: Make mounted-test routing URL-aware and write failing integration tests**

Extend the API type import with `GitLogCommit` and `GitLogResponse`, then add:

```ts
const EMPTY_GIT_LOG: GitLogResponse = {
  commits: [],
  revision: REVISION_A,
  truncated: false,
};

const HISTORY_COMMIT: GitLogCommit = {
  oid: '1'.repeat(40),
  parents: [],
  authorName: 'Ada',
  authorDate: '2026-09-06T18:09:18Z',
  subject: 'initial history subject',
};
```

Replace `mockFetchResponses` with this URL-aware version so its existing three callers keep a stable empty History response:

```ts
function mockFetchResponses(responses: readonly GitChangesResponse[]): Mock<typeof fetch> {
  let changesIndex = 0;
  return spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/git/log')) return jsonResponse(EMPTY_GIT_LOG);
    if (!url.includes('/git/changes')) throw new Error(`Unexpected fetch: ${url}`);
    const payload = responses[changesIndex];
    if (!payload) throw new Error(`Unexpected changes fetch ${String(changesIndex + 1)}`);
    changesIndex += 1;
    return jsonResponse(payload);
  }) as typeof fetch);
}
```

Add an optional `onLog` callback to the `mockGitRoutes` options type:

```ts
  onLog?: (
    call: number,
    init?: RequestInit
  ) => GitLogResponse | Response | Promise<GitLogResponse | Response>;
```

Add `let logCall = 0` beside the other counters and insert this branch before `/git/changes`:

```ts
    if (url.includes('/git/log')) {
      logCall += 1;
      const result = options.onLog ? await options.onLog(logCall, init) : EMPTY_GIT_LOG;
      return result instanceof Response ? result : jsonResponse(result);
    }
```

Change `requireListbox` to `host.querySelector('[role="listbox"][aria-label="Uncommitted changes"]')` so adding a second listbox cannot redirect existing file-navigation tests.

Pass `historySnapshot: EMPTY_GIT_LOG`, `historyLoadState: 'idle'` to both direct `SourceControlPanel` renders in this file.

Update the initial-mount test to expect two fetches and these exact URLs, each with an `AbortSignal`:

```ts
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/changes', {
      signal: expect.any(AbortSignal),
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fone/git/log', {
      signal: expect.any(AbortSignal),
    });
    expect(calledUrls(fetchSpy).every(url => !url.includes('working_path'))).toBe(true);
```

After its extra event-loop turn, retain `expect(fetchSpy).toHaveBeenCalledTimes(2)` to prove neither query polls.

Change the divergent-snapshot test's final fetch count from 2 to 4 because both endpoints run on mount and Reload.

Change both call-count assertions in the offline/focus/reconnect test from 1 to 2, wait for both `Could not refresh changes.` and `Could not refresh history.`, and retain the focus/online toggles to prove neither query retries or implicitly refetches.

Where any existing test compares a complete URL sequence, filter `/git/log` from that legacy file-viewer assertion so the assertion remains scoped to Changes/Diff/File ordering.

Append these integration tests:

```tsx
  test('shows a region-empty History for a ready repository with zero commits', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: () => EMPTY_GIT_LOG,
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('No commits yet'), 'empty History');

    expect(host.textContent).toContain('Changes');
    expect(host.textContent).toContain('History');
    expect(host.textContent).not.toContain('No worktree available');
  });

  test('treats container CAP-6 from either read as a whole-tab state', async () => {
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: () => ({
        emptyReason: 'container',
        commits: [],
        revision: '',
        truncated: false,
      }),
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes('No files to show'), 'container CAP-6');

    expect(host.textContent).not.toContain('History');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === 'Reload')).toBe(false);
  });

  test('operates History from the keyboard without opening a diff or file in Story 2.1', async () => {
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
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes(HISTORY_COMMIT.subject), 'commit row');
    const history = host.querySelector('[role="listbox"][aria-label="Commit history"]');
    if (!(history instanceof HTMLElement)) throw new Error('Missing History listbox');
    expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-0');

    await act(async () => {
      history.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(history.getAttribute('aria-activedescendant')).toBe('sc-history-commit-1');
    expect(host.querySelector('#sc-history-commit-1')?.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      history.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/diff'))).toEqual([]);
    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/file/'))).toEqual([]);
  });

  test('freezes a divergent History until the shared stale action is accepted', async () => {
    const changedCommit = { ...HISTORY_COMMIT, oid: '2'.repeat(40), subject: 'changed history subject' };
    fetchSpy = mockGitRoutes({
      onChanges: () => ({ files: [], revision: REVISION_A }),
      onLog: call =>
        call === 1
          ? { commits: [HISTORY_COMMIT], revision: REVISION_A, truncated: false }
          : { commits: [changedCommit], revision: REVISION_B, truncated: false },
    });

    await renderTab('run-1');
    await waitFor(() => host.textContent?.includes(HISTORY_COMMIT.subject), 'initial History');
    await act(async () => {
      requireButton('Reload').click();
    });
    await waitFor(
      () => host.textContent?.includes('Changed on disk — Reload'),
      'History divergence affordance'
    );

    expect(host.textContent).toContain(HISTORY_COMMIT.subject);
    expect(host.textContent).not.toContain(changedCommit.subject);

    await act(async () => {
      requireButton('Changed on disk — Reload').click();
    });
    await waitFor(() => host.textContent?.includes(changedCommit.subject), 'accepted History');

    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/changes'))).toHaveLength(2);
    expect(calledUrls(fetchSpy).filter(url => url.includes('/git/log'))).toHaveLength(2);
  });
```

- [ ] **Step 6: Run the mounted test and verify RED**

```bash
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: FAIL because the tab does not fetch or render History.

- [ ] **Step 7: Wire the independent History query into `SourceControlTab`**

Add `getWorkflowRunGitLog` to the `@/lib/api` value imports.

Extend the state imports with `INITIAL_GIT_LOG_STATE`, `gitLogSnapshotReducer`, `toGitLogSnapshot`, and `type GitLogSnapshotState`.

Immediately after the existing Changes reducer, create the independent History reducer:

```ts
  const [historySnapshotState, dispatchHistory] = useReducer(
    gitLogSnapshotReducer,
    INITIAL_GIT_LOG_STATE
  );
```

Add a ref beside `snapshotRef` so callbacks always see the current History freeze state:

```ts
  const historySnapshotRef = useRef<GitLogSnapshotState>(historySnapshotState);
  historySnapshotRef.current = historySnapshotState;
```

Immediately after the Changes query, add:

```ts
  const {
    data: historyData,
    isError: historyIsError,
    isFetching: historyIsFetching,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['workflowRunGitLog', runId],
    queryFn: ({ signal }) => getWorkflowRunGitLog(runId, { signal }),
    retry: false,
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
```

In `abortCurrent`, cancel the log query for the same run before clearing `pendingListRequestRef`:

```ts
      void queryClient.cancelQueries({
        queryKey: ['workflowRunGitLog', pendingListRequest.runId],
        exact: true,
      });
```

In the run-ID reset effect, add `dispatchHistory({ type: 'reset' })` immediately after the existing `dispatch({ type: 'reset' })`.

After the existing initial Changes-data effect, add:

```ts
  useEffect(() => {
    if (!historyData) return;
    if (historySnapshotState.displayed !== null) return;
    dispatchHistory({ type: 'received', snapshot: toGitLogSnapshot(historyData) });
  }, [historyData, historySnapshotState.displayed]);
```

At the start of the `onReload` async body, replace `const result = await refetch()` with:

```ts
        const [result, historyResult] = await Promise.all([refetch(), refetchHistory()]);
        if (!isCurrent(id, signal)) return;
        if (historyResult.isSuccess && historyResult.data !== undefined) {
          dispatchHistory({
            type: 'received',
            snapshot: toGitLogSnapshot(historyResult.data),
          });
        }
```

Keep the following Changes success guard, candidate-file load, fingerprint comparison, and `finally` block unchanged, except remove its now-duplicate first `isCurrent` guard.

Add `refetchHistory` to the `onReload` dependency array.

In `onAcceptPending`, add these declarations after `pendingList`:

```ts
    const pendingHistory = historySnapshotRef.current.pending;
    const acceptedHistory = pendingHistory ?? historySnapshotRef.current.displayed;
```

After accepting `pendingList`, add:

```ts
    if (pendingHistory) dispatchHistory({ type: 'accept_pending' });
```

Extend the viewer-closing guard to include `acceptedHistory?.emptyReason !== undefined`:

```ts
    if (
      !acceptedList ||
      acceptedList.emptyReason !== undefined ||
      acceptedHistory?.emptyReason !== undefined ||
      !acceptedFile
    ) {
```

Replace the load-state and stale calculations immediately before `return` with:

```ts
  const loadState: SourceControlLoadState = isError ? 'error' : isFetching ? 'loading' : 'idle';
  const historyLoadState: SourceControlLoadState = historyIsError
    ? 'error'
    : historyIsFetching
      ? 'loading'
      : 'idle';
  const pendingListFile = snapshotState.pending
    ? selectedFileInSnapshot(snapshotState.pending, selectedFile)
    : undefined;
  const pendingListNeedsViewer =
    snapshotState.pending?.emptyReason === undefined &&
    snapshotState.pending !== null &&
    selectedFile !== null &&
    pendingListFile !== undefined;
  const changesCanBeAccepted =
    snapshotState.pending === null ||
    !pendingListNeedsViewer ||
    pendingViewerMatchesFile(pendingViewer, pendingListFile);
  const hasPending =
    snapshotState.pending !== null ||
    historySnapshotState.pending !== null ||
    pendingViewer !== null;
  const stale = hasPending && changesCanBeAccepted;
```

Pass both new panel props beside `snapshot` and `loadState`:

```tsx
            historySnapshot={historySnapshotState.displayed}
            historyLoadState={historyLoadState}
```

- [ ] **Step 8: Verify GREEN, refactor only while green, and commit**

Run:

```bash
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
bun --filter @archon/web type-check
bun x prettier --write packages/web/src/components/workflows/source-control/source-control-panel.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.test.tsx \
  packages/web/src/components/workflows/source-control/source-control-tab.tsx \
  packages/web/src/component-integration/source-control-tab.test.tsx
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
bun --filter @archon/web type-check
```

Expected: all commands exit 0 with no React `act` warnings and all pre-existing selected-file reload tests still pass.

Keep `file-viewer.test.tsx`'s `not.toContain('History')` assertion; the viewer still has no History chrome.

```bash
git add packages/web/src/components/workflows/source-control/source-control-panel.tsx \
  packages/web/src/components/workflows/source-control/source-control-panel.test.tsx \
  packages/web/src/components/workflows/source-control/source-control-tab.tsx \
  packages/web/src/component-integration/source-control-tab.test.tsx
git commit -m "feat(web): show run commit history as a lane graph"
```

---

### Task 8: Run acceptance gates and update sprint status

**Files:**
- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

- [ ] **Step 1: Run every focused test in its intended process**

```bash
bun test packages/git/src/git-log.test.ts
bun test packages/web/src/components/workflows/source-control/commit-lanes.test.ts
bun test packages/server/src/routes/api.git-changes.test.ts
bun test packages/web/src/lib/api.git-changes.test.ts
bun test packages/web/src/components/workflows/source-control/
NODE_ENV=development bun test packages/web/src/component-integration/source-control-tab.test.tsx
```

Expected: every command exits 0 with no test failures or React act warnings.

- [ ] **Step 2: Run affected package suites**

```bash
bun --filter @archon/git test
bun --filter @archon/server test
bun --filter @archon/web test
```

Expected: all package scripts exit 0.
The server git tests and the mounted web test must appear as their own Bun invocations in the script output.

- [ ] **Step 3: Verify formatting and run the mandatory repository gate**

```bash
bun run format:check
git diff --check
bun run validate
```

Expected: all three commands exit 0.

- [ ] **Step 4: Confirm the acceptance matrix**

| Criterion | Automated or inspection proof |
| --- | --- |
| History region below Changes on a live checkout | panel tests |
| No History region on CAP-6 | panel tests |
| Not a plain chronological list | graph tests require SVG incoming/through/parent edges, circle/diamond nodes, and commit copy |
| `log` records include ordered `parents[]` | literal parser tests, real merge repository, and HTTP serialization |
| Commits not merged to `dev` appear | real-repository git-log test |
| SHA-1 and SHA-256 object formats are accepted without mixing lengths | parser and schema tests plus generated client types |
| Keyboard-operable History | `nextCommitIndex` unit test plus mounted ArrowDown/Enter listbox test |
| Lanes not color-only and use ≥3:1 token strokes | diamond vs circle plus visible short OID; graph test requires `stroke-text-secondary` / `fill-text-primary` and forbids opacity |
| `No commits yet` is a region empty | panel test |
| CAP-6 HTTP 200 on `/git/log` for container and no_checkout | HTTP tests |
| No history-is-immutable exemption | container test never calls `log` |
| `log` lives in `@archon/git` via `execFileAsync` | git-log implementation and real-git test |
| Exactly 500 commits are not falsely marked truncated; a 501st record is sentinel-only | `gitLogResultFromStdout` tests and truncation notice panel test |
| JSON uses `registerOpenApiRoute`; web types from `api.generated.d.ts` | route registration and generated-file presence |
| Client sends encoded `runId` only | API client test |
| Activating a commit does not open files | mounted keyboard test asserts no Diff/File URL |
| Manual Reload still freezes the open view | mounted stale test |
| No write chrome | panel test |
| Console untouched | scoped diff contains no `packages/web/src/experiments/console/` file |
| No new dependency | `bun.lock` / `package.json` unmodified |

- [ ] **Step 5: Perform a legacy-screen smoke check**

Run:

```bash
bun run dev
```

Open `/legacy/workflows/runs/:id` for an existing DAG run, select Source Control, and confirm Changes remains on top, History is a lane graph rather than a naked list, an empty repo would show `No commits yet`, and clicking a commit does not open the viewer.
Stop only the dev processes started for this check.
If no DAG run exists in the local database, record that the automated suites are the acceptance evidence; do not fabricate a run or broaden this story.

- [ ] **Step 6: Update sprint status only after Steps 1 through 5 pass**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change only:

```yaml
  epic-2: in-progress
  2-1-walk-this-runs-commit-history-as-a-lane-graph: done
```

Keep `2-2-open-a-commits-files-in-the-same-viewer` at `backlog`.
Keep `last_updated: 2026-09-06`.

- [ ] **Step 7: Commit the tracker update**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "chore(sc): mark commit-history lane graph story done"
```

## Out of Scope

- Story 2.2 per-commit `M`/`A`/`D` lists, inline expand under a commit row, `parent → commit` diffs, and commit OIDs on `/git/diff` or `/git/file`.
- CAP-8 durable snapshot writing.
- Container overlay reads.
- Secret redaction.
- Cursor-paginated history beyond the 500-commit cap.
- `@xyflow/react` History renderer.
- Sequential non-DAG run tabs.

## Pull Request Handoff

Before opening a pull request, rerun `bun run validate` and use `.github/pull_request_template.md`.
Keep Problem and outcome, Review guidance, Solution, and Validation.
Include focused RED/GREEN evidence, the full validation result, the manual smoke result or its explicit no-local-run limitation, and `Closes #78`.
Do not write `N/A` sections and do not close the issue outside the PR workflow.
