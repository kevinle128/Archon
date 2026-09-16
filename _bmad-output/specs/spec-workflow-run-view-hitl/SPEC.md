---
id: SPEC-workflow-run-view-hitl
companions:
  - hitl-contract.md
  - brownfield.md
  - ux-design.md
  - ux-mockup/index.html
  - ux-mockup/console.html
  - ux-mockup/app.js
  - ux-mockup/console-app.js
  - ux-mockup/styles.css
  - ../../planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md
  - ../../project-context.md
sources:
  - ../../planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/.memlog.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. UX design and the five `ux-mockup/` files are required companions for implementation and review. `ux-prototype/` is not the visual authority. Direct mockup-vs-product reference comparison is a story completion condition, not an optional walkthrough. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale this contract intentionally omits. Implementation HOW is the architecture spine (AD-1–AD-9); this kernel is WHAT. Generated OpenAPI types (`packages/web/src/lib/api.generated.d.ts`) are the machine authority for wire fields — do not copy every field into this document.

# Workflow Run View HITL

## Why

Operators watching a live Archon workflow cannot ask an in-flight agent node a structured question, and cannot inspect that node's own transcript — they get a merged run log and a free-text composer. This is a **pain to solve**: mid-turn human-in-the-loop (AskHuman) plus a node-centric run view on both the legacy run screen and the Command Center (`/console`), so a starter can answer an agent without leaving the run, and a teammate can see the same state without being able to submit.

## Capabilities

- **CAP-1**
  - **intent:** An operator can inspect a live or historical run as a node-centric graph and as an unmerged chronological list of node-runs, each as an entry into the same node room.
  - **success:** Clicking a graph node or a Logs row opens that node's room; a loop or `route_loop` iteration appears as its own row; the Logs view is not a merged all-nodes stream; both legacy and console keep this list (graph is additional, not a replacement).

- **CAP-2**
  - **intent:** An operator can open a per-type panel for the selected node and see that node's own history after it finishes, not only while it streams.
  - **success:** `command`/`prompt`/`loop` show an agent room (prose + tool cards); `bash`/`script` show stdout; `approval`/`plannotator_gate` show the declared gate; `workflow` links the child run; `route_loop`/`loop_group` show controller/container chrome; a completed agent node replays the same room as a static transcript.

- **CAP-3**
  - **intent:** An operator can follow a chat-style timeline of their turns plus node-status entries, and see an Ask card inline in the agent room when the agent asks.
  - **success:** Clicking a node-status entry opens that node's room without switching the meaning of the panel; the Ask card appears in the room at the tool invocation, not as free-text in the composer.

- **CAP-4**
  - **intent:** An in-flight agent node can pose structured questions to the run starter mid-turn, and the starter can submit one complete answer set or decline.
  - **success:** A card with one or more questions (single-select, multi-select, Other requiring non-empty text) accepts exactly one POST; Submit stays disabled until every question is valid; Decline delivers a declined payload and the agent decides the node outcome; the node then continues with that payload.

- **CAP-5**
  - **intent:** Several asks can be outstanding at once without inventing a second scheduler.
  - **success:** Two agent nodes (or two asks on one node) show independent cards; a node stays awaiting until every ask on that node is resolved; run-level "awaiting input" clears only when the last pending interaction in the run is resolved; in-flight siblings may finish their current turn; the next DAG layer does not start until the run resumes.

- **CAP-6**
  - **intent:** Only the identity that started the run can answer; everyone else can watch.
  - **success:** A teammate view shows factual "waiting for \<starter\>" copy with no Submit/Decline; a starter-less run never reaches an unanswerable awaiting state (fail when an Ask would be persisted, not at the start of every identity-less CLI run).

- **CAP-7**
  - **intent:** A workflow that requires AskHuman on a provider that cannot ask fails before spending a turn; other runs on those providers still start.
  - **success:** `allowed_tools` naming AskHuman on Codex/Grok/OpenCode/Copilot is rejected at run start with error chrome; the same workflow without that requirement starts and simply has no Ask tool; only Claude and Pi produce Ask in v1.

## Constraints

- Ship **both** legacy `WorkflowExecution` and `/console`. Engine and contract are surface-agnostic; each surface is a thin renderer of the same envelope, states, validity, and copy — not a shared React NodePanel. Console isolation forbids importing production React components; only the sanctioned `packages/web/src/lib/run-graph/` constants and generated API types are shared.
- AskHuman tool invocation is the **only** ask channel. Never classify assistant prose as an ask. A model that asks in prose is an accepted residual. Do not wrap Claude `AskUserQuestion`. Console Reply/composer is not HITL.
- No workflow YAML authoring-language changes.
- Wait indefinitely at an Ask — no timeout, no auto-default, no autonomous lifecycle mutation of non-terminal work.
- Ask form is in scope. Permission is envelope/type-contract only (`kind: permission`, `call_id` ≡ `tool_use_id`, confirm `{ intent }`); variant cards wait for a live activation source.
- Awaiting chrome is warning / "waiting on you", never error. CAP-7 start rejection is the error state.
- Additive-only schema, both SQLite and Postgres. `awaiting` is a node/UI state, not a new run status. Declared gates keep `ApprovalContext`; AskHuman never occupies that slot.
- Console isolation stands except the one sanctioned `packages/web/src/lib/run-graph/` import. Type-only `api.generated.d.ts` is allowed.
- Architecture ADs AD-1–AD-9 in the adopted spine bind implementation. Do not re-decide them in stories.

## Non-goals

- Permission variant cards and a live permission-activation source.
- Per-node independent scheduling (a sibling branch progressing past an Ask while the run stays `running`).
- CLI / chat / `manage_run` answer UX (same REST later).
- Changing `NativeTool.handler` from `Promise<string>`.
- New deploy, env, or infra topology.
- Embedding the Source Control viewer inside the node room.
- General cyclic graph execution, or treating console Reply as a second ask channel.

## Success signal

On a Claude or Pi agent node, the starter sees amber "awaiting input," answers or declines a structured Ask card in the node room on **both** legacy and console, the node continues with that payload, and a teammate watching the same run cannot submit. A Codex run that does not name AskHuman in `allowed_tools` still starts. A Codex run that does name it is rejected at start.

## Assumptions

- Original spec files were missing on disk at this derive; CAP-1–7 IDs and intents were restored from the architecture coaching map and UX mockup session, then aligned to the finalized spine.
- v1 in-process ask channel exists only on Claude and Pi (`capabilities.askHuman`).
- Claude lockfile `0.3.209` and Pi `session.agent.continue()` at `0.80.6` hold until the AD-6 spikes amend the spine.
