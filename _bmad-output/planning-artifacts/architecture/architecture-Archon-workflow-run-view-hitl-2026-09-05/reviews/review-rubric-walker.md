---
review: rubric-walker (bmad-architecture finalize gate)
lens: good-spine checklist
target: ARCHITECTURE-SPINE.md
altitude: feature (→ epics/stories)
date: 2026-09-05
mode: validate-only (spine NOT modified)
lint_spine: ok (0 findings)
verdict: pass-with-fixes
---

# Rubric Walker — Workflow Run View HITL spine

## Verdict

**PASS WITH FIXES.** The spine is the right substrate: ports-and-adapters, the right package split, dedicated pending + transcript tables, run-level pause reuse, no new run status, AskHuman kept off `metadata.approval`, both surfaces as thin renderers. Mechanical lint is clean. It is **not** yet a safe handoff to epics/stories.

Four holes would let two units obey every AD and still ship incompatible v1: (1) `pauseWorkflowRun` today always stamps `metadata.approval`, so AD-2 as written fights AD-1 and the brownfield single-slot gate; (2) the Ask/Permission **wire** (row payload, `answers[]` element, GET that both UIs refetch) is unnamed; (3) AD-5’s CAP-7 gate contradicts the inherited spec (reject ask-capable runs vs proceed-without-tool); (4) CAP-1 “keep Logs” is mapped to AD-4 but AD-4 does not mention Logs, and node `awaiting` is not a specified projection off event-sourced node state.

None of these require a new paradigm. Each needs a tightened AD (or one convention row) before distill-to-epics.

---

## Checklist

### 1. Fixes the real divergence points for the level below — **PARTIAL**

Feature altitude must pin what two epics could choose incompatibly. Covered well:

| Divergence                                                                             | Where pinned |
| -------------------------------------------------------------------------------------- | ------------ |
| Pending HITL not on `metadata.approval` / not inferred from events / no new run status | AD-1, AD-8   |
| Run-level pause, siblings finish, next layer halts, last-pending resume, no timeout    | AD-2         |
| Per-node room not assembled from chat `messages` + `workflow_events`                   | AD-3         |
| One graph layout/routing/taken-path implementation                                     | AD-4         |
| AskHuman owned by `@archon/workflows`, executor-injected, no YAML field                | AD-5         |
| Claude vs Pi resume protocols (not one SDK path)                                       | AD-6         |
| Dedicated events + split REST (ask vs permission)                                      | AD-7         |
| Additive dual-dialect schema, trailing indexes                                         | AD-8         |

Missed forks that epics **will** hit:

- **Pause port vs approval slot** — today’s `IWorkflowStore.pauseWorkflowRun(id, ApprovalContext)` always writes `metadata.approval` (`packages/core/src/db/workflows.ts`). AD-2 says call it; AD-1 says AskHuman never shares that slot. Two stories: optionalize the approval argument vs pass a synthetic `ApprovalContext`.
- **Read/write wire for cards and rooms** — POST paths are named; GET for pending rows and `workflow_node_messages` is not; `pending_interaction` columns beyond the key/`kind`/`status` are not; `answers[]` element type is not. Legacy UI, console, and server can each invent a compatible-looking contract.
- **CAP-7 run-start policy** — inherited spec: ask-capable workflow on Codex/Grok/OpenCode/Copilot **rejected at run start**. AD-5: fail only if `allowed_tools` names `AskHuman`; otherwise those runs proceed without the tool.
- **Node `awaiting` as a chrome value** — brownfield node state is event-sourced (no status column); API `WorkflowNodeState.status` is `pending|running|completed|failed|skipped`. AD-1 adds the enum value; nothing says how GET `nodeStates` becomes `awaiting` (join pending rows vs `node_awaiting` event vs client overlay).
- **Logs tab retained (CAP-1)** — claimed in the capability map under AD-4; AD-4 is graph-only.

