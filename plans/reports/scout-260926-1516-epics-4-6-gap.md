# Gap Analysis: Epics 4–6 and Story 10.4 (Agent Node Room)

**Date:** 2026-09-26  
**Scope:** Stories 4.1–4.4, 5.1–5.2, 6.1–6.3, and 10.4 from approved epics  
**Task:** Assess implementation status against acceptance criteria

---

## Executive Summary

Epics 4, 5, and 6 span readable tool presentation across all surfaces (Node Room, RunStream, Chat, backends), file diff/attribution, and agent context (thinking, prompts, advisor). Story 10.4 validates Codex-specific tool status presentation.

**Overall Status: SUBSTANTIAL GAPS** — The node-message schema supports only three kinds (text, tool, status); thinking, prompts, operator messages, and advisor notifications are not persisted. Codex file changes are emitted as system chunks but not persisted as tool rows. Tool-presentation.ts exists but is not wired into RunStream or Chat. Backend tool formatting exists but doesn't match the contract. File change attribution and Files Changed panel are not implemented. Codex interrupt capability is set to false.

---

## Epic 4: Apply Readable Tool Presentation Everywhere (Stories 4.1–4.4)

### Story 4.1: Persist successful Codex file-change rows

**Status:** **MISSING**

**Current State:**

- Codex `file_change` events are yielded as `system` chunks in `packages/providers/src/codex/provider.ts:709–745`
  - Example: `yield { type: 'system', content: '✅ File changes:\n➕ src/file.ts' }`
- These chunks are streamed and logged by the executor as `dag.system_message_unhandled` debug events
- **File changes never reach workflow_node_messages table** — they are consumed as transient system messages
- No row kind supports file edits; `toolBodyPresentation` in `tool-presentation.ts` would need a `diff` body arm (Story 1.4 in historical epics)

**Gap:**

- Schema `node-message.ts` only defines `tool`, `text`, and `status` kinds
- Codex provider does not serialize file_change as a tool message structure
- Executor does not persist Codex file changes to `workflow_node_messages`
- File diff rendering (`react-diff-view`, `diff-hunks.ts`) exists in tool-presentation but has no input

**Acceptance Evidence Needed:**

- (AC line 977) "provider and executor process it" → normalize and persist a typed node-message row
- (AC line 982) "Row retains path, outcome, ordering, and bounded diff or preview evidence"
- (AC line 987) "Synthetic no-input row is not accepted as ingestion evidence" (requires real persisted row)

**Change List:**

1. Extend `node-message.ts` with `tool` kind that carries file-edit payloads (path, before, after, outcome)
2. Modify Codex provider to yield `tool` events instead of `system` chunks for successful `file_change` items
3. Update executor to persist these as workflow_node_messages with `kind: 'tool'` and file metadata
4. Ensure presentation reads the diff body when both before/after exist

---

### Story 4.2: Use readable tool presentation in RunStream

**Status:** **MISSING**

**Current State:**

- `packages/web/src/experiments/console/components/RunStream.tsx` exists but does not import or call tool-presentation functions
- No references to `toolPresentation`, `toolRowPresentation`, or `toolBodyPresentation`
- Tool rendering in RunStream falls back to agent-history defaults (likely JSON-heavy)

**Gap:**

- The shared semantic presentation contract (`toolPresentation`, `toolRowPresentation`, `toolBodyPresentation` from `@/lib/tool-presentation`) is not consumed by RunStream
- RunStream reads tool events from persisted transcript but does not resolve family, headline, badges, or body shape

**Acceptance Evidence Needed:**

- (AC line 1003) "Uses the shared family, headline, outcome, ordered badges, body facts, and safe fallback"
- (AC line 1008) "Node Room and RunStream render the same event" with matching semantics

**Change List:**

1. Import tool-presentation functions in RunStream
2. For each tool-kind message in the transcript, call `toolRowPresentation` to resolve collapsed row
3. Expand body lazily by calling `toolBodyPresentation` when the tool row is opened
4. Reuse the same Raw toggle and generic fallback logic as Node Room

**Dependency:**

- Blocks on Story 4.1 (must have persisted tool rows to read)

---

### Story 4.3: Use readable tool presentation in Chat

**Status:** **MISSING**

**Current State:**

