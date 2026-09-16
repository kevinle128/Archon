---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments:
  - ../../specs/spec-agent-node-room/SPEC.md
  - ../../specs/spec-agent-node-room/tool-presentation-contract.md
  - ../../specs/spec-agent-node-room/todo-fold-contract.md
  - ../../specs/spec-agent-node-room/test-plan.md
  - ../../specs/spec-agent-node-room/engine-integration.md
  - ../../specs/spec-agent-node-room/provider-steering-matrix.md
  - ../../specs/spec-agent-node-room/control-states.md
  - ../../specs/spec-agent-node-room/steering-api-contract.md
  - ../../specs/spec-agent-node-room/steering-test-plan.md
  - ../ux-designs/ux-Archon-2026-09-09/DESIGN.md
  - ../ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md
  - ../architecture/architecture-Archon-2026-09-12/ARCHITECTURE-SPINE.md
  - ../architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../../claude-design/design_handoff_node_room_transcript_steering/README.md
mockup: ../../../claude-design/design_handoff_node_room_transcript_steering/
---

# Archon — Agent Node Room — Epic Breakdown

## Overview

Decomposes `spec-agent-node-room` (13 capabilities) into implementable stories for the agent node view on both web surfaces. The spec has two halves with different risk and release cadence; they are **one epic** ("Agent Node Room", **owner decision 2026-09-13** — one epic, not two) with the halves sequenced inside it — read first, steering after:

- **Read half — Readable Agent Transcript** (CAP-1…7, Stories 1.1–1.6): replace the raw-JSON tool rows with a scannable transcript. **Retroactive** — a pure function of data already in the database, no schema/migration/backend change, so it improves every historical run the moment it ships. **Ships first.**
- **Steering half — Live Agent Steering** (CAP-8…13, Stories 1.7a–1.12c): send + interrupt a live agent without stopping the node. In-process, no durable state, but reaches only a node whose executor is in this process. **v1 ships at the interrupt + `Queue` + `sent` floor** (owner-ratified 2026-09-15); `delivered` (G1), claude soft-inject (G2), omp soft-inject (G4) and grok hooks (G3) are post-v1 gated backlog, outside Epic 1's completion gate.

**Two internal ordering dependencies between the halves**, both requiring a read-half reader change to land first: (1) the operator row (CAP-11, Story 1.11) writes a new item kind, so the renderer must recognize `origin='operator'` **before** CAP-11 ships (Story 1.1 carries that reader hook); (2) the universal `interrupted` status row (CAP-9) must fold into the preceding tool card's outcome so `⚠` renders on every provider (reader fold on Story 1.1, write on Story 1.7b).

**Design references (mockup handoff)** — `claude-design/design_handoff_node_room_transcript_steering/`, four HTML screens, high-fidelity, recreate with existing tokens (Legacy hue 260 `packages/web/src/index.css`; Console hue 265 `experiments/console/theme.css`), **not** the literal values:

- **Transcript States** → read half (transcript rows + expanded bodies)
- **Console Node Room** / **Legacy Node Room** → both halves (full-panel context on each surface)
- **Steering Dock States** → steering half (composer dock across agent sub-states)

The contracts win over the mockup on any conflict; the two UX spines (`DESIGN.md` visual, `EXPERIENCE.md` behavioral) are the authoritative design contract. Two mockup elements — a **pinned todo strip** and a **loop iteration selector** — were confirmed **in scope** (owner decision, 2026-09-13) and folded into the success of CAP-3 and CAP-6 respectively; they are firm requirements, not deferred.

**Surfaces & boundaries:** Legacy `packages/web/src/components/workflows/`, Console `packages/web/src/experiments/console/`, shared render-neutral logic `packages/web/src/lib/`. `@archon/web` must not import `@archon/workflows`; Console must not import from `@/components/`; both node rooms ship together (owner decision), JSX written twice.

## Requirements Inventory

### Functional Requirements

FR1 (CAP-1): Render each tool call as one scannable row — family chip, status glyph, headline naming the salient argument, right-aligned badges; successful calls collapsed on first render, failed calls expanded; no serialized-data punctuation on a collapsed row.
FR2 (CAP-2): Expand a call into a body shaped for its family per `tool-presentation-contract.md`; a tool matching no family renders ≤3 scalar `key: value` pairs (`{…}`/`[n]` for objects/arrays), never a JSON dump; generic fallback <2% of rows.
FR3 (CAP-3): Render the agent's todo list as folded `TodoPhase[]` state (phases + per-item status), once, anchored at the last todo call; earlier todo calls collapse; an `rm`-emptied phase disappears; plus a **pinned todo strip** at the top of the transcript mirroring the same state, visible while scrolling, absent when no todos (UX-DR9).
FR4 (CAP-4): Render a subagent dispatch as batch context (markdown) + one collapsible card per subtask, naming the subtask and its agent (normalized to `TaskSubtask[]`).
FR5 (CAP-5): Render an inline line diff for a file edit when the payload carries before+after; else path + preview; never fabricate a diff from one side.
FR6 (CAP-6): Group rows by `occurrence_id` with a per-group header when a node spans >1; render none when a single occurrence; group on `occurrence_id`, never `attempt_id`; plus a **loop-iteration selector** to navigate between groups (headers stay the anchors), absent on single-occurrence (UX-DR10).
FR7 (CAP-7): Every card exposes a Raw toggle revealing the original JSON, closed by default — the only place serialized JSON appears; preserve today's `canLoadFullOutput` flow.
FR8 (CAP-8): Composer mounted + enabled while the node runs; send reads `Queue`; sending holds the message (node untouched, nothing interrupted/lost), delivered as the next turn at the natural boundary; the unsent draft is stated this-tab-only and the queue is stated node-scoped (server-process-local).
FR9 (CAP-9): An interrupt control ends the agent's current turn (claude `interrupt()` or stream-abort); the provider session stays alive; the node stays `running` (agent → `idle-after-interrupt`), never paused/pending/`node_failed`; the in-flight tool call shows `interrupted`, not `failed`; distinct from Cancel; nothing implies the interrupt undid written work.
FR10 (CAP-10): When `idle-after-interrupt`, send reads `Send now`; flushes the registry (already-queued messages then the just-typed one) in written order as the next turn on the same session; the node continues (never "resumes"). Controls follow the projected sub-state.
FR11 (CAP-11): Operator messages + the interrupted tool call appear as ordinary transcript rows in happened-order (between the call interrupted and the one caused); an operator row is visibly the operator's, never mistakable for agent text.
FR12 (CAP-12): Sending is an ordinary prompt; `Queue` (every provider) delivers at the boundary; soft-inject (claude streaming input) delivers mid-turn with no interrupt where transport allows — spike-gated; v1 floor = interrupt + Queue.
FR13 (CAP-13): A message reads `sent` until the provider echoes the stamped id → `delivered`; correlation by id alone; claude-only and needs SDK ≥ 0.3.246; at pin 0.3.209 all stay `sent`.

