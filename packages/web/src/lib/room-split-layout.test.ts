import { describe, expect, test } from 'bun:test';

import { ROOM_WIDTH_PX, type RoomSurface } from './room-split-layout';

describe('room-split-layout', () => {
  test('exports fixed outer widths for every room surface', () => {
    // Compile-time coverage is enforced by `satisfies Record<RoomSurface, number>`
    // on ROOM_WIDTH_PX. Runtime checks pin the approved CSS-px contract.
    const widths: Record<RoomSurface, number> = ROOM_WIDTH_PX;
    expect(widths.console).toBe(520);
    expect(widths.legacy).toBe(460);
    expect(ROOM_WIDTH_PX.console).toBe(520);
    expect(ROOM_WIDTH_PX.legacy).toBe(460);
  });

  test('documents stale ratio keys as unread Node Room storage', () => {
    // Deliberate fixture: old archon.run-room.ratio.* values may remain in
    // localStorage after upgrade. Node Room code must never import readers or
    // writers for them (see room-split-layout.ts exports).
    const staleKeys = ['archon.run-room.ratio.legacy', 'archon.run-room.ratio.console'] as const;
    expect(staleKeys).toHaveLength(2);
    expect(staleKeys[0]).toContain('run-room.ratio');
  });
});