### 2. Every AD Rule is enforceable and prevents its stated divergence — **PARTIAL**

`lint_spine.py`: 0 findings (all eight ADs have Binds / Prevents / Rule; IDs monotonic; Stack rows pinned).

| AD   | Prevents                                                                                         | Rule actually prevents it?                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1 | Riding AskHuman on `metadata.approval`; inferring pending from events; new **run** status        | **Engine write path:** yes (new table, IWorkflowStore-only, awaiting not a run status). **Pause path:** no — see AD-2. **UI read path:** weak — UIs are not forbidden from reconstructing cards from `node_awaiting` events on GET `/runs/:id` `events[]`.                                                                                                                       |
| AD-2 | Mid-run re-drive scheduler; mixed `running`+`awaiting` run status; tearing down healthy siblings | Run status stays `paused`: yes. Sibling streaming via `shouldContinueStreamingForStatus`: yes. **Calling `pauseWorkflowRun` as it exists today stamps approval** and so fails AD-1. Last-pending **run** resume is pinned; **node** stays awaiting until **all of that node’s** pending rows resolve (inherited spec) is **not** in the Rule.                                    |
| AD-3 | Two-clock room; stuffing tools into chat `messages`                                              | Writer + “this table only” for the room: yes. Payload JSON per `kind` is unspecified — two transcript writers can still diverge inside the table.                                                                                                                                                                                                                                |
| AD-4 | Two barycenter / port / taken-path impls                                                         | Yes for _where_ the code lives. Public input/output types of `run-graph` are seed-absent; two shells can wrap incompatible graph models if the module epic lags. Isolation restatement omits brownfield bans on `@/stores`, `@/hooks`, `@/contexts`, `@/routes` (console README).                                                                                                |
| AD-5 | Chat-orchestrator injection; workflows→core; new YAML; silent Ask on unsupported providers       | Package ownership + no YAML: yes. **“Silent Ask”:** proceeding without the tool prevents invocation, but it is **not** the inherited fail-loud run-start reject. Branded `handler` throw vs `NativeTool` contract (“handler is expected to return a text result rather than throw”; providers add no safety net) is an un-pinned intercept seam (Claude MCP vs Pi `defineTool`). |
| AD-6 | One resume protocol for both SDKs; mid-run discovery of a non-continuable provider               | Distinct Claude vs Pi paths: yes. Unsupported providers never ask **if** AD-5’s inject gate holds. Exact Claude user-message wrapping of the answer is unspecified (acceptable at this altitude if “payload as the new user message body, verbatim” is added).                                                                                                                   |
| AD-7 | Reusing `approval_pending` / `workflow_status`+`approval`; one conflated endpoint                | Two event names + two POST routes: yes. **Bodies and GETs:** no. `already-resolved → 409` plus “no-op at the store (HTTP 409)” is internally consistent. `request_id = tool_use_id` for Ask is pinned; Permission `call_id` vs table key `tool_use_id` is not.                                                                                                                   |
| AD-8 | `awaiting` on `workflowRunStatusSchema`; indexes beside `CREATE TABLE`; dialect-only tables      | Yes and brownfield-correct (`migrateColumns`, trailing indexes, `check:schema-upgrades`, UI projection `paused` ∧ pending>0).                                                                                                                                                                                                                                                    |

### 3. Nothing under Deferred could let two units diverge — **FAIL (one item)**

