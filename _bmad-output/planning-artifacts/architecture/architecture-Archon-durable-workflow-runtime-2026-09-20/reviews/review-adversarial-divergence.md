# Adversarial Divergence Review — Durable Workflow Runtime Architecture Spine

**Reviewed artifact:** `ARCHITECTURE-SPINE.md` (draft, updated 2026-09-21)  
**Method:** For each finding, Unit A and Unit B are independently implementable stories that can satisfy every stated AD literally. The finding exists only where composing those units can still violate a promised outcome. Preferences and merely different internal designs are excluded.

## Verdict

**REJECT AS AN IMPLEMENTATION SPINE.** The product decisions are coherent, but the AD set does not yet close the cross-story contracts needed for independent implementation. There are six Tier 0 divergence holes where compliant units can lose accepted guidance, perform unfenced work, duplicate effects, or disagree about whether a node/run is complete. Tier 1 holes cover recovery identity, projection consistency, containment after supervisor loss, immutable-release retention, and mixed-version command admission. Tier 2 findings are fail-closed availability problems rather than immediate duplication hazards.

This verdict does **not** challenge the ratified decisions to have no workflow/activity cap, no full workflow snapshot, agent-node/session-only automatic recovery, or transcript tail-first work as a separate feature. The proposed invariants preserve all four.

## Tier 0 — Safety and correctness blockers

### DVG-01 — “Ordered” commands have no common order domain

- **Spine seam:** AD-2 requires an authenticated, ordered command before receipt; the durable steering supersession says receipt order becomes durable; inherited Steering/AD-11 requires one server receipt order for concurrent operators. No field, scope, allocator, or application rule defines that order.
- **Unit A — command acceptance:** assigns a per-run `receipt_order` in the insert transaction and returns it to the caller.
- **Unit B — supervisor/worker routing:** claims by `(created_at, command_id)` and applies IPC deliveries as each send completes. It is still an ordered, at-least-once router and deduplicates every identity.
- **Why both are literal yet incompatible:** both have a deterministic order, but two concurrent Queue/Stop/Withdraw commands can be committed in A's order and applied in B's different order. A Withdraw can precede its Queue, or Stop can target the wrong turn, breaking inherited race folding and written-order semantics.
- **Violated outcome:** accepted steering is not applied in the durable receipt order promised by CAP-6 and the inherited Agent Node Room contract.
- **Smallest invariant:** define one database-assigned, gap-tolerant, monotonically increasing **per-run command sequence** with a uniqueness constraint. Receipt, claim, IPC delivery, worker application, transcript association, and terminal reconciliation must all compare that field; later commands may not overtake an unresolved earlier command unless the command-state machine explicitly marks the earlier command terminal.

### DVG-02 — The provider handoff window can either lose or duplicate accepted guidance

- **Spine seam:** AD-2 says delivery is retryable and workers deduplicate by command/message identity; AD-3 separately persists command receipts and transcript rows; the steering supersession makes content durable only until claimed and then gives the local registry live delivery ownership. No durable state says whether a claimed prompt crossed the non-transactional provider boundary.
- **Unit A — durable command worker:** marks a command applied and writes its operator transcript row before invoking `sendQuery`, so a replacement will not repeat it.
- **Unit B — provider adapter:** invokes `sendQuery` first and reports success afterward, because the inherited operator row is a delivery receipt rather than the delivery vehicle.
- **Why both are literal yet incompatible:** a crash between A's commit and B's invocation produces a transcript row for guidance never sent. Reversing the calls creates the opposite window: the provider can receive the prompt, the worker dies before the durable receipt, and a replacement retries it. Worker-local message dedupe cannot deduplicate an external provider effect after process loss, and most provider paths do not offer a caller-idempotent prompt API.
- **Violated outcome:** CAP-6 guidance is either silently lost or delivered twice; `Never sent` reconciliation can become false.
- **Smallest invariant:** add a durable handoff state machine with write-ahead `delivery_started`, an authoritative-delivery evidence rule per provider, and `effect_uncertain` for the invocation-without-evidence window. Only commands proven not handed to the provider may retry automatically. The executor writes the operator transcript row only from authoritative delivery evidence; an uncertain handoff blocks automatic continuation and is never rendered as sent or safe-to-retry.

### DVG-03 — Supervisor and worker can disagree on when a new epoch is allowed to act

