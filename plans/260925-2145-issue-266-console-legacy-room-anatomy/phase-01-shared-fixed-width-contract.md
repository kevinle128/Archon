---
phase: 1
title: 'Shared fixed-width contract'
status: pending
dependencies: [issue-ownership-decision]
---

# Shared fixed-width contract

## Context and files

`packages/web/src/lib/room-split-layout.ts` currently owns a 40% default, 24–60% clamp, percentage panel sizes, and `archon.run-room.ratio.<surface>` storage. Only `LegacyGraphLogsPane`, `ConsoleInspectPane`, `WorkflowExecution`, and `RunDetailPage` consume its ratio functions. The two generic resizable primitives still import `PanelPercent`, and Console's isolation test allows the shared module. `packages/web/src/index.css` defines unused `--rv-panel-default/min/max-width` tokens; `packages/docs-web/src/content/docs/brand/index.md` incorrectly documents them as live.

## Steps

1. Update `packages/web/src/lib/room-split-layout.test.ts` first: assert `ROOM_WIDTH_PX.console === 520` and `ROOM_WIDTH_PX.legacy === 460`. A `satisfies Record<RoomSurface, number>` declaration provides compile-time coverage; do not claim that `as const` freezes an object at runtime. Run this narrow test and confirm it fails for the intended missing contract.
2. Replace ratio, clamp, panel-size, storage helpers and their types with the single `ROOM_WIDTH_PX` value. Keep `RoomSurface` and `PanelPercent` exported at the same path for existing consumers. No wrapper function is needed for two property reads. No new persistence key or migration: old ratio keys stay in localStorage but are never read or written by Node Room.
3. Remove the unused `--rv-panel-*` declarations **and** their three rows in the brand-token page after checking for consumers outside `packages/web/src`; they describe a resizable range that no longer exists. Do not change unrelated brand tokens.
4. Coordinate this phase with Phase 2 in one working change so removed ratio exports never leave the branch type-invalid. Recheck `rg 'roomPanelSizes|clampRoomRatio|readRoomRatio|writeRoomRatio|ROOM_SPLIT|run-room\.ratio' packages/web/src` after Phase 2; only a deliberate stale-key regression fixture may mention the key in tests.

## Acceptance and risk

The width unit test and web type-check pass after Phase 2; generic source-control resizing remains usable because its primitives and `PanelPercent` stay. `room-split-layout.ts` remains a render-neutral shared value module. Rollback restores the prior module and CSS/docs rows together.
