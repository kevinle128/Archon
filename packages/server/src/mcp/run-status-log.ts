/**
 * Status-log writer: records each observed change of a run's externally
 * visible state (status, open human gate, PR link) in
 * `remote_agent_workflow_run_status_log`, which `events.ts` serves as
 * `workflow_run.status_changed` events.
 *
 * It only observes. It reads runs and events and appends log rows; it never
 * changes a run, because it cannot tell whether another process owns the run.
 *
 * Triggers:
 * - in-process workflow emitter events (every transition of runs this server
 *   executes; a node completion is re-checked after a short delay because its
 *   event row is written asynchronously);
 * - a reconcile pass at start and on an interval, over runs that are not
 *   terminal or whose last log row is not terminal. This catches changes made
 *   by other processes (a CLI approve or cancel). Several changes between two
 *   passes collapse into the latest state.
 *
 * All appends run through one in-process queue, so concurrent triggers never
 * race on the global position. A missing table (an older binary applied an
 * older schema) is logged and skipped; the server keeps running.
 */
import { createLogger } from '@archon/paths';
import { loadConfig } from '@archon/core/config';
import * as codebaseDb from '@archon/core/db/codebases';
import * as workflowDb from '@archon/core/db/workflows';
import * as workflowEventDb from '@archon/core/db/workflow-events';
import * as statusLogDb from '@archon/core/db/workflow-run-status-log';
import type {
  AppendStatusLogRowInput,
  WorkflowRunStatusLogRow,
} from '@archon/core/db/workflow-run-status-log';
import {
  getWorkflowEventEmitter,
  type WorkflowEmitterEvent,
} from '@archon/workflows/event-emitter';
import { discoverWorkflowsWithConfig } from '@archon/workflows/workflow-discovery';

import {
  buildStatusEventPayload,
  inputRequestKey,
  toIsoTimestamp,
  type RunEventSnapshot,
  type RunSnapshot,
} from './run-task';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('mcp.status-log');
  return cachedLog;
}

const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;
const DEFAULT_NODE_COMPLETED_RECHECK_MS = 500;

/** Emitter events that can change status, gate, or PR link. */
const TRIGGER_EVENT_TYPES = new Set<WorkflowEmitterEvent['type']>([
  'workflow_started',
  'approval_pending',
  'interaction_resolved',
  'workflow_completed',
  'workflow_failed',
  'workflow_cancelled',
  'node_completed',
]);

/** In-process signal from the writer to open event streams: new rows exist. */
export class StatusLogSignal {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of open subscribers (event streams). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        getLog().error({ err: error as Error }, 'mcp.status_log_listener_failed');
      }
    }
  }
}

/** Process-wide signal shared by the boot-time writer and the events route. */
export const statusLogSignal = new StatusLogSignal();

/** Read access to runs plus the log itself. Deliberately has no run-mutating method. */
export interface StatusLogStore {
  getRun(runId: string): Promise<(RunSnapshot & { codebase_id: string | null }) | null>;
  listEvents(runId: string): Promise<RunEventSnapshot[]>;
  getLastRow(runId: string): Promise<WorkflowRunStatusLogRow | null>;
  appendRow(input: AppendStatusLogRowInput): Promise<WorkflowRunStatusLogRow | null>;
  listReconcileRunIds(): Promise<string[]>;
  /** The workflow's `returns:` node, used for the terminal event's `ci`. */
  resolveReturnsNodeId(
    workflowName: string,
    codebaseId: string | null
  ): Promise<string | undefined>;
}