- **Spine seam:** AD-1 requires a worker, epoch, and verified containment identity; AD-3 fences mutations by run and epoch; AD-6 requires an atomic epoch claim. It does not define the cross-process launch/register/readiness sequence, which cannot be one database/OS transaction.
- **Unit A — supervisor:** atomically claims epoch N, then spawns the capsule and later records the returned native process/start identity.
- **Unit B — worker bootstrap:** treats possession of a valid launch envelope for epoch N as authority and can reconstruct ports or begin provider work before supervisor registration completes.
- **Why both are literal yet incompatible:** if the supervisor dies after spawn but before identity registration, B can issue external work under a valid epoch while the replacement supervisor sees an epoch with no verified containment identity. It cannot safely signal, recover, or prove quiescence. If B instead waits for a registration it cannot observe, independently implemented units can deadlock.
- **Violated outcome:** work can begin outside an owned, recoverable capsule, defeating AD-1, AD-4, and exactly-one recovery.
- **Smallest invariant:** bind a launch nonce to the epoch and require a four-step protocol: reserve epoch + nonce in `starting`; spawn an **inert** contained worker; CAS-register exact containment identity against epoch + nonce; worker CAS-transitions to `active` and only then may perform any provider/tool/external effect. Specify who reaps an unregistered child and that no fenced workflow mutation other than registration/readiness is legal before `active`.

### DVG-04 — “Durable completed node” has multiple possible authorities

- **Spine seam:** AD-6 tells recovery to skip durable completed nodes, while AD-3 allows node transitions, events, checkpoints, and normal lifecycle writes as separate short transactions. It never identifies the one commit that means “completed.”
- **Unit A — executor:** treats a persisted `node_completed` event as completion and writes validated output afterward through the existing output seam.
- **Unit B — recovery projector:** treats the durable output/result row as completion and regards events as an audit projection.
- **Why both are literal yet incompatible:** a crash between the two writes makes A skip a node whose output is absent, while B reruns a node whose external effects already completed. Reversing write order only reverses the bad crash window. Both are using durable evidence and fenced short transactions exactly as allowed.
- **Violated outcome:** completed work can be replayed or downstream work can start without its required output.
- **Smallest invariant:** designate one atomic node-finalization transaction as the sole completion authority. It must bind run, node occurrence, retry epoch, execution epoch, validated output/result reference, completion status, and downstream-readiness marker. Events are emitted from or after that commit and are never recovery authority by themselves.

### DVG-05 — The two state axes lack a legal-pair and atomic-transition contract

- **Spine seam:** AD-7 defines lifecycle and runtime enums and only two pair constraints (`paused + recovery_required`, cancellation after quiescence). AD-3 permits normal lifecycle transitions in short transactions, but no rule says which component atomically updates both axes or how readers handle an in-between pair.
- **Unit A — worker:** writes `workflow_runs.status = completed` after DAG completion, then marks the runtime record `terminal`.
- **Unit B — API projector/supervisor:** regards runtime `terminal` as the prerequisite and continues to project `running` while the runtime record is non-terminal.
- **Why both are literal yet incompatible:** a crash between A's writes exposes `(completed, active)` indefinitely. The opposite update order exposes `(running, terminal)`. Either projector can truthfully follow its owning row and give a different terminal answer; a mixed-version client may offer steering or recovery on a completed run.
- **Violated outcome:** the established lifecycle contract and recovery operability cease to be truthful under an ordinary crash.
- **Smallest invariant:** publish the complete legal lifecycle/runtime pair table and assign each transition to one transaction owner. Every transition affecting both axes must update them in one database transaction (including reason and epoch), with a specified read projection for legacy rows. Illegal pairs fail closed and are repaired only by the authoritative owner, never inferred from elapsed time.

### DVG-06 — Cancel is not defined as a fence at acceptance time

