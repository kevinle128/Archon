# PRD: Issue 188 — show operator messages in the node transcript

Source plan: `plans/260919-1929-issue-188-operator-messages-in-transcript/plan.md`
(+ `phase-01` … `phase-04` in the same directory). Issue:
https://github.com/kevinle128/Archon/issues/188 (acceptance authority: Story 2.8
in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`).

## Problem

Queued or `Send now` operator guidance is delivered to the provider as the next
turn, but the permanent node transcript records only the resulting agent
output. The audit trail loses who steered the agent and what they said.

## Outcome / solution

When a drained FIFO batch actually becomes the next provider turn, the
transcript must show, in order:

1. the agent turn the guidance followed, or the tool call marked `interrupted`;
2. one attributed operator row per delivered message, in registry receipt
   order;
3. the agent turn caused by that guidance.

Each operator row is an ordinary stored `text` row whose strict metadata
carries `origin: 'operator'`, nullable `operator_user_id`, and the existing
caller-stamped `message_id`. The API derives a response-only
`operator_display_name` at read time (never persisted). Both shells (Legacy
`NodeRoom`, Console) render the message as plain full-strength prose with a
permanent lowercase `sent` status.

## Verified contract decisions (authoritative — do not re-litigate)

- **Story 2.8 wins over AD-12.** For a non-null `operator_user_id`, the server
  response always contains either the trimmed current `users.display_name` or
  the first eight id characters. `null` is reserved for identity-less rows
  (`operator_user_id: null`). Older wording in `ARCHITECTURE-SPINE.md` AD-12
  and `steering-test-plan.md` that says a failed join yields `null` is stale;
  Phase 1 amends those docs. The web keeps the same short-id derivation only as
  a compatibility guard for older/partial responses and performs no user fetch.
- **Reader-before-writer.** The read contract and both renderers ship before
  the executor writes any operator row. Phases 1→2→3→4 is also the safe
  commit/cherry-pick order. Never deploy a writer-only subset: an old web
  reader would map operator text rows to assistant prose.
- **Delivery seam.** Providers expose a stream, not an acknowledgement. The
  receipt is written when the caused-turn stream first yields, or completes
  normally without a chunk — appended before the first chunk is processed into
  the transcript. A startup throw before either seam writes no receipt. Do not
  invent a provider acknowledgement.
- **Downgrade boundary.** Once a new operator row exists, a binary whose strict
  metadata schema lacks `origin`/`operator_user_id` will reject the row and can
  500 the transcript routes. Rollback = disable the writer while retaining the
  widened parser, or forward-fix. Never delete audit rows to roll back.

## Goals and success metrics

- Every delivered batch member produces exactly one verbatim `text` row with
  the complete metadata triple; undrained/discarded messages produce none.
- `seq` ordering holds on direct natural drain, direct redirect, loop natural
  drain, loop redirect, and namespaced loop-group bodies; rows share the caused
  turn's `attempt_id`; a re-ask never duplicates them; provider prompt bytes
  unchanged (still `messages.map(m => m.message).join('\n\n')`).
- List (compat + cursor) and detail responses enrich only operator text rows:
  non-null senders get a trimmed name or 8-char fallback; null senders get
  explicit `null`; all other rows keep their prior shape. Lookup is deduped,
  chunk-bounded (≤500 ids/query), excludes the cursor overflow row, and fails
  open to short ids with one payload-free warning.
- `buildAgentHistory` emits a distinct `kind: 'operator'` item (verbatim text,
  `messageId`, sender, execution scope, literal `delivery: 'sent'`) that never
  passes through `presentedText`, Markdown, todo folding, or tool pairing.
- Legacy and Console match the final approved design exactly (tokens below) at
  460x900 and 1440x900 with no horizontal room overflow; Console filters never
  hide the row.
- Existing steering Playwright journeys prove the stored triple, caller-id
  correlation, attempt placement, `e2e-starter` projection, DOM order, and both
  shell presentations. `bun run validate` passes.

## Non-goals (explicitly excluded)

- `delivered` state or provider acknowledgement before the stream seam;
  terminal `NEVER SENT` reconciliation (Story 2.11).
- Queue collaboration/attribution UI (Stories 2.9/2.13).
- Changes to send, queue, withdraw, interrupt, registry semantics, provider
  interfaces, or prompt derivation.
- SSE or a new transcript transport; the existing poll discovers the rows.
- Any new table, column, migration, row kind, endpoint, user-fetching client,
  shared cross-shell component, cache, or feature flag.

## Technical context

### Stored row contract (`packages/workflows`)

- `src/schemas/node-execution.ts:29` — `nodeTranscriptMetadataSchema` (strict).
  `message_id` already exists at :33. Add:
  `origin: z.literal('operator').optional()`,
  `operator_user_id: z.string().min(1).nullable().optional()`.
  Do NOT make keys conditionally dependent — other writers legitimately omit
  them. `message_id` stays `z.string().min(1).optional()` (non-UUID provider
  ids exist; the steering route validates its own UUIDs).
- Row shape: `kind: 'text'`, `payload: { text: <verbatim queued message> }`,
  `metadata: transcriptMetadata(scope, { origin: 'operator', operator_user_id,
  message_id })`. No `stream_id`/`block_id`/`text_mode`, so the existing text
  projector treats it as one complete block and cannot coalesce it.
- `src/transcript-execution-scope.ts` — `newTranscriptAttempt` (:40),
  `transcriptMetadata` (:128).
- `src/node-transcript.ts` — `appendNodeTranscript` (:14) is awaited and
  fail-open (catches each append, logs identity + error type only);
  `appendToolResultTranscript` (:37) is the sibling precedent. Add
  `appendOperatorTranscript` here: sequential awaits, one row per message in
  array order, type-only `QueuedOperatorMessage` import.
- `src/steering-registry.ts` — `QueuedOperatorMessage` (:35, fields `message`,
  `messageId`, `operatorUserId`), FIFO `drain()` (:359).
- `src/dag-executor.ts` — direct `turns:` head (interrupt wake
  `kind === 'send_now'` + natural `steeringHandle.drain()`), loop `turns:` head
  (same two delivery points). Both already rotate attempt scope before a
  guidance turn. Carry `readonly QueuedOperatorMessage[]` instead of joining at
  drain; at the guidance head after `newTranscriptAttempt`, derive the prompt
  via the unchanged join rule and retain a pending receipt context {rotated
  scope, messages}; inside the provider-stream `try`, append immediately before
  processing the first yielded chunk, or immediately after a normally-empty
  `for await`; a startup throw writes nothing; never pass the context to a
  structured-output re-ask. Loop path mirrors with
  `iterationExecutionScope` and the executor's namespaced `stepName`
  (loop-group bodies prove the namespaced `node_id`). Register/start the
  provider turn before the awaited append so Stop still targets a live turn.

### Server read model (`packages/core`, `packages/server`)

- `packages/core/src/db/users.ts` — existing `getUserById` (:41) and the
  cross-dialect `$N` query adapter. Add
  `getUserDisplayNamesByIds(ids: readonly string[]): Promise<Array<Pick<User,
  'id' | 'display_name'>>>`: dedupe ids, `[]` without querying on empty input,
  `SELECT id, display_name FROM remote_agent_users` with positional `IN`
  params (never interpolate), sequential chunks of ≤500 ids. No cache.
- `packages/server/src/routes/schemas/workflow.schemas.ts:194` —
  `workflowNodeMessageTextResponseSchema` gains
  `operator_display_name: z.string().nullable().optional()`. Only the text
  variant; tool/status variants unchanged.
- `packages/server/src/routes/api.ts` — `nodeMessageMetadata` (:5827),
  `toWorkflowNodeMessageResponse` (:5833), compatibility list branch (:5904),
  cursor branch (`limit + 1` fetch :5914, page map :5923), detail (:5950).
  Keep projection helpers local to `api.ts`. For the array actually returned:
  collect rows with `kind === 'text'`, `metadata.origin === 'operator'`,
  non-null sender; dedupe; one helper call; index by id; attach trimmed
  non-blank name, else `senderId.slice(0, 8)`, else `null` for null identity;
  omit the field on non-operator rows. In cursor mode apply after removing the
  overflow row. On helper rejection: catch at the read-model boundary, log one
  `workflow_node_operator_names_lookup_failed` warning with `runId`, `nodeId`,
  distinct sender count, `errorType` (no message text, display names, error
  message, or raw id set), build the map from short ids, still return 200.
- Tests: `packages/server/src/routes/api.workflow-runs.test.ts` — add
  `mockGetUserDisplayNamesByIds` to the existing users-module factory and a
  named `mockApiLogWarn` beside `mockApiLogError`; reset both in the
  transcript-route `beforeEach`. Other server test files mock the users module
  in separate Bun invocations — do not edit them speculatively.
- Regenerate `packages/web/src/lib/api.generated.d.ts` only against this
  worktree's server port (3090 if free; otherwise the logged worktree port);
  the diff must contain only contract-derived changes (`origin`,
  `operator_user_id`, `operator_display_name`). Discard unrelated churn and fix
  the process, never hand-edit. Track and stop the server afterwards.
- Doc reconciliation (smallest amendments): `ARCHITECTURE-SPINE.md` AD-12
  (`_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/`),
  `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`,
  `steering-api-contract.md` — server owns the short-id fallback; distinguish
  stored triple vs response-only derived field; executor writes the row, not
  the route. No implementation detail (chunk size) in product docs.

### Web read model and renderers (`packages/web`)

- `src/lib/agent-history.ts` — `AgentHistoryItem` union (:27),
  `buildAgentHistory` (:304). Add one union member:
  `{ kind: 'operator'; id; seq; role: 'operator'; text; operatorUserId:
  string | null; operatorDisplayName: string | null; messageId: string | null;
  delivery: 'sent'; execution: TranscriptExecution | null }`.
  Branch after tool-card handling, before the generic text branch, on
  `message.kind === 'text' && message.metadata?.origin === 'operator'`. Text is
  verbatim (no trim/transform); display name = non-blank response field, else
  first 8 chars of non-null sender id (compat guard — no request), else null.
- Legacy `src/components/workflows/NodeRoom.tsx` — new `OperatorHistory` beside
  `AssistantHistory`; explicit `item.kind === 'operator'` branch before the
  final lifecycle branch; reuse row wrapper, focus ring, `data-last-row`,
  `renderAfterItem`. DOM contract:
  - wrapper: `data-operator-row`, `overflow-wrap: anywhere`;
  - role line: flex, full width, 10px, tracking `0.07em`, uppercase CSS
    transform over lowercase DOM text, text-secondary, margins `10px 2px 3px`;
  - label: `data-operator-label`, text `operator` plus ` · ${displayName}`
    only when non-null;
  - status: `data-operator-delivery`, `margin-left: auto`, `flex-shrink: 0`,
    11px, normal case/tracking, text-secondary, literal `sent`;
  - body: `data-operator-body`, `font-sans`, 12.5px, line-height 1.55, normal
    weight, text-primary, `whitespace-pre-wrap`, margins `0 2px 6px`; render
    `{item.text}` directly — never `ReactMarkdown`.
  - Correct `AssistantHistory` in the same file: lowercase DOM `assistant`,
    10px/0.07em text-secondary role line, 12.5px/1.55 text-secondary body (keep
    Markdown). This is the required second non-color authorship channel.
- Console `src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`
  — same local `OperatorHistory` + branch + assistant correction. Do NOT modify
  `historyItemRowVisible` (already returns true for non-tool/lifecycle kinds);
  add a test assertion instead.
- Design authority: `DESIGN.md`/`EXPERIENCE.md` in
  `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`
  plus `mockups/key-steering-dock.html` and the shipping-surface prototypes in
  `claude-design/design_handoff_node_room_transcript_steering/` (README:
  `DESIGN.md` wins). Rejected draft values — 9.5px tertiary label, `text-sm`
  body, medium weight, bordered uppercase status pill — must not appear. No
  bubble, border, badge, avatar, or role hue. 460px is the authoritative narrow
  width; no transcript breakpoint exists.
- Do not change `project-text-transcript.ts`, `pair-tool-transcript.ts`,
  `occurrence-groups.ts`, steering dock state; do not create a cross-shell
  component. After adding the union member, grep all `AgentHistoryItem` /
  `item.kind` consumers — type-check is authoritative; add no branch where
  fallthrough is already correct.

### E2E and closeout

- `e2e/lib/playwright/run-detail.ts` — widen `listNodeMessages` return type
  (`id`, `seq`, `kind`, `payload`, optional `created_at`, optional top-level
  `operator_display_name: string | null`, metadata `origin` /
  `operator_user_id` / `message_id` / execution occurrence+attempt). Type-only
  correction; the helper already returns full JSON. Use the generated response
  contract as shape reference; no `any`.
- `e2e/ui/agent-queue-guidance.spec.ts` — `[V:steer.direct-{surface}]`:
  currently asserts operator rows do NOT exist — replace with positive proof.
  Set `X-Archon-User: E2E_STARTER_WEB_USER` header on the page before
  navigation so browser sends resolve the seeded user (display name
  `e2e-starter`). Track the two caller `message_id`s; assert exactly two
  operator rows in seq order with verbatim bodies, captured ids, identical
  non-empty sender ids, `operator_display_name === 'e2e-starter'`, preceding
  the caused echo and sharing its `attempt_id` (≠ settled prior attempt); DOM:
  two `[data-operator-row]` with label `operator · e2e-starter`, `sent`, plain
  body before the echo. Keep existing session/queue/focus/a11y assertions; the
  embedded fake-provider directive is expected verbatim audit text.
- `e2e/ui/agent-interrupt-redirect.spec.ts` — `[V:steer.interrupt-{surface}]`:
  same header; capture all three `message_id`s via `trackPosts(...).bodies()`;
  assert three API rows in order with full triple + `e2e-starter` projection;
  `interrupted` seq < first operator seq, resumed echo seq > last; all rows use
  resumed attempt, not interrupted attempt; DOM order via
  `Node.compareDocumentPosition` (never `boundingBox().y`); every status
  exactly `sent`, no `delivered` anywhere.
- `[V:steer.interrupt-visual-{surface}]`: long multiline first message; at
  460x900 and 1440x900 assert/capture no room overflow, role-line source +
  uppercase computed transform + secondary color + 10px + ~0.07em tracking,
  `sent` computed normal case/11px/secondary/right-aligned/visible, body
  preserved text/sans/12.5px/1.55/normal weight/primary/no Markdown child,
  adjacent assistant body 12.5px/1.55 secondary, DOM order +
  last-row reachability. Both surfaces, both viewports. New captures go under
  this plan's evidence dir (second constant or dir param); don't move #181/#183
  evidence.
- Do not add a third spec or duplicate helpers — extend the two existing specs.
- `reports/acceptance-evidence.md` (inside this plan directory): map each
  parent-plan acceptance criterion to its test(s), record command results,
  Playwright captures, generated-type diff review, explicit no-migration
  statement, rollout/reload + downgrade-safe rollback instructions.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:75`
  — set `2-8-see-operator-messages-in-the-transcript: done` only after all
  gates pass. Touch no other story.

