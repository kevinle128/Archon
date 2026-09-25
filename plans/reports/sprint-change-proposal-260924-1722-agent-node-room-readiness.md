# Sprint Change Proposal: Agent Node Room planning reconciliation

**Status:** Manifest M009 reconciled with the later consumption decision; planning edits approved by the coordinator's “ok làm đi” instruction.
**Date:** 2026-09-24.
**Mode:** Incremental review.
**Owner:** Product and architecture planning.
**Evidence:** The [validated manifest](../../_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json) and [NOT READY report](../../_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-24.md).

## 1. Issue summary

The 2026-09-24 readiness check found seven planning defects against the approved Agent Node Room mockups.
The canonical SPEC and steering Architecture spine have unresolved merge markers, including a stale release gate.
The current planning text also conflicts with the approved occurrence header, selected operator row, queue-only control state, inventory count, TODO placement, and fixture-control scope.
The manifest classifies all 70 visible product items: nine changed features and 61 unchanged context items.
The report has no unresolved mockup behavior question.
The coordinator's later decision refines the delivery proof in manifest M009 without changing its visible `sent` and `delivered` states.
Provider acceptance proves `sent`; agent consumption proves `delivered`.
M009, M003, M004, and M008 now record the later answer alongside the earlier answer, so the manifest and proposal use the same consumption rule.

## 2. Impact analysis

- **Requirements:** The target uses `spec-agent-node-room/SPEC.md` as its canonical PRD-equivalent requirement source.
  There is no separate Agent Node Room PRD to amend.
  The SPEC and affected companion contracts must state the current approved behavior.
- **Epics:** Keep Epics 1–3 and their Stories as historical planning records.
  Add a new Epic 4 with new corrective Stories.
  The current requirements inventory and coverage map must point to Epic 4 for the corrected contract.
- **Architecture:** Update both readable-transcript and live-steering spines at their occurrence, presentation, provider capability, and room chrome decisions.
- **UX:** Update both `DESIGN.md` and `EXPERIENCE.md` for the same visible rules.
- **Verification:** Update the affected test-plan prose and conformance target to the manifest's 70 product items.
  The 2026-09-24 report and approved mockup files remain evidence and are not rewritten.
- **Product implementation:** This proposal changes planning only.
  The new Stories assign implementation and verification later.
- **Tracking:** The existing `sprint-status.yaml` has unresolved merge markers and a generated-file header.
  Do not hand-edit it in this planning pass.
  The tracker owner must regenerate or repair it through its supported workflow before execution tracking starts.

## 3. Recommended approach

Add a new corrective Epic and repair the current owning requirements, architecture, UX, and verification contracts.
This is a moderate backlog change because it adds Stories and changes cross-document acceptance criteria.
The planning edit is medium effort with low data risk; implementation is a separate high-effort dependency on proven Archon transport capabilities.
The approved current behavior includes live-turn per-item Send now and a truthful `delivered` state.
Claude streaming input and OMP RPC are candidate Archon paths, not proven capabilities merely because another product uses them.
The G1, G2, and G4 work is a current release gate until Archon conformance proves the accepted behavior.
The approved mockups also show the queue-only state, so Grok hook work is not a dependency of the visible per-item path while Archon's Grok transport remains queue-only.
The Grok queue-only disposition follows the approved queue-only mockup state and the current `grok --single` adapter; it does not label any visible feature future.
Rollback of delivered work would not repair the planning contradictions.
Reducing the approved visible scope would conflict with the validated manifest.

## 4. Incremental edit proposals

### Edit 1 — Canonical SPEC and release scope

**Old:** The SPEC write constraint contains both current G1/G2/G4 scope and an opposite post-v1 gate inside merge markers.
The steering Architecture Deferred table has a second unresolved merge with an obsolete G1-delivered deferral.
**New:** Resolve both conflicts in favor of current visible live-turn sending and truthful `delivered` status, and retain compatible safety and restart details from both sides.
Treat G1, G2, and G4 as current proof and implementation gates for the Archon paths they name, not as already proven behavior or post-v1 backlog.
Do not label any approved visible behavior future.
Keep Grok's current one-shot Archon path queue-only unless an active-turn hook or other channel passes the same conformance gate.
**Old:** The SPEC calls 64 behaviors current and treats the outer state, node-kind, and transport fixture controls as product controls.
**New:** Use the validated 70-item product inventory, exclude outer review controls, and keep the in-product `Execution` selector and actual room controls.
**Why:** The manifest and the 2026-09-24 report establish the approved visual boundary; the later coordinator decision corrects the transport and consumption semantics.