- **Spine seam:** AD-4 says Cancel fences new work; AD-2 models Cancel as another durable ordered command. It does not say whether the fence is installed in the API acceptance transaction or only when the supervisor/worker applies the command.
- **Unit A — API route:** commits an accepted Cancel command and returns; it leaves the runtime record unchanged because only the supervisor performs containment decisions.
- **Unit B — command router:** continues accepting and routing later Queue/Send commands until it reaches Cancel in its poll/apply loop; it still processes commands in its chosen valid order and eventually quiesces before `cancelled`.
- **Why both are literal yet incompatible:** after the user receives an accepted Cancel receipt, a later guidance or tool-start command can also be accepted and can begin before the delayed Cancel application. An implementation that installs the fence at acceptance behaves differently from one that installs it at application, and both can cite AD-4.
- **Violated outcome:** “Cancel means teardown” can still admit new provider/tool effects after the operator has successfully cancelled.
- **Smallest invariant:** accepting Cancel must atomically install a run-level `cancel_fence_seq`/`cancelling` fence in the same transaction as the command and receipt. No command with a higher sequence and no new node/tool/provider dispatch may be accepted or applied. Define reconciliation of all lower-sequence pending guidance and make repeat Cancel idempotent against the same fence.

## Tier 1 — Cross-unit interoperability blockers

### DVG-07 — Recovery does not define the first resumed turn's input

- **Spine seam:** AD-6 says to strictly resume the named occurrence by session ID and forbids replay of uncertain effects; it does not define what prompt/input begins the new provider turn after recovery.
- **Unit A — workflow recovery:** calls the ordinary node entrypoint with the original node prompt plus `resumeSessionId`, reasoning that the session is warm and the node contract still needs its declared prompt.
- **Unit B — provider recovery adapter:** sends a generic “continue” turn on the resumed session and assumes the original prompt is already in provider context.
- **Why both are literal yet incompatible:** both strictly target the saved session and disable cold fallback. A can duplicate the user's instruction and repeat tools; B can fail providers whose resume API restores identity but expects a substantive next input. Provider-specific adapters may make opposite assumptions with no typed distinction from normal node start.
- **Violated outcome:** agent-node/session recovery is not reproducible and can replay work despite a valid checkpoint.
- **Smallest invariant:** define a versioned `RecoveryTurnRequest` distinct from normal node execution. It must never resend the original node prompt or queued operator messages, must carry the saved session and last durable turn/effect boundary, and must invoke a canonical workflow-owned continuation instruction. Adapters may translate transport syntax but may not invent semantic input or fall back to a fresh turn.

### DVG-08 — `node_occurrence` is a name, not a canonical identity

- **Spine seam:** AD-6 keys checkpoints by `run_id + node_id + node_occurrence + retry_epoch + execution_epoch`, and verification covers loops, loop groups, and child workflows. The construction and stability of `node_occurrence` are unspecified.
- **Unit A — DAG executor:** uses the node's local loop iteration ordinal (`0`, `1`, …) as `node_occurrence`.
- **Unit B — recovery loader:** reconstructs an occurrence as a composite parent/child path or a count of prior `node_started` events.
- **Why both are literal yet incompatible:** nested loop groups, repeated child workflows, or fan-out branches can produce the same local ordinal under distinct parents, while event-count reconstruction can shift after retries. Both populate every named checkpoint-key field, but B cannot reliably find A's checkpoint.
- **Violated outcome:** recovery can select the wrong agent session or fail closed for a checkpoint that exists.
- **Smallest invariant:** define one canonical, serialization-stable occurrence ID derived from the full execution path (including parent workflow/sub-run, loop/fan-out branch identities, and stable ordinals), generated by the executor and persisted on every node transition, event, command target, projection, and checkpoint. Recovery reads it; it never recomputes it from event counts.

### DVG-09 — Steering projection, checkpoint, and command cursor can describe different turns

- **Spine seam:** AD-7 adds an epoch-fenced node projection; AD-6 persists the provider checkpoint; AD-2 persists commands. Each can be written in a separate short fenced transaction, but no shared turn revision or commit boundary relates them.
- **Unit A — steering loop:** writes `idle-after-interrupt` and its deadline immediately after classifying the abort, then persists the newest session checkpoint and consumed command cursor.
- **Unit B — recovery worker:** loads the latest projection, checkpoint, and pending commands independently and assumes “latest by timestamp” describes one recoverable turn.
- **Why both are literal yet incompatible:** a crash between writes can pair idle-after-interrupt for turn N with a session checkpoint or command cursor from turn N-1. Recovery can resend already-flushed guidance, wait on a session that is actually generating, or attach Send-now to the wrong turn while every row passes the epoch fence.
- **Violated outcome:** cross-process steering changes inherited turn-boundary and queue semantics.
- **Smallest invariant:** introduce a monotonic per-node-occurrence `turn_revision`. At every durable turn boundary, checkpoint identity, steering substate/end cause, inactivity inputs, and last applied command sequence must be committed atomically or published under the same revision. Recovery may use only a complete revision; partial newer rows are ignored or force `recovery_required`.

