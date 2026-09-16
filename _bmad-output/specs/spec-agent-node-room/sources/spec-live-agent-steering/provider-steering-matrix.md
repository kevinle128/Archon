# Provider steering matrix

How each of the five providers in use takes an operator's message into a **running session**, and how it lets us interrupt that session — both **without stopping the node**. Two operations, read on three axes:

- **Interrupt the agent's generation (CAP-2)** — universal. Every provider can be interrupted: claude has a native keep-alive `interrupt()`, and every other provider gets a **stream-abort on the executor's `AbortController`** that ends the turn while the session/thread survives for a follow-up run. No provider is disqualified from interrupt.
- **Soft-inject mid-turn (CAP-5)** — provider-gated. Some providers' open stream folds a message into the running turn with no interrupt; most do not, and the message is instead delivered as the next turn (`Queue`, the default). This is an _acceleration_, not a gate on whether the message arrives.
- **Confirm delivery (CAP-6)** — claude-only, and only after an SDK bump.

Every row is evidence, and the **Verified** column says what kind — the citations live in the three `plans/reports/` companions.

## The five

| Provider     | Interrupt (CAP-2)                                                              | Soft-inject mid-turn (CAP-5)                     | Confirms (CAP-6) | Verified                       |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------ | ---------------- | ------------------------------ |
| **omp**      | stream-abort (native check-between-tool-calls not exercised _as an interrupt_) | **yes** — native `steer` command in RPC mode     | no               | **Source** — its repo and docs |
| **claude**   | native `interrupt()` (in the pinned SDK)                                       | **yes** — streaming input                        | **yes\***        | **Vendor docs + web-verified** |
| **codex**    | stream-abort → re-run resumed thread (`resumeThread`)                          | no — `turn/steer` is app-server, not the TS SDK  | no               | **Web-verified (settled NO)**  |
| **deepseek** | native cancel-and-continue (31 ms, partial retained)                           | no — a concurrent prompt is rejected in 2 ms     | no               | **Measured**                   |
| **grok**     | stream-abort (`interject` unreachable to us)                                   | advertised hooks `pre_tool_use`, never exercised | no               | **Advertised + measured**      |

**\*claude "Confirms" is a capability, not a fact at the pin** — the `user_message_uuid` echo needs `@anthropic-ai/claude-agent-sdk ≥ 0.3.246`; at the inherited **0.3.209** no provider echoes, so `sent` is today's ceiling for all.

**Read the table by axis, not by a yes/no gate.** Interrupt is universal — every provider can end the current generation and keep the session alive; the mechanism differs (native primitive vs stream-abort). Soft-inject is the accelerator only claude and omp offer today. Delivery timing is otherwise the operator's `Queue`/`Send now` choice, not a provider limit. Only claude confirms arrival. None is excluded.

## Per-provider notes that change what gets built

### omp — cheapest, with two traps

`steer` is its **default** streaming behaviour, and its RPC mode emits the same event vocabulary the existing parser already reads, wrapped in an envelope. Its interrupt mode is documented as checking for pending steering between tool calls, and pending steering can abort the remaining tool calls of a turn.

**Trap 1 — use RPC mode, never its ACP mode.** ACP mode _implicitly cancels_ a running turn when a new prompt arrives; the source comment says so outright, calling it identical to an explicit cancel. It looks like steering and behaves like a stop. This is the single most likely wrong turn in the whole feature, because ACP is the more standard-looking of the two doors.

**Trap 2 — the steering queue defaults to one-at-a-time.** `steeringMode` defaults to `"one-at-a-time"`, so sending a queue of three messages does not deliver three. CAP-3's ordering promise needs `set_steering_mode: "all"` or explicit per-item sequencing; it is not free.

Two smaller notes: send `negotiate_protocol` with `protocolVersion: 2` immediately or stdout frames above 1 MiB are lossy, and the event stream carries **no steer-specific event** — so omp cannot confirm delivery either.

### claude — the only one that can confirm delivery, and native interrupt is in the pin

`interrupt()` is documented as available **only in streaming input mode**, so the soft-inject transport and the interrupt capability arrive together — and both are **already in the pinned 0.3.209** (interrupt ≥ 0.3.205, `AsyncIterable` input ≤ 0.3.142). So neither CAP-2's interrupt nor CAP-5's soft-inject needs an SDK upgrade.

This is also the one provider that can satisfy CAP-6 — in principle, and only after an SDK bump: a caller-set `uuid` on the user message is echoed back, on the result, on the turn's first reply, and on thinking frames. A string prompt — what Archon passes now — carries none, which is why no delivery signal exists today. The CAP-6 `user_message_uuid` pre-result echo needs **≥ 0.3.246**, so "Confirms? yes" is a capability, **not a fact at the current pin**; `delivered` becomes reachable (claude-only) only once that bump lands. One unverified seam remains: whether streaming (`AsyncIterable`) input composes with the resume protocol for soft-inject, which was exercised only on a string prompt — a spike, not an assumption.

