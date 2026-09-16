---
title: Implementation Readiness Assessment
date: 2026-09-15
project: Archon
target: spec-agent-node-room
status: complete
stepsCompleted:
  [
    step-01-document-discovery,
    step-02-prd-analysis,
    step-03-epic-coverage-validation,
    step-04-ux-alignment,
    step-05-epic-quality-review,
    step-06-final-assessment,
  ]
currentStep: complete
inputDocuments:
  - '_bmad-output/specs/spec-agent-node-room/SPEC.md'
  - '_bmad-output/specs/spec-agent-node-room/control-states.md'
  - '_bmad-output/specs/spec-agent-node-room/engine-integration.md'
  - '_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md'
  - '_bmad-output/specs/spec-agent-node-room/steering-api-contract.md'
  - '_bmad-output/specs/spec-agent-node-room/steering-test-plan.md'
  - '_bmad-output/specs/spec-agent-node-room/test-plan.md'
  - '_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md'
  - '_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md'
  - '_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/epics-agent-node-room/epics.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md'
  - 'claude-design/design_handoff_node_room_transcript_steering/README.md'
  - '_bmad-output/planning-artifacts/epics-agent-node-room/implementation-readiness-report-2026-09-15.md'
  - '_bmad-output/planning-artifacts/epics-agent-node-room/sprint-change-proposal-2026-09-15.md'
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-15
**Project:** Archon
**Target:** `spec-agent-node-room`
**Status:** Assessment in progress.

## Assessment boundary

Check the feature requirements, UX, architecture, epics, and stories for completeness and agreement.
Record evidence for each gap and a final readiness decision after the assessment steps are complete.
The user confirmed the document selection with `C`.

## Confirmed document inventory

Sizes are in bytes.
Modification times use the local time zone, UTC+07:00.
Use the current workspace files, including tracked edits and new files.
Treat the prior assessment and change proposal as review context, subject to source verification.
Keep broader and earlier document sets as context unless the user selects them as primary inputs.

### Requirements and feature contracts

| File                                                                                                                                                                                                           | Bytes | Modified                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------- |
| [\_bmad-output/specs/spec-agent-node-room/SPEC.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/SPEC.md)                                             | 28186 | 2026-09-15T19:16:00+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/control-states.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/control-states.md)                         | 10487 | 2026-09-15T15:02:24+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/engine-integration.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/engine-integration.md)                 | 16979 | 2026-09-15T15:02:24+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md)     | 10762 | 2026-09-15T15:02:24+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/steering-api-contract.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/steering-api-contract.md)           |  4737 | 2026-09-15T19:28:49+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/steering-test-plan.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/steering-test-plan.md)                 |  6269 | 2026-09-15T19:21:58+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/test-plan.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/test-plan.md)                                   |  7947 | 2026-09-15T19:28:47+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md)                 |  5430 | 2026-09-15T15:02:24+07:00 |
| [\_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md) | 18472 | 2026-09-15T15:02:24+07:00 |

### Project PRD context

| File                                                                                                                                                                                                     | Bytes | Modified                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------- |
| [\_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md) |  9502 | 2026-07-30T14:29:20+07:00 |

### Architecture

| File                                                                                                                                                                                                                                                                                                                       | Bytes | Modified                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------- |
| [\_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md) | 32700 | 2026-09-15T19:15:02+07:00 |
| [\_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md)             | 40681 | 2026-09-15T19:15:11+07:00 |

### Epics and stories

| File                                                                                                                                                                                             | Bytes | Modified                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----: | ------------------------- |
| [\_bmad-output/planning-artifacts/epics-agent-node-room/epics.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/epics-agent-node-room/epics.md) | 38509 | 2026-09-15T19:28:37+07:00 |

### UX

| File                                                                                                                                                                                                                                                           |  Bytes | Modified                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------- |
| [\_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md)         |  59925 | 2026-09-15T19:24:09+07:00 |
| [\_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md) | 169433 | 2026-09-15T19:24:12+07:00 |

### Design handoff

| File                                                                                                                                                                                                        | Bytes | Modified                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------- |
| [claude-design/design_handoff_node_room_transcript_steering/README.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/claude-design/design_handoff_node_room_transcript_steering/README.md) | 30070 | 2026-09-15T19:16:28+07:00 |

### Prior assessment and change proposal

| File                                                                                                                                                                                                                                                                       | Bytes | Modified                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------- |
| [\_bmad-output/planning-artifacts/epics-agent-node-room/implementation-readiness-report-2026-09-15.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/epics-agent-node-room/implementation-readiness-report-2026-09-15.md) | 43943 | 2026-09-15T17:37:00+07:00 |
| [\_bmad-output/planning-artifacts/epics-agent-node-room/sprint-change-proposal-2026-09-15.md](/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/planning-artifacts/epics-agent-node-room/sprint-change-proposal-2026-09-15.md)                   | 24066 | 2026-09-15T19:29:57+07:00 |

## Other document sets found

- Whole project files: `planning-artifacts/architecture.md`, `epics.md`, and `ux.md`.
- Other architecture groups: 2026-09-05 general architecture and source-control architecture.
- Other UX groups: 2026-08-31 and 2026-09-05.
- Other epic groups: source control and workflow-run view HITL.
- Other PRD group: `prds/prd-source-control/`.
- Related implementation plans and PRDs: `docs/superpowers/plans/` and `docs/superpowers/ralph/`.

The paths under `planning-artifacts/` above are relative to `_bmad-output/`.
File names and dates alone do not prove that these sets are conflicting duplicates.
The proposed selection uses the named feature spec, matching epic group, the two September 12 architecture spines, and September 9 UX.
The grouped feature documents use named entry files instead of `index.md`.
No required document category is absent from the proposed inventory.
Content completeness and authority still require assessment.

## Workflow state

The customization resolver completed without error.
There are no activation prepend or append steps.
Project context was loaded from `_bmad-output/project-context.md`.
For any alleged conflict, quote and classify both claims, attempt reconciliation, and prove mutual exclusion before reducing readiness.
An ambiguous statement alone is a clarification item and does not reduce readiness.
The session restricts new Markdown files to `plans/` or `docs/`, so this report is in `plans/reports/`.

## Unresolved questions

- None at document confirmation.

## PRD Analysis

### Source authority and scope

The confirmed `prd.md` is titled “Archon Slice For Hermes Agent Workflow Commander”.
Its product boundary applies to that provider integration, not to all Archon features.
The target SPEC explicitly unifies the readable transcript and live steering features.
Use its CAP-1 through CAP-13 as this assessment's functional requirement IDs.
The target SPEC is the feature PRD for this check.
Do not report the separate Workflow Commander headless scope as a conflict with the node-room UI.

### Functional requirements — exact feature text

The **read** half is CAP-1…CAP-7; the **write** half is CAP-8…CAP-13.

### Read — a scannable transcript

- **CAP-1** — Scan a node's work without expanding anything
  - **intent:** A reader can scan a node's tool calls one line each and tell what ran, what it ran on, and whether it worked.
  - **success:** A node with forty tool calls renders forty single-line rows, each carrying a family chip, a status glyph, a headline naming the salient argument, and right-aligned badges.
    Successful calls are collapsed on first render and failed calls are expanded.
    No collapsed row contains serialized-data punctuation.

