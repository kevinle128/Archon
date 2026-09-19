---
title: 'Issue 188: show operator messages in the node transcript'
description: 'Verified implementation plan for durable operator-guidance rows, server-side sender projection, and distinct rendering in both node-room shells.'
status: ready
priority: P1
effort: '4 phases'
issue: 'https://github.com/kevinle128/Archon/issues/188'
branch: archon/thread-74969958
tags: [issue-188, agent-node-room, workflows, core, server, web, e2e]
blockedBy: []
blocks: []
created: 2026-09-20
revised: 2026-09-20
---

# Issue 188: show operator messages in the node transcript

## Outcome

When queued or `Send now` guidance actually becomes the next provider turn,
the permanent node transcript must show each delivered message as the
operator's own words. In both Legacy and Console, a later reader must see this
order:

1. the agent turn the guidance followed, or the tool call marked
   `interrupted`;
2. one attributed operator row per delivered message, in registry receipt
   order; and
3. the agent turn caused by that guidance.

Each row remains an ordinary stored `text` row. Its strict metadata carries
`origin: 'operator'`, the nullable acting `operator_user_id`, and the existing
caller-stamped `message_id`. The API derives the current display label without
persisting it or requiring another client request. Both shells render the
message as plain, full-strength operator prose with a permanent `sent` status.

This is the need described by issue #188 and Story 2.8. The current product
delivers guidance to the provider but records only the resulting agent output,
so the audit trail loses who steered the agent and what they said.

## Verified authority and conflict resolution

The plan was checked against the repository at `873495f6`, not against the
previous draft's assertions.

Authority, in order:

1. Issue #188 names Story 2.8 in
   `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` as its
   acceptance authority. Story 2.8 was updated after the older architecture
   wording and requires the **server** to fall back to a short user id when the
   display-name join fails.
2. The final UI authority is
   `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md`
   (`status: final`, updated 2026-09-19), together with `EXPERIENCE.md` and the
   canonical `mockups/key-steering-dock.html`. The high-fidelity handoff in
   `claude-design/design_handoff_node_room_transcript_steering/` was also
   checked; its README explicitly says `DESIGN.md` wins on disagreement.
3. The live-steering architecture and engine/API companions establish the
   storage and ownership invariants: the executor is the sole writer; the row
   is `kind: text`; exactly the three metadata fields identify an operator
   receipt; no route writes it; no migration or new row kind is introduced.

Two older statements conflict with Story 2.8:

- live-steering `ARCHITECTURE-SPINE.md` AD-12 says a failed join yields `null`
  and the web core derives the short id;
- `steering-test-plan.md` repeats that behavior.

The later Story 2.8 requirement wins: for a non-null `operator_user_id`, the
server response always contains either the trimmed current display name or the
first eight id characters. The web keeps the same short-id derivation only as
a compatibility guard for an older/partial response; it performs no user
fetch. An identity-less row (`operator_user_id: null`) projects
`operator_display_name: null` and renders the bare `operator` label. Phase 1
updates the stale architecture and test-plan wording so the repository has one
contract.

No unresolved design conflict remains and there is no implementation blocker.

## Current behavior traced end to end

- `sendWorkflowNodeBodySchema` accepts a non-blank message without trimming it
  and a UUID `message_id`. The send route puts that exact text, id, and
  `resolveAuthContext(...).userId ?? null` into `QueuedOperatorMessage`.
- `SteeringHandle` owns FIFO receipt order. The direct and loop executors drain
  the batch at a natural boundary or after `Send now`, join the text with the
  existing double newline, and start another turn on the same provider
  session. They discard the per-message id and sender at the join.
- `workflow_node_messages` is immutable and assigns per-node `seq` in the
  executor's store. Its JSON metadata is parsed through the strict
  `nodeTranscriptMetadataSchema`; the existing `message_id` key is already
  available, but `origin` and `operator_user_id` are not.
- The direct and loop `turns:` heads already rotate to a new transcript
  `attempt_id` for a guidance turn. Provider output for that turn is recorded
  only after the rotation.
- The transcript list route has an unpaged compatibility branch and a cursor
  branch (`limit <= 500`, fetched as `limit + 1`), plus a detail route. All map
  rows through `toWorkflowNodeMessageResponse`; none currently joins users.