One caution on wording taken from aion, which owns the raw stdin we would not: even with full frame control they never got _guaranteed_ mid-turn folding — a pure-text turn opens a follow-up turn after its result. The copy must not promise "immediate".

### codex — no soft-inject on the TypeScript SDK; interrupt is stream-abort then resume

`turn/steer` is documented as a **soft injection** into the active turn — but as an **app-server protocol** method, not a TypeScript SDK affordance. Codex's `thread.turn(...)` → `TurnHandle.steer()` appears in the **Python** SDK reference only.

Archon is on the TypeScript side: `@openai/codex-sdk` (a caret `^0.144.5`; the lockfile pins **0.144.5** and the caret has not floated — npm latest is 0.154.0), calling `thread.runStreamed(prompt, turnOptions)` (`packages/providers/src/codex/provider.ts:1093`) — the one-shot form. **Web-verified this session:** the shipped `.d.ts` at 0.144.5, at 0.153.4, and at latest 0.154.0 all expose only `run()`/`runStreamed()`; there is no `turn()`/`steer()`, and issue #12329 closes the request with "use app-server, not the SDK." So codex has **no soft-inject**: an operator message is delivered as the next turn (`Queue`). Its **interrupt** path is the universal one — a stream-abort ends the turn, then the executor re-runs on the resumed thread: `codex.resumeThread(sessionId)` (`packages/providers/src/codex/provider.ts:1006`, verified), which the adapter already calls, with a `startThread` fallback on resume failure.

### grok — not the method its own client uses

`x.ai/interject` is **not reachable** by a third-party client. Over `grok agent stdio` it answers `-32601 Method not found`, identical to the answer given to a method invented as a control. Settled by handshake; no model call. So grok's interrupt is the universal **stream-abort**, not a native primitive.

The channel that remains for soft-inject is the hooks extension the handshake **does** advertise: blocking events include `pre_tool_use`, decisions include deny and block, and the stop signals include a field carrying additional context to the agent. Same delivery point as omp, different door — but advertised is not exercised, and the exact payload shape wants one spike; until then grok is interrupt-then-continue only.

A second door exists and is unexplored: the **leader socket** (`~/.grok/leader.sock`, `grok agent leader`, `--leader` — "multiple clients share one backend"). It is the only channel found anywhere in this research that reaches a session the caller did not spawn, which makes it the one lead worth keeping if steering must reach runs the server did not start (the deferred detached case).

### deepseek — interrupt is cheap; soft-inject is what it refuses

A second prompt while one is in flight is **rejected in 2 ms** with `-32602 invalid params: a prompt is already in flight for this session` — measured, not inferred. That rejection is a **transport fact, not a contract incapacity**: deepseek will not accept a _concurrent_ prompt (no soft-inject), but the operator's message still reaches the agent as the next turn (`Queue`). And interrupting is cheap: deepseek **cancel-and-continues on the warm connection — measured 31 ms, partial output retained** — which is exactly CAP-2's interrupt (end the turn, session alive). So on deepseek the operator interrupts to cut wrong work immediately (CAP-2), then sends the redirect; `Queue` is the non-interrupting alternative when they are content to let the turn finish.

(deepseek's own runtime has a real steering inbox not exposed on the protocol we speak; that ceiling is a bridge gap, a legitimate upstream ask, not something to schedule around.)

## The convergence worth designing around

Three soft-inject mechanisms deliver at the **same point** — the next tool-call boundary. omp checks for steering between tool calls, grok blocks at `pre_tool_use`, and claude's hook contract has the same shape. That is not coincidence; it is the natural rest point of an agent loop.

So the seam takes **"deliver at the next boundary"** as its default meaning (`Queue`), with mid-turn soft-inject as the acceleration and interrupt-then-deliver as the operator's immediate option. Modelling it the other way round — interrupt first, boundary delivery as a degraded mode — inverts the common case into the exception.

## Correlating a soft-inject to its turn

There is **no durable attempt-key** in this model. A soft-inject targets the live turn through the registry's **in-memory turn id** (aion's `active_turn_id` / `expectedTurnId`), held on the live handle only while the node runs in-process. If the target turn has already ended when the message lands, it **folds into the node's next turn** (aion's `TurnEnded` pattern) — it is not rejected. The only refusal is a message to a node that is **no longer running** (`node finished` → 409, the draft stays in the browser), or to a node with no live handle in this process (detached → "not steerable here"). Correlation for the `delivered` chip (CAP-6) is by the caller-stamped id, never text or timestamp.
