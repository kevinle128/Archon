# Repository evidence report — issue #179 / Story 1.6

Re-verified 2026-09-18 from the repository at `01ece7f65a69`, installed dependency sources, current GitHub issue state, and the working tree. This report records evidence for the revised plan; it is not product authority.

## Goal and issue state

- GitHub issue #179 is open and asks to ship ANR Story 1.6, record focused evidence, and move its sprint key to done. Its only declared dependency is Story 1.1 / issue #174, which is closed and shipped in PR #197.
- Story 1.2 / issue #175 and Story 1.3 / issue #176 are open. Neither is a declared blocker for 1.6.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` currently marks `1-6-inspect-a-subagent-dispatch-and-its-subtasks` as `backlog`.
- GitHub's canonical issue URL is `https://github.com/kevinle128/Archon/issues/179` (the draft used the workspace fork/redirect URL).

## Product and design authority inspected

| Evidence                                                                               | Material finding                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`, Story 1.6 and FR map | OMP and Claude normalize to `TaskSubtask[]`; context is markdown; one collapsible card per subtask; malformed data uses a safe generic body. Story 1.6 owns CAP-4 and depends only on 1.1.                                                                                                                                                      |
| `_bmad-output/specs/spec-agent-node-room/SPEC.md`, CAP-4                               | Same user outcome; canonical spec points to the contract, test plan, UX, and architecture companions.                                                                                                                                                                                                                                           |
| `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`                | `TaskSubtask` is exactly `{name, agent, prompt}`; task body is context plus subtasks; generic body is bounded key/value fields; OMP is batch and Claude is one card.                                                                                                                                                                            |
| `_bmad-output/specs/spec-agent-node-room/test-plan.md`, CAP-4                          | Required focused cases: OMP two-task/context, Claude with agent, Claude without `subagent_type`.                                                                                                                                                                                                                                                |
| `.../ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`                               | Collapsed badges include `1 subagent`/`2 subagents`; task body facts are `batch · N subtasks` or `single dispatch`; droppable runtime facts remain available in the body bar; cards expose the delegated prompt but no per-card outcome; reference widths are 460px Legacy and 520px Console, and the transcript owns no additional breakpoint. |
| `.../ux-Archon-agent-node-room-2026-09-09/DESIGN.md`                                   | Card tokens/anatomy, nested `<details>`, full prompt inset, 120ms chevron, focus/target rules, and typography. The component-specific rule says the subtask name is bold.                                                                                                                                                                       |
| `.../mockups/key-transcript-states.html`, task section                                 | Confirms row counts, exact body-bar copy, context position, card order, agent/name/excerpt anatomy, and both batch/single states.                                                                                                                                                                                                               |
| `.../ARCHITECTURE-SPINE.md`, AD-1/2/3/8/10/14                                          | One render-neutral interpretation in `lib/`; Console isolation; total/terminating projection; no renderer parsing; core owns displayed text channels.                                                                                                                                                                                           |

All five co-located mockups were searched. `full-transcript-review.html` repeats both expanded task shapes; `key-console-node-room.html` and `key-legacy-node-room.html` confirm the collapsed task/count states on their respective surfaces; `key-steering-dock.html` contains no task-body requirement. No additional conflicting task state was found.

Resolved design inconsistencies: DESIGN's earlier general sentence says only the agent is semibold and everything else regular, while its later component-specific rule and the reviewed mockup make the subtask name bold; the more specific rule is used. The mockup shows a one-line context, while the acceptance criterion requires markdown; markdown semantics win and compact styling controls density. The task mockups omit runtime duration from the body bar, while EXPERIENCE and AD-10/AD-14 require any fact dropped under width pressure to reappear there; task-specific facts therefore lead and applicable runtime facts follow once.

## Current implementation inspected

### Shared projection

- `packages/web/src/lib/tool-presentation.ts` is React-free. Its shipped `ToolPresentation` is explicitly the Story 1.1 row subset and has no body.
- Task aliases are already classified. `taskHeadline()` prefers Claude description, then the first OMP task name, then context.
- `toolPresentation()` catches resolution errors and returns a generic row. Existing helpers bound aliases, headline sources, generic headline scans, and count scans.
- `toolRowPresentation()` combines content badges with runtime state/exit/output/duration facts. There is no separate body-bar text channel.
- `packages/web/src/lib/agent-history.ts` passes name/input/output into `toolRowPresentation()` and stores the result on each tool item; no new production plumbing is expected.

### Legacy and Console shells

- `packages/web/src/components/workflows/NodeRoom.tsx` and `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` have parallel local `ToolHistory` implementations.
- Both currently build the body bar from `presentation.family` plus the collapsed badge list. That cannot produce the required `batch · N subtasks` / `single dispatch` copy and would incorrectly repeat duration/count facts for task bodies.
- Both render temporary nested Input/Output disclosures, full-output loading, and retry behavior. Both outer `<details>` handlers ignore nested toggle events with `event.target !== event.currentTarget`; that guard is required for subtask cards.
- Both have an established `react-markdown` + GFM/breaks/highlight stack. Neither enables raw HTML. A task-context-specific image override is still needed to prevent image requests.
- Console has two mounts: the selected room and `ConsoleExecutionHistory`. Its isolation test forbids `@/components/*` and `@/lib/api`; shared `packages/web/src/lib` is allowed.

### Test topology

- `packages/web/package.json` deliberately runs `src/lib`, component, and Console tests in separate Bun processes to avoid mock pollution.
- `NodeRoom.test.tsx` supplies static markup assertions. `LegacyNodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx` already exercise controlled disclosure state, nested toggles, identity reset, polling, and happy-dom keyboard workarounds. `ConsoleExecutionHistory.test.tsx` covers the second Console mount.
- Root `bun test` is forbidden; `bun run test` preserves package isolation.

## Provider-shape evidence

| Shape         | Evidence                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude single | Pinned `@anthropic-ai/claude-agent-sdk` 0.3.209 in Bun's installed cache declares `AgentInput.description: string`, `prompt: string`, and optional `subagent_type`. A missing description is therefore malformed, contrary to the original plan's empty-name fallback.                                         |
| OMP batch     | Canonical contract specifies `{context, tasks:[{name,agent,task}]}`; `plans/260909-2130-live-interactive-agent-view/findings.md` contains a real stored payload with that shape; `packages/providers/src/community/omp/session-usage.test.ts` constructs the same task array and proves context may be absent. |

OMP is resolved as an external binary by `packages/providers/src/community/omp/binary-resolver.ts`; there is no pinned OMP TypeScript declaration to inspect. The plan therefore treats the canonical/stored/tested shape as supported and routes unknown future shapes to generic fallback.

## Full-stack verification seam

- `packages/providers/src/e2e-fake/provider.ts` is env-gated and currently has a strict scenario schema whose `emitTool` branch emits only a deterministic `Read` call.
- `e2e/fixtures/workflows/e2e-hitl-run.yaml`, `e2e/lib/playwright/archon-runtime.ts`, and the `workflow-run-hitl`/`agent-tool-row-visual` specs prove the full path: isolated temp `ARCHON_HOME`, SQLite, real executor/message persistence, built web app, both UI shells, owned process cleanup, screenshots, AX checks, contrast, responsive viewports, and 200% zoom.
- The original plan rejected E2E and proposed a credential-dependent run or static HTML. Extending the test-only fake scenario and adding a dedicated workflow is smaller, deterministic, and proves the actual product path without real credentials or database surgery.
- The E2E package is standalone npm, not a Bun workspace member. It requires `bun run build:web`, `npm run typecheck`, and its focused Playwright command in addition to `bun run validate`.

## Important defects found in the draft

1. It redefined “safe generic body” as no body. This directly contradicted Story 1.6 and AD-3.
2. It explicitly deferred the accepted body-bar wording and planned `task · N subagents`; both UX spines and the mockup require batch/single facts.
3. It accepted Claude without `description`, contrary to the pinned SDK, and weakened required OMP agents to null without evidence.
4. It partially rendered malformed/oversized batches, added `dropped`/`unscanned` fields and warning copy absent from every contract, and counted hidden entries as subagents.
5. It truncated the prompt/context while promising the full prompt. That silently changed stored meaning.
6. It added `excerpt` to canonical `TaskSubtask` instead of keeping the three-field normal form and deriving display metadata through one shared helper.
7. It omitted the generic arm because Story 1.3 owns general family bodies, even though Story 1.6 independently requires that arm for its own malformed path.
8. It relied on a sibling plan's “bar-only” interim decision as authority over this story's acceptance criteria.
9. It ruled out deterministic E2E even though the existing env-gated fake provider is the intended test seam.
10. Its provider “preflight” was deferred even though the pinned Claude declarations and real/test OMP payload evidence are available now.
11. Its closeout targeted a hard-coded branch name despite conflicting written guidance. The remote's current HEAD/integration branch is `develop`, while the injected repository rules say `dev`; the revised plan requires verifying the current integration target at implementation/PR time rather than encoding either stale value.

## Effects outside the draft's original file list

- Exact task body bars require the shared core to emit complete `bodyBarText` and changes to existing non-task bar regression tests.
- A reliable visual proof requires the env-gated fake provider, a dedicated workflow fixture, runtime seeding, and a Playwright spec.
- Malformed fallback requires the canonical generic body arm and thin generic rendering on both shells, but only for task-family failure in this story.
- Story 1.2 edits the same body slot. Final composition must be readable-vs-Raw, regardless of merge order; assertions about nested details must distinguish old diagnostics from intentional subtask cards.
- Sprint status should move to `in-progress` when work begins and to `done` only after focused E2E and the full gate succeed.

## Remaining evidence limits

- The repository has no provider-wide maximum for OMP batch size or prompt bytes. The revised 64-entry/262,144-UTF-16-code-unit budgets are explicit UI safety policy, not claimed vendor limits; whole-dispatch generic fallback prevents silent omission.
- No implementation blocker remains. Future OMP shapes beyond the verified contract safely degrade and remain available through Raw when Story 1.2 is present.
