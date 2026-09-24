# Provider steering matrix

This matrix defines current implementation obligations for every approved provider.

It separates three capabilities that must not be conflated.

- Stop ends the current turn and keeps the node active.
- Soft injection delivers one queued item into an active turn without stopping it.
- Delivery acknowledgement proves that the provider accepted a stamped message id.

Queue-at-boundary remains supported on every provider.

Soft injection and delivery acknowledgement appear only when adapter conformance proves them.

## Capability contract

| Provider | Stop implementation | Session continuation | Soft injection | Delivery acknowledgement | Current story |
| --- | --- | --- | --- | --- | --- |
| Claude | SDK-native query interrupt through interruptSignal | Resume the existing Claude session | Streaming input, subject to conformance in the current story | Stamped message-id echo after the required SDK update | 8.3 |
| Codex | Abort the active streamed turn through interruptSignal | Resume the existing Codex thread | Not exposed by the current TypeScript SDK path | Not currently exposed | 8.4 |
| Grok | Adapter stream abort through interruptSignal | Continue the existing Grok session | Verified hook path | Not currently exposed | 8.5 |
| DeepSeek | Provider-native turn abort through interruptSignal | Continue the warm ACP session | Concurrent prompt is not accepted | Not currently exposed | 8.6 |
| OMP | RPC-mode turn interruption through interruptSignal | Continue the existing RPC session | RPC steering with all-item ordering | Not currently exposed | 8.7 |
| Qoder CLI | Adapter-specific Stop mapping required | Preserve or re-establish the documented session | Expose only if conformance proves it | Expose only if conformance proves it | 9.1 |
| Pi | Adapter-specific Stop mapping required | Preserve or re-establish the documented session | Expose only if conformance proves it | Expose only if conformance proves it | 9.2 |
| GitHub Copilot | Adapter-specific Stop mapping required | Preserve or re-establish the documented session | Expose only if conformance proves it | Expose only if conformance proves it | 9.3 |
| OpenCode | Adapter-specific Stop mapping required | Preserve or re-establish the documented session | Expose only if conformance proves it | Expose only if conformance proves it | 9.4 |

The provider registrations and capability declarations in packages/providers are the executable owners after implementation.

This document owns the product rule that an unverified capability must remain false while its implementation story is active.

The current story must complete the adapter and its conformance evidence before the UI advertises the action.

## Stop rules

AgentRequestOptions.interruptSignal is the only provider-neutral Stop input.

The implementation does not add cancel() to IAgentProvider.

Each call to sendQuery receives a fresh turn-level signal.

An adapter must release listeners when the turn settles.

An adapter must preserve abort results and exceptions for executor classification.

An adapter must not translate Stop into the node-level abort signal.

A successful Stop leaves the provider session reusable where the provider supports continuation.

The executor classifies a successful Stop as an operator-interrupted turn.

An active tool uses the interrupted presentation only when the adapter can prove that normalized provider status.

A Codex tool row never uses the interrupted warning glyph and uses only a Codex-supported status presentation.

Completed side effects remain in place.

## Soft-injection rules

A provider earns soft injection only after the production adapter path is exercised.

The UI then exposes per-item Send now while the agent is generating.

A queue-only provider omits that control.

A soft-injected item does not create an interrupted tool outcome.

A soft-injected item does not emit a steering-owned turn-start event.

If the target turn ends before injection is accepted, the item remains in the durable queue and follows the normal boundary or Send now rules.

OMP uses RPC mode and explicit all-item ordering.

OMP ACP behavior must not be used as soft injection because its prompt path can terminate active work.

Codex remains queue-at-boundary on the TypeScript SDK path until that executable path exposes a verified mid-turn transport.

## Delivery acknowledgement rules

Correlation uses the caller-stamped message id or another provider identifier explicitly mapped to it by the adapter.

The UI never derives delivery from matching content, elapsed time, or transcript proximity.

Claude's current story owns the SDK update and echo integration required to make delivered reachable.

Providers without acknowledgement remain at sent or delivery unknown.

## Restart behavior

Provider processes and streams are volatile.

Drafts, queued guidance, auto-send settings, and delivery state are durable.

After restart, Archon restores durable data and waits for the existing Resume action.

An ambiguous dispatch is never automatically retried.

The provider story must document whether Resume safely reuses the prior provider session or establishes a new one.

## Conformance evidence

Every provider story must prove:

1. Stop targets the intended current turn.
2. The next turn is not aborted by a stale signal.
3. The node and workflow run remain active.
4. The provider session continues where supported.
5. Abort evidence reaches the executor.
6. The declared soft-injection value matches the exercised transport.
7. The declared acknowledgement value matches provider evidence.
8. Durable queued guidance remains ordered through Stop and Resume.

Provider tests use deterministic adapter fixtures and do not depend on live network access in the normal suite.
