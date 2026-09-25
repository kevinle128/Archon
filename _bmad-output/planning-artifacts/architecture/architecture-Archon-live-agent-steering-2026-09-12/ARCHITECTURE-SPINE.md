---
name: 'Live Agent Steering'
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: 'ports-and-adapters (inherited from the HITL spine)'
scope: 'The WRITE half of the node room: send a message to a running agent, and interrupt its current generation to redirect it — both WITHOUT stopping the node. In-session, in-process. Stopping the whole node is the existing Cancel feature and is out of scope.'
status: final
created: '2026-09-12'
updated: '2026-09-20'
supersedes: "the prior durable stop-and-resume design in this run's memlog (the pause/marker/re-entry model conflated steering with Cancel); superseded 2026-09-13, owner-ratified, aion-verified."
binds:
  - 'spec-agent-node-room CAP-8..CAP-13 (merged canonical; pre-merge steering CAP-1..CAP-6 provenance)'
  - 'HITL spine (architecture-Archon-workflow-run-view-hitl-2026-09-05) — inherited subset, read-only'
  - 'Track A spine (architecture-Archon-readable-agent-transcript-2026-09-12) — inherited subset, read-only'
sources:
  - '../../../specs/spec-agent-node-room/SPEC.md'
companions:
  - '../../../specs/spec-agent-node-room/provider-steering-matrix.md'
  - '../../../specs/spec-agent-node-room/engine-integration.md'
  - '../../../specs/spec-agent-node-room/control-states.md'
  - '../../../specs/spec-agent-node-room/steering-api-contract.md'
  - '../../../specs/spec-agent-node-room/steering-test-plan.md'
---

# Architecture Spine — Live Agent Steering

The read half of the node room already ships (Track A).
This is the write half — and it is **not** "stop the node."
Two operations act on the **live agent** while the node keeps running: **send** it a message, and **interrupt** its current thinking to redirect it.
Stopping the whole node already exists (**Cancel**); steering never touches the node lifecycle.

The provider already gives us the primitive.
An interrupt ends the current _turn_ but keeps the _session_ alive (claude `query.interrupt()`; a stream-abort on any SDK leaves the provider thread intact) — so the operator's next message continues the same session.
The elegant part: **steering-interrupt and Cancel can share the same low-level stream-abort; the only difference is what the executor does after** — Cancel ends the node (existing path), steering keeps the node open and re-runs the same session.

## Design Paradigm

**Ports-and-adapters (hexagonal), inherited from the HITL spine.**
`IAgentProvider` is the turn port.
Selected-item Send now requires a distinct provider-owned live-input port or equivalent typed capability on the **live session handle** held in an **in-process registry**.
This port is current required architecture, not an already proven Archon adapter capability.
Steering adds no durable store.
The one genuinely new engine behavior is that a **steered node runs multiple turns on one live session** instead of ending after the first.

| Layer                                                                              | Namespace                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Provider adapters (interrupt + streaming input on the live session)                | `packages/providers/src/{claude,codex,grok,community/*}/` |
| Engine (executor per-node turn loop, in-process steering registry, store contract) | `packages/workflows/src/`                                 |
| Core (store impl, DB)                                                              | `packages/core/src/`                                      |
| Server (Send / Interrupt routes, dispatch)                                         | `packages/server/src/routes/`                             |
| Shells (composer dock, operator row)                                               | `packages/web/src/{lib,components,console}/`              |

## Inherited Invariants

Read-only, original ids.
**The pause/resume HITL invariants do NOT apply to steering** — they govern Cancel (the run-pause lifecycle), which this feature leaves untouched.

| Inherited     | From parent                                              | Binds here                                                                                                                                              |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HITL/AD-3     | architecture-Archon-workflow-run-view-hitl-2026-09-05    | The executor is the **sole appender** to `remote_agent_workflow_node_messages`; store assigns `seq`. The operator row obeys this.                       |
| HITL/AD-7     | architecture-Archon-workflow-run-view-hitl-2026-09-05    | Split typed POST routes; run-mutation authorized + validated server-side at the tool boundary.                                                          |
| HITL/AD-8     | architecture-Archon-workflow-run-view-hitl-2026-09-05    | Additive schema only; both dialects.                                                                                                                    |
| Track A/AD-1  | architecture-Archon-readable-agent-transcript-2026-09-12 | One core, two shells: what a row **means** is decided in `packages/web/src/lib`, reaching shells as data. The operator row's meaning is composed there. |
| Track A/AD-3  | architecture-Archon-readable-agent-transcript-2026-09-12 | The core never throws, always terminates; logs `family` + `tool_use_id`, never payload or tool name.                                                    |
| Track A/AD-10 | architecture-Archon-readable-agent-transcript-2026-09-12 | The core produces every string a row displays or announces. The operator row's glyph + accessible name are core output.                                 |
| Track A/AD-2  | architecture-Archon-readable-agent-transcript-2026-09-12 | The Console boundary is the `no-restricted-imports` lint rule; `packages/web/src/lib` is shared ground.                                                 |

**Explicitly NOT inherited by steering:** HITL/AD-1 & AD-2 (pause-without-approval + resume CAS) and HITL/AD-6 (`resumeInteractions`) — those are the Cancel/Ask lifecycle.
Steering does not pause, does not resume, and does not reuse `resumeInteractions`.

## Invariants & Rules

Dependency direction — each layer may depend only downward:

