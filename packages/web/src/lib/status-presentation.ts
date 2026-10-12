/**
 * One presentation map for run and node status. Every screen reads glyph,
 * label, and tone from here so the status language stays the same everywhere.
 */

export type StatusTone = 'running' | 'waiting' | 'done' | 'failed' | 'pending';

export interface StatusPresentation {
  glyph: string;
  label: string;
  tone: StatusTone;
}

const PENDING: StatusPresentation = { glyph: '○', label: 'Pending', tone: 'pending' };

const AWAITING: StatusPresentation = { glyph: '!', label: 'Awaiting you', tone: 'waiting' };

const PRESENTATION: Readonly<Record<string, StatusPresentation>> = {
  running: { glyph: '▶', label: 'Running', tone: 'running' },
  paused: AWAITING,
  awaiting: AWAITING,
  completed: { glyph: '✓', label: 'Completed', tone: 'done' },
  done: { glyph: '✓', label: 'Done', tone: 'done' },
  failed: { glyph: '✕', label: 'Failed', tone: 'failed' },
  pending: PENDING,
  skipped: { glyph: '–', label: 'Skipped', tone: 'pending' },
  cancelled: { glyph: '–', label: 'Cancelled', tone: 'pending' },
};

/** Maps a status string to its presentation. An unknown status reads as pending. */
export function getStatusPresentation(status: string): StatusPresentation {
  return Object.hasOwn(PRESENTATION, status) ? PRESENTATION[status] : PENDING;
}

/** Text color utility for each tone. */
export const STATUS_TONE_TEXT_CLASS: Readonly<Record<StatusTone, string>> = {
  running: 'text-status-running',
  waiting: 'text-status-waiting',
  done: 'text-status-done',
  failed: 'text-status-failed',
  pending: 'text-status-pending',
};

/** Progress strip segment fill for each tone. Pending uses the lighter segment color. */
export const STATUS_TONE_SEGMENT_CLASS: Readonly<Record<StatusTone, string>> = {
  running: 'bg-status-running',
  waiting: 'bg-status-waiting',
  done: 'bg-status-done',
  failed: 'bg-status-failed',
  pending: 'bg-segment-pending',
};
