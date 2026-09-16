---
name: 'Live Agent Steering — Adversarial Spine Review'
lens: adversarial
target: ../ARCHITECTURE-SPINE.md
companions:
  - ../../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/engine-integration.md
  - ../../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/provider-steering-matrix.md
  - ../../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/control-states.md
  - ../../../../specs/spec-agent-node-room/sources/spec-live-agent-steering/SPEC.md
status: complete
created: '2026-09-13'
---

# Adversarial review — attack the spine one level down

**Method.** For each seam I built two concrete units one level below the spine — a route handler and an executor branch, two composer docks, a re-ask loop and a steer loop — each obeying **every** AD to the letter, then drove them until they clashed on a shared shape, contended for one entity, or opened a race. A pair that breaks while both halves are compliant is a hole the ADs do not close. I attacked hardest at the six seams the gate named. Nine holes landed; two are severe (silent Cancel-masking; queued messages lost while the UI says `sent`). One attack I expected to land was genuinely repelled by the existing schema wiring — recorded below so the pass is credible.

**Verdict.** The spine is elegant on the happy path and its Cancel-vs-steering _signal_ split is sound. But it is under-specified on **concurrency and ordering the instant a second actor exists** — a second abort in one turn, a second operator, a second consumer of the idle state, a re-ask competing with a steer for one turn slot. The core missing invariant, recurring in six of the nine holes: **the per-turn abort, the `operatorInterrupt` flag, and the interrupt route are not turn-id-correlated the way AD-11 already correlates a soft-inject** — so "which turn did this act on, and did that turn already end" has no answer, and every branch that reads the flag or the signal can act on the wrong turn.

---

## H1 — Re-ask and steering both own the "next turn on the same session" slot; `canReask` is blind to the interrupt (SEVERE, code-grounded)

**Seam:** multi-turn on one session; `attemptResumeId` reuse colliding with the structured-output re-ask that also uses `:2290`.

**The two units.**

- **Unit A — the structured-output re-ask loop.** `dag-executor.ts:3032`: `const canReask = reaskAttempt < maxReasks && !nodeIdleTimedOut && !nodeAbortController.signal.aborted;` On a validation miss it calls `scheduleReask(...)` and `continue`s, re-invoking `sendQuery` with `attemptResumeId` on the same session (`:2290`). This is exactly the seam AD-4 says steering reuses.
- **Unit B — the steering turn loop.** On an interrupted turn-end (`operatorInterrupt` set) it must, per AD-4, **not validate, not complete**, and enter idle-await.

**AD-compliant yet incompatible.** Take a node that declares `output_format` **and** is being steered — both are first-class, nothing forbids the combination. The operator interrupts turn N mid-generation. The partial turn produced no schema-valid structured output — which is _precisely_ the condition Unit A treats as a recoverable validation miss. Now read Unit A's guard literally: `nodeIdleTimedOut` is false, and `nodeAbortController.signal.aborted` is false **because steering aborts only the per-turn signal** (AD-2, verified: the node-level controller is Cancel-only). So `canReask` is **true**. Unit A schedules a re-ask and `continue`s — it **auto-re-runs the wrong work it was just interrupted for**, on the same session, _before_ Unit B's idle-await branch is ever reached. AD-4's "always enters idle-await whatever the queue holds" is silently overridden by a guard the spine never told to consult `operatorInterrupt`. Both units are compliant: Unit A obeys the re-ask contract exactly as written today; Unit B obeys AD-4. The spine says AD-4 "reuses" the re-ask seam but never says the re-ask guard must **stop** on the new signal, and never resolves which of two candidates — a re-ask retry vs. a pending operator redirect — wins the single next-turn slot.

**Second face of the same hole.** Even absent `output_format`, at a natural turn-end with both a queued operator message and a pending re-ask (a prior miss), AD-4 says "auto-drains → run turn N+1 on the queued message," while the re-ask loop says "re-ask the miss." Two producers, one `attemptResumeId` slot, no precedence. And the re-ask attempt **budget** (`reaskAttempt < maxReasks`) is consumed by whichever runs — so operator turns can burn the validation-retry budget, or a re-ask can consume the slot the operator's redirect needed.