| Deferred                                       | Safe?                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-node independent scheduling                | Yes. AD-2 is the v1 rule; this is “don’t build it.”                                                                                                                                                                                                                                                              |
| Permission **variant cards** + live activation | **No, as written.** Cards are deferrable. The **envelope/type-contract is in-scope** (memlog + capability map). Deferred text does not freeze `kind`, `call_id` alias, confirm body `{ intent }`, or shared row payload. Two units can ship incompatible dormant rows/POSTs and still claim cards were deferred. |
| `NativeTool.handler` return type change        | Yes. Branded throw is the v1 path (but see AD-5 intercept seam).                                                                                                                                                                                                                                                 |
| CLI / chat / `manage_run` answer UX            | Yes. “Same REST/store; surfaces after web” binds late surfaces to the web contract — **once that contract is actually specified.**                                                                                                                                                                               |
| New deploy / env / infra                       | Yes. Explicit “rides existing single-tenant install, SSE, additive schema” — operational envelope is decided-by-deferral, not silent.                                                                                                                                                                            |
| Source-control viewer inside the node room     | Yes. “Do not import `/console`”; separate spine.                                                                                                                                                                                                                                                                 |

### 4. Named tech is verified-current — **PASS (workspace-ratified; not web-asserted as latest)**

Stack pins **match the repo manifests** (checked, not guessed):

| Spine                                                     | Manifest                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Bun `^1.3` / TS `^5.3`                                    | root `engines.bun` `^1.3.0`, `typescript` `^5.3.0`                                              |
| Hono `^4.12.16` / `@hono/zod-openapi` `^1.4.0`            | `@archon/server` / `@archon/core`                                                               |
| React `^19` / Vite `^6` / Tailwind v4 / Zustand `^5.0.12` | `@archon/web` (`react` `^19.0.0`, `vite` `^6.0.0`, `tailwindcss` `^4.0.0`, `zustand` `^5.0.12`) |
| `@anthropic-ai/claude-agent-sdk` `^0.3.209`               | root + `@archon/providers`; memlog spike-verified (no `requires_action`)                        |
| `@earendil-works/pi-coding-agent` `^0.80.6`               | `@archon/providers`                                                                             |
| `pg` `^8.11.0`                                            | `@archon/core` / `@archon/server`                                                               |

No new frontend dependency for `run-graph` is consistent with `@dagrejs/dagre` already in `@archon/web`. This pass did **not** npm-check whether those ranges are still upstream-current; they are brownfield pins, not training-data inventions. The versions gate lens owns the registry check.

**Low:** a new `ProviderCapabilities.askHuman` field is not in `scripts/generate-capability-matrix.ts` `AXES` today. CI will fail until an axis is added — AGENTS.md already requires that. Worth one convention sentence so an epic doesn’t treat it as optional docs.

### 5. Ratifies rather than contradicts brownfield Archon — **PARTIAL (one contradiction)**

Ratified correctly:

- Bun + TS monorepo; HITL core in `@archon/workflows`; store impl in `@archon/core`; transport in `@archon/server`; web as renderer; `@archon/web` must not import `@archon/workflows`.
- `IWorkflowStore` / `WorkflowDeps` / `@archon/providers/types` ports; workflows must not import core.
- Additive-only schema, both dialects, trailing indexes, `check:schema-upgrades`.
- Console isolation exception is **one** pure-TS module under `packages/web/src/lib/run-graph/` — matches the spirit of `experiments/console/README.md` (types from `api.generated` only; no production UI / react-query / `@/lib/api` functions).
- No per-node pause today → AD-2 run-level `paused`.
- `metadata.approval` is single-slot → AD-1 dedicated table; declared gates keep `ApprovalContext`.
- `nativeTools` injection is chat-only today → AD-5 executor injects per agent node.
- Pi is prompt+dispose today → AD-6 new `continue()` path.
- OpenAPI routes + Zod in `packages/server/src/routes/schemas/`; web consumes `api.generated.d.ts`.
- `shouldContinueStreamingForStatus`, interactive_loop re-enter without `node_completed`, fail-fast on missing starter identity.

**Contradicts unless AD-2 is tightened:** `pauseWorkflowRun` **requires** `ApprovalContext` and **always** merges `metadata.approval` (resetting gate sub-fields). AskHuman pause cannot call that function as it exists without occupying the single slot AD-1 forbids. Write-back already uses a synthetic `{ type: 'writeback' }` ApprovalContext — that is exactly the anti-pattern AskHuman must not copy.