- `buildAgentHistory` currently maps every projected text row to `assistant`.
  Both shells have a three-way assistant/tool/lifecycle renderer; their
  current assistant treatment is also behind the final design contract
  (literal uppercase DOM text, primary rather than secondary prose, and the
  wrong size).
- Existing Playwright journeys already exercise natural drain and
  Stop-to-`Send now` in both shells. The natural-drain spec currently asserts
  that standalone operator rows do **not** exist; that inverse assertion must
  be replaced.

## Scope

Included:

- add the two missing optional keys to the strict transcript metadata schema
  and reuse the existing `message_id`;
- add a bounded batch user-display lookup in `@archon/core` and enrich operator
  text rows in the existing list and detail responses;
- regenerate `packages/web/src/lib/api.generated.d.ts` from the changed
  OpenAPI schema;
- add a render-neutral `operator` history item before any executor can emit a
  live operator row;
- render the exact final operator/assistant treatments in both node-room
  shells, including narrow and wide visual acceptance;
- carry drained message objects to the caused turn and append one operator row
  per message from both direct and loop execution paths;
- update focused unit, route, component, and existing outside-in Playwright
  coverage, then update the Story 2.8 tracker and durable contract docs.

Excluded:

- `delivered` state or provider acknowledgement before gate G1;
- terminal `NEVER SENT` reconciliation (Story 2.11);
- queue collaboration/attribution UI (Stories 2.9/2.13) beyond preserving the
  already-defined FIFO sender data;
- changes to send, queue, withdraw, interrupt, registry semantics, or provider
  interfaces;
- SSE or another transcript transport; the existing poll discovers the rows;
- a new table, column, migration, row kind, endpoint, user-fetching client, or
  shared cross-shell component abstraction.

## Design and technical decisions

### 1. Stored row contract

`nodeTranscriptMetadataSchema` remains strict and gains:

```ts
origin: z.literal('operator').optional(),
operator_user_id: z.string().min(1).nullable().optional(),
```

`message_id` stays the existing `z.string().min(1).optional()` because other
writers may use non-UUID provider ids; the steering route already validates
its own ids as UUIDs. Every newly written operator row contains all three
fields, with `operator_user_id: null` present explicitly when the route had no
acting identity. A literal is sufficient for the only accepted origin; no
future-origin abstraction is added.

The row is:

```text
kind: text
payload: { text: <verbatim queued message> }
metadata: {
  execution: <caused turn scope>,
  origin: operator,
  operator_user_id: <uuid or null>,
  message_id: <caller UUID>
}
```

It has no `stream_id`, `block_id`, or `text_mode`, so the existing text
projector treats it as one complete block and cannot coalesce it with adjacent
assistant deltas.

### 2. Server-owned display projection, with bounded database work

The response-only field is
`operator_display_name?: string | null` on the text response variant:

- non-null sender + non-blank current `users.display_name` -> trimmed name;
- non-null sender + missing user, blank name, or lookup failure -> the first
  eight characters of `operator_user_id`;
- null sender -> explicit `null`;
- non-operator row -> field omitted, preserving the existing wire shape.

The value is never added to stored metadata. The server collects distinct
non-null sender ids for only the rows it will return, calls one core helper,
and maps the results. The helper deduplicates and queries `id, display_name`
with parameterized `IN` lists in chunks of at most 500, so the unbounded legacy
list cannot exceed SQLite parameter limits and cursor pages remain one query.
There is no per-row/N+1 lookup. A batch failure fails open to short ids and
logs one payload-free warning containing run/node context, sender count, and
error type—not message text or display names.

### 3. One functional history kind, two exact shell renderers

`buildAgentHistory` branches on `kind === 'text'` and
`metadata.origin === 'operator'` before the assistant branch. The new item
carries the verbatim text, nullable sender, projected display value, nullable
message id for later reconciliation, execution scope, and literal
`delivery: 'sent'`. It never passes through `presentedText`, Markdown, todo
folding, or tool pairing. A defensive short-id fallback handles responses
from a server that supplies the sender id but not the derived field; it makes
no request.

Both local shell renderers follow the final design and canonical mockup:

- role line: inherited mono, 10px, tracking `0.07em`, text-secondary, lowercase
  DOM source under CSS uppercase, with `10px 2px 3px` margins;
