/** Percentage string accepted by shared resizable panel primitives. */
export type PanelPercent = `${number}%`;

/** Surfaces that own a Node Room outer width. */
export type RoomSurface = 'legacy' | 'console';

/**
 * Fixed outer Node Room widths in CSS pixels.
 * Split owners read these values directly; old ratio keys are never read or written.
 */
export const ROOM_WIDTH_PX = {
  console: 520,
  legacy: 460,
} as const satisfies Record<RoomSurface, number>;