```mermaid
flowchart TD
  Dock["web: composer dock + operator row"] --> Routes["server: Send / Interrupt routes"]
  Routes --> Reg["workflows: in-process steering registry (runId,nodeId -> live handle)"]
  Reg --> Exec["workflows: executor per-node turn loop"]
  Exec --> Port["providers: IAgentProvider (sendQuery stream + interrupt)"]
  Port --> Adapters["providers: claude / codex / omp / grok / deepseek adapters"]
```

The in-session flow — the node never leaves `running`:

```mermaid
flowchart TD
  GEN["node running: agent GENERATING (turn N)"] --> OP{"operator acts"}
  OP -->|"per-item Send now on proven live input"| INJ["selected item accepted into turn N, no interrupt"]
  OP -->|"Queue (any provider, non-interrupting)"| Q["hold in registry"]
  OP -->|"interrupt to redirect"| INT["provider interrupt / stream-abort: end turn N, session ALIVE"]
  INJ --> GEN
  INT --> IDLE["node running: agent IDLE-AFTER-INTERRUPT (session alive, awaiting operator)"]
  IDLE -->|"Send now: ordinary prompt on idle session"| NEXT["turn N+1 on same session (attemptResumeId)"]
  IDLE -->|"30-min idle-await timeout, nothing sent"| FAIL["node FAILS: interrupted, no redirect"]
  IDLE -->|"/workflow cancel (idle-await status poll)"| KILL
  Q -->|"turn N ends naturally"| NEXT
  Q -->|"operator then interrupts"| IDLE
  NEXT --> GEN
  GEN -->|"turn ends naturally, queue empty"| DONE["node completes"]
  OP -->|"Cancel (existing, separate)"| KILL["teardown: node ends"]
  KILL:::bad
  FAIL:::bad
  classDef bad stroke-dasharray: 4 3
```

### AD-1 — Steering acts on the live agent, never on the node lifecycle

