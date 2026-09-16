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
  - ../../planning-artifacts/ux-designs/ux-Archon-2026-09-09/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md
  - ../../planning-artifacts/architecture/architecture-Archon-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../../claude-design/design_handoff_node_room_transcript_steering/README.md
  - ../../../plans/260909-2130-live-interactive-agent-view/findings.md
  - ../../../plans/reports/aionscout-260912-aion-live-interaction.md
  - ../../../plans/reports/scoutcli-260912-midturn-cli-providers.md
  - ../../../plans/reports/scoutsdk-260912-midturn-sdk-providers.md
  - ../../project-context.md
sources:
  - ../spec-readable-agent-transcript/SPEC.md
  - ../spec-live-agent-steering/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test, and validate. It unifies two previously separate specs — `spec-readable-agent-transcript` (the **read** half) and `spec-live-agent-steering` (the **write** half), both now `sources:` and fully absorbed here — into one contract for the agent node view. The two halves share one surface and two UX spines. Spec-authored companions carried in verbatim: `tool-presentation-contract.md`, `todo-fold-contract.md`, `test-plan.md` (read); `engine-integration.md`, `provider-steering-matrix.md`, `control-states.md` (write). Adopted companions own their content: `DESIGN.md` (how the node room looks) and `EXPERIENCE.md` (how it behaves), both `status: final`; the two `ARCHITECTURE-SPINE.md` files (the read Track-A spine and the steering spine, AD contracts this SPEC is built against); the `claude-design/design_handoff_node_room_transcript_steering/` mockup handoff; and the `plans/` evidence files that carry the `file:line` citations and measured numbers behind every constraint.