### DVG-10 — Idle-after-interrupt downtime semantics can reset or prematurely expire the inherited 30-minute bound

- **Spine seam:** AD-7 stores “idle inactivity deadline inputs,” and the inherited rule is a 30-minute operator-inactivity failure re-armed by authorized composing keepalive. The durable spine does not name the durable clock value or say whether worker-recovery downtime counts.
- **Unit A — original worker:** persists an absolute wall-clock deadline and counts downtime.
- **Unit B — replacement worker:** persists an interrupt timestamp plus a process-local monotonic timer and starts a fresh 30-minute timer when reconstructed.
- **Why both are literal yet incompatible:** both store deadline inputs and preserve a 30-minute inactivity timer in-process. After a 20-minute outage, A leaves 10 minutes while B grants 30 more; after wall-clock adjustment they may diverge further. Neither component can infer which behavior the inherited contract intended.
- **Violated outcome:** API/worker replacement silently changes the ratified operator-idle behavior.
- **Smallest invariant:** persist one UTC `last_authorized_operator_activity_at` for the active occurrence/revision, update it only for the inherited authorized send/interrupt/keepalive inputs, and derive remaining time as `30m - (trusted wall time - persisted value)`. Recovery downtime counts as inactivity; clock regression is clamped and surfaced, never used to extend the bound silently.

### DVG-11 — Release selection and release garbage collection have a TOCTOU hole

- **Spine seam:** AD-6 freezes a release at admission; AD-8 says GC requires zero durable references; AD-10 includes release in the launch envelope. The spine does not define what constitutes a durable release reference or when it is acquired relative to `current_release` selection.
- **Unit A — dispatcher:** reads `current_release`, puts that ID in a pending dispatch/envelope, and creates the runtime ownership reference only when the supervisor claims the run.
- **Unit B — release GC:** counts active runtime ownership records, sees zero references to the old release, and removes its directory.
- **Why both are literal yet incompatible:** A has frozen the release in durable launch data, while B's independently defined reference set does not include pending dispatch/context rows. GC can delete the artifact between selection and spawn or between owner death and strict recovery. Both can claim “zero durable references” under their own schema ownership.
- **Violated outcome:** an admitted run cannot start or recover on its immutable pinned release.
- **Smallest invariant:** define a single release-reference relation and enumerate its holders: pending/admitted dispatch, starting/active/cancelling owner, recoverable or recovery-required run, and pending supervisor upgrade. Selecting `current_release` and acquiring the first reference must be one transaction; GC deletes only after an atomic zero-reference claim/recheck and must not race a new reference acquisition.

### DVG-12 — Versioned contracts can still acknowledge a command the live worker cannot execute

- **Spine seam:** AD-8 says incompatible mutation fails closed; AD-10 puts protocol and capabilities in the envelope; AD-2 returns “accepted” after commit. It does not identify the authoritative negotiated capability snapshot used at API acceptance.
- **Unit A — new API:** validates a command against its own schema and the persisted protocol major, commits it, and returns accepted.
- **Unit B — old worker:** rejects the command because its exact command version or capability is absent, correctly failing the incompatible mutation closed.
- **Why both are literal yet incompatible:** no unsafe mutation occurs, but the externally meaningful accepted receipt has been issued for a command that can never be applied. A stale persisted capability set can cause the inverse after worker replacement.
- **Violated outcome:** compatible steering is not predictably available across deploys, and accepted guidance can degrade into an implementation-defined rejection.
- **Smallest invariant:** the worker readiness handshake must durably publish an epoch-bound negotiated protocol/capability set. The API may return accepted only if the exact command schema/version is in that set and the set belongs to the current epoch; otherwise it returns a typed incompatibility **without** creating an accepted command. Observation has a separately versioned minimum contract and remains available even when mutation does not.

### DVG-13 — A Windows containment backend can be verified yet unrecoverable after supervisor restart