**The AD to add.** New AD (or AD-4 clause): _When a node is under steering, output-format re-ask and steering delivery contend for one next-turn slot; the pending operator delivery takes precedence, an interrupted turn never counts as a re-ask attempt, and structured-output validation is suspended for any turn that ended by interrupt._ Concretely: the re-ask continuation guard must also require `!operatorInterrupt`, and the re-ask attempt counter must not advance on operator-driven turns.

---

## H2 — `operatorInterrupt` has no turn-scoped lifecycle: a spent interrupt fails a turn that succeeded, and the route can abort the wrong turn (SEVERE)

**Seam:** per-turn vs node-level signal split; can a stale per-turn signal abort turn N+1; the in-memory queue vs the "never discarded" promise.

**The two units.**

- **Unit A — the Interrupt route / registry.** AD-2: `operatorInterrupt` is "set **when steering fires the per-turn abort**" — a _write-time_ act, performed by the route acting on the live handle (AD-11: "the route acts on the live registry handle," no phase gate).
- **Unit B — the executor post-stream juncture.** Reads `operatorInterrupt` after the stream ends (_land-time_): set → enter idle-await, do not validate/complete.

**AD-compliant yet incompatible — the spent flag.** AD-2's own race clause: _"if the turn finishes on its own while the interrupt is in flight, the interrupt is a no-op, spent — the loop already left turn N; there is nothing to end."_ That clause governs the **abort** (nothing to end). It says **nothing about the flag**, which was already written at fire-time. So: turn N ends naturally with valid `output_format`; a microsecond later the operator's interrupt fires, sets `operatorInterrupt`, and its abort finds nothing to end (spent, per AD-2). Unit B now reads `operatorInterrupt = true` and refuses to validate or complete a turn that **succeeded**. If the queue is empty, the node that should have **completed** instead enters idle-await and — 30 minutes later (AD-4) — **fails** with `interrupted by operator, no redirect received`. A green turn is converted into a failed node by a flag nobody cleared. Both units are compliant: A set the flag exactly when AD-2 says to; B honored it exactly as AD-4 says to.

**Second face — the route aborts turn N+1.** The registry holds one live handle with, at most, one "current per-turn controller," which the executor swaps for a fresh one each turn (AD-2: "each new turn gets a fresh per-turn signal"). The route aborts "the per-turn signal" through that handle. There is a read-swap window: the operator presses Stop targeting turn N; turn N ends naturally and the executor auto-drains a queued message, installing turn N+1's fresh controller; the route's abort now lands on the pointer — **turn N+1's controller** — killing a turn the operator never meant to touch. AD-11 correlates a **soft-inject** to its turn by the registry's in-memory turn id (`active_turn_id`/`expectedTurnId`); the **interrupt** is given no such correlation, so it targets "whatever controller is current."

**The AD to add — the elegant close is already in the codebase.** Extend AD-11's `expectedTurnId` correlation from soft-inject to **interrupt and the `operatorInterrupt` flag**: the interrupt call carries the turn id it means to end; the registry aborts the current per-turn controller **only if** its turn id matches, and stamps `operatorInterrupt` with that same turn id. The executor's post-stream branch honors the flag **only when it names the turn that just ended**; a flag naming an already-ended turn is discarded (a spent interrupt clears itself). One correlation mechanism, extended one call wider — not a new mechanism.

---

## H3 — No concurrency model for a second operator on one node: ordering is undefined and the transcript cannot attribute (SEVERE for multi-user)

**Seam:** the in-memory queue vs seq ordering — two writers; a Queue message and a Send-now interleaving out of order.

**The two units.** Two composer docks — two browser tabs, and (the install supports multiple **users** per AGENTS.md, visibility open) potentially two **humans** — both open on the same running node. Each obeys every AD: each is a shell reading AD-9's projected sub-state and calling the AD-11 routes, which authorize "the acting identity" with no notion of a single steerer.

