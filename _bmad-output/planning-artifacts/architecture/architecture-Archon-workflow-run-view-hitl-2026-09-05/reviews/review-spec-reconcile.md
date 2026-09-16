---
type: spec-reconcile
spine: ARCHITECTURE-SPINE.md
scope: Workflow run view HITL (CAP-1–7; Permission envelope only)
method: Diff every load-bearing CAP / constraint / tone / contract from spec + UX against AD-1–AD-8, Consistency Conventions, Deferred, and the Capability map. Spine was not edited.
date: 2026-09-05
inputs_on_disk: missing
---

# Reconcile — HITL spec vs ARCHITECTURE-SPINE

**Spine:** `architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`  
**Reviewed:** 2026-09-05  
**Method:** Diff every load-bearing constraint / tone / capability / contract against AD-1–AD-8, Consistency Conventions, Deferred, and the Capability map. Spine was **not** edited.

**Input provenance.** At reconcile time these files were **not on disk** (`_bmad-output/specs/` contained only `spec-route-loop-routing/`):

- `spec-workflow-run-view-hitl/SPEC.md`
- `spec-workflow-run-view-hitl/hitl-contract.md`
- `spec-workflow-run-view-hitl/ux-design.md`

Reconcile is against:

1. Architecture memlog **INHERITED spec** constraints (complete, logged 2026-09-05 before distill).
2. Captured CAP IDs from spec/UX work (user hand-off).
3. UX recoveries from the create-ux / mockup session ([HITL UX + architecture](a487bd9d-ac63-4307-b175-09e9b3c98a2b)): Direction A, awaiting-as-amber, Ask Other, teammate copy, Logs = unmerged node-run history, shared panel across tabs, Surface Fit “one contract, one panel family, two layouts.”

If the spec package is restored later, re-run this lens against the live files — especially `hitl-contract.md` question payload shape, which is the one place this note is inferring from CAP-4’s name plus UX rather than a recovered contract excerpt.

---

## Inputs checked

| Input                                       | Role                                                                                                                                                | How read                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Memlog INHERITED spec (11 constraint lines) | Envelope, dual surface, Ask vs Permission, NL-not-wire, durable teardown, starter auth, wait-forever, CAP-7 gate, node taxonomy, Logs kept, no YAML | `.memlog.md` on disk                  |
| CAP-1–7 + quiet pins (user hand-off)        | Capability coverage checklist                                                                                                                       | Hand-off list                         |
| UX (`ux-design.md` + Surface Fit)           | Tone, Logs IA, shared panel, Ask Other, teammate chrome, console fit                                                                                | Transcript recovery; files missing    |
| `hitl-contract.md`                          | Ask payload / Other / decline / keys                                                                                                                | Missing; inferred from memlog + CAP-4 |

---

## What DID land (summary — not gaps)