### NonFunctional Requirements

NFR1: The read half ships **no** schema change, migration, or backend change — retroactive on historical runs.
NFR2: Status is decodable **without colour** — a glyph character carries it; colour only reinforces.
NFR3: No raw `JSON.stringify` as a default presentation anywhere in the transcript; it survives only behind CAP-7's Raw toggle.
NFR4: The steering half is **in-process only**; no durable steering state; a server restart drops the live session and any in-flight steer, and the run resumes normally.
NFR5: An interrupt never fails the node; steering never trips the node-level abort check (`dag-executor.ts:3124`), which stays Cancel-only.
NFR6: The 30-minute idle-await fail is an **inactivity** timer, re-armed by a composing keepalive (WCAG SC 2.2.1); the 30-minute value is fixed; resuming a failed node re-runs with a fresh session.
NFR7: Strict TypeScript, no unjustified `any`, ESLint at zero warnings; `bun run validate` is the pre-PR gate.
NFR8: Accessibility floor WCAG 2.2 AA per `EXPERIENCE.md` — SC 1.4.1 (colour-free status), SC 4.1.3 (status messages: serialized composite announcements, delivery-failure assertive), SC 2.2.1 (timing), `aria-disabled` never the native `disabled` attribute, contrast floors per `DESIGN.md`.

### Additional Requirements

- `@archon/web` must not import `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`. Console must not import from `@/components/`; shared logic in `packages/web/src/lib/`, JSX written twice, thin.
- The tool presenter is one pure, React-free module `packages/web/src/lib/tool-presentation.ts`; resolver = four tiers, duck-type over alias sets, **exact-token** match (never substring), provider shapes normalized at the edge; strip the Codex `/bin/*sh -lc '…'` wrapper; MCP `mcp__server__tool` → `generic` label `server · tool`.
- CAP-5 needs a new `packages/web/src/lib/diff-hunks.ts` (jsdiff `structuredPatch`, bounded `maxEditLength`, memoized) → `GitDiffHunk` → `react-diff-view` via the existing `git-hunk-adapter.ts`.
- Interrupt uses a **fresh per-turn** `AbortSignal.any([nodeAbortController.signal, perTurnSignal])`, never the one-shot `nodeAbortController` (`:2209`/`:2223`); `operatorInterrupt` is a per-turn flag resolved by **placement** (`canReask :3032` also stops on it; branch after the `:3124` Cancel check; reset at turn N+1; `result` at `:2533` is the natural-end discriminator).
- Multi-turn on one session reuses the `attemptResumeId` re-ask seam (`:2290`); codex re-runs the resumed thread (`resumeThread`, `providers/src/codex/provider.ts:1006`).
- In-process registry keyed `(runId, nodeId)`; `POST …/send`, `…/interrupt`, `…/keepalive`, and `DELETE …/queue/:messageId` (withdraw) under `resolveAuthContext` — the steering actor grant (AD-11) broadens HITL/AD-7 for these routes. Operator row = ordinary `text` row + three additive `.strict()` metadata fields (`origin`, `operator_user_id`, `message_id`) + regenerated `api.generated` — **no migration**; executor is the sole writer; reconcile `sent` ids on the node's terminal event only.

### UX Design Requirements