- `packages/web/src/components/chat/ChatInterface.tsx` exists
- No imports of tool-presentation functions
- Chat tool calls are rendered via agent-history or raw JSON

**Gap:**

- Same as RunStream: shared semantic presentation is not wired in
- Chat messages carrying tool calls do not resolve family, headline, or body shape

**Acceptance Evidence Needed:**

- (AC line 1024) "Consumes the shared Web semantic presentation"
- (AC line 1029) "Chat and Node Room render the same event" with matching family, headline, outcome, badge order, fallback

**Change List:**

1. Import tool-presentation functions in Chat renderer
2. When a message contains a tool call, call `toolRowPresentation` to build the collapsed row UI
3. Wire up expand/collapse and Raw toggle using the same contracts as Node Room
4. Degrade safely if payload is missing or malformed

**Dependency:**

- Blocks on Stories 4.1 and 4.2

---

### Story 4.4: Align backend tool formatting

**Status:** **PARTIAL**

**Current State:**

- `packages/workflows/src/utils/tool-formatter.ts` exists: basic text formatter with emojis
- Used by `packages/core/src/orchestrator/orchestrator-agent.ts` to format tool calls for platform adapters (Slack, Telegram)
- Current implementation: `🔧 TOOLNAME\nBrief: <command/path/truncated-json>`
- Does NOT match tool-presentation-contract semantics: no family resolution, no headline extraction, no badge structure

**Gap:**

- Backend formatter is text-based; tool-presentation is structured
- No shared definition of family, headline, badges between backend and web
- Slack/Telegram users see tool calls formatted by `tool-formatter.ts`, but Web users see a different presentation
- No mechanism to export the structured presentation contract to the backend package boundary

**Acceptance Evidence Needed:**

- (AC line 1044) "Produces the same semantic family, headline, outcome, and facts as the shared fixture"
- (AC line 1049) "Backend code does not import Web code"
- (AC line 1050) "Fixture parity proves agreement across the boundary"

**Change List:**

1. Create a shared tool-presentation contract module in `packages/workflows/src/lib/` (outside Web) that defines family resolution and headline extraction
2. Move core resolver logic (tier 1–4 family matching, name normalization, Codex wrapper stripping) from Web to shared
3. Update `tool-formatter.ts` to use the shared resolver to extract family, headline, and key facts
4. Create fixture tests that prove Web and backend produce matching semantic data for the same event
5. Backend adapters consume the structured output to format platform-specific text

**Dependency:**

- Blocks on Stories 4.1, 4.2, 4.3 (requires persisted rows with consistent schema)

---

## Epic 5: Show Files Changed and Git Attribution (Stories 5.1–5.2)

### Story 5.1: Show a run-level Files Changed panel

**Status:** **MISSING**

**Current State:**

- No Files Changed panel exists in Node Room, RunStream, or run-detail views
- No API route computes run-level changed files
- No run-scoped git diff or repository snapshot is recorded

**Gap:**

- Story 4.1 must persist file changes as tool rows first
- No API aggregates tool rows by path and attributes them to nodes
- No git-diff helpers compute repository-level changes from node execution boundaries
- Web UI has no component to render a Files Changed panel with node attribution

**Acceptance Evidence Needed:**

- (AC line 1069) "Lists each changed path once in deterministic repository order"
- (AC line 1071) "Shows the known node executions associated with that path"
- (AC line 1074) "Uses repository evidence instead of provider prose or tool names"

**Change List:**

1. Create API route `GET /api/workflows/runs/{runId}/files-changed` that:
   - Queries workflow_node_messages for tool-kind file events
   - Deduplicates paths (same file edited in multiple nodes)
   - Orders by repository structure (git status order)
   - Returns `{ path, nodes: [{ nodeId, nodeOccurrence, outcome }] }`
2. Add a React component `FilesChangedPanel` in Web
3. Mount it as a collapsible disclosure in run details
4. Render empty state when no changes exist

**Dependency:**

- Blocks on Story 4.1 (requires persisted file rows)

---

### Story 5.2: Attribute Git changes to node executions

**Status:** **MISSING**

**Current State:**

- No node execution boundary snapshots are recorded (start/end git state)
- No git diff computation exists to compare node-scoped changes
- No API field links a workflow run to repository evidence

