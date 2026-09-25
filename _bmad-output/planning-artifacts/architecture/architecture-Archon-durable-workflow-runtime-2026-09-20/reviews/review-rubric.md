# Good-Spine Rubric Review — Durable Workflow Runtime

**Target:** `ARCHITECTURE-SPINE.md` (SHA-256 `ce139a9fb44f926f26564da22abb26c0c39a8a17c79c6100a65ef0eb339ea971`)

**Gate verdict:** **NOT READY FOR HANDOFF** — the spine is mechanically clean and mostly well aligned with the brownfield system, but one critical command-durability contradiction and three high-severity omissions still allow incompatible implementations of binding CAP-3/CAP-5/CAP-6/CAP-7 and inherited steering behavior.

The deterministic spine lint passed with zero findings before this semantic review.

## Critical

### C-1 — Queue durability ends at the exact boundary where CAP-6 still requires it

**Evidence**

- The binding spec says accepted guidance survives both control-plane **and executor** disruption, with deterministic deduplication, order, withdrawal, delivery receipts, and `Never sent` reconciliation (`SPEC.md:47-49`).
- The spine instead says accepted Queue content is durable only “until claimed,” after which the worker-local registry owns live delivery (`ARCHITECTURE-SPINE.md:64`). A worker can die after claim but before provider application or transcript evidence.
- AD-2 promises retryable delivery and worker deduplication, but does not say that content, receipt order, actor, and reconciliation state remain durable after claim (`ARCHITECTURE-SPINE.md:79-83`). The capability map names a “durable command state machine” that no Rule actually defines (`ARCHITECTURE-SPINE.md:178`).
- The inheritance contract requires durable command storage to retain identity/correlation and accepted guidance to be reconciled after worker failure (`inheritance-contract.md:20,24`).

**Why this fails the rubric:** Two command-store implementations can comply with the written Rule while behaving incompatibly: one can retain a claimed command until a durable terminal outcome, while another can treat claim as transfer to volatile ownership. The second loses accepted guidance or makes blind redelivery possible after worker loss, directly violating CAP-6.

**Smallest concrete fix:** Amend the Steering/AD-3 supersession and AD-2 so **claim is a lease/routing transition, never a durability transfer**. Require the durable record to retain command payload, authenticated actor, receipt order, `message_id`, target epoch, and state through an evidence-backed terminal outcome such as `applied`, `withdrawn`, `never_sent`, `rejected`, or `effect_uncertain`. State the worker-loss rule: only commands proven unapplied may be epoch-retargeted/retried; a possibly applied command is reconciled rather than blindly resent.

**Disposition:** **Autofix** from the binding CAP-6 and inheritance contracts; no product choice is needed.

## High

### H-1 — The inherited “only a finished node refuses” rule conflicts with managed-runtime fail-closed states

**Evidence**

- The spine says Steering/AD-11 authorization, race folding, and terminal reconciliation remain unchanged, superseding only process-local receipt/storage (`ARCHITECTURE-SPINE.md:60,67`).
- The inherited AD-11 says the only refusal is a node that is no longer running; live races fold into the queue (`Live Agent Steering ARCHITECTURE-SPINE.md:169-179`).
- The new spine also requires incompatible mutations to fail closed (`ARCHITECTURE-SPINE.md:115-119`) and introduces `starting`, `cancelling`, `reconnecting`, and `recovery_required` runtime conditions (`ARCHITECTURE-SPINE.md:109-113`). Several of those can coexist with a non-terminal node but have no reachable live turn on which Stop, Send now, or keepalive can act.
- The binding spec requires compatible steering to continue while incompatible mutations return a typed failure (`SPEC.md:31-33,69-70`), so pretending the inherited refusal rule remains wholly unchanged does not resolve the conflict.

**Why this fails the rubric:** Stories can independently choose to accept-and-hold, reject, retarget, or report `not_steerable_here` for each command during reconnect/recovery, yielding incompatible API and UI behavior. The conflict is especially unsafe for Stop and Send now, whose meaning depends on a current turn/substate.