| Input load-bearing                                                                                                                                                           | Spine home                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| One `pending_interaction` envelope; responses split (`answers[]`\|`decline` vs `confirm(intent)`); separate endpoints                                                        | AD-1, AD-7, Envelope convention     |
| Both surfaces; HITL core surface-agnostic; console isolation (no production UI / react-query / `@/lib/api` imports)                                                          | Paradigm, AD-4 exception            |
| Ask built; Permission envelope/type-contract only, cards deferred                                                                                                            | Deferred “Permission variant cards” |
| Durable teardown: persist pending atomically with turn teardown; no in-memory promise; purge on cancel/fail; half-committed recover; resume failure fails node, keeps answer | AD-2                                |
| Claude: end turn, resume as **new user message** (no tool re-issue). Pi: `continue()` + `ToolResultMessage`. Same-process seamless = optimization                            | AD-6                                |
| Wait indefinitely; no timeout / auto-default; no autonomous lifecycle mutation                                                                                               | AD-2                                |
| First answer wins; already-resolved → 409; late submit no-op at store                                                                                                        | AD-7                                |
| Starter-only mutate; missing `workflow_runs.user_id` fails **before** awaiting                                                                                               | AD-7, Auth convention               |
| Teammate views read-only                                                                                                                                                     | Auth convention                     |
| `awaiting` is node/UI only; run stays `paused`; chrome = `paused` AND pending > 0                                                                                            | AD-1, AD-8                          |
| N concurrent pending; run resumes when **last** pending row for the run resolves                                                                                             | AD-2 (run-level last-clears)        |
| AskHuman owned by `@archon/workflows`; executor injects; no YAML authoring change                                                                                            | AD-5                                |
| `askHuman` capability; Claude + Pi only in v1; providers only register                                                                                                       | AD-5                                |
| Additive schema both dialects; indexes in trailing section                                                                                                                   | AD-8                                |
| Dedicated events `node_awaiting` / `interaction_resolved`; REST refetch, not SSE-buffer reconstruction                                                                       | AD-7                                |
| Per-node transcript table; do not assemble room from `messages` + `workflow_events`                                                                                          | AD-3                                |
| Shared pure-TS `run-graph` module                                                                                                                                            | AD-4                                |
| Node taxonomy (agent room = `command`/`prompt`/`loop` only; others as listed)                                                                                                | Node taxonomy convention            |
| Claude MCP tool name `mcp__archon__AskHuman`; SDK pin `^0.3.209`                                                                                                             | Conventions + Stack                 |
| Decline delivers `"declined"`; **agent** decides node outcome                                                                                                                | AD-7                                |
| CLI / chat / `manage_run` answer UX after web                                                                                                                                | Deferred                            |
| Per-node independent scheduling                                                                                                                                              | Deferred                            |

CAP map claims CAP-1–7 are bound. Mechanism for 2–6 is mostly present. Quiet product constraints and two capability **meanings** (CAP-1 Logs content, CAP-7 fail-loud scope) did not survive distill. Those are the holes below.

---

## What did NOT land (dropped / diluted)

### 1. Quiet constraint — NL is not a wire format (AskHuman is the only ask channel) — **MATERIAL → AD**

**Source:** memlog INHERITED spec:

> AskHuman tool is the MANDATED ask channel (system-prompt + tool-description); NEVER prose-sniffing (NL is not a wire format); prose-ask residual risk accepted

Plus AGENTS.md _Natural Language Is Not a Wire Format_ (no regex/keyword reconstruction of intent; do not treat “any assistant question in the stream means pause”).

**Spine:** AD-5 says inject AskHuman by default, “the model decides when to ask,” no YAML field. It never forbids classifying assistant prose as an ask, never requires the system-prompt + tool-description pair as the **only** channel, and never records that a model asking in prose is an **accepted residual** (do not build a detector).

**Why it matters:** Two units can both “implement AskHuman” and still diverge: one pauses only on the tool invocation (correct); the other adds a “looks like a question” classifier on streamed text (constitutional violation). The residual-risk clause exists to stop that second unit — and it is absent from every AD, convention, and Deferred row.

**Recommend:** New AD (or AD-5 clause): AskHuman tool invocation is the sole awaiting trigger. No prose sniffing, no `until:`-style sentinel, no chat-orchestrator injection of AskHuman. Residual prose-asks are not engine-visible. Prompt/description copy is how the model is taught to use the tool.

---

### 2. CAP-7 silently narrowed (run-start fail-loud vs proceed-without-tool) — **MATERIAL → AD-5 tighten**

**Source:** memlog INHERITED spec:

> run-start capability gate - ask-capable workflow on provider without in-process ask channel (Codex/Grok/OpenCode/Copilot v1) REJECTED at run start, fail loud; only Claude + Pi produce Ask in v1

Captured CAP-7: “Unsupported provider fail-loud.” UX: run-start overlay “Run rejected at start — HITL not supported.”

**Spine AD-5:**

> Run-start **fails loud** if `allowed_tools` names AskHuman on a provider with `askHuman: false`. Other Codex/Grok/OpenCode/Copilot agent runs proceed **without** the tool.

Capability map still says CAP-7 is “governed by AD-5,” so the narrowing is invisible.

