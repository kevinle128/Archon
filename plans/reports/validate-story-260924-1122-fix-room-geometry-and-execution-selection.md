# Story 10.1 validation

Status: **Needs repair**.

Target: `_bmad-output/implementation-artifacts/agent-node-room/10-1-fix-room-geometry-and-execution-selection.md`.

## Blocking finding

**The first appearance of the Execution selector can select a stale row.**

Acceptance criterion 3 and Epic 10 require the live execution when the selector first renders (`10-1-fix-room-geometry-and-execution-selection.md:26-29`; `epics.md:1691-1694`).
The story limits live choice to a fresh room visit and tests only that entry path (`10-1-fix-room-geometry-and-execution-selection.md:92,118`).
The existing visit state keeps the selected row id when execution rows update, and `applyRoomDeepLink` returns the existing state once the query node has been applied (`execution-room-model.ts:381-390`; `WorkflowExecution.tsx:625-631`; `RunDetailPage.tsx:337-358`).
If an operator opens a loop with one execution, the selector is absent.
When a second execution starts, the selector first appears while the original execution can remain selected.

Add a task that selects the newly resolved live row when an implicit one-execution selection gains a second execution.
Keep selections made by the operator and explicit Logs or graph occurrence openings unchanged.
In both shells, prove the one-to-two execution transition through the selector value, transcript scope, message request scope, and dock state.
Also prove that an explicit stale selection stays selected through the same update.

## Checks

M001, M002, and M005 match the current specification, architecture, UX, Epic 10, and mockup manifest.
All 26 source references and the listed focused test files exist.
This was a planning and source review; implementation tests were not run.

## Workflow note

The installed `bmad-validate-story` wrapper delegates to a `bmad-create-story` Validate Mode, but the installed create-story skill defines only Create Mode.
This review used its independent checklist and did not change the story or sprint status.

## Unresolved questions

None.
