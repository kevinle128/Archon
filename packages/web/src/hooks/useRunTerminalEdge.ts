import { useEffect, useRef } from 'react';

interface DashboardRunEvent {
  type?: string;
  runId?: string;
}

function parse(raw: string): DashboardRunEvent | null {
  try {
    return JSON.parse(raw) as DashboardRunEvent;
  } catch {
    return null;
  }
}

/**
 * Connects to the multiplexed `__dashboard__` SSE stream purely to learn,
 * near instantly, that ONE specific run's node/status changed on the
 * server — never to populate the Zustand workflow store (that store's own
 * `useDashboardSSE` is the intentional owner of that job; mixing the two
 * would wake dormant SSE-merge logic this fix does not need). `__dashboard__`
 * is its own stream slot in the server's `SSETransport` (keyed apart from any
 * per-conversation stream), so this never contends with a run's own
 * message/steering stream — see the per-conversation eviction note on
 * `LegacyNodeRoom.tsx`'s `onRunSettleHint` doc comment, which this
 * deliberately avoids by using a different stream entirely.
 */
export function useRunTerminalEdge(runId: string, onRunEvent: () => void): void {
  const onRunEventRef = useRef(onRunEvent);
  onRunEventRef.current = onRunEvent;

  useEffect(() => {
    const es = new EventSource('/api/stream/__dashboard__');

    es.onmessage = (e: MessageEvent<string>): void => {
      const event = parse(e.data);
      if (event?.runId !== runId) return;
      if (event.type === 'dag_node' || event.type === 'workflow_status') {
        onRunEventRef.current();
      }
    };

    es.onerror = (): void => {
      // EventSource auto-reconnects on error; no explicit handling needed.
    };

    return (): void => {
      es.close();
    };
  }, [runId]);
}
