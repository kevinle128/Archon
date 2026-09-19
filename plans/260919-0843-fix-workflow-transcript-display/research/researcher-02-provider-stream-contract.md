# Provider Stream Contract Research

## Summary

Devin and DeepSeek convert each ACP `agent_message_chunk` into an Archon assistant chunk without `textMode`.
The transcript projector treats a missing mode as `complete`, so every ACP text delta becomes a separate assistant row.
The minimal prospective fix is to add `textMode: 'delta'` in both ACP event bridges and update their unit and ACP process-boundary tests.
No workflow, database, API, schema, or web production change is required.
Historical rows do not contain enough information for a safe provider-neutral repair.

## Verified Findings

### Root Cause

The `MessageChunk` contract defines `textMode` as the provider-known text boundary in `packages/providers/src/types.ts:311-329`.
The contract permits `complete`, `delta`, and `snapshot` values in `packages/providers/src/types.ts:324-325`.
The Devin bridge returns only `type` and `content` for ACP `agent_message_chunk` events in `packages/providers/src/community/devin/event-bridge.ts:84-94`.
The DeepSeek bridge has the same omission in `packages/providers/src/community/deepseek/event-bridge.ts:64-72`.
The current Devin unit test requires the incomplete object in `packages/providers/src/community/devin/event-bridge.test.ts:11-18` and again after replay in `packages/providers/src/community/devin/event-bridge.test.ts:32-46`.
The current DeepSeek unit test requires the incomplete object in `packages/providers/src/community/deepseek/event-bridge.test.ts:6-15`.
These tests passed during this research, so they confirm the current behavior but do not confirm the correct stream boundary.

The ACP SDK itself treats text from consecutive `agent_message_chunk` notifications as append-only chunks.
Its `ActiveSession.readText()` helper appends each text value to one output string in the official [TypeScript SDK source](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts).
Its official [HTTP client example](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/http-client.ts) also writes each received text chunk directly to the output stream.
Therefore, Archon must label each mapped ACP message chunk as `delta`.

### Complete Runtime Path

1. A Devin ACP agent sends a `session/update` notification to the real SDK client handler in `packages/providers/src/community/devin/acp-client.ts:273-293`.
2. `mapDevinSessionUpdate()` creates an assistant chunk without `textMode` in `packages/providers/src/community/devin/event-bridge.ts:91-94`.
3. The Devin client appends the text to its structured-output transcript and pushes the unchanged chunk into its async queue in `packages/providers/src/community/devin/acp-client.ts:287-292`.
4. The Devin client yields the unchanged queue item in `packages/providers/src/community/devin/acp-client.ts:471-473`.
5. DeepSeek follows the same path through `packages/providers/src/community/deepseek/acp-client.ts:267-275` and `packages/providers/src/community/deepseek/acp-client.ts:388-390`.
6. The provider wrappers pass assistant chunks through the shared resumed-result wrapper, which only changes terminal result chunks, in `packages/providers/src/shared/resumed.ts:17-27`.
7. A normal workflow node consumes the provider stream in `packages/workflows/src/dag-executor.ts:2290-2302`.
8. The normal workflow path stores `msg.textMode` as `metadata.text_mode` only when the provider supplied it in `packages/workflows/src/dag-executor.ts:2350-2362`.
9. A loop node performs the same conditional mapping in `packages/workflows/src/dag-executor.ts:6021-6028` and `packages/workflows/src/dag-executor.ts:6063-6079`.
10. The ordered transcript writer awaits the store append in `packages/workflows/src/node-transcript.ts:14-30`.
11. The database code serializes the payload and metadata without changing them in `packages/core/src/db/workflow-node-messages.ts:92-132`.
12. The database query returns rows in sequence order in `packages/core/src/db/workflow-node-messages.ts:174-197`.
13. The API copies text payloads and metadata into its response without changing them in `packages/server/src/routes/api.ts:5399-5457`.
14. The transcript endpoint pages the same rows in `packages/server/src/routes/api.ts:5460-5499`.
15. The web projector treats an absent `text_mode` as `complete` in `packages/web/src/lib/project-text-transcript.ts:55-59`.
16. The web projector keeps each `complete` row independent in `packages/web/src/lib/project-text-transcript.ts:76-83`.
17. `buildAgentHistory()` runs the text projector and creates one assistant history item for each projected text row in `packages/web/src/lib/agent-history.ts:260-293`.
18. The workflow room renders each assistant history item as a separate Markdown block in `packages/web/src/components/workflows/NodeRoom.tsx:241-260` and `packages/web/src/components/workflows/NodeRoom.tsx:956-963`.
19. The Console view has the same one-item-per-block behavior in `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:182-202` and `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx:889-903`.