**Tension, not a contradiction:** `NativeTool.handler: Promise<string>` and the types.ts note that handlers should not throw. AD-5’s branded throw is a deliberate exception; it must say who catches it **outside** the SDK agent loop (executor intercept of the tool invocation, not an uncaught throw inside Claude MCP / Pi).

### 6. Spec capabilities CAP-1..CAP-7 covered — **PARTIAL**

Spec files listed in `sources:` were not readable on disk this pass; coverage is judged from spine map + `.memlog.md` inherited constraints (the memlog is the run authority).

| Capability                               | Mapped?                    | Actually governed?                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-1 Graph + Logs retained              | Yes → AD-4                 | **Graph:** yes. **Logs tab kept on both surfaces:** no AD/convention. Memlog: “KEEP the Logs tab; graph is ADDITIONAL.”                                                                               |
| CAP-2 Per-type node panel / agent room   | AD-3 + taxonomy convention | Taxonomy is explicit enough for v1. Room **read API** missing (see §1).                                                                                                                               |
| CAP-3 Chat timeline + Ask inline in room | AD-3, AD-7                 | Transcript store + cards refetch: directionally yes; card payload + GET missing.                                                                                                                      |
| CAP-4 Ask contract                       | AD-5, AD-6, AD-7           | Tool ownership, pause, split POST, Claude/Pi resume: yes. **Ask form wire** (`answers[]` vs `decline`, question list on the pending row) is named but not shaped. Memlog: Ask form built FULLY.       |
| CAP-5 Concurrency / last-clears          | AD-1, AD-2                 | Run last-pending: yes. Node “awaiting until **all** its asks answered”: not in AD-2. Parent/child: silent (child AskHuman pauses the child run; parent `workflow:` node / tree pause is unspecified). |
| CAP-6 Starter-only answer                | AD-7                       | Yes (`workflow_runs.user_id`, `resolveAuthContext`, fail before awaiting). Fail-at-Ask vs fail-all-runs-with-null-`user_id` should be explicit so CLI runs without identity are not broken.           |
| CAP-7 Unsupported provider               | AD-5                       | **Conflicts with inherited spec** (reject vs proceed-without).                                                                                                                                        |
| Permission envelope (dormant)            | AD-1, AD-7                 | Endpoints split: yes. Envelope fields / `call_id`: no.                                                                                                                                                |

### 7. Every dimension this altitude owns is decided, deferred, or an open question — **PASS with one wire-shaped silence**

Decided or explicitly deferred: paradigm, package boundaries, pause/resume policy, schema dialect rules, auth (starter), provider split, two UI shells + shared graph, logging event names, no new deploy/infra.

**Silent (treat as findings, not as “lean spine”):**

- HTTP **read** model for pending interactions and node messages (extend GET run vs new GETs).
- `pending_interaction` **request** payload (what both UIs render).
- How `nodeState === 'awaiting'` is **projected** for API/UI (no node status column today).
- AskHuman **pause** without stamping `metadata.approval` (store signature change).
- Parent/child tree when the Ask is on a child run.

Not required here: new env vars, new process topology, new cloud provider. The Deferred row already says the feature rides the existing install. Good.

No `## Open Questions` block. Acceptable only after the holes above are closed or explicitly deferred with a revisit condition.

---

## Findings

### F1 — AD-2 + today’s `pauseWorkflowRun` occupy `metadata.approval`

- **Severity:** critical
- **Checklist:** brownfield ratification; AD-2 does not prevent AD-1’s divergence
- **Pair:** Executor epic calls `pauseWorkflowRun(runId, { nodeId, message, type: 'ask' })` (legal if they treat Ask as “a gate”). Store epic refuses to stamp `approval` for AskHuman and adds `pauseWorkflowRun(id)` without context. Declared-gate resume still reads `metadata.approval`. Result: either AskHuman clobbers a live declared gate, or pause no-ops / throws depending on which signature shipped.
- **Autofix:** Tighten AD-2: AskHuman pause sets `status='paused'` **without** writing `metadata.approval`. Extend `IWorkflowStore.pauseWorkflowRun` so `approvalContext` is optional (or add `pauseForInteraction`). Declared gates keep the existing required-context path. AD-1 already says AskHuman never shares the slot — make the store port match.