- **Binds:** CAP-1, CAP-2, CAP-3, CAP-5; the executor; the registry.
- **Prevents:** modelling steering as a run pause / node stop (that is **Cancel**, which already exists); any durable stop-and-resume state.
- **Rule:** _send_ and _interrupt_ both operate on the **live provider session** of the running node.
  The node stays `running` throughout — **no pause, no `pending`, no resume**; a send or an interrupt **never fails the node**.
  (The one way a steered node ends in failure is the operator _abandoning_ an interrupted node past its idle bound — AD-4 — which is the operator's absence, not a steering act.)
  Stopping the whole node is the existing Cancel/abort path: out of scope here, untouched.
  A node may contain an agent or not; steering only exists where there is a live agent session to act on.

### AD-2 — Interrupt is the provider's own primitive (or a stream-abort); it ends the turn, not the session

- **Binds:** CAP-2, `IAgentProvider`, the adapters, the executor's abort seam.
- **Prevents:** an engine-side kill; a bespoke steer channel; conflating interrupt with Cancel's teardown; a steering abort falling through to `node_failed`.
- **Rule:** "stop the agent's thinking" ends the **current turn** and leaves the **session alive**.
  Claude uses the SDK-native `interrupt()` (= `query.interrupt()`); a provider without a native keep-alive interrupt uses a **stream-abort**, which ends the turn while the provider's thread/session persists for a follow-up run (codex resumes it — `codex.resumeThread(sessionId)`, `providers/src/codex/provider.ts:1006`).
  The session, not a durable marker, carries continuity.
- **The abort seam — a per-turn signal beside the node-level one.**
  The executor's `nodeAbortController` (`dag-executor.ts:2209`, created **once per node, one-shot**) is **Cancel's**, and steering leaves it byte-for-byte untouched: it feeds `sendQuery` via `abortSignal` (`:2223`), the idle-timeout and cancel-poll abort it (`:2298`/`:2325`), the re-ask loop stops on it (`:3032`, `!nodeAbortController.signal.aborted`), and the inline `:3124` check fails the node on it.
  Steering must **not** abort that controller — one-shot means a steering abort would kill turn N+1's `sendQuery` (which receives the same signal) and block multi-turn.
  Instead steering interrupts through a **fresh per-turn signal**: `sendQuery` receives the **combination** `AbortSignal.any([nodeAbortController.signal, perTurnSignal])`, so **Cancel (node-level) or a steering interrupt (per-turn) both end the current turn**, but each new turn gets a fresh per-turn signal while the node-level controller persists across turns — which is what lets a node run more than one turn (the re-ask loop today cannot, because it reuses the one-shot node signal).
  The registry's interrupt reads the active turn's handle and aborts its per-turn signal **synchronously** (no `await` between read and abort), so on the single-threaded loop it can never fire a torn-down controller.
- **`operatorInterrupt` is a per-turn flag, and placement — not an ordering rule — makes Cancel dominate.**
  Because steering aborts only the per-turn signal, the node-level `:3124` Cancel check is **never tripped by steering** (Cancel-only, byte-for-byte).
  The flag is set when steering fires the per-turn abort and read at three post-stream points, all resolved by **position in the existing flow** (`stream → validation → canReask :3032 → :3124 Cancel check → completion`): **(1)** `canReask` (`:3032`) must **also stop on `operatorInterrupt`** — it guards only on the node-level signal today, so without this the re-ask loop would auto-re-ask the interrupted partial (adv-H1); **(2)** the executor **skips validation** on an interrupted turn — no validation-miss events for a turn the operator cut; **(3)** the `operatorInterrupt` branch sits **immediately after the `:3124` Cancel check**, so a co-firing Cancel wins by position, with no ordering rule to invent (adv-H5).
  The flag is **per-turn** — reset when the loop starts turn N+1 — so a stale flag can never abort or mis-route a later turn (adv-H2).
- **The end cause is a five-case rule the executor resolves, not result-presence alone.**
  The executor consumes a **provider-normalized** `msg.type === 'result'` (`dag-executor.ts:2533`), but a stream-abort is **not** uniformly result-free across providers: DeepSeek emits a terminal `result` marked `stopReason:'aborted'` / `errorSubtype:'deepseek_aborted'` (`providers/src/community/deepseek/acp-client.ts:105`), while OMP **throws** `Query aborted` (`providers/src/community/omp/provider.ts:317,450`), which reaches the executor catch (`dag-executor.ts:3332`) as `dag_node_failed`.
  So when the per-turn `operatorInterrupt` fired the executor resolves five cases: **(1)** a `result` with **no** abort marker → **natural** end, interrupt spent, completes/auto-drains (AD-4); **(2)** a `result` **carrying an abort marker** → **interrupted** end → idle-await; **(3)** a **thrown abort** caught at `:3332` → **interrupted** end → idle-await, **not** `node_failed`; **(4)** a throw with `operatorInterrupt` **not** set → genuine `node_failed` (unchanged); **(5)** node-level Cancel (`:3124`) dominates by position (unchanged).
  The executor **classifies** the abort-marked `result` and the abort throw — the provider adapter **must not suppress** them (they stay visible to other consumers; Fail-Fast).
  Case (1) still closes the race where the flag is set as a good turn naturally closes; cases (2)–(3) cover the two providers whose abort is not result-free.
  This rule applies on **both** `executeNodeInternal` and `executeLoopNode`.

### AD-3 — Send is an ordinary prompt on the live session; provider capability controls the delivery path

- **Binds:** CAP-1, CAP-3, CAP-5, `IAgentProvider.sendQuery`.
- **Prevents:** a new named `steer()` primitive; disqualifying any provider; a branch that holds a message "because the provider can't do better" (conflating a transport limit with the operator's intent); interrupt-first modelling.
- **Rule:** sending to a running agent is an **ordinary prompt** directed at the live session.
  **When** it reaches the agent is the operator's choice; **only soft-inject** depends on provider transport.
  Four paths exist, and interrupt (AD-2) is orthogonal to all of them:
  - **`Queue` (default, any provider):** the registry holds the message; it is delivered as **turn N+1 when the current turn ends naturally**.
    Non-interrupting — the operator chose to let the agent finish this thought.
    This is the "deliver at the next boundary" baseline.
  - **Per-item `Send now` while generating:** a queued item shows this action only on a proven Archon live-turn adapter and mode.
    It sends exactly that item into the active turn without Stop, natural-end wait, or a new turn; other items stay queued.
    Queue-only modes omit the action, while direct unsupported requests return a typed refusal without mutation.
    A shell consumes a provider-and-mode capability projection, not a provider-name guess.
  - **`Send now` (any provider):** offered only once the agent is **idle-after-interrupt** (AD-9) — so it is simply an ordinary prompt on an idle session → **turn N+1 immediately**.
    The interrupt that made the agent idle is CAP-2, a separate act; Send now does not itself interrupt.
  - **Soft-inject (CAP-5, G2 Claude, G3 Grok, and G4 OMP release gates):** a proven provider folds one selected queued item into the running turn with no interrupt and no fabricated turn-start event.
    The user requires an actual Grok live-turn path in this release; a hook advertisement cannot satisfy G3.
    Current Codex, DeepSeek, and Grok `--single` modes remain queue-only.
- The provider-owned live-input port returns a typed acceptance result and independent causal consumption evidence where the adapter can prove it.
  A second `sendQuery()` on a resumed session creates a new turn and cannot satisfy this per-item action.
  Interrupt-then-deliver remains reachable on **every** provider, so the visible refusal affects only the per-item mid-turn acceleration.

### AD-4 — A steered node runs multiple provider turns on one live session; turn-end has two causes

- **Binds:** CAP-2, CAP-3, the executor's per-node turn loop.
- **Prevents:** the node ending after its first turn while a steer is pending; an **interrupt with an empty queue completing the node** (operator pressed Stop to redirect and the node just… finished); validating a **partial** interrupted turn as if it were real output; re-establishing a fresh session (losing the agent's context — the failure mode of any resume-from-scratch).
- **Rule:** a node being steered **continues on the SAME provider session across turns**, reusing the existing session-resume seam — the structured-output re-ask already re-invokes `sendQuery` with `attemptResumeId` on the same session (`dag-executor.ts:2290`).
  Each delivered operator message becomes the **next turn's input**.
  This is the one genuinely new engine behavior; everything else reuses what exists.
- **The loop distinguishes _how_ the turn ended** — the `operatorInterrupt` flag (AD-2) is the discriminator, and the two causes drain the queue by **different rules**:
  - **Natural end** (agent finished the turn on its own): the queue **auto-drains** — a queued message → run turn N+1; queue empty → **node completes**.
    Auto-delivery at the natural boundary _is_ `Queue`'s contract (CAP-1).
  - **Interrupted end** (`operatorInterrupt` set): the turn produced a **partial** result — no schema-valid `output_format`, maybe a half tool call — which the executor must **not** validate, must **not** write `node_completed` for, must **not** advance the DAG on.
    It **always** enters **idle-await**, _whatever the queue holds_ — it never auto-fires.
    The **only** exits are the operator's **`Send now`** (flush every queued message plus the one just typed, in written order → turn N+1) and the bound.
    This is what preserves the ratified `Send now` moment: after Stop, the operator gets to add the final correction before anything is sent.
- **The re-ask precedent is imperfect and the delta is here:** re-ask (`:2290`) re-enters the loop on a **validation miss** and treats the state as recoverable; steering re-enters on an **interrupt** from a state the executor today treats as **terminal** (`:3124`).
  Same seam, different trigger — the `operatorInterrupt` branch is the new code.
- **The idle-await bound — fail after 30 minutes (owner-ratified), and how Cancel reaches it.**
  On entering idle-await the executor arms a **fresh 30-minute timer** (the operator's decision) — reusing neither the streaming `withIdleTimeout` wrapper (`:2298`; no stream to wrap) nor its `nodeIdleTimedOut` outcome, which _completes_ the node (`:3118`) and would ship the partial turn.
  On expiry the node takes an **explicit fail** branch: `interrupted by operator, no redirect received`.
  Because idle-await has no stream, the chunk-driven cancel-poll (`:2312`) is dormant — so `/workflow cancel` (a DB status the poll normally reads) cannot reach idle-await through the signal.
  Idle-await therefore runs its **own timer-driven poll** of `getWorkflowRunStatus` at `CANCEL_CHECK_INTERVAL_MS` (`:682`), reusing `shouldContinueStreamingForStatus` (`:700-702`, so a sibling Ask-pause still leaves it alone) and taking the existing Cancel ending when the run is no longer streamable.
  **Idle-await resolves exactly once:** the first of `Send now`, the cancel-poll, or the 30-minute timer wins, and the other two are torn down.
  (Cancel's _code_ stays untouched — idle-await adds a poll that _reaches_ it.
  Consequence of reusing `shouldContinueStreamingForStatus`: the 30-minute timer **keeps running through a sibling Ask-pause** — the operator's ratified fail-after-30-min choice covers this.)
  **The 30-minute timer is an _inactivity_ timer, not a fixed countdown from the interrupt (SC 2.2.1, owner-chosen):** a debounced, authorized operator _composing keepalive_ over the Send/Interrupt route family (AD-11 — not a new grant) **re-arms** the timer without resolving idle-await, so the node fails only after 30 minutes of genuine operator inactivity.
  This adds a re-arm input, not a fourth resolution — idle-await still resolves exactly once, on `Send now` / cancel-poll / timer expiry.
- **The 30-minute fail is a `node_failed`; resuming re-runs the node with a fresh session.**
  `/workflow resume` re-runs a failed node from scratch — the interrupted agent's in-progress context is **gone** (there is no durable session for a steer, AD-5).
  A builder must not try to preserve the session; the operator resumes into a clean re-run.
  (Rejected bounds: _wait-forever_ — ties up the node indefinitely, fragile in-process per AD-5; _complete-with-partial_ — ships garbage downstream.)
  This fail is the **in-process owner failing its own node** on a bounded timer it is actively holding — the same class as the existing idle timeout, **not** the cross-process staleness guess AGENTS.md's _No Autonomous Lifecycle Mutation_ rule forbids (that rule governs a process judging non-terminal work started by an unknowable _other_ party; here the failing process is the one running the node).

### AD-5 — In-process only: the registry holds the live handle; detached is deferred

- **Binds:** CAP-1, CAP-2, CAP-5; the web-dispatch executor (`api.ts:3200-3228`); the CLI detach path (`cli/src/commands/workflow.ts:696-722`).
- **Prevents:** pretending steering can reach a run whose live session is in another process; re-introducing durable state to bridge that gap.
- **Rule:** the **in-process registry** — keyed `(runId, nodeId)`, holding the node's **live session handle** + an in-memory inbound queue, valid only while the node is `running` **in this process** — is the **sole** mechanism.
  A run whose executor is **not in this process** (detached CLI `--detach`) has no reachable live handle → steering is **unavailable** for it in v1: the UI states this, and **Cancel still works**; a detached node otherwise runs to completion on its own (there is nothing to "resume" while it is `running` — `/workflow resume` applies only if it later fails).
  **No durable steering state:** a server restart drops the process-local handle, timer, and continuation, leaving a durable non-terminal run.
  Archon never autonomously fails or resumes it from staleness; recovery uses explicit abandon or cancel and then CLI `archon workflow retry-node` when wanted.

### AD-6 — The executor is the single writer of the operator transcript row

- **Binds:** CAP-4, CAP-6; HITL/AD-3.
- **Prevents:** a second appender to the node-message table; `seq` contention; an operator row whose position is unguaranteed; an operator row that cannot be attributed to its sender or reconciled against what the browser marked `sent`.
- **Rule:** an operator message is an ordinary `text` row carrying **three additive `metadata` fields** — `origin = 'operator'`, `operator_user_id` (the acting identity from `resolveAuthContext`, so CAP-4 attributes the message across a multi-user install), and `message_id` (the caller-stamped id from CAP-6, so the client can reconcile which `sent` messages became rows — AD-11).
  All three are additive on the `.strict()` metadata schema (`workflows/src/schemas/node-execution.ts:29-43`) + a regenerated `api.generated`; **no migration** (the column is already JSON).
  Written by the executor through the store on provider transport acceptance for active-turn per-item delivery, placed by `seq` in the active turn.
  Only that selected row hides the visible sender name; `operator_user_id` and derived read-model attribution stay intact.
  Delivered to the agent as a **plain prompt**, never `resumeInteractions` (that carriage is the Ask path's `tool_use_id`, which an operator message lacks).
  The **row is a receipt for the record** — the delivery vehicle is the live session, not this row.
  The server never writes it.

### AD-7 — Delivery emits no turn-start event from the steering layer

- **Binds:** CAP-3, CAP-4, CAP-5; the executor; every adapter; the transcript record.
- **Prevents:** a fabricated turn boundary corrupting the record the read half projects from.
- **Rule:** delivering an operator message — soft-inject mid-turn, or as the next turn after an interrupt — must emit **no `turn-start` event from the steering layer**; the turn boundary is where the agent's own loop puts it.
  An adapter that cannot inject without signalling a new turn does not expose per-item Send now; Queue remains available as a separate action.

### AD-8 — Delivery confirmation requires causal agent consumption

- **Binds:** CAP-6, the UI status chip.
- **Prevents:** claiming consumption from route acceptance, RPC acknowledgement, unrelated stream output, text equality, or timing.
- **Rule:** the registry receipt is `queued` and active-turn provider acceptance is `sent`.
  Acceptance removes only the selected queue item and creates one transcript row immediately.
  A matching native message lifecycle event or response stream causally tied to the selected message proves consumption and changes only that row to `delivered`.
  The first model output of a new turn that exclusively carries one message can prove ordinary boundary delivery; it cannot turn a per-item active-turn request into a new-turn fallback.
  An exact echoed id is sufficient but not the universal proof; the caller-stamped id remains the row and idempotency key.
  Without causal proof the accepted row stays `sent`.
  G1 is current release proof and implementation work; an SDK version alone does not satisfy it.

### AD-9 — The agent's generating/interruptible state is projected in the core; both shells read it

- **Binds:** CAP-1, CAP-2, CAP-3; the run-state projector; both dock shells; Track A/AD-1.
- **Prevents:** each shell inferring from raw state whether the agent is mid-generation — forking the one status channel across two surfaces; a persisted status enum re-introducing durable stop state.
- **Rule:** the agent's state **inside** `node = running` is a projected sub-state with **exactly two values** — **`generating`** (a turn is streaming: interruptible, and soft-injectable where the provider offers it) and **`idle-after-interrupt`** (a turn was interrupted, the session is alive and awaiting the operator: this is where `Send now` is offered, AD-3).
  It is derived in the core from the live turn lifecycle and emitted as data on the node state the shells already consume.
  **No new persisted status enum** — the node stays `running`; this is the ghost of the rejected `stopping/stopped` states, correctly relocated _inside_ `running` as a projected, typed-contract field (+ `api.generated` regen), never re-derived per surface.
  The `interrupting` state in `control-states.md` is a **UI-local optimistic transient** (the brief window while an interrupt request is in flight), **never a projected value** — the core emits only the two.
  Both shells (Legacy + Console) render the composer dock from this one projected sub-state — the cross-shell parity invariant.

### AD-10 — CAP-4 reaches into the transcript spec; that change is made there

- **Binds:** CAP-4, `spec-readable-agent-transcript`.
- **Prevents:** this spine silently adding an item kind to another spec's contract.
- **Rule:** `AgentHistoryItem` there has kinds `assistant | tool | lifecycle`; an operator row is none, and Track A/AD-1 puts every row's meaning in the shared core.
  The new item kind and its two-shell treatment belong to that spec's own update, opened there before CAP-4 ships.
  **Sequencing:** an operator `text` row must not reach a live transcript until that reader recognizes `origin='operator'` (else it renders as agent text) — the reader change lands first.

### AD-11 — Send and Interrupt are authorized routes; selected-item races fail closed

- **Binds:** CAP-1, CAP-2, CAP-5; the Send/Interrupt routes.
- **Prevents:** an unauthenticated or cross-user steer mutating a run; a durable-marker/phase gate that this model does not have; a 409 where the queue already absorbs the race.
- **Rule:** Send and Interrupt are **new** routes — `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt` — resolving the acting identity via `resolveAuthContext`.
  **Steering defines its own actor grant (owner-ratified 2026-09-15), broadening HITL/AD-7 for these live-session routes only:** any **authenticated** identity may send / interrupt / keepalive a running node, each request attributed by `operator_user_id` (AD-6); unauthenticated → 401; a run with **no** `user_id` (solo / identity-less install) → allowed.
  This is a **deliberate steering-specific grant** — steering acts on a live session and concurrent multi-operator steering (receipt order below) requires it — and it does **not** touch the retry / cancel / approve mutation rules, which keep HITL/AD-7's starter-or-admin form.
  An iteration-scoped mutation also carries `retry_epoch`; the server compares it with the live epoch and rejects a stale or finished epoch before it touches the registry.
  There is no durable phase marker beyond this fail-closed target check.
- **The send route is the _dispatch_ call, made at `Queue`-press: a queued message is server-side from the moment it is queued.**
  While the agent is `generating`, pressing `Queue` dispatches the message to the send route (`intent: 'queue'`) and it enters the **in-process registry queue** on the live handle at once; the executor drains it when the current turn ends naturally, or `Send now` flushes it after an interrupt.
  Per-item `Send now` names the existing server-owned queued `message_id` and selected `retry_epoch`; the caller cannot replace its text or sender.
  The registry claims that one item against the active turn token before it calls the provider-owned live-input port.
  `x`-delete of a queued message calls an **idempotent withdraw route** (`DELETE …/queue/:messageId`).
  The **client draft** is only the text still being composed and is the only state labelled `this tab only`; accepted queue items are node-scoped and shared across tabs and operators even when draft and queue content share one surface.
  The crossover is `Queue`-press, not the drain moment.
- **The registry queue absorbs the races — no 409 for them, and nothing is lost.**
  A Send that arrives while an interrupt is still in flight simply **lands in the registry queue** and **waits** there — when the interrupt lands (AD-2) the node goes `idle-after-interrupt`, and the queue drains only on the operator's `Send now` (AD-4), never automatically.
  A `Queue` message whose _generating_ turn ends naturally is delivered at that natural boundary (CAP-1's contract) — the two drain rules differ by how the turn ended, not by a route branch.
  The mutation refusals are explicit: a stale or finished `retry_epoch` rejects before registry access; a node **no longer running** returns 409 and keeps the draft; **no live handle in this process** (detached — AD-5) returns "not steerable here"; and a direct request to a queue-only mode refuses without removing the queued item.
  Queue-only UI omits the per-item action.
  A provider rejection before acceptance releases the claim in its original queue position; unrelated items keep receipt order.
  Turn-end, Stop, Cancel, or epoch change before proven acceptance never silently converts this operation into next-turn send.
  Late acknowledgement is fenced by the active turn token; uncertain timeout never causes blind reinjection.
  Once accepted, an operator-row write failure is surfaced and the accepted id remains out of sendable queue state.
- **Teardown is the last queue check.**
  A `Queue` message that lands after the loop's final natural-end check but before the registry entry is torn down is caught at teardown and returns **409 finished** — the browser keeps it as a draft.
- **Every terminal cause surfaces the undelivered queue — the row is how, and the terminal event is when.**
  On **any** node termination (natural finish, Cancel, or the 30-minute idle-await fail) the in-memory queue dies with the registry, so a late edge is not the only way to strand a `sent` message.
  The client keeps an **observation ledger** of every generation-valid shared-queue receipt plus this tab's successful sends (later snapshot omission never erases it; only this tab's confirmed withdraw removes an id).
  It reconciles that ledger against the `message_id` on the operator rows that were actually written (AD-6); an id proven unaccepted can be restored as "Never sent" with the half-typed draft folded in last.
  An id accepted by the provider but missing its transcript row is an explicit recording failure, never a sendable draft.
  The reconciliation runs **only on actual node-terminal evidence** — a persisted lifecycle terminal event (`node_completed`/`node_failed`) or the server's exact-scope terminal projection of a transactionally purged parked Ask (including uniquely matched loop-owner segments via `loop_ancestry`; answered Ask resumes require their matching persisted `resumed:true` resolution event and retire only scoped pre-resolution segments proven superseded by corresponding later starts; unscoped/ambiguous data fails closed) — **never on a live refetch or on run-level terminal status alone**.
  Cancel may publish run `cancelled` before the raw node event, so mounted run-detail views keep a 3 s read-only catch-up while raw executions remain unsettled and start a separate **node-wide** transcript drain only after the real node event; comparison never uses occurrence filters.
  The client folds a resumed-Ask event into one **logical execution key** so Ask continuation preserves queue history while a true retry/resume resets it.
  A finished-iteration view that showed the shared queue remains eligible, but comparison still uses the node-wide drain.
  If terminal evidence or a complete drain is unavailable the dock fails closed — no `NEVER SENT` claim.
  After the terminal event the row set is final and the reconciliation is exact — honouring "never discarded silently" through data that already exists, not a new event.
  Finished mode still renders after Cancel flips the run non-live once `neverSent` is nonempty and `nodeTerminal` is true.
- **Global order is the registry's receipt order; operators are attributed, not serialized.**
  On a multi-user install two docks may steer one node — AD-3's "written order" is per-operator, and the single global order is the order the registry **received** the sends (server-side FIFO).
  Each operator row carries `operator_user_id` (AD-6) so CAP-4 attributes each message to its sender.
  There is **no per-node steering lock**: concurrent operators interleave in receipt order, attributed, not serialized.
- Correlation of a soft-inject to its target turn is the registry's **in-memory** turn id, never a durable attempt-key or an Aion capability assumption.

### AD-12 — The operator display name is resolved at read time, server-side, and travels as row data

- **Binds:** CAP-4 (SPEC-agent-node-room CAP-11); the node-message read path; Track A/AD-1; AD-6.
- **Prevents:** (a) persisting a mutable display name as a 4th metadata field — breaks AD-6's "exactly three additive fields, no migration" and denormalizes a value that changes; (b) a shell fetching a users endpoint — breaks Track A/AD-1's fetch-free core and the Console import ban (HITL/AD-4); (c) rendering a raw id as the label — EXPERIENCE.md's Accessibility Floor forbids it.
- **Rule:** `operator_user_id` stays the **only** identity on the stored row (AD-6, unchanged).
  The display name is resolved at **read time** by the server that already serves node-message rows — a join on the canonical `users` row keyed by `operator_user_id` — and attached as a **derived, non-persisted** field on the read-response schema (`operator_display_name: string | null`), **not** inside the `.strict()` `metadata` object, so AD-6's three-field invariant and the no-migration property both hold.
  The rooms still read exactly **one** endpoint (HITL/AD-3 — the server enriches the row it already serves; it adds no source the room fetches).
  The functional core consumes the field as data (Track A/AD-1 — no fetch).
  For a non-null `operator_user_id`, the server always emits either the trimmed current `users.display_name` or the first eight id characters (Story 2.8 — the server owns the short-id fallback).
  `null` is reserved for identity-less rows (`operator_user_id: null`).
  The web keeps the same short-id derivation only as a compatibility guard for older/partial responses and performs no user fetch.
  The row created by accepted per-item Send now during generation does not render this name; it remains available as read-model data for attribution and other operator-row paths.
  Regenerate `api.generated` for the new response field.
  Impl owner: the operator-row story (1.11 / Story 2.8).

### AD-13 — The approved combined room and its controls are current product scope

- **Binds:** the approved Console, Legacy, transcript-state, and steering-state mockups; both shells.
- **Prevents:** classifying outer review fixtures as product controls or forking interaction rules by shell.
- **Rule:** The outer numbered state, node-kind, and provider-transport controls are mockup fixtures.
  The in-product `Execution` selector is typed product state and stays distinct from scroll-only `Jump to`.
  The Legacy and Console shells own only their markup and inherited tokens.
- **Rule:** `Re-run`, Console `Log`, Legacy `Logs`, `Graph`, `Artifacts`, and close are current product behavior.
  Their existing route, mutation, selection, artifact, and focus-return owners stay authoritative.
  The node room must keep these controls synchronized with the selected execution.
- **Rule:** The context projector uses primary `Run N` for every multi-occurrence separator in occurrence order on both shells.
  Loop iteration, provider pass, retry, interruption, and nested-loop collision context follows as a suffix; a single occurrence has no separator.
- **Rule:** The todo strip sits below the transcript and above the queue or dock.
  In the full Legacy and Console rooms, the queue is a full-bleed band between the todo strip and composer dock.
  In the compact dock and state-review layout, the same queue is an inset well.
  Only unsent composer content carries `this tab only`; queue content remains node-scoped and shared in both layouts.
- **Rule:** The queue projection owns collapse state inputs, ordinals, the next-out marker, proven per-item capability state, and the shared count.
  The shells render these values and keep the action order `Send now`, then delete.
  Collapsing the queue changes no server state.
- **Rule:** The terminal todo treatment is a display projection only.
  It can show remaining work as complete after successful node completion or return the current item to pending after the 30-minute interruption failure, but it does not append or rewrite a provider todo operation.
- **Rule:** Native buttons and selects keep their platform keyboard behavior.
  `Tab` follows document and reading order.
  `Enter` and `Space` activate buttons and disclosures.
  A bare `Enter` in the composer inserts a newline.
  `Cmd`/`Ctrl`+`Enter` uses the same permission and refusal check as the visible send control.
- **Rule:** Focus remains visible and survives every live update.
  When an active control unmounts, focus moves to its direct successor or owning selector and never to `<body>`.
  `Stopping…` uses `aria-disabled` with a suppressed handler, not the native `disabled` attribute, so focus stays on the control until it can move to `Send now`.
- **Rule:** At 460px, product controls and fixture groups in the review sheet can wrap in source order; Stop and the dock send control stay on one row at opposite edges; `Go to iteration N` stays fully visible; and the room has no horizontal overflow.
- **Rule:** Under `prefers-reduced-motion`, transcript, todo, and queue chevron rotation is disabled, smooth scrolling becomes immediate, and dock entrance, resize, and state-transition motion is disabled.
- **Rule:** Idle-after-interrupt shows `no redirect ends this node after 30 min of inactivity · typing keeps it open`.
  Authorized typing activity sends the debounced composing keepalive and re-arms the inactivity timer.
  `Send now`, the cancel poll, or timer expiry resolves the idle wait exactly once.
  The interface shows no countdown.
  Expiry announces `node failed · interrupted with no redirect · none of this was sent`, restores unmatched content read-only, and moves dock focus to the last transcript row.
- **Rule:** A refusal never discards content.
  Pending Ask, detached execution, stale retry epoch, finished node, and missing live handle preserve focus and explain the reason without relying on colour.
  Queue-only UI omits per-item Send now; a direct unsupported request still receives a typed refusal.
- **Rule:** Console and Legacy use one semantic test matrix for state transitions, context labels, queue ownership, provider capability and refusal, keyboard activation, focus recovery, accessible names, live announcements, the 460px layout, and reduced-motion behavior.
  They can differ only in inherited tokens, shell chrome, and the approved singular `Log` versus plural `Logs` label.

## Consistency Conventions

| Concern              | Convention                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steering target      | always the **live provider session** in the in-process registry; never node/run lifecycle state.                                                                                                                                                                    |
| Interrupt            | provider-native `interrupt()` where offered, else a stream-abort on a **fresh per-turn signal** (`AbortSignal.any` with the node-level one); never the one-shot `nodeAbortController`, which is Cancel's (AD-2). Ends the turn, session persists.                   |
| Node lifecycle       | untouched by steering — stays `running` (sub-state `generating` \| `idle-after-interrupt`, AD-9); completes only when a turn ends **naturally** with nothing queued. An interrupted turn never completes the node (AD-4). Cancel is the separate existing teardown. |
| Continuity           | the live session (claude resume / codex thread via `attemptResumeId`), never a durable marker.                                                                                                                                                                      |
| Operator row         | `text` row, `metadata` = `{origin='operator', operator_user_id, message_id}`; never a widened `kind`, never a new table; a receipt, not the delivery vehicle (AD-6).                                                                                                |
| Soft-inject ordering | claim only the selected queued id against the active turn token; unrelated items retain registry receipt order. The provider-owned live-input port must prove acceptance before dequeue.                                                                            |
| Message identity     | caller-stamped id keys the row and idempotency; acceptance is `sent`, and matching native lifecycle or causally linked stream consumption is `delivered`.                                                                                                           |
| Turn id              | in-memory in the registry; a stale target never silently folds into the next turn or triggers blind reinjection.                                                                                                                                                    |
| Events               | reuse HITL/AD-7 refetch triggers on live node-state change; no card payloads on the wire; no `turn-start` from steering.                                                                                                                                            |
| Authorization        | Send/Interrupt resolve identity via `resolveAuthContext`, under HITL/AD-7 (AD-11).                                                                                                                                                                                  |
| Console imports      | governed solely by `eslint.config.mjs:126-163`; `packages/web/src/lib` is shared ground.                                                                                                                                                                            |

## Stack

Seed — verified at authoring; the code owns it once it exists.

| Name                             | Version / note                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@anthropic-ai/claude-agent-sdk` | Current Archon pin 0.3.209 holds one streaming input for interrupt. G2 must prove a second selected input enters the active turn; G1 must prove causal consumption. An SDK update may be needed but its version alone proves neither behavior.                                                                        |
| `@openai/codex-sdk`              | `^0.144.5` (lockfile pins 0.144.5; npm latest 0.154.0). The TS SDK exposes only `run()`/`runStreamed()` — no `turn/steer`/`turn/interrupt` (those are app-server protocol) at 0.144.5, 0.153.4, or 0.154.0. So codex steering is **stream-abort + re-run on the resumed `thread`** (`resumeThread`), not soft-inject. |
| omp / grok / deepseek            | Archon OMP currently uses one-shot JSON mode; G4 must build and prove RPC active-turn steering. G3 must build and prove a Grok live-input path with same-turn selected-item acceptance and causal agent receipt; current Grok `--single` and DeepSeek remain queue-only. All keep the interrupt-then-continue floor.  |
| SQLite / PostgreSQL              | additive-only (the operator-row `metadata` fields `origin`/`operator_user_id`/`message_id`); no steering state persisted.                                                                                                                                                                                             |

## Capability → Architecture Map

| Capability                                                | Lives in                                                                                                     | Governed by                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| CAP-1 Compose to a running agent                          | composer dock (`web`), registry inbound queue (`workflows`)                                                  | AD-3, AD-5, AD-9                               |
| CAP-2 Interrupt the agent's thinking (node keeps running) | provider interrupt / per-turn stream-abort + executor keeps the node in idle-await (`workflows`/`providers`) | AD-1, AD-2, AD-4, AD-9, AD-11                  |
| CAP-3 Redirect and continue on the same session           | executor per-node turn loop on the live session (`workflows`)                                                | AD-1, AD-4, AD-6                               |
| CAP-4 The exchange is part of the record                  | operator row (`workflows` write, `web/lib` meaning)                                                          | AD-6, AD-7, AD-10, Track A/AD-1, Track A/AD-10 |
| CAP-5 Mid-turn delivery where the provider allows         | capability-projected per-item action + soft-inject on the live session (`web`/`workflows`/`providers`)       | AD-3, AD-5, AD-7, AD-13                        |
| CAP-6 Claim only what it knows                            | provider acceptance and causal consumption evidence; status chip and row `message_id` (`providers`/`web`)    | AD-6, AD-8, AD-11                              |

## Current Grok release proof

G3 requires Grok per-item Send now during the active agent turn in this release.
The actual Archon Grok adapter and mode must prove that only the selected queued item enters that same turn without Stop, a natural-end wait, or another turn.
It must separately prove causal agent receipt before showing `delivered`; an advertised hook, RPC acknowledgement, and unrelated stream output are insufficient.
Test tool-boundary and pure-text turns, turn-end and Stop races, stale epochs, rejection, and concurrent queue mutation before exposing the action.
Current `grok --single` remains queue-only and omits the action.
If hooks cannot meet the gate, another Grok path must pass it or the release remains blocked.

## Deferred

| Item                                    | Boundary                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Steering a detached (`--detach`) run    | No live handle crosses the process boundary; a future channel must prove reachability and safety.                                         |
| Surviving a server restart mid-steer    | The process-local handle and timer disappear, leaving a durable non-terminal run for explicit recovery; no autonomous staleness mutation. |
| Read-only operator item kind            | The readable-transcript implementation owns this projection under AD-10.                                                                  |
| Cancel node                             | Existing teardown remains separate from steering.                                                                                         |
| Deploy, environment, and infrastructure | Existing single-tenant install and SSE topology remain.                                                                                   |