The failure is therefore a missing provider boundary signal, not a database, API, pagination, or renderer loss.
The normal node output is not fragmented because the executor always concatenates `msg.content` into `nodeOutputText` in `packages/workflows/src/dag-executor.ts:2363`.

## Sibling Provider Inventory

Repository search for `@agentclientprotocol/sdk` under `packages/providers/src` finds only the Devin and DeepSeek provider implementations and their tests.
Both ACP providers must change because both map the same append-only ACP event without `textMode`.
A Devin-only fix would leave the same transcript defect active for DeepSeek.

OpenCode already distinguishes explicit deltas from full snapshots in `packages/providers/src/community/opencode/session.ts:182-206`.
OpenCode emits `delta` when the event has a delta and emits `snapshot` when the event only has the full part text.
Copilot already maps `assistant.message_delta` to `textMode: 'delta'` in `packages/providers/src/community/copilot/event-bridge.ts:250-264`.
Copilot marks its non-stream fallback as `complete` in `packages/providers/src/community/copilot/event-bridge.ts:489-495`.
Claude, Codex, and Qoder emit complete blocks and already mark them as complete at `packages/providers/src/claude/provider.ts:1141`, `packages/providers/src/codex/provider.ts:634`, and `packages/providers/src/community/qodercli/provider.ts:490`.
These sibling implementations support a provider-owned boundary decision and do not need a change for this defect.

## Git History Evidence

Commit `981c7b39` introduced `textMode` and transcript projection on 2026-09-07 at 22:58:51 in the repository timezone.
Commit `c41e6fc7` introduced the DeepSeek ACP bridge earlier on the same day at 17:04:34, so that bridge predates the contract.
Commit `3418f186` introduced the Devin ACP mapping on 2026-09-14, after the contract existed, but it did not set the boundary.
Commit `81ba296f` added occurrence-aware and attempt-aware projection on 2026-09-19.
Commit `b2d7f883` fixed a similar Pi symptom by coalescing Pi character deltas before the explicit transcript boundary contract existed.
The Pi history shows that the provider integration must state or establish the text boundary before downstream display code receives the chunks.
The current explicit `delta` contract makes new ACP buffering unnecessary.

## Safety of `textMode: 'delta'`

### Consecutive Text Chunks

The projector concatenates consecutive anonymous delta rows when their execution identity is unchanged in `packages/web/src/lib/project-text-transcript.ts:85-95`.
Devin and DeepSeek do not receive stable message, block, or stream identifiers in the mapped ACP update, so anonymous delta projection is the correct mode.
Archon must not invent an identifier because the ACP event does not supply one.

### Tool Boundaries

A non-text transcript row closes the current anonymous delta group in `packages/web/src/lib/project-text-transcript.ts:69-73`.
An assistant sequence before a tool call and an assistant sequence after its tool result therefore become separate rendered assistant blocks.
Keyed streams remain independent through the `streamKey()` logic in `packages/web/src/lib/project-text-transcript.ts:39-52`.

### Turns, Re-asks, and Retries

Every current transcript row receives server-generated occurrence and attempt identity through `packages/workflows/src/transcript-execution-scope.ts:24-42` and `packages/workflows/src/transcript-execution-scope.ts:128-133`.
The normal node path creates or recovers an execution scope in `packages/workflows/src/dag-executor.ts:1986-2000`.
A structured-output re-ask creates a new attempt in `packages/workflows/src/dag-executor.ts:2285-2288`.
A guidance turn creates a new attempt in `packages/workflows/src/dag-executor.ts:3022-3030`.
The projector includes occurrence and attempt identity in its anonymous and keyed decisions in `packages/web/src/lib/project-text-transcript.ts:39-52` and `packages/web/src/lib/project-text-transcript.ts:85-95`.
Therefore, anonymous ACP deltas cannot merge across these turn or retry boundaries.

### Loop Occurrences

Each loop iteration creates a new transcript execution scope in `packages/workflows/src/dag-executor.ts:5700-5715`.
Loop guidance creates a new attempt in `packages/workflows/src/dag-executor.ts:5848-5855`.
Loop structured-output re-asks create a new attempt in `packages/workflows/src/dag-executor.ts:6628-6632`.
The separate execution identities prevent cross-iteration and cross-attempt concatenation.

### AskHuman Resume

AskHuman resume can recover the same execution scope, but its tool row is a non-text boundary.
The projector resets the anonymous delta accumulator on that row in `packages/web/src/lib/project-text-transcript.ts:69-73`.
The text before the question and the text after the answer therefore stay separate.

