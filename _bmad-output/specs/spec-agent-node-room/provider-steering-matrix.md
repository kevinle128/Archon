# Provider steering matrix

This matrix shows how each of the five providers in use takes an operator's message into a **running session**, and how it lets us interrupt that session — both **without stopping the node**.
Read the two operations on three axes:

- **Interrupt the agent's generation (CAP-9)** — universal.
  Every provider can be interrupted: Claude has a native keep-alive `interrupt()`, and every other provider gets a **stream-abort on the executor's `AbortController`** that ends the turn while the session/thread survives for a follow-up run.
  No provider is disqualified from interrupt.
- **Soft-inject mid-turn (CAP-12)** — current approved behavior on an Archon adapter and mode that prove it.
  Claude streaming input, Grok live input, and OMP RPC are G2, G3, and G4 release proof gates, not capabilities already established in Archon's current adapters.
  Queue-only modes omit the per-item `Send now` action; direct unsupported requests refuse without queue mutation.
  `Queue` remains the universal boundary-delivery path.
- **Confirm delivery (CAP-13)** — current approved behavior after causal proof of agent consumption.
  A matching native lifecycle event or a stream causally tied to the selected message can prove it; an RPC acknowledgement or unrelated stream cannot.

Every row is evidence, and the **Verified** column says what kind — the citations live in the three `plans/reports/` companions.

## The five

| Provider     | Interrupt (CAP-9)                                                              | Archon live-turn path (CAP-12)                                                              | Consumption proof (CAP-13)                    | Release gate                                                                                                       |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **omp**      | stream-abort (native check-between-tool-calls not exercised _as an interrupt_) | Current Archon `--mode json` is one-shot; RPC `steer` is a candidate.                       | Unknown until causally tested.                | G4 active-turn and G1 status proof.                                                                                |
| **claude**   | native `interrupt()` (in the pinned SDK)                                       | Current `AsyncIterable` holds one input for interrupt; adding another is unproved.          | Unknown for the selected message.             | G2 active-turn and G1 status proof.                                                                                |
| **codex**    | stream-abort → re-run resumed thread (`resumeThread`)                          | TS `runStreamed()` is one-shot; current mode is queue-only.                                 | No current live-turn proof.                   | Omit per-item action.                                                                                              |
| **deepseek** | native cancel-and-continue (31 ms, partial retained)                           | ACP concurrent prompt rejects; current mode is queue-only.                                  | No current live-turn proof.                   | Omit per-item action.                                                                                              |
| **grok**     | stream-abort (`interject` unreachable to us)                                   | Archon `--single` is queue-only; hooks are an unproved candidate for a new live-input path. | No current live-turn or causal receipt proof. | G3 same-turn and G1 receipt proof are required for release; omit the action on `--single` and every unproved mode. |

An SDK update may expose a matching lifecycle event, but a version alone does not prove active-turn injection or agent consumption.
An accepted item remains `sent` until causal consumption evidence arrives.

**Read the table by axis, not by a yes/no gate.**
Interrupt is universal; every provider can end the current generation and keep the session alive, though the mechanism differs.
Soft-inject is current approved behavior through provider paths that pass G2, G3, and G4 conformance.
G1 requires truthful consumption proof on that path.
The user requires Grok per-item Send now during the active turn in this release, so another provider's proof cannot satisfy G3.
Archon's current `--single` mode stays queue-only until a new Grok path passes the same-turn and causal receipt gates.
No provider is excluded from Queue or interrupt-then-deliver.

## Per-provider notes that change what gets built

### omp — cheapest, with two traps

`steer` is an OMP RPC candidate, while Archon's current adapter spawns one-shot `omp --mode json -- <prompt>`.
The RPC mode must be built and exercised in Archon before the per-item action appears.
Its interrupt mode is documented as checking for pending steering between tool calls, and pending steering can abort the remaining tool calls of a turn.

**Trap 1 — use RPC mode, never its ACP mode.**
ACP mode _implicitly cancels_ a running turn when a new prompt arrives; the source comment says so outright, calling it identical to an explicit cancel.
It looks like steering and behaves like a stop.
This is the single most likely wrong turn in the whole feature, because ACP is the more standard-looking of the two doors.

**Trap 2 — the steering queue defaults to one-at-a-time.**
`steeringMode` defaults to `"one-at-a-time"`, so sending a queue of three messages does not deliver three.
CAP-10's ordering promise needs `set_steering_mode: "all"` or explicit per-item sequencing; it is not free.

Two smaller notes: test `negotiate_protocol` with `protocolVersion: 2` for frame size, and establish whether the actual Archon RPC event stream exposes causal consumption evidence.
An RPC command acknowledgement establishes transport acceptance and `sent` only.

### claude — candidate lifecycle confirmation, and native interrupt is in the pin

`interrupt()` uses streaming input in the current pinned SDK 0.3.209, but Archon's `AsyncIterable` currently supplies one message and remains open for interrupt.
A second selected message entering the same active turn is not yet proven.