- **Spine seam:** AD-5 allows any verified Windows tree-containment backend; AD-4 requires post-crash reconciliation; the ownership identity convention records boot ID, native process ID, start token, and epoch, but no durable containment-object identity or reopen rule.
- **Unit A — launcher:** creates an unnamed Job Object, assigns the worker, and keeps the only handle in supervisor memory. This is a verified Windows tree-containment backend while the supervisor lives.
- **Unit B — restarted supervisor:** verifies the worker PID/start token from the database but has no handle with which to enumerate or terminate the Job Object tree; it refuses broad PID-tree killing and correctly enters cleanup-required.
- **Why both are literal yet incompatible:** every launch is initially contained, every signal remains exact, and ambiguity fails closed. Nonetheless, one ordinary supervisor crash permanently removes the only capability needed for the mandated cleanup/recovery path.
- **Violated outcome:** strict recovery and Cancel cannot complete after the control process that owned the containment handle exits.
- **Smallest invariant:** every supported containment backend must publish a durable, boot-scoped containment identity that a replacement supervisor can reopen and verify independently of worker PID. If Windows cannot supply that backend, the platform must fail admission or use container hard containment; “verified while the original supervisor is alive” is insufficient.

### DVG-14 — Old-epoch accepted commands have no recovery disposition

- **Spine seam:** commands are epoch-bound, transport is retryable, and recovery atomically claims a new epoch. The spine does not say which commands may be rebound, which remain terminally associated with the dead epoch, or how the decision relates to provider-effect evidence.
- **Unit A — command store:** treats `target_epoch` as immutable; all accepted commands for epoch N become `Never sent` when epoch N dies.
- **Unit B — recovery coordinator:** atomically rewrites every non-terminal command to epoch N+1 so accepted guidance survives recovery.
- **Why both are literal yet incompatible:** A honors strict epoch targeting but loses accepted queued guidance during a recoverable worker crash. B preserves guidance but can resend a command that reached the provider under N without durable evidence. Both retain an epoch-bound command at every moment.
- **Violated outcome:** CAP-6 preservation and CAP-5 no-unsafe-replay cannot both be implemented consistently.
- **Smallest invariant:** specify the command recovery table: only `accepted` commands with no claim/handoff evidence may be atomically rebound during the epoch-claim transaction; `claimed` or `delivery_started` without authoritative outcome becomes `effect_uncertain`; durably applied/reconciled commands never rebind. Withdraw/Stop/Send-now dependencies follow the original command sequence and become non-applicable if their target is not rebound.

## Tier 2 — Fail-closed availability and rollout holes

### DVG-15 — Definition hashes can disagree without any workflow drift

- **Spine seam:** AD-6 and the convention require a normalized workflow-definition hash but do not name the canonical bytes, loader version, default expansion, include resolution, or hash algorithm/version.
- **Unit A — admission:** hashes loader output after defaults are materialized and map keys are sorted.
- **Unit B — replacement release:** hashes semantically equivalent loader output before default insertion or with source-order-preserving maps.
- **Why both are literal yet incompatible:** both hash a normalized definition and both fail closed on mismatch. An unchanged YAML definition can therefore become unrecoverable solely because normalization implementations differ across pinned API/supervisor/worker releases.
- **Violated outcome:** safe agent-node recovery is refused despite no definition drift.
- **Smallest invariant:** make canonicalization a versioned workflow-layer function that returns canonical bytes plus `normalization_version` and `hash_algorithm`. Persist all three at admission; recovery must invoke that exact supported normalization version and compare bytes/hash, failing closed only when the canonical result differs or the version is unavailable. This preserves the decision not to store a full snapshot.

### DVG-16 — “No active worker” is not a defined supervisor-upgrade gate

- **Spine seam:** AD-8 delays supervisor upgrade until no active worker remains, but `active` is also one runtime enum value and the system has `starting`, `cancelling`, `reconnecting`, `recovery_required`, plus admitted pending runs.
- **Unit A — deploy/upgrader:** counts live OS worker identities; once none remain it upgrades the supervisor.
- **Unit B — dispatcher/recovery:** considers a paused `recovery_required` run or an admitted pending run eligible to launch later on its pinned release and expects the old supervisor protocol to remain available.
- **Why both are literal yet incompatible:** A has no active worker at upgrade time. B later asks the new supervisor to launch an old pinned worker whose handshake may be incompatible, or an implementation that counts all non-terminal rows can block supervisor security upgrades forever on operator-paused recovery cases.
- **Violated outcome:** rollout either strands recoverable/pending work or never applies a queued supervisor upgrade.
- **Smallest invariant:** define the exact upgrade blocker set and compatibility gate. Before switching supervisor release, atomically stop dispatch, account for every pending/starting/live/recoverable launch reference, and prove the candidate supervisor can launch/observe every referenced worker protocol. `recovery_required` with no compatible future launch must remain observable but need not block indefinitely; its operator actions must return typed incompatibility.