UX-DR1 (CAP-1): Collapsed row anatomy — chevron `▸/▾`, status glyph, family chip, headline (middle-elide for `path`, end-elide for text; `min-width:0` in the flex row), right-aligned non-wrapping badges (duration, exit code, `+n −m`, match count). _Mockup: Transcript States; `DESIGN.md` Components; `EXPERIENCE.md` State Patterns._
UX-DR2 (CAP-1/CAP-9): Five status glyphs `✓ ✕ ◐ ⚠ –`, colour-free; `⚠` interrupted is its own character, never a recoloured `✕`.
UX-DR3 (CAP-2/3/4/5): Expanded body arms — terminal (`$ cmd` / output / exit), diff (add/del/hunk lines), matches list (`path:line`), paths flat list, code highlight, todo checklist (phase headers + per-item glyphs), task subtask cards, generic `key: value`. _Mockup: Transcript States._
UX-DR4 (CAP-8/9/10): Composer dock across agent sub-states — `generating` (`Stop`/`Queue`), `interrupting` transient (`Stopping…` `aria-disabled`), `idle-after-interrupt` (`Send now`, header `WILL SEND`), `generating again`, finished (read-only, `NEVER SENT`). _Mockup: Steering Dock States; Console + Legacy Node Room._
UX-DR5 (CAP-11): Operator transcript row — `operator · <sender display name>` label + full-strength text (distinct from assistant without hue) + `sent`/`delivered` badge.
UX-DR6 (CAP-9/10): 30-minute-fail dock treatment + disclosure copy (`no redirect ends this node after 30 min of inactivity · typing keeps it open`); `NEVER SENT` read-only box; focus moves to the last transcript row on dock removal.
UX-DR7 (accessibility): serialized composite live-region announcements per transition (steering state last; delivery-failure on an assertive `role="alert"`); `aria-disabled` discipline; `aria-describedby` on the blocked Send; reduced-motion on the dock; contrast floor for the pending-ask-blocked Send = text-secondary; CSS `text-transform`, not literal DOM capitals.
UX-DR8 (surfaces): Legacy vs Console delta — Console send control is bordered, Legacy is the filled shadcn `Button` the ask card uses; `:root` token differences (hue 260 vs 265); anatomy, order, and wording identical.
UX-DR9 (CAP-3, **in scope** — owner-confirmed 2026-09-13): a **pinned todo strip** surfacing current todo state at the top of the transcript, beyond the folded in-line checklist row; mirrors the same `TodoPhase[]`, stays visible while the transcript scrolls, absent when the node has no todos. Folded into CAP-3 success.
UX-DR10 (CAP-6, **in scope** — owner-confirmed 2026-09-13): a **loop iteration selector** to navigate between occurrence/iteration groups, beyond the per-group headers (headers stay the anchors it targets); absent on a single-occurrence node. Folded into CAP-6 success.

### FR Coverage Map

| FR / CAP                          | Story                                           |
| --------------------------------- | ----------------------------------------------- |
| FR1 (CAP-1)                       | 1.1                                             |
| FR7 (CAP-7)                       | 1.1                                             |
| FR2 (CAP-2)                       | 1.2                                             |
| FR5 (CAP-5)                       | 1.3                                             |
| FR3 (CAP-3)                       | 1.4 (+ UX-DR9)                                  |
| FR4 (CAP-4)                       | 1.5                                             |
| FR6 (CAP-6)                       | 1.6 (+ UX-DR10)                                 |
| FR9 (CAP-9) engine                | 1.7a (interrupt+registry) + 1.7b (multi-turn)   |
| FR10 (CAP-10) engine              | 1.7b (multi-turn+idle-await)                    |
| routes/registry/race handling     | 1.8 (+ full failure criteria)                   |
| FR8 (CAP-8) dock                  | 1.9                                             |
| FR9/FR10 dock                     | 1.10                                            |
| FR11 (CAP-11) operator row        | 1.11 (dep: 1.1 reader hook)                     |
| interrupted status row (CAP-9)    | write → 1.7b; reader fold → 1.1                 |
| `sent` floor                      | 1.11                                            |
| operator display-name (AD-12)     | 1.11                                            |
| agent sub-state projection (AD-9) | 1.7b                                            |
| terminal reconcile                | 1.12a                                           |
| 30-min idle-await fail            | 1.12b                                           |
| multi-user ordering               | 1.12c                                           |
| FR12 (CAP-12) soft-inject         | G2 claude + G4 omp (post-v1, independent gates) |
| FR13 (CAP-13) delivered           | G1 (post-v1, outside Epic 1 gate)               |

## Epic List

1. **Epic 1 — Agent Node Room** (CAP-1…13) — the readable transcript (retroactive, ships first, Stories 1.1–1.6) and live steering (node keeps running, Stories 1.7a–1.12c; v1 floor = interrupt + `Queue` + `sent`, with G1–G4 as post-v1 gated backlog), in one epic.

---

## Epic 1: Agent Node Room

The agent node view on both node rooms (Legacy + Console), made **readable** and **steerable** — the whole of `spec-agent-node-room` (CAP-1…13) as one epic. Two halves sequenced by risk and release cadence: the **read half** (Stories 1.1–1.6) ships first, retroactively; the **steering half** (Stories 1.7a–1.12c) follows, ending at the interrupt + `Queue` + `sent` v1 floor (G1–G4 post-v1). Both node rooms ship together; shared render-neutral logic in `packages/web/src/lib/`, JSX written twice.

**Read half (CAP-1…7) — scannable transcript; retroactive, ships first.**

Replace the two always-open blocks of pretty-printed JSON per tool call with a scannable transcript on both node rooms — one line per call, expandable into a body shaped for the tool. A pure function of data already stored and served; no schema, migration, or backend change, so it improves every historical run immediately. Design: **Transcript States** + **Console/Legacy Node Room** screens; `DESIGN.md`/`EXPERIENCE.md` authoritative.

### Story 1.1: Scannable one-line tool rows + the presenter + Raw escape hatch

As an operator opening an agent node,
I want each tool call rendered as one scannable line I can expand,
So that I can follow what the agent did without reading serialized JSON.

**Acceptance Criteria:**

**Given** a historical node with forty tool calls
**When** I open it in either node room (Legacy or Console)
**Then** it renders forty single-line rows, each with a family chip, a status glyph (`✓ ✕ ◐ ⚠ –`), a headline naming the salient argument, and right-aligned badges
**And** successful calls are collapsed on first render, failed calls expanded, and no collapsed row contains serialized-data punctuation.

**Given** rows of every outcome
**When** the transcript first renders
**Then** initial expansion is table-driven: `success` collapsed, `failed` expanded, `running` collapsed, `interrupted` collapsed, `unknown` collapsed — one focused test drives all five.

**Given** any tool call
**When** the row renders
**Then** the status is legible without colour (the glyph carries it), and the chip shows the tool name as sent only when it is a single token ≤24 chars, else the family name.