**AD-compliant yet incompatible.**

- **Ordering (two writers into one FIFO).** Operator 1's dock flushes `[a, b]` on `Send now`; operator 2's dock flushes `[c, d]`. AD-3 promises delivery "in written order" — but "written order" is each operator's **per-tab** composition (control-states: "the queue is per-tab"). The **registry** queue is one FIFO on one live handle. The two flushes interleave at the route into `[a, c, b, d]`; the agent receives one turn input mixing two operators' corrections, and the AD-6 `seq` records an order **neither operator authored**. Nothing in the spine serializes two flushes or defines a global order across tabs.
- **Attribution (the transcript cannot say who).** AD-6 stamps every operator row `metadata.origin = 'operator'` — verified: `nodeTranscriptMetadataSchema` carries no user field, and the operator row gets only `origin`. With two humans steering, CAP-4's promise ("anyone reading the transcript afterwards can see what **the operator** said") cannot distinguish operator 1 from operator 2. The record is ambiguous exactly where two people acted.

_(The "second operator interrupts during idle-after-interrupt → livelock" case is the same lifecycle gap as H2, reached through a second actor; it is closed by H2's turn-id correlation and H4's `interrupting` state, not double-counted here.)_

**The AD to add.** New AD: _A running node has at most one live steering interaction at a time._ Either serialize on the registry handle (a per-node steer token; a second concurrent flush is refused or demoted to `Queue` for the now-generating turn), or define a single global delivery order and make it the `seq` order. **And** the operator row must carry the acting user identity (`resolveAuthContext` already resolves it at the route, AD-11) so CAP-4 attributes correctly in the supported multi-user install.

---

## H4 — AD-9 projects two sub-states; control-states requires three; the third is derived per-shell → the cross-shell parity AD-9 exists to protect is broken

**Seam:** idle-after-interrupt + node status projection — can the two shells read a different sub-state.

**The two units.**

- **Unit A — the Legacy dock.** control-states mandates an **`interrupting`** row (`Stopping…`, `aria-disabled`) for the in-flight window. AD-9 emits only `generating | idle-after-interrupt`, so Legacy must synthesize `interrupting` **locally** ("I pressed Stop, awaiting the land").
- **Unit B — the Console dock.** Renders AD-9's projected value strictly. During the in-flight window the core is still emitting `generating` (the turn has not yet ended), so Console shows **`Stop`, live and re-pressable**.

**AD-compliant yet incompatible.** This is a direct contradiction between the spine and a `status: final` companion. AD-9 fixes **two** values and its stated purpose is to **prevent** "each shell inferring from raw state ... forking the one status channel across two surfaces" — the cross-shell parity invariant. control-states needs a **third** visual state whose only possible source, under AD-9, is per-shell inference. So during the sub-second in-flight window the two shells legitimately disagree: Legacy is disabled/`Stopping…`, Console is still an armed `Stop`. An operator on Console presses Stop again — a second interrupt into a turn already ending (feeding H2's wrong-turn abort and H3's second-actor path). The parity AD-9 promises is broken by obeying control-states, and the isolation control-states implies is broken by obeying AD-9.

**The AD to add.** Reconcile the two: either **AD-9 projects a third core sub-state `interrupting`** (derived in the core from "interrupt fired, turn not yet ended" — the same live-turn-lifecycle source, so no per-shell inference), or control-states drops `interrupting` and both docks show a disabled-but-core-driven `generating`. Given AD-9's whole point is one channel for both shells, the third value belongs in the core projection. (Secondary, same AD: name the inter-turn/auto-drain instant — turn N ended, turn N+1 not yet begun — which is neither `generating` nor `idle-after-interrupt`; today it falls between the two declared values.)

---

## H5 — Two abort flags can both be set in one turn; the spine never orders the post-stream checks, so a steering interrupt can silently mask a Cancel

**Seam:** can a Cancel and a steering interrupt race such that one masks the other.

**The two units.**