## Required closure before story split

The minimum safe closure is not a larger design document. It is a small set of normative cross-story contracts added to the spine:

1. command sequence and durable handoff/recovery state machine;
2. launch nonce, containment registration, and worker readiness protocol;
3. atomic node-finalization authority and legal lifecycle/runtime pair transitions;
4. canonical occurrence/turn revision and recovery-turn request;
5. durable containment reopenability and release-reference lifecycle;
6. epoch-bound negotiated capabilities plus canonical definition-hash versioning.

Once these are binding, implementation stories may choose table names, IPC mechanism, polling interval, process APIs, and internal types independently without reopening the ratified product decisions.

## Post-fix verification

**Verdict: NOT YET PASS — 13 closed, 3 partially closed.** The revised spine now binds nearly every original divergence at the correct invariant level. Exact schemas, IPC framing, provider-specific evidence adapters, canonicalization code, and containment API choices can remain implementation work. One critical and two high cross-unit contradictions remain.

| Finding                        | Result                       | Invariant-level verification                                                                                                                                                                      |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DVG-01 command order           | **PARTIAL — Critical below** | AD-2 now owns a durable per-run sequence, but its no-overtaking rule waits for an earlier command to be resolved rather than durably folded into logical state.                                   |
| DVG-02 provider handoff        | **CLOSED**                   | AD-2 keeps claim as a lease, defines handoff states, permits retry only with proven non-application, and makes ambiguous handoff `effect_uncertain`; transcript writes require delivery evidence. |
| DVG-03 launch readiness        | **CLOSED**                   | AD-1 binds epoch + nonce reservation, inert spawn, exact-identity/capability registration, `active` CAS, and reaping before effects.                                                              |
| DVG-04 node completion         | **CLOSED**                   | AD-3 establishes one atomic node-finalization transaction as the sole completion/recovery authority.                                                                                              |
| DVG-05 state-axis atomicity    | **PARTIAL — High below**     | AD-7 supplies atomic owners and legal pairs, but the pair set omits existing non-recovery pauses and cancellation from explicitly cancellable non-active states.                                  |
| DVG-06 Cancel fence            | **PARTIAL — High below**     | AD-4 correctly installs the fence at acceptance, but its mandated `cancelling` state cannot form a legal AD-7 pair from `recovery_required` and potentially `starting`.                           |
| DVG-07 recovery turn           | **CLOSED**                   | AD-6 defines a versioned recovery request, binds the saved session/boundary, prohibits original-prompt and queued-guidance replay, and disables general cold fallback.                            |
| DVG-08 occurrence identity     | **CLOSED**                   | AD-6 defines one serialized full-path occurrence ID and forbids reconstruction from counts.                                                                                                       |
| DVG-09 turn consistency        | **CLOSED**                   | AD-3 plus the Turn boundary convention atomically publish checkpoint, substate, inactivity input, and command cursor under one revision.                                                          |
| DVG-10 idle deadline           | **CLOSED**                   | AD-7 stores the authoritative operator-activity timestamp and explicitly counts recovery downtime toward the inherited bound.                                                                     |
| DVG-11 release GC              | **CLOSED**                   | AD-8 makes selection/reference acquisition atomic, enumerates holders, and requires an atomic zero-reference GC claim/recheck.                                                                    |
| DVG-12 mixed-version admission | **CLOSED**                   | AD-1/AD-10 publish an epoch-bound negotiated capability set; AD-2 refuses stale/unsupported commands without an accepted row and versions observation separately.                                 |
| DVG-13 containment reopen      | **CLOSED**                   | AD-1/AD-5 require boot-scoped reopenable containment identity and certification fixtures; unsupported host backends fail admission.                                                               |
| DVG-14 epoch rebind            | **CLOSED**                   | AD-2 permits retry/rebind only for proven-unapplied commands and sends ambiguous handoff to `effect_uncertain`.                                                                                   |
| DVG-15 definition hash         | **CLOSED**                   | AD-6 and conventions bind canonical hash, normalization version, and algorithm; unavailable versions fail closed without requiring a full snapshot.                                               |
| DVG-16 supervisor upgrade      | **PARTIAL — High below**     | AD-8 adds reference/protocol compatibility gates but does not bind dispatch against the zero-live-worker check/switch race.                                                                       |