**Smallest concrete fix:** Add an explicit narrow Steering/AD-11 supersession for managed-runtime availability. Bind Queue, Withdraw, Stop, Send now, Cancel, and keepalive to an accept/hold/apply/refuse rule for `starting`, `active`, each `reconnecting` reason, `recovery_required`, `cancelling`, terminal, stale epoch, and incompatible protocol. Preserve the inherited actor grant, receipt order, wording, attribution, and `Never sent` behavior. Record which new typed failures are intentional managed-runtime exceptions to “only finished refuses.”

**Disposition:** **Discuss**, then encode the selected state matrix. This changes an inherited user-visible edge and must not be guessed silently.

### H-2 — A restarted supervisor has no spine-level re-adoption invariant

**Evidence**

- AD-1 governs a normal API-only deploy and AD-8 delays a planned supervisor upgrade until no active workers remain (`ARCHITECTURE-SPINE.md:73-77,115-119`). Neither Rule governs an unexpected supervisor exit while exact worker identities remain alive.
- Yet the supervisor owns dispatch, process lifecycle, polling, and worker routing (`ARCHITECTURE-SPINE.md:29,77,83`). Losing it can strand live capsules even though the workers and their epochs are still valid.
- The binding verification contract explicitly requires an API/**supervisor** restart to rediscover the exact live worker without changing epoch or starting a duplicate provider turn (`verification-matrix.md:17-18`).

**Why this fails the rubric:** One implementation can make worker capsules die with the PM2-managed supervisor; another can leave them alive but have no authenticated reattachment protocol; a third can adopt them by PID alone. All fit the current spine text differently, and only one family satisfies the binding recovery contract.

**Smallest concrete fix:** Extend AD-1 or AD-8 with the unexpected-supervisor-restart invariant: a supervisor restart must not itself signal live capsules or manufacture death evidence; the replacement supervisor reconciles durable ownership against exact boot/process-start/epoch identity and re-establishes command routing to a still-live worker under the **same** epoch. An unavailable or inconclusive reattachment preserves the owner claim and surfaces recovery-required; it never authorizes takeover by elapsed time.

**Disposition:** **Autofix** from the binding verification and ownership contracts.

### H-3 — CAP-5/CAP-7 name “uncertain effect” and recovery choices without an enforceable evidence/action boundary

**Evidence**

- AD-6 blocks recovery on an “uncertain effect,” but never requires a durable, epoch-fenced effect-start/effect-outcome pair or defines what authoritative evidence every provider/tool/executable dispatch must leave (`ARCHITECTURE-SPINE.md:103-107`). AD-3 fences listed database writes but does not require the current epoch to be checked immediately before provider/tool dispatch (`ARCHITECTURE-SPINE.md:85-89`).
- The capability map mentions “effect evidence” even though no AD owns its invariant (`ARCHITECTURE-SPINE.md:177`).
- The recovery contract requires an unmatched tool start to block replay, requires every provider/tool dispatch to verify the current epoch, and fixes three explicit recovery choices with consequence boundaries (`recovery-state-contract.md:60-74`). CAP-5 and CAP-7 require those choices to be visible and actionable through the shared projection and supported API/CLI surfaces (`SPEC.md:43-53`).
- AD-7 defines storage/projection states but not the evidence exposed or the typed, authorized actions allowed from `recovery_required`/cold fallback (`ARCHITECTURE-SPINE.md:109-113`).

**Why this fails the rubric:** Different node/provider stories can record different effect boundaries, allowing the same crash to auto-resume in one path and block in another. Separate API, CLI, and UI stories can also expose different recovery choices or consequences. Merely naming `uncertain effect` and `recovery_required` is not enforceable enough to prevent those divergences.

**Smallest concrete fix:** Expand AD-3/AD-6 to require (1) a current-epoch check and durable intent/start evidence immediately before every provider, tool, script, or external-effect dispatch; (2) an authoritative terminal outcome linked to that evidence; and (3) unmatched/ambiguous evidence blocking automatic replay. Expand AD-7 to require the shared projection/API/CLI to expose the typed reason/evidence and the spec-owned actions: continue the known provider session when eligible, restart from the supported checkpoint with explicit duplication-risk confirmation, or terminate through an existing authorized terminal action. Cold/unsupported/rejected/unverified must remain distinguishable typed reasons even if they share `recovery_required` storage.

**Disposition:** **Autofix** from CAP-5/CAP-7 and the recovery-state contract.

## Checklist Walk

| Good-spine criterion                                                 | Result                       | Review                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fixes the real divergence points for the level below and misses none | **Fail**                     | C-1 and H-1 leave command ownership/state behavior divergent; H-2 leaves supervisor re-adoption divergent; H-3 leaves effect and recovery-action behavior divergent.                                                                                                                                                                                                                                                                       |
| Every AD Rule is enforceable and prevents its stated divergence      | **Fail**                     | AD-2 does not define the claimed-command durability lifecycle; AD-3 omits the pre-dispatch epoch/effect boundary; AD-6/AD-7 name blocked/actionable states without binding their evidence/actions. Other Rules are concrete enough for feature-level planning.                                                                                                                                                                             |
| Nothing under Deferred could let two units diverge                   | **Pass**                     | Each deferred item has a closed present-tense rule elsewhere and a revisit condition. The explicit user decisions remain binding: no runtime workflow/activity cap (AD-9), no full canonical workflow snapshot (AD-6), and transcript tail-first remains separate. None should be pulled into this feature.                                                                                                                                |
| Named technology is verified-current                                 | **Pass**                     | The Stack records repository/lockfile bindings for Bun, Claude SDK, and Codex SDK, plus the observed production PM2 version and a public-behavior-only compatibility posture (`ARCHITECTURE-SPINE.md:147-155`). Those pins match `package.json`/`bun.lock`; the memlog records the PM2 current-major check. No architecture claim depends on a newer unpinned private API.                                                                 |
| Ratifies rather than contradicts the brownfield codebase             | **Pass**                     | The dependency direction, web import boundary, existing six-value run lifecycle, additive dual-dialect schema rule, provider capability seams, and DB event/transcript/outbox composition match current package manifests and repository rules. The new observable fenced event write intentionally replaces the current best-effort event seam rather than pretending it is already durable.                                              |
| Covers the driving spec capabilities                                 | **Fail**                     | CAP-1 through CAP-4 are structurally covered. CAP-6 fails C-1. CAP-5/CAP-7 fail H-3. CAP-2 steering behavior also remains under-specified in non-active managed states (H-1).                                                                                                                                                                                                                                                              |
| No new AD weakens or contradicts inherited invariants                | **Fail**                     | The inheritance table is strong overall, but H-1 leaves a direct unresolved conflict between inherited “only finished refuses” behavior and managed-runtime fail-closed/non-active states. C-1 also weakens inherited deterministic terminal reconciliation if claim can shed durable content.                                                                                                                                             |
| Every owned dimension is decided, deferred, or open                  | **Pass with H-2 correction** | Deployment topology, single-host environment, POSIX/Windows/container containment, SQLite/PostgreSQL/no-broker strategy, immutable releases, resource posture, metrics floor, and release GC are present. The operational/environmental envelope is therefore not silent. Its one material hole is unexpected supervisor restart/re-adoption (H-2); day-two detail may remain in `SOLUTION-DESIGN.md` once that invariant is in the spine. |

## Medium / Low Tail

No additional medium- or low-severity findings. The four findings above are the smallest set needed to make the spine convergent without reversing any recorded user decision or expanding scope.

## Post-fix verification

**Re-reviewed target:** `ARCHITECTURE-SPINE.md` (SHA-256 `a4ee01b6fd9305a345194030ef8a994d8e4e5207bb8094e22fac99264a3e374a`)

**Verdict:** **REVISIONS REQUIRED** — C-1, H-1, and H-2 are closed, and H-3's effect-evidence/action-shape gap is closed; however, one new command-ordering contradiction and the still-unspecified recovery-action grant leave two high-severity divergence points. No critical finding remains. The deterministic lint still passes with zero findings.

| Original finding                              | Verification                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 command durability                        | **Closed.** Claim is now explicitly a lease; payload, actor, order, identity, epoch, and state remain durable to an evidence-backed terminal outcome, with proven-unapplied-only retry/rebind (`ARCHITECTURE-SPINE.md:64,83`).                                                            |
| H-1 managed availability vs inherited refusal | **Closed as a state-availability contract.** AD-2 now gives explicit behavior for active, both reconnecting modes, recovery-required, cancelling, starting, terminal, stale-epoch, and incompatible-protocol cases, and names the narrow AD-11 exception (`ARCHITECTURE-SPINE.md:67,85`). |
| H-2 supervisor re-adoption                    | **Closed.** AD-1 requires exact containment verification, same-epoch routing restoration, and fail-closed recovery-required on inconclusive reattachment (`ARCHITECTURE-SPINE.md:77`); AD-5 admission-gates reopenable containment backends (`ARCHITECTURE-SPINE.md:103`).                |
| H-3 effect evidence and recovery actions      | **Partially closed.** AD-3 now binds epoch verification plus durable start/outcome evidence, and AD-7 binds the three consequence-labelled action shapes (`ARCHITECTURE-SPINE.md:91,115`). The actor grant for those actions remains open below.                                          |

### HIGH-PF-1 — Global unresolved-sequence blocking prevents inherited control operations

AD-2 now says no later command may overtake any unresolved earlier sequence (`ARCHITECTURE-SPINE.md:83`). A queued guidance command remains unresolved until evidence-backed delivery, potentially until the current provider turn ends. Under that literal rule, a later Withdraw cannot resolve its target, Stop cannot interrupt the current turn, Send now cannot flush an idle queue, and Cancel cannot promptly install AD-4's fence. This contradicts AD-2's own availability table (`ARCHITECTURE-SPINE.md:85`), AD-4's immediate Cancel fence (`ARCHITECTURE-SPINE.md:97`), and inherited Queue/Stop/Send-now race semantics (`Live Agent Steering ARCHITECTURE-SPINE.md:126-130,174-178`). Two stories could resolve the contradiction differently.

**Smallest fix:** Keep the database sequence as receipt/correlation authority, but replace blanket head-of-line blocking with typed dependencies: guidance delivery is FIFO among guidance; Withdraw may resolve its earlier target; Stop and keepalive act on the current turn/substate without waiting for queued guidance; Send now flushes eligible guidance in sequence; Cancel preempts and reconciles pending guidance through `cancel_fence_seq`. State explicitly that control-command precedence changes delivery timing, never guidance order.

**Disposition:** **Autofix** to preserve the inherited semantics already declared binding.

### HIGH-PF-2 — Recovery actions are typed but not authorized

AD-7 now fixes the three recovery actions but does not bind who may invoke continue-session or restart-from-checkpoint (`ARCHITECTURE-SPINE.md:115`). AD-2 commits an “authenticated actor,” which proves identity but not authorization (`ARCHITECTURE-SPINE.md:83`). This is material because inherited steering deliberately grants any authenticated user Send/Interrupt/keepalive while explicitly retaining starter-or-admin authorization for retry, cancel, approve, and other lifecycle mutations (`Live Agent Steering ARCHITECTURE-SPINE.md:169-173`). Implementers could accidentally apply the broad steering grant to recovery actions that can repeat effects or terminate work.

**Smallest fix:** Bind each recovery action to the existing server-side run-mutation grant: continue-session and restart-from-checkpoint use the established starter-or-admin retry/resume authorization; terminate uses the authorization of the existing terminal action it invokes. Keep the broad any-authenticated grant only for inherited live steering. Require the grant check before the command receives a sequence or accepted row.

**Disposition:** **Autofix** by ratifying the inherited run-mutation authorization boundary; discuss only if product intent is to broaden that grant.

No other new critical/high Good-spine issue was found. Deferred remains non-leaky, brownfield/package and schema boundaries remain coherent, the operational/environmental envelope is now covered, and the fixes preserve the binding decisions against workflow/activity limits, full workflow snapshots, and merging transcript tail-first work.

### Final closure verification

**PASS.** The command-precedence rule now preserves guidance FIFO while allowing Withdraw, Stop, keepalive, Send now, and Cancel their required typed behavior. Recovery actions now apply the existing starter/admin or terminal-action grant before command sequence allocation. No critical or high finding remains.