- **Unit A — the executor built `operatorInterrupt`-first.** At the post-stream juncture it checks `operatorInterrupt` before the existing `:3124` node-level check.
- **Unit B — the executor built `:3124`-first.** It checks `nodeAbortController.signal.aborted` (Cancel/idle) before `operatorInterrupt`.

**AD-compliant yet incompatible.** AD-2 says the node-level `:3124` check is "Cancel-only, byte-for-byte untouched" and the `operatorInterrupt` branch "sits at the post-stream juncture" — but it **never orders the two checks**, because it assumes they are mutually exclusive (steering never trips `:3124`). They are not mutually exclusive **within one turn**: the operator presses Stop (per-turn abort, `operatorInterrupt` set) and, a moment later, `/workflow cancel` fires (node-level abort). Both feed the one `sendQuery` via `AbortSignal.any`; the turn ends once, but **post-stream both flags are true** — `nodeAbortController.signal.aborted === true` and `operatorInterrupt === true`. Unit A reads `operatorInterrupt` first → enters idle-await, node stays `running` — **the Cancel is silently masked**; the operator who pressed Cancel believes the node is dead while it sits waiting 30 minutes. Unit B reads `:3124` first → `node_failed`, Cancel wins. Both obey AD-2 (neither _changed_ the `:3124` behavior; each only _ordered_ it against the new branch). The stronger, destructive operation (Cancel/teardown) must never lose to the softer one, but the spine leaves the order to the implementer.

**The AD to add.** AD-2 clause: _At the post-stream juncture the node-level abort dominates. `operatorInterrupt` is consulted only when `nodeAbortController.signal.aborted` is false._ Cancel and idle-timeout always win over a co-firing steering interrupt.

---

## H6 — Idle-await has three consumers (30-min timer, `Send now`, node-level cancel) with no mutual exclusion: the node can both start turn N+1 and be failed

**Seam:** 30-min idle-await vs `/workflow cancel` — a window where the node is neither cleanly failed nor cleanly running.

**The two units.**

- **Unit A — `Send now`.** Dequeues the queue and starts turn N+1 on the same session (`attemptResumeId`), node → `generating`.
- **Unit B — the idle-await timer** (AD-4: fresh 30-minute timer → explicit fail branch). AD-4 also has idle-await watch the node-level `nodeAbortController` for `/workflow cancel` — a **third** consumer.

**AD-compliant yet incompatible.** All three act on the single `idle-after-interrupt` state, in-process, with a classic check-then-act gap and no declared arbiter. Operator presses `Send now` at t=29:59.9; the timer fires at t=30:00. Unit A reads "queue non-empty, idle" and begins dequeuing/`sendQuery`; Unit B reads "timer expired" and writes the fail branch. Result: the node is **marked failed** while a turn N+1 `sendQuery` is **in flight** writing rows — `node_failed` then, seconds later, turn N+1 completes and calls `node_completed` on a node already failed. AD-1 ("a send never fails the node") and AD-4 ("the timer fails it") are both true and now contradict on the same node. Symmetrically, `/workflow cancel` at the same instant as `Send now` races the same way.

**The AD to add.** AD-4 clause: _Leaving `idle-after-interrupt` is a single atomic transition (compare-and-set on who consumes the state first). Exactly one of {`Send now` → turn N+1, idle-timer → fail, node-level cancel → fail} wins; the losers observe the state already consumed and no-op._ Arm/disarm the timer as part of that CAS, not beside it.

---

## H7 — Teardown returns undelivered queued messages only on the natural-finish path; on Cancel or idle-fail they vanish while the browser still says `sent`

**Seam:** messages lost at registry teardown vs the "never discarded silently" promise.

**The two units.**

- **Unit A — the natural-finish teardown.** AD-11: "teardown is the last queue check"; a Queue message that lands after the final natural-end check but before teardown returns **409 finished** and the browser keeps it as a draft. This path is covered.
- **Unit B — the Cancel / idle-fail teardown.** The node fails via `/workflow cancel` (`:3124`) or the 30-minute idle timer (AD-4). The registry entry — live handle **and inbound queue** — is torn down (AD-5: valid only while the node runs in-process).