>
> **Reading pre-merge capability ids in adopted write artifacts.** The steering `ARCHITECTURE-SPINE.md` and `EXPERIENCE.md` were authored against the pre-merge `spec-live-agent-steering` numbering (its `CAP-1…CAP-6`) and are adopted read-only, so their bare `CAP-n` (and the steering spine's `binds:` / per-AD `Binds:` / capability map) still speak the old ids. Map them onto this SPEC by adding 7: **steering CAP-1→CAP-8, CAP-2→CAP-9, CAP-3→CAP-10, CAP-4→CAP-11, CAP-5→CAP-12, CAP-6→CAP-13**. Read-half references (`CAP-1…CAP-7`, and anything `EXPERIENCE.md` labels "Readable transcript") are unchanged by the merge. A `bmad-architecture` / `bmad-ux` Update can renumber those artifacts natively when clean ids are wanted; until then this mapping is authoritative.

# Agent Node Room

## Why

Opening an agent node in either node room (Legacy or Console) is two experiences that are both broken in opposite directions — one gives too little, the other gives nothing.

**Reading is a wall of JSON.** Every tool call renders as two always-open blocks of pretty-printed JSON (`<details open>` on input _and_ output), and the one humanising step (`agent-history.ts:171` `toolContext()`) is keyed on `['cmd','path','file_path','query','url']`, missing `command` and `pattern`, so it contributes almost nothing. Following what the agent did means reading serialized data instead of a transcript.

**Writing is impossible.** The transcript is read-only. An operator can watch the agent work on the wrong test suite for two minutes and do nothing but wait for it to finish being wrong.

This spec makes the node room **readable** and **steerable**. The two halves differ in one deep way, and it matters for sequencing:

- The **read** half is a pure function of data already in the database — already stored, already served, already through one render-neutral layer both surfaces share. It needs **no schema change, no migration, no backend change**, so it **improves every historical run the moment it ships**, retroactively.
- The **write** half acts on the **live in-process session** of a running node: _send_ it a message, and _interrupt_ its current thinking to redirect it — **without stopping the node**. Stopping the whole node already exists (the **Cancel** feature); this never touches the node lifecycle. It has no durable state either, but it can only reach a node whose executor is in this process.

What blocks the write half is small and on our side: interrupting the agent already has a provider primitive (claude's `interrupt()`, or a stream-abort on any SDK) that ends the current _turn_ while the _session_ stays alive. The one genuinely new engine behaviour is that a steered node runs **multiple provider turns on one live session** instead of ending after the first. Everything else reuses seams that already exist.

## Capabilities

The **read** half is CAP-1…CAP-7; the **write** half is CAP-8…CAP-13.

### Read — a scannable transcript

- **CAP-1** — Scan a node's work without expanding anything
  - **intent:** A reader can scan a node's tool calls one line each and tell what ran, what it ran on, and whether it worked.
  - **success:** A node with forty tool calls renders forty single-line rows, each carrying a family chip, a status glyph, a headline naming the salient argument, and right-aligned badges. Successful calls are collapsed on first render and failed calls are expanded. No collapsed row contains serialized-data punctuation.

- **CAP-2** — Expand a call into a body shaped for that kind of tool
  - **intent:** A reader can open any tool call and see its input and output rendered for the kind of tool it is.
  - **success:** Every family renders its declared body arm per `tool-presentation-contract.md`. A tool matching no family renders at most three scalar `key: value` pairs, with objects and arrays collapsed to `{…}` / `[n]`, and never a JSON dump. Measured against the production corpus, the generic fallback claims under 2% of rows.

- **CAP-3** — Follow the agent's checklist as state, not as mutations
  - **intent:** A reader can see the agent's current todo list, with phases and per-item status, instead of a sequence of opaque updates.
  - **success:** Both provider shapes normalize to the same `TodoPhase[]` per `todo-fold-contract.md`. Every todo call in the transcript collapses to a one-line row; the current checklist lives only in the pinned todo strip (below), not inline in the transcript. A phase emptied by `rm` disappears rather than rendering an empty header. A **pinned todo strip** at the top of the transcript panel mirrors the same `TodoPhase[]` and stays visible while the transcript scrolls, so current progress is always in view; it is absent when the node has no todos.

- **CAP-4** — See what a subagent dispatch asked for
  - **intent:** A reader can see the brief a task dispatch carried and which subtasks it spawned.
  - **success:** Both provider shapes normalize to `TaskSubtask[]`. The card renders batch context as markdown when the provider sends any, then one collapsible card per subtask naming the subtask and its agent.

- **CAP-5** — See what a file edit changed
  - **intent:** A reader can see the actual change a file edit made, inline, without leaving the transcript.
  - **success:** When the payload carries both before and after content, a line diff renders through `react-diff-view`. Claude always qualifies — `FileEditInput` declares `old_string` and `new_string` as required. Codex never does and falls back to path plus preview. A diff is never fabricated from one side.

- **CAP-6** — Tell attempts and loop iterations apart
  - **intent:** A reader can tell which attempt or loop iteration produced a given tool call.
  - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none. Grouping keys on `occurrence_id`, never on `attempt_id`. A **loop-iteration selector** lets the reader navigate directly between occurrence groups — the per-group headers remain the anchors it targets — and is absent on a single-occurrence node. On a live loop node, selecting a **finished** iteration renders a read-only dock — a collapsed disclosure, a `Go to iteration N` control, and a read-only band mirroring the node's still-pending queue (which delivers on return to the live iteration); the composer is absent and no steering route is called for a finished iteration (steering targets only the live iteration; the Send route stays node-scoped and iteration-agnostic).

- **CAP-7** — Keep the raw payload reachable
  - **intent:** A developer debugging a provider can still read the exact bytes the provider sent.
  - **success:** Every card exposes a Raw toggle revealing the original JSON, closed by default. This is the **only** place serialized JSON appears. Today's `canLoadFullOutput` / `onLoadFullOutput` flow keeps working.

### Write — steer the live agent

- **CAP-8** — Compose while the agent works
  - **intent:** An operator watching a running node can write a message without disturbing it.
  - **success:** The composer is mounted and enabled while the node runs, and the send control reads `Queue`. Sending holds the message; the node is untouched, no tool call is interrupted and nothing is lost. The message is delivered as the next turn when the current turn ends naturally. The interface states that only the **unsent composer draft** is this-tab-only; a **queued** message is node-scoped and server-process-local — it survives a tab close, is visible to any tab or operator viewing the same running node, and dies only on a server restart.

- **CAP-9** — Interrupt the agent's thinking; the node keeps running
  - **intent:** An operator can stop the agent's _current generation_ to redirect it, without stopping the node or abandoning the run.
  - **success:** An interrupt control in the node's composer dock ends the agent's **current turn** — via the provider's own primitive (claude `interrupt()`) or a stream-abort — and the **provider session stays alive**. The **node stays `running`** throughout (its agent moves to a projected `idle-after-interrupt` sub-state) — never paused, never `pending`, never `node_failed`. The transcript shows the in-flight tool call as _interrupted_ rather than _failed_ (this is CAP-1's status glyph `⚠`). Interrupting the agent is **not** stopping the node: that is the existing **Cancel** feature, separate and untouched. Nothing suggests the interrupt undid work already written.

- **CAP-10** — Redirect and continue on the same live session
  - **intent:** After interrupting, the operator sends what to do instead and the agent carries on from there — on the same session, in the same node.
  - **success:** Once the agent is `idle-after-interrupt`, the send control reads `Send now`. Sending dispatches the newly typed message (the queued messages are already on the registry); the executor then flushes the registry — the already-queued messages followed by this one, **in receipt/written order** — as the **next turn on the same provider session** (reusing the `attemptResumeId` re-ask seam). The node **continues** — it never "resumes" from a pause, because it never paused. Ordering is enforced by us, not assumed of the provider. Both controls follow the agent's projected sub-state, not a remembered mode.

- **CAP-11** — The exchange is part of the record
  - **intent:** Anyone reading the transcript afterwards can see what the operator said, and when, relative to what the agent did.
  - **success:** The operator's messages and the interrupted tool call appear as ordinary transcript rows in the order they happened — between the call they interrupted and the one they caused. An operator row is visibly the operator's, never mistakable for the agent's own text. _This is where the write half writes into the read half — see Cross-half dependency._

- **CAP-12** — Mid-turn delivery, as fast as each provider's transport allows
  - **intent:** The operator's message reaches a running agent without interrupting it, and sooner on a provider whose transport can take it mid-turn.
  - **success:** Sending to a running agent is an **ordinary prompt**, not a separate steer primitive — so **when** it reaches the agent is the operator's choice and only _soft-inject_ is gated by provider transport. `Queue` (the default, on every provider) delivers it as the next turn at the natural boundary, non-interrupting. Where a provider's open stream accepts a message mid-turn (claude streaming input), the same prompt arrives **before** turn-end with no interrupt, no interrupted tool call, and no turn-start event. claude's mid-turn path is **spike-gated** — whether `AsyncIterable` streaming input composes with the resume protocol is unverified at the pin — so the **v1 floor is interrupt + Queue** (needs no spike) and soft-inject ships when the spike clears. No provider is disqualified: interrupt-then-deliver is reachable on every one.

- **CAP-13** — The interface claims only what it knows
  - **intent:** An operator can tell whether a message merely left the browser or actually reached the agent.
  - **success:** A message reads `sent` until the provider echoes back the id we stamped on it, at which point it reads `delivered`. Correlation is by id alone. Only claude can echo the id, and that echo needs `@anthropic-ai/claude-agent-sdk` **≥ 0.3.246**; at the inherited pin **0.3.209 no provider can echo**, so today every message stays `sent`. `delivered` becomes reachable — claude-only — after that SDK bump.

## Constraints

### Shared — both halves land in `packages/web`

- `@archon/web` must **not** import from `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`.
- **Console must not import from `@/components/`.** Shared logic lands in `packages/web/src/lib/` and the JSX is written twice, thin — duplicating a little JSX for a surface scheduled for deletion beats refactoring code on its way out.
- Both node rooms (Legacy + Console) ship **together**, on the owner's explicit and re-confirmed decision, even though Legacy is scheduled for deletion and Console is the default route.
- Strict TypeScript, no unjustified `any`, ESLint at zero warnings. `bun run validate` is the pre-PR gate.
- Code comments and test names carry **no** plan/section/finding references — comments explain the invariant.

### Read half

- Ships **no schema change, no migration, and no backend change.** Anything that would need new persisted data is out of scope by definition — that is the line that keeps it retroactive.
- **No raw `JSON.stringify` as a default presentation anywhere in the transcript.** It survives only behind CAP-7's explicit toggle. This is the defect being fixed; re-introducing it in a fallback path fails the spec.
- Status must be decodable **without colour** — a glyph character carries it, colour only reinforces.
- A chip shows the tool name only when that name is **a single token of at most 24 characters**; otherwise it shows the **family name**. The 24-character cap is the guard behind the rule, never an instruction to truncate with an ellipsis.
- Tool identification **duck-types over alias sets**; no name-keyed mapping table. Match **exact tokens, never substrings** (`search_replace` is an edit, not a search).
- **Provider shape differences are normalized at the edge, never branched on in a renderer.** A small normalizer in `lib/` converts each provider shape to one shared shape; `ToolPresentation` stays render-neutral and neither renderer learns a provider name.
- Path headlines elide in the **middle**; commands and patterns elide at the **end**.

### Write half

- **v1 release gate (owner-ratified 2026-09-15).** Steering v1 ships at the universal floor — interrupt + `Queue`, every message `sent`, on every provider. `delivered` (G1 · claude SDK ≥ 0.3.246), claude soft-inject (G2 · spike), omp soft-inject (G4 · conformance, independent of G2), and grok hooks (G3 · spike) are **post-v1 gated backlog**, each on its own external gate; none blocks the v1 release.
- **Steering acts on the live agent, never on the node lifecycle.** _Send_ and _interrupt_ both operate on the running node's **live provider session**. The node stays `running` throughout — no pause, no `pending`, no resume, no `node_failed`. There is **no durable steering state**: no marker, no phase, no CAS, no attempt-key. Stopping the whole node is the existing **Cancel**/abort path, out of scope and untouched.
- **Interrupt is the provider's own primitive (or a stream-abort) on a per-turn signal, never the node-level one.** The executor's `nodeAbortController` (`dag-executor.ts:2209`) is **one-shot and Cancel's** (its `:3124` check fails the node; the re-ask loop stops on it, `:3032`). Steering interrupts through a **fresh per-turn signal** combined with the node-level one (`AbortSignal.any`), so each new turn gets a fresh signal — which is what lets the node run multiple turns and never trips `:3124`. `operatorInterrupt` is a **per-turn flag resolved by placement** in the existing flow (`stream → validation → canReask :3032 → :3124 Cancel check → completion`): `canReask` must also stop on it; validation is skipped on an interrupted turn; its branch sits immediately after the `:3124` Cancel check so Cancel dominates by position; it is reset at turn N+1. **End cause** is a five-case rule the executor resolves, not result-presence alone: a `result` with no abort marker is a natural end; a `result` carrying an abort marker (DeepSeek `stopReason:'aborted'`) or a thrown abort (OMP `Query aborted`) with `operatorInterrupt` set is an **interrupted end** into idle-await, never `node_failed`; a throw without the flag is a real failure; Cancel dominates by position. The executor classifies the abort-marked `result` and the abort throw — the provider adapter never suppresses them. This applies on both `executeNodeInternal` and `executeLoopNode` (AI loop nodes are steerable in v1). See `engine-integration.md`.
- **A steered node runs multiple provider turns on one live session — the one new engine behaviour.** It reuses the structured-output re-ask seam that re-invokes `sendQuery` with `attemptResumeId` on the same session (`dag-executor.ts:2290`). **Turn-end has two causes:** a **natural** end **auto-drains** (next turn on a queued message, else completes the node when the queue is empty); an **interrupted** end produces a **partial** result that must not be validated, completed, or advanced, and **always enters idle-await whatever the queue holds** — draining only on the operator's `Send now`.
- **In-process only; no durable steering state.** The **in-process registry** — keyed `(runId, nodeId)`, holding the node's live session handle plus an in-memory inbound queue, valid only while the node runs in this process — is the sole mechanism. Web dispatch runs the executor in the API server's process; a detached CLI run has no reachable handle, so steering is **unavailable** for it in v1 (Cancel and normal resume still work; the UI states this). A server restart drops the live session and any in-flight steer; the run resumes normally.
- **Two queues, split on typing vs queued.** The pre-`Queue` **draft** — text still being composed — is per-tab browser state (no table, no migration). Pressing `Queue` **dispatches** the message to the send route with `intent: 'queue'`, and from that moment it rides the **in-memory registry queue** on the live handle: the executor drains it at the natural turn boundary, or `Send now` flushes it. Delete of a queued message calls an **idempotent withdraw route** (a delete after the message has drained is a success no-op). A queued message is therefore server-side — it survives a tab close and dies on a server restart, since the registry is in-process (NFR-ANR-15 holds: no durable steering state). The crossover from client to server is `Queue`-press, not the drain moment.
- **An operator message is an ordinary `text` transcript row carrying three additive `metadata` fields:** `origin = 'operator'`, `operator_user_id` (the sender, for CAP-11 attribution on a multi-user install), and `message_id` (the caller-stamped id, so the client can reconcile which `sent` messages became rows). No new table, no widened `kind` enum — the `.strict()` metadata schema takes additive fields plus a regenerated `api.generated`, not a migration. The executor is the **sole** writer; the row is a receipt for the record, not the delivery vehicle.
- **Send and Interrupt are new routes; the queue absorbs races, only a finished node refuses.** `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt`, resolving identity via `resolveAuthContext` under a **steering-specific actor grant** (owner-ratified 2026-09-15): any authenticated identity may steer, attributed by `operator_user_id`; unauthenticated → 401; identity-less run → allowed — broadening HITL/AD-7 for the steering routes only. There is **no phase/marker gate**, and nothing is lost. A Send arriving while an interrupt is in flight waits in the queue for the operator's `Send now`. The **only** refusal: a node no longer running — `node finished` → **409** (the draft stays in the browser) — and no live handle in this process (detached) → a clear "not steerable here". On **any** terminal (finish, Cancel, or the 30-minute idle-await fail) the in-memory queue dies with the registry, so the client reconciles its `sent` ids against the `message_id` on the operator rows actually written — **only on the node's terminal event** (`node_completed`/`node_failed`, never a live refetch); any unmatched `sent` id is restored to the draft box as **"Never sent"**. With two docks on one node, **global order is the registry's receipt order**; each row's `operator_user_id` attributes it — no per-node steering lock.
- **The dock does not appear on a finished node.** Settled by the owner. The field and both controls are absent — a control that cannot act must not be drawn. Re-running a finished node is `workflow retry-node`, its own capability with its own confirmation, not this dock. An undelivered draft box stays rendered **read-only**, stating the node finished and the messages never left.
- **Interrupt is not undo.** Session state is saved up to the last completed tool call, but files already written stay written — nothing is rolled back. The control must not imply otherwise.
- **A steer delivery must not emit a turn-start event** — a stray one opens a phantom turn boundary and corrupts the record the transcript is built from.
- **Delivery is confirmed by id, never by matching text or timestamps.**
- **Steering is universal over a queue-and-flush floor; mid-turn is the acceleration.** Every provider delivers an operator message — at worst as the next prompt at turn-end. A provider earns _soft-inject_ only from a transport exercised against it, never one merely advertised. Providers differ on two honest axes: **boundary granularity** (mid-turn vs turn-end) and **delivery confirmation** (CAP-13).
- **The 30-minute idle-await fail is an inactivity timer (owner-ratified, SC 2.2.1).** While the agent is `idle-after-interrupt` and nothing is sent, a **fresh 30-minute timer** (an explicit fail branch — not the existing idle-timeout, which _completes_ the node) fails the node (`interrupted by operator, no redirect received`). Idle-await runs its own timer-driven status poll so `/workflow cancel` still reaches it, and **resolves exactly once** (`Send now`, cancel-poll, or timer). The timer is an **inactivity** timer: a debounced, authorized composing keepalive **re-arms** it without resolving idle-await, so the node fails only after 30 minutes of genuine operator inactivity — the limit is disclosed in the dock and adjustable by activity; the 30-minute value is unchanged. Resuming a 30-minute-failed node re-runs it with a **fresh session** — the interrupted context is gone.

## Cross-half dependency

CAP-11 (the operator row) writes into the read half. `AgentHistoryItem` has kinds `assistant | tool | lifecycle`, and an operator row is none of them; the read half's architecture puts every row's meaning in the shared core (`packages/web/src/lib`). So CAP-11 adds a **new item kind** and its two-shell treatment, and the CAP-1/CAP-2 transcript renderer must recognize it — an operator `text` row must not reach a live transcript until the reader recognizes `origin='operator'`, else it renders as agent text. Because the two halves are now one spec, this is an **internal** ordering dependency, not a cross-spec one: build the reader's recognition of `origin='operator'` before CAP-11 ships.

**Second cross-half reader dependency — the interrupted status row.** CAP-9 makes `⚠ interrupted` universal: the executor writes a separate `interrupted` status row on **every** provider at delivery, not only through Claude's `PostToolUseFailure` hook. For that glyph to reach the row, the read half's `deriveOutcome` (`agent-history.ts:120`) must fold that status row into the **preceding** tool call's outcome — else `⚠` is unreachable on non-Claude providers even after the write lands. Like the operator row, this is an internal ordering dependency: the reader's fold ships before the write half emits cross-provider interrupted rows.

## Non-goals

- **Cancelling the whole node.** The existing Cancel/abort feature, untouched. This feature only interrupts the agent's generation and keeps the node running.
- **Cancelling one individual tool call.** No provider offers it below turn level. Interrupt is turn-level; Cancel is node/session-level.
- **Surviving a server restart mid-steer, and steering a detached run.** In-process only in v1; both deferred.
- **Persisting the draft queue**, and **auto-send queue mode** — every send stays operator-initiated.
- **RunStream `ToolCallItem.tsx`, Chat `ToolCallCard.tsx`, and the backend `tool-formatter.ts`.** The read half touches only the two node rooms; the others are a different data path or a deliberate design.
- **A run-level "Files changed" panel**, and node-level git attribution generally — the git routes are run-scoped. Per-tool-call diffs (CAP-5) are the only node-level attribution available.
- **`qodercli`, `pi`, `copilot`, `opencode` steering.** Not in use today.
- **Agent thinking, the triggering prompt, and advisor notifications** (the rest of "Track B") — they need persistence that does not exist and are out of scope; mid-turn steering, which used to sit in that bucket, is now the write half above.

## Success signal

An operator opens a node from a run **already in the database** — no re-run, no migration — and reads what the agent did as a scannable list rather than a JSON dump: the one failing `bash` call in a forty-call node is visible with its command and its exit code without a single click, and no JSON appears anywhere unless the reader asks for it.

Then, on a **live** node, the operator watches it run the wrong test suite, types a correction, **interrupts the agent's thinking**, and sends it — and the agent **continues on the same session** against the right one, **without the node ever stopping**, without abandoning the run, and without losing the record. Reading that transcript a week later shows the wrong command, the operator's correction, and the right command, in that order.

## Assumptions

- Both node rooms ship together (owner-confirmed, re-confirmed). The render fork means a second JSX pass and a second renderer test suite for a surface with a finite life; shared logic in `lib/` is written once.
- Alias sets absorb provider **naming** drift, so no name-keyed mapping table is needed. They do **not** absorb semantic drift (the same key can carry a different meaning per provider, and two tools can share a name with incompatible structures) — those are handled by the normalizers.
- The production corpus is representative: **22,867 tool rows across 31 runs and 2,369 distinct tool names**, measured read-only against the deployment's own database.

## Open questions

> **Post-v1 mapping (2026-09-15):** the soft-inject and `delivered` items below are the post-v1 gated backlog outside the v1 release gate — claude soft-inject = **G2**, omp soft-inject = **G4**, grok hooks = **G3**, the `delivered` chip = **G1**. The v1 floor (interrupt + `Queue` + `sent`) does not depend on any of them.

- **Settled — interrupt-then-abandon fails the node after 30 minutes** (owner-ratified; see the write-half constraint). The timer is an inactivity timer re-armed by a composing keepalive (SC 2.2.1); resume re-runs with a fresh session.
- **Deferred — mid-turn (soft-inject) delivery to a detached run.** All of steering binds to the in-process live handle. Revisit when a provider offers a channel into a session it did not spawn — grok's leader socket is the only lead found.
- **Unverified spike — claude soft-inject.** Does claude's `AsyncIterable` (streaming) input compose with the resume protocol (`SendQueryOptions.resume` + one injected user message)? Exercised only on a string prompt at 0.3.209; streaming input and `interrupt()` are themselves already in 0.3.209.
- **Grok's hooks payload.** The mechanism is advertised and the handshake confirms it, but the exact shape of the text field is unexercised. Until a spike settles it, grok is interrupt-then-continue only.
- **Deferred — the `delivered` chip is gated on an SDK bump** to `@anthropic-ai/claude-agent-sdk` ≥ 0.3.246; the inherited pin is 0.3.209. `sent` ships for all providers meanwhile.
- **Resolved during the read-half specification** (from the pinned SDK's `sdk-tools.d.ts`): the Agent SDK schemas match the harness schemas; `glob` earns its own family (Claude's required `pattern` + optional `path`-as-directory vs OMP's `path`-is-pattern); the grep body arm comes from `output_mode`, not the family; Claude's `TodoWrite` (whole-list replacement) and `Agent` (single dispatch) normalize at the edge.
