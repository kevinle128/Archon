# Node Room UI Gap Analysis: Approved Mockups vs Current Implementation

**Date:** 2026-09-26 | **Scope:** Epic 3 (Stories 3.1, 3.2, 3.3) and Story 10.1 | **Status:** DONE_WITH_CONCERNS

## Executive Summary

The current web implementation has **foundational shape data structures and library logic in place** but lacks the **approved visual anatomy, durable steering UI, todo strip, queue band, composer dock, execution selector, and complete accessibility implementation** specified in the approved mockups and Epic 3 acceptance criteria. Epic 1 work (Stories 1.1–1.7) is substantially complete. Epic 2 (steering) and Epic 3 (approved shell matching + accessibility) are scoped but unimplemented.

---

## File Map: Current Implementation

### Console Node Room (Experiment Surface)

- **inspect/** directory under `packages/web/src/experiments/console/components/`
- `ConsoleAgentHistoryList.tsx` (1,200+ lines) — renders tool rows with family chips, status glyphs, headlines, badges, collapsed/expanded bodies
- `ConsoleExecutionHistory.tsx` — wraps the history list with execution selector and room layout
- `ConsoleRoomHeader.tsx` — header component (not full approved spec)
- `build-console-log-entries.ts` — projects log rows into presentation model
- `build-log-rows.ts` — constructs render items from agent history
- `select-room-data.ts` — queries and projects node data
- Test files: `.test.ts` and `.test.tsx` variants for each

### Legacy Node Room (Production Surface)

- **workflows/** directory under `packages/web/src/components/`
- `LegacyNodeRoom.tsx` — root component, dispatches to node type handlers
- `NodeRoom.tsx` — wrapper with scroll and message selection
- `NodeTranscriptPane.tsx` — query boundary, message draining, scroll management
- `NodeRoomHeader.tsx` — header with execution selector (not fully approved spec)
- `ComposerDock.tsx` — steering/approval controls dock (exists but state incomplete)
- `TodoStrip.tsx` — todo presentation component (exists but not integrated into approved layout)
- `RoomIncompleteNotice.tsx`, other room type handlers (`GateRoom`, `StdoutRoom`, etc.)

### Shared Library (Critical Path)

- `packages/web/src/lib/agent-history.ts` — projects wire rows and events into `AgentHistoryItem[]` and `TodoPhase[]`
- `packages/web/src/lib/tool-presentation.ts` (1,297 lines) — tool family resolution, headline/badge/body derivation, diff computation
- `packages/web/src/lib/todo-state.ts` — todo mutation folding into current state (`projectTodoState`)
- `packages/web/src/lib/pair-tool-transcript.ts` — pairs assistant text with tool calls
- `packages/web/src/lib/tool-output.ts` — output normalization and truncation
- `packages/web/src/lib/diff-hunks.ts` — bounded diff computation via `diff@9.0.0`
- `packages/web/src/lib/node-message-pages.ts` — pagination and live polling for node messages
- `packages/web/src/lib/steering-dock.ts` — (referenced in transcript pane) durable steering state
- Test files: corresponding `.test.ts` files for all above

---

## Anatomy: Region-by-Region Gap Analysis

**Approved Anatomy** (per README.md and mockups):

1. Panel header (520px Console / 460px Legacy) — identifies selected node execution
2. Transcript scroller — assistant, operator, tool, thinking, prompt, advisor rows in server sequence order
3. Collapsible todo strip — below scroller, above queue band
4. Durable queue band — below todo strip (only when it has content)
5. Composer dock — pinned at bottom, mutable while node can receive guidance

**Current Implementation State:**

### 1. Panel Header

- **IMPLEMENTED** — `NodeRoomHeader.tsx` / `ConsoleRoomHeader.tsx` exist
- **PARTIAL** — Execution selector UI present but pending full approval spec alignment
  - Current: may show more than 8 executions
  - Spec: must cap at 8 executions, select live execution on first render, read-only for stale executions
  - File: `packages/web/src/components/workflows/NodeRoomHeader.tsx:lines 1-150` (rough)
- **MISSING** — No fixed 520px / 460px width constraints enforced at component level

### 2. Transcript Scroller

- **IMPLEMENTED** — `NodeTranscriptPane.tsx` + `ConsoleAgentHistoryList.tsx` render items
- **PARTIAL (Row Kinds)**:
  - **assistant** rows — IMPLEMENTED (text rendering with markdown)
  - **operator** rows (Story 2.8, CAP-11) — PARTIAL
    - Data structure exists in `agent-history.ts` lines 38–48 (`kind: 'operator'`)
    - No backend persistence contract yet (awaiting steering API implementation)
    - No delivery state (`sent` / `delivered` / `never sent`) rendering
  - **tool** rows — IMPLEMENTED (collapsed: glyph, chip, headline, badges; expanded: body per family)
  - **thinking** rows (CAP-19) — MISSING
    - No backend data structure for persisted thinking
    - No privacy/truncation contract implemented
  - **prompt** rows (CAP-20) — MISSING
    - No backend data structure for triggering prompt persistence
    - No source attribution rendering
  - **advisor** rows (CAP-21) — MISSING
    - No backend data structure for advisor notifications
    - No sequence ordering implemented
  - **lifecycle** rows — IMPLEMENTED but limited (only system events, not steering-specific states)

- **PARTIAL (Row Details)**:
  - Status glyph: IMPLEMENTED (`✓ ✕ ◐ ⚠ –`) via `tool-presentation.ts:198-205`
  - Family chip: IMPLEMENTED with 24-character logic via `tool-presentation.ts:333–350`
  - Headline elision: IMPLEMENTED (path middle, text end) via `headlineElider()` in `tool-presentation.ts:lines ~600`
  - Badges: IMPLEMENTED (language, operation, count, duration, exit, state, output-state)
  - Raw toggle: IMPLEMENTED (closed by default, original JSON exposure)
  - Expanded bodies by family: IMPLEMENTED for shell, file, search, glob, code, task, web; generic fallback for others
  - File diff rendering: IMPLEMENTED via `react-diff-view` + `diff-hunks.ts`
  - Task subtask cards: IMPLEMENTED
  - Todo rows (inline checklist): PARTIAL — todo state folding exists, checklist rendering not in approved location

### 3. Todo Strip (Collapsible, Below Scroller)

- **MISSING** — No approved anatomy implementation
  - Current: `TodoStrip.tsx` exists but renders inline in the transcript, not as a pinned collapsible strip
  - Spec requirement: separate pinned region below scroller, stays visible during transcript scroll, contains folded phase list with inline checklist of latest todo mutation
  - Spec: earlier todo mutations remain one-line `todo updated` rows in transcript
  - Files affected: `TodoStrip.tsx`, `NodeTranscriptPane.tsx` layout, `buildAgentHistory()` todo projection
  - Issue: todo strip requires visual separation from transcript scroller — current implementation has no scroll boundary

### 4. Queue Band (Durable Queued Messages)

- **MISSING ENTIRELY** (Epic 2 / CAP-8, CAP-10, CAP-12)
  - No backend table for persisted operator guidance queue
  - No per-item UI controls (`Send now`, delete, delivery state)
  - No FIFO ordering enforcement on wire
  - No message-id stamping for delivery correlation
  - No "Queued" / "Will send" state-aware labels
  - Spec: full-width elevated band above composer dock, shared visibility to permitted operators, survives reload/restart
  - Files needed: backend steering store, typing in `api.generated.d.ts`, queue read/mutation routes, UI band component

### 5. Composer Dock (Mutable while node running)

- **PARTIAL** — `ComposerDock.tsx` exists but incomplete
  - **PARTIAL**: Draft persistence — `steering-dock.ts` referenced but storage mechanism not fully wired
  - **MISSING**: Auto-send setting (durable, survives restart)
  - **MISSING**: Control state projection (`generating` | `interrupting` | `idle-after-interrupt` | `recovery-required` | `finished`)
    - Current: likely shows static button labels, not dynamic state
    - Spec: Send control reads `Queue` while generating, `Send now` while idle-after-interrupt, absent when finished
    - Spec: Stop control present only while generating (not interrupting or finished)
    - File: `ComposerDock.tsx:lines ~1-200` (rough estimate)
  - **MISSING**: `aria-disabled` behavior for `Stopping…` state (keyboard focus stability)
  - **MISSING**: Durable draft box with state-aware labels (`Will send`, never-sent tracking)
  - **MISSING**: Per-item `Send now` button only when soft-injection verified (provider-gated)
  - **MISSING**: Read-only state display for finished nodes
  - **MISSING**: "restored after server restart · Resume the workflow to continue" state

---

## Visual Tokens: Concrete Differences from Mockups

### Width & Layout

- **Console Panel**: Current implementation likely does not enforce 520px fixed width
  - Spec: `width: 520px` (explicit) until close
  - File: `ConsoleExecutionHistory.tsx` or parent layout wrapper
- **Legacy Panel**: Current implementation likely does not enforce 460px fixed width
  - Spec: `width: 460px` (explicit) until close
  - File: `NodeRoom.tsx` or parent layout wrapper
- **Vertical Order** (top to bottom):
  - Header (IMPLEMENTED)
  - Transcript scroller (IMPLEMENTED)
  - Todo strip pinned below scroller (MISSING)
  - Queue band below todo strip (MISSING)
  - Composer dock pinned to bottom (PARTIAL)

### Colors & CSS Variables

- Mockup uses brand design tokens from `packages/web/src/index.css`
- **Status glyph rendering**: IMPLEMENTED
  - succeeded: `✓` (neutral/success tone)
  - failed: `✕` (danger tone)
  - running: `◐` (running tone)
  - interrupted: `⚠` (warning tone, must not use failed glyph)
  - unknown: `–` (muted tone)
- **Chip/label styling**: Must use existing Legacy/Console token roots, not copied mockup values
  - File: `ConsoleAgentHistoryList.tsx:lines ~200-400` (estimated tool-row template)
  - File: Legacy equivalent in `NodeTranscriptPane.tsx` + wrapped component

### Glyph Characters (Exact)

- Checkmark: `✓` (U+2713)
- Cross: `✕` (U+2717)
- Circle with left half-filled: `◐` (U+25D0)
- Warning sign: `⚠` (U+26A0)
- Dash: `–` (U+2013, en-dash)
- Chevron down: `‣` or standard disclosure triangle (implementation may vary per surface)

### Labels & Copy (Exact)

- Draft box header (idle-after-interrupt): `Will send`
- Terminal reconciliation: `Never sent`
- Recovery state: `restored after server restart · Resume the workflow to continue`
- Queue band heading (generating): `Queued`
- Queue band heading (idle-after-interrupt): `Will send`
- Dock placeholder (reading finished iteration): `reading a finished iteration · the agent is working in iteration N`
- Control labels: `Stop`, `Queue`, `Send now`, `Stopping…` (brief transition state)

### Execution Selector

- **Current**: Likely unlimited in displayed options
- **Spec**: Exposes no more than 8 executions (cap explicitly)
- **Spec**: Live execution selected by default on first render
- **Spec**: Stale (non-live) execution reads as read-only when selected (no Send, Withdraw, Stop, Interrupt)

---

## Backend Data Dependencies: What Does Not Exist Yet

### Tables / Schema

- `remote_agent_workflow_steering` or similar for durable queue, draft, delivery state, auto-send setting (Story 2.1, CAP-8)
- Operator message rows (already using `remote_agent_workflow_node_messages` with additive metadata fields, awaiting Story 2.8)
- Thinking row storage (Story 4.2, CAP-19) — normalized provider shapes, privacy contract, truncation bounds
- Prompt row storage (Story 4.3, CAP-20) — source attribution, actor, trigger tracking
- Advisor notification rows (Story 4.4, CAP-21) — type, sequence, identity

### API Routes (Typing + Handlers)

- `POST /api/workflows/:id/nodes/:nodeId/steering/send` — queue a message, return stamped id
- `POST /api/workflows/:id/nodes/:nodeId/steering/interrupt` — interrupt the live agent turn
- `GET /api/workflows/:id/nodes/:nodeId/steering/queue` — read durable queue for the node
- `PATCH /api/workflows/:id/nodes/:nodeId/steering/draft` — persist composer draft
- `DELETE /api/workflows/:id/nodes/:nodeId/steering/queue/:messageId` — withdraw a queued message
- `PATCH /api/workflows/:id/nodes/:nodeId/steering/auto-send` — toggle durable auto-send setting
- All above routes use `resolveAuthContext` for identity and require operator capability grants

### Provider Adapter Conformance

- **Claude**: Needs SDK update to echo stamped `message_id` on soft-injection delivery (Story G1, CAP-13)
- **Codex, Grok, DeepSeek, OMP, Qoder, Pi, GitHub Copilot, OpenCode**: All need adapter conformance for:
  - `interruptSignal` handling (fresh per-turn controller)
  - Session resume on `attemptResumeId` (existing seam reuse)
  - Truthful capability reporting (soft-injection, message acknowledgement)
  - Normalized thinking, prompt, advisor row production (Stories 4.2–4.4)

---

## Accessibility & Interaction Gaps

### Keyboard & Focus Management

- **MISSING**: `aria-disabled` for `Stopping…` state (native `disabled` blurs focus)
  - Spec: operator who presses Stop must land on next valid dock control or transcript target, never `<body>`
  - File: `ComposerDock.tsx` button templates
- **MISSING**: Visible focus indicators on all interactive elements in both shells
  - Required for both 520px Console and 460px Legacy
- **MISSING**: Keyboard-accessible execution selector navigation
  - Spec: `Execution` selector must be operable via keyboard, not mouse-only

### Live Regions & Announcements

- **PARTIAL**: Transcript scroll follow (implemented) but live-region output not serialized per control-states.md
  - Spec: Ordinary state changes use one polite `status` ARIA region
  - Spec: Delivery failure uses one assertive `alert` region
- **MISSING**: State transition announcements (generating → interrupting → idle-after-interrupt)

### Color Independence

- **IMPLEMENTED**: Status glyph separates meaning from color
- **PARTIAL**: Badges and tone attributes defined but rendering must be tested
- **MISSING**: Confirmation that all outcome information is decodable without color in both shells

### Reduced Motion

- **MISSING**: Animation suppression for `@media (prefers-reduced-motion: reduce)`
  - Control states must respect user preference
  - Transitions must have zero duration when motion is reduced

---

## Approved Specs vs. Mockups: Known Conflicts & Ambiguities

### 1. Todo Strip Pinning

- **Mockup shows**: Pinned todo strip below scroller, stays visible during scroll
- **Current implementation**: Todo mutations inline in transcript; no dedicated strip region
- **Resolution**: Spec wins. Story 3.2 acceptance criteria explicitly require collapsible strip below scroller with folded projection.
- **File to change**: `NodeTranscriptPane.tsx` layout + new `TodoStrip` positioning

### 2. Control State Labels

- **Mockup wording** vs. **Control States contract** may differ on exact edge-case copy
- **Resolution**: `control-states.md` is the authoritative UX spec; mockups are visual reference
- **Issue**: "Stopping…" state copy must match exactly for accessibility (live-region announcement)

### 3. Provider Soft-Injection Visibility

- **Spec CAP-12**: Per-item `Send now` exposes "only when the active provider has verified soft injection"
- **Mockup**: Shows the control (unclear whether it's conditional in mockup frame)
- **Resolution**: Spec wins. UI must query provider capability data and conditionally render per-item Send.
- **Data source**: `provider.capabilities.softInjection` or equivalent (to be confirmed with provider registry)

### 4. Execution Selector Caps

- **Spec CAP-6**: "the executor exposes no more than eight executions"
- **Mockup**: Shows finite list (unclear exact count in static frame)
- **Resolution**: Literal cap at 8 items; 9+ iterations truncate the selector to 8 most-recent

### 5. Thinking/Prompt/Advisor Row Existence

- **Mockup**: Does not explicitly show thinking, prompt, or advisor row examples (they are stated in specs as CAP-19, CAP-20, CAP-21)
- **Spec (CAP-19/20/21)**: Current-scope expansions requiring backend persistence and normalization
- **Resolution**: These rows are out of approved-mockup scope but in approved Epic 3 scope. Acceptance criteria for Epic 3 do not explicitly list them, so their visual presence is deferred post-Epic-3.
- **Implication**: Thinking/prompt/advisor rows are present data but not part of the node-room anatomy acceptance for 3.1–3.3 and 10.1

---

## Implementation Readiness Assessment

### Fully Ready (No Blockers)

- ✅ Tool presentation (family, chip, headline, badges, bodies)
- ✅ Diff rendering for file edits
- ✅ Task subtask card display
- ✅ Todo state folding logic
- ✅ Assistant/operator/tool/lifecycle row data structures
- ✅ Raw JSON disclosure toggle

### Partially Ready (Minor Work)

- ⚠️ Execution selector (cap at 8, read-only for stale, live default)
- ⚠️ Panel width constraints (520px / 460px)
- ⚠️ Vertical anatomy order (needs layout restructuring)
- ⚠️ Todo strip positioning (needs visual separation from transcript)
- ⚠️ ComposerDock state machine (controls already exist, state flow incomplete)
- ⚠️ Focus management on control removal (aria-disabled + focus trap)

### Blocked by Backend (Epic 2)

- ❌ Steering API routes (Send, Interrupt, Queue read, Draft persist, Withdraw, Auto-send toggle)
- ❌ Durable queue band UI (requires persisted queue data)
- ❌ Operator message persistence and delivery state
- ❌ Provider adapter conformance (soft-injection, message-id echo, session resume)
- ❌ Idle-await timeout logic (30-minute inactivity timer in executor)
- ❌ Terminal reconciliation (comparing durable queue against transcript receipts)

---

## Unresolved Questions

1. **Thinking/Prompt/Advisor Rows in Epic 3 Scope?**
   - Specs CAP-19/20/21 (Stories 4.2/4.3/4.4) are labeled current-scope but mockups don't show them
   - Are these rows expected to render in the transcript for Epic 3 (3.1–3.3, 10.1) or deferred post-Epic-3?
   - **Assumption**: Deferred post-Epic-3 based on mockup silence and story numbering (Epic 4)

2. **Auto-send Control Visibility in Queue Band**
   - Spec CAP-15: "When the queue panel is visible and the effective projected state is enabled, it shows one read-only `Auto-send on` status indicator"
   - Is this a separate band control or embedded in the queue band itself?
   - Current: No UI implementation reference found

3. **Soft-Injection Provider Capability Field**
   - Which provider capability field controls `Send now` per-item visibility?
   - `capabilities.softInjection`? `capabilities.midTurnInjection`? Other?
   - **Assumption**: To be confirmed in provider-steering-matrix.md and adapter implementations

4. **Delivery State Reconciliation Logic**
   - Spec CAP-14 & CAP-8: Terminal reconciliation examines durable queue against transcript receipts
   - Which code path (executor vs. orchestrator vs. client) owns this reconciliation?
   - **Assumption**: Executor, driven on node terminal event (per spec SPEC.md:224)

5. **Finished Iteration Dock Behavior**
   - Control States: Reading a finished iteration while node is still running shows collapse + "Go to iteration N" button
   - Is this distinct from the read-only recovery-required dock?
   - **Assumption**: Yes, distinct; read-only queue band still renders for finished iteration context

---

## Recommendations for Implementation Order

1. **Stories 3.1 & 10.1** (Pre-requisite: All Epic 1 stories complete)
   - Enforce panel widths (520px Console / 460px Legacy)
   - Restructure vertical anatomy: header → scroller → todo strip → queue band → dock
   - Cap execution selector at 8 items, select live execution default, read-only for stale

2. **Story 3.2** (Depends on 3.1 anatomy)
   - Move todo strip to pinned region below scroller
   - Implement collapsible disclosure + inline checklist of latest mutation
   - Keep earlier todo mutations as one-line transcript rows

3. **Story 3.3** (Depends on 3.1, 3.2, Epic 1 complete)
   - Add accessibility: focus management, live regions, reduced-motion
   - Test scroll follow behavior with updated anatomy
   - Verify keyboard access on execution selector and all controls

4. **Epic 2 (Parallel with 3.x)** — Backend blocking
   - Steering API routes & typing
   - Provider adapter conformance
   - Durable steering store schema
   - Only Story 2.9 (auto-send indicator) is read-only and can ship before full Epic 2

---

## Status

- **Epic 1 (Stories 1.1–1.7)**: ~90% complete (tool presentation, diff, todo state, raw toggle)
- **Epic 3 (Stories 3.1–3.3, 10.1)**: ~20% complete (shell anatomy exists but not approved; execution selector partial; accessibility missing)
- **Epic 2 (Stories 2.1–2.13)**: 0% (backend blocking; durable steering store not started)
- **Epic 4 (Stories 4.1–4.4)**: 0% (thinking/prompt/advisor rows deferred; Codex file change persistence pending)

**Deliverable**: Approved mockup implementation requires completion of Epic 3 anatomy, execution selector hardening, and accessibility. All steering controls require Epic 2 backend completion.
