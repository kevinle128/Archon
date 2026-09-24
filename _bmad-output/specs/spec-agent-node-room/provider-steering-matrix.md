# Provider steering matrix

This matrix shows how each of the five providers in use takes an operator's message into a **running session**, and how it lets us interrupt that session — both **without stopping the node**.
Read the two operations on three axes:

- **Interrupt the agent's generation (CAP-9)** — universal.
  Every provider can be interrupted: Claude has a native keep-alive `interrupt()`, and every other provider gets a **stream-abort on the executor's `AbortController`** that ends the turn while the session/thread survives for a follow-up run.
  No provider is disqualified from interrupt.
- **Soft-inject mid-turn (CAP-12)** — current for Claude and OMP.
  Their open streams fold a selected queued message into the running turn with no interrupt.
  Other providers keep the same visible per-item `Send now` action but return a clear capability refusal and leave the item queued.
  `Queue` remains the universal boundary-delivery path.
- **Confirm delivery (CAP-13)** — current for Claude after the required SDK bump.
  The interface changes `sent` to `delivered` only after an exact message-id confirmation.

Every row is evidence, and the **Verified** column says what kind — the citations live in the three `plans/reports/` companions.

## The five

| Provider     | Interrupt (CAP-9)                                                              | Soft-inject mid-turn (CAP-12)                    | Confirms (CAP-13) | Verified                        |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------- | ------------------------------- |
| **omp**      | stream-abort (native check-between-tool-calls not exercised _as an interrupt_) | **yes** — native `steer` command in RPC mode     | no                | **Current G4 conformance work** |
| **claude**   | native `interrupt()` (in the pinned SDK)                                       | **yes** — streaming input                        | **yes\***         | **Current G1/G2 release work**  |
| **codex**    | stream-abort → re-run resumed thread (`resumeThread`)                          | no — `turn/steer` is app-server, not the TS SDK  | no                | **Web-verified (settled NO)**   |
| **deepseek** | native cancel-and-continue (31 ms, partial retained)                           | no — a concurrent prompt is rejected in 2 ms     | no                | **Measured**                    |
| **grok**     | stream-abort (`interject` unreachable to us)                                   | advertised hooks `pre_tool_use`, never exercised | no                | **Advertised + measured**       |

**\*Claude confirmation requires `@anthropic-ai/claude-agent-sdk ≥ 0.3.246`.**
G1 makes that dependency upgrade current release work.
Until the upgrade and exact-id confirmation land, the message remains `sent`.

**Read the table by axis, not by a yes/no gate.**
Interrupt is universal; every provider can end the current generation and keep the session alive, though the mechanism differs.
Soft-inject is current for Claude and OMP through G2 and G4.
Only Claude confirms arrival through current-scope G1.
Grok hooks remain deferred as G3 because no approved mockup shows them.
No provider is excluded from Queue or interrupt-then-deliver.

## Per-provider notes that change what gets built

### omp — cheapest, with two traps

`steer` is its **default** streaming behaviour, and its RPC mode emits the same event vocabulary the existing parser already reads, wrapped in an envelope.
Its interrupt mode is documented as checking for pending steering between tool calls, and pending steering can abort the remaining tool calls of a turn.

**Trap 1 — use RPC mode, never its ACP mode.**
ACP mode _implicitly cancels_ a running turn when a new prompt arrives; the source comment says so outright, calling it identical to an explicit cancel.
It looks like steering and behaves like a stop.
This is the single most likely wrong turn in the whole feature, because ACP is the more standard-looking of the two doors.

**Trap 2 — the steering queue defaults to one-at-a-time.**
`steeringMode` defaults to `"one-at-a-time"`, so sending a queue of three messages does not deliver three.
CAP-10's ordering promise needs `set_steering_mode: "all"` or explicit per-item sequencing; it is not free.

Two smaller notes: send `negotiate_protocol` with `protocolVersion: 2` immediately or stdout frames above 1 MiB are lossy, and the event stream carries **no steer-specific event** — so omp cannot confirm delivery either.

### claude — the only one that can confirm delivery, and native interrupt is in the pin

`interrupt()` is documented as available **only in streaming input mode**, so the soft-inject transport and the interrupt capability arrive together — and both are **already in the pinned 0.3.209** (interrupt ≥ 0.3.205, `AsyncIterable` input ≤ 0.3.142).
Therefore, neither CAP-9's interrupt nor CAP-12's soft-inject needs an SDK upgrade.

This is also the one provider that can satisfy CAP-13.
A caller-set `uuid` on the user message is echoed on the result, the turn's first reply, and thinking frames after the SDK reaches **0.3.246**.
G1 makes that upgrade a current release prerequisite.
G2 makes the streaming `AsyncIterable` plus resume conformance spike and implementation current release work.
The interface must not show `delivered` before the exact id arrives.

One caution on wording comes from Aion, which owns the raw stdin that we would not own: even with full frame control, they never got _guaranteed_ mid-turn folding — a pure-text turn opens a follow-up turn after its result.
The copy must not promise "immediate".

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
It is G3 and stays deferred because the approved mockups do not show Grok soft-inject.
Until G3 is separately approved, Grok keeps the visible per-item action in a clear refusal state and remains interrupt-then-continue only.

A second door exists and is unexplored: the **leader socket** (`~/.grok/leader.sock`, `grok agent leader`, `--leader` — "multiple clients share one backend").
It is the only channel found anywhere in this research that reaches a session the caller did not spawn, which makes it the one lead worth keeping if steering must reach runs the server did not start (the deferred detached case).

### deepseek — interrupt is cheap; soft-inject is what it refuses

A second prompt while one is in flight is **rejected in 2 ms** with `-32602 invalid params: a prompt is already in flight for this session` — measured, not inferred.
That rejection is a **transport fact, not a contract incapacity**: DeepSeek will not accept a _concurrent_ prompt (no soft-inject), but the operator's message still reaches the agent as the next turn (`Queue`).
Interrupting is cheap: DeepSeek **cancel-and-continues on the warm connection — measured 31 ms, partial output retained** — which is exactly CAP-9's interrupt (end the turn, session alive).
On DeepSeek, the operator interrupts to cut wrong work immediately (CAP-9), then sends the redirect; `Queue` is the non-interrupting alternative when they are content to let the turn finish.

(DeepSeek's own runtime has a real steering inbox that is not exposed on the protocol we speak; that ceiling is a bridge gap, a legitimate upstream ask, and not something to schedule around.)

## The convergence worth designing around

Three soft-inject mechanisms deliver at the **same point** — the next tool-call boundary.
OMP checks for steering between tool calls, Grok blocks at `pre_tool_use`, and Claude's hook contract has the same shape.
That is not a coincidence; it is the natural rest point of an agent loop.

The seam takes **"deliver at the next boundary"** as its default meaning (`Queue`), with mid-turn soft-inject as the acceleration and interrupt-then-deliver as the operator's immediate option.
Modelling it the other way round — interrupt first, boundary delivery as a degraded mode — inverts the common case into the exception.

## Correlating a soft-inject to its turn

There is **no durable attempt-key** in this model.
A soft-inject targets the live turn through the registry's in-memory turn id, held on the live handle only while the node runs in-process.
If the target turn ends while an accepted soft-inject is landing, it folds into the node's next turn rather than disappearing.
Every mutation also carries the selected `retry_epoch`; a stale epoch fails closed before the provider call.
A finished node returns 409, a detached run returns `not_steerable_here`, and a provider without soft-inject returns `soft_inject_unavailable` while leaving the item queued.
Correlation for `delivered` is by the caller-stamped id, never text or timestamp.