**Gap:**

- Executor does not capture git state before/after each node
- No `git diff` computation across node boundaries
- Attribution relies on tool-row evidence only (incomplete for side effects from scripts or bash)

**Acceptance Evidence Needed:**

- (AC line 1093) "Retains the deterministic repository evidence needed for attribution"
- (AC line 1096) "Server computes the comparison through @archon/git functions"
- (AC line 1099) "Every proven execution is shown in stable order"
- (AC line 1104) "Never guesses from agent text"

**Change List:**

1. Executor captures git snapshot before node execution starts: `(commitHash, workingTreeHash)`
2. Executor captures git snapshot after node execution ends
3. Persist snapshots in workflow_node_checkpoints or a new node_execution_snapshots table
4. API route computes git diffs between node boundaries using `@archon/git` functions
5. Combine persisted tool-row evidence + computed git diffs for complete attribution

**Dependency:**

- Blocks on Story 5.1 (attribution is a refinement of Files Changed panel)

---

## Epic 6: Expose Additional Agent Context (Stories 6.1–6.3)

### Story 6.1: Persist and present agent thinking

**Status:** **PARTIAL**

**Current State:**

- Providers emit thinking events:
  - Codex: `provider.test.ts:150` yields `{ type: 'thinking', content: '...' }`
  - Grok, Devin, Copilot: similar patterns in respective event parsers
- Executor receives these as `MessageChunk` with `type: 'thinking'`
- **But**: thinking is NOT persisted to `workflow_node_messages`; it is not a valid `kind` in the schema

**Gap:**

- `node-message.ts` has no `thinking` kind (only `text`, `tool`, `status`)
- Executor must extend schema to support `thinking` kind
- Logging must exclude thinking content (privacy rule: AC line 1132)

**Acceptance Evidence Needed:**

- (AC line 1124) "Persists a typed node-message row in server sequence order"
- (AC line 1126) "Transcript renders it with the `thinking` role treatment"
- (AC line 1132) "Thinking content is absent from logs"

**Change List:**

1. Add `nodeMessageThinkingPayloadSchema` with `{ content: string }` to `node-message.ts`
2. Add `kind: 'thinking'` to `appendNodeMessageSchema` discriminated union
3. Executor persists thinking events as workflow_node_messages with `kind: 'thinking'`
4. Update logger to exclude thinking payload from event bodies (mask with `[thinking omitted]`)
5. Node Room and RunStream render thinking rows with `role="status"` or similar non-agent treatment
6. Provide a collapsed view (expand to show full thinking)

**Dependency:**

- Independent of other stories in Epic 6

---

### Story 6.2: Persist and present the triggering prompt

**Status:** **MISSING**

**Current State:**

- No prompt persistence exists
- Node execution receives a prompt but does not record what was sent
- No transcript row exists for the initial prompt

**Gap:**

- Schema has no `prompt` kind
- Executor does not capture the exact triggering prompt before sending to provider
- No attribution of actor (user, operator, auto-send, resume) exists

**Acceptance Evidence Needed:**

- (AC line 1148) "Persists the exact prompt with actor, source, turn, and node attribution"
- (AC line 1150) "Assigns transcript order at the server boundary"
- (AC line 1154) "Prompt text is preserved without editorial changes"
- (AC line 1158) "Prompt content is not copied into logs"

**Change List:**

1. Add `nodeMessagePromptPayloadSchema` with `{ text: string, actor: string, source: string, turn: number }` to `node-message.ts`
2. Executor persists the prompt before calling `provider.sendQuery()`
3. Set `actor` to: run starter, operator (if Send now), auto-send, or Resume action
4. Set `source` to: user, workflow, scheduler, operator
5. Node Room/RunStream render as a collapsible row showing actor + source on the label
6. Update logging to mask prompt bodies

**Dependency:**

- Independent of Stories 6.1 and 6.3, but depends on properly structured execution context

---

### Story 6.3: Persist and present advisor notifications

**Status:** **MISSING**

**Current State:**

- Advisory references appear in code (usage-report.ts mentions `scope.kind === 'advisor'`)
- No mechanism exists to accept advisor events into the workflow transcript
- No API or protocol for advisors to send notifications
- No row kind in node-message schema

**Gap:**