- content: inherited sans, 12.5px, line-height 1.55, normal weight,
  text-primary, plain `white-space: pre-wrap`, safe wrapping, and
  `0 2px 6px` margins;
- `sent`: 11px, text-secondary, lowercase, right-aligned on the same role
  line; no border, pill, dot, or success color;
- label source: `operator · <projected name>` when available, otherwise
  `operator`; React escaping applies to both the name and message;
- assistant anatomy is corrected in the same two renderers to the paired
  final treatment: lowercase DOM `assistant`, the same 10px role line, and
  12.5px/1.55 text-secondary prose. This second non-color channel is required
  for the operator row not to look like agent output.

`data-operator-row`, `data-operator-label`, `data-operator-delivery`, and
`data-operator-body` provide stable behavioral targets, not styling hooks.
Console's existing visibility fallthrough already keeps the new kind visible;
no filter change is needed.

### 4. Executor placement and ordering

The four drain sites retain `readonly QueuedOperatorMessage[]` rather than
immediately discarding their metadata into a string. At the next `turns:`
head, and only when `turnIsGuidance` is true, the executor rotates scope and
derives the unchanged prompt. It then carries a pending receipt context into
the first provider pass:

1. rotate to `newTranscriptAttempt`;
2. derive the provider prompt using the unchanged `message.join('\n\n')` rule;
3. register/start the existing provider stream; and
4. when that stream first yields—or completes normally without a chunk—append
   each operator row sequentially under the rotated scope before processing
   any provider chunk into the transcript.

This places the row after the settled/interrupted prior turn and before any
row from the caused turn, while an `attemptId`-filtered read keeps cause and
effect together. It also avoids claiming a delivered receipt when a provider
generator fails during startup before producing or normally completing a
stream. The append happens once on the guidance turn's first pass, so re-asks
cannot duplicate it. Direct nodes, loop nodes, and loop-group bodies all use
the same writer; the latter already pass a namespaced `stepName` through the
direct path.

The shared helper awaits the existing fail-open `appendNodeTranscript` once
per message. A failed audit append neither changes the provider prompt nor
fails the node, and later messages are still attempted. This is consistent
with current transcript reliability, while tests make the loss observable.

### 5. Reader-before-writer delivery order

The read contract and both renderers are implemented and tested before the
executor begins writing operator rows. All changes ship in one release unit;
the phase order is also the safe commit/cherry-pick order. The server/UI must
not be deployed as a writer-only subset because an old web reader maps an
operator text row to assistant prose.

## Phases

| #   | Phase                                                                                   | Depends on |
| --- | --------------------------------------------------------------------------------------- | ---------- |
| 1   | [Contract and server read model](./phase-01-contract-and-server-read-model.md)          | —          |
| 2   | [Web read model and both shell renderers](./phase-02-web-read-model-and-both-shells.md) | 1          |
| 3   | [Executor persistence and ordering](./phase-03-executor-persistence.md)                 | 1, 2       |
| 4   | [Integration, rollout, and closeout](./phase-04-integration-rollout-and-closeout.md)    | 1–3        |

## Acceptance criteria

- [ ] Every message in a delivered FIFO batch produces exactly one ordinary
      `text` row with verbatim text and the complete operator metadata triple;
      an undrained/discarded message produces no row.
- [ ] `seq` orders operator rows after the prior agent/interrupted row and
      before the caused agent row on direct natural drain, direct redirect,
      loop natural drain, loop redirect, and a namespaced loop-group body.
- [ ] Operator rows use the caused turn's attempt and existing occurrence; a
      re-ask does not write them again; provider prompt bytes remain unchanged.
- [ ] Null and multiple acting identities retain correct per-message
      attribution and FIFO order.
- [ ] An operator-row append failure is payload-safe and fail-open: remaining
      rows are attempted and the complete guidance prompt still runs.
- [ ] List compatibility mode, cursor mode, and detail responses enrich only
      operator text rows. Non-null ids always receive a trimmed display name
      or eight-character fallback; null ids receive `null`; all other rows
      retain their prior response shape.
- [ ] Display lookup is deduplicated and chunk-bounded, does not look up the
      cursor overflow row, and falls back without leaking transcript content
      when the users query fails.
- [ ] `buildAgentHistory` creates a distinct operator item with verbatim text,
      `messageId`, sender, execution scope, and literal `sent`, without
      Markdown/envelope/todo transforms.
