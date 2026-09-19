---
title: 'Issue 188 see operator messages in the transcript'
description: 'Implementation-ready plan for recording delivered operator guidance as additive-metadata text rows, projecting a server-side display name, and rendering operator rows in both node-room shells.'
status: ready
priority: P1
effort: '4 phases'
issue: 'https://github.com/kevinle128/Archon/issues/188'
branch: archon/thread-74969958
tags: [issue-188, agent-node-room, workflows, server, web, e2e, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
revised: 2026-09-20
mode: deep
---

# Issue 188: see operator messages in the transcript

## Goal and user outcome

When queued or `Send now` operator guidance is delivered to a running agent
node, the executor must record it in the node transcript so the steering
exchange becomes part of the permanent audit trail. Anyone reading the
transcript later — in the Legacy node room or the Console node room — sees the
operator's own words, in `seq` order, between the agent call that was
interrupted (or that the guidance followed) and the call the guidance caused.
An operator row is visibly the operator's: it carries an `operator · <name>`
role label, full-strength unedited text, and a `sent` badge, and it can never
be mistaken for assistant prose.

After implementation:

- every delivered operator message becomes one ordinary `text` row in
  `workflow_node_messages`, with `origin: 'operator'`, `operator_user_id`, and
  the caller-stamped `message_id` in the existing strict `metadata` JSON — no
  new table, migration, column, or row kind;
- the rows land in the transcript attempt of the turn they caused, so both the
  flat `seq` ordering and the `?attemptId=` filtered view read "operator said X
  → agent did Y";
- the server projects a read-time `operator_display_name` on those rows from
  the `users` table, falling back to a short user id when no display name
  exists, so neither web shell performs a user fetch;
- both shells render a distinct `operator` history item with the `sent` badge as
  a constant — no provider advances a row to `delivered` before gate G1;
- executor, server, shared web read model, both component shells, and an
  outside-in Playwright proof are all test-first (`--tdd`).

## Repository and design authority inspected

- Issue #188 and the merged prerequisite PRs #207 (queue guidance), #210
  (withdraw), #213 (shared live queue, Story 2.9), and #214 (interrupt and
  redirect, Story 2.3).
- Story 2.8 in
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:642-674` and
  the sprint tracker
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:75`.
- Section 4 "An operator row needs a speaker" of
  `_bmad-output/specs/spec-agent-node-room/engine-integration.md` — the
  decision that the row is an ordinary `text` row with three additive metadata
  fields, written by the executor as the sole `seq` writer.
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md:78` ("no
  route is a delivery vehicle for the record — the executor writes the operator
  row").
- The UX authority
  `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`:
  Component Patterns → Operator text (line 128), "the operator's prose is theirs
  and is not edited" (line 96), the `sent` floor for every v1 provider (lines
  187 and 397), and the accessibility build requirements — the role label names
  the sender by `users` display name with a short id as fallback (line 262) and
  role labels are lowercase DOM text under CSS `text-transform: uppercase`
  (line 263).
- Transcript schemas `packages/workflows/src/schemas/node-execution.ts` and
  `packages/workflows/src/schemas/node-message.ts`; the fail-open writer
  `packages/workflows/src/node-transcript.ts`; the scope helpers in
  `packages/workflows/src/transcript-execution-scope.ts`.
- The four guidance drain sites and the two `turns:` loop heads in
  `packages/workflows/src/dag-executor.ts` (direct node: `:3258-3286`,
  `:3480-3521`, `:3617-3648`; loop node: `:6131-6160`, `:7060-7105`,
  `:7310-7360`), plus the #181/#183 executor test harness in
  `packages/workflows/src/dag-executor.test.ts:26509-27800`.
- `QueuedOperatorMessage` in `packages/workflows/src/steering-registry.ts:34-39`
  (`operatorUserId: string | null`, set by the send route from
  `resolveAuthContext`).
- The transcript read routes and `toWorkflowNodeMessageResponse` in
  `packages/server/src/routes/api.ts:5827-5960`, the wire schemas in
  `packages/server/src/routes/schemas/workflow.schemas.ts:193-240`, the
  `starter_display_name` precedent at `api.ts:6020-6021`, and the route tests
  in `packages/server/src/routes/api.workflow-runs.test.ts:2919+` (the
  `@archon/core/db/users` mock factory at `:722` already exposes
  `getUserById`).
- The DB read path `packages/core/src/db/workflow-node-messages.ts:68-89`,
  which parses every row's metadata against the strict schema and throws on an
  unknown key.
- The shared web read model `packages/web/src/lib/agent-history.ts`, the text
  projector `packages/web/src/lib/project-text-transcript.ts` (complete-mode
  rows are never coalesced), `occurrence-groups.ts:155` (only reads
  `lifecycle`), and both shells: `packages/web/src/components/workflows/NodeRoom.tsx`
  (`AssistantHistory` `:246`, `renderItem` `:1053`) and
  `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
  (`historyItemRowVisible` `:53`, `AssistantHistory` `:195`, `renderItem` `:1005`).
