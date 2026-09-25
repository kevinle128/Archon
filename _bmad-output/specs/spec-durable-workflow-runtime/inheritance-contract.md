# Agent Node Room inheritance contract

Agent Node Room remains independently versioned and unmodified. Durable Workflow Runtime consumes its accepted behavior as a predecessor contract and changes only the execution mechanism needed to make that behavior durable.

## Authority and precedence

- Agent Node Room owns transcript meaning, control wording, accessibility, operator attribution, provider steering behavior, and the distinction between Stop and Cancel.
- Durable Workflow Runtime owns managed worker lifecycle, cross-process routing, execution epochs, durable recovery checkpoints, recovery classification, and recovery actions.
- If the two contracts disagree, Durable Workflow Runtime prevails only for the mechanism clauses explicitly listed as superseded below. Every unlisted Agent Node Room rule remains binding.
- The predecessor's current implementation status does not weaken its contract. Planning must express dependencies rather than copying unfinished work into this feature.

## Compatibility map

| Predecessor contract                                                   | Treatment                              | Durable runtime rule                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Transcript, tool rows, todo strip, occurrence groups, operator rows    | Inherited unchanged                    | Recovery emits data through the same shared projection; it does not add a parallel transcript model.                                       |
| `Queue`, `Withdraw`, `Stop`, `Send now`, keepalive                     | Inherited unchanged                    | Commands may cross a process boundary, but user-visible meanings, authorization, ordering, and idempotency stay the same.                  |
| Stop interrupts the current turn while the node stays `running`        | Inherited unchanged                    | Recovery does not convert Stop into Cancel, pause, or rollback.                                                                            |
| Multi-turn continuation on one provider session                        | Inherited and extended                 | The same continuity contract also applies after a recoverable executor loss when a durable provider checkpoint exists.                     |
| Operator identity and `message_id` correlation                         | Inherited unchanged                    | Durable command storage retains the same identity and correlation keys.                                                                    |
| API-process executor ownership                                         | Superseded                             | A managed executor is independent of the API process.                                                                                      |
| Process-local live-handle reachability                                 | Superseded for managed workers         | The API routes resolve and command the owning managed worker across the control boundary.                                                  |
| `422 not_steerable_here` for detached execution                        | Narrowed                               | It remains valid for legacy, external, or otherwise unmanaged executors; it is not the normal result for an Archon-managed worker.         |
| Queued guidance dies on server restart                                 | Superseded                             | Accepted guidance survives API restart and is reconciled after worker failure.                                                             |
| Server restart drops the provider session                              | Superseded                             | API restart does not own or terminate the provider process; executor loss uses the recovery contract.                                      |
| No durable steering state or attempt key                               | Superseded only as a storage mechanism | Durable command and execution identity may be added; the established Agent Node Room interaction model does not change.                    |
| Thirty-minute idle-after-interrupt expiry retries with a fresh session | Preserved                              | That expiry is an intentional steering failure, not an involuntary runtime crash. Durable recovery does not silently change its semantics. |
| Cancel is the separate teardown operation                              | Inherited unchanged                    | Recovery cannot reinterpret Cancel as resumable interruption.                                                                              |

## Delivery boundary

Core managed execution, ownership, checkpointing, and recovery can be built independently. Cross-process Queue/Withdraw/Stop/Send now integration depends on the corresponding Agent Node Room contracts being implemented. Recovery UI extends the shared node-state projection and every node-room surface supported by Agent Node Room at integration time; it does not create a third renderer.
