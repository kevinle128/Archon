# Research synthesis

## Issue and scope

Issue #174 implements Story 1.1 of Epic 1 and applies to the Legacy and Console agent node rooms together.
It is a presentation-only change over stored historical data.
Raw disclosure, family-specific bodies, diffs, todo and task presentation, occurrence navigation, live steering, Chat, and Run Stream cards belong to later stories.

## Mockup findings

The final HTML mockups and their handoff README were read in full for the tool-row states.
The final `DESIGN.md` and `EXPERIENCE.md` take precedence over stale mockup details.

The row is a native disclosure with this fixed order: chevron, glyph, family chip, flexible headline, and right badges.
The final measurements are 12 px row text, 11 px chip and badge text, 4 px by 6 px padding, 8 px gaps, 6 px radius, and at least 24 px height.
The 460 px panel is the required responsive verification width.
Path headlines use two spans for middle elision, text headlines end-elide, and duration disappears before critical badges.
Focus uses a 2 px `--accent-bright` outline, chevron rotation is 120 ms, and reduced motion disables it.

Stale mockup details were excluded.
These include the old 22 px target, inline todo checklist, Claude-only interruption assumption, 520 px Console width as a contract, and later-story Raw and body treatments.

## Repository findings

`projectToolTranscript()` already pairs tool call and result rows and preserves input, output, exit code, and message identity.
`buildAgentHistory()` is the only production caller and feeds exactly three mounted transcript paths.
It currently discards exit code after outcome derivation and renders every status row as a lifecycle item.

Legacy owns its tool renderer in `NodeRoom.tsx`.
Console owns its renderer in `ConsoleAgentHistoryList.tsx`, which is reused by both the selected node room and inline execution history.
The current renderers both show two always-open JSON blocks.

The existing provider, persistence, database, API, generated types, paging, and full-output endpoints already carry all Story 1.1 data.
No backend or schema change is required.

## Chosen design

Add one React-free row presenter in `packages/web/src/lib` and attach its result in `buildAgentHistory()`.
Keep two thin renderer shells so Console does not import Legacy components.
Use native disclosures and only the small local state required to preserve an operator toggle while allowing an untouched running row to open on failure.

Keep the public presenter bounded and fail safe.
Use exact alias matching, fixed direct-key lookup, a capped generic scan, bounded badge extraction, maximum scalar counts and lengths, and a generic fallback boundary.
The presenter receives schema-valid JSON values from parsed tool rows.
Corrupt stored-row JSON continues to fail through the existing API path before rendering.

## Test findings

`e2e/ui/workflow-run-hitl.spec.ts` and `e2e/ui/workflow-run-hitl-room.spec.ts` are the closest outside-in paths.
They already create the fake-provider HITL run and open the same tool call in Legacy and Console.
Their current visible-output expectations become the first red acceptance tests.
The fake provider emits a successful call only, so deterministic unit and component tests should cover failed, malformed, interrupted, and live-transition cases.

## Process risk

The GitHub issue is marked `status:processing`, and a comment reports an Archon Loop implementation run.
No matching pull request was found, and local sprint status still says backlog.
The local plan registry also reports active matching plan `Archon/260917-0323` in `/Users/dale/orca/workspaces/Archon/develop`.
Implementation must resolve this ownership state before editing to avoid duplicate work.