- The e2e harness: `e2e/ui/agent-interrupt-redirect.spec.ts`, the identity seed
  in `e2e/lib/playwright/archon-runtime.ts:370-390` (web identity display name
  `e2e-starter`), and `listNodeMessages` in `e2e/lib/playwright/run-detail.ts:47`.
- Root/package test scripts, `packages/web/package.json` `generate:types`, the
  sprint tracker, and the PR template.

## Scope

Included:

- three additive optional keys on the strict transcript metadata schema:
  `origin`, `operator_user_id`, and the reuse of the existing `message_id`;
- a shared `appendOperatorTranscript` writer and its call from the head of the
  guidance turn in both the direct-node and loop-node executor paths, carrying
  the drained `QueuedOperatorMessage[]` across the `continue turns` boundary;
- a read-time `operator_display_name` projection on operator text rows in the
  list and detail transcript routes, with a pure short-id fallback;
- regenerated `packages/web/src/lib/api.generated.d.ts`;
- a new `operator` `AgentHistoryItem` kind and an `OperatorHistory` renderer in
  both shells, with the `sent` badge as a literal;
- executor, schema, server, shared-library, and component coverage written
  before the code they prove, plus one outside-in Playwright spec per surface
  and the Story 2.8 closeout.

Excluded (later stories or explicitly out of scope):

- terminal `NEVER SENT` reconciliation of unmatched `sent` receipts (Story
  2.11) — this story only guarantees the `message_id` those rows will match;
- finished-iteration read-only queue UI (Story 2.10) and queue attribution in
  the dock (Story 2.13);
- any `delivered` state, provider echo, or delivery-ack field (gate G1);
- SSE or any live push of transcript rows — rows keep arriving through the
  existing messages poll;
- registry, send/interrupt/withdraw/queue route, or drain-order changes;
- retrofitting the existing literal-caps `ASSISTANT` label to the lowercase-DOM
  rule (a separate a11y fix);
