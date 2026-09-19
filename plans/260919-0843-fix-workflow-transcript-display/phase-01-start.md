---
phase: 1
title: 'Provider delta boundaries'
status: pending
priority: P1
effort: 'small'
dependencies: []
---

# Phase 1: Provider delta boundaries

## Outcome

Devin and DeepSeek describe ACP assistant text with the existing delta contract, so downstream persistence and projection no longer treat each token or word as a complete assistant message.

## Context links

- [Provider stream contract research](./research/researcher-02-provider-stream-contract.md)
- [Runtime-flow and E2E research](./research/researcher-03-e2e-tdd-runtime-flow.md)
- `packages/providers/src/types.ts`
- `packages/web/src/lib/project-text-transcript.ts`

## Requirements

- Label every text-valued ACP `agent_message_chunk` from Devin and DeepSeek as `textMode: 'delta'`.
- Keep thought chunks, replay suppression, tool events, usage handling, structured-output parsing, chunk order, and content unchanged.
- Do not invent stream IDs or buffer chunks in provider state.
- Do not merge or rewrite historical transcript rows that have no `text_mode`.
- Preserve separation across tool rows, attempts, retries, and loop occurrences through the existing projector boundaries.
- Rotate the loop transcript attempt before both invalid-output and missing-output structured re-asks so anonymous deltas from two responses cannot concatenate.

## Runtime flow

1. The real ACP SDK client receives ordered `session/update` notifications.
2. The provider event bridge maps each text notification to an assistant `MessageChunk` with `textMode: 'delta'`.
3. Direct and loop executor paths persist the value as `metadata.text_mode` with the existing execution identity.
4. The API returns the immutable rows unchanged.
5. `projectTextTranscript()` joins only compatible delta rows and stops at non-text or execution boundaries.

## Files

| File                                                             | Action          | Change                                                                                                                         |
| ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/providers/src/community/devin/event-bridge.test.ts`    | Modify first    | Require delta mode for mapped assistant chunks and replay recovery.                                                            |
| `packages/providers/src/community/deepseek/event-bridge.test.ts` | Modify first    | Require the same delta contract.                                                                                               |
| `packages/providers/src/community/devin/acp-client.test.ts`      | Modify first    | Send two notifications through the fake ACP process and assert ordered deltas and terminal result order.                       |
| `packages/providers/src/community/deepseek/acp-client.test.ts`   | Modify first    | Prove the same real SDK and NDJSON boundary.                                                                                   |
| `packages/providers/src/community/devin/event-bridge.ts`         | Modify          | Add the existing `textMode: 'delta'` field.                                                                                    |
| `packages/providers/src/community/deepseek/event-bridge.ts`      | Modify          | Add the same field.                                                                                                            |
| `packages/workflows/src/dag-executor.test.ts`                    | Modify first    | Prove direct and loop delta persistence, and prove invalid-output and missing-output re-asks use distinct transcript attempts. |
| `packages/workflows/src/dag-executor.ts`                         | Modify          | Rotate the loop transcript attempt in the missing structured-output re-ask branch.                                             |
| `packages/web/src/lib/project-text-transcript.test.ts`           | Regression only | Re-run existing anonymous delta, tool-boundary, occurrence, and attempt tests.                                                 |

## Function and interface checklist

- `mapDevinSessionUpdate()` remains the Devin owner.
- `mapDeepseekSessionUpdate()` remains the DeepSeek owner.
- `MessageChunk` needs no signature or type change.
- `dag-executor.ts` changes only at the loop missing-output re-ask boundary; transcript storage, server routes, and the projector need no production change in this phase.

## Tests Before

1. Change the exact bridge expectations to require `textMode: 'delta'` and record the current failures.
2. Make each fake ACP process send `Hel` and `lo` as separate message chunks.
3. Assert that the client yields two ordered delta chunks whose concatenated content is `Hello`, followed by the unchanged terminal result.
4. Add failing executor tests that require `metadata.text_mode: 'delta'` on persisted direct and loop chunks.
5. Add failing loop tests that send an invalid structured response or no structured response before a valid re-ask and require distinct transcript attempts.

## Implementation steps

1. Add `textMode: 'delta'` to the two assistant objects returned for ACP message chunks.
2. Update every affected exact object assertion in both ACP client suites.
3. Call `newTranscriptAttempt()` in the loop missing-output re-ask branch before the next provider pass.
4. Confirm that structured-output accumulation still concatenates provider text independently inside each provider pass.
5. Confirm that no new state, identifier, database field, or UI heuristic was introduced.

## Refactor

Do not extract a shared ACP mapper because the two bridges have different state and tool semantics.
Keep the change as one explicit field in each existing mapping branch.

## Tests After

```bash
(cd packages/providers && bun test src/community/devin/event-bridge.test.ts)
(cd packages/providers && bun test src/community/devin/acp-client.test.ts)
(cd packages/providers && bun test src/community/deepseek/event-bridge.test.ts)
(cd packages/providers && bun test src/community/deepseek/acp-client.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/web && bun test src/lib/project-text-transcript.test.ts src/lib/agent-history.test.ts)
```

## Test scenario matrix

| Scenario                              | Expected result                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Two Devin message chunks              | Two ordered delta chunks.                                                                         |
| Two DeepSeek message chunks           | Two ordered delta chunks.                                                                         |
| Thought and tool updates              | Existing types and boundaries remain unchanged.                                                   |
| Loaded Devin session replay           | Replayed messages remain suppressed; the first new message is a delta.                            |
| Tool between delta groups             | Web projection creates two assistant blocks.                                                      |
| New attempt or loop occurrence        | Anonymous delta groups remain separate.                                                           |
| Direct structured-output re-ask       | Persisted deltas keep distinct attempt identities.                                                |
| Loop invalid structured-output re-ask | Persisted deltas keep distinct attempt identities.                                                |
| Loop missing structured-output re-ask | The attempt rotates before the valid retry, so failed and valid response text cannot concatenate. |

## Risks and controls

- A missing execution boundary could merge turns, so existing occurrence and attempt projector tests are mandatory.
- A provider buffer could change tool ordering, so buffering is prohibited.
- A historical repair heuristic could merge valid complete rows, so old untagged rows remain unchanged.
- Platform batch delivery still joins chunks independently and is not claimed by this phase.

## Security considerations

The change adds no new input surface, permission, secret, or persistence.
Tests must not log credentials or require live provider accounts.

## Regression Gate

- [ ] Both bridge tests fail before production changes and pass after them.
- [ ] Both deterministic ACP client tests cross the real SDK and child-process boundary.
- [ ] Direct and loop executor tests prove persisted delta metadata and re-ask attempt isolation.
- [ ] Structured-output parsing, tool ordering, replay behavior, and terminal result order are unchanged.
- [ ] Existing projector execution-boundary tests stay green.

## Todo

- [ ] Add RED bridge and ACP client assertions.
- [ ] Add RED direct and loop persistence and re-ask boundary assertions.
- [ ] Add delta mode in both provider bridges.
- [ ] Rotate the loop attempt in the missing structured-output re-ask branch.
- [ ] Run focused provider and projector suites.
- [ ] Record executor persistence proof for Phase 2 E2E evidence.

## Success criteria

Every new Devin and DeepSeek transcript row carries the correct provider-known delta boundary, and no unrelated provider or downstream production contract changes.

## Rollback

Revert the two bridge fields, the loop missing-output attempt rotation, and their test expectations if their provider or executor contracts fail.
