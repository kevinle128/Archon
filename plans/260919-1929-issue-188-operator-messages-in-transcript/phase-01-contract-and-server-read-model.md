---
phase: 1
title: 'Contract and server read model'
status: pending
priority: P1
dependencies: []
---

# Phase 1: contract and server read model

## Goal

Widen the strict stored metadata contract and the existing transcript read API
before any live writer is enabled. Enrich operator rows from the canonical
users table with bounded database work, preserve every non-operator response,
regenerate the web types, and reconcile the stale durable docs.

## Evidence anchors

- `packages/workflows/src/schemas/node-execution.ts`: strict transcript
  metadata; `message_id` already exists.
- `packages/core/src/db/users.ts` and `users.test.ts`: current single-user
  lookup and cross-dialect `$N` query adapter.
- `packages/server/src/routes/api.ts`: `nodeMessageMetadata`,
  `toWorkflowNodeMessageResponse`, the compatibility/cursor list branches,
  and the detail route.
- `packages/server/src/routes/schemas/workflow.schemas.ts`: the three response
  variants; only text may carry the derived name.
- `packages/server/src/routes/api.workflow-runs.test.ts`: transcript route
  tests and the isolated `@archon/core/db/users`/logger factories.
- Story 2.8, live-steering architecture AD-12, `steering-test-plan.md`, and
  `steering-api-contract.md` for the conflict recorded in the parent plan.

## Files

| File                                                                                                                    | Change                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/workflows/src/schemas/node-execution.ts`                                                                      | Add optional literal `origin` and nullable optional `operator_user_id`. |
| `packages/workflows/src/schemas/node-execution.test.ts`                                                                 | Prove valid operator metadata, null identity, and strict rejection.     |
| `packages/core/src/db/users.ts`                                                                                         | Add a deduplicated, chunked display-name batch lookup.                  |
| `packages/core/src/db/users.test.ts`                                                                                    | Prove empty, deduplicated, parameterized, and >500-id behavior.         |
| `packages/server/src/routes/schemas/workflow.schemas.ts`                                                                | Add nullable optional `operator_display_name` to text responses only.   |
| `packages/server/src/routes/api.ts`                                                                                     | Build and apply the read-time projection in list/detail routes.         |
| `packages/server/src/routes/api.workflow-runs.test.ts`                                                                  | Add the batch mock and route contract/failure tests.                    |
| `packages/web/src/lib/api.generated.d.ts`                                                                               | Regenerate; never hand-edit.                                            |
| `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` | Amend AD-12 so the server owns the short-id fallback.                   |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`                                                         | Make the projection assertion match Story 2.8.                          |
| `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`                                                      | Document stored vs derived row fields and null identity.                |

No SQL schema, migration, transcript-store, send-route, or new server helper
module is needed.

## Implementation sequence

### 1. Lock the strict metadata shape

Write schema tests first:

- the existing `message_id` plus `origin: 'operator'` and a non-null sender
  parse together;
- an explicit null sender parses;
- an unsupported origin such as `assistant` fails;
- an unknown sibling key still fails, proving `.strict()` was not weakened.

Then add:

```ts
origin: z.literal('operator').optional(),
operator_user_id: z.string().min(1).nullable().optional(),
```

Do not make the keys conditionally dependent in the global schema: historical
and other message writers legitimately omit them. The executor tests in Phase
3 prove that a newly written operator receipt always emits the complete triple.

### 2. Add one cross-dialect batch query

Add a narrow exported helper in `users.ts`, for example:

```ts
export async function getUserDisplayNamesByIds(
  ids: readonly string[]
): Promise<Array<Pick<User, 'id' | 'display_name'>>>;
```

Required behavior:

- deduplicate input ids while preserving no meaningful output ordering;
- return `[]` without querying for an empty input;
- select only `id, display_name` from `remote_agent_users` with positional
  parameters, never interpolate ids;
- split distinct ids into sequential chunks of at most 500 and concatenate the
  rows. A cursor page needs at most one query; the legacy unpaged route remains
  safe for arbitrarily many historical senders.