- database schema or migration work of any kind;
- fixing the unrelated stale `2-1-queue-guidance-for-a-running-agent: backlog`
  tracker entry (left alone by the #189 plan as well).

## Required design

### D1. Additive metadata, no new kind

`nodeTranscriptMetadataSchema` (`packages/workflows/src/schemas/node-execution.ts:29-43`)
gains two optional keys and reuses one:

```ts
origin: z.enum(['operator']).optional(),
operator_user_id: z.string().min(1).nullable().optional(),
// message_id already exists — an operator row stores the caller-stamped
// send-route `message_id` (a UUID) there.
```

The schema stays `.strict()`. `kind` stays `text | tool | status`. `origin`
is an enum rather than a literal so a future speaker can extend it without a
shape change. `operator_user_id` is `nullable` because the send route stores
`requester?.userId ?? null` — a solo install has no identity, and the row must
record "no identity" explicitly rather than "unknown". Because
`packages/core/src/db/workflow-node-messages.ts:87` parses every stored row
against this strict schema on read, the schema change must land before any
executor write (Phase 1 orders it that way and the schema test proves the
round trip).

### D2. The executor writes one text row per delivered message, at the head of the caused turn

Both executor paths already rotate the transcript attempt when a guidance turn
begins (`dag-executor.ts:3271-3275` and `:6148-6154`). The operator rows are
written immediately after that rotation and before `sendQuery`, so they carry
the **caused** turn's `attempt_id`. This is the load-bearing placement
decision:

- flat `seq` order is satisfied by construction — the executor is the sole
  writer and awaits every append, so the last row of turn N (the awaited
  `interrupted` status row or the final agent row) precedes the operator rows,
  which precede the first row of turn N+1;
- the `?attemptId=` filtered view of the redirect turn shows the cause
  ("operator said X") together with its effect, whereas writing at the drain
  site would strand the row in the interrupted turn's attempt.

To make this possible the four drain sites stop joining the batch into a
string and instead carry the drained `readonly QueuedOperatorMessage[]` in a
per-path variable (`turnGuidanceMessages`); the head of each `turns:` loop
derives the prompt with the unchanged `#181` double-newline join and writes the
rows. Prompt bytes handed to the provider do not change.

One row per message, in receipt order. Each row is
`{ kind: 'text', payload: { text: message }, metadata: transcriptMetadata(scope, { origin: 'operator', operator_user_id, message_id }) }`
with no `text_mode`, `stream_id`, or `block_id`, so `projectTextTranscript`
treats it as a complete block and never coalesces it with neighbouring agent
deltas.

The writer is fail-open through `appendNodeTranscript` like every other
transcript write: a persistence failure logs identity and error type only
(never message content) and does not fail the node. A lost row surfaces on the
client as an unmatched `sent` receipt — Story 2.11's terminal reconciliation,
not this story.

Loop-group bodies are covered for free: the direct-node path runs with the
namespaced `stepName`, and the executor test asserts the namespaced `node_id`.

### D3. Display name is a read-time join, never persisted

Rows are immutable and names change, so the server projects the label at read
time. `toWorkflowNodeMessageResponse` (`api.ts:5833`) receives a resolver
built once per request: collect the distinct non-null `operator_user_id`s
across the page, look each one up with the existing `userDb.getUserById`
(no new export, so no `mock.module` factory drift), and map to

```ts
user?.display_name?.trim() || shortOperatorId(operatorUserId)  // first 8 chars
```

The result rides a wire-only `operator_display_name?: string` on
`workflowNodeMessageTextResponseSchema` — it is not a metadata key, so the
stored strict schema stays an honest record. Rows whose `operator_user_id` is
`null` carry no `operator_display_name` and render a bare `operator` label.
Both the list route (compatibility and cursor modes) and the detail route
project it.

### D4. A fourth history item kind, rendered by both shells

`AgentHistoryItem` gains:

```ts
| {
    kind: 'operator';
    id: string;
    seq: number;
    role: 'operator';
    text: string;                 // verbatim — never through presentedText()
    operatorUserId: string | null;
    operatorDisplayName: string | null;
    messageId: string | null;     // the caller-stamped send id
    delivery: 'sent';             // literal until G1
    execution: TranscriptExecution | null;
  }
```

`buildAgentHistory` branches a `text` row on `metadata.origin === 'operator'`
before the assistant push. `OperatorHistory` renders in each shell:

- label line: `<span class="uppercase">operator</span>`, then ` · <name>` when
  a display name exists (name casing preserved), then a `sent` badge whose DOM
  text is lowercase under CSS uppercase — the same rule as the dock headers;
- body: the operator's text as plain `whitespace-pre-wrap` — not Markdown,
  because the prose is theirs and rendering it would edit it — at one strength
  above assistant prose (`font-medium text-text-primary`);
- `data-operator-row` on the wrapper so tests and e2e can target it.

Console's `historyItemRowVisible` returns `true` for the new kind through an
explicit branch (operator rows are never filtered by the tool/system toggles).

### D5. Cross-half invariant

The spec forbids an operator `text` row reaching a live transcript before the
reader recognises `origin`. All four phases ship in one PR; inside it the
read-model test (Phase 3) is written before the executor write is enabled and
the phases are ordered so a reviewer can verify the reader landed with the
writer.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Transcript metadata and executor operator rows](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Server read model and generated types](./phase-02-server-read-model-and-generated-types.md) | Pending |
| 3 | [Phase 3: Web operator rows in both shells](./phase-03-web-operator-rows-in-both-shells.md) | Pending |
| 4 | [Phase 4: Verification and closeout](./phase-04-verification-and-closeout.md) | Pending |

Dependencies: 2 needs 1 (the metadata keys exist); 3 needs 2 (the regenerated
`api.generated.d.ts` exposes `metadata.origin` and `operator_display_name`);
4 needs 1–3.

Deep-mode contract: Phase 1 is planned to line level from this session's
scouting. Phases 2–4 are fully specified but each begins with a bounded scout
pass (listed under "Scout before executing") to re-anchor line numbers that
earlier phases move.

## Success criteria

- [ ] `nodeTranscriptMetadataSchema` accepts `origin`, nullable
      `operator_user_id`, and `message_id` together and still rejects unknown
      keys.
- [ ] Executor matrix proves one operator text row per delivered message, in
      receipt order, under the redirect turn's `attempt_id`, positioned by `seq`
      after the `interrupted` status row (or last agent row) and before the
      first row of the guidance turn — on direct natural drain, direct
      interrupt→`Send now`, loop natural drain, loop interrupt→`Send now`, and a
      loop-group body node.