- **CAP-2** — Expand a call into a body shaped for that kind of tool
  - **intent:** A reader can open any tool call and see its input and output rendered for the kind of tool it is.
  - **success:** Every family renders its declared body arm per `tool-presentation-contract.md`.
    A tool matching no family renders at most three scalar `key: value` pairs, with objects and arrays collapsed to `{…}` / `[n]`, and never a JSON dump.
    Measured against the production corpus, the generic fallback claims under 2% of rows.

- **CAP-3** — Follow the agent's checklist as state, not as mutations
  - **intent:** A reader can see the agent's current todo list, with phases and per-item status, instead of a sequence of opaque updates.
  - **success:** Both provider shapes normalize to the same `TodoPhase[]` per `todo-fold-contract.md`.
    The checklist renders once, anchored at the last todo call; earlier todo calls collapse to a one-line row.
    A phase emptied by `rm` disappears rather than rendering an empty header.
    A **pinned todo strip** at the top of the transcript panel mirrors the same `TodoPhase[]` and stays visible while the transcript scrolls, so current progress is always in view; it is absent when the node has no todos.

- **CAP-4** — See what a subagent dispatch asked for
  - **intent:** A reader can see the brief a task dispatch carried and which subtasks it spawned.
  - **success:** Both provider shapes normalize to `TaskSubtask[]`.
    The card renders batch context as markdown when the provider sends any, then one collapsible card per subtask naming the subtask and its agent.

- **CAP-5** — See what a file edit changed
  - **intent:** A reader can see the actual change a file edit made, inline, without leaving the transcript.
  - **success:** When the payload carries both before and after content, a line diff renders through `react-diff-view`.
    Claude always qualifies — `FileEditInput` declares `old_string` and `new_string` as required.
    Codex never does and falls back to path plus preview.
    A diff is never fabricated from one side.

- **CAP-6** — Tell attempts and loop iterations apart
  - **intent:** A reader can tell which attempt or loop iteration produced a given tool call.
  - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none.
    Grouping keys on `occurrence_id`, never on `attempt_id`.
    A **loop-iteration selector** lets the reader navigate directly between occurrence groups — the per-group headers remain the anchors it targets — and is absent on a single-occurrence node.

- **CAP-7** — Keep the raw payload reachable
  - **intent:** A developer debugging a provider can still read the exact bytes the provider sent.
  - **success:** Every card exposes a Raw toggle revealing the original JSON, closed by default.
    This is the **only** place serialized JSON appears.
    Today's `canLoadFullOutput` / `onLoadFullOutput` flow keeps working.

### Write — steer the live agent

- **CAP-8** — Compose while the agent works
  - **intent:** An operator watching a running node can write a message without disturbing it.
  - **success:** The composer is mounted and enabled while the node runs, and the send control reads `Queue`.
    Sending holds the message; the node is untouched, no tool call is interrupted and nothing is lost.
    The message is delivered as the next turn when the current turn ends naturally.
    The interface states that the queue is per-tab.