- [ ] Legacy and Console match the final design: operator label/body/status and
      assistant label/body use the exact anatomy, typography, strength, DOM
      casing, and existing tokens described above.
- [ ] At 460x900 and 1440x900, long multi-line operator text wraps without
      room-driven horizontal overflow; `sent` stays visible at the right; row
      order is tool/interrupted -> operator -> resumed agent; Console filters
      never hide the operator row.
- [ ] Existing natural and interrupt Playwright journeys prove the stored
      triple, message-id correlation, attempt placement, display name
      `e2e-starter`, DOM order, and both shell presentations.
- [ ] Contract docs agree on server-side fallback, generated API types are
      current, focused tests and `bun run validate` pass, and no schema-upgrade
      check is required because no SQL schema changes.

## Compatibility, operations, and rollback

- The API change is additive: the new top-level field is optional and nullable;
  old rows and non-operator rows remain valid. Display names are mutable by
  design and therefore reflect the current user record at read time.
- There is no SQL migration, backfill, or data rewrite. Historical operator
  rows do not exist; only guidance delivered after the writer is deployed is
  recorded.
- Strict JSON parsing creates a real downgrade boundary: once a new operator
  row exists, a binary that predates `origin`/`operator_user_id` will reject
  that row and can make the node transcript routes return 500. Therefore an
  exact full-version rollback is unsafe after first write. Roll back the
  executor/UI behavior only while retaining the widened metadata reader, or
  forward-fix; never delete audit rows as a rollback mechanism.
- Coordinate the single-tenant deployment: drain active steering turns, deploy
  the complete reader+writer build, and reload open node-room tabs before new
  guidance is accepted. There is no client/server capability handshake, so a
  pre-deploy tab can otherwise temporarily interpret a new row with its old
  bundle. Adding a feature flag solely for this rollout is out of scope.
- The existing unpaged transcript endpoint remains unbounded; this change does
  not enlarge its row payload materially, and display lookup chunks avoid a
  new parameter-limit or N+1 failure. Cursor clients stay capped at 500 rows.

## Risks and mitigations

| Risk                                                                                | Mitigation / proof                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers expose a stream, not a universal prompt-acceptance acknowledgement.       | Use the first successful stream yield (or normal empty completion) as the common delivery seam, append before processing that chunk, and test that startup failure writes no receipt. Do not invent a provider acknowledgement in this story. |
| The process stops after the registry drain but before the stream reaches that seam. | Existing in-memory steering already has this process-loss boundary and no operator row is claimed. Terminal unmatched-receipt work belongs to Story 2.11.                                                                                     |
| A users-table lookup fails or a user was deleted.                                   | Fail open to the short id on the server, warn once without content, and keep transcript retrieval successful.                                                                                                                                 |
| User-controlled display names or prose inject markup.                               | Render both as React text; operator prose never enters Markdown or `dangerouslySetInnerHTML`.                                                                                                                                                 |
| A partial deployment or exact binary downgrade misclassifies/rejects rows.          | Reader-before-writer phase order, one release unit, coordinated tab reload, and the rollback constraint above.                                                                                                                                |
| New item kind falls through the final lifecycle branch.                             | Add explicit operator branches in both shells and component tests with the operator as the final focus row.                                                                                                                                   |

## Final review gates

Before marking the work done, re-check the implementation against these nine
lenses:

1. Product: the permanent record answers who said what and what happened next.
2. Architecture: only the executor assigns transcript order; the server owns
   enrichment; the web core owns meaning; shells own DOM.
3. Contracts: strict stored metadata, additive OpenAPI response, generated web
   types, and old-row behavior all agree.
4. Security/reliability/data: parameterized lookup, escaped text, no content in
   logs, explicit null identity, and fail-open transcript writes.
5. Performance: no N+1 user reads; chunk bound covers the legacy endpoint.
6. Completeness: direct, loop, loop-group, natural, interrupted, null identity,
   failure, re-ask, and both shells are covered.
7. Verification: tests assert stored/API/functional-core/DOM/visual layers,
   not merely screenshot presence.
8. Operations: generated types, active processes, client reload, downgrade
   boundary, and rollback path are recorded.
9. Maintainability: no new storage kind, endpoint, feature flag, client fetch,
   or speculative abstraction.

<!-- slug: issue-188-operator-messages-in-transcript -->