### Edit 2 — Occurrence labels

**Old:** SPEC CAP-6, the readable Architecture grouping rule, the steering Architecture context projector, and both UX spines select `Run N`, `Iteration N`, `Pass N`, or reason-only as alternative primary headings.
**New:** Every multi-occurrence separator has primary `Run N` in occurrence order.
Add relevant iteration, provider-pass, retry, or interruption context as a suffix; a single occurrence has no separator.
Keep `Execution` selection distinct from the scroll-only `Jump to` navigator and keep existing collision disambiguation in the suffix.
**Why:** Approved feature M007 requires a universal primary `Run N` header.

### Edit 3 — Selected per-item Send now and operator row

**Old:** The supported-provider action is current in several sources, but some sources still gate it after v1 and require a visible sender name on all operator rows.
**New:** During generation on a proven soft-inject transport, per-item `Send now` sends exactly the selected accepted queue item into the active turn without Stop, waiting for natural turn end, interrupting the work, or starting another turn.
On proven provider transport acceptance, only that item leaves the shared queue and appears immediately as an operator row with a `sent` badge and no visible sender name.
Keep `operator_user_id` and derived read-model attribution stored or available for other use; do not change other operator-row display paths.
Change that row to `delivered` only after evidence that the agent consumed the selected message.
A matching native message lifecycle event is valid evidence.
A stream event is valid only when it is causally linked to the selected message or comes from a new turn carrying only that message; unrelated output from an already-running stream is not evidence.
An RPC command acknowledgement proves provider transport acceptance and `sent`, not agent consumption.
The caller-stamped `message_id` remains the row and idempotency key, but an echoed id is not the only possible consumption proof.
Keep dock `Send now` after Stop as the separate next-turn flush of all queued messages plus the new draft.
**Why:** M003, M004, M008, and M009 define target, timing, cardinality, and visible state; the coordinator's revision distinguishes acceptance from consumption.

### Edit 4 — Queue-only control state

**Old:** SPEC CAP-12, `control-states.md`, `provider-steering-matrix.md`, both Architecture and UX spines, and test-plan prose require a visible per-item Send now refusal on a queue-only provider.
**New:** A queue-only provider does not show per-item Send now.
Keep queue, Delete, Stop, and dock Send now after Stop according to their existing state rules.
Keep the server's typed soft-inject refusal for stale or direct unsupported requests, with no queue mutation.
Advertise a live-turn per-item capability only after the exact Archon adapter and mode pass the provider gate below.
**Why:** Manifest context C065 and the recorded owner answer define the visible queue-only state; server validation still protects the trust boundary.

### Edit 5 — TODO placement and mockup fixture boundary

**Old:** Story 1.5's user-story sentence says the strip is above the transcript, despite its acceptance criterion saying below.
The SPEC, two Architecture spines, UX, and Story 3.6 call the outer numbered state, node-kind, and transport fixture controls product UI.
**New:** The current contract puts one pinned, collapsible TODO strip below the transcript and above queue or dock on both rooms.
Classify the outer review controls as fixture scaffolding only.
Preserve the in-product `Execution` selector, lifecycle, navigation, artifact, and close controls.
Leave completed Story 1.5 and Story 3.6 text as historical records; the new Epic states the correction and identifies the superseded criteria.
**Why:** M001/M002, the source HTML placement, and the manifest's 70-item boundary establish this scope.

### Edit 6 — New corrective Epic and conformance