- [ ] Prompt bytes sent to the provider on a guidance turn are unchanged.
- [ ] A transcript append failure on an operator row does not fail the node and
      logs no message content.
- [ ] List (both modes) and detail routes carry `operator_display_name` from
      `users.display_name`, falling back to the first 8 characters of the id;
      rows without `operator_user_id` carry none; non-operator rows are
      byte-identical to today.
- [ ] `buildAgentHistory` yields an `operator` item with verbatim text,
      `delivery: 'sent'`, `messageId`, and execution scope; assistant items are
      unchanged.
- [ ] Both shells render `operator · <name>`, a `sent` badge, and the text at
      full strength; the row is visible under every Console filter combination;
      the DOM role text is lowercase.
- [ ] Playwright proves, on Legacy and Console, that after Stop → `Send now`
      the operator row sits between the interrupted tool row and the resumed
      echo row, reads `operator · e2e-starter`, shows `sent`, and the API row
      carries `origin`, `message_id`, and `operator_display_name`.
- [ ] `bun run validate` passes; `sprint-status.yaml` marks
      `2-8-see-operator-messages-in-the-transcript: done`; the PR uses the
      template with `Closes #188`.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| An older Archon binary on `PATH` reads a new operator row and its strict metadata parse throws `row_schema`. | Blast radius is the **whole node transcript**, not one row: `listNodeMessages`/`getNodeMessage` map every row through `parseNodeMessageRow` (`workflow-node-messages.ts:68-89,196,226`) and no caller catches `WorkflowNodeMessageCorruptRowError`, so both transcript routes return 500 for any node that ever received guidance until the binary is upgraded. Same exposure every previous additive metadata key (`outcome`, `exit_code`, `output_state`) already carries; hardening the reader to skip unparseable rows is a separate change and out of this story's scope. Accepted and documented. |