### Remaining Critical — Ordered command terminality blocks the controls that must act on a queued prompt

- **Unit A — command state:** keeps Queue sequence 10 non-terminal until provider delivery evidence, as required by AD-2 and the managed steering supersession.
- **Unit B — router:** refuses to apply sequence 11 until unresolved sequence 10 reaches a terminal state, literally enforcing “later commands cannot overtake an unresolved earlier sequence.”
- **Divergence:** sequence 11 may be Withdraw for Queue 10, Stop needed to reach idle-after-interrupt, Send-now needed to flush it, or Cancel. All are blocked behind the very queued command they must mutate, advance, or reconcile. Treating Queue as terminal when merely copied into the local registry would instead violate the rule that durable authority survives claim through an evidence-backed terminal outcome.
- **Violated outcome:** inherited steering can deadlock and Cancel can be delayed by undelivered guidance.
- **Smallest invariant:** separate **ordered state-machine application** from **effect terminality**. A later sequence may apply after every earlier sequence has been durably folded into command/queue state, even when an earlier provider effect remains pending. Dependencies still resolve by sequence; Withdraw mutates its queued target, Stop/Send-now fold against that queue, and Cancel is a preemptive fence that deterministically terminalizes lower pending guidance.

### Remaining High — Legal state pairs omit inherited gate pauses and allowed cancellation paths

- **Unit A — existing workflow gate:** an AskHuman/approval node durably sets lifecycle `paused` while its managed execution remains owned or deliberately releases its capsule.
- **Unit B — new runtime projector:** accepts only `paused + recovery_required`; it must either mislabel an ordinary gate as recovery failure, manufacture `running`, or reject the existing pause as an illegal pair.
- **Independent contradiction:** AD-2 explicitly accepts Cancel in `recovery_required`, and AD-4 atomically sets runtime `cancelling`, but AD-7 permits neither `paused + cancelling` nor a direct quiescence-proven terminal exception. Cancellation during `starting` has the same gap if supported.
- **Violated outcome:** API restart can corrupt established approval/AskHuman semantics, and an allowed recovery-state Cancel cannot enter a legal projection.
- **Smallest invariant:** define the managed representation and worker-ownership rule for ordinary durable gates, then include its legal pair(s). Add legal cancellation pairs for every non-terminal state where Cancel is accepted (at minimum `paused + cancelling`, and `pending + cancelling` unless starting Cancel is explicitly refused), or permit an atomic direct `cancelled + terminal` transition only when the containment unit is already proven empty.

### Remaining High — Supervisor upgrade can race a new dispatch

- **Unit A — upgrader:** observes zero live workers, validates the candidate against all referenced protocols, and begins the supervisor switch.
- **Unit B — dispatcher:** claims an admitted run and spawns a worker after A's check but before the old supervisor exits; neither unit violates the current AD-8 wording independently.
- **Divergence:** the supervisor is replaced while a worker is live, silently taking the deferred hot-replacement path. Compatibility reduces protocol risk but does not restore the promised idle-only upgrade or prevent a launch during ownership transfer.
- **Violated outcome:** deploy/release behavior differs by race timing and can transfer live process ownership during an operation specified to wait for no active worker.
- **Smallest invariant:** acquiring the pending supervisor-upgrade gate must atomically stop new dispatch claims (or advance a supervisor-generation fence). After the gate is held, recheck zero live/starting workers and protocol compatibility, switch, then release dispatch under the new generation. Admission may remain unbounded and durable; only launch is briefly fenced, so this does not add a workflow/activity cap.

## Final closure verification

**PASS — no remaining critical/high divergence holes.** AD-2 now separates ordered logical application from provider-effect terminality; AD-7 covers ordinary gate pauses and cancellation pairs; AD-8 atomically fences dispatch, rechecks workers and compatibility, and resumes under the new supervisor generation.
