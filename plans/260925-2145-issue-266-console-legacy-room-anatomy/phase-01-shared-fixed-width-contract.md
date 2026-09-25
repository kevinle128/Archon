---
phase: 1
title: 'Phase 1: Shared fixed-width geometry contract'
status: pending
priority: P1
effort: '1.5h'
dependencies: []
---

# Phase 1: Shared fixed-width geometry contract

## Goal

Replace the percentage and ratio contract in `packages/web/src/lib/room-split-layout.ts`
with one render-neutral source for the approved per-surface widths.

## Evidence (verified at 4039a03d)

- `room-split-layout.ts` exports `ROOM_SPLIT` (40% default, clamp from 24% to
  60%), `clampRoomRatio`, `roomPanelSizes`, `readRoomRatio`, and
  `writeRoomRatio` (key `archon.run-room.ratio.<surface>`), plus the
  `PanelPercent` and `RoomSurface` types.
- Consumers: `LegacyGraphLogsPane.tsx`, `ConsoleInspectPane.tsx`,
  `WorkflowExecution.tsx`, and `RunDetailPage.tsx` use the ratio functions.
  `execution-room-model.ts` uses `RoomSurface`. `components/ui/resizable.tsx`
  and `console-resizable.tsx` import the `PanelPercent` type (8 references
  outside the module).
- `console-isolation.test.ts:121,161` lists `@/lib/room-split-layout` as an
  allowed, required Console import. Keep the module path.
- `index.css:448-450` defines `--rv-panel-default-width/min/max`, and nothing
  reads them (grep shows only the definitions).

## Files

- Modify: `packages/web/src/lib/room-split-layout.ts`,
  `packages/web/src/lib/room-split-layout.test.ts`
- Possibly modify: `packages/web/src/index.css` (only the dead `--rv-panel-*`
  variables)

## TDD steps

1. **Red.** Rewrite `room-split-layout.test.ts`:
   - `roomWidthPx('console') === 520` and `roomWidthPx('legacy') === 460`.
   - `ROOM_WIDTH_PX` is frozen (`as const`) and covers exactly the
     `RoomSurface` union (a type-level `satisfies Record<RoomSurface, number>`).
   Run `(cd packages/web && bun test src/lib/room-split-layout.test.ts)` and
   confirm it fails.
2. **Green.** Implement:
   ```ts
   export type RoomSurface = 'legacy' | 'console';
   export const ROOM_WIDTH_PX = { console: 520, legacy: 460 } as const satisfies Record<RoomSurface, number>;
   export function roomWidthPx(surface: RoomSurface): number { return ROOM_WIDTH_PX[surface]; }
   ```
   Keep `PanelPercent` exported from this module, because the two resizable
   primitives import it and moving it would widen the change for no gain.
   Delete the ratio functions and `ROOM_SPLIT`.
3. Leave the four call sites broken; Phase 2 fixes them. If Phase 1 is
   committed separately, commit it together with Phase 2 so `type-check`
   never fails on the branch.
4. Remove `--rv-panel-*` from `index.css` only if grep across `packages/web`
   and `packages/docs-web` still shows no reader. Otherwise leave them and
   note why.

## Success criteria

- The new unit test passes, and the module contains no ratio or storage code.
- `grep -rn "run-room.ratio" packages/web/src` returns nothing.

## Risks

- Deleting exports breaks call sites until Phase 2 lands, so treat Phases 1
  and 2 as one commit.