Tests assert the exact SQL/parameters for one chunk, duplicate ids create one
placeholder, and 501 distinct ids produce two bounded queries. Do not add a
cache: names are deliberately current at read time and the route poll already
defines request frequency.

### 3. Define the wire projection and route behavior

Extend only `workflowNodeMessageTextResponseSchema` with:

```ts
operator_display_name: z.string().nullable().optional(),
```

Keep projection helpers local to `api.ts`; this is one route concern, not a new
module boundary. For the array that will actually be returned:

1. select rows whose kind is `text`, origin is `operator`, and sender is a
   non-null string;
2. deduplicate sender ids and call `getUserDisplayNamesByIds` once;
3. index returned rows by id;
4. for every operator text response, attach either the trimmed non-blank name,
   `senderId.slice(0, 8)`, or `null` for identity-less rows;
5. omit the field entirely on all non-operator rows.

Apply it independently to:

- all `rows` in compatibility mode;
- `page` in cursor mode, after removing the `limit + 1` overflow row, so the
  hidden row causes no lookup; and
- the one detail row.

If the batch helper rejects, catch it at the read-model boundary, log one
`workflow_node_operator_names_lookup_failed` warning with
`runId`, `nodeId`, distinct sender count, and `errorType`, then build the same
map entirely from short ids. Do not log the error message, message payload,
display name, or raw set of sender ids. Transcript retrieval must still return 200.

In `api.workflow-runs.test.ts`:

- add `mockGetUserDisplayNamesByIds` to the existing users module factory;
- expose a named `mockApiLogWarn` beside `mockApiLogError`;
- reset both in the transcript-route `beforeEach`;
- cover display name trimming, blank/missing-user fallback, null identity,
  non-operator omission, two ids/three rows in one batch, cursor overflow
  exclusion, detail projection, and query rejection with one safe warning;
- retain deep equality for existing assistant/tool/status fixtures and paging
  keys.

Other server test files mock the users module in separate Bun invocations and
do not execute these routes; do not edit them speculatively. The full server
test script will prove that assumption.

### 4. Reconcile durable documentation

Make the smallest amendments:

- AD-12: for a non-null sender, the server emits current display name or short
  id; `null` is reserved for an identity-less row. The web has no user fetch.
- steering test plan: assert server fallback rather than `null` on join miss.
- API contract: distinguish the stored strict metadata triple from the
  response-only nullable `operator_display_name`, and repeat that the executor,
  not the route, writes the row.

Do not copy implementation detail such as chunk size into product docs unless
the existing section is explicitly operational; the code/tests own that.

### 5. Regenerate the OpenAPI declaration

Start only this worktree's server after checking its deterministic port. Track
the command, PID, port, and worktree; stop it cleanly immediately after
generation. Use the package script if it is on 3090, otherwise invoke the same
`openapi-typescript` command against the logged worktree port.

The generated diff must contain only contract-derived changes: `origin` and
`operator_user_id` in transcript metadata and nullable optional
`operator_display_name` on the text row. Unexpected unrelated churn means the
wrong server or stale source generated it; discard that generated hunk and fix
the process, not the declaration by hand.

## Focused verification

```bash
cd packages/workflows && bun test src/schemas/node-execution.test.ts
cd ../core && bun test src/db/users.test.ts
cd ../server && bun test src/routes/api.workflow-runs.test.ts
cd ../.. && bun run type-check && bun run lint --max-warnings 0
```

Also run `bun --filter @archon/server test` before finishing this phase because
the users module is mocked in multiple isolated route suites.

## Exit criteria

- The strict schema accepts only the intended additive keys.
- The core helper is parameterized, deduplicated, and bounded for both DB
  dialects.
- Compatibility list, cursor list, and detail all obey the same projection
  contract without N+1 reads.
- Lookup failure keeps the API readable and logs no operator content.
- Generated types and the three durable docs agree with Story 2.8.
- No executor code writes the new metadata yet.

## Rollback note

At this phase there are no new rows, so all changes are safely reversible.
Once Phase 3 writes rows, retain the widened metadata parser even if the
projection is disabled; see the parent plan's downgrade boundary.