### Platform Delivery Limitation

`textMode` changes transcript metadata and web projection only.
It does not change direct platform streaming or batch delivery in `packages/workflows/src/dag-executor.ts:2364-2380`.
Batch mode still joins provider chunks with two newlines in `packages/workflows/src/dag-executor.ts:2368-2373`.
If Slack, Telegram, Discord, GitHub, or CLI output shows the same visible fragmentation, that is a separate delivery defect and needs a separate accepted scope.

## Historical Rows

Historical rows without `text_mode` do not record whether adjacent text rows are complete messages or fragments.
The web projector intentionally defaults a missing value to `complete` in `packages/web/src/lib/project-text-transcript.ts:55-59`.
Changing that default to `delta` would merge valid historical complete messages from other providers.
A provider name, date, row length, punctuation pattern, or adjacency rule cannot reconstruct the missing boundary without false merges.
Such a UI rule would also put provider-specific protocol knowledge into the provider-neutral transcript projector.

No automatic historical repair is safe with the stored data alone.
The implementation should be prospective and should leave old rows unchanged.
If historical repair becomes a product requirement, it needs a separate, explicit, audited, run-scoped migration based on external proof of provider and execution boundaries.
The current research does not identify such complete proof for all affected historical rows.

## Recommendation

Add `textMode: 'delta'` to the assistant chunk returned by `mapDevinSessionUpdate()`.
Add `textMode: 'delta'` to the assistant chunk returned by `mapDeepseekSessionUpdate()`.
Do not add provider state, buffering, fabricated IDs, schema fields, database migration logic, API transforms, or UI heuristics.
The existing executor and projector already implement the required propagation and projection contracts.

## Exact File Inventory

### Required Production Files

- Modify `packages/providers/src/community/devin/event-bridge.ts` to label ACP assistant chunks as deltas.
- Modify `packages/providers/src/community/deepseek/event-bridge.ts` to label ACP assistant chunks as deltas.

### Required Test Files

- Modify `packages/providers/src/community/devin/event-bridge.test.ts` so the mapping test first fails and then requires `textMode: 'delta'`.
- Modify `packages/providers/src/community/deepseek/event-bridge.test.ts` so the mapping test first fails and then requires `textMode: 'delta'`.
- Modify `packages/providers/src/community/devin/acp-client.test.ts` so the fake ACP process boundary sends at least two message chunks and requires ordered delta output.
- Modify `packages/providers/src/community/deepseek/acp-client.test.ts` so the fake ACP process boundary sends at least two message chunks and requires ordered delta output.

### Downstream Characterization Files

- Modify `packages/workflows/src/dag-executor.test.ts` only if the plan requires a new explicit assertion that both normal and loop transcript writes preserve `text_mode: 'delta'` with execution identity.
- Modify `packages/web/src/lib/project-text-transcript.test.ts` only if the plan requires a new explicit tool-boundary test for anonymous deltas.
- Modify `packages/web/src/lib/agent-history.test.ts` only if the plan requires one direct assertion that two anonymous delta rows become one assistant history item.

The downstream production files need no change.
The current projector tests already cover keyed delta concatenation, occurrence separation, attempt separation, anonymous delta grouping, historical rows, and input immutability in `packages/web/src/lib/project-text-transcript.test.ts:31-185`.
The current agent history test already proves delta and snapshot projection in `packages/web/src/lib/agent-history.test.ts:162-195`.

## TDD Matrix

### Case 1: Devin Bridge Contract

Add `textMode: 'delta'` to the expected assistant chunk in `packages/providers/src/community/devin/event-bridge.test.ts` before the production change.
The test must fail because the bridge currently omits the field.
The bridge change must make the test pass without changing thought, replay, or tool behavior.

### Case 2: DeepSeek Bridge Contract

Add `textMode: 'delta'` to the expected assistant chunk in `packages/providers/src/community/deepseek/event-bridge.test.ts` before the production change.
The test must fail because the bridge currently omits the field.
The bridge change must make the test pass without changing thought, usage, or tool behavior.

### Case 3: Devin Deterministic ACP Boundary

Use `createFakeDevin()` in `packages/providers/src/community/devin/acp-client.test.ts:98-229`.
Make the fake agent send two `agent_message_chunk` notifications such as `Hel` and `lo`.
Run them through `runDevinAcpTurn()`, the injected child process, and the real SDK NDJSON stream that `attachAgent()` creates in `packages/providers/src/community/devin/acp-client.test.ts:710-716`.
Require two ordered assistant chunks with `textMode: 'delta'`, require their content to concatenate to `Hello`, and require the terminal result to remain last.

