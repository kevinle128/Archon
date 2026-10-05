import type { components } from './api.generated';

export type NodeMessageRow = components['schemas']['WorkflowNodeMessage'];
export type NodeMessagePage = components['schemas']['WorkflowNodeMessagesResponse'];

export type NodeMessageSelection =
  | { kind: 'node'; rowId: string }
  | { kind: 'occurrence'; occurrenceId: string; attemptId?: string };

export interface NodeMessageState {
  scopeKey: string;
  rows: NodeMessageRow[];
  afterSeq: number;
  highWatermark: number | null;
  complete: boolean;
  loading: boolean;
  error: string | null;
}

export type NodeMessageLoader = (
  runId: string,
  nodeId: string,
  options: {
    afterSeq: number;
    limit: number;
    occurrenceId?: string;
    attemptId?: string;
    signal?: AbortSignal;
  }
) => Promise<NodeMessagePage>;

export interface DrainNodeMessagesArgs {
  runId: string;
  nodeId: string;
  selection: NodeMessageSelection;
  loader: NodeMessageLoader;
  onState: (state: NodeMessageState) => void;
  signal?: AbortSignal;
  state?: NodeMessageState;
}

export function nodeMessageScopeKey(
  runId: string,
  nodeId: string,
  selection: NodeMessageSelection
): string {
  if (selection.kind === 'node') {
    return `run:${runId}|node:${nodeId}|sel:node:${selection.rowId}`;
  }
  const attempt = selection.attemptId ?? '';
  return `run:${runId}|node:${nodeId}|sel:occurrence:${selection.occurrenceId}|attempt:${attempt}`;
}

export function createNodeMessageState(scopeKey: string): NodeMessageState {
  return {
    scopeKey,
    rows: [],
    afterSeq: 0,
    highWatermark: null,
    complete: false,
    loading: false,
    error: null,
  };
}

export function beginNodeMessageRefresh(state: NodeMessageState): NodeMessageState {
  return {
    ...state,
    highWatermark: null,
    complete: false,
  };
}

function isCompatibilityPage(page: NodeMessagePage): boolean {
  return (
    page.hasMore === undefined && page.nextCursor === undefined && page.highWatermark === undefined
  );
}

function resolveAfterSeq(page: NodeMessagePage, previous: number): number {
  if (page.nextCursor !== undefined) {
    const parsed = Number(page.nextCursor);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  let maxSeq = previous;
  for (const row of page.messages) {
    if (row.seq > maxSeq) {
      maxSeq = row.seq;
    }
  }
  return maxSeq;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function mergeRows(existing: NodeMessageRow[], incoming: NodeMessageRow[]): NodeMessageRow[] {
  const bySeq = new Map<number, NodeMessageRow>();
  for (const row of existing) {
    bySeq.set(row.seq, row);
  }
  for (const row of incoming) {
    bySeq.set(row.seq, row);
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

function effectiveWatermark(
  highWatermark: number | null,
  afterSeq: number,
  compatibility: boolean
): number {
  if (highWatermark !== null) {
    return highWatermark;
  }
  return compatibility ? afterSeq : Number.POSITIVE_INFINITY;
}

export function reduceNodeMessagePage(
  state: NodeMessageState,
  scopeKey: string,
  page: NodeMessagePage
): NodeMessageState {
  if (scopeKey !== state.scopeKey) {
    return state;
  }

  const rows = mergeRows(state.rows, page.messages);
  const afterSeq = resolveAfterSeq(page, state.afterSeq);
  const highWatermark =
    state.highWatermark ?? (page.highWatermark !== undefined ? page.highWatermark : null);
  const compatibility = isCompatibilityPage(page);
  const progressed = afterSeq > state.afterSeq;
  const empty = page.messages.length === 0;
  const cursorSeq = progressed ? afterSeq : state.afterSeq;
  const watermark = effectiveWatermark(highWatermark, cursorSeq, compatibility);
  const complete = compatibility
    ? page.hasMore !== true && cursorSeq >= watermark
    : cursorSeq >= watermark;

  if (empty && !progressed && !complete) {
    return {
      ...state,
      highWatermark,
      complete: false,
      loading: false,
      error: 'Empty page made no cursor progress',
    };
  }

  return {
    scopeKey: state.scopeKey,
    rows,
    afterSeq: cursorSeq,
    highWatermark,
    complete,
    loading: false,
    error: null,
  };
}

export function reduceNodeMessageFailure(
  state: NodeMessageState,
  scopeKey: string,
  error: unknown
): NodeMessageState {
  if (scopeKey !== state.scopeKey) {
    return state;
  }
  return {
    ...state,
    complete: false,
    loading: false,
    error: errorMessage(error),
  };
}

function nextLoaderOptions(
  state: NodeMessageState,
  selection: NodeMessageSelection,
  signal: AbortSignal | undefined
): Parameters<NodeMessageLoader>[2] {
  const options: Parameters<NodeMessageLoader>[2] = {
    afterSeq: state.afterSeq,
    limit: 100,
  };
  if (selection.kind === 'occurrence') {
    // Occurrence-scoped only — CAP-6 forbids keying the room's transcript on
    // attempt_id. A steered node writes every guidance turn's rows under the
    // SAME occurrence, so fetching by occurrence_id alone already returns
    // the full transcript; forwarding attemptId would silently drop every
    // turn but the one the selection's projected execution happens to carry.
    options.occurrenceId = selection.occurrenceId;
  }
  if (signal !== undefined) {
    options.signal = signal;
  }
  return options;
}

export async function drainNodeMessages(args: DrainNodeMessagesArgs): Promise<NodeMessageState> {
  const scopeKey = nodeMessageScopeKey(args.runId, args.nodeId, args.selection);
  const previous = args.state;
  let state = previous?.scopeKey === scopeKey ? previous : createNodeMessageState(scopeKey);

  if (state.error !== null) {
    state = { ...state, error: null };
  }

  const notify = (next: NodeMessageState): NodeMessageState => {
    args.onState(next);
    return next;
  };

  if (isAborted(args.signal)) {
    return notify({ ...state, loading: false });
  }

  if (state.complete) {
    return notify({ ...state, loading: false });
  }

  while (!state.complete) {
    if (isAborted(args.signal)) {
      return notify({ ...state, loading: false, error: null });
    }
    try {
      const page = await args.loader(
        args.runId,
        args.nodeId,
        nextLoaderOptions(state, args.selection, args.signal)
      );
      const next = reduceNodeMessagePage(state, scopeKey, page);
      state = notify(next);
      if (next.error !== null || next.complete) {
        break;
      }
    } catch (error: unknown) {
      if (isAbortError(error) || isAborted(args.signal)) {
        return notify({ ...state, loading: false, error: null });
      }
      state = notify(reduceNodeMessageFailure(state, scopeKey, error));
      break;
    }
  }

  return state;
}
