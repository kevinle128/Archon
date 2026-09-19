# Provider recovery matrix

Agent Node Room's provider matrix governs live steering. This matrix governs continuity after executor loss. A provider's advertised `sessionResume` flag is necessary but not sufficient: each adapter must report the observed outcome of a recovery attempt.

## Normalized outcomes

| Outcome       | Meaning                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `restored`    | The provider confirmed that the requested session/thread was resumed.            |
| `cold`        | The provider accepted the request only by starting fresh.                        |
| `unsupported` | The selected provider cannot resume this execution.                              |
| `rejected`    | The provider rejected the saved identifier or recovery request.                  |
| `unverified`  | The adapter invoked a resume path but cannot prove whether context was restored. |

Only `restored` may be described as recovered continuity. Every other outcome is visible and follows `recovery-state-contract.md`.

Automatic recovery uses a strict-resume provider path. The adapter must not turn a failed resume into a substantive fresh turn; `cold`, `unsupported`, `rejected`, and `unverified` return control to `recovery-required` before new work is dispatched.

## Initial provider scope

| Provider | Existing continuity seam                              | Current evidence                                                                                                                       | Durable-runtime requirement                                                                                                                         |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | SDK `session_id` passed back through `options.resume` | The adapter can observe the first non-empty SDK session id, but the workflow currently receives it in the terminal result path.        | Surface and persist the id when first observed; invalid resume fails visibly and never fabricates cold success.                                     |
| Codex    | SDK thread id passed to `resumeThread`                | `thread.started` reveals a new id; the current general path can start a fresh thread after resume failure and report `resumed: false`. | Checkpoint the thread id before terminal completion and provide strict recovery that reports `cold` without executing the fresh turn automatically. |
| OMP      | CLI session id with `--resume`                        | Adapter advertises resume and can report observed success/failure, but crash recovery needs conformance coverage.                      | Prove restored versus cold behavior with a killed-worker fixture before declaring warm recovery.                                                    |
| Grok     | CLI session id with `--resume`                        | Adapter advertises resume and reports an observed outcome; leader mode is separate and not assumed.                                    | Prove restored versus cold behavior; do not use the leader socket without a separate accepted design.                                               |
| DeepSeek | ACP session id on the continued session               | Adapter advertises resume and currently wraps the continuation as resumed.                                                             | Add conformance evidence that an executor-loss re-entry restores the intended logical session; otherwise report `unverified`.                       |

Other registered providers may participate only when they implement the same outcome contract and conformance fixture. A session identifier is never passed across provider boundaries.

## Checkpoint boundary

- The provider layer must expose the resumable identifier as soon as it becomes known. A terminal-only `result.sessionId` is insufficient for a process killed mid-node.
- Strict resume must separate “saved session was restored” from “fresh session was created” before a substantive recovery prompt can run automatically.
- The recovery record binds provider, session identifier, run, node occurrence, retry epoch, execution epoch, and original execution snapshot.
- Full identifiers stay out of broad workflow events and ordinary logs. Observability uses a masked preview and a typed outcome.
- Credentials are re-resolved for the original acting user, but model/provider/input/ENV choices come from the frozen run snapshot rather than current defaults.
- A provider may continue the conversation but cannot promise restoration of the exact interrupted generation. Recovery always begins at a new provider turn.