**Old:** The current Epic document refers to 64 approved behaviors and previous Story criteria carry the conflicts above.
**New:** Add Epic 4 with new Stories for TODO position, universal headers, one-item active-turn delivery and selected-row status/name, queue-only state, product chrome boundary, and full 70-item Legacy/Console conformance.
Add a current-contract note before the historical Epics and update the requirements inventory, coverage map, and Epic list.
Do not relabel, rewrite, or reopen completed prior Stories as new work.
The final Story requires all 70 items classified and all nine changed rows matched, with no unresolved conflict or missing approved behavior.
**Why:** The prior Epics are history; current work needs new acceptance criteria and traceability.

| New Story                                       | Acceptance contract                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 — Position the TODO strip                   | Both rooms show one collapsible strip after the scrolling transcript and before queue or dock; the current item and progress remain visible while transcript rows scroll.                                                                                                            |
| 4.2 — Label every occurrence as Run N           | A multi-occurrence transcript shows one primary `Run N` separator per occurrence with the applicable context suffix; a single occurrence shows none; `Execution` selects and `Jump to` scrolls.                                                                                      |
| 4.3 — Send one queued item into the active turn | A proven Archon soft-inject transport accepts exactly the selected queued item during generation without Stop, natural turn end, or a new turn; other items stay queued; one operator row appears immediately without a visible sender name and with stored attribution intact.      |
| 4.4 — Show truthful queue and delivery states   | Queue-only providers omit the per-item action; unsupported direct requests refuse without mutation; the selected accepted row reads `sent` until causally linked agent consumption is proved, then reads `delivered`; dock `Send now` after Stop remains a separate next-turn flush. |
| 4.5 — Preserve actual room chrome               | Outer numbered state, node-kind, and transport review controls are outside the product; the in-product `Execution`, Cancel, Re-run, Log/Logs, Graph, Artifacts, and close controls work in both rooms.                                                                               |
| 4.6 — Prove approved conformance                | All 70 manifest product items have requirement, implementation, and verification evidence on each applicable surface; nine changed rows match their behavior signatures; no approved item is deferred or replaced by a fixture control.                                              |

### Edit 7 — Verification sources

**Old:** Some verification text still tests a visible queue-only refusal, outer fixture controls as product actions, or a 64-behavior set.
**New:** Update only the affected canonical test-plan and steering-test-plan clauses to test the current visual state, the three delivery stages, provider-specific proof, and the 70-item inventory.
Preserve API refusal tests for unsupported direct soft-inject requests.
**Why:** Readiness requires verification evidence against the same product contract.

## 5. Live-turn architecture boundary and provider gate

### Existing Archon boundary

`NodeSteeringHandle` currently stores a process-local pending queue and an active turn token.
Its public intents are only `queue` and dock `send_now`; `accept()` appends a new message, and `drain()` removes the full pending batch.
The server send schema has the same two intents, and the route calls `handle.accept()` rather than a live provider input port.
The executor writes next-turn operator rows on the first stream yield of a new `sendQuery()` pass.
`IAgentProvider.sendQuery()` accepts one prompt for a turn, `ProviderCapabilities` has no soft-inject axis, and `MessageChunk` has no normalized message-consumption event.
These are current-code facts from `packages/workflows/src/steering-registry.ts:136,205,411–457,479–488`, `packages/server/src/routes/schemas/workflow.schemas.ts:546–573`, `packages/server/src/routes/api.ts:5448–5489`, `packages/workflows/src/dag-executor.ts:2440–2492`, and `packages/providers/src/types.ts:315–455,823–858`.
They do not prove current live-turn delivery.

The corrective contract needs a separate selected-item operation keyed by the existing server-owned queue item's `message_id` and selected `retry_epoch`.
The server must resolve the stored text and `operator_user_id`; the caller cannot replace either while sending that id.
The registry must bind that item to the active turn token and a provider-owned live-input port, then accept or reject exactly that item without draining its neighbors.
Calling `sendQuery()` again on a resumed session is a new turn and does not satisfy per-item Send now during generation.
The provider port must return a typed transport-acceptance result and expose independent, causally linked agent-consumption evidence when available.
Capability projection must name the exercised adapter and mode, not infer support from provider identity, an advertised hook, or an Aion capability flag.

