import type { GithubDevicePoll } from '@/lib/api';

/** The poll loop's next action: stop (connected), keep polling, or fail with a message. */
export type PollStep =
  | { kind: 'connected' }
  | { kind: 'retry'; nextInterval: number }
  | { kind: 'failed'; message: string };

/**
 * Pure interpretation of a single device-flow poll response (ported from the old
 * UI's inline branch logic). `pending` keeps the current interval; a transient
 * `error` with no detail backs off by 2s and retries; everything else is terminal.
 */
export function interpretPollStatus(res: GithubDevicePoll, interval: number): PollStep {
  switch (res.status) {
    case 'connected':
      return { kind: 'connected' };
    case 'pending':
      return { kind: 'retry', nextInterval: interval };
    case 'expired':
      return { kind: 'failed', message: 'Device code expired — try again.' };
    case 'denied':
      return { kind: 'failed', message: 'Authorization was denied.' };
    case 'error':
      return res.detail !== undefined && res.detail !== ''
        ? { kind: 'failed', message: `GitHub connect failed: ${res.detail}` }
        : { kind: 'retry', nextInterval: interval + 2 };
    default:
      // Defensive: the inline type can lag the server. Treat an unrecognized status
      // as a terminal failure rather than crashing the poll loop on `undefined.kind`.
      return { kind: 'failed', message: `Unexpected GitHub poll status: ${String(res.status)}` };
  }
}