**Given** a developer needs the exact bytes
**When** they open a card's Raw toggle (closed by default)
**Then** the original JSON is shown — the only place JSON appears — and the existing `canLoadFullOutput` flow still works.

**Given** the write half will later add operator rows
**When** the renderer encounters a row whose `metadata.origin === 'operator'`
**Then** it recognizes the kind rather than rendering it as agent text (the reader hook Story 1.11 depends on).

**Given** the write half will later write an `interrupted` status row on every provider
**When** the reader builds the tool card
**Then** `deriveOutcome` folds a following `interrupted` status row into the preceding tool call's outcome, so `⚠` is reachable cross-provider — retroactive for Claude's existing interrupted rows, and the reader hook that Stories 1.7b (write) and 1.10 (proof) depend on.

_Refs:_ CAP-1, CAP-7, NFR1–3; `tool-presentation-contract.md` (collapsed row, resolver tiers, glyph mapping); presenter = pure `packages/web/src/lib/tool-presentation.ts`; mockup **Transcript States**; `DESIGN.md` Components, `EXPERIENCE.md` State Patterns + Accessibility Floor. Shared logic in `lib/`, JSX written twice.

### Story 1.2: Family-shaped expanded bodies

As a reader,
I want an expanded call rendered for the kind of tool it is,
So that I see a terminal, a search result, or code — not a data structure.

**Acceptance Criteria:**

**Given** a tool call of a known family
**When** I expand it
**Then** it renders that family's declared body arm (shell → terminal `$ cmd` + output + exit; search → `matches`/`paths` by `output_mode`; glob → flat paths; code → highlighted source; web → url + markdown).

**Given** a tool matching no family
**When** I expand it
**Then** it renders ≤3 scalar `key: value` pairs (objects/arrays collapsed to `{…}`/`[n]`), never a JSON dump.

**Given** the production corpus (a **release-time deployment audit**, not a CI fixture — the corpus is live data)
**When** the read-only replay script resolves the distinct tool names against their row counts
**Then** it reports the generic-fallback numerator / denominator / fraction to the release audit log and the release gate fails if the fraction is ≥ 2% — no numerator/denominator is frozen in the docs (`test-plan.md` → Generic-fallback corpus audit).

_Refs:_ CAP-2; `tool-presentation-contract.md` (Expanded body table; the `glob` `path`-vs-`pattern` trap; grep arm from `output_mode`); `test-plan.md` (Generic-fallback corpus audit); mockup **Transcript States**. Depends on Story 1.1 (shared presenter + shell).

### Story 1.3: Inline file-edit diff

As a reader,
I want a file edit shown as the change it made,
So that I see what changed inline without leaving the transcript.

**Acceptance Criteria:**

**Given** a file-edit call whose payload carries both before and after content
**When** I expand it
**Then** a line diff renders through `react-diff-view` (add/del/hunk lines).

**Given** a Codex file edit that attaches no input
**When** I expand it
**Then** it falls back to path + preview; a diff is never fabricated from one side.

**Given** a pathological input
**When** the diff is computed
**Then** `diff-hunks.ts` bounds it with an explicit `maxEditLength` (never a wall-clock timeout) and degrades to path + preview rather than hanging the thread.

**Given** the `diff-hunks` failure-oracle cases
**When** Story 1.3 is closed
**Then** the read-half diff test contract is part of completion — the byte ceiling (not only `maxEditLength`), repeated and mid-array no-newline markers, repeat determinism, memoization, and adapter line-number validity — not deferred to references (`test-plan.md` → diff-hunks contract).

_Refs:_ CAP-5; Additional Requirements (`diff-hunks.ts` + `git-hunk-adapter.ts`); mockup **Transcript States**. Depends on Story 1.1 (shared presenter + shell).

### Story 1.4: Todo list folded as state (+ pinned strip)

As a reader,
I want the agent's todo list as current state, not a sequence of updates,
So that I see phases and per-item status at a glance.

**Acceptance Criteria:**

**Given** a node with todo calls (OMP ops or Claude whole-list `TodoWrite`)
**When** I view it
**Then** both provider shapes fold to one `TodoPhase[]` per `todo-fold-contract.md`, and every todo call collapses to a one-line row — the checklist is not rendered inline in the transcript; it lives only in the pinned strip below.

**Given** a phase emptied by `rm`
**When** the checklist renders
**Then** the phase disappears rather than rendering an empty header.

**Given** a node with todo state (owner-confirmed in scope)
**When** the transcript renders
**Then** current todo state also surfaces as a **pinned strip** at the top of the transcript panel, mirroring the same `TodoPhase[]`, staying visible while the transcript scrolls, and absent when the node has no todos.

_Refs:_ CAP-3 (incl. UX-DR9, folded into CAP-3 success); `todo-fold-contract.md` (nine OMP ops incl. the three traps; Claude last-call-wins); mockup **Transcript States**. Depends on Story 1.1 (shared history + both renderers).

### Story 1.5: Subagent dispatch cards

As a reader,
I want a task dispatch shown as its brief and its subtasks,
So that I see what a subagent was asked to do.

**Acceptance Criteria:**

**Given** a task dispatch (OMP batch or Claude single)
**When** I expand it
**Then** both shapes normalize to `TaskSubtask[]`, batch context renders as markdown, and each subtask is one collapsible card naming the subtask and its agent.

_Refs:_ CAP-4; mockup **Transcript States**. Depends on Story 1.1 (shared presenter + both renderers).

### Story 1.6: Occurrence grouping headers (+ loop iteration selector)

As a reader,
I want to tell which attempt or loop iteration produced a call,
So that a re-run or loop node is not one undifferentiated list.

**Acceptance Criteria:**

**Given** a node whose rows span more than one `occurrence_id`
**When** I view it
**Then** a header renders per group; grouping keys on `occurrence_id`, never `attempt_id`.

