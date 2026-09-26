/** Ensure a timestamp string ends with 'Z' for UTC parsing. */
export function ensureUtc(timestamp: string): string {
  return timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
}

/** Format the duration between two timestamps as a human-readable string. */
export function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(ensureUtc(startedAt)).getTime();
  const end = completedAt ? new Date(ensureUtc(completedAt)).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Format a started_at timestamp as a short locale string (e.g., "Mar 10, 2:30 PM"). */
export function formatStarted(startedAt: string): string {
  const d = new Date(ensureUtc(startedAt));
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a duration in milliseconds as a human-readable string (e.g., "1.2s", "3.5m"). */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format a duration in milliseconds the way the room header reports elapsed
 * time: whole seconds under a minute ("4s", "41.2s" when fractional), then
 * minutes and zero-padded seconds ("6m 04s", "18m 21s").
 */
export function formatDurationLong(ms: number): string {
  if (ms < 60000) {
    const seconds = Math.round(ms / 100) / 10;
    return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}
