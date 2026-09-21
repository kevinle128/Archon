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

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test, and validate. It unifies two previously separate specs — `spec-readable-agent-transcript` (the **read** half) and `spec-live-agent-steering` (the **write** half), both now `sources:` and fully absorbed here — into one contract for the agent node view. The two halves share one surface and two UX spines. Spec-authored companions carried in verbatim: `tool-presentation-contract.md`, `todo-fold-contract.md`, `test-plan.md` (read); `engine-integration.md`, `provider-steering-matrix.md`, `control-states.md` (write). Adopted companions own their content: `DESIGN.md` (how the node room looks) and `EXPERIENCE.md` (how it behaves), both `status: final`; the two `ARCHITECTURE-SPINE.md` files (the read Track-A spine and the steering spine, AD contracts this SPEC is built against); the `claude-design/design_handoff_node_room_transcript_steering/` mockup handoff; and the `plans/` evidence files that carry the `file:line` citations and measured numbers behind every constraint.
>
> **Reading pre-merge capability ids in adopted write artifacts.** The steering `ARCHITECTURE-SPINE.md` and `EXPERIENCE.md` were authored against the pre-merge `spec-live-agent-steering` numbering (its `CAP-1…CAP-6`) and are adopted read-only, so their bare `CAP-n` (and the steering spine's `binds:` / per-AD `Binds:` / capability map) still speak the old ids. Map them onto this SPEC by adding 7: **steering CAP-1→CAP-8, CAP-2→CAP-9, CAP-3→CAP-10, CAP-4→CAP-11, CAP-5→CAP-12, CAP-6→CAP-13**. Read-half references (`CAP-1…CAP-7`, and anything `EXPERIENCE.md` labels "Readable transcript") are unchanged by the merge. A `bmad-architecture` / `bmad-ux` Update can renumber those artifacts natively when clean ids are wanted; until then this mapping is authoritative.

# Agent Node Room

## Why

Opening an agent node in either node room (Legacy or Console) is two experiences that are both broken in opposite directions — one gives too little, the other gives nothing.

**Reading is a wall of JSON.** Every tool call renders as two always-open blocks of pretty-printed JSON (`<details open>` on input _and_ output), and the one humanising step (`agent-history.ts:171` `toolContext()`) is keyed on `['cmd','path','file_path','query','url']`, missing `command` and `pattern`, so it contributes almost nothing. Following what the agent did means reading serialized data instead of a transcript.

**Writing is impossible.** The transcript is read-only. An operator can watch the agent work on the wrong test suite for two minutes and do nothing but wait for it to finish being wrong.

This spec makes the node room **readable** and **steerable** across every approved presentation surface.

- Existing persisted rows gain the readable presentation retroactively.
- New transcript sources, including successful Codex file changes, thinking, triggering prompts, and advisor notifications, require explicit persistence and backend contracts.
- Steering acts on the live turn of a running agent without stopping the node.
- Drafts, queued guidance, delivery state, and auto-send settings are stored on the server and survive a server restart.
- A restart restores durable steering data and waits for the user to invoke the existing Resume feature.

What blocks the write half is small and on our side: interrupting the agent already has a provider primitive (claude's `interrupt()`, or a stream-abort on any SDK) that ends the current _turn_ while the _session_ stays alive. The one genuinely new engine behaviour is that a steered node runs **multiple provider turns on one live session** instead of ending after the first. Everything else reuses seams that already exist.

## Capabilities

CAP-1 through CAP-13 define the core readable-transcript and live-steering behavior.

CAP-14 through CAP-21 define the approved current-scope expansion.

### Read — a scannable transcript

- **CAP-1** — Scan a node's work without expanding anything
  - **intent:** A reader can scan a node's tool calls one line each and tell what ran, what it ran on, and whether it worked.
  - **success:** A node with forty tool calls renders forty single-line rows, each carrying a family chip, a status glyph, a headline naming the salient argument, and right-aligned badges. Successful calls are collapsed on first render and failed calls are expanded. No collapsed row contains serialized-data punctuation.

- **CAP-2** — Expand a call into a body shaped for that kind of tool
  - **intent:** A reader can open any tool call and see its input and output rendered for the kind of tool it is.
  - **success:** Every family renders its declared body arm per `tool-presentation-contract.md`. A tool matching no family renders at most three scalar `key: value` pairs, with objects and arrays collapsed to `{…}` / `[n]`, and never a JSON dump. Measured against the production corpus, the generic fallback claims under 2% of rows.

- **CAP-3** — Follow the agent's checklist as state, not as mutations
  - **intent:** A reader can see the agent's current todo list, with phases and per-item status, instead of a sequence of opaque updates.
  - **success:** Both provider shapes normalize to the same `TodoPhase[]` per `todo-fold-contract.md`. Earlier todo mutations remain one-line `todo updated` rows, while the latest applicable todo row can expose the approved inline checklist. A phase emptied by `rm` disappears rather than rendering an empty header. A collapsible todo strip sits outside and below the transcript scroller, immediately above the queue and composer dock, so current progress remains visible while the transcript scrolls. The terminal view may derive the approved completed or interrupted presentation without changing persisted todo events. The strip is absent when the node has no todos.

- **CAP-4** — See what a subagent dispatch asked for
  - **intent:** A reader can see the brief a task dispatch carried and which subtasks it spawned.
  - **success:** Both provider shapes normalize to `TaskSubtask[]`. The card renders batch context as markdown when the provider sends any, then one collapsible card per subtask naming the subtask and its agent.

- **CAP-5** — See what a file edit changed
  - **intent:** A reader can see the actual change a file edit made, inline, without leaving the transcript.
  - **success:** When the payload carries both before and after content, a line diff renders through `react-diff-view`. Claude always qualifies — `FileEditInput` declares `old_string` and `new_string` as required. Any persisted file tool row without both before/after string sides falls back to path plus preview, and a diff is never fabricated from one side. Successful Codex `file_change` events are normalized and persisted as transcript file rows before presentation, then use the same readable body and Raw behavior as every other file row.
  - **data contract:** `packages/web/src/lib/diff-hunks.ts` is the only `structuredPatch` caller, on `diff@9.0.0` — deterministic bounds (65,536-byte and 2,000-line side caps, `context: 4`, `maxEditLength: 2000`, no wall-clock timeout) and dual-bounded memoization (256 entries capped at 1,048,576 source code units). `tool-presentation.ts` qualifies a pair only after the family resolves to `file`, only as own-property strings (`''` valid; inherited keys, throwing accessors, one-sided, and wrong types never qualify), and caches the result per input record in a `WeakMap` so summary and body compute once. Collapsed rows carry `+n`/`−m` badges; expanded rows carry `N hunk(s)` or `no changes` plus `replace_all` when the input sends it as an own boolean. Line content is display-sanitised — ANSI/C0/C1 stripped, `Cf`/`U+2028`/`U+2029` escaped as `\u{HEX}`, 1,024-code-unit ceiling — while diffing runs on raw strings and Raw keeps the original payload. Refused, identical, and non-qualifying pairs degrade honestly; a failed edit still shows its attempted diff alongside the normalized failure output.

- **CAP-6** — Tell attempts and loop iterations apart
  - **intent:** A reader can tell which attempt or loop iteration produced a given tool call.
  - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none. Grouping keys on `occurrence_id`, never on `attempt_id`. A **loop-iteration selector** lets the reader navigate directly between occurrence groups — the per-group headers remain the anchors it targets — and is absent on a single-occurrence node. On a live loop node, selecting a **finished** iteration through the **`Execution` selection controls** (header select, Logs row, or graph occurrence — Story 1.7 `Jump to` stays scroll-only) renders a read-only dock — a collapsed disclosure, a `Go to iteration N` control, and a read-only band mirroring the node's shared still-pending queue across operators/tabs (which delivers on return to the live iteration); the composer is absent and no send, withdraw, or interrupt **mutation** is issued for a finished iteration (steering mutations target only the live iteration; the Send route stays node-scoped and iteration-agnostic). The existing authenticated node-scoped `GET …/queue` read **is** allowed so the band can stay current.

- **CAP-7** — Keep the raw payload reachable
  - **intent:** A developer debugging a provider can still read the exact bytes the provider sent.
  - **success:** Every card exposes a Raw toggle revealing the original JSON, closed by default. This is the **only** place serialized JSON appears. Today's `canLoadFullOutput` / `onLoadFullOutput` flow keeps working.

### Write — steer the live agent

- **CAP-8** — Compose while the agent works
  - **intent:** An operator watching a running node can write a message without disturbing it.
  - **success:** The composer is mounted and enabled while the node runs, and the send control reads `Queue`. Sending holds the message; the node is untouched, no tool call is interrupted and nothing is lost. The message is delivered as the next turn when the current turn ends naturally. The unsent composer draft is stored on the server for its author. A queued message is stored on the server for the node, is visible to every authorized viewer of that node, and survives tab closure and server restart.

- **CAP-9** — Interrupt the agent's thinking; the node keeps running
  - **intent:** An operator can stop the agent's _current generation_ to redirect it, without stopping the node or abandoning the run.
  - **success:** The `Stop` control in the node's composer dock ends the agent's **current turn** through `AgentRequestOptions.interruptSignal`, mapped by each provider to its native interrupt or safe stream-abort. The provider session stays reusable. The node and workflow run remain active, and the transcript shows the active tool as _interrupted_ rather than _failed_. Stop applies to the whole turn, not one selected tool. Nothing suggests that Stop undid work already written.

- **CAP-10** — Redirect and continue on the same live session
  - **intent:** After interrupting, the operator sends what to do instead and the agent carries on from there — on the same session, in the same node.
  - **success:** Once the agent is `idle-after-interrupt`, the send control reads `Send now`. Sending commits the newly typed message and claims eligible durable queue entries in server FIFO order as the next turn on the same provider session. The node continues without entering a workflow pause state. Ordering is enforced by Archon and is never assumed of the provider. Both controls follow the agent's projected sub-state, not a remembered mode.

- **CAP-11** — The exchange is part of the record
  - **intent:** Anyone reading the transcript afterwards can see what the operator said, and when, relative to what the agent did.
  - **success:** The operator's messages and the interrupted tool call appear as ordinary transcript rows in the order they happened — between the call they interrupted and the one they caused. An operator row is visibly the operator's, never mistakable for the agent's own text. _This is where the write half writes into the read half — see Cross-half dependency._

- **CAP-12** — Mid-turn delivery, as fast as each provider's transport allows
  - **intent:** The operator's message reaches a running agent without interrupting it, and sooner on a provider whose transport can take it mid-turn.
  - **success:** Sending to a running agent is an ordinary prompt. `Queue` delivers at the next natural turn boundary on every provider. Where a verified provider transport accepts a message mid-turn, each queued item exposes `Send now` and the selected prompt arrives without interrupting the active turn, changing the active tool outcome, or emitting a steering-owned turn-start event. A queue-only provider omits the per-item action. Verification of Claude, Grok, and OMP soft injection is current implementation work.

- **CAP-13** — The interface claims only what it knows
  - **intent:** An operator can tell whether a message merely left the browser or actually reached the agent.
  - **success:** A message reads `sent` until the provider supplies verified acknowledgement for the caller-stamped id, at which point it reads `delivered`. Correlation is by id alone. The Claude implementation includes the required SDK update and message-id echo work in current scope. Providers without verified acknowledgement remain honestly at `sent` or `delivery unknown` and never infer delivery from text or timestamps.

### Current-scope expansion

- **CAP-14 — Continue after a server restart without losing guidance**
  - **intent:** An operator can recover all saved steering work after the server process restarts.
  - **success:** The server restores the author's draft, the node queue, FIFO order, delivery state, and auto-send setting. It does not claim that the old SDK process survived, assign a terminal state, or resume automatically. The operator continues through the existing Resume feature.

- **CAP-15 — Auto-send queued guidance one item per natural reply**
  - **intent:** An operator can let a sequence of queued instructions advance without pressing send after each natural reply.
  - **success:** Auto-send is durable, processes one queued item at a time in server FIFO order after a natural agent reply, and leaves the queue intact when disabled. An interrupted turn never auto-sends and waits for `Send now`. A delivery failure returns the item to the queue with an accessible error.

- **CAP-16 — Use the readable tool contract across every selected surface**
  - **intent:** A tool call has the same meaning in Node Room, RunStream, Chat, and backend-generated cards.
  - **success:** Every surface uses the same family, headline, outcome, badge, body, fallback, and Raw semantics while respecting package boundaries and its own markup shell.

- **CAP-17 — Show run and node source-control impact**
  - **intent:** An operator can see which files the run changed and which node execution produced each attributable change.
  - **success:** The run exposes a Files Changed panel and node executions expose Git attribution derived from repository evidence. Unknown attribution is labeled unknown and is never inferred from natural-language output.

- **CAP-18 — Steer every registered provider in the approved set**
  - **intent:** Stop, redirect, queue, and continuation behave consistently across Claude, Codex, Grok, DeepSeek, OMP, Qoder CLI, Pi, GitHub Copilot, and OpenCode.
  - **success:** Every adapter honors `interruptSignal`, preserves its reusable provider session where supported, reports truthful capability data, and passes the shared provider conformance contract.

- **CAP-19 — Present agent thinking safely**
  - **intent:** An authorized reader can inspect provider thinking without leaking it into logs or confusing it with assistant output.
  - **success:** Thinking has explicit provider normalization, persistence, privacy, truncation, ordering, presentation, and Raw behavior.

- **CAP-20 — Present the triggering prompt with provenance**
  - **intent:** A reader can see which prompt caused the selected node occurrence to run.
  - **success:** The prompt is persisted with its node, occurrence, source, and actor attribution, and follows the approved sensitive-data and visibility rules.

- **CAP-21 — Present advisor notifications in transcript order**
  - **intent:** A reader can see advisor messages in the context in which the agent received them.
  - **success:** Advisor notifications have a persisted type, deterministic sequence, readable presentation, and accessibility treatment relative to tool, assistant, and operator rows.

## Constraints

### Shared presentation rules

- `@archon/web` must **not** import from `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`.
- **Console must not import from `@/components/`.** Shared logic lands in `packages/web/src/lib/` and the JSX is written twice, thin — duplicating a little JSX for a surface scheduled for deletion beats refactoring code on its way out.
- Both node rooms (Legacy + Console) ship **together**, on the owner's explicit and re-confirmed decision, even though Legacy is scheduled for deletion and Console is the default route.
- Strict TypeScript, no unjustified `any`, ESLint at zero warnings. `bun run validate` is the pre-PR gate.
- Code comments and test names carry **no** plan/section/finding references — comments explain the invariant.

### Read and presentation paths

- Existing persisted rows remain retroactively readable. New transcript sources and steering state use additive schemas and typed backend paths where the source data does not already exist.
- **Serialized JSON is never a default presentation, and unclassifiable assistant text fails closed to its original bytes.** Tool payloads keep CAP-7's explicit Raw affordance — that toggle remains the only place tool input/output JSON appears. Assistant text is classified losslessly or left alone: when the matched definition node's `output_format` is an object schema declaring exactly one `type: 'string'` property and the stored text is the canonical serialization of that one-key envelope, the transcript renders the envelope's string value through the existing Markdown path; every other shape — absent or ineligible schema, malformed or non-canonical text — renders the original bytes unchanged. The shared `buildAgentHistory()` projector applies this rule with the schema forwarded by the three production surfaces — `LegacyNodeRoom` via `NodeTranscriptPane`, `ConsoleNodeRoom`, and `ConsoleInspectPane` via `ConsoleExecutionHistory`. Stored rows, API output, and the engine's structured result are never mutated.
- Status must be decodable **without colour** — a glyph character carries it, colour only reinforces.
- A chip shows the tool name only when that name is **a single token of at most 24 characters**; otherwise it shows the **family name**. The 24-character cap is the guard behind the rule, never an instruction to truncate with an ellipsis.
- Tool identification **duck-types over alias sets**; no name-keyed mapping table. Match **exact tokens, never substrings** (`search_replace` is an edit, not a search).
- **Provider shape differences are normalized at the edge, never branched on in a renderer.** A small normalizer in `lib/` converts each provider shape to one shared shape; `ToolPresentation` stays render-neutral and neither renderer learns a provider name.
- Path headlines elide in the **middle**; commands and patterns elide at the **end**.

### Steering and durable guidance

- **All approved steering behavior is current scope.** Queue, Stop, provider continuation, durable recovery, auto-send, verified soft injection, and truthful delivery acknowledgement are owned by current numbered stories. SDK upgrades and provider conformance work are implementation tasks, not scope gates.
- **Steering acts on the live agent, never on the node lifecycle.** Send and Stop operate on the running node's live provider session. The node stays `running` throughout — no pause, no `pending`, no lifecycle resume, and no `node_failed`. Durable steering records coordinate draft, queue, delivery, and recovery behavior but never become a lifecycle marker or replace the provider session.
- **Stop uses a fresh per-turn signal and never the node-level signal.** Each provider call receives `AgentRequestOptions.interruptSignal` for the current turn. The executor combines it with the unchanged node-level `abortSignal` only at provider invocation and creates a new turn controller for each follow-up turn. A provider abort marker such as DeepSeek's aborted result or OMP's abort throw is preserved for executor classification. With an accepted Stop request it becomes an interrupted end, skips partial-result validation, and enters idle-after-interrupt. Without an accepted Stop request, the same provider error follows the normal failure path. This contract applies to ordinary AI nodes and AI loop nodes. See `engine-integration.md`.
- **A steered node runs multiple provider turns on one live session — the one new engine behaviour.** It reuses the structured-output re-ask seam that re-invokes `sendQuery` with `attemptResumeId` on the same session (`dag-executor.ts:2290`). **Turn-end has two causes:** a **natural** end **auto-drains** (next turn on a queued message, else completes the node when the queue is empty); an **interrupted** end produces a **partial** result that must not be validated, completed, or advanced, and **always enters idle-await whatever the queue holds** — draining only on the operator's `Send now`.
- **The durable store and live handle have different jobs.** A narrow steering store owns drafts, queued messages, server FIFO order, delivery state, and auto-send settings. The in-memory registry owns only the active provider turn handle and its fresh per-turn interrupt controller. A live SDK handle is never serialized or treated as durable.
- **Draft and queue persistence are server-side.** Drafts are stored for their author. Queued guidance is stored for the node. Queue acknowledgement follows database commit, withdrawal is idempotent, and the executor claims durable items in server FIFO order. The delivered operator transcript row remains the audit receipt and is not the queue itself.
- **Restart recovery uses the existing Resume feature.** Server startup restores durable steering data but does not guess whether the prior provider turn completed. It does not resume automatically or assign an unsupported terminal state. A dispatch whose provider outcome is unknown is not resent automatically.
- **An operator message is an ordinary `text` transcript row carrying three additive `metadata` fields:** `origin = 'operator'`, `operator_user_id` (the sender, for CAP-11 attribution on a multi-user install), and `message_id` (the caller-stamped id, so the client can reconcile which `sent` messages became rows). No new table, no widened `kind` enum — the `.strict()` metadata schema takes additive fields plus a regenerated `api.generated`, not a migration. The executor is the **sole** writer; the row is a receipt for the record, not the delivery vehicle.
- **Typed steering routes persist before they acknowledge.** Send, draft, queue-read, withdraw, auto-send, and interrupt routes resolve identity through `resolveAuthContext` and attribute every mutation. Send during an interrupt waits durably for `Send now`. A finished node returns `409 node_finished`. A node that requires post-restart recovery reports that state without inferring how its process was started. Terminal reconciliation is derived from durable queue and transcript receipts, not a browser-only observation ledger.
- **The dock does not appear on a finished node.** Settled by the owner. The field and both controls are absent — a control that cannot act must not be drawn. Re-running a finished node is `workflow retry-node`, its own capability with its own confirmation, not this dock. An undelivered draft box stays rendered **read-only**, stating the node finished and the messages never left.
- **Interrupt is not undo.** Session state is saved up to the last completed tool call, but files already written stay written — nothing is rolled back. The control must not imply otherwise.
- **A steer delivery must not emit a turn-start event** — a stray one opens a phantom turn boundary and corrupts the record the transcript is built from.
- **Delivery is confirmed by id, never by matching text or timestamps.**
- **Steering is universal over a queue-and-flush floor; verified mid-turn delivery is an additional current path.** Every provider delivers an operator message at least as the next prompt at turn-end. A provider earns soft injection or delivery acknowledgement only through exercised adapter conformance. Providers differ on boundary granularity and delivery evidence, and the UI reports those differences truthfully.
- **The 30-minute idle-await rule applies only while the live server process still owns the turn state.** Composer activity re-arms the inactivity timer, and `Send now` resolves idle-await. A server restart does not apply this timer to the lost process. It restores durable steering data, reports recovery required, and waits for the existing Resume action.

## Cross-half dependency

CAP-11 (the operator row) writes into the read half. `AgentHistoryItem` has kinds `assistant | tool | lifecycle`, and an operator row is none of them; the read half's architecture puts every row's meaning in the shared core (`packages/web/src/lib`). So CAP-11 adds a **new item kind** and its two-shell treatment, and the CAP-1/CAP-2 transcript renderer must recognize it — an operator `text` row must not reach a live transcript until the reader recognizes `origin='operator'`, else it renders as agent text. Because the two halves are now one spec, this is an **internal** ordering dependency, not a cross-spec one: build the reader's recognition of `origin='operator'` before CAP-11 ships.

**Second cross-half reader dependency — the interrupted status row.** CAP-9 makes `⚠ interrupted` universal: the executor writes a separate `interrupted` status row on **every** provider at delivery, not only through Claude's `PostToolUseFailure` hook. For that glyph to reach the row, the read half's `deriveOutcome` (`agent-history.ts:120`) must fold that status row into the **preceding** tool call's outcome — else `⚠` is unreachable on non-Claude providers even after the write lands. Like the operator row, this is an internal ordering dependency: the reader's fold ships before the write half emits cross-provider interrupted rows.

## Non-goals

- **Changing the existing Cancel feature.** Historical workflow cancellation remains untouched.
- **Cancelling one individual tool call.** Stop always ends the current agent turn.
- **Changing CLI `--detach` or adding detached-specific Agent Node Room behavior.** The CLI capability remains unchanged and is not used by this feature.

## Success signal

An operator opens a node from a run **already in the database** — no re-run, no migration — and reads what the agent did as a scannable list rather than a JSON dump: the one failing `bash` call in a forty-call node is visible with its command and its exit code without a single click, and no JSON appears anywhere unless the reader asks for it.

Then, on a live node, the operator watches it run the wrong test suite, types a correction, presses Stop, and sends the redirect. The current turn ends, the node remains active, the provider session continues, completed work remains, and the transcript records the wrong command, the interruption, the operator's correction, and the right command in order.

After a tab close or server restart, the same operator sees the saved draft, node queue, delivery state, and auto-send setting. Archon waits for the existing Resume action before continuing an interrupted process-boundary recovery.

## Assumptions

- Both node rooms ship together (owner-confirmed, re-confirmed). The render fork means a second JSX pass and a second renderer test suite for a surface with a finite life; shared logic in `lib/` is written once.
- Alias sets absorb provider **naming** drift, so no name-keyed mapping table is needed. They do **not** absorb semantic drift (the same key can carry a different meaning per provider, and two tools can share a name with incompatible structures) — those are handled by the normalizers.
- The production corpus is representative: **22,867 tool rows across 31 runs and 2,369 distinct tool names**, measured read-only against the deployment's own database.

## Open questions

There are no unresolved product-scope questions.

Provider transport verification, SDK updates, and payload conformance are required acceptance work in the owning current stories.