An SDK with a matching user-message lifecycle event is one possible G1 proof path.
G2 requires the selected input to enter the same active turn during both tool-boundary and pure-text cases, without Stop or another turn.
G1 also accepts a response stream when it is causally linked to the selected message; unrelated ongoing output does not qualify.

Evidence from Aion does not establish Archon's Claude behavior.
If the pure-text case cannot enter the active turn, the Archon mode does not pass the per-item gate.

### codex — no soft-inject on the TypeScript SDK; interrupt is stream-abort then resume

`turn/steer` is documented as a **soft injection** into the active turn — but as an **app-server protocol** method, not a TypeScript SDK affordance.
Codex's `thread.turn(...)` → `TurnHandle.steer()` appears in the **Python** SDK reference only.

Archon is on the TypeScript side: `@openai/codex-sdk` (a caret `^0.144.5`; the lockfile pins **0.144.5** and the caret has not floated — npm latest is 0.154.0), calling `thread.runStreamed(prompt, turnOptions)` (`packages/providers/src/codex/provider.ts:1093`) — the one-shot form.
**Web-verified this session:** the shipped `.d.ts` at 0.144.5, at 0.153.4, and at latest 0.154.0 all expose only `run()`/`runStreamed()`; there is no `turn()`/`steer()`, and issue #12329 closes the request with "use app-server, not the SDK."
Therefore, Codex has **no soft-inject**: an operator message is delivered as the next turn (`Queue`).
Its **interrupt** path is the universal one — a stream-abort ends the turn, then the executor re-runs on the resumed thread: `codex.resumeThread(sessionId)` (`packages/providers/src/codex/provider.ts:1006`, verified), which the adapter already calls, with a `startThread` fallback on resume failure.

### grok — not the method its own client uses

`x.ai/interject` is **not reachable** by a third-party client.
Over `grok agent stdio`, it answers `-32601 Method not found`, identical to the answer given to a method invented as a control.
The handshake settled this result without a model call.
Therefore, Grok's interrupt is the universal **stream-abort**, not a native primitive.

The hooks extension advertised by the handshake remains a possible soft-inject channel.
Archon's current `grok --single` adapter exposes no live-input port and stays queue-only, with no per-item action.
The advertised hook is not an Archon capability until a reachable path passes the same active-turn gate.
G3 requires a real Grok path to accept exactly the selected queued item during the active turn without Stop, a natural-end wait, or another turn.
Prove tool-boundary and pure-text cases through the actual Archon adapter, and prove causal agent receipt independently from transport acceptance before exposing the action.
If hooks cannot meet that gate, prove another Grok path or block release; do not silently fall back to Queue or a new turn.

A second door exists and is unexplored: the **leader socket** (`~/.grok/leader.sock`, `grok agent leader`, `--leader` — "multiple clients share one backend").
It is the only channel found anywhere in this research that reaches a session the caller did not spawn, which makes it the one lead worth keeping if steering must reach runs the server did not start (the deferred detached case).

### deepseek — interrupt is cheap; soft-inject is what it refuses

A second prompt while one is in flight is **rejected in 2 ms** with `-32602 invalid params: a prompt is already in flight for this session` — measured, not inferred.
That rejection is a **transport fact, not a contract incapacity**: DeepSeek will not accept a _concurrent_ prompt (no soft-inject), but the operator's message still reaches the agent as the next turn (`Queue`).
Interrupting is cheap: DeepSeek **cancel-and-continues on the warm connection — measured 31 ms, partial output retained** — which is exactly CAP-9's interrupt (end the turn, session alive).
On DeepSeek, the operator interrupts to cut wrong work immediately (CAP-9), then sends the redirect; `Queue` is the non-interrupting alternative when they are content to let the turn finish.

(DeepSeek's own runtime has a real steering inbox that is not exposed on the protocol we speak; that ceiling is a bridge gap, a legitimate upstream ask, and not something to schedule around.)

## The convergence worth designing around

Tool-call boundaries are candidates for provider live input, but each Archon adapter must prove the selected message enters its current turn.

The seam takes **"deliver at the next boundary"** as its default meaning (`Queue`), with mid-turn soft-inject as the acceleration and interrupt-then-deliver as the operator's immediate option.
Modelling it the other way round — interrupt first, boundary delivery as a degraded mode — inverts the common case into the exception.

## Correlating a soft-inject to its turn

There is **no durable attempt-key** in this model.
A soft-inject targets the live turn through the registry's in-memory turn id, held on the live handle only while the node runs in-process.
If the turn ends, Stop lands, or the selected epoch changes before proven active-turn acceptance, the request must preserve the item or report an explicit unresolved result; it must not silently fold into the next turn.
Every mutation also carries the selected `retry_epoch`; a stale epoch fails closed before the provider call.
A finished node returns 409, a detached run returns `not_steerable_here`, and a provider without soft-inject returns `soft_inject_unavailable` while leaving the item queued.
The caller-stamped id remains the row and idempotency key.
The provider port returns a typed acceptance result for `sent`; a matching native lifecycle event or causally linked stream proves `delivered`.
An uncertain timeout does not permit blind reinjection, and a transcript-write failure after acceptance does not return the item to a sendable queue.