**AD-compliant yet incompatible.** AD-11's teardown clause covers only a **late-arriving** message racing the natural-finish check. It says nothing about messages **already accepted into the registry queue** — the operator's `Send` returned success, the browser shows **`sent`** — at the moment the node is failed by Cancel or the idle timer. Those messages are in the in-memory queue that Unit B discards. Nothing signals the browser to demote them; control-states renders the "Never sent" read-only box only for the node that **finishes**, not for one that **fails**. So a message reads `sent` forever yet was silently dropped — the exact outcome AD-11's teardown clause claims to have closed, reached through a terminal cause the clause did not consider. Both units are compliant: A implements the documented 409; B implements the documented registry teardown.

**The AD to add.** AD-11 clause: _Teardown for **any** terminal cause — natural completion, Cancel, or idle-fail — must surface the still-undelivered registry queue back to the client so it demotes `sent` → undelivered (the read-only "never sent" box), not only on the natural-finish 409 path._ "Never discarded silently" must bind every exit, not just one.

---

## H8 — AD-5 asserts "the run resumes normally" after a restart, but there is no mechanism that resumes a `running` node

**Seam:** server restart vs the node being neither failed, running, nor recoverable.

**The two units.**

- **Unit A — AD-1's status discipline.** Steering never changes run/node status; an `idle-after-interrupt` node is `running` in the database.
- **Unit B — AD-5's restart promise.** "A server restart drops the live session; any in-flight steer is lost and **the run resumes normally**."

**AD-compliant yet incompatible.** After a restart, the node's persisted status is `running` (Unit A, correctly — steering never wrote a marker). Its live handle is gone and its 30-minute idle timer died with the process (both in-memory, AD-5). Now Unit B's "resumes normally" is asserted against a shape the resume machinery does not handle: `/workflow resume` re-runs **failed or paused** runs, skipping completed nodes (AGENTS.md) — a node stuck `running` with a dead executor is **neither**. And AGENTS.md's "No Autonomous Lifecycle Mutation Across Process Boundaries" rule **forbids** any process from autonomously failing that `running` node on a staleness guess. So the node's only safety net — AD-4's 30-minute fail — is exactly the thing the restart destroyed, and no other mechanism the spine names transitions it. AD-5 asserts a resume that does not exist for this state; the node sits `running` until a human manually intervenes.

_(This is not a steering-specific orphan — any `generating` node orphaned by restart has the same shape today. The hole is that AD-5 **claims** a mechanism ("resumes normally") that does not cover a `running` node, rather than pointing at the existing orphan-reconciliation path.)_

**The AD to add.** AD-5 clause: _A restart-orphaned `running` node (including one that was `idle-after-interrupt`) is reconciled by the existing orphan-surfacing path — surfaced to the operator with a one-click resume/cancel, per the no-autonomous-mutation rule — not "resumed normally." AD-5 must name that path, not assert a resume the run lifecycle does not provide for `running`._

---

## H9 — A soft-inject that races an interrupt has no fallback into the queue → silently lost

**Seam:** a soft-inject (mid-turn) landing during an interrupt.

**The two units.**

- **Unit A — the soft-inject path** (CAP-5, claude streaming input): folds a message into the live turn N; if turn N has already ended when it lands, AD-11 says it "folds into the node's next turn."
- **Unit B — the interrupt path:** ends turn N; the node enters `idle-after-interrupt`, whose next turn runs **only** on `Send now` (AD-4), never automatically.

**AD-compliant yet incompatible.** On a soft-inject-capable provider, the operator soft-injects M mid-turn and, in the same window, interrupts turn N. The abort ends turn N before M is consumed. AD-11's rule sends M to "the next turn" — but for an **interrupted** node the next turn does not auto-run; it waits for `Send now`. M was a **soft-inject**, not a `Queue` message, so it is not sitting in the registry inbound queue that `Send now` flushes. There is no defined home for M: its turn ended, its "next turn" is gated behind `Send now`, and it never joined the queue that `Send now` drains. M is silently lost — violating "nothing is lost."