### Case 4: DeepSeek Deterministic ACP Boundary

Use `createFakeDsh()` in `packages/providers/src/community/deepseek/acp-client.test.ts:119-200`.
Make the fake agent send the same two message chunks.
Run them through `runDeepseekAcpTurn()`, the injected child process, and the real SDK NDJSON stream that `attachAgent()` creates in `packages/providers/src/community/deepseek/acp-client.test.ts:253-259`.
Require the same ordered delta contract and terminal result order.

### Case 5: Normal Workflow Persistence

Feed two anonymous delta chunks through the existing normal AI-node executor test harness.
Require two immutable text rows with `metadata.text_mode === 'delta'` and the same occurrence and attempt identity.
This case proves the mapping at `packages/workflows/src/dag-executor.ts:2350-2362`.

### Case 6: Loop Workflow Persistence

Feed two anonymous delta chunks through one loop iteration in the existing loop test harness.
Require delta metadata on both rows and require a different occurrence identity for a second iteration.
This case proves the mapping at `packages/workflows/src/dag-executor.ts:6063-6079` and the scope boundary at `packages/workflows/src/dag-executor.ts:5700-5715`.

### Case 7: Render Projection

Project the two persisted delta rows and require one assistant item with text `Hello`.
Insert a tool row between two delta pairs and require two assistant items.
Repeat the same anonymous identifiers in a new attempt and a new loop occurrence and require separate assistant items.
The current projector tests already prove the execution-identity cases, so this case can be a focused characterization instead of new production logic.

## Runtime-Flow Proof

The required provider-boundary proof should use the deterministic fake ACP agents that already implement the third-party SDK server side.
This route crosses the real `@agentclientprotocol/sdk` notification path, the real NDJSON transport, the injected child-process wrapper, the event bridge, and the provider async generator.
It does not need credentials, network access, Devin service availability, or DeepSeek service availability.
It is more deterministic than a live authenticated smoke test and is suitable for CI.

The complete proof can stay layered to preserve package boundaries.
The provider tests prove ACP transport to Archon chunks.
The workflow tests prove chunks to stored transcript metadata.
The web tests prove stored rows to one rendered assistant history item.
A new cross-package test is not necessary because it would couple packages that already have narrow contracts.

An optional manual smoke test can run the existing provider spikes after the deterministic suite passes.
The manual smoke is not a release gate because it depends on external services and credentials.

## Exact Validation Commands

Run the bridge tests first to capture the red state and then the green state.

```sh
(cd packages/providers && bun test src/community/devin/event-bridge.test.ts)
(cd packages/providers && bun test src/community/deepseek/event-bridge.test.ts)
```

Run the deterministic ACP process-boundary tests.

```sh
(cd packages/providers && bun test src/community/devin/acp-client.test.ts)
(cd packages/providers && bun test src/community/deepseek/acp-client.test.ts)
```

Run the downstream contract tests when their files change or when the implementation needs full layered evidence.

```sh
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts)
```

Run the package and repository gates after the focused tests pass.

```sh
bun --filter @archon/providers test
bun run type-check
bun run lint
bun run format:check
bun run validate
```

Do not run `bun test` from the repository root because the repository instructions require package isolation.

## Research Validation

The existing Devin and DeepSeek bridge tests passed with 18 tests and 0 failures.
This result confirms that the present tests still accept assistant chunks without `textMode`.
The existing web projector and agent history tests passed with 35 tests and 0 failures.
This result confirms that the downstream delta projection and execution-boundary behavior already work.

## Risks and Non-Goals

- The fix changes how new transcript rows render, but it does not rewrite historical rows.
- The fix does not merge across tool rows, attempts, retries, or loop occurrences because existing execution and non-text boundaries stop anonymous grouping.
- The fix does not change structured-output parsing because both ACP clients already concatenate assistant content separately in `packages/providers/src/community/devin/acp-client.ts:289-291` and `packages/providers/src/community/deepseek/acp-client.ts:271-273`.
- The fix does not change node output because the executor already concatenates every assistant chunk.
- The fix does not correct platform batch formatting because that path does not read `textMode`.
- A future ACP version could add stable message or block identifiers, but the current change must not predict that contract.
- The implementation must update every exact object assertion in both ACP client test files that currently expects an assistant chunk without the new field.

## Unresolved Questions

No implementation-blocking question remains for new workflow transcript rows.
Product direction is required only if the scope expands to historical transcript repair or to non-web platform message formatting.