- Schema has no `advisor` kind
- No inbound API for advisors to post notifications
- No association of advisor identity and timestamp with the node/turn

**Acceptance Evidence Needed:**

- (AC line 1173) "Persists a typed row with advisor identity and server sequence"
- (AC line 1175) "Associates the row with the correct run, node, and turn context"
- (AC line 1179) "Follows server sequence order" (no floating above later content)
- (AC line 1183) "Advisor notification content is absent from logs"

**Change List:**

1. Add `nodeMessageAdvisorPayloadSchema` with `{ advisor_id: string, message: string, advice_type?: string }` to `node-message.ts`
2. Create API route `POST /api/workflows/runs/{runId}/nodes/{nodeId}/advisor-notification` (authenticated, internal use)
3. Executor or advisor bridge calls this route to persist notifications at the correct sequence position
4. Node Room/RunStream render as a distinct row with advisor identity and message
5. Update logging to mask advisor content

**Dependency:**

- Independent; requires definition of advisor integration protocol

---

## Story 10.4: Use Codex-supported tool status presentation

**Status:** **MISSING**

**Current State:**

- Codex provider has `capabilities.interrupt = false` (packages/providers/src/codex/capabilities.ts:25)
- Codex provider test passes `AbortSignal` in TurnOptions (provider.test.ts:432–439)
- **Stop is NOT implemented for Codex** — the capability flag prevents it from being advertised

**Gap:**

- Executor does not interrupt Codex turns
- No operator message about the interrupted Codex tool exists
- Transcript cannot render an interrupted Codex tool row without exposing an unsupported glyph

**Acceptance Evidence Needed:**

- (AC line 1801) "Executor classifies the turn as operator-interrupted rather than a provider failure"
- (AC line 1806) "Row never uses the interrupted warning glyph"
- (AC line 1808) "Uses only a status presentation supported by Codex evidence"
- (AC line 1815) "They prove turn-level interruption and session continuation separately from tool-row glyph presentation"

**Change List:**

1. Implement Codex Stop via interruptSignal → abort the active turn stream
2. Executor marks turn as operator-interrupted (set `operatorInterrupt` flag before sending signal)
3. Executor classifies result: if Codex reports abort + operator interrupt flag is set, emit interrupted status row
4. Update tool-presentation.ts to check provider capabilities and only use interrupted glyph when the provider proves it (no Codex-specific branch, use capability flag)
5. Set `capabilities.interrupt = true` in Codex after conformance proves the mechanism
6. Codex provider test validates session continuation after interrupt

**Dependency:**

- Blocks on Stories 4.1 and 7.3 (durable queue and executor changes are needed)

---

## Schema and Data Model Gaps

### Node-Message Kind Expansion Required

**Current Schema (node-message.ts):**

```ts
kind: 'text' | 'tool' | 'status';
```

**Needed Additions (blocking Epics 4–6):**

```ts
// Story 4.1: File edits (Codex and others)
| { kind: 'tool', payload: { name, id, input, output, outcome: 'success'|'failed'|'interrupted', ... } }

// Story 6.1: Thinking
| { kind: 'thinking', payload: { content: string, displayable: boolean, ... } }

// Story 6.2: Triggering prompt
| { kind: 'prompt', payload: { text: string, actor: string, source: string, turn: number } }

// Story 6.3: Advisor
| { kind: 'advisor', payload: { advisor_id: string, message: string, advice_type?: string } }

// Story 2.8 (historical): Operator messages
| { kind: 'text', payload: { text: string }, metadata: { origin: 'operator', operator_user_id: string, message_id: string } }
```

**Impacts:**

- Executor routes provider events to the correct kind
- ReadNode models use discriminated union to handle each kind
- Logging masks sensitive kinds (thinking, prompt, advisor)
- Web rendering dispatches on kind to apply correct presentation

---

## API and Routing Gaps

### Required New Routes

1. **`POST /api/workflows/runs/{runId}/files-changed`** (Story 5.1)
   - Returns aggregated file list with node attribution

2. **`POST /api/workflows/runs/{runId}/nodes/{nodeId}/advisor-notification`** (Story 6.3)
   - Internal: advisor posts a notification

3. **`GET /api/workflows/runs/{runId}/nodes/{nodeId}/queue`** (Story 2.9, existing but verify scope)
   - Returns live node queue for cross-tab synchronization