**The AD to add.** AD-11 (or AD-3) clause: _A soft-inject whose target turn ends — by natural end or by interrupt — before it is consumed falls into the registry inbound queue as a pending message, drained by the same rules as a `Queue` message (auto-drain on natural end, `Send now` after an interrupt). A soft-inject is never a separate lossy channel._

---

## Attacks that were repelled (genuine effort, no hole)

- **Operator-row schema ambiguity / a second unaware reader.** I expected a clash between two schemas and two readers. Repelled: `node-message.ts:8,13` imports and embeds `nodeTranscriptMetadataSchema` as the row's `metadata`, so the spine's two citations (`node-message.ts` and `node-execution.ts`) name **one** strict field — `origin` has exactly one home. And `packages/web/src/lib/agent-history.ts` is the **single** shared reader (`AgentHistoryItem`, `deriveOutcome` at `:120`) consumed by both Legacy (`NodeRoom.tsx`, `NodeTranscriptPane.tsx`) and Console — so AD-10's "the reader recognizes `origin='operator'` first" gates the only reader. `outcome: 'interrupted'` already exists in the strict schema, so the interrupted-tool rendering AD-10 depends on is real today. No hole; AD-6 + AD-10 hold.
- **`AbortSignal.any` leaving a turn un-abortable.** I tried to strand a turn with no live abort path. Repelled by construction: every turn's `sendQuery` receives `AbortSignal.any([nodeAbortController.signal, perTurnSignal])`, so both Cancel and steering always have a live edge into the current turn. The un-abortable case only appears in the _idle-after-interrupt_ state (no turn to abort) — which is H2/H4/H6 territory (state-machine gaps), not a signal-wiring gap.

---

## Holes → the AD that closes them

| #   | Hole                                                                                                         | Severity                | Close                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Re-ask `canReask` blind to `operatorInterrupt`; re-ask vs steer contend for one turn slot                    | **Severe**              | New AD-4 clause: steer delivery beats re-ask; interrupted turns don't count as re-ask attempts; validation suspended on interrupted turns |
| H2  | `operatorInterrupt` / per-turn abort not turn-id-correlated: spent flag fails a green turn; route aborts N+1 | **Severe**              | Extend AD-11's `expectedTurnId` correlation to interrupt + the flag                                                                       |
| H3  | No single-steerer model: two flushes interleave; operator rows carry no user id                              | **Severe (multi-user)** | New AD: one live steering interaction per node + acting-user identity on the operator row                                                 |
| H4  | AD-9 has 2 sub-states, control-states needs `interrupting` (3rd) → per-shell inference breaks parity         | High                    | AD-9 projects `interrupting` in the core (+ name the inter-turn instant)                                                                  |
| H5  | Two abort flags in one turn, post-stream check order undefined → steering masks Cancel                       | High                    | AD-2 clause: node-level abort dominates; `operatorInterrupt` read only when it is clean                                                   |
| H6  | Idle-await's three consumers race with no arbiter → node both starts N+1 and fails                           | High                    | AD-4 clause: single atomic CAS to leave `idle-after-interrupt`; timer armed/disarmed inside it                                            |
| H7  | Teardown returns the queue only on natural finish; Cancel/idle-fail drop `sent` messages                     | High                    | AD-11 clause: every terminal cause surfaces the undelivered queue back to the client                                                      |
| H8  | AD-5 asserts a "normal resume" that does not exist for a `running` node                                      | Medium                  | AD-5 names the existing orphan-reconciliation path, not "resumes normally"                                                                |
| H9  | Soft-inject racing an interrupt has no queue fallback → lost                                                 | Medium                  | AD-11/AD-3 clause: an unconsumed soft-inject falls into the registry queue                                                                |

**Citation drift (not a finding).** The spine cites the node-level fail check as `dag-executor.ts:3123`; in the tree it is `:3124` (`if (nodeAbortController.signal.aborted && !nodeIdleTimedOut)`). Worth a one-pass correction so downstream work lands on the right line.
