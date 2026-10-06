export type PanelPercent = `${number}%`;
export type RoomSurface = 'legacy' | 'console';

/**
 * The node panel's fixed width in the horizontal room split. It does not
 * resize with the window and carries no drag handle; a narrow container
 * falls back to the single-column room instead of shrinking this value.
 */
export const CONSOLE_ROOM_WIDTH_PX = 520;
export const LEGACY_ROOM_WIDTH_PX = 460;

export const ROOM_SPLIT = {
  defaultRoomRatio: 40,
  minRoomRatio: 24,
  maxRoomRatio: 60,
  minViewRatio: 30,
} as const;

export interface RoomPanelSizes {
  view: { defaultSize: PanelPercent; minSize: PanelPercent };
  room: { defaultSize: PanelPercent; minSize: PanelPercent; maxSize: PanelPercent };
}

function percent(value: number): PanelPercent {
  return `${value}%`;
}

export function clampRoomRatio(value: number): number {
  if (!Number.isFinite(value)) return ROOM_SPLIT.defaultRoomRatio;
  return Math.min(ROOM_SPLIT.maxRoomRatio, Math.max(ROOM_SPLIT.minRoomRatio, value));
}

export function roomPanelSizes(roomRatio: number): RoomPanelSizes {
  const room = clampRoomRatio(roomRatio);
  return {
    view: {
      defaultSize: percent(100 - room),
      minSize: percent(ROOM_SPLIT.minViewRatio),
    },
    room: {
      defaultSize: percent(room),
      minSize: percent(ROOM_SPLIT.minRoomRatio),
      maxSize: percent(ROOM_SPLIT.maxRoomRatio),
    },
  };
}

function storageKey(surface: RoomSurface): string {
  return 'archon.run-room.ratio.' + surface;
}

export function readRoomRatio(surface: RoomSurface, storage: Pick<Storage, 'getItem'>): number {
  const raw = storage.getItem(storageKey(surface));
  if (raw === null) return ROOM_SPLIT.defaultRoomRatio;
  const value = Number(raw);
  return Number.isFinite(value) ? clampRoomRatio(value) : ROOM_SPLIT.defaultRoomRatio;
}

export function writeRoomRatio(
  surface: RoomSurface,
  value: number,
  storage: Pick<Storage, 'setItem'>
): void {
  storage.setItem(storageKey(surface), String(clampRoomRatio(value)));
}