- **CAP-9** — Interrupt the agent's thinking; the node keeps running
  - **intent:** An operator can stop the agent's _current generation_ to redirect it, without stopping the node or abandoning the run.
  - **success:** An interrupt control in the node's composer dock ends the agent's **current turn** — via the provider's own primitive (claude `interrupt()`) or a stream-abort — and the **provider session stays alive**.
    The **node stays `running`** throughout (its agent moves to a projected `idle-after-interrupt` sub-state) — never paused, never `pending`, never `node_failed`.
    The transcript shows the in-flight tool call as _interrupted_ rather than _failed_ (this is CAP-1's status glyph `⚠`).
    Interrupting the agent is **not** stopping the node: that is the existing **Cancel** feature, separate and untouched.
    Nothing suggests the interrupt undid work already written.

- **CAP-10** — Redirect and continue on the same live session
  - **intent:** After interrupting, the operator sends what to do instead and the agent carries on from there — on the same session, in the same node.
  - **success:** Once the agent is `idle-after-interrupt`, the send control reads `Send now`.
    Sending delivers every queued message plus the one just typed, **in written order**, as the **next turn on the same provider session** (reusing the `attemptResumeId` re-ask seam).
    The node **continues** — it never "resumes" from a pause, because it never paused.
    Ordering is enforced by us, not assumed of the provider.
    Both controls follow the agent's projected sub-state, not a remembered mode.

- **CAP-11** — The exchange is part of the record
  - **intent:** Anyone reading the transcript afterwards can see what the operator said, and when, relative to what the agent did.
  - **success:** The operator's messages and the interrupted tool call appear as ordinary transcript rows in the order they happened — between the call they interrupted and the one they caused.
    An operator row is visibly the operator's, never mistakable for the agent's own text.
    _This is where the write half writes into the read half — see Cross-half dependency._

- **CAP-12** — Mid-turn delivery, as fast as each provider's transport allows
  - **intent:** The operator's message reaches a running agent without interrupting it, and sooner on a provider whose transport can take it mid-turn.
  - **success:** Sending to a running agent is an **ordinary prompt**, not a separate steer primitive — so **when** it reaches the agent is the operator's choice and only _soft-inject_ is gated by provider transport.
    `Queue` (the default, on every provider) delivers it as the next turn at the natural boundary, non-interrupting.
    Where a provider's open stream accepts a message mid-turn (claude streaming input), the same prompt arrives **before** turn-end with no interrupt, no interrupted tool call, and no turn-start event.
    claude's mid-turn path is **spike-gated** — whether `AsyncIterable` streaming input composes with the resume protocol is unverified at the pin — so the **v1 floor is interrupt + Queue** (needs no spike) and soft-inject ships when the spike clears.
    No provider is disqualified: interrupt-then-deliver is reachable on every one.

- **CAP-13** — The interface claims only what it knows
  - **intent:** An operator can tell whether a message merely left the browser or actually reached the agent.
  - **success:** A message reads `sent` until the provider echoes back the id we stamped on it, at which point it reads `delivered`.
    Correlation is by id alone.
    Only claude can echo the id, and that echo needs `@anthropic-ai/claude-agent-sdk` **≥ 0.3.246**; at the inherited pin **0.3.209 no provider can echo**, so today every message stays `sent`.
    `delivered` becomes reachable — claude-only — after that SDK bump.

**Total feature FRs: 13 (CAP-1 through CAP-13).**

### Constraints and non-functional requirements — exact feature text

### Shared — both halves land in `packages/web`

- **C-01** — `@archon/web` must **not** import from `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`.
- **C-02** — **Console must not import from `@/components/`.** Shared logic lands in `packages/web/src/lib/` and the JSX is written twice, thin — duplicating a little JSX for a surface scheduled for deletion beats refactoring code on its way out.
- **C-03** — Both node rooms (Legacy + Console) ship **together**, on the owner's explicit and re-confirmed decision, even though Legacy is scheduled for deletion and Console is the default route.
- **C-04** — Strict TypeScript, no unjustified `any`, ESLint at zero warnings.
  `bun run validate` is the pre-PR gate.
- **C-05** — Code comments and test names carry **no** plan/section/finding references — comments explain the invariant.

### Read half

- **C-06** — Ships **no schema change, no migration, and no backend change.** Anything that would need new persisted data is out of scope by definition — that is the line that keeps it retroactive.
- **C-07** — **No raw `JSON.stringify` as a default presentation anywhere in the transcript.**
  It survives only behind CAP-7's explicit toggle.
  This is the defect being fixed; re-introducing it in a fallback path fails the spec.
- **C-08** — Status must be decodable **without colour** — a glyph character carries it, colour only reinforces.
- **C-09** — A chip shows the tool name only when that name is **a single token of at most 24 characters**; otherwise it shows the **family name**.
  The 24-character cap is the guard behind the rule, never an instruction to truncate with an ellipsis.
- **C-10** — Tool identification **duck-types over alias sets**; no name-keyed mapping table.
  Match **exact tokens, never substrings** (`search_replace` is an edit, not a search).
- **C-11** — **Provider shape differences are normalized at the edge, never branched on in a renderer.** A small normalizer in `lib/` converts each provider shape to one shared shape; `ToolPresentation` stays render-neutral and neither renderer learns a provider name.
- **C-12** — Path headlines elide in the **middle**; commands and patterns elide at the **end**.

### Write half

- **C-13** — **v1 release gate (owner-ratified 2026-09-15).**
  Steering v1 ships at the universal floor — interrupt + `Queue`, every message `sent`, on every provider.
  `delivered` (G1 · claude SDK ≥ 0.3.246), claude soft-inject (G2 · spike), and grok hooks (G3 · spike) are **post-v1 gated backlog**, each on its own external gate; none blocks the v1 release.
- **C-14** — **Steering acts on the live agent, never on the node lifecycle.**
  _Send_ and _interrupt_ both operate on the running node's **live provider session**.
  The node stays `running` throughout — no pause, no `pending`, no resume, no `node_failed`.
  There is **no durable steering state**: no marker, no phase, no CAS, no attempt-key.
  Stopping the whole node is the existing **Cancel**/abort path, out of scope and untouched.
- **C-15** — **Interrupt is the provider's own primitive (or a stream-abort) on a per-turn signal, never the node-level one.**
  The executor's `nodeAbortController` (`dag-executor.ts:2209`) is **one-shot and Cancel's** (its `:3124` check fails the node; the re-ask loop stops on it, `:3032`).
  Steering interrupts through a **fresh per-turn signal** combined with the node-level one (`AbortSignal.any`), so each new turn gets a fresh signal — which is what lets the node run multiple turns and never trips `:3124`.
  `operatorInterrupt` is a **per-turn flag resolved by placement** in the existing flow (`stream → validation → canReask :3032 → :3124 Cancel check → completion`): `canReask` must also stop on it; validation is skipped on an interrupted turn; its branch sits immediately after the `:3124` Cancel check so Cancel dominates by position; it is reset at turn N+1.
  A turn that emitted a provider-normalized `result` (`:2533`) completed naturally regardless of the flag.
  See `engine-integration.md`.
- **C-16** — **A steered node runs multiple provider turns on one live session — the one new engine behaviour.**
  It reuses the structured-output re-ask seam that re-invokes `sendQuery` with `attemptResumeId` on the same session (`dag-executor.ts:2290`).
  **Turn-end has two causes:** a **natural** end **auto-drains** (next turn on a queued message, else completes the node when the queue is empty); an **interrupted** end produces a **partial** result that must not be validated, completed, or advanced, and **always enters idle-await whatever the queue holds** — draining only on the operator's `Send now`.
- **C-17** — **In-process only; no durable steering state.**
  The **in-process registry** — keyed `(runId, nodeId)`, holding the node's live session handle plus an in-memory inbound queue, valid only while the node runs in this process — is the sole mechanism.
  Web dispatch runs the executor in the API server's process; a detached CLI run has no reachable handle, so steering is **unavailable** for it in v1 (Cancel and normal resume still work; the UI states this).
  A server restart drops the live session and any in-flight steer; the run resumes normally.
- **C-18** — **Two queues, split on send vs draft.**
  The pre-send **draft** is per-tab browser state (no table, no migration; the UI says per-tab).
  Once sent, the message rides the **in-memory registry queue** on the live handle — safe there because that path exists only while the live node does.
- **C-19** — **An operator message is an ordinary `text` transcript row carrying three additive `metadata` fields:** `origin = 'operator'`, `operator_user_id` (the sender, for CAP-11 attribution on a multi-user install), and `message_id` (the caller-stamped id, so the client can reconcile which `sent` messages became rows).
  No new table, no widened `kind` enum — the `.strict()` metadata schema takes additive fields plus a regenerated `api.generated`, not a migration.
  The executor is the **sole** writer; the row is a receipt for the record, not the delivery vehicle.
- **C-20** — **Send and Interrupt are new routes; the queue absorbs races, only a finished node refuses.**
  `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt`, resolving identity via `resolveAuthContext` under HITL/AD-7.
  There is **no phase/marker gate**, and nothing is lost.
  A Send arriving while an interrupt is in flight waits in the queue for the operator's `Send now`.
  The **only** refusal: a node no longer running — `node finished` → **409** (the draft stays in the browser) — and no live handle in this process (detached) → a clear "not steerable here".
  On **any** terminal (finish, Cancel, or the 30-minute idle-await fail) the in-memory queue dies with the registry, so the client reconciles its `sent` ids against the `message_id` on the operator rows actually written — **only on the node's terminal event** (`node_completed`/`node_failed`, never a live refetch); any unmatched `sent` id is restored to the draft box as **"Never sent"**.
  With two docks on one node, **global order is the registry's receipt order**; each row's `operator_user_id` attributes it — no per-node steering lock.
- **C-21** — **The dock does not appear on a finished node.**
  Settled by the owner.
  The field and both controls are absent — a control that cannot act must not be drawn.
  Re-running a finished node is `workflow retry-node`, its own capability with its own confirmation, not this dock.
  An undelivered draft box stays rendered **read-only**, stating the node finished and the messages never left.
- **C-22** — **Interrupt is not undo.**
  Session state is saved up to the last completed tool call, but files already written stay written — nothing is rolled back.
  The control must not imply otherwise.
- **C-23** — **A steer delivery must not emit a turn-start event** — a stray one opens a phantom turn boundary and corrupts the record the transcript is built from.
- **C-24** — **Delivery is confirmed by id, never by matching text or timestamps.**
- **C-25** — **Steering is universal over a queue-and-flush floor; mid-turn is the acceleration.**
  Every provider delivers an operator message — at worst as the next prompt at turn-end.
  A provider earns _soft-inject_ only from a transport exercised against it, never one merely advertised.
  Providers differ on two honest axes: **boundary granularity** (mid-turn vs turn-end) and **delivery confirmation** (CAP-13).
- **C-26** — **The 30-minute idle-await fail is an inactivity timer (owner-ratified, SC 2.2.1).**
  While the agent is `idle-after-interrupt` and nothing is sent, a **fresh 30-minute timer** (an explicit fail branch — not the existing idle-timeout, which _completes_ the node) fails the node (`interrupted by operator, no redirect received`).
  Idle-await runs its own timer-driven status poll so `/workflow cancel` still reaches it, and **resolves exactly once** (`Send now`, cancel-poll, or timer).
  The timer is an **inactivity** timer: a debounced, authorized composing keepalive **re-arms** it without resolving idle-await, so the node fails only after 30 minutes of genuine operator inactivity — the limit is disclosed in the dock and adjustable by activity; the 30-minute value is unchanged.
  Resuming a 30-minute-failed node re-runs it with a **fresh session** — the interrupted context is gone.

**Total explicit constraint clauses: 26.**

The following clauses contain the principal non-functional requirements.
The complete wording is retained above; IDs below point to those clauses.

| NFR    | Clause           | Concern                                                              |
| ------ | ---------------- | -------------------------------------------------------------------- |
| NFR-01 | C-01             | Generated API types and web package boundary                         |
| NFR-02 | C-02             | Console import boundary and shared logic                             |
| NFR-03 | C-03             | Both node rooms ship together                                        |
| NFR-04 | C-04             | Strict typing, zero lint warnings, pre-PR validation                 |
| NFR-05 | C-05             | Stable comments and test names                                       |
| NFR-06 | C-06             | Historical compatibility without read-side schema or backend changes |
| NFR-07 | C-07             | Raw JSON only behind the explicit Raw control                        |
| NFR-08 | C-08             | Status remains readable without colour                               |
| NFR-09 | C-09             | Bounded chip width without truncating the name                       |
| NFR-10 | C-10             | Exact tool alias matching                                            |
| NFR-11 | C-11             | Provider normalization outside renderers                             |
| NFR-12 | C-12             | Path and text elision rules                                          |
| NFR-13 | C-14, C-15, C-16 | Node lifecycle safety and multi-turn session continuity              |
| NFR-14 | C-17, C-18       | In-process state and per-tab draft boundary                          |
| NFR-15 | C-19, C-20       | Attribution, ordering, loss recovery, and sole transcript writer     |
| NFR-16 | C-22, C-23, C-24 | No undo claim, no phantom turn start, ID-only delivery evidence      |
| NFR-17 | C-26             | Accessible inactivity bound and single-resolution wait               |

**Total feature NFR groups: 17.**
These groups classify the exact clauses above; they do not add new requirements.

### Additional requirements and ordering constraints

#### Cross-half dependency

CAP-11 (the operator row) writes into the read half.
`AgentHistoryItem` has kinds `assistant | tool | lifecycle`, and an operator row is none of them; the read half's architecture puts every row's meaning in the shared core (`packages/web/src/lib`).
So CAP-11 adds a **new item kind** and its two-shell treatment, and the CAP-1/CAP-2 transcript renderer must recognize it — an operator `text` row must not reach a live transcript until the reader recognizes `origin='operator'`, else it renders as agent text.
Because the two halves are now one spec, this is an **internal** ordering dependency, not a cross-spec one: build the reader's recognition of `origin='operator'` before CAP-11 ships.

**Second cross-half reader dependency — the interrupted status row.**
CAP-9 makes `⚠ interrupted` universal: the executor writes a separate `interrupted` status row on **every** provider at delivery, not only through Claude's `PostToolUseFailure` hook.
For that glyph to reach the row, the read half's `deriveOutcome` (`agent-history.ts:120`) must fold that status row into the **preceding** tool call's outcome — else `⚠` is unreachable on non-Claude providers even after the write lands.
Like the operator row, this is an internal ordering dependency: the reader's fold ships before the write half emits cross-provider interrupted rows.

#### Non-goals

- **Cancelling the whole node.**
  The existing Cancel/abort feature is untouched.
  This feature only interrupts the agent's generation and keeps the node running.
- **Cancelling one individual tool call.**
  No provider offers it below turn level.
  Interrupt is turn-level; Cancel is node/session-level.
- **Surviving a server restart mid-steer, and steering a detached run.** In-process only in v1; both deferred.
- **Persisting the draft queue**, and **auto-send queue mode** — every send stays operator-initiated.
- **RunStream `ToolCallItem.tsx`, Chat `ToolCallCard.tsx`, and the backend `tool-formatter.ts`.** The read half touches only the two node rooms; the others are a different data path or a deliberate design.
- **A run-level "Files changed" panel**, and node-level git attribution generally — the git routes are run-scoped.
  Per-tool-call diffs (CAP-5) are the only node-level attribution available.
- **`qodercli`, `pi`, `copilot`, `opencode` steering.** Not in use today.
- **Agent thinking, the triggering prompt, and advisor notifications** (the rest of "Track B") — they need persistence that does not exist and are out of scope; mid-turn steering, which used to sit in that bucket, is now the write half above.

#### Success signal

An operator opens a node from a run **already in the database** — no re-run, no migration — and reads what the agent did as a scannable list rather than a JSON dump: the one failing `bash` call in a forty-call node is visible with its command and its exit code without a single click, and no JSON appears anywhere unless the reader asks for it.

Then, on a **live** node, the operator watches it run the wrong test suite, types a correction, **interrupts the agent's thinking**, and sends it — and the agent **continues on the same session** against the right one, **without the node ever stopping**, without abandoning the run, and without losing the record.
Reading that transcript a week later shows the wrong command, the operator's correction, and the right command, in that order.

#### Assumptions

- Both node rooms ship together (owner-confirmed, re-confirmed).
  The render fork means a second JSX pass and a second renderer test suite for a surface with a finite life; shared logic in `lib/` is written once.
- Alias sets absorb provider **naming** drift, so no name-keyed mapping table is needed.
  They do **not** absorb semantic drift (the same key can carry a different meaning per provider, and two tools can share a name with incompatible structures) — those are handled by the normalizers.
- The production corpus is representative: **22,867 tool rows across 31 runs and 2,369 distinct tool names**, measured read-only against the deployment's own database.

#### Companion contract requirements

| ID    | Required contract                                                                                                                         | Source                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| CC-01 | Render-neutral `ToolPresentation` input/output and nine tool families                                                                     | `tool-presentation-contract.md` → Module                                                                            |
| CC-02 | Ordered resolver tiers, exact alias sets, glob scope, search output modes, Codex wrapper removal, multiline headlines, and generic bounds | `tool-presentation-contract.md` → Resolver                                                                          |
| CC-03 | Family-specific expanded bodies, raw payload access, full output loading, badges, and collapsed defaults                                  | `tool-presentation-contract.md` → Collapsed row / Expanded body                                                     |
| CC-04 | Deterministic bounded `diff@9.0.0` adapter, no-newline marker handling, shared adapter move, memoization                                  | `tool-presentation-contract.md` → Inline diff                                                                       |
| CC-05 | Occurrence grouping, normalized task dispatch, widened shared history result, and exit-code carriage                                      | `tool-presentation-contract.md` → Occurrence grouping / Provider normalizers / Changes to the existing shared layer |
| CC-06 | Claude whole-list replacement, nine OMP operations, all-target operations, auto-promotion, inferred operations, and empty-phase removal   | `todo-fold-contract.md`                                                                                             |
| CC-07 | Fresh per-turn signal, result discriminator, validation/re-ask guards, Cancel priority, and natural versus interrupted drain              | `engine-integration.md` → §2                                                                                        |
| CC-08 | Inactivity keepalive, idle Cancel poll, one wait resolution, same-session continuation, and fresh session after timeout                   | `engine-integration.md` → §2 / What this adds to the build                                                          |
| CC-09 | In-process registry, detached-run boundary, sole-writer operator rows, terminal-only reconciliation                                       | `engine-integration.md` → §3–4                                                                                      |
| CC-10 | Five-provider interrupt floor, transport-specific paths, and independent post-v1 gates                                                    | `provider-steering-matrix.md`; SPEC → Write-half v1 release gate                                                    |
| CC-11 | State-driven dock, queue ordering, recovery at the front, transient focus, read-only terminal drafts, and honest delivery labels          | `control-states.md`                                                                                                 |
| CC-12 | Typed send / interrupt / keepalive requests and responses, error codes, idempotency, race behavior, and no mutation on rejection          | `steering-api-contract.md`                                                                                          |
| CC-13 | Cross-provider fixture tables, both renderer suites, bounded diff checks, todo/task checks, and package boundaries                        | `test-plan.md`                                                                                                      |
| CC-14 | Turn-loop, provider conformance, fake timers, registry/routes, reconciliation, concurrent operators, and both-shell E2E coverage          | `steering-test-plan.md`                                                                                             |

Companion clauses refine the capability acceptance tests and will be checked against story acceptance criteria.
They are not counted as additional top-level capabilities.

### Separate project PRD — exact context requirements

The following requirements were read in full and retained for scope traceability.
They are outside the node-room feature backlog.

### FR-7: Register Generic Workflow Provider Bindings

Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records for a project or codebase using generic `provider` and `name` vocabulary.

**Consequences:**

- Archon persists a reverse binding from project or codebase execution context to controller `provider`, controller `name`, and workflow event route.
- Archon exposes binding status as parseable CLI JSON.
- Archon exposes update through an explicit `binding.update` command surface; `binding.create` is not an update or upsert path.
- Archon can represent missing, valid, stale, disabled, rotated, and conflicting binding states.
- Archon returns machine-readable errors for malformed input or invalid lifecycle transitions.
- Archon does not expose Hermes-specific command names or model fields.

### FR-8: Expose Provider Workflow Control Through CLI JSON

Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.
This is the producer side of the provider adapter that a controller such as Hermes consumes.

**Consequences:**

- Archon returns parseable JSON for every state-changing control result.
- Every result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, machine-readable result payload, and machine-readable error shape when failed.
- Archon returns machine-readable classifications for malformed requests, unexpected states, internally caught timeouts, and every other failure it catches before responding.
- The subprocess consumer classifies empty output or uncatchable process exit as unexpected exit, malformed or schema-invalid output as schema mismatch, and a consumer-enforced timeout as timeout.
- Archon does not expose a state-changing HTTP control path for Workflow Commander v1.

### FR-9: Produce Signed Typed Workflow Events

Archon emits signed typed workflow events for workflow start, workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.

**Consequences:**

- Archon writes eligible events to durable outbox state before delivery.
- Archon workflow execution continues even when event delivery fails later.
- Every event body includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, and idempotency key.
- Signature metadata travels in HTTP headers.
- Archon uses stable event id and idempotency key values so consumers can classify duplicate-safe delivery.
- Archon produces events that can be validated by shared event-envelope and rejection fixtures.

### FR-10: Surface Provider Event Delivery And Outbox Health

Archon reports workflow event delivery and outbox health as structured status.

**Consequences:**

- Archon persists delivery status, retry status, last attempt time when available, last error category, terminal failure state, and affected workflow run reference.
- Archon reports healthy, delayed, retrying, failed, duplicated, terminal failure, and reconciliation-pending states when known.
- Archon exposes delivery status through CLI JSON.
- Archon does not block workflow execution solely because event notification failed.

## Non-Functional Requirements Relevant To Archon

- **NFR-1:** Workflow events accelerate delivery but are not the only source of truth.
- **NFR-5:** Archon events must be signed and schema-versioned so consumers can reject invalid events.
- **NFR-6:** Event secrets and signature metadata must support binding-scoped validation by the consumer.
- **NFR-9:** Archon persists workflow commands, workflow events, and delivery state with enough detail for audit.
- **NFR-14:** Archon error and delivery-health responses expose diagnostic categories and machine-readable detail rather than raw stack traces.
- **NFR-15:** Archon stays within provider ownership boundaries and does not reach into Hermes-owned concerns.
- **NFR-16:** Provider integration surfaces remain generic provider surfaces.
- **NFR-17:** The local handoff is complete enough for isolated Archon implementation agents.

**Context totals: 4 FRs and 8 NFRs.**
Their absence from `epics-agent-node-room` does not count as missing feature coverage.

### PRD completeness assessment

The target defines observable success for all 13 capabilities, both UI surfaces, read/write sequencing, lifecycle safety, provider boundaries, queue recovery, and release gates.
G1 (`delivered`), G2 (Claude soft-inject), and G3 (Grok hooks) are explicitly post-v1.
The numbered capability mapping from older steering artifacts to CAP-8 through CAP-13 is explicit.
The eight local companion files were read completely.
Architecture, UX, and epic agreement are not decided in this step.

## Epic Coverage Validation

### Epic coverage extracted

The epic document was read completely (500 lines).
It contains one owner-approved epic, 15 v1 stories, and three post-v1 gate records.
Its FR1 through FR13 map directly to SPEC CAP-1 through CAP-13.
No additional top-level FR is invented by the epic.

### Coverage matrix

The requirement titles below refer to the complete capability text in PRD Analysis.

| Requirement   | Requirement title                                      | Story coverage                                          | Status                               |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------ |
| CAP-1 / FR1   | Scan a node's work without expanding anything          | 1.1; badges and bodies refined by 1.2–1.3               | Covered                              |
| CAP-2 / FR2   | Expand a call into a body shaped for that kind of tool | 1.2                                                     | Covered                              |
| CAP-3 / FR3   | Follow the agent's checklist as state                  | 1.4, including the pinned strip                         | Covered                              |
| CAP-4 / FR4   | See what a subagent dispatch asked for                 | 1.5                                                     | Covered                              |
| CAP-5 / FR5   | See what a file edit changed                           | 1.3                                                     | Covered                              |
| CAP-6 / FR6   | Tell attempts and loop iterations apart                | 1.6, including the selector                             | Covered                              |
| CAP-7 / FR7   | Keep the raw payload reachable                         | 1.1                                                     | Covered                              |
| CAP-8 / FR8   | Compose while the agent works                          | 1.7b, 1.8, 1.9                                          | Covered                              |
| CAP-9 / FR9   | Interrupt thinking while the node stays running        | 1.7a, 1.7b, 1.8, 1.10; reader fold in 1.1               | Covered                              |
| CAP-10 / FR10 | Redirect and continue on the same live session         | 1.7b, 1.8, 1.10                                         | Covered                              |
| CAP-11 / FR11 | Keep the exchange in the record                        | 1.11, 1.12a, 1.12c; reader hook in 1.1                  | Covered                              |
| CAP-12 / FR12 | Deliver at the supported boundary                      | v1 Queue floor in 1.7b–1.10; soft-inject in G2 and G3   | Covered to the explicit release gate |
| CAP-13 / FR13 | Claim delivery only from ID evidence                   | v1 `sent` floor in 1.11; ID-confirmed `delivered` in G1 | Covered to the explicit release gate |

### Additional contract coverage

| Contract group                                         | Story coverage                                           |
| ------------------------------------------------------ | -------------------------------------------------------- |
| CC-01–CC-03: presenter, resolver, bodies, Raw          | 1.1–1.2                                                  |
| CC-04: bounded diff and shared adapter                 | 1.3                                                      |
| CC-05: grouping, task shape, shared history, exit code | 1.1, 1.5–1.6                                             |
| CC-06: todo fold                                       | 1.4                                                      |
| CC-07: signal, result discriminator, drain rules       | 1.7a–1.7b                                                |
| CC-08: inactivity bound and idle lifecycle             | 1.7b, 1.12b                                              |
| CC-09: registry, record, and terminal recovery         | 1.7a, 1.8, 1.11, 1.12a                                   |
| CC-10: provider floor and gates                        | 1.7a, G1–G3                                              |
| CC-11: state-driven dock                               | 1.9–1.10, 1.12a–1.12b                                    |
| CC-12: typed routes and races                          | 1.8                                                      |
| CC-13–CC-14: read/write test plans                     | Listed as epic inputs and referenced by relevant stories |

### Missing requirements

No top-level feature capability is missing from the epic.
This is a traceability result, not a finding that every acceptance criterion is internally consistent or executable.
The next steps check those matters.

### Coverage statistics

- Total feature FRs: 13.
- FRs with a traced implementation or explicit gate: 13.
- Traceability coverage: 100%.
- Missing top-level FRs: 0.
- Post-v1 gate records: 3, explicitly excluded from v1 completion.

The separate Workflow Commander PRD contributes no missing FRs to this feature assessment.

## UX Alignment Assessment

### UX document status

Both UX spines exist and declare `status: final`.
Both architecture spines, the complete design handoff, and the latest change proposal were read.
Table padding was removed from tool output where needed; no document content was omitted from that review.
The historical readiness report was read as context, not accepted as current evidence.

### Confirmed alignment

- Read CAP-1 through CAP-7 have a shared, render-neutral core and two thin shells.
- The outcome alone selects the glyph; missing output is a separate badge.
- Bounded diffs, full-payload access, manual disclosure state, and occurrence grouping have architecture owners.
- Both rooms ship together; the read half needs no backend change or migration.
- The two projected agent states are `generating` and `idle-after-interrupt`.
- `Stopping…` is a local request transient, not a third projected state.
- The display name travels on the existing transcript read response, outside stored metadata.
- The inactivity timer, keepalive, terminal-only reconciliation, and detached-run disclosure are specified.
- The owner-approved brightened violet text and full-width queue band have explicit decisions.
- The older steering capability numbers map to the unified SPEC by adding seven.

### F2 — Blocking: the inherited authorization rule cannot admit two distinct operators

**Affected work:** Stories 1.8 and 1.12c; send, interrupt, and keepalive authorization.

**Claim A — normative authorization constraint:** HITL AD-7 says “Only `workflow_runs.user_id` may mutate”.
Steering AD-11 explicitly adopts that rule and says “not a new grant”.
Sources: [HITL AD-7](../../_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md:105), [steering AD-11](../../_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:171), and [API identity rule](../../_bmad-output/specs/spec-agent-node-room/steering-api-contract.md:7).

**Claim B — normative multi-user capability:** Story 1.12c requires “two docks steering one node on a multi-user install”, with each row attributed to its sender and per-operator order.
Steering AD-11 explicitly says “concurrent operators interleave in receipt order”.
Sources: [Story 1.12c](../../_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:459) and [steering receipt-order rule](../../_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:175).

**Reconciliation attempt:** two browser tabs can share the starter's identity.
That satisfies a two-tab case, but not two distinct operators attributed to different `operator_user_id` values.
Adding an admin exception from the retry route also fails to reconcile the text: retry has its own explicit owner-or-admin rule, while steering adopts HITL's starter-only rule and adds no grant.
See [the separate retry policy](../../packages/server/src/routes/api.ts:3064).

**Why this blocks readiness:** one implementation must either reject the second operator or grant permission that the inherited contract forbids.
The affected asset is a live session executing against the run starter's workspace and execution identity.
This is an actual permission decision, not a hypothetical tenant-isolation concern.

**Required resolution:** preserve the accepted multi-operator feature, but explicitly define its permitted actors and amend the inherited rule for steering only.
Specify starter, other member, admin, unauthenticated, and identity-less-run cases.
Apply the same rule to send, interrupt, and keepalive, with allowed and denied route tests.
Do not silently broaden access or reduce the feature to one operator.

### F3 — Major: the interrupt response cannot represent the required natural-end race

**Affected work:** Story 1.8, Story 1.10, and route race tests.

**Claim A — normative response schema:** the only successful interrupt response is `{ success: true, sub_state: 'idle-after-interrupt' }`.
Source: [API response schema](../../_bmad-output/specs/spec-agent-node-room/steering-api-contract.md:29).

**Claim B — normative state transition:** if the turn ends naturally before Stop lands and messages are queued, the queue auto-drains and the agent is generating again.
It does not enter idle-await.
Sources: [UX natural-end race](../../_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:176) and [steering AD-2 discriminator](../../_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:106).

**Reconciliation attempt:** return 409 when the node finishes.
That covers the empty-queue branch only.
With queued messages, the node remains running, so `node_finished` is false.
Returning the sole success shape would falsely report idle; waiting for another idle state could hang or affect the next turn.

**Required resolution:** define a truthful receipt for a spent interrupt and its observed state, or make the response acknowledge the request without claiming idle.
Retain the natural-end rule and test both empty and non-empty queue races.
This requires an explicit response-contract correction, not a change to the owner-approved interaction.

### F4 — Major: the waiting-message delete action has no transport contract

**Affected work:** Stories 1.8–1.10 and the queue UI tests.

**Claim A — normative UI action:** a waiting draft item has “keep and delete”.
Flow 4 places items in the visible queue after the operator presses Queue.
Sources: [Draft item](../../_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:134) and [Flow 4](../../_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:368).

**Claim B — normative delivery mechanism:** pressing Queue sends the message to the send route; the registry later drains it at the natural boundary.
Source: [Story 1.9](../../_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:367).
The complete API has send, interrupt, and bodyless keepalive only.
Its send intents are `queue` and `send_now`.
Source: [route and request list](../../_bmad-output/specs/spec-agent-node-room/steering-api-contract.md:10).

**Classification:** missing architecture/API support for a specified UI action, not a proven conflict between the local and server queue models.

**Reconciliation attempt:** treat Delete as local draft removal only.
That can work before submission, but Flow 4's visible queued items have already entered the server queue under Story 1.9.
Deleting only their browser copy cannot withdraw the queued prompt.
Keeping all messages local until Send now would instead break Queue's required delivery at the natural boundary.

**Required resolution:** specify which items can be deleted and a typed operation for withdrawing a server-queued message before dispatch, including the dispatch race and sender authorization.
If Delete applies only before submission, define that boundary explicitly and remove the misleading action from already-submitted items through an approved UX clarification.
Add a test in which an item is queued, deleted before the boundary, and not delivered.

### Reconciled differences and warnings — no readiness penalty

| Item                                                                      | Reconciliation or clarification                                                                                                                          | Disposition                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Root PRD is headless                                                      | It governs Workflow Commander only.                                                                                                                      | No conflict                                                               |
| Read-side no-backend rule versus operator display-name join               | The join belongs to the write half in Story 1.11.                                                                                                        | No conflict                                                               |
| Existing Claude interrupted outcome versus universal steering outcome     | Existing runtime capability and planned write-side capability are different claims.                                                                      | No conflict                                                               |
| Two projected states versus `Stopping…`                                   | The latter is UI-local request state.                                                                                                                    | No conflict                                                               |
| 460px versus 520px                                                        | 460px is the verification width; 520px is a mock example.                                                                                                | No conflict                                                               |
| Legacy filled button in epic UX-DR8                                       | The epic expressly makes DESIGN authoritative; DESIGN requires bordered controls on both surfaces.                                                       | Stale inventory wording; use DESIGN                                       |
| Old inset queue tokens versus adopted full-width band                     | The dated delta-3 adoption explicitly replaces the old arrangement.                                                                                      | Stale frontmatter and Elevation wording; apply the adoption               |
| Mock removes the inline checklist and puts the strip below the transcript | SPEC CAP-3 and Story 1.4 explicitly require the inline checklist plus a strip at the top. The handoff declares the contracts authoritative.              | Use the SPEC; do not treat lower-priority mock geometry as a new decision |
| Existing execution chips filter; the new selector navigates               | Existing control behavior and an added capability can coexist as separate controls. The exact association should be made clear before visual acceptance. | Clarification, not a proven conflict                                      |
| Old steering paths and capability IDs                                     | The unified SPEC provides the current paths and the plus-seven mapping.                                                                                  | Use the unified source set                                                |
| Accepted Legacy contrast and row-size exceptions                          | The owner decisions are explicit. This audit does not reverse them.                                                                                      | Retain the exceptions; avoid claiming unqualified AA conformance          |

The pin and transport statements were treated as statements about the selected repository versions, not claims about the latest vendor releases.
No external vendor release check was needed to identify the failures above.

## Epic Quality Review

### Review result

The document has one owner-approved epic.
The epic title and goal describe a user outcome: operators can read and steer an agent node.
The single-epic structure has no cross-epic or circular dependency.
The read half produces useful behavior before the steering half starts.
All 15 v1 stories use Given/When/Then acceptance criteria and retain capability traceability.
The post-v1 records are explicit gates and do not create forward dependencies for v1.

This is a brownfield feature.
A starter-template story, initial environment setup, and CI setup are not applicable.
The stories add no new database table.
The read half forbids backend and schema changes, and the write half uses existing JSON metadata plus an in-process registry.

### Dependency review

| Story | Required earlier work                                    | Forward dependency result                                               |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1.1   | None                                                     | Pass; future operator and interrupted rows can be tested with fixtures. |
| 1.2   | 1.1 presenter and shell integration                      | Pass in sequence; the dependency is implicit.                           |
| 1.3   | 1.1 presenter and existing diff adapter                  | Pass in sequence; the dependency is implicit.                           |
| 1.4   | 1.1 shared history and both renderers                    | Pass in sequence; the dependency is implicit.                           |
| 1.5   | 1.1 shared presenter and both renderers                  | Pass in sequence; the dependency is implicit.                           |
| 1.6   | 1.1 shared history and both renderers                    | Pass in sequence; the dependency is implicit.                           |
| 1.7a  | None                                                     | No forward dependency, but it exists only to enable later stories.      |
| 1.7b  | 1.7a                                                     | Pass; backward dependency.                                              |
| 1.8   | 1.7a                                                     | Pass; backward dependency.                                              |
| 1.9   | 1.7b and 1.8                                             | Pass; backward dependencies.                                            |
| 1.10  | 1.1, 1.7b, 1.8, and 1.9                                  | Pass; backward dependencies.                                            |
| 1.11  | 1.1 and 1.7b; route delivery from 1.8 is already earlier | Pass in sequence; the 1.8 dependency is implicit.                       |
| 1.12a | 1.8 and 1.11                                             | Pass; backward dependencies.                                            |
| 1.12b | 1.7b, plus the earlier keepalive route and dock          | Pass in sequence; some earlier dependencies are implicit.               |
| 1.12c | 1.8 and 1.11                                             | Pass; backward dependencies.                                            |

No story requires a later numbered story to pass its own tests.
The explicit dependency declarations need small corrections, as recorded in F8.

### F1 — Critical and blocking: provider abort outcomes invalidate the proposed result discriminator

**Affected work:** Stories 1.7a, 1.7b, and 1.10; the engine turn loop; provider conformance tests.

**Claim A — normative end-cause rule:** Story 1.7b says “a turn that emitted a `result` is treated as a natural end regardless of the flag”.
The engine contract and steering AD-2 repeat that a provider-normalized `result` makes the interrupt spent.
Sources: [Story 1.7b](../../_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:309), [engine discriminator](../../_bmad-output/specs/spec-agent-node-room/engine-integration.md:33), and [steering AD-2](../../_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:107).

**Claim B — current runtime capability:** DeepSeek deliberately emits `{ type: 'result', stopReason: 'aborted', errorSubtype: 'deepseek_aborted' }` after an abort.
OMP instead throws `Query aborted` after its abort signal fires.
Sources: [DeepSeek abort result](../../packages/providers/src/community/deepseek/acp-client.ts:105), [DeepSeek abort branch](../../packages/providers/src/community/deepseek/acp-client.ts:368), [DeepSeek test](../../packages/providers/src/community/deepseek/acp-client.test.ts:499), [OMP abort throw](../../packages/providers/src/community/omp/provider.ts:450), and [OMP test](../../packages/providers/src/community/omp/provider.test.ts:550).

**Claim C — normative universal outcome:** Story 1.7a requires all five providers to end the turn without failing the node, and Story 1.7b requires an interrupted end to enter idle-await.
Sources: [Story 1.7a](../../_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:295) and [Story 1.7b idle entry](../../_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:317).

**Classification:** Claim B is a runtime capability, not a competing normative requirement.
The normative claims are not mutually exclusive by themselves.
The implementation plan is incomplete because the current provider contracts do not satisfy the discriminator.

**Reconciliation attempt:** one implementation can normalize both abort forms before it applies Claim A.
It can suppress or explicitly classify DeepSeek's abort result and catch OMP's abort throw when the per-turn operator signal fired.
That path can satisfy the natural-end race and the universal interrupt outcome together.
However, the documents do not select this rule, state how abort-specific terminal metadata is recognized, or protect a true provider failure from being mistaken for an operator interrupt.
Changing Claim A to distinguish a natural result from an abort result is the other viable design, but that also needs a contract amendment.

**Verification evidence:** the focused DeepSeek abort test passed with one test and zero failures.
The focused OMP abort test passed with one test and zero failures.
These tests prove the two different termination shapes; they do not prove the planned steering behavior.

**Why this blocks readiness:** the current rule classifies DeepSeek's steering abort as natural completion or error.
The current outer executor path classifies OMP's thrown abort as `dag_node_failed` unless new catch logic handles the operator signal.
Source: [executor failure path](../../packages/workflows/src/dag-executor.ts:3332).
An implementation that follows the documents literally cannot meet the universal v1 floor.

**Required resolution:** define one provider-neutral end-cause rule for a natural terminal result, an operator-aborted terminal result, an abort throw, a real provider failure, and node Cancel.
Amend SPEC C-15, `engine-integration.md`, steering AD-2, Stories 1.7a–1.7b, and `steering-test-plan.md`.
Add executor tests for the DeepSeek result shape and the OMP thrown shape, including the natural-end race.

### F5 — Major: the steering foundation is split into technical stories without independent user value

**Affected work:** Stories 1.7a, 1.7b, and 1.8.

Story 1.7a uses “As the engine” and says its purpose is “so that later stories have a handle to steer”.
It combines an in-process registry, per-turn abort mechanics, and conformance changes for five providers.
It does not produce an operator-usable outcome by itself.
Story 1.7b is another engine-only slice, and its projected state has no callable transport until Story 1.8.
Story 1.8 adds transport but uses “As the system” and still has no target-user flow.

This violates the story standard that each story provides clear user value and remains appropriately sized.
There is no forward dependency, but the split creates three partial technical milestones.

**Required resolution:** make the user-visible steering outcome the story boundary.
Keep the registry, provider adapters, turn loop, and routes as implementation tasks under that outcome, or define smaller vertical stories that each expose a complete callable behavior.
Keep the five provider conformance fixtures as acceptance tests, but do not make one foundation story own unrelated registry and all-provider work.

### F6 — Major: AI loop nodes have a live provider path that the steering plan does not cover

**Affected work:** Stories 1.7a–1.7b, the registry, state projection, and engine tests.

**Claim A — normative scope rule:** the steering architecture says steering exists where a node has a live agent session.
Source: [steering scope rule](../../_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:98).

**Claim B — current runtime structure:** a `loop` node “runs an AI prompt in a loop” and calls its provider through `executeLoopNode`, which is separate from `executeNodeInternal`.
Sources: [LoopNode definition](../../packages/workflows/src/schemas/dag-node.ts:370), [loop dispatch](../../packages/workflows/src/dag-executor.ts:8835), and [loop provider call](../../packages/workflows/src/dag-executor.ts:5718).

**Claim C — architecture implementation target:** the abort, result, re-ask, and Cancel placement rules cite the `executeNodeInternal` path at lines 2290, 2533, 3032, and 3124.
The story and steering test plan do not state what happens in `executeLoopNode`.
Sources: [SPEC C-15 and C-16](../../_bmad-output/specs/spec-agent-node-room/SPEC.md:132) and [engine test scope](../../_bmad-output/specs/spec-agent-node-room/steering-test-plan.md:13).

**Classification and reconciliation:** the runtime structure and the architecture target are not mutually exclusive.
One implementation can add the registry and the same end-cause rules to both provider execution paths.
The missing choice is whether loop nodes are steerable and, if they are, whether `Send now` continues the interrupted iteration before normal loop completion checks.

**Required resolution:** explicitly include or exclude AI `loop` nodes and provider-calling nodes inside `loop_group` bodies.
If included, specify registry keys, sub-state projection, session continuity, iteration semantics, and focused tests for both execution paths.
If excluded from v1, amend the “where there is a live agent session” rule and define the UI disclosure.

### F7 — Major: the less-than-two-percent fallback criterion has no reproducible verification

**Affected work:** Story 1.2 and the release test plan.

Story 1.2 requires the generic fallback to claim less than two percent of the production corpus.
The SPEC states that the corpus has 22,867 rows across 31 runs, and the presentation contract gives aggregate counts for selected aliases.
Sources: [Story 1.2](../../_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:187), [SPEC corpus assumption](../../_bmad-output/specs/spec-agent-node-room/SPEC.md:172), and [measured aliases](../../_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md:73).

The test plan checks selected resolver fixtures but provides no corpus fixture, query, replay command, expected generic numerator, or expected denominator.
Source: [resolver tests](../../_bmad-output/specs/spec-agent-node-room/test-plan.md:13).

The criterion is measurable in the source deployment, but an implementation agent cannot reproduce it from the confirmed artifacts or repository.
The story therefore has no complete pass/fail procedure.

**Required resolution:** provide a privacy-safe corpus manifest or a read-only replay command with a frozen expected numerator and denominator.
State whether this check is a CI fixture test or a release-time deployment audit.
Keep the table-driven unit cases as regression tests for named aliases.

### F8 — Minor: dependency declarations and compound criteria need cleanup

Stories 1.2 through 1.6 use the presenter, shared history, or renderer shell introduced in Story 1.1, but they do not declare that dependency.
Story 1.11 uses the earlier delivery route in the complete flow but lists only Stories 1.1 and 1.7b.
Story 1.12b uses the keepalive route and composer activity from Stories 1.8 through 1.10 but lists only Story 1.7b.

Stories 1.8 and 1.12b place several distinct error, race, timer, and resume behaviors in one Given/When/Then case.
The companion steering test plan separates most of them, so this is a documentation and scheduling problem rather than missing test intent.

**Required resolution:** list all earlier dependencies and split the compound criteria into one scenario per observable outcome.
Story 1.1's fixture hooks for later row types remain independently testable and are not a forward dependency.

### Epic quality checks that passed

- The epic is user-centered and provides a complete feature outcome.
- The user-approved one-epic decision is retained.
- There is no cross-epic dependency or circular dependency.
- There is no forward story dependency.
- Database changes are not created early; no new table is planned.
- All top-level capabilities retain story traceability.
- The read stories are generally small, user-centered, and independently verifiable after Story 1.1.
- The post-v1 gates are outside the v1 completion gate.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

The feature has complete top-level scope and 100 percent capability traceability.
Implementation must not start at the full v1 steering scope until the two blocking contracts are corrected.
The remaining major issues also need artifact updates so implementation does not invent behavior during coding.

### Assessment totals

| Severity             | Count | Findings              |
| -------------------- | ----: | --------------------- |
| Critical or blocking |     2 | F1, F2                |
| Major                |     5 | F3, F4, F5, F6, F7    |
| Minor                |     1 | F8                    |
| Total                |     8 | Four issue categories |

The four categories are engine and provider semantics, authorization and API contracts, UX and runtime alignment, and story and test quality.
No top-level functional requirement is missing.

### Critical Issues Requiring Immediate Action

1. **F1 — Provider abort normalization.**
   Define how a natural terminal result, an abort terminal result, an abort throw, a real provider failure, and node Cancel map to one end cause.
   Add DeepSeek and OMP executor fixtures before Story 1.7b is accepted.
2. **F2 — Steering authorization.**
   Define the permitted actors for starter, member, admin, unauthenticated, and identity-less runs.
   Apply the same matrix to send, interrupt, keepalive, and any queue-withdraw action.

### Recommended Next Steps

1. Amend SPEC C-15, `engine-integration.md`, steering AD-2, Stories 1.7a–1.7b, and the steering test plan with the provider-neutral end-cause rule.
2. Amend steering AD-11 and the API contract with the approved actor matrix and allowed and denied route tests.
3. Correct the interrupt response so it can report a spent natural-end race without claiming `idle-after-interrupt`.
4. Decide whether queued items can be withdrawn after submission, then add the required route and race contract or remove Delete from submitted items.
5. Include or explicitly exclude AI loop execution paths, with iteration and session-continuity tests.
6. Rework Stories 1.7a–1.8 into independently usable vertical outcomes, and correct the earlier-story dependency declarations.
7. Add a reproducible release check for the less-than-two-percent fallback criterion.
8. Re-run this readiness assessment after the source artifacts are amended.

### Final Note

This assessment found eight issues across four categories.
F1 and F2 block the v1 steering implementation because the current artifacts cannot produce one safe, conforming implementation.
F3, F4, F6, and F7 require contract detail before acceptance tests can be authoritative.
F5 and F8 require backlog restructuring and cleanup.

The readable transcript half is substantially ready as a separate sequence, except for F7's release measurement.
The full `spec-agent-node-room` target is not ready for Phase 4 implementation.

**Assessment date:** 2026-09-15  
**Assessor:** Codex

## Unresolved questions

- Which authenticated actors may steer a run that another user started?
- Does Delete withdraw a message that the server registry already accepted?
- Are AI `loop` nodes and provider-calling `loop_group` body nodes steerable in v1?
- Must an abort-specific provider `result` remain visible to other executor consumers, or can the provider adapter suppress it for an operator interrupt?