**Given** a single-occurrence node
**When** I view it
**Then** no group header renders.

**Given** a node spanning more than one occurrence (owner-confirmed in scope)
**When** the transcript renders
**Then** a **loop-iteration selector** lets me navigate directly between occurrence groups — the per-group headers remain the anchors it targets — and it is absent on a single-occurrence node.

**Given** I navigate to a **finished** iteration of a live loop node via the selector
**When** the dock renders for that iteration
**Then** it shows a collapsed disclosure with a `Go to iteration N` control and a **read-only** band mirroring the **node's** registry queue (the operator's still-pending messages), inert here — no `Send now`, no delete — and delivering when the operator returns to the live iteration. The composer is not offered and the client makes **no** steering route call for a finished iteration; steering targets only the live iteration, and the node-scoped Send route is not iteration-aware, so there is no server refusal to return. That finished iteration's already-delivered operator messages read back inline in its occurrence group in the transcript, not in this band. The dock is still fully absent when the operator views a non-live **execution** (a different run) — the two cases are distinct.

_Refs:_ CAP-6 (incl. UX-DR10, folded into CAP-6 success); finished-iteration dock — `control-states.md` "Viewing a finished iteration" (first-class) + design handoff Delta 6; mockup **Console/Legacy Node Room**. Depends on Story 1.1 (shared history + both renderers).

---

**Steering half (CAP-8…13) — live-session write half; ships after the read half above.**

Send a message to a running agent, and interrupt its current thinking to redirect it — both without stopping the node (the node stays `running`; stopping the whole node is the existing Cancel feature). In-process, no durable state. Design: **Steering Dock States** + **Console/Legacy Node Room**; `control-states.md` + `EXPERIENCE.md` authoritative. **Two cross-half dependencies**, both needing Story 1.1's read-half reader first: the operator row (Story 1.11) needs the reader to recognize `origin='operator'`, and the universal `interrupted` status row (Story 1.1 fold, Story 1.7b write) needs the reader to recognize and fold it onto the preceding tool card so `⚠` renders on every provider.

**Story shape (owner-ratified 2026-09-15 — hybrid).** The steering half's first **operator-visible outcome** is _an operator interrupts a running node and `Send now`s a correction that continues on the same session_ — delivered end-to-end at Story 1.10 on at least one provider. Stories **1.7a / 1.7b / 1.8** are the engine + transport **tasks that outcome decomposes into**: kept as separately-tracked, independently-testable stories for sizing, but they exist to enable the 1.9→1.10 operator flow, not as shippable value on their own. The five-provider interrupt-conformance fixtures (Story 1.7a) are acceptance tests of that outcome. Read the sequence as one steerable outcome (1.9–1.10) with its engine/transport tasks beneath it (1.7a/1.7b/1.8), then the record + safety stories (1.11–1.12c).

### Story 1.7a: Live-session registry + per-provider interrupt contract (engine + providers)

As the engine,
I want a steered node's live handle reachable in-process and each provider able to interrupt its current turn without failing the node,
So that later stories have a handle to steer and every provider ends a turn while its session stays alive.

**Acceptance Criteria:**

**Given** a running node
**When** steering interrupts
**Then** it aborts a **fresh per-turn signal** (`AbortSignal.any` with the node-level one), never the one-shot `nodeAbortController`, so the `:3124` Cancel check is never tripped and the node stays `running`; `operatorInterrupt` is set when the per-turn abort fires.

**Given** a node running in-process
**When** the executor starts and ends the node
**Then** it registers `(runId, nodeId) → live session handle + inbound queue` in the in-process registry on start and tears it down on any terminal, so later stories can resolve the handle to send or interrupt (a node with no in-process handle is not steerable).

**Given** each in-use provider
**When** steering interrupts its turn
**Then** it ends the current turn and keeps the session alive per a **provider-conformance table** with at least one fixture each: claude native `interrupt()`; codex stream-abort → `resumeThread`; omp stream-abort; grok stream-abort; deepseek cancel-and-continue. Their soft-inject transports (omp RPC, claude streaming input, grok hooks) are **not** in this story — they are G2/G3.

**Given** an AI `loop` node — or a provider-calling node inside a `loop_group` body — which runs via `executeLoopNode` (`:5718`), separate from `executeNodeInternal`
**When** it runs in-process
**Then** it registers the same `(runId, nodeId) → handle + queue` and gets the same fresh-per-turn interrupt seam, so the loop path is steerable in v1 (owner-ratified 2026-09-15).

_Refs:_ CAP-9, NFR4–5; `engine-integration.md` §1–§3 (the abort seam, the registry); `provider-steering-matrix.md` (per-provider interrupt + fixtures); `steering-test-plan.md` (provider conformance). _Packages:_ `@archon/workflows` (executor abort seam + in-process registry), `@archon/providers` (per-provider interrupt). _Integration gate:_ the five-provider interrupt-conformance fixtures are green.

### Story 1.7b: Multi-turn session loop + idle-await entry + agent sub-state projection (engine)

As the engine,
I want a steered node to run further turns on one live session and to project whether the agent is generating or idle-after-interrupt,
So that the agent continues from where the operator redirected it and both docks read one status channel.

**Acceptance Criteria:**

**Given** an interrupted turn
**When** the loop resolves it
**Then** `operatorInterrupt` is honored by placement — `canReask` (`:3032`) also stops on it, validation is skipped, its branch sits after the `:3124` Cancel check, and the flag resets at turn N+1; and **end cause is the five-case rule** (not result-presence alone): a `result` with no abort marker → natural; a `result` with an abort marker (DeepSeek) or a thrown abort (OMP `Query aborted`, caught at `:3332`) with `operatorInterrupt` set → **interrupted** end → idle-await, never `dag_node_failed`; a throw without the flag → real failure; Cancel dominates. The adapter never suppresses the abort `result`.