| Stage       | Observable fact                                                                | Queue and transcript rule                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`    | Archon's registry accepted a message through Queue.                            | Keep it in the shared queue; no operator transcript row or `delivered` claim follows from this receipt.                                                                                                    |
| `sent`      | The live provider transport accepted the selected message for the active turn. | Remove only that item from the queue and append one operator row immediately; hide the sender name on this row only, while retaining stored attribution and the stamped id.                                |
| `delivered` | The agent consumed that selected message.                                      | Change only its existing row after a matching native lifecycle event or other causal proof; an RPC acknowledgement, arbitrary stream output, text match, timestamp, and route acceptance are insufficient. |

The AionCore `PromptAccepted` and `MessageLifecycle` variants in `AionCore/crates/aionui-session/src/event.rs:309–315,608–619` illustrate why transport handoff and consumption need separate events.
They are not evidence that Archon's Claude SDK, OMP CLI, or any other adapter emits either event.
An echoed caller id is one valid correlation key if the Archon SDK exposes it.
A stream can also prove consumption if it identifies the selected message, or if a new turn carried only that message and its first model output is observed.
The exclusive-new-turn case can apply to ordinary boundary delivery; it cannot justify a per-item active-turn claim by silently starting a new turn.
Without causal proof, an accepted row stays `sent`.

### Races and error contract

1. Claim one queued id and active turn token before the asynchronous provider call.
   Natural queue drain and Delete must not take the claimed item while that call is unresolved; unrelated queued items keep their relative receipt order.
2. If the provider rejects before acceptance, release the claim and leave the selected item in its original queue position with no operator row.
   An unsupported direct request returns a typed refusal; the UI omits the action for a queue-only mode.
3. If the turn ends, Stop lands, the selected epoch changes, or Cancel wins before proven active-turn acceptance, do not convert this action into a next-turn send.
   Preserve the item or report an explicit unresolved outcome; do not silently mark it `sent` or `delivered`.
4. If provider acceptance wins, remove exactly the selected item, append one idempotent operator row, and show `sent` even if model consumption is still unknown.
   A late acknowledgement must be fenced by the active turn token; an uncertain timeout must not trigger blind reinjection.
5. If the transcript write fails after transport acceptance, keep the accepted id available for retry and surface the recording failure.
   Do not put the item back into a path that can send it twice.
6. A matching consumption event upgrades only that row to `delivered`.
   Repeated receipts, confirmations, concurrent operators, and reconnects must preserve one send and one row per stamped id.

The accepted-versus-recorded boundary is a cross-process failure risk because the live queue is process-local while the transcript is stored.
The implementation Story must prove its recovery behavior before release; this proposal does not add speculative durable steering state.

### Provider-by-provider evidence and verification gate

| Archon path | Current evidence                                                                                                                                                                                                                                               | Required gate before per-item action appears                                                                                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude      | `packages/providers/src/claude/provider.ts:95–110,1799–1810` holds a one-message `AsyncIterable` open for native interrupt; it has no second-message live input API, and the lockfile pins SDK 0.3.209.                                                        | Extend the live input path and prove one selected message enters the same active turn while a tool call continues, without Stop or a turn-start event. Test tool-boundary and pure-text turns, rejection and turn-end races, and a correlated consumption signal through the actual Archon SDK version. An SDK bump alone is not proof. |
| OMP         | `packages/providers/src/community/omp/provider.ts:147–177,346–415` starts `omp --mode json -- <prompt>` for each `sendQuery()`; Archon has no RPC `steer` port. The provider matrix cites OMP RPC steering as candidate work.                                  | Build or select the real RPC mode, prove the `steer` command accepts one selected item into the active turn without ACP cancellation, preserve queue order, and confirm whether any event proves consumption. Treat an RPC command acknowledgement as `sent` only.                                                                      |
| Codex       | `packages/providers/src/codex/provider.ts:1006,1093` resumes a thread and calls one-shot `runStreamed()`; Archon does not call an app-server `turn/steer` endpoint.                                                                                            | Keep the current adapter queue-only and omit per-item Send now. A future adapter may pass the same live-turn gate, but Aion's app-server support does not prove Archon's TypeScript SDK support.                                                                                                                                        |
| DeepSeek    | `packages/providers/src/community/deepseek/provider.ts:139–215` sends one ACP prompt through `runDeepseekAcpTurn()`; the provider matrix records rejection of a concurrent prompt.                                                                             | Keep the current adapter queue-only and omit per-item Send now. A different live channel needs its own active-turn and consumption proof before capability changes.                                                                                                                                                                     |
| Grok        | `packages/providers/src/grok/provider.ts:110–125,264–281` starts `grok --single <prompt>`; this path has no live input. The provider matrix records `x.ai/interject` returning `-32601` through third-party ACP and lists hooks as advertised but unexercised. | Keep this Archon mode queue-only and omit per-item Send now. Grok hook work is not required for the approved soft-inject state on another proven transport; if Grok is required to show the action, its reachable hook and active-turn semantics become a current release blocker, not an assumed later feature.                        |

The provider matrix is research input, not a capability declaration for shipping UI.
The earlier `plans/reports/scoutcli-260912-midturn-cli-providers.md` inferred `x.ai/interject` from Grok binary literals, while the later provider matrix records a third-party ACP `-32601` handshake; current Archon code still uses `--single`.
Claude and OMP remain current candidate paths with unproved gates.
If either cannot meet the active-turn contract, record the failed conformance and block that release claim instead of downgrading per-item Send now to Queue or dock Send now.
The 70-item mockup inventory stays current, including both the supported-provider action and the queue-only absence.

### Trade-offs

- A universal `message_id` echo would make correlation simple, but not every Archon transport exposes it.
  The typed acceptance and consumption stages preserve truthful status without inventing a universal provider event.
- Hiding the per-item action on unproved or queue-only modes is honest, but it makes transport conformance a release gate for the approved soft-inject state.
- Keeping only the selected item in flight preserves the shared queue order and avoids surprise bulk sends; it requires explicit claim and race handling in the registry.
- Keeping an accepted but unconfirmed row at `sent` may last through the turn, but it avoids claiming model consumption from an unrelated stream.

## 6. Handoff and success criteria

The planning owner applies approved edits to the canonical SPEC, affected companions, both Architecture spines, both UX spines, and the Epic document.
The Product Owner accepts the new Epic 4 backlog.
The implementation team delivers the new Stories later and updates the tracker through its supported workflow.
This planning pass ends only after document links and claims are checked, conflict markers are absent from changed sources, the 70-item mapping is complete, and the BMAD readiness workflow runs again.
The desired readiness verdict is READY for planning; implementation status remains separate.

## 7. Change-navigation checklist

| Item                               | Result                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1.1–1.3 trigger, problem, evidence | Done: 2026-09-24 readiness assessment and manifest.                                                                 |
| 2.1–2.5 Epic impact and order      | Done: prior Epics remain historical; new Epic 4 follows them.                                                       |
| 3.1–3.4 artifact impact            | Done: SPEC, companions, both Architecture spines, both UX spines, Epics, and verification prose.                    |
| 4.1 direct adjustment              | Viable: new corrective Epic and source repair.                                                                      |
| 4.2 rollback                       | Not viable: it would not resolve source conflicts.                                                                  |
| 4.3 scope reduction                | Not viable: it would remove approved mockup behavior.                                                               |
| 4.4 path                           | Done: moderate backlog change, no product code in this pass.                                                        |
| 5.1–5.5 proposal and handoff       | Done: sections 1–6.                                                                                                 |
| 6.1–6.2 review                     | Done: claims checked against the manifest, readiness report, owning sources, and valid links.                       |
| 6.3 explicit approval              | Done: the coordinator said “ok làm đi” after the M009 conflict was explained; the manifest correction is validated. |
| 6.4 tracker                        | Deferred to the tracker owner because the file is generated and already conflicted.                                 |
| 6.5 handoff                        | Planning-source repair may proceed; product implementation remains a separate handoff.                              |

## Unresolved questions

The approved visual behavior is clear, but Archon live-turn and consumption proof for Claude and OMP remains open.
Grok remains in the approved queue-only state on its current Archon adapter; a Grok live-turn action would require its own proven channel.
The manifest now records the later consumption-proof answer directly, so readiness must use the revised manifest rather than the earlier exact-echo wording alone.