**Why it matters:** “Ask-capable workflow” vs “YAML named the tool” is the whole gate. Unit A rejects any Codex/Grok/OpenCode/Copilot **agent-node** run (spec/UX). Unit B only rejects when `allowed_tools` lists AskHuman; every other Codex run ships without HITL (current AD-5 letter). Both claim CAP-7. Operators see either a hard start failure or a silent missing tool.

**Recommend:** Tighten AD-5 to one sentence that **chooses**: (A) restore spec — any agent-node run on `askHuman: false` fails at start; or (B) ratify the narrowing — fail only on explicit `allowed_tools: [AskHuman]` (or equivalent), otherwise proceed without the tool, and drop “ask-capable workflow rejected” from the CAP-7 gloss. Do not leave both readings AD-compliant.

---

### 3. CAP-4 Ask contract body — questions[], Other, validity — **MATERIAL → convention or AD-7**

**Source:** captured CAP-4 “Ask contract (questions, Other, decline)”; memlog `ask.answer(answers[]|decline)` keyed `request_id`; UX: single-select + **Other** (required when picked), multi-select, Submit disabled until every question is valid, Decline.

**Spine:** AD-7 names the HTTP body as `answers[] | decline` and CAS first-wins. No question list, no `allow_other` / Other free-text rule, no client validity (Submit disabled), no “one Submit answers all questions on the card.”

**Why it matters:** Envelope + endpoint can land while two UIs (and the NativeTool schema) disagree on whether Other exists, whether it is required, and whether a partial `answers[]` is legal. That is exactly the hitl-contract’s job, and it did not make the spine.

**Recommend:** Consistency row (or AD-7 clause) pinning: tool input = ordered `questions[]` with single vs multi; Other is a first-class option that requires non-empty free text when selected; client Submit stays disabled until every question is valid; one POST answers the whole card. Point at `hitl-contract.md` as the payload SoT if the file is restored.

---

### 4. CAP-1 Logs content + shared node panel IA — **MATERIAL → convention**

**Source:** memlog:

> KEEP the Logs tab; graph is an ADDITIONAL per-node log-history entry point (both surfaces)

UX (user-finalized, then Surface Fit): Logs = chronological **node-run** rows (loop / `route_loop` iterations are separate rows); **no merged stream**; Graph / Logs / Chat (legacy) and Log / Graph (console) are entry points into **one** shared NodePanel (close with X). Graph is additional, not a Logs replacement.

**Spine:** CAP-1 map = “`run-graph` + both shells / AD-4.” AD-4 owns layout/edges/taken-path only. AD-3 owns the transcript table (per `node_id`, `seq`) but not the Logs **tab** as an unmerged run-history list, not “graph is additional,” and not the shared-panel IA.

**Why it matters:** Unit A keeps today’s merged Logs stream and treats the graph as the only per-node lens (CAP-1 “retained” in the letter). Unit B implements the UX list + shared panel. Both satisfy AD-4. Console vs legacy also fork: spine says each surface owns its React shell; UX said “same panel component.”

**Recommend:** Convention (CAP-1): Logs/log-history is unmerged node-**run** rows (iteration = its own row); graph click is an additional entry into the same room; one panel instance per surface, openable from every run-view entry point. Shared **React** NodePanel across legacy and console stays forbidden (AD-4 isolation) — see #7.

---

### 5. Quiet tone — `awaiting` is waiting-on-you, not an error — **MATERIAL → convention**

**Source:** UX finalize: `awaiting` is first-class, amber (`--awaiting` alias `--warning`), slow pulse — “amber means waiting on you, not an error.” Run chrome “awaiting input” / “Waiting on you.” CAP-7 start rejection **is** error chrome (“Run rejected at start”). Teammate: factual “Waiting for \<starter\> to answer — only the identity that started the run can respond.”

**Spine:** AD-8 defines the projection (`paused` + pending > 0). No tone, no color semantics, no “do not use `--error` / destructive copy for awaiting.” Auth convention says teammates are read-only — not the copy.