### F2 — Ask/Permission wire is not a contract (payload, `answers[]`, GET)

- **Severity:** high
- **Checklist:** missed divergence; AD-7 Rule does not prevent the stated “don’t conflate / don’t reconstruct from SSE” split if the REST **resource** is unnamed
- **Pair:** Server epic adds `pending[]` + `nodeMessages[]` onto `GET /api/workflows/runs/:runId`. Console epic implements `GET .../interactions` and `GET .../nodes/:nodeId/messages`. Ask `answers[]` is `string[]` in one OpenAPI body and `{ questionId, value }[]` in the other. Pending row is `{ kind, status, tool_use_id }` only vs `{ prompt, questions, options, session_id, provider }` JSON. Both UIs “refetch REST.” Cards and rooms do not interoperate.
- **Autofix:** One AD-7 (or AD-1) clause that pins: (1) pending row fields both surfaces render (at least `kind`, `status`, `tool_use_id`, request payload / questions, timestamps); (2) Ask POST body `{ answers: string[] } | { decline: true }` or the spec’s exact shape, keyed `request_id = tool_use_id`; (3) Permission `call_id` **is** `tool_use_id` (or a named column); (4) the GET(s) both surfaces refetch — recommend extending run detail **or** two dedicated GETs, pick one; (5) SSE `node_awaiting` / `interaction_resolved` are refetch triggers, not card payloads.

### F3 — AD-5 CAP-7 gate contradicts inherited spec

- **Severity:** high
- **Checklist:** spec coverage; two units diverge on run-start
- **Inherited (memlog):** ask-capable workflow on a provider without an in-process ask channel is **rejected at run start**, fail loud; only Claude + Pi produce Ask in v1.
- **Spine AD-5:** fail loud **iff** `allowed_tools` names AskHuman on `askHuman: false`; other Codex/Grok/OpenCode/Copilot agent runs **proceed without the tool**. Inject by default on capable providers.
- **Pair:** Story A rejects every Codex agent workflow at start (spec). Story B ships Codex runs that simply cannot ask (AD-5 letter). Product and tests disagree.
- **Discuss:** If v1 intent is “Ask is opt-in via the model, unsupported providers just lack the tool,” amend the spec/memlog. If v1 intent is fail-loud for ask-capable definitions, AD-5 must define **ask-capable** (e.g. any `command`/`prompt`/`loop` node, or only when `allowed_tools` includes AskHuman / not denied) and reject those runs on `askHuman: false`. Do not leave both readings live.

### F4 — CAP-1 Logs retained is ungoverned; node `awaiting` projection is unspecified

- **Severity:** high (Logs = spec miss; projection = brownfield + both UIs)
- **Logs pair:** Legacy epic keeps the Logs tab and adds graph as a second entry. Console epic replaces Logs with the graph (“CAP-1 is the graph”). Capability map says AD-4 governs Logs; AD-4 never mentions Logs.
- **Awaiting pair:** Server projects `nodeStates.status` from events only → started-not-completed stays `running` while pending rows exist. Web chrome follows AD-8 (`nodeState === 'awaiting'`) and never lights. Other epic joins `pending_interactions` in the GET projector. Same run, two chromes.
- **Autofix:** Convention or AD-4 sentence: both surfaces **keep** the Logs tab; graph is additional. AD-1/AD-8: `nodeStates.status === 'awaiting'` iff that node has `pending` rows (and no `node_completed`); projector joins the pending table (or requires `node_awaiting` and defines the fold). No new node status **column**.

### F5 — Dormant Permission envelope can still fork (Deferred leak)

