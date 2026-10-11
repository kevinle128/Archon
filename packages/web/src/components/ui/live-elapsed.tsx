import * as React from 'react';

/** Formats a duration as "42s", "6m 02s", or "1h 4m". Negative input reads as zero. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
  return `${String(seconds)}s`;
}

// One interval serves every mounted timer. It starts with the first
// subscriber and stops with the last.
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let tick = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    intervalId = setInterval(() => {
      tick += 1;
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getTick(): number {
  return tick;
}

interface LiveElapsedProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  /** Start time as an ISO string or epoch milliseconds. */
  since: string | number;
  /** Stops the clock at this time. Omit while the work is still running. */
  until?: string | number;
}

function toMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

/** Elapsed time since a start timestamp. Ticks once per second. */
function LiveElapsed({ since, until, ...props }: LiveElapsedProps) {
  const running = until === undefined;
  // The tick value only forces a re-render; the clock is read from Date.now().
  React.useSyncExternalStore(running ? subscribe : noopSubscribe, getTick, getTick);
  const start = toMs(since);
  if (Number.isNaN(start)) return null;
  const end = running ? Date.now() : toMs(until);
  if (Number.isNaN(end)) return null;
  return (
    <span data-slot="live-elapsed" {...props}>
      {formatElapsed(end - start)}
    </span>
  );
}

function noopSubscribe(): () => void {
  return () => undefined;
}

export { LiveElapsed };
export type { LiveElapsedProps };