**Why it matters:** Same class of silent loss as source-control Voice & Tone. Implementers default awaiting to paused-error / approval-alarm chrome. CAP-7 overlay then looks like awaiting, or awaiting looks like CAP-7.

**Recommend:** Consistency row: awaiting chrome is warning/awaiting tokens, never error/destructive; copy is “waiting on you” / “awaiting input”; CAP-7 start failure is the error state. Teammate note is factual, names the starter, no Submit/Decline.

---

### 6. Idempotency / concurrency identity diluted (`sessionId`; node ALL-asks) — **MATERIAL → AD-1 / AD-2 tighten**

**Source:** memlog:

> idempotent keyed (sessionId, tool_use_id); first answer wins  
> card keyed (nodeId, tool_use_id), node awaiting until ALL its asks answered, run-level awaiting clears when LAST node resolves

Captured: “Idempotent (sessionId, tool_use_id), first answer wins”; CAP-5 “N asks, last-clears.”

**Spine:** Table key `(workflow_run_id, node_id, tool_use_id)`; card identity `(nodeId, tool_use_id)`; `request_id = tool_use_id`. **`sessionId` is not in the identity.** AD-2 states run-level last-clears only. Node “awaiting until every ask on **that** node is answered” is implied by pending rows, not stated — a node could be marked completed / re-entered when its first ask resolves while a sibling ask on the same node is still pending.

**Why it matters:** Resume re-issues a provider session. If identity ignores `sessionId`, a recycled `tool_use_id` after session restore can CAS-collide with a prior answer (late 409 / wrong first-wins). If node state flips off `awaiting` on the first of N asks, the room and graph lie while a card is still live.

**Recommend:** Tighten AD-1/AD-2: durable identity includes `sessionId` (store column or composite with `tool_use_id` as AD-7 `request_id` still unique per in-flight ask). A node stays `awaiting` until **all** pending rows for `(run, node)` are resolved; the **run** resumes only when the last pending row in the run is gone (already AD-2).

---

### 7. “Unified render” vs console isolation — **MATERIAL → convention**

**Source:** memlog: “ONE pending_interaction envelope … unified render.” UX Surface Fit: “one contract, **one panel family**, two layouts” — same NodePanel component docked on console.

**Spine:** Paradigm = thin renderers of one contract. AD-4 = the **one** sanctioned shared import is `lib/run-graph/` (no React). Console must not import production UI components. Structural seed: “legacy shells + node room” vs “log-first shells.” No rule that Ask-card states, Other validity, teammate chrome, or decline copy stay aligned.

**Why it matters:** UX’s “same panel component” contradicts AD-4 if taken literally. Without a substitute convention, legacy and console independently invent card trees that share only the REST body — the exact surface fork the spec forbade.

**Recommend:** Convention: unified render = same envelope, states, validity, and copy — **not** one React module. Each surface implements its own shell (AD-4). Shared types come from `api.generated.d.ts` / engine Zod only. Do not import `@/components/workflows` into `/console`.

---

## Quiet-requirement callout (for hand-off)

The AD structure is strong on **mechanism** (store, pause, inject, resume protocols, additive schema) and weak on **operator-facing and constitutional quiet constraints**:

1. **Channel:** tool invocation only; never sniff prose; residual prose-ask accepted.
2. **Tone:** awaiting is waiting, not failure; CAP-7 start reject is the error.
3. **CAP-7 scope:** spec fail-loud vs spine proceed-without-tool — pick one in AD-5.
4. **CAP-1 Logs / panel IA:** keep the tab as unmerged node-run history; graph is an extra door; one panel per surface.

Those four are the highest-risk silent losses if the spine is treated as the sole build substrate.

---

## Capability coverage (one line each)