**Given** a delivered operator message
**When** the turn ends
**Then** the node runs turn N+1 on the same session via the `attemptResumeId` re-ask seam (`:2290`); a natural end auto-drains the queue, an interrupted end **enters idle-await** and drains only on `Send now`.

**Given** an interrupted end on any provider
**When** the loop enters idle-await
**Then** the executor writes a single **`interrupted` status row** for the in-flight tool call (not only Claude's `PostToolUseFailure` hook), so the read half can fold `⚠` onto that card cross-provider.

**Given** a node in `running`
**When** the executor projects agent state
**Then** it emits **exactly two** typed sub-state values — `generating` | `idle-after-interrupt` (never `interrupting`, which is UI-local) — on the node-state response both shells consume, with `api.generated` regenerated (AD-9).

**Given** a steered AI `loop` node
**When** an operator interrupts and `Send now`s
**Then** the end-cause rule, idle-await, and the two-value sub-state projection apply on the `executeLoopNode` path too, and `Send now` **continues the interrupted iteration** on the same session **before** the normal loop-completion check; focused tests cover both execution paths.

_Refs:_ CAP-9, CAP-10, NFR4–5; `engine-integration.md` §2 (multi-turn, placement clauses, discriminator, idle-await entry); steering AD-9 (sub-state projection), AD-4 (drain rules). The 30-minute idle-await **safety** is Story 1.12b. Depends on Story 1.7a (registry + interrupt). _Packages:_ `@archon/workflows` (multi-turn loop, idle-await entry, end-cause classifier), `@archon/server` (two-value sub-state on the node-state response + `api.generated` regen). _Integration gate:_ end-cause + idle-await green on **both** `executeNodeInternal` and `executeLoopNode`.

### Story 1.8: Send / Interrupt / Keepalive / Withdraw routes + registry resolution + race handling

As the system,
I want authorized steering routes that resolve the live node and never lose a message to a race,
So that the dock has a transport to call before it is built, and nothing is silently dropped.

**Acceptance Criteria:**

**Given** `POST …/nodes/:nodeId/send`, `…/interrupt`, `…/keepalive`, and `DELETE …/nodes/:nodeId/queue/:messageId` (withdraw)
**When** called
**Then** they match the typed request/response/error schemas in `steering-api-contract.md`, identity resolves via `resolveAuthContext` under the **steering actor grant** (AD-11), and each route resolves the live handle from the Story 1.7a registry keyed `(runId, nodeId)`.

**Given** a Send arriving while an interrupt is still in flight
**When** the route handles it
**Then** it waits in the registry queue for `Send now` (never delivered automatically); the queue absorbs the race with no 409.

**Given** a node no longer running, or a detached run with no live handle
**When** a Send/Interrupt is called
**Then** the only refusals fire — `node finished` → 409 (the draft stays in the browser) or the detached "not steerable here" (status per the api-contract); Cancel and normal `/workflow resume` still work on the detached run.

**Given** the steering actor grant (owner-ratified 2026-09-15, AD-11)
**When** each actor calls send / interrupt / keepalive
**Then** the run starter, any other authenticated member, and an admin are allowed (attributed by `operator_user_id`); an unauthenticated caller → 401; a run with no `user_id` (identity-less) → allowed.

**Given** an interrupt request whose turn end races it
**When** the route handles it
**Then** a mid-turn interrupt returns `sub_state:'idle-after-interrupt'`; a turn that ended naturally with a queued message returns `sub_state:'generating'` (auto-drained); a natural end with an empty queue returns 409 `node_finished`.

**Given** an invalid run/node id
**When** the route handles it
**Then** it returns 404 `not_found` and leaves the node, queue, and transcript unchanged.

**Given** a malformed or schema-invalid payload
**When** the route handles it
**Then** it returns 400 `invalid_request` and changes nothing.

**Given** a duplicate `message_id`
**When** send handles it
**Then** it replays the original receipt idempotently — never a second queue entry.

**Given** a repeated interrupt while already `idle-after-interrupt`
**When** the route handles it
**Then** it is an idempotent no-op returning the current `sub_state`.

**Given** a node that goes terminal mid-request
**When** the route handles it
**Then** it returns 409 `node_finished`; every rejected request leaves the node, queue, and transcript unchanged.

**Given** an authenticated withdraw for a queued message (steering actor grant, AD-11)
**When** the route handles it
**Then** a message still in the queue is removed and returns `{ success: true, message_id }`; a message that had already drained (or an unknown `message_id`) returns the **same idempotent success no-op** — there is **no** message-level 404 (404 is only an unknown `runId`/`nodeId`); an unauthenticated caller → 401; and every rejected request leaves the node, registry queue, and transcript unchanged.

_Refs:_ CAP-8/9 infra, NFR4; `steering-api-contract.md` (schemas, status codes, idempotency); `engine-integration.md` (routes, registry, refusals); `control-states.md` (Send-now-no-server-gate, the 409). Depends on Story 1.7a's registry, Story 1.7b's multi-turn loop + agent sub-state projection (the interrupt-race criteria need its `generating`/`idle-after-interrupt` projection and natural-end auto-drain), and the api-contract.

### Story 1.9: Composer dock — compose and Queue while generating

As an operator watching a running node,
I want to write and queue a message without disturbing the agent,
So that my correction is ready to deliver at the next turn.

**Acceptance Criteria:**

**Given** a running node with a generating agent
**When** the dock renders
**Then** the composer is mounted and enabled, the send control reads `Queue`, the header shows `QUEUED · n` for messages already queued on the server for this run, and the composer's unsent text stays `this tab only`.

**Given** I press `Queue`
**When** the message is held
**Then** it is **dispatched** to the send route with `intent: 'queue'` and enters the in-process registry queue at once; the node is untouched, no tool call is interrupted, nothing is lost. `x` (delete) calls the **idempotent withdraw route** (a delete after the message has drained is a success no-op). The executor drains the registry queue at the natural turn boundary — automatically when the current turn ends naturally, or on `Send now` after an interrupt.

**Given** the projected agent sub-state
**When** the dock reads it
**Then** controls follow the sub-state (`generating` | `idle-after-interrupt`), never a remembered mode; `Enter` inserts a newline and never sends.

**Given** the same running node is open in a second tab, or steered by a second operator
**When** either dock renders
**Then** both show the same `QUEUED · n` from the node's registry queue, and either may withdraw any queued item via the idempotent withdraw route (keyed by `message_id`); only the unsent composer text differs per tab (`this tab only`). E2E covers two tabs on one running node.

**Given** the composer with a queueable message
**When** the operator presses `Cmd`/`Ctrl`+Enter
**Then** it triggers the **same action and the same blocked-state guard** as the send control (a no-op while `Stopping…` and while blocked by a pending ask); the shortcut is discoverable — a composer hint and an appended note on the send control's accessible name, with the visible word (`Queue` / `Send now`) kept at the **start** of that name (SC 2.5.3). Plain `Enter` still inserts a newline. E2E covers discoverability and blocked-state parity.

**Given** a node parked at an unanswered ask, or a reduced-motion preference
**When** the dock renders
**Then** the blocked Send is `aria-disabled` (never the native attribute) with its reason bound by `aria-describedby`; the caret animation respects `prefers-reduced-motion`; and header capitals come from CSS `text-transform`, never literal DOM capitals.

_Refs:_ CAP-8, NFR8; UX-DR7 (a11y); mockup **Steering Dock States** (state 1); `control-states.md`, `EXPERIENCE.md` The dock, Accessibility Floor. Depends on Stories 1.7b (sub-state + queue-drain) and 1.8 (send route).

### Story 1.10: Interrupt control, idle-after-interrupt, and Send now

As an operator,
I want to stop the agent's current thinking and then send what to do instead,
So that the agent continues on the right thing without the node ever stopping.

**Acceptance Criteria:**

**Given** a generating agent
**When** I press `Stop`
**Then** the interrupt route (Story 1.8) fires, the current turn ends (session alive), the node stays `running`, the agent moves to `idle-after-interrupt`, the in-flight tool call shows `⚠ interrupted` (not failed), and a brief `Stopping…` transient (if shown) is `aria-disabled`, not the native attribute.

**Given** the agent is `idle-after-interrupt`
**When** the dock renders
**Then** the stop control is gone, send reads `Send now`, the draft header reads `WILL SEND · n`, and a disclosure states the interrupt did not undo written work.

**Given** I press `Send now`
**When** delivery runs
**Then** the newly typed message is dispatched and the executor flushes the registry — the already-queued messages then this one, in receipt/written order — as the next turn on the same session, and the agent generates again (`Stop`/`Queue` return).

**Given** a non-Claude provider is interrupted (write from Story 1.7b, fold from Story 1.1)
**When** the transcript renders end-to-end
**Then** the in-flight tool call shows `⚠ interrupted`, not `✕ failed` — this story proves the whole cross-provider path; the fold itself lives in Story 1.1's reader (SPEC Cross-half dependency).

**Given** a state transition or the dock's removal
**When** it happens
**Then** a per-transition polite live-region announcement fires, the delivery-failure alert is assertive (`role="alert"`), the `Stopping…` transient uses `aria-disabled` (never the native attribute), focus moves to the last transcript row rather than `<body>`, and a disclosure states the interrupt did not undo written work.

_Refs:_ CAP-9, CAP-10; UX-DR7 (a11y), SPEC Cross-half dependency (interrupted-row fold); mockup **Steering Dock States** (states 2–4); `control-states.md`, `EXPERIENCE.md`. Depends on Stories 1.8 (interrupt route), 1.9 (dock), 1.7b (interrupted-row write), and 1.1 (reader fold).

### Story 1.11: Operator message in the transcript record (+ `sent` floor, + display-name projection)

As anyone reading the transcript later,
I want the operator's messages recorded in order among the agent's calls and marked with a delivery state,
So that the exchange is part of the permanent record and I can tell a message left the browser.

**Acceptance Criteria:**

**Given** an operator message is delivered
**When** the executor writes it
**Then** it is an ordinary `text` row with three additive `metadata` fields (`origin='operator'`, `operator_user_id`, `message_id`), no new table and no widened `kind`, written by the executor alone, placed by `seq` between the call it interrupted and the one it caused.

**Given** a delivered message on any provider (the v1 floor)
**When** the transcript shows it
**Then** it is badged `sent` and stays `sent` — the v1 ceiling on every provider (`delivered` is post-v1 G1; no message advances past `sent`).

**Given** the row reaches the transcript
**When** the reader renders it
**Then** it is visibly the operator's — label `operator · <display name>`, full-strength text, never mistakable for agent text. The display name comes from the **read-time server projection** (steering AD-12: `operator_display_name` joined on `operator_user_id`, not a stored field, no client fetch); a join miss falls back to the short id. **Requires Story 1.1's reader recognizing `origin='operator'`** (build that first).

_Refs:_ CAP-11, CAP-13 (`sent` floor), SPEC v1 release gate, Cross-half dependency; steering AD-6 (operator row), AD-12 (display-name projection); `engine-integration.md` (operator row), `EXPERIENCE.md`; mockup operator row. Depends on Stories 1.1 (reader hook), 1.7b (write point), and 1.8 (delivery route).

### Story 1.12a: Terminal message reconciliation

As the system,
I want a message never silently undelivered,
So that the operator sees exactly which of their sends became transcript rows.

**Acceptance Criteria:**

**Given** any terminal (finish, Cancel, or the 30-minute fail)
**When** the client reconciles **on the node's terminal event only**
**Then** each `sent` id — every queued `message_id` the dock displayed from the node's registry queue, not only this tab's own sends — is matched against the `message_id` on written operator rows; any unmatched id returns to the draft box as `NEVER SENT`; the reconciliation never runs on a live refetch (it would mis-mark a delivered message before the final insert commits). A delivery failure surfaces on an assertive `role="alert"`.

_Refs:_ CAP-11 record + NFR4/NFR8; `engine-integration.md` (reconciliation on terminal only), `control-states.md` (`NEVER SENT`); mockup **Steering Dock States** (state 5). Depends on Stories 1.8 (routes) and 1.11 (operator row).

### Story 1.12b: Idle-await lifecycle safety (30-minute inactivity fail)

As the system,
I want an abandoned interrupt never to hang the node forever,
So that steering fails safe when the operator walks away.

**Acceptance Criteria:**

**Given** an `idle-after-interrupt` agent with nothing sent
**When** 30 minutes of composer inactivity pass
**Then** the node fails (`interrupted by operator, no redirect received`) on an explicit fail branch, never the existing idle timeout that completes.

**Given** the idle-await inactivity timer
**When** any composer keepalive activity occurs (keystroke / focus, via the keepalive route — `Send now` is excluded, it resolves idle-await)
**Then** it re-arms without resolving idle-await, and its limit is disclosed in the dock.

**Given** an idle-await node
**When** `/workflow cancel` is issued
**Then** the idle-await cancel-poll reaches it (no stream exists), and idle-await resolves exactly once (the first of `Send now`, cancel-poll, or timer wins).

**Given** a 30-minute-failed node
**When** it is resumed
**Then** it re-runs with a fresh session (the interrupted context is gone).

**Given** an `idle-after-interrupt` node with **queued** messages present (not an empty queue)
**When** 30 minutes of composer inactivity pass
**Then** the node fails **once** on the explicit fail branch, the registry (with its queued messages) is torn down, and Story 1.12a's terminal reconciliation restores the unmatched queued messages to the draft box as `NEVER SENT`.

_Refs:_ NFR6; `engine-integration.md` (idle-await fail branch, cancel-poll), steering AD-4; `control-states.md`. Depends on Stories 1.7b (idle-await entry), 1.8 (keepalive route), and 1.9–1.10 (dock + composer activity).

### Story 1.12c: Concurrent-operator ordering

As the system,
I want two operators steering one node to interleave predictably and be attributable,
So that a multi-user install has a defined global order and per-message authorship.

**Acceptance Criteria:**

**Given** two docks steering one node on a multi-user install
**When** their sends arrive
**Then** global order is the registry's server-side receipt order (no per-node lock), each row attributed by `operator_user_id`; per-operator "written order" holds within each sender's stream.

_Refs:_ CAP-11 record + NFR4/NFR8; steering AD-11 (receipt order). Depends on Stories 1.8 (routes) and 1.11 (operator row).

---

## Post-v1 gated backlog (outside Epic 1's completion gate)

Epic 1 **completes at the interrupt + `Queue` + `sent` floor** (owner-ratified 2026-09-15).
These four items each ride a separate external gate and do **not** block the v1 release.
They are not a new epic — they honor the one-epic decision (2026-09-13) as deferred work under Epic 1.

### G1 — `delivered` chip (gated on the claude SDK bump)

**Given** an SDK bump to `@anthropic-ai/claude-agent-sdk` ≥ 0.3.246
**When** claude echoes the stamped `message_id`
**Then** that message advances `sent → delivered` (claude-only, correlation by id alone); until the bump every message stays `sent`.
_Gate: SDK pin moves from 0.3.209 to ≥ 0.3.246. Refs: CAP-13, steering AD-8, `provider-steering-matrix.md`._

### G2 — Claude soft-inject / mid-turn delivery (spike-gated)

**Given** the claude `AsyncIterable`-input-plus-resume spike clears
**When** a message is soft-injected on Claude
**Then** it arrives mid-turn with no interrupt, no interrupted tool call, and no turn-start event. The delta-2 per-item `Send now` renders wherever soft-inject exists (Claude here; OMP via G4).
_Gate: the claude `AsyncIterable` + resume-protocol spike. Refs: CAP-12, steering AD-3/AD-7, `provider-steering-matrix.md`._

### G3 — Grok hooks soft-inject (spike-gated)

**Given** the grok `pre_tool_use` hook payload-shape spike clears
**When** a message is delivered through the hook
**Then** grok gains mid-turn soft-inject; until then grok is interrupt-then-continue only (v1 floor).
_Gate: the grok hook payload-shape spike. Refs: CAP-12, `provider-steering-matrix.md`._

### G4 — OMP soft-inject / mid-turn delivery (conformance-gated, independent of G2)

**Given** the OMP RPC / protocol-version-2 / `set_steering_mode:'all'` soft-inject path (AR-18) is conformance-verified (source-verified in `provider-steering-matrix.md`, on its own gate — it does **not** wait on Claude's `AsyncIterable` spike)
**When** a message is soft-injected on OMP
**Then** it arrives mid-turn with no interrupt, no interrupted tool call, and no turn-start event. Per-item `Send now` renders here too (the shared soft-inject affordance stated in G2).
_Gate: OMP soft-inject conformance (independent of G2). Refs: CAP-12, steering AD-3/AD-7, `provider-steering-matrix.md`._