| The awaited operator-row writes widen the between-turns window in which a Stop resolves `'generating'` (registry `:243-248`) from a microtask to DB-write latency. | Accepted: the outcome is the already-specified, visible boundary race (#183), the press is spent rather than lost, and `seq` ordering forbids fire-and-forget. Phase 1 adds a test pinning the behaviour; a registry pre-turn interrupt slot is the follow-up if it proves user-visible. |
| Writing the rows at the head of the caused turn means an operator whose redirect never starts (idle-await terminated by Cancel or the 30-minute fail) leaves no row. | Correct by spec: the row is a receipt for delivery, and nothing was delivered. Story 2.11 surfaces those as `NEVER SENT`. |
| `presentedText` envelope unwrapping or todo folding accidentally touches operator rows. | The operator branch returns before either; tests assert verbatim text with an `output_format` supplied. |
| Regenerating `api.generated.d.ts` requires a running server; the worktree port is not 3090. | Phase 2 gives the exact `openapi-typescript` invocation against the worktree's logged port and a `git diff` sanity check. |
| The Console occurrence-group navigator or Legacy last-row focus logic enumerates item kinds. | Scouting shows both key off `item.id`/`lifecycle` only; Phase 3 tests render an operator row as the last item and assert focus marker placement. |

## Red Team Review

Three hostile reviewers (Assumption Destroyer, Failure Mode Analyst, Security
& Scope Adversary) were dispatched against the five plan files with a
`file:line` evidence requirement. The plan was first handed off before their
reports landed (unattended invocation with a structured-output deadline); all
three then arrived, were adjudicated below, and the whole-plan consistency
sweep closed the gate. The strongest-model advisor also reviewed the plan
twice (design-time and post-draft); its six post-draft findings were applied:

| # | Finding | Disposition | Where applied |
|---|---------|-------------|---------------|
| 1 | Cursor-mode resolver must resolve over `page`, per branch, not once over `rows` | Accept | Phase 2, Step 3 item 3 |
| 2 | `textRow` fixture takes only `metadata`; wire-level `operator_display_name` needs a hand-built row | Accept (scout note) | Phase 3, Step 1 |
| 3 | Fail-open executor test could pass trivially; assert N−1 rows + full prompt bytes | Accept | Phase 1, test 8 |
| 4 | Operator-row write must stay inside the guidance block before `reaskPrompt = turnPrompt` | Accept | Phase 1, Step 4 item 3 |
| 5 | e2e identity header may be fixture-only; UI send POST could record `null` | Accept (scout item) | Phase 4, scout list |
| 6 | Loop-group executor test listed under `#181` but uses a `#183` fixture | Accept | Phase 1, test 5 |

### Security & Scope Adversary (landed after handoff; adjudicated)

| # | Finding | Evidence | Disposition | Where applied |
|---|---------|----------|-------------|---------------|
| S1 | Explicit `historyItemRowVisible` operator branch is dead code — the fallthrough already returns `true` | `ConsoleAgentHistoryList.tsx:53-59` | Accept | Phase 3: branch and standalone matrix test removed; visibility kept as a render assertion |
| S2 | Rollback note wrong: an un-branched operator item falls into `LifecycleHistory`, not assistant text | `NodeRoom.tsx:1070-1075` | Accept | Phase 3 Risks rewritten |
| S3 | Display-name lookup failure had no log line | plan Phase 2 sketch | Accept | Phase 2: `server.operator_display_name_lookup_failed` warn + test assertion |
| S4 | Raw `operator_user_id` on the transcript wire is spec-sanctioned (`engine-integration.md` §4); the queue route's exclusion is a different endpoint | `api.ts:6021` precedent | Verified non-issue | — |

### Assumption Destroyer (landed after handoff; adjudicated)

| # | Finding | Evidence | Disposition | Where applied |
|---|---------|----------|-------------|---------------|
| A1 | `agent-history.ts` push anchor `:388-398` out of file bounds | `agent-history.ts:330` | Accept (already corrected in the self fact-check) | Phase 3 scout list |
| A2 | `AgentHistoryItem` union range `:28-68` overruns into other aliases | `agent-history.ts:27-61` | Accept | Phase 3 scout list |
| A3 | Test helper's boolean `.filter` does not narrow `r.payload` for `.map` | `node-execution.ts:29-43` shared metadata shape | Accept | Phase 1 `operatorRows` uses a type predicate |
| A4 | Four sibling server test factories omit `getUserById` (latent, not triggered here) | `api.auth.test.ts:55` et al. | Accept as a note | Phase 2 mock-isolation paragraph |

### Failure Mode Analyst (landed after handoff; adjudicated)

| # | Finding | Evidence | Disposition | Where applied |
|---|---------|----------|-------------|---------------|
| F1 | Awaited operator-row writes at the turn head widen the between-turns window where `interrupt()` resolves `'generating'` | `steering-registry.ts:205-210,243-248`; executor `:3269-3303` synchronous today | Accept (modified): documented as an accepted boundary race with a pinning test; fire-and-forget rejected (breaks `seq` ordering) | Phase 1 Step 4 note + new test; Risks table |
| F2 | Old-binary risk understated — one unparseable row 500s the whole node transcript | `workflow-node-messages.ts:68-89,196,226` | Accept | Risks table corrected |

All other angles (empty batches, re-ask double writes, AskHuman re-entry,
concurrent writers, `message_id` coalescing, e2e identity header) were traced
by that reviewer and found handled by the plan text.

### Whole-Plan Consistency Sweep

All three lenses are adjudicated (S1–S4, A1–A4, F1–F2). After applying them,
`plan.md` and the four phase files were re-read: the removed
`historyItemRowVisible` branch no longer appears in the Phase 3 file table,
steps, or success criteria; the corrected anchors (`:27-61`, `:103-119`,
`:330-339`, `:1000`) match the code; the lookup-failure log, the type
predicate, and the boundary-race test are each referenced in exactly one
phase and summarised here. No contradictions remain. The gate is closed.

## Validation Log

### Verification Results (self, Standard tier)

- Claims checked: 20 (11 executor anchors, 3 web anchors, 2 server anchors,
  2 test-harness anchors, 2 e2e anchors)
- Verified: 17 | Failed: 3 (corrected in place) | Unverified: 1
- Failures corrected: `agent-history.ts` `presentedText` (`:105-121` →
  `:103-119`) and the text push (`:388-398` → `:330-339`); Console
  `renderItem` (`:1005` → `:1000`).
- Unverified (left as a Phase 4 scout item): whether the interrupt spec's
  `page` context carries `X-Archon-User` on browser-originated fetches.
- The user interview was not run: the invocation is unattended and asked for
  advisor review in its place. Decisions D1–D5 stand on cited source, spec,
  and UX authority; none requires a business call.

### Whole-Plan Consistency Sweep

After the six advisor edits, `plan.md` and all four phase files were re-read
for stale terms: the four drain-site join replacements, the `turnGuidanceMessages`
name, the `operator_display_name` wire key, the `delivery: 'sent'` literal,
and the `#181`/`#183` test placement are consistent across files. No
contradictions remain from this session's edits; the red-team gate above is the
one open item.

<!-- slug: issue-188-operator-messages-in-transcript -->