### Modified Routes

- Stop, Send, Withdraw routes (Stories 8.1–8.7) depend on proper Codex capabilities

---

## Web Package Gaps

### Missing or Incomplete Components

1. **tool-presentation.ts Integration**
   - ✅ Exists and is correct
   - ❌ Not wired into RunStream (Story 4.2)
   - ❌ Not wired into Chat (Story 4.3)

2. **RunStream Tool Rendering**
   - ❌ Does not call toolRowPresentation/toolBodyPresentation
   - ❌ Lacks diff rendering for file edits

3. **Chat Tool Call Rendering**
   - ❌ Does not use shared presentation contract
   - ❌ Falls back to raw JSON

4. **FilesChangedPanel**
   - ❌ Does not exist
   - ❌ Requires API integration and git diff computation

5. **Thinking Rendering**
   - ❌ No UI for thinking rows
   - ❌ No collapse/expand for thinking content

6. **Prompt Rendering**
   - ❌ No UI for prompt rows
   - ❌ No actor/source labeling

7. **Advisor Rendering**
   - ❌ No UI for advisor rows
   - ❌ No advisor identity or message styling

---

## Provider Capability Matrix

**Codex Interrupt Status:**

| Capability      | Current | Target (Story 8.4) | Blocker                                          |
| --------------- | ------- | ------------------ | ------------------------------------------------ |
| `interrupt`     | `false` | `true`             | Conformance test + session continuation proof    |
| `softInjection` | N/A     | `false`            | TypeScript SDK does not expose mid-turn delivery |
| `deliveryAck`   | N/A     | `false`            | SDK does not echo message ids                    |

**Other Providers (Stories 8.3–9.4):**

- Claude, Grok, OMP, DeepSeek: Capability flags must be set only after conformance evidence
- Pi, Copilot, Qoder, OpenCode: Adapter-specific Stop mapping required (Stories 9.1–9.4)

---

## Test and Fixture Gaps

### Missing Test Coverage

1. **Cross-surface fixture parity (Story 4.4)**
   - No fixture that renders identical tool events in Web + backend and asserts semantic output matches

2. **Thinking persistence (Story 6.1)**
   - Providers emit thinking; executor must persist it; no test end-to-end

3. **Codex file-change persistence (Story 4.1)**
   - Test must prove: Codex event → persisted tool row → readable presentation

4. **Node message ordering (Story 6.3, 2.13)**
   - Advisor, operator, and thinking rows must not reorder relative to tool calls

5. **Codex interrupt (Story 10.4)**
   - Test proves: Stop → operator interrupt flag → session continuation → tool shows unsupported status or none

---

## Unresolved Questions

1. **Prompt Capture Scope (Story 6.2)**
   - Should the prompt row capture the EXACT text sent to the provider (including systemPrompt prepend)?
   - Or the authored prompt before systemPrompt assembly?
   - **Impact:** Affects attribution accuracy and privacy (systemPrompt may contain sensitive instructions)

2. **Advisor Protocol (Story 6.3)**
   - What entity is an "advisor"? Is it:
     - A human on a separate team reviewing the run in real-time?
     - An automated checker (linter, security scan)?
     - An external system (GitHub, CI)
     - Something else?
   - **Impact:** Determines authentication, authorization, and API contract

3. **Thinking Privacy Rules (Story 6.1)**
   - "Thinking content is absent from logs" — does this apply to:
     - Application logs only?
     - Database audit logs?
     - User-visible error messages?
   - **Impact:** Determines masking scope and implementation location

4. **Codex File-Change Deduplication (Story 4.1)**
   - If Codex emits multiple `file_change` events for the same file (multiple edits in one turn), should they be:
     - One row with a merged diff?
     - Multiple rows (one per event)?
   - **Impact:** Affects deduplication logic in toolBodyPresentation and git attribution

5. **Files Changed Panel Ordering (Story 5.1)**
   - "Deterministic repository order" — does this mean:
     - Git status order (staged, unstaged)?
     - Alphabetical by path?
     - Order by node occurrence (chronological)?
   - **Impact:** Implementation of the Files Changed API aggregation

---

## Dependencies Between Epics