export function createDbStatusLogStore(): StatusLogStore {
  return {
    async getRun(runId: string): Promise<(RunSnapshot & { codebase_id: string | null }) | null> {
      const run = await workflowDb.getWorkflowRun(runId);
      if (!run) return null;
      return {
        id: run.id,
        workflow_name: run.workflow_name,
        status: run.status,
        metadata: run.metadata,
        started_at: toIsoTimestamp(run.started_at),
        completed_at: toIsoTimestamp(run.completed_at),
        last_activity_at: toIsoTimestamp(run.last_activity_at),
        codebase_id: run.codebase_id,
      };
    },
    async listEvents(runId: string): Promise<RunEventSnapshot[]> {
      const rows = await workflowEventDb.listWorkflowEvents(runId);
      return rows.map(row => ({
        event_type: row.event_type,
        step_name: row.step_name ?? null,
        data: row.data ?? {},
      }));
    },
    getLastRow: statusLogDb.getLastStatusLogRow,
    appendRow: statusLogDb.appendStatusLogRow,
    listReconcileRunIds: statusLogDb.listStatusLogReconcileRunIds,
    async resolveReturnsNodeId(
      workflowName: string,
      codebaseId: string | null
    ): Promise<string | undefined> {
      if (!codebaseId) return undefined;
      const codebase = await codebaseDb.getCodebase(codebaseId);
      if (!codebase) return undefined;
      const discovered = await discoverWorkflowsWithConfig(codebase.default_cwd, loadConfig);
      return discovered.workflows.find(w => w.workflow.name === workflowName)?.workflow.returns;
    },
  };
}

export interface StatusLogEmitter {
  subscribe(listener: (event: WorkflowEmitterEvent) => void): () => void;
}

export interface RunStatusLogWriterOptions {
  /** Web UI base URL for the `url` field of event payloads. */
  baseUrl: string;
  store?: StatusLogStore;
  emitter?: StatusLogEmitter;
  signal?: StatusLogSignal;
  reconcileIntervalMs?: number;
  nodeCompletedRecheckMs?: number;
}

export interface RunStatusLogWriter {
  /** Settles when the start-up reconcile pass finished. */
  ready: Promise<void>;
  /** Compare run R with its last log row and append a row when it changed. */
  refresh(runId: string): Promise<void>;
  /** Refresh every run that may have changed. */
  reconcile(): Promise<void>;
  stop(): void;
}

/** JSON with object keys sorted, so a value read back from PostgreSQL JSONB compares equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * What makes a new event: status, open gate, PR link, and the CI result. CI is
 * part of the key so a final output that lands after the terminal status still
 * produces a corrected terminal event.
 */