| CAP                                                          | Spine                           | Verdict                                                                |
| ------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------- |
| CAP-1 Graph + Logs retained; graph additional per-node entry | AD-4 graph module only          | **Partial** — Logs content + shared-panel IA dropped (#4)              |
| CAP-2 Per-type node panel / agent room                       | AD-3 + taxonomy                 | Landed (shells per surface; see #7)                                    |
| CAP-3 Chat timeline + Ask inline in room                     | AD-3, AD-7                      | Landed (console has no Chat view — UX Surface Fit already scoped that) |
| CAP-4 Ask contract (questions, Other, decline)               | AD-5/6/7 `answers[]`\|`decline` | **Partial** — Other / questions / validity dropped (#3)                |
| CAP-5 Concurrency N asks, last-clears                        | AD-1, AD-2 run last-clears      | **Partial** — node ALL-asks + `sessionId` dropped (#6)                 |
| CAP-6 Starter-only                                           | AD-7 + Auth convention          | Landed (teammate **copy** is tone, #5)                                 |
| CAP-7 Unsupported provider fail-loud                         | AD-5 `allowed_tools` only       | **Diluted** (#2)                                                       |
| Permission envelope dormant                                  | Deferred                        | Landed                                                                 |
| No YAML authoring changes                                    | AD-5                            | Landed                                                                 |
| NL is not a wire format                                      | —                               | **Dropped** (#1)                                                       |
| Wait indefinitely                                            | AD-2                            | Landed                                                                 |
| Idempotent first-wins                                        | AD-7 CAS                        | **Partial** — `sessionId` dropped (#6)                                 |

---

## Minor / intentional dilutions (not in the top-7 list)

| Item                                                     | Source                   | Spine treatment                                 | Verdict                                                                                 |
| -------------------------------------------------------- | ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| “Synthetic result needs no scrubbing” (Claude)           | memlog spike             | AD-6: new user message, no tool re-issue        | Implied — OK                                                                            |
| System-prompt + tool-description copy                    | memlog                   | Silent                                          | Folds into #1                                                                           |
| Claude SDK `requires_action` never fires                 | memlog / convention pin  | Convention + AD-6 intercept tool invocation     | Landed                                                                                  |
| Console Reply… as free-text **fallback** beside Ask card | UX Surface Fit           | Silent                                          | Soft — risk of treating Reply as a second ask channel; folds into #1 if anyone wires it |
| Source-control viewer reuse inside the node room         | UX COULD                 | Deferred                                        | Landed                                                                                  |
| Transcript `seq` has no `iteration` column               | UX one-row-per-iteration | AD-3 seq per `(run, node)` can order iterations | Soft — Logs IA (#4) must not invent a second store                                      |

---

## Recommendation (notes only — spine untouched)

If a follow-up AD pass is authorized, prefer:

- **AD-9 (Ask channel):** tool invocation only; no prose-sniffing; residual risk accepted.
- **AD-5 tighten:** one CAP-7 gate (reject-all-unsupported vs `allowed_tools`-only).
- **AD-1/AD-2 tighten:** `sessionId` in identity; node stays awaiting until all of its pending rows resolve.
- **Conventions:** Ask Other/validity; Logs = unmerged node-run history + shared panel IA; awaiting tone; unified render = envelope not a shared React panel.

Do not fold tone into CAP-6. Do not treat CAP-1 as “AD-4 exists.”

---

## Dropped items — short list (max 7 → AD / convention / Deferred)

1. **AD** — NL is not a wire format: AskHuman tool is the only ask channel; never prose-sniff; residual prose-ask accepted.
2. **AD-5 tighten** — CAP-7: pick spec fail-loud (ask-capable run on unsupported provider rejected at start) **or** ratify `allowed_tools`-only; current letter is the latter while the map still claims the former.
3. **Convention / AD-7** — Ask contract body: `questions[]`, Other required-when-picked, Submit validity, one POST per card.
4. **Convention** — CAP-1: Logs/log-history = unmerged node-run rows; graph is an additional entry; one panel instance per surface from every entry point.
5. **Convention** — Awaiting tone: warning/waiting-on-you, never error chrome; CAP-7 start reject is the error state; teammate copy is factual.
6. **AD-1 / AD-2 tighten** — Idempotency includes `sessionId`; node stays `awaiting` until **all** of its asks resolve (run last-clears already stated).
7. **Convention** — Unified render = same envelope/states/copy, not a shared React NodePanel (console isolation / AD-4).