```
Epic 4 (Stories 4.1–4.4)
  ├─ 4.1: Persist Codex file changes
  │  ├─ Blocked by: Schema extension (thinking, prompt, advisor also needed)
  │  └─ Blocks: 4.2, 4.3, 4.4, 5.1
  ├─ 4.2: RunStream presentation
  │  ├─ Blocked by: 4.1
  │  └─ Blocks: 4.4
  ├─ 4.3: Chat presentation
  │  ├─ Blocked by: 4.1
  │  └─ Blocks: 4.4
  └─ 4.4: Backend alignment
     └─ Blocked by: 4.1, 4.2, 4.3

Epic 5 (Stories 5.1–5.2)
  ├─ 5.1: Files Changed panel
  │  ├─ Blocked by: 4.1
  │  └─ Blocks: 5.2
  └─ 5.2: Git attribution
     └─ Blocked by: 5.1

Epic 6 (Stories 6.1–6.3)
  ├─ 6.1: Persist thinking
  │  ├─ Blocked by: Schema extension
  │  └─ Independent of 6.2, 6.3
  ├─ 6.2: Persist prompt
  │  ├─ Blocked by: Schema extension
  │  └─ Independent of 6.1, 6.3
  └─ 6.3: Persist advisor
     ├─ Blocked by: Schema extension + advisor protocol definition
     └─ Independent of 6.1, 6.2

Story 10.4: Codex interrupt
  └─ Blocked by: 4.1 (tool row schema), 7.3 (executor changes), 8.2 (API), full Codex adapter

Critical Path:
  node-message schema → 4.1 → 4.2/4.3/4.4 → 5.1 → 5.2
                  ↓
         (parallel) 6.1, 6.2, 6.3
                  ↓
                 10.4
```

---

## Recommended Prioritization

**Phase 1: Schema Extension (Prerequisite)**

- Extend `node-message.ts` with all needed kinds: file (4.1), thinking (6.1), prompt (6.2), advisor (6.3), and operator (2.8)
- Risk: Low (additive); unblocks all downstream work
- Effort: Small

**Phase 2a: File Persistence (Story 4.1)**

- Codex provider yields tool events instead of system chunks
- Executor persists file changes to workflow_node_messages
- Enables Stories 4.2–4.4, 5.1–5.2
- Effort: Medium

**Phase 2b: Thinking/Prompt/Advisor Persistence (Stories 6.1–6.3)**

- Executor persists thinking, prompt, advisor rows in parallel with Phase 2a
- Can proceed independently (no tool-row dependency)
- Effort: Medium

**Phase 3: Web Presentation (Stories 4.2–4.3)**

- Wire tool-presentation into RunStream and Chat
- Add thinking, prompt, advisor rendering components
- Effort: Medium

**Phase 4: Backend & Files Changed (Stories 4.4, 5.1–5.2)**

- Shared tool-presentation contract in packages/workflows
- Files Changed API and panel
- Git attribution (node snapshots + diffs)
- Effort: High

**Phase 5: Provider Integration (Stories 8.1–8.8, 9.1–9.4, 10.4)**

- Codex and other providers implement Stop via interruptSignal
- Conformance tests + capability declarations
- Effort: High (per provider)

---

## Summary Table

| Story | Component              | Status  | Blocker          | Effort | Risk |
| ----- | ---------------------- | ------- | ---------------- | ------ | ---- |
| 4.1   | Codex file persistence | MISSING | Schema           | M      | M    |
| 4.2   | RunStream presentation | MISSING | 4.1              | M      | L    |
| 4.3   | Chat presentation      | MISSING | 4.1              | M      | L    |
| 4.4   | Backend alignment      | PARTIAL | 4.1              | M      | M    |
| 5.1   | Files Changed panel    | MISSING | 4.1, 5.2 prep    | M      | M    |
| 5.2   | Git attribution        | MISSING | 5.1              | H      | H    |
| 6.1   | Thinking persistence   | PARTIAL | Schema           | M      | L    |
| 6.2   | Prompt persistence     | MISSING | Schema           | M      | L    |
| 6.3   | Advisor persistence    | MISSING | Schema, protocol | M      | H    |
| 10.4  | Codex interrupt        | MISSING | 4.1, 7.3, 8.2    | M      | M    |

---

**Status: DONE**