function snapshotKey(
  status: string,
  gateKey: string | null,
  data: Record<string, unknown>
): string {
  const prUrl = typeof data.pr_url === 'string' ? data.pr_url : null;
  return stableJson([status, gateKey, prUrl, data.ci ?? null]);
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Cheap run-row fingerprint. When it is unchanged since the last recorded
 * observation, and the run is not running, its events cannot change the
 * snapshot, so a reconcile pass skips reading them.
 */
function runFingerprint(run: RunSnapshot): string {
  const approval = run.metadata.approval;
  const gate =
    approval !== null && typeof approval === 'object'
      ? {
          nodeId: (approval as Record<string, unknown>).nodeId,
          type: (approval as Record<string, unknown>).type,
          resolved: (approval as Record<string, unknown>).resolved,
        }
      : null;
  return stableJson([run.status, gate, run.metadata.error, run.completed_at]);
}

type ObserveMode = 'full' | 'reconcile';

export function startRunStatusLogWriter(options: RunStatusLogWriterOptions): RunStatusLogWriter {
  const store = options.store ?? createDbStatusLogStore();
  const emitter = options.emitter ?? getWorkflowEventEmitter();
  const signal = options.signal ?? statusLogSignal;
  const reconcileIntervalMs = options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const recheckMs = options.nodeCompletedRecheckMs ?? DEFAULT_NODE_COMPLETED_RECHECK_MS;

  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Fingerprint of the last recorded observation per non-terminal run. */
  const recorded = new Map<string, string>();

  interface Observed {
    runId: string;
    status: string;
    gateKey: string | null;
    fingerprint: string;
    payload: ReturnType<typeof buildStatusEventPayload>;
  }

  /** Read the run's current state. Runs as soon as a trigger fires. */
  async function observe(runId: string, mode: ObserveMode): Promise<Observed | null> {
    const run = await store.getRun(runId);
    if (!run) return null;
    const fingerprint = runFingerprint(run);
    if (mode === 'reconcile' && run.status !== 'running' && recorded.get(runId) === fingerprint) {
      return null;
    }
    const events = await store.listEvents(runId);
    const returnsNodeId =
      run.status === 'completed'
        ? await store
            .resolveReturnsNodeId(run.workflow_name, run.codebase_id)
            .catch((error: unknown) => {
              getLog().warn({ err: error as Error, runId }, 'mcp.status_log_returns_lookup_failed');
              return undefined;
            })
        : undefined;
    return {
      runId,
      status: run.status,
      gateKey: inputRequestKey(run, events) ?? null,
      fingerprint,
      payload: buildStatusEventPayload(run, events, {
        baseUrl: options.baseUrl,
        ...(returnsNodeId ? { returnsNodeId } : {}),
      }),
    };
  }

  /** Compare with the run's last row and append when the snapshot changed. Runs in the queue. */
  async function record(observed: Observed | null): Promise<void> {
    if (!observed) return;
    const { runId, status, gateKey, payload } = observed;
    const data: Record<string, unknown> = { ...payload };
    const last = await store.getLastRow(runId);
    const changed =
      !last ||
      snapshotKey(last.status, last.gate_key, last.data) !== snapshotKey(status, gateKey, data);
    if (changed) {
      const appended = await store.appendRow({
        workflow_run_id: runId,
        status,
        gate_key: gateKey,
        data,
        previous_seq: last?.seq ?? 0,
      });
      if (appended) {
        getLog().debug(
          { runId, seq: appended.seq, position: appended.position, status },
          'mcp.status_log_appended'
        );
        signal.notify();
        // The final node's output event is written without waiting, so it can land
        // just after the terminal status. Look once more, shortly after the first
        // terminal row; a late output then appends a corrected terminal row.
        if (TERMINAL_STATUSES.has(status) && !(last && TERMINAL_STATUSES.has(last.status))) {
          later(recheckMs, () => void refresh(runId));
        }
      }
    }
    if (TERMINAL_STATUSES.has(status)) recorded.delete(runId);
    else recorded.set(runId, observed.fingerprint);
  }

  function logWriteFailure(error: unknown): void {
    getLog().error(
      { err: error as Error, errorType: (error as Error).constructor?.name },
      'mcp.status_log_write_failed'
    );
  }

  /**
   * The state is read at trigger time, so a quick sequence of in-process
   * transitions is observed one by one; the compare-and-append steps then run
   * one at a time, in trigger order, so the global position never races.
   */
  function enqueueObservation(runId: string, mode: ObserveMode): Promise<void> {
    const observed = observe(runId, mode);
    // Keep the rejection from being reported as unhandled before the queue reaches it.
    observed.catch(() => undefined);
    const next = queue.then(async () => record(await observed)).catch(logWriteFailure);
    queue = next;
    return next;
  }

  function refresh(runId: string): Promise<void> {
    return enqueueObservation(runId, 'full');
  }

  async function reconcile(): Promise<void> {
    let runIds: string[];
    try {
      runIds = await store.listReconcileRunIds();
    } catch (error) {
      logWriteFailure(error);
      return;
    }
    await Promise.all(runIds.map(runId => enqueueObservation(runId, 'reconcile')));
  }

  function later(ms: number, fn: () => void): void {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) fn();
    }, ms);
    timers.add(timer);
  }

  const unsubscribe = emitter.subscribe(event => {
    if (stopped || !TRIGGER_EVENT_TYPES.has(event.type)) return;
    void refresh(event.runId);
    if (event.type === 'node_completed') later(recheckMs, () => void refresh(event.runId));
  });

  const interval = setInterval(() => {
    if (!stopped) void reconcile();
  }, reconcileIntervalMs);
  const ready = reconcile();
  getLog().info({ reconcileIntervalMs }, 'mcp.status_log_writer_started');
  if (!process.env.ARCHON_PUBLIC_URL?.trim()) {
    getLog().warn({ baseUrl: options.baseUrl }, 'mcp.public_url_missing');
  }

  return {
    ready,
    refresh,
    reconcile,
    stop(): void {
      stopped = true;
      unsubscribe();
      clearInterval(interval);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      getLog().info('mcp.status_log_writer_stopped');
    },
  };
}
