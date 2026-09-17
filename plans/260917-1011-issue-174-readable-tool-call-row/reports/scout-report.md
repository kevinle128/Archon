# Scout report

## Phase 1 scout

The shared seam is `packages/web/src/lib/agent-history.ts`.
It is the only caller of the tool and text transcript projectors.
The phase can stay inside two shared source files and two shared test files.

The main contracts are the existing `AgentHistoryItem`, stored tool metadata, and the render-neutral tool presentation rules.
The main risks are exit-code loss, unbounded generic scans, substring alias collisions, and over-broad interruption folding.

## Phase 2 scout

The two renderers are `ToolHistory` in Legacy `NodeRoom.tsx` and Console `ConsoleAgentHistoryList.tsx`.
The Console renderer already serves both selected-room and inline-history views.
No caller change is required if `buildAgentHistory()` keeps its array return type.

The Console isolation rule allows shared `@/lib/*` logic and forbids Legacy component imports.
Existing surface, family, status, border, and focus tokens are sufficient.
The main risk is native disclosure state under polling, because `defaultOpen` does not update when a stable running row becomes failed.

## Phase 3 scout

The current HITL E2E specs already open both target surfaces against one real stored tool call.
Their visible-output assertions explicitly require the old presentation, which provides a direct red-to-green change.

The current visual spec belongs to an older HITL plan and writes into that plan's capture directory.
Its tool-card readiness locator can pass from hidden payload text, so issue #174 must update that locator.
Issue #174 should also use a stable new spec with Playwright output attachments and must not write new captures into the old plan-bound path.
The main risk is confusing hidden diagnostic DOM text with visible collapsed-row text.

## Dependency conclusion

Phase 1 produces the row view model.
Phase 2 consumes it in both shells.
Phase 3 exercises the mounted surfaces and does not need fixture-provider expansion.
There is no cross-plan dependency and no API, database, provider, workflow, server, or generated-file dependency.
