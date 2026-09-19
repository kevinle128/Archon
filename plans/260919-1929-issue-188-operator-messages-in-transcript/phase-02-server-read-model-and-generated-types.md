---
phase: 2
title: 'Server read model and generated types'
status: pending
priority: P1
effort: '0.5 session'
dependencies: [1]
---

# Phase 2: server read model and generated types

## Goal

Project a read-time `operator_display_name` onto operator text rows in both
transcript read routes — resolved from `users.display_name` with a short-id
fallback, batched once per request, never persisted — and regenerate the web's
OpenAPI types so Phase 3 can type against `metadata.origin`,
`metadata.operator_user_id`, and `operator_display_name`.

## Scout before executing

Re-anchor these before editing (Phase 1 does not touch the server, so drift
should be nil, but confirm):

- `toWorkflowNodeMessageResponse(row, truncateOutput)` and `nodeMessageMetadata`
  in `packages/server/src/routes/api.ts` (currently `:5827-5885`).
- The list handler (`:5888-5939`) with its compatibility (`!cursorMode`) and
  cursor branches, and the detail handler (`:5941-5964`).
- `userDb.getUserById` usage precedent at `api.ts:6020-6021`
  (`starter?.display_name?.trim() || run.user_id`).
- Wire schemas `workflowNodeMessageTextResponseSchema` family in
  `packages/server/src/routes/schemas/workflow.schemas.ts:193-209`.
- The `@archon/core/db/users` mock factory in
  `packages/server/src/routes/api.workflow-runs.test.ts:709-725`
  (`mockGetUserById` returns `null | MockUserRow`).
- The messages-route `describe` at `:2922` and its `beforeEach`; the detail
  route tests that follow `:3170`.

## Files

| File | Action |
|------|--------|
| `packages/server/src/routes/operator-display-name.ts` | New pure module: `shortOperatorId`, `operatorDisplayName`, `resolveOperatorDisplayNames`. |
| `packages/server/src/routes/operator-display-name.test.ts` | Unit tests for the three functions (no `mock.module`). |
| `packages/server/package.json` | Append `src/routes/operator-display-name.test.ts` to the existing `bun test src/routes/workflow-execution-history.test.ts` invocation. |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | Add `operator_display_name` to the text-row wire schema. |
| `packages/server/src/routes/api.ts` | Resolve names once per request; thread the resolver through `toWorkflowNodeMessageResponse` in list (both modes) and detail. |
| `packages/server/src/routes/api.workflow-runs.test.ts` | Route tests for projection, fallback, null identity, batching, and non-operator rows unchanged. |
| `packages/web/src/lib/api.generated.d.ts` | Regenerate from the running worktree server; never hand-edit. |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` | One paragraph after line 78: the read-side `operator_display_name` projection and its fallback. |

Do not add a new export to `@archon/core/db/users` — a new batch export would
silently un-mock in tests whose factory omits it (AGENTS.md mock-merge rule).
`getUserById` is exposed by the `api.workflow-runs.test.ts` factory, which is
the only file exercising the transcript routes. Note for later work: the
`@archon/core/db/users` factories in `api.auth.test.ts:55`,
`api.provider-keys.test.ts:47`, `api.user-ai-prefs.test.ts:45`, and
`api.workflow-envs.test.ts:219` do **not** expose `getUserById`; none of their
routes call it today, so this plan leaves them alone, but any future route in
those files that does must add it.

## TDD sequence

### Step 1 — pure helpers (red → green)

`operator-display-name.test.ts`:

- `shortOperatorId returns the first 8 characters and leaves shorter ids intact`.
- `operatorDisplayName prefers a trimmed non-empty display name` — `'  Dale '`
  → `'Dale'`.
- `operatorDisplayName falls back to the short id on null user, null name, or blank name`.
- `resolveOperatorDisplayNames looks each distinct operator id up once` — five
  rows across two ids → `getUserById` called twice; rows without `origin`
  or with `operator_user_id: null` never trigger a lookup; returns a
  `Map<string, string>`.
- `resolveOperatorDisplayNames falls back per id when the lookup rejects` — a
  rejected `getUserById` yields the short id for that id only, the error is
  not rethrown (the transcript must still render), and one
  `server.operator_display_name_lookup_failed` warn is logged with
  `{ operatorUserId, error: err.message, errorType, err }` and nothing else
  (spy on the module logger as the existing route tests do).

Then implement `operator-display-name.ts`:

```ts
import type { NodeMessage } from '@archon/workflows/schemas/node-message';

/** First 8 characters — enough to tell two operators apart, never a raw id. */
export function shortOperatorId(userId: string): string {
  return userId.slice(0, 8);
}

export function operatorDisplayName(
  user: { display_name: string | null } | null,
  userId: string
): string {
  return user?.display_name?.trim() || shortOperatorId(userId);
}

/**
 * One lookup per distinct operator id on the page. A failed lookup is an
 * intentional, safe fallback to the short id — the transcript must still
 * render — but it is logged (`server.operator_display_name_lookup_failed`,
 * identity + error fields only) so a broken users table is never invisible.
 */
