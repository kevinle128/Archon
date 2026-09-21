# Steering test plan

This plan verifies Agent Node Room CAP-8 through CAP-13, CAP-15, and CAP-18.
It owns acceptance evidence for Stories 7.1 through 7.5, Stories 8.1 through 8.8, and Stories 9.1 through 9.4.
The readable transcript plan owns CAP-1 through CAP-7, CAP-14, CAP-16, CAP-17, and CAP-19 through CAP-21.

Run focused tests first.
Run affected package tests next.
Run `bun run check:schema-upgrades` against PostgreSQL for the additive steering schema.
Run `bun run validate` before delivery.
Never run `bun test` directly from the repository root.

## Fixture rules

Provider tests use deterministic fixtures built from the installed SDK types and measured provider payloads.
The normal test suite does not require live network access.
Timer tests use an injected scheduler and do not wait for production timeouts.
Restart E2E tests use a real server process, retain the same database across restart, and stop every process they start.

## Durable steering store — Stories 7.1 through 7.4

- SQLite and PostgreSQL persist author-scoped drafts, node-scoped queue entries, FIFO position, delivery intent, delivery state, timestamps, failure evidence, and durable auto-send settings.
- concurrent queue writes receive one transactionally assigned server order with no duplicate position.
- a repeated caller-stamped `message_id` returns the existing receipt and does not add a second queue entry.
- withdrawal of a queued entry removes it, and withdrawal of a dispatched, delivered, or unknown identifier is an idempotent no-op.
- a queue acknowledgement is returned only after the durable transaction commits.
- a failed transaction leaves the queue, transcript, and delivery state unchanged.
- a draft is private to its author, while the node queue is shared by permitted users and retains the author on each record.
- fresh-install, upgrade, and reapply tests pass for both database dialects, and the schema parity test reports no unlisted difference.

## Restart recovery — Story 7.4

- a saved draft, queue order, delivery state, and auto-send setting remain after the server process restarts.
- the restarted server reports `recovery_required` when no live turn handle exists for a durable non-terminal node.
- the UI is read-only in recovery state and says `restored after server restart · Resume the workflow to continue`.
- the server does not mark the lost turn completed, failed, cancelled, or abandoned.
- the server does not resend an entry whose dispatch result is ambiguous.
- the existing Resume action starts continuation and reconnects the restored durable state to a new live turn.
- no automatic resume occurs during server startup.

## Durable auto-send — Story 7.5

- enabling auto-send persists the setting and is visible to another permitted observer.
- after a natural agent reply, exactly one eligible FIFO entry is claimed and dispatched.
- Stop does not trigger auto-send.
- a failed automatic dispatch returns the entry to the front of the queue with failure evidence.
- a restart preserves the setting and queue without dispatching until the user uses the existing Resume action.

## Provider-neutral turn control — Stories 8.1 and 8.2

- each turn receives a fresh `AbortController`, and its signal reaches the provider through `AgentRequestOptions.interruptSignal`.
- the node-level `abortSignal` remains separate and is not aborted by Stop.
- Stop ends the current turn while the node, workflow run, and provider session remain available.
- a thinking turn and a turn executing a tool both stop through the same action.
- the active tool becomes `interrupted`, completed side effects remain in place, and no rollback runs.
- the next turn uses the same provider session or thread when that provider supports continuation.
- repeated Stop requests for the same ended turn are idempotent.
- the provider interface does not gain a `cancel()` method.

## Provider conformance — Stories 8.3 through 8.7 and 9.1 through 9.4

Each provider fixture proves that Stop reaches its native interrupt or stream-abort path, ends only the current turn, records an interrupted active tool when applicable, and permits a follow-up turn on the existing session contract.

- Claude proves Stop, soft injection, and delivery acknowledgement correlated by `message_id`.
- Codex proves turn-stream abort and continuation on the existing thread or session.
- Grok proves Stop and soft injection.
- DeepSeek proves Stop and continuation after its provider-specific aborted result.
- OMP proves Stop, its thrown abort classification, and soft injection.
- Qoder CLI proves Stop and redirect behavior through its adapter contract.
- Pi proves Stop and redirect behavior through its adapter contract.
- GitHub Copilot proves Stop and redirect behavior through its adapter contract.
- OpenCode proves Stop and redirect behavior through its adapter contract.

The conformance table fails when a provider advertises a capability that its adapter fixture does not prove.

## Redirect and delivery — Stories 8.3, 8.5, 8.7, and 8.8

- Claude, Grok, and OMP show per-item `Send now` only when their verified capability reports soft injection.
- queue-only providers do not render per-item `Send now`.
- a successful soft injection retains FIFO order and the original author identity.
- providers with delivery acknowledgement advance a correlated entry through the verified delivery states.
- providers without delivery acknowledgement stop at the last state their adapter can prove.
- an acknowledgement with the wrong or missing `message_id` cannot advance another entry.
- the UI reads capability data and does not branch on provider names.

## Typed routes and authorization

The route contract is defined in `steering-api-contract.md`.

- authenticated draft read, write, and clear operations enforce author ownership.
- queue read, queue write, withdrawal, per-item Send now, auto-send, and Stop enforce the existing run authorization rules.
- malformed input returns 400, missing resources return 404, terminal nodes return typed 409 `node_finished`, and lost live execution returns typed 409 `recovery_required`.
- a missing live handle is never classified as detached execution.
- every rejected request leaves durable steering rows, transcript rows, and live execution unchanged.
- generated OpenAPI types match every request and response schema used by both Web clients.

## Transcript receipts and ordering

- the executor is the only writer of delivered operator transcript rows.
- each operator row retains `origin='operator'`, `operator_user_id`, and `message_id`.
- the server sequence places the operator row between the turn it redirected and the turn it caused.
- durable queue state is the delivery control plane, and the transcript row is the audit receipt after delivery.
- ambiguous dispatch remains explicit and is never converted to delivered without evidence.

## Both Node Room shells

- Legacy at 460 pixels and Console at 520 pixels show the same draft, queue, delivery, auto-send, recovery, Stop, and redirect behavior.
- queued content says that it is saved on the server.
- draft content says that it is saved on the server for the author.
- Stop copy says that it ends the current turn and that files already written remain written.
- the stopping transient prevents duplicate activation without removing the focused control from the accessibility tree.
- focus moves to the correct dock or transcript target after a state change and never falls to `<body>`.
- `Enter` inserts a newline and does not send.
- delivery failures use one assertive alert, while ordinary state changes use the polite status region.
- reduced-motion behavior and colour-independent statuses remain intact.

## Acceptance exclusions

This plan does not test changes to the completed historical Cancel feature.
This plan does not define individual-tool cancellation because Stop ends the current turn.
This plan does not define Agent Node Room behavior for CLI `--detach`.