- **Severity:** medium
- **Checklist:** Deferred must not hide in-scope v1
- **Pair:** Envelope `kind: 'permission'` stored under `tool_use_id`; confirm route uses `call_id` as a different string. CAS never matches. Dormant contract is already broken before cards exist.
- **Autofix:** Pin `call_id ≡ tool_use_id` (or add the column now). Pin confirm body `{ intent }` as a string union or opaque string. Leave **variant cards** deferred.

---

## Additional (medium / low)

- **M1 — Node “all asks answered” not in AD-2.** Inherited: node awaiting until every pending row for that node resolves; run clears on last row in the run. Run side is in AD-2; node side is not. Tightening AD-2 with one sentence closes it.
- **M2 — CAP-6 fail timing.** “Fails before awaiting” allows fail-at-run-start (breaks identity-less CLI) or fail-at-AskHuman. Pin: only when an Ask would be persisted; other runs with null `user_id` unchanged.
- **M3 — Transcript `payload` shape.** AD-3 `kind: text | tool | status` without payload schema. Minimum: `text` → `{ text }`; `tool` → `{ name, id, input?, output? }`; `status` → `{ state, detail? }` — or “opaque JSON, room renderer owned by one epic.”
- **M4 — `run-graph` public API.** Name the functions/types (layout input = nodes + taken-path events; output = positions + edge routes) so legacy and console shells cannot fork the module’s contract.
- **M5 — Console isolation restatement incomplete.** Repeat the brownfield ban list: no `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, `@/lib/api` functions; type-only `@/lib/api.generated` allowed; **plus** `lib/run-graph`.
- **M6 — Child-run AskHuman.** Silent whether a paused child (Ask) uses existing child-gate parent pause or only the child run shows awaiting. One sentence: child’s pending rows live on the **child** run id; parent follows existing `workflow:` child-paused behavior; answer the child, not the parent.
- **M7 — Branded throw vs NativeTool.** AD-5 should say: intercept is at **tool invocation** (spike); the executor aborts `sendQuery` after persist; provider adapters must not swallow the branded error as a normal tool failure string.
- **L1 — `generate:capability-matrix`.** New `askHuman` axis required; CI already enforces. One conventions row.
- **L2 — IWorkflowStore method names** for pending CAS + transcript append/list. Seed can stay thin if F2’s GET/POST are pinned; otherwise two store-adapter stories rename the port.

---

## What is already good (do not reopen)

- Ports-and-adapters mapping to `@archon/workflows` / core / server / two web adapters.
- No new run status; run chrome = `paused` + pending count.
- AskHuman never reuses `ApprovalContext` **as intent** (needs F1 to make it true in code).
- Durable teardown: persist pending, no in-memory promise, no `node_completed`, recover half-committed, resume failure fails the node and keeps the answer, wait indefinitely.
- Split typed responses (ask vs permission) and separate endpoints — once bodies exist.
- Additive schema + parity + `check:schema-upgrades`.
- Claude vs Pi resume split; same-process seamless = optimization.
- Operational envelope explicitly rides the current single-tenant install (not a silent infra grab).
- Mechanical integrity (`lint_spine.py` ok).

## Disposition

| ID    | Action                                                    |
| ----- | --------------------------------------------------------- |
| F1    | Autofix in spine (AD-2 store signature)                   |
| F2    | Autofix in spine (AD-7 / AD-1 wire)                       |
| F3    | Discuss — spec vs AD-5; then one Rule                     |
| F4    | Autofix (Logs convention + awaiting projection)           |
| F5    | Autofix (envelope ids); cards stay Deferred               |
| M1–M7 | Autofix as one-liners in AD-2 / AD-3 / AD-4 / AD-5 / AD-7 |
| L1–L2 | Optional convention rows                                  |

After F1–F5, the spine is a valid feature→epic contract. Until then: **do not treat `status: draft` as ready to finalize.**