export async function resolveOperatorDisplayNames(
  rows: readonly NodeMessage[],
  getUserById: (id: string) => Promise<{ display_name: string | null } | null>
): Promise<Map<string, string>> { … }
```

Import `NodeMessage` from the same subpath `api.ts` already uses for it.

### Step 2 — wire schema + route tests (red)

`workflow.schemas.ts`:

```ts
export const workflowNodeMessageTextResponseSchema = nodeMessageTextSchema
  .omit({ workflow_run_id: true, node_id: true })
  .safeExtend({
    ...nodeMessageWireShape,
    /** Read-time projection for `metadata.origin === 'operator'` rows (#188); never stored. */
    operator_display_name: z.string().optional(),
  });
```

(Keep whatever `.omit` the current definition uses — copy it, do not
re-derive.)

Route tests in the messages `describe`, after
`no-query response is exactly { messages } with row metadata and no paging keys`:

- `projects operator_display_name from the users table onto operator text rows`
  — `mockGetUserById` returns `{ display_name: 'Dale' }` for `user-a`; a page
  with an operator row (`metadata: { origin: 'operator', operator_user_id: 'user-a', message_id: '<uuid>' }`),
  a plain assistant text row, and a tool row → only the operator row carries
  `operator_display_name: 'Dale'`; assistant and tool rows are deep-equal to
  today's shape; `metadata` on the operator row is echoed unchanged.
- `falls back to the short user id when the user has no display name` —
  `mockGetUserById` → `{ display_name: '   ' }` for `'0123456789abcdef'` →
  `operator_display_name: '01234567'`; a `null` user gives the same.
- `omits operator_display_name when operator_user_id is null` — no lookup,
  no key.
- `resolves each distinct operator once per page in cursor mode` — three
  operator rows over two ids with `?afterSeq=0&limit=10` →
  `mockGetUserById` called exactly twice; paging keys unchanged.
- In the detail-route block: `projects operator_display_name on a single operator row`.
- `leaves the 500 path free of transcript payload` still passes (no change,
  but re-run).

### Step 3 — route implementation (green)

In `api.ts`:

1. `import { resolveOperatorDisplayNames, operatorDisplayName } from './operator-display-name';`
2. Change the signature to
   `toWorkflowNodeMessageResponse(row, truncateOutput, operatorNames: ReadonlyMap<string, string>)`.
   In the `row.kind === 'text'` branch:

   ```ts
   const operatorUserId = row.metadata?.origin === 'operator' ? row.metadata.operator_user_id : undefined;
   const displayName = typeof operatorUserId === 'string' ? operatorNames.get(operatorUserId) : undefined;
   return {
     id, seq, kind, payload, created_at: createdAt,
     ...nodeMessageMetadata(row.metadata),
     ...(displayName !== undefined ? { operator_display_name: displayName } : {}),
   };
   ```

3. In the list handler, one resolver call **per branch**, each over the array
   that branch maps: the compatibility branch resolves over `rows` and passes
   the map to `rows.map(row => toWorkflowNodeMessageResponse(row, false, operatorNames))`;
   the cursor branch resolves over `page` (never `rows`, so the `limit + 1`
   overflow row triggers no lookup) and passes it to
   `page.map(row => toWorkflowNodeMessageResponse(row, true, operatorNames))`.
   Do not resolve once over `rows` and share it.
4. In the detail handler: `await resolveOperatorDisplayNames([row], userDb.getUserById)`.

`userDb` is already imported in `api.ts` (used at `:6020`).

### Step 4 — regenerate web types

The script in `packages/web/package.json` targets port 3090; a worktree server
binds a hashed port (`packages/core/src/utils/port-allocation.ts`), so run the
generator against the port the server logs:

```bash
bun run dev:server            # note the logged port, e.g. 3412; keep the PID
bunx --cwd packages/web openapi-typescript http://localhost:<port>/api/openapi.json \
  -o packages/web/src/lib/api.generated.d.ts
kill <pid>                    # stop only the server you started
git diff --stat packages/web/src/lib/api.generated.d.ts
```

Expected diff: `origin` and `operator_user_id` inside every
`WorkflowNodeMessage` metadata block, and `operator_display_name?: string` on
the text variant only. Any other hunk means the server was not this worktree's
build — stop and check the port.

### Step 5 — contract note

Append to `steering-api-contract.md` after the "No route is a delivery
vehicle" bullet: the executor-written row shape (`kind: text`,
`metadata.origin = 'operator'`, `operator_user_id`, `message_id`), the
read-time `operator_display_name` (display name → first-8-chars fallback →
absent when identity-less), and that the value is never persisted.

## Verification

```bash
cd packages/server
bun test src/routes/operator-display-name.test.ts
bun test src/routes/api.workflow-runs.test.ts
cd ../.. && bun run type-check && bun run lint
```

## Success criteria

- [ ] Five helper tests and five route tests green.
- [ ] Non-operator rows in the list and detail responses are byte-identical to
      the pre-change fixtures (existing tests untouched and green).
- [ ] `api.generated.d.ts` diff contains only the three expected additions.
- [ ] Contract doc updated; no new export in `@archon/core/db/users`.

## Risks and rollback

Read-only projection; removing the resolver call and the optional wire key
restores the previous responses exactly. The generated types file is
regenerated, not edited, so rollback is a regen against the previous server.