## Story overview

| Story | Title | Phase | Depends on |
| ----- | ----- | ----- | ---------- |
| US-001 | Contract and server read model | 1 | — |
| US-002 | Web read model and both shell renderers | 2 | US-001 |
| US-003 | Executor persistence and ordering | 3 | US-001, US-002 |
| US-004 | Integration, rollout, and closeout | 4 | US-001–US-003 |

## Verification commands

Focused, per phase (from repo root unless noted):

```bash
# US-001
cd packages/workflows && bun test src/schemas/node-execution.test.ts
cd ../core && bun test src/db/users.test.ts
cd ../server && bun test src/routes/api.workflow-runs.test.ts
cd ../.. && bun run type-check && bun run lint --max-warnings 0
bun --filter @archon/server test   # users module mocked in several isolated suites

# US-002 (from packages/web)
bun test src/lib/agent-history.test.ts
NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx
bun run type-check && cd ../.. && bun run lint --max-warnings 0
bun --filter @archon/web test      # catch other item-kind consumers

# US-003 (from packages/workflows)
bun test src/node-transcript.test.ts
bun test src/dag-executor.test.ts -t 'operator'
bun test src/dag-executor.test.ts
bun test src/steering-registry.test.ts
bun run type-check && cd ../.. && bun run lint --max-warnings 0

# US-004
bun --filter @archon/core test && bun --filter @archon/workflows test
bun --filter @archon/server test && bun --filter @archon/web test
bun run type-check && bun run lint --max-warnings 0 && bun run build:web
cd e2e && npm run typecheck
ARCHON_E2E_REPO_ROOT=<abs repo root> npx playwright test -c playwright.config.ts \
  --grep '\[V:steer\.(direct|interrupt|interrupt-visual)-'
ARCHON_E2E_REPO_ROOT=<abs repo root> npx playwright test -c playwright.config.ts \
  ui/agent-queue-guidance.spec.ts ui/agent-interrupt-redirect.spec.ts
cd .. && bun run validate
```

Rules: never substitute root `bun test` for `bun run validate` (per-package
invocations exist for `mock.module` isolation). No `check:schema-upgrades` —
no SQL dialect changes. Track and stop every server/test process started;
Playwright's worker fixture owns its server — reconcile only this worktree's
PIDs/ports if cleanup is bypassed. Point diagnostic executor runs at an empty
temporary `ARCHON_HOME`.
