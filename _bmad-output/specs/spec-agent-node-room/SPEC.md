---
id: SPEC-agent-node-room
companions:
  - tool-presentation-contract.md
  - todo-fold-contract.md
  - test-plan.md
  - engine-integration.md
  - provider-steering-matrix.md
  - control-states.md
  - steering-api-contract.md
  - steering-test-plan.md
  - ../../planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - ../../planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../../claude-design/design_handoff_node_room_transcript_steering/README.md
  - ../../../plans/260909-2130-live-interactive-agent-view/findings.md
  - ../../../plans/reports/aionscout-260912-aion-live-interaction.md
  - ../../../plans/reports/scoutcli-260912-midturn-cli-providers.md
  - ../../../plans/reports/scoutsdk-260912-midturn-sdk-providers.md
  - ../../project-context.md
sources:
  - sources/spec-readable-agent-transcript/SPEC.md
  - sources/spec-live-agent-steering/SPEC.md
---

> **Canonical contract.**
> This SPEC and the files in `companions:` are the complete contract for what to build, test, and validate.
> It unifies two previously separate specs — `spec-readable-agent-transcript` (the **read** half) and `spec-live-agent-steering` (the **write** half), both now `sources:` and fully absorbed here — into one contract for the agent node view.
> The two halves share one surface and two UX spines.
> Spec-authored companions carried in verbatim: `tool-presentation-contract.md`, `todo-fold-contract.md`, `test-plan.md` (read); `engine-integration.md`, `provider-steering-matrix.md`, `control-states.md` (write).
> Adopted companions own their content: `DESIGN.md` (how the node room looks) and `EXPERIENCE.md` (how it behaves), both `status: final`; the two `ARCHITECTURE-SPINE.md` files (the read Track-A spine and the steering spine, AD contracts this SPEC is built against); the `claude-design/design_handoff_node_room_transcript_steering/` mockup handoff; and the `plans/` evidence files that carry the `file:line` citations and measured numbers behind every constraint.
>
> **Reading pre-merge capability ids in adopted write artifacts.**
> The steering `ARCHITECTURE-SPINE.md` and `EXPERIENCE.md` were authored against the pre-merge `spec-live-agent-steering` numbering (its `CAP-1…CAP-6`) and are adopted read-only, so their bare `CAP-n` (and the steering spine's `binds:` / per-AD `Binds:` / capability map) still speak the old ids.
> Map them onto this SPEC by adding 7: **steering CAP-1→CAP-8, CAP-2→CAP-9, CAP-3→CAP-10, CAP-4→CAP-11, CAP-5→CAP-12, CAP-6→CAP-13**.
> Read-half references (`CAP-1…CAP-7`, and anything `EXPERIENCE.md` labels "Readable transcript") are unchanged by the merge.
> A `bmad-architecture` / `bmad-ux` Update can renumber those artifacts natively when clean ids are wanted; until then this mapping is authoritative.

# Agent Node Room

## Why

Opening an agent node in either node room (Legacy or Console) is two experiences that are both broken in opposite directions — one gives too little, the other gives nothing.

**Reading is a wall of JSON.**
Every tool call renders as two always-open blocks of pretty-printed JSON (`<details open>` on input _and_ output), and the one humanising step (`agent-history.ts:171` `toolContext()`) is keyed on `['cmd','path','file_path','query','url']`, missing `command` and `pattern`, so it contributes almost nothing.
Following what the agent did means reading serialized data instead of a transcript.

**Writing is impossible.**
The transcript is read-only.
An operator can watch the agent work on the wrong test suite for two minutes and do nothing but wait for it to finish being wrong.

This spec makes the node room **readable** and **steerable**.
The two halves differ in one deep way, and it matters for sequencing:

- The **read** half is a pure function of data already in the database — already stored, already served, already through one render-neutral layer both surfaces share.
  It needs **no schema change, no migration, no backend change**, so it **improves every historical run the moment it ships**, retroactively.
- The **write** half acts on the **live in-process session** of a running node: _send_ it a message, and _interrupt_ its current thinking to redirect it — **without stopping the node**.
  Stopping the whole node already exists (the **Cancel** feature); this never touches the node lifecycle.
  It has no durable state either, but it can only reach a node whose executor is in this process.

What blocks the write half is small and on our side: interrupting the agent already has a provider primitive (claude's `interrupt()`, or a stream-abort on any SDK) that ends the current _turn_ while the _session_ stays alive.
The one genuinely new engine behaviour is that a steered node runs **multiple provider turns on one live session** instead of ending after the first.
Everything else reuses seams that already exist.

## Capabilities

The **read** half is CAP-1…CAP-7; the **write** half is CAP-8…CAP-13.

The validated mockup manifest defines 70 current product items: nine changed features and 61 unchanged context items across the approved Console, Legacy, Transcript States, and Steering Dock States mockups.
The outer numbered review-state, node-kind, and provider-transport controls are mockup fixtures, not product controls.
The in-product `Execution` selector, lifecycle, navigation, artifact, and close controls remain product behavior.
Mockup context resolves apparent alternatives instead of deferring them: a full Legacy or Console room uses the full-bleed queue band, while the compact dock and state-review layout uses the inset queue well.

Every multi-occurrence separator uses `Run N` as its primary label in occurrence order.
Loop iteration, provider pass, retry, and interruption context can follow as a suffix.

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
    Every todo call in the transcript collapses to a one-line row; the current checklist lives only in the pinned todo strip, not inline in the transcript.
    A phase emptied by `rm` disappears rather than rendering an empty header.
    The **pinned todo strip** is after the transcript and immediately above the queue or dock, stays visible while transcript rows scroll, and is absent when the node has no todos.
    Its collapsed header shows the current item, completed count, and segmented meter.
    Its expanded state shows phases and items and exposes Raw.
    Terminal presentation marks remaining items done when the node completes and resets the current item to todo after the 30-minute interruption failure, without changing stored provider rows.

- **CAP-4** — See what a subagent dispatch asked for
  - **intent:** A reader can see the brief a task dispatch carried and which subtasks it spawned.
  - **success:** Both provider shapes normalize to `TaskSubtask[]`.
    The card renders batch context as markdown when the provider sends any, then one collapsible card per subtask naming the subtask and its agent.

- **CAP-5** — See what a file edit changed
  - **intent:** A reader can see the actual change a file edit made, inline, without leaving the transcript.
  - **success:** When the payload carries both before and after content, a line diff renders through `react-diff-view`.
    Claude always qualifies — `FileEditInput` declares `old_string` and `new_string` as required.
    Any persisted file tool row without both before/after string sides falls back to path plus preview, and a diff is never fabricated from one side.
    Scope is presentation over persisted rows only: current Codex `file_change` events are emitted as `system` chunks (`codex/provider.ts:709`) that the executor debug-logs as `dag.system_message_unhandled` (`dag-executor.ts:2691-2748`) instead of appending them to the node transcript, so they never become persisted file rows and are explicitly excluded here.
    Making successful Codex file changes visible in the transcript is separately tracked work.
  - **data contract:** `packages/web/src/lib/diff-hunks.ts` is the only `structuredPatch` caller, on `diff@9.0.0` — deterministic bounds (65,536-byte and 2,000-line side caps, `context: 4`, `maxEditLength: 2000`, no wall-clock timeout) and dual-bounded memoization (256 entries capped at 1,048,576 source code units).
    `tool-presentation.ts` qualifies a pair only after the family resolves to `file`, only as own-property strings (`''` valid; inherited keys, throwing accessors, one-sided, and wrong types never qualify), and caches the result per input record in a `WeakMap` so summary and body compute once.
    Collapsed rows carry `+n`/`−m` badges; expanded rows carry `N hunk(s)` or `no changes` plus `replace_all` when the input sends it as an own boolean.
    Line content is display-sanitised — ANSI/C0/C1 stripped, `Cf`/`U+2028`/`U+2029` escaped as `\u{HEX}`, 1,024-code-unit ceiling — while diffing runs on raw strings and Raw keeps the original payload.
    Refused, identical, and non-qualifying pairs degrade honestly; a failed edit still shows its attempted diff alongside the normalized failure output.

- **CAP-6** — Tell attempts and loop iterations apart
  - **intent:** A reader can tell which attempt or loop iteration produced a given tool call.
  - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none.
    Grouping keys on `occurrence_id`, never on `attempt_id`.
    Every group header uses primary `Run N` in occurrence order; loop iteration, provider pass, retry, and interruption context follows as a suffix when relevant.
    A **loop-iteration selector** lets the reader navigate directly between occurrence groups; the per-group headers remain its targets, and it is absent on a single-occurrence node.
    On a live loop node, selecting a **finished** iteration through the **`Execution` selection controls** (header select, Logs row, or graph occurrence; `Jump to` stays scroll-only) renders a read-only dock, a `Go to iteration N` control, and a read-only band that mirrors the node-scoped shared pending queue across operators and tabs.
    The composer and steering actions are absent in this view.
    Every steering mutation carries the selected `retry_epoch`, and the server fails closed when that epoch is stale, so a delayed or replayed mutation from a finished iteration cannot affect the live iteration.
    The authenticated node-scoped `GET …/queue` read is allowed so the band stays current.

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
    The words `this tab only` apply only to unsent composer draft content, including when that draft shares one combined surface with queued items.
    A queued message is node-scoped, shared across operators and tabs, and server-process-local; it survives a tab close and dies only on a server restart.

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
    Sending dispatches the newly typed message (the queued messages are already on the registry); the executor then flushes the registry — the already-queued messages followed by this one, **in receipt/written order** — as the **next turn on the same provider session** (reusing the `attemptResumeId` re-ask seam).
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
  - **success:** Sending to a running agent is an **ordinary prompt**, not a separate steer primitive.
    `Queue` remains available on every provider and delivers at the next natural boundary without an interrupt.
    Per-item `Send now` appears only while the agent generates on an Archon transport proven to accept live input.
    Selecting it sends exactly that queued item into the active turn without Stop, a natural-end wait, an interrupted tool call, or another turn.
    On provider transport acceptance, only that item leaves the shared queue and appears immediately as an operator transcript row with `sent` and no visible sender name.
    A queue-only mode omits the per-item action; a direct unsupported request returns a typed refusal without changing the queue.
    Claude streaming input, OMP RPC, and a new Grok live-input path must pass current release proof gates G2, G4, and G3 respectively.
    G3 requires Grok per-item Send now during the active agent turn in this release, including causal proof that the agent received the selected item.
    An advertised hook is a candidate mechanism, not proof of this behavior.
    Archon's current Grok `--single` path is queue-only.

- **CAP-13** — The interface claims only what it knows
  - **intent:** An operator can tell whether a message merely left the browser or actually reached the agent.
  - **success:** A queued receipt remains `queued`; only provider acceptance into the active turn changes the selected item to `sent` and creates its single transcript row.
    The row changes to `delivered` only when a matching native lifecycle event or a stream causally tied to that item proves agent consumption.
    An RPC acknowledgement, unrelated ongoing stream, text match, or timestamp does not prove consumption.
    The caller-stamped `message_id` stays the row and idempotency key; an echoed id is sufficient but is not the only valid proof.
    G1 is a current release proof and implementation gate, and an unconfirmed accepted row stays `sent`.

## Constraints

### Shared — both halves land in `packages/web`

- `@archon/web` must **not** import from `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`.
- **Console must not import from `@/components/`.**
  Shared logic lands in `packages/web/src/lib/` and the JSX is written twice, thin — duplicating a little JSX for a surface scheduled for deletion beats refactoring code on its way out.
- Both node rooms (Legacy + Console) ship **together**, on the owner's explicit and re-confirmed decision, even though Legacy is scheduled for deletion and Console is the default route.
- Strict TypeScript, no unjustified `any`, ESLint at zero warnings.
  `bun run validate` is the pre-PR gate.
- Code comments and test names carry **no** plan/section/finding references — comments explain the invariant.

### Read half

- Ships **no schema change, no migration, and no backend change.**
  Anything that would need new persisted data is out of scope by definition — that is the line that keeps it retroactive.
- **Serialized JSON is never a default presentation, and unclassifiable assistant text fails closed to its original bytes.**
  Tool payloads keep CAP-7's explicit Raw affordance — that toggle remains the only place tool input/output JSON appears.
  Assistant text is classified losslessly or left alone: when the matched definition node's `output_format` is an object schema declaring exactly one `type: 'string'` property and the stored text is the canonical serialization of that one-key envelope, the transcript renders the envelope's string value through the existing Markdown path; every other shape — absent or ineligible schema, malformed or non-canonical text — renders the original bytes unchanged.
  The shared `buildAgentHistory()` projector applies this rule with the schema forwarded by the three production surfaces — `LegacyNodeRoom` via `NodeTranscriptPane`, `ConsoleNodeRoom`, and `ConsoleInspectPane` via `ConsoleExecutionHistory`.
  Stored rows, API output, and the engine's structured result are never mutated.
- Status must be decodable **without colour** — a glyph character carries it, colour only reinforces.
- A chip shows the tool name only when that name is **a single token of at most 24 characters**; otherwise it shows the **family name**.
  The 24-character cap is the guard behind the rule, never an instruction to truncate with an ellipsis.
- Tool identification **duck-types over alias sets**; no name-keyed mapping table.
  Match **exact tokens, never substrings** (`search_replace` is an edit, not a search).
- **Provider shape differences are normalized at the edge, never branched on in a renderer.**
  A small normalizer in `lib/` converts each provider shape to one shared shape; `ToolPresentation` stays render-neutral and neither renderer learns a provider name.
- Path headlines elide in the **middle**; commands and patterns elide at the **end**.

### Write half

- **Current release scope.**
  G1 truthful delivery, G2 Claude soft-inject, G3 Grok live-turn delivery, and G4 OMP soft-inject are current release proof and implementation gates.
  The candidate Archon paths are not proven by an SDK feature or another product's adapter.
  Grok must support per-item Send now during an active turn in this release through a path proved in Archon.
  Its current `--single` adapter remains queue-only and omits the action until a separate path proves same-turn acceptance and causal agent receipt.
  The universal interrupt plus `Queue` path remains available on every provider.
- **Steering acts on the live agent, never on the node lifecycle.**
  _Send_ and _interrupt_ both operate on the running node's **live provider session**.
  The node stays `running` throughout — no pause, no `pending`, no resume, no `node_failed`.
  There is **no durable steering state**: no marker, no phase, no CAS, no attempt-key.
  Stopping the whole node is the existing **Cancel**/abort path, out of scope and untouched.
- **Interrupt is the provider's own primitive (or a stream-abort) on a per-turn signal, never the node-level one.**
  The executor's `nodeAbortController` (`dag-executor.ts:2209`) is **one-shot and Cancel's** (its `:3124` check fails the node; the re-ask loop stops on it, `:3032`).
  Steering interrupts through a **fresh per-turn signal** combined with the node-level one (`AbortSignal.any`), so each new turn gets a fresh signal — which is what lets the node run multiple turns and never trips `:3124`.
  `operatorInterrupt` is a **per-turn flag resolved by placement** in the existing flow (`stream → validation → canReask :3032 → :3124 Cancel check → completion`): `canReask` must also stop on it; validation is skipped on an interrupted turn; its branch sits immediately after the `:3124` Cancel check so Cancel dominates by position; it is reset at turn N+1.
  **End cause** is a five-case rule the executor resolves, not result-presence alone: a `result` with no abort marker is a natural end; a `result` carrying an abort marker (DeepSeek `stopReason:'aborted'`) or a thrown abort (OMP `Query aborted`) with `operatorInterrupt` set is an **interrupted end** into idle-await, never `node_failed`; a throw without the flag is a real failure; Cancel dominates by position.
  The executor classifies the abort-marked `result` and the abort throw — the provider adapter never suppresses them.
  This applies on both `executeNodeInternal` and `executeLoopNode` (AI loop nodes are steerable in v1).
  See `engine-integration.md`.
- **A steered node runs multiple provider turns on one live session — the one new engine behaviour.**
  It reuses the structured-output re-ask seam that re-invokes `sendQuery` with `attemptResumeId` on the same session (`dag-executor.ts:2290`).
  **Turn-end has two causes:** a **natural** end **auto-drains** (next turn on a queued message, else completes the node when the queue is empty); an **interrupted** end produces a **partial** result that must not be validated, completed, or advanced, and **always enters idle-await whatever the queue holds** — draining only on the operator's `Send now`.
- **In-process only; no durable steering state.**
  The **in-process registry** — keyed `(runId, nodeId)`, holding the node's live session handle plus an in-memory inbound queue, valid only while the node runs in this process — is the sole mechanism.
  Web dispatch runs the executor in the API server's process; a detached CLI run has no reachable handle, so steering is **unavailable** for it in v1 (Cancel and normal resume still work; the UI states this).
  A server restart drops the live session, timer, and any in-flight steer, leaving a durable non-terminal run.
  Archon does not autonomously fail or resume that ambiguous run from staleness; the operator must use explicit recovery.
- **Two queues, split on typing vs queued.**
  The pre-`Queue` **draft** is text still being composed and is per-tab browser state with no table or migration.
  The `this tab only` label qualifies only this unsent draft, even when draft and queued content share one combined surface.
  Pressing `Queue` dispatches the message to the send route with `intent: 'queue'`, and from that moment it rides the node-scoped shared in-memory registry queue on the live handle.
  The executor drains it at the natural turn boundary, `Send now` after an interrupt flushes the queue, and per-item `Send now` during generation attempts soft-inject.
  Delete of a queued message calls an idempotent withdraw route.
  A queued message survives a tab close and dies on a server restart.
  The crossover from client to server is `Queue`-press, not the drain moment.
- **An operator message is an ordinary `text` transcript row carrying three additive `metadata` fields:** `origin = 'operator'`, `operator_user_id` (the sender, for CAP-11 attribution on a multi-user install), and `message_id` (the caller-stamped id, so the client can reconcile which `sent` messages became rows).
  No new table, no widened `kind` enum — the `.strict()` metadata schema takes additive fields plus a regenerated `api.generated`, not a migration.
  The executor is the **sole** writer; the row is a receipt for the record, not the delivery vehicle.
  Only the row created by accepted per-item `Send now` during generation hides its visible sender name; stored attribution and other operator-row display paths remain.
- **Send and Interrupt are new routes; the queue absorbs races and epoch checks fail closed.**
  `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt` resolve identity through `resolveAuthContext` under the steering-specific actor grant.
  Any authenticated identity may steer and is attributed by `operator_user_id`; unauthenticated calls return 401; identity-less runs are allowed.
  Every mutation carries `retry_epoch`.
  A stale epoch returns a typed refusal and changes no node, queue, or transcript state.
  A Send arriving while an interrupt is in flight waits in the queue for the operator's `Send now`.
  A node no longer running returns 409, a detached run returns `not steerable here`, and a direct per-item request on a queue-only mode returns a typed capability refusal without removing the item.
  Queue-only UI omits that per-item action.
  On any terminal event, the client reconciles queued receipts against operator-row ids only after the executor's terminal write; an item proven unaccepted may return as `Never sent`.
  An accepted id with a failed transcript write is a recording failure, never a sendable `Never sent` draft.
  With two docks on one node, global order is the registry receipt order and each row keeps its `operator_user_id`.
- **The dock does not appear on a finished node.**
  Settled by the owner.
  The field and both controls are absent — a control that cannot act must not be drawn.
  Re-running a finished node is `workflow retry-node`, its own capability with its own confirmation, not this dock.
  An undelivered draft box stays rendered **read-only**, stating the node finished and the messages never left.
- **Interrupt is not undo.**
  Session state is saved up to the last completed tool call, but files already written stay written — nothing is rolled back.
  The control must not imply otherwise.
- **A steer delivery must not emit a turn-start event** — a stray one opens a phantom turn boundary and corrupts the record the transcript is built from.
- **Delivery requires causal consumption proof, never matching text or timestamps.**
  A matching native lifecycle event or stream causally tied to the selected message can prove consumption.
  An RPC acknowledgement proves only transport acceptance, and unrelated ongoing stream output proves neither selected-message consumption nor `delivered`.
- **Selected-item live input is separate from dock Send now.**
  A server-owned queued `message_id` and selected `retry_epoch` identify the item; the caller cannot replace its stored text or `operator_user_id`.
  The registry claims that one item against the active turn token and asks a provider-owned live-input port for acceptance.
  Acceptance removes only that item and writes one idempotent `sent` operator row immediately; consumption changes only that row to `delivered`.
  A rejected attempt releases the claim without moving the item; a turn-end or Stop race never silently falls back to a new turn.
  An uncertain timeout must not trigger blind reinjection, and a transcript-write failure after acceptance must not return the item to a sendable queue.
  Repeated receipts, concurrent operators, and reconnects preserve one send and one row per stamped id.
  Dock `Send now` after Stop remains the separate next-turn flush of queued items plus the new draft.
- **Steering is universal over a queue-and-flush floor; mid-turn is the acceleration.**
  Every provider delivers an operator message — at worst as the next prompt at turn-end.
  A provider earns _soft-inject_ only from a transport exercised against it, never one merely advertised.
  Providers differ on two honest axes: **boundary granularity** (mid-turn vs turn-end) and **delivery confirmation** (CAP-13).
- **Approved queue layouts are context-specific.**
  The full Legacy and Console rooms use the full-bleed queue band.
  The compact dock and state-review layout uses the inset queue well.
  These are two layouts for two contexts, not alternatives for one context.
- **Approved room controls are product behavior.**
  The in-product `Execution` selector, Cancel, Re-run, Log or Logs, Graph, counted Artifacts, and node-room close control act as shown in the approved mockups.
  Outer numbered review-state, node-kind, and provider-transport controls are fixture scaffolding.
- **The 30-minute idle-await fail is an inactivity timer (owner-ratified, SC 2.2.1).**
  While the agent is `idle-after-interrupt` and nothing is sent, a **fresh 30-minute timer** (an explicit fail branch — not the existing idle-timeout, which _completes_ the node) fails the node (`interrupted by operator, no redirect received`).
  Idle-await runs its own timer-driven status poll so `/workflow cancel` still reaches it, and **resolves exactly once** (`Send now`, cancel-poll, or timer).
  The timer is an **inactivity** timer: a debounced, authorized composing keepalive **re-arms** it without resolving idle-await, so the node fails only after 30 minutes of genuine operator inactivity — the limit is disclosed in the dock and adjustable by activity; the 30-minute value is unchanged.
  Resuming a 30-minute-failed node re-runs it with a **fresh session** — the interrupted context is gone.

## Cross-half dependency

CAP-11 (the operator row) writes into the read half.
`AgentHistoryItem` has kinds `assistant | tool | lifecycle`, and an operator row is none of them; the read half's architecture puts every row's meaning in the shared core (`packages/web/src/lib`).
So CAP-11 adds a **new item kind** and its two-shell treatment, and the CAP-1/CAP-2 transcript renderer must recognize it — an operator `text` row must not reach a live transcript until the reader recognizes `origin='operator'`, else it renders as agent text.
Because the two halves are now one spec, this is an **internal** ordering dependency, not a cross-spec one: build the reader's recognition of `origin='operator'` before CAP-11 ships.

**Second cross-half reader dependency — the interrupted status row.**
CAP-9 makes `⚠ interrupted` universal: the executor writes a separate `interrupted` status row on **every** provider at delivery, not only through Claude's `PostToolUseFailure` hook.
For that glyph to reach the row, the read half's `deriveOutcome` (`agent-history.ts:120`) must fold that status row into the **preceding** tool call's outcome — else `⚠` is unreachable on non-Claude providers even after the write lands.
Like the operator row, this is an internal ordering dependency: the reader's fold ships before the write half emits cross-provider interrupted rows.

## Non-goals

- **Cancelling the whole node.**
  The existing Cancel/abort feature is untouched.
  This feature only interrupts the agent's generation and keeps the node running.
- **Cancelling one individual tool call.**
  No provider offers it below turn level.
  Interrupt is turn-level; Cancel is node/session-level.
- **Surviving a server restart mid-steer, and steering a detached run.**
  Both are deferred in v1 because steering is in-process only.
- **Persisting the draft queue**, and **auto-send queue mode** — every send stays operator-initiated.
- **RunStream `ToolCallItem.tsx`, Chat `ToolCallCard.tsx`, and the backend `tool-formatter.ts`.**
  The read half touches only the two node rooms; the others are a different data path or a deliberate design.
- **A run-level "Files changed" panel**, and node-level git attribution generally — the git routes are run-scoped.
  Per-tool-call diffs (CAP-5) are the only node-level attribution available.
- **`qodercli`, `pi`, `copilot`, `opencode` steering.**
  These providers are not in use today.
- **Agent thinking, the triggering prompt, and advisor notifications** (the rest of "Track B") — they need persistence that does not exist and are out of scope; mid-turn steering, which used to sit in that bucket, is now the write half above.

## Success signal

An operator opens a node from a run **already in the database** — no re-run, no migration — and reads what the agent did as a scannable list rather than a JSON dump: the one failing `bash` call in a forty-call node is visible with its command and its exit code without a single click, and no JSON appears anywhere unless the reader asks for it.

Then, on a **live** node, the operator watches it run the wrong test suite, types a correction, **interrupts the agent's thinking**, and sends it — and the agent **continues on the same session** against the right one, **without the node ever stopping**, without abandoning the run, and without losing the record.
Reading that transcript a week later shows the wrong command, the operator's correction, and the right command, in that order.

## Assumptions

- Both node rooms ship together (owner-confirmed, re-confirmed).
  The render fork means a second JSX pass and a second renderer test suite for a surface with a finite life; shared logic in `lib/` is written once.
- Alias sets absorb provider **naming** drift, so no name-keyed mapping table is needed.
  They do **not** absorb semantic drift (the same key can carry a different meaning per provider, and two tools can share a name with incompatible structures) — those are handled by the normalizers.
- The production corpus is representative: **22,867 tool rows across 31 runs and 2,369 distinct tool names**, measured read-only against the deployment's own database.

## Open questions

> **Current-scope mapping (2026-09-24):** the approved mockups bring `delivered` (**G1**) and per-item active-turn delivery through proven provider paths into the current release.
> The user's explicit G3 decision also requires Grok per-item Send now in the active turn in this release, alongside Claude G2 and OMP G4 proof gates.
> Grok's present `--single` mode is queue-only.

- **Settled — interrupt-then-abandon fails the node after 30 minutes** (owner-ratified; see the write-half constraint).
  The timer is an inactivity timer re-armed by a composing keepalive (SC 2.2.1); resume re-runs with a fresh session.
- **Deferred — mid-turn (soft-inject) delivery to a detached run.**
  All of steering binds to the in-process live handle.
  Revisit when a provider offers a channel into a session it did not spawn — grok's leader socket is the only lead found.
- **Current prerequisite — Claude soft-inject.**
  Exercise Claude `AsyncIterable` streaming input with the resume protocol and ship the confirmed path as G2.
- **Current prerequisite — Grok live-turn delivery (G3).**
  Prove a reachable Archon Grok path sends exactly the selected queued item into the same active turn and provides causal evidence that the agent received it.
  The advertised hooks and their exact text-field shape are unexercised, so they establish no shipping capability.
  If hooks cannot pass the same-turn and receipt gate, another Grok path must pass it or the release stays blocked.
  Keep current `--single` queue-only and hide its per-item action.
- **Current prerequisite — delivery confirmation.**
  Prove a matching native lifecycle event or a response stream causally linked to the selected message before changing its row to `delivered`.
  An SDK update may be necessary for a given transport, but its version alone is not proof.
  An accepted message without causal consumption evidence remains `sent`.
- **Resolved during the read-half specification** (from the pinned SDK's `sdk-tools.d.ts`): the Agent SDK schemas match the harness schemas; `glob` earns its own family (Claude's required `pattern` + optional `path`-as-directory vs OMP's `path`-is-pattern); the grep body arm comes from `output_mode`, not the family; Claude's `TodoWrite` (whole-list replacement) and `Agent` (single dispatch) normalize at the edge.
