/**
 * Exact execution identity, header data, and room visit transitions.
 *
 * Selection, labels, opener ids, runtime fields, and visit reducers stay
 * pure so Legacy and Console can share the same resolution without sharing UI.
 * Focus restoration stays the caller's DOM responsibility via openerId.
 */
import type { components } from './api.generated';
import { ensureUtc, formatDurationLong } from './format';
import type { RoomSurface } from './room-split-layout';
import { IDLE_AWAIT_EXPIRED_ERROR } from './steering-dock';

type WorkflowEvent = components['schemas']['WorkflowEvent'];

export interface ExecutionLoopAncestryEntry {
  readonly nodeId: string;
  readonly iteration: number;
}

export type ExecutionRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number }
  | {
      kind: 'occurrence';
      occurrenceId: string;
      attemptId?: string;
      retryEpoch?: number;
      iteration?: number;
      routeActivationSeq?: number;
      loopAncestry?: readonly ExecutionLoopAncestryEntry[];
    };

export interface FinishedIterationView {
  readonly liveRowId: string;
  readonly liveIteration: number;
}

export interface ExecutionRow {
  id: string;
  nodeId: string;
  label: string;
  status: string;
  order: number;
  selection: ExecutionRowSelection;
  startedAt?: string;
  durationMs?: number;
  startedOffsetMs?: number;
  unknownScope?: boolean;
}

export interface ExecutionHeaderModel {
  nodeId: string;
  nodeLabel: string;
  executionLabel: string;
  /** The node's own condition — never the selected row's, when the two differ. See `ExecutionHeaderInput.nodeStatus`. */
  status: string;
  /** The node's own failure reason. Only ever set while `status` is `failed`; null otherwise or when unknown. */
  statusReason: string | null;
  startedOffsetMs: number | null;
  /** ISO timestamp the selected execution started, for the header's clock-time segment. */
  startedAt: string | null;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  unknownScope: boolean;
  /** True when the selected execution is one iteration of a loop node. */
  isLoopIteration: boolean;
  /**
   * The node definition's `loop`/`loop_group.max_iterations`, or null for a
   * non-loop node (or when the caller has no definition to read it from).
   * This is the loop's own configured cap — never `EXECUTION_OPTIONS_MAX`,
   * the unrelated selector-display ceiling — and only a loop node's header
   * caption shows it.
   */
  loopMaxIterations: number | null;
}

export interface ExecutionHeaderInput {
  row: ExecutionRow;
  events: readonly WorkflowEvent[];
  runStartedAt: string;
  /**
   * Every execution row for this node, used to rank a retried selection's
   * "Run N" against its surviving siblings (`survivingRetryEpochs`) instead
   * of the raw retry epoch, so a skipped middle epoch never leaves a
   * numbering gap. Omitted callers (most test fixtures, and any caller with
   * no sibling rows in hand) keep the raw-epoch label — correct whenever
   * there is no skipped epoch to create a gap.
   */
  siblingRows?: readonly RunFamilyRow[];
  /** The selected row's node definition's loop cap, for `loopMaxIterations`. Omitted or null for a non-loop node. */
  loopMaxIterations?: number | null;
  /**
   * The node's own aggregate status and failure reason — the same node
   * state the graph card reads — independent of which execution row is
   * selected. The header pill and meta always report the node's own
   * condition, never a historical row's: a loop that failed on
   * `max_iterations` still reads `Failed` while an earlier iteration is
   * selected, and a node that later succeeded on retry reads `Completed`
   * even while viewing the run that failed. Omitted callers (most test
   * fixtures) keep the selected row's own status, which is correct
   * whenever the two coincide — every node with exactly one execution.
   */
  nodeStatus?: string | null;
  nodeError?: string | null;
}

export type RoomOpenerKind = 'log' | 'graph';

interface ExecutionChoiceRow {
  id: string;
  nodeId: string;
  status: string;
  order: number;
}

interface FinishedIterationRow {
  id: string;
  nodeId: string;
  status: string;
  order: number;
  selection: ExecutionRowSelection;
  unknownScope?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function latestByOrder<T extends { order: number }>(rows: readonly T[]): T {
  return rows.reduce((best, row) => (row.order >= best.order ? row : best));
}

/**
 * Non-skipped retry epochs recorded for one iteration/route slot, across
 * every row for the node — the sibling set every "Run N" label (a selector
 * option, the header meta line) must rank against. A resume's skipped
 * middle epoch (e.g. a rejected retry request that never produced a real
 * run) must never leave a gap in the numbering, so the rank comes from
 * position among survivors, never from the raw epoch value. Null when the
 * selection carries no retry identity to rank.
 */
function survivingRetryEpochs(
  rows: readonly RunFamilyRow[],
  selection: ExecutionRowSelection
): ReadonlySet<number> | null {
  if (selection.kind !== 'occurrence') return null;
  const iteration = selection.iteration ?? null;
  const route = selection.routeActivationSeq ?? null;
  const epochs = new Set<number>();
  for (const candidate of rows) {
    if (candidate.status === 'skipped') continue;
    if (candidate.selection.kind !== 'occurrence') continue;
    if ((candidate.selection.iteration ?? null) !== iteration) continue;
    if ((candidate.selection.routeActivationSeq ?? null) !== route) continue;
    epochs.add(candidate.selection.retryEpoch ?? 0);
  }
  epochs.add(selection.retryEpoch ?? 0);
  return epochs;
}

/** 1-based rank of `retryEpoch` among `epochs`, sorted ascending. */
function retryRunNumber(epochs: ReadonlySet<number>, retryEpoch: number): number {
  const sorted = [...epochs].sort((a, b) => a - b);
  const index = sorted.indexOf(retryEpoch);
  return index === -1 ? retryEpoch + 1 : index + 1;
}

/**
 * `survivingEpochs` is the sibling set from `survivingRetryEpochs`, when the
 * caller has it — every real production call site does. It stays optional
 * so a caller with no sibling rows in hand (a lone selection, most test
 * fixtures) still gets a label, using the raw epoch as its own rank.
 */
function executionLabel(
  selection: ExecutionRowSelection,
  survivingEpochs?: ReadonlySet<number> | null
): string {
  if (selection.kind === 'loop_iteration') {
    return `Iteration ${String(selection.iteration)}`;
  }
  if (selection.kind === 'route_iteration') {
    return `Route ${String(selection.executionSeq)}`;
  }
  if (selection.kind === 'occurrence') {
    const context: string[] = [];
    if (selection.routeActivationSeq !== undefined) {
      context.push(`Route ${String(selection.routeActivationSeq)}`);
    }
    if (selection.iteration !== undefined) {
      context.push(`Iteration ${String(selection.iteration)}`);
    }
    if (selection.retryEpoch !== undefined && selection.retryEpoch > 0) {
      const run =
        survivingEpochs !== undefined && survivingEpochs !== null
          ? retryRunNumber(survivingEpochs, selection.retryEpoch)
          : selection.retryEpoch + 1;
      context.push(`Run ${String(run)}`);
    }
    // "Attempt" is banned transcript vocabulary (EXPERIENCE.md); a bare
    // first occurrence uses the same "Run N" base occurrence-groups.ts
    // gives every retry heading, so the header and the transcript's own
    // occurrence label can never disagree.
    return context.length > 0 ? context.join(' · ') : 'Run 1';
  }
  return 'Execution unknown';
}

function startedOffsetMs(row: ExecutionRow, runStartedAt: string): number | null {
  if (row.startedAt !== undefined) {
    const started = Date.parse(row.startedAt);
    const runStarted = Date.parse(runStartedAt);
    if (Number.isFinite(started) && Number.isFinite(runStarted)) {
      return Math.max(0, started - runStarted);
    }
  }
  return row.startedOffsetMs ?? null;
}

function eventMatchesSelection(event: WorkflowEvent, row: ExecutionRow): boolean {
  if (event.event_type !== 'node_started' || event.step_name !== row.nodeId) {
    return false;
  }
  const data = asRecord(event.data);
  if (data === null) return false;
  // A loop iteration's own execution scope (loop_ancestry) is nested under
  // the loop node's own outer scope — never the same occurrence/attempt
  // identity as the loop's single node_started row, since the loop node
  // starts once per retry, never once per iteration. An iteration
  // selection therefore matches that outer row by retry epoch alone.
  if (row.selection.kind === 'loop_iteration') {
    // The live selection carries no retry epoch of its own — there is only
    // ever one loop execution live at a time, so the caller (which orders
    // by array position) picks the latest match.
    return true;
  }
  if (row.selection.kind === 'occurrence' && row.selection.iteration !== undefined) {
    const retryEpoch = numberField(data, 'retry_epoch') ?? 0;
    return retryEpoch === (row.selection.retryEpoch ?? 0);
  }
  const occurrenceId = stringField(data, 'occurrence_id');
  if (row.selection.kind === 'occurrence') {
    // Occurrence identity alone decides the match (CAP-6: grouping never
    // keys on attempt_id). A projected execution's attempt can land on a
    // later provider turn than the one node_started recorded — a re-ask, or
    // a run captured before guidance turns stopped rotating attempt_id —
    // and the occurrence never changes across a node's whole life either way.
    return occurrenceId === row.selection.occurrenceId;
  }
  const attemptId = stringField(data, 'attempt_id');
  return occurrenceId === null && attemptId === null;
}

export function chooseExecutionForNode<T extends ExecutionChoiceRow>(
  rows: readonly T[],
  nodeId: string,
  lastExplicitRowId?: string | null
): T | null {
  const forNode = rows.filter(row => row.nodeId === nodeId);
  if (forNode.length === 0) return null;
  if (lastExplicitRowId !== undefined && lastExplicitRowId !== null) {
    const explicit = forNode.find(row => row.id === lastExplicitRowId);
    if (explicit !== undefined) return explicit;
  }
  const awaiting = forNode.filter(row => row.status === 'awaiting');
  if (awaiting.length > 0) return latestByOrder(awaiting);
  const running = forNode.filter(row => row.status === 'running');
  if (running.length > 0) return latestByOrder(running);
  // A skipped row (including a resume's "prior success" marker) carries no
  // transcript content and a later order than the real work it stands in
  // for. Prefer the latest row that actually ran unless every row skipped.
  const ran = forNode.filter(row => row.status !== 'skipped');
  if (ran.length > 0) return latestByOrder(ran);
  return latestByOrder(forNode);
}

/** Execution selector ceiling — also the header's "max N" caption. */
export const EXECUTION_OPTIONS_MAX = 8;

/** The node-definition shape `loopMaxIterationsForNode` reads; a `DagNode` satisfies this structurally. */
export interface LoopMaxIterationsCandidate {
  readonly loop?: { readonly max_iterations: number };
  readonly loop_group?: { readonly max_iterations: number };
}

/**
 * A loop node's own configured iteration cap, for the header's "· max N"
 * caption — never `EXECUTION_OPTIONS_MAX`, the unrelated selector-display
 * ceiling. Null for a non-loop node, or when the caller has no definition
 * (still loading, or the node was removed from the workflow since the run
 * started).
 */
export function loopMaxIterationsForNode(
  node: LoopMaxIterationsCandidate | null | undefined
): number | null {
  return node?.loop?.max_iterations ?? node?.loop_group?.max_iterations ?? null;
}

/**
 * Rows a header selector offers for one node. A skipped row (for example a
 * resume's `node_skipped_prior_success` marker) is not a run, so it is left
 * out whenever the node has a row that actually ran. The selected row always
 * stays, so the selector can still show what the room projects.
 */
export function selectableExecutionRows<T extends { id: string; status: string }>(
  rows: readonly T[],
  selectedId?: string
): T[] {
  const ran = rows.filter(row => row.status !== 'skipped');
  if (ran.length === 0) return [...rows];
  return rows.filter(row => row.status !== 'skipped' || row.id === selectedId);
}

/**
 * Cap the executions a header selector exposes, keeping the most recent
 * ones so a long-running loop never grows the control past this ceiling.
 * Chronological order is preserved among the kept rows.
 */
export function capExecutionOptions<T extends { order: number }>(
  rows: readonly T[],
  max = EXECUTION_OPTIONS_MAX
): T[] {
  if (rows.length <= max) return [...rows];
  return [...rows].sort((a, b) => a.order - b.order).slice(rows.length - max);
}

export interface ExecutionOptionInput {
  readonly id: string;
  readonly label: string;
  readonly status: string;
}

export interface ExecutionOption {
  readonly id: string;
  readonly label: string;
}

/** The live-status word a header selector option carries, mirroring `Iteration 3 · running`. */
const EXECUTION_OPTION_LIVE_WORD: Readonly<Record<string, string>> = {
  running: 'running',
  awaiting: 'awaiting',
};

/**
 * A header selector must never offer two options an operator cannot tell
 * apart. Two independent signals close that gap over `options`, given in the
 * caller's chronological order:
 *
 * - the row currently backed by a live process states so (`Iteration 3 ·
 *   running`), matching the approved mockup;
 * - if the text still collides after that — two finished executions of the
 *   same iteration/route slot the engine never distinguished by retry epoch,
 *   as a workflow resume can produce — a later duplicate gains a numbered
 *   `· Run N` suffix so no two options ever render identical text.
 */
export function disambiguateExecutionOptions(
  options: readonly ExecutionOptionInput[]
): ExecutionOption[] {
  const seen = new Map<string, number>();
  return options.map(option => {
    const liveWord = EXECUTION_OPTION_LIVE_WORD[option.status];
    const base = liveWord === undefined ? option.label : `${option.label} · ${liveWord}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      id: option.id,
      label: occurrence === 1 ? base : `${base} · Run ${String(occurrence)}`,
    };
  });
}

interface LoopAncestryLike {
  readonly node_id: string;
  readonly iteration: number;
}

/** The wire fields `excludeRepresentedLoopContainers` needs, nothing more. */
export interface LoopContainerCandidate {
  readonly node_id: string;
  readonly node_type?: string;
  readonly retry_epoch?: number;
  readonly route_activation_seq?: number;
  readonly loop_ancestry?: readonly LoopAncestryLike[];
  readonly started_at?: string;
  readonly ended_at?: string;
}

function normalizedEpoch(value: number | undefined): number {
  return value ?? 0;
}

function ancestryPrefixEquals(
  left: readonly LoopAncestryLike[],
  right: readonly LoopAncestryLike[] | undefined
): boolean {
  const rightEntries = right ?? [];
  if (left.length !== rightEntries.length) return false;
  return left.every(
    (entry, index) =>
      entry.node_id === rightEntries[index]?.node_id &&
      entry.iteration === rightEntries[index]?.iteration
  );
}

/** Whether `candidateStartedAt` falls inside the container's own run window. */
function executionWindowContains(
  container: LoopContainerCandidate,
  candidateStartedAt: string
): boolean {
  const containerStart =
    container.started_at !== undefined ? Date.parse(container.started_at) : Number.NaN;
  const candidateStart = Date.parse(candidateStartedAt);
  if (!Number.isFinite(containerStart) || !Number.isFinite(candidateStart)) return false;
  if (candidateStart < containerStart) return false;
  if (container.ended_at === undefined) return true;
  const containerEnd = Date.parse(container.ended_at);
  return !Number.isFinite(containerEnd) || candidateStart <= containerEnd;
}

/**
 * A loop node mints one "container" execution for its own top-level
 * started/failed lifecycle, then a separate execution per iteration nested
 * inside it (`dag-executor.ts`'s `outerExecutionScope` /
 * `iterationExecutionScope`). Both share the loop's retry epoch and route
 * activation and start within the same instant, so a container with no
 * transcript of its own is the same physical invocation an iteration row
 * already carries the transcript for — drop it so the Execution list, and its
 * default selection, land on the iteration instead. A container proven to
 * own no iteration (the loop failed before iteration 1 started) is never
 * dropped, so a genuinely distinct execution never disappears.
 */
export function excludeRepresentedLoopContainers<T extends LoopContainerCandidate>(
  executions: readonly T[]
): T[] {
  const isContainer = (exec: LoopContainerCandidate): boolean =>
    exec.node_type === 'loop' &&
    (exec.loop_ancestry === undefined || exec.loop_ancestry.length === 0);

  const isRepresentedByAnIteration = (container: T): boolean =>
    executions.some(candidate => {
      if (candidate.node_id !== container.node_id) return false;
      const ancestry = candidate.loop_ancestry;
      if (ancestry === undefined || ancestry.length === 0) return false;
      if (!ancestryPrefixEquals(ancestry.slice(0, -1), container.loop_ancestry)) return false;
      if (normalizedEpoch(candidate.retry_epoch) !== normalizedEpoch(container.retry_epoch)) {
        return false;
      }
      if (
        normalizedEpoch(candidate.route_activation_seq) !==
        normalizedEpoch(container.route_activation_seq)
      ) {
        return false;
      }
      return (
        candidate.started_at !== undefined &&
        executionWindowContains(container, candidate.started_at)
      );
    });

  return executions.filter(exec => !isContainer(exec) || !isRepresentedByAnIteration(exec));
}

function sameAncestryPrefix(
  left: readonly ExecutionLoopAncestryEntry[],
  right: readonly ExecutionLoopAncestryEntry[]
): boolean {
  const leftPrefix = left.slice(0, -1);
  const rightPrefix = right.slice(0, -1);
  if (leftPrefix.length !== rightPrefix.length) return false;
  for (let index = 0; index < leftPrefix.length; index += 1) {
    const a = leftPrefix[index];
    const b = rightPrefix[index];
    if (a === undefined || b === undefined) return false;
    if (a.nodeId !== b.nodeId || a.iteration !== b.iteration) return false;
  }
  return true;
}

/**
 * Prove a same-lineage live iteration for a finished occurrence selection.
 * Fail closed on any identity doubt — shells only render finished-iteration
 * mode when this returns non-null.
 */
export function resolveFinishedIterationView(input: {
  rows: readonly FinishedIterationRow[];
  selected: FinishedIterationRow;
  nodeStatus: string;
  live: boolean;
}): FinishedIterationView | null {
  if (!input.live) return null;
  if (input.nodeStatus !== 'running' && input.nodeStatus !== 'awaiting') return null;

  const selected = input.selected;
  if (selected.unknownScope === true || selected.status !== 'completed') return null;
  if (selected.selection.kind !== 'occurrence') return null;

  const selectedAncestry = selected.selection.loopAncestry;
  if (selectedAncestry === undefined || selectedAncestry.length === 0) return null;
  const selectedFinal = selectedAncestry[selectedAncestry.length - 1];
  if (selectedFinal === undefined) return null;
  if (selected.selection.iteration !== selectedFinal.iteration) return null;

  const selectedIteration = selectedFinal.iteration;
  const selectedRetry = selected.selection.retryEpoch ?? 0;
  const selectedRoute = selected.selection.routeActivationSeq;

  const candidates = input.rows.filter(row => {
    if (row.id === selected.id) return false;
    if (row.nodeId !== selected.nodeId) return false;
    if (row.unknownScope === true) return false;
    if (row.status !== 'running' && row.status !== 'awaiting') return false;
    if (row.selection.kind !== 'occurrence') return false;

    const ancestry = row.selection.loopAncestry;
    if (ancestry === undefined || ancestry.length === 0) return false;
    const finalEntry = ancestry[ancestry.length - 1];
    if (finalEntry === undefined) return false;
    if (row.selection.iteration !== finalEntry.iteration) return false;
    if (finalEntry.iteration <= selectedIteration) return false;
    if (finalEntry.nodeId !== selectedFinal.nodeId) return false;
    if ((row.selection.retryEpoch ?? 0) !== selectedRetry) return false;

    const candidateRoute = row.selection.routeActivationSeq;
    if (selectedRoute === undefined || candidateRoute === undefined) {
      if (selectedRoute !== candidateRoute) return false;
    } else if (selectedRoute !== candidateRoute) {
      return false;
    }

    return sameAncestryPrefix(ancestry, selectedAncestry);
  });

  if (candidates.length === 0) return null;

  const awaiting = candidates.filter(row => row.status === 'awaiting');
  const preferred =
    awaiting.length > 0
      ? latestByOrder(awaiting)
      : latestByOrder(candidates.filter(row => row.status === 'running'));

  if (preferred.selection.kind !== 'occurrence') return null;
  const preferredAncestry = preferred.selection.loopAncestry;
  if (preferredAncestry === undefined || preferredAncestry.length === 0) return null;
  const preferredFinal = preferredAncestry[preferredAncestry.length - 1];
  if (preferredFinal === undefined) return null;

  return {
    liveRowId: preferred.id,
    liveIteration: preferredFinal.iteration,
  };
}

export function chooseExecutionForInteraction<
  T extends ExecutionChoiceRow & { selection: ExecutionRowSelection },
>(
  rows: readonly T[],
  interaction: {
    node_id: string;
    execution_scope?: { occurrence_id: string; attempt_id: string } | null;
  }
): T | null {
  const forNode = rows.filter(row => row.nodeId === interaction.node_id);
  if (forNode.length === 0) return null;
  if (interaction.execution_scope == null) return latestByOrder(forNode);
  return (
    forNode.find(
      row =>
        row.selection.kind === 'occurrence' &&
        row.selection.occurrenceId === interaction.execution_scope?.occurrence_id &&
        row.selection.attemptId === interaction.execution_scope.attempt_id
    ) ?? null
  );
}

export function runtimeForSelection(
  events: readonly WorkflowEvent[],
  row: ExecutionRow
): { provider: string; model: string } | null {
  const matches = events.filter(event => eventMatchesSelection(event, row));
  if (matches.length === 0) return null;
  const selected = row.selection.kind === 'occurrence' ? matches[0] : matches[matches.length - 1];
  if (selected === undefined) return null;
  const data = asRecord(selected.data);
  if (data === null) return null;
  const provider = stringField(data, 'provider');
  const model = stringField(data, 'model');
  if (provider === null && model === null) return null;
  return { provider: provider ?? '', model: model ?? '' };
}

/**
 * `row.label` carries the log stream's own `×N`/`#N` execution suffix
 * (`labelForExecution` in `build-log-rows.ts`) — useful for scanning a list
 * of many rows, but the room header already states which execution is
 * selected through its own Execution selector, so repeating the suffix in
 * the title is redundant. Strips exactly that trailing suffix; a bare label
 * with no suffix passes through unchanged.
 */
function bareNodeLabel(label: string): string {
  const match = /^(.+) (?:×|#)\d+$/.exec(label);
  return match?.[1] ?? label;
}

export function buildExecutionHeader(input: ExecutionHeaderInput): ExecutionHeaderModel {
  const runtime = runtimeForSelection(input.events, input.row);
  const survivingEpochs =
    input.siblingRows !== undefined
      ? survivingRetryEpochs(input.siblingRows, input.row.selection)
      : null;
  const status = input.nodeStatus ?? input.row.status;
  return {
    nodeId: input.row.nodeId,
    nodeLabel: bareNodeLabel(input.row.label),
    executionLabel: executionLabel(input.row.selection, survivingEpochs),
    status,
    statusReason: status === 'failed' ? (input.nodeError ?? null) : null,
    startedOffsetMs: startedOffsetMs(input.row, input.runStartedAt),
    startedAt: input.row.startedAt ?? null,
    durationMs: input.row.durationMs ?? null,
    provider: runtime?.provider || null,
    model: runtime?.model || null,
    unknownScope: input.row.unknownScope ?? true,
    isLoopIteration: input.row.selection.kind === 'loop_iteration',
    loopMaxIterations: input.loopMaxIterations ?? null,
  };
}

// ---------------------------------------------------------------------------
// Room header presentation: node-kind chip, status pill, retry count, and the
// second header line. Every function here returns semantic data (labels and
// design-token names) — never a Tailwind class — so Console and Legacy each
// render it with their own JSX while sharing one source of truth.
// ---------------------------------------------------------------------------

export interface NodeKindChip {
  readonly label: string;
  readonly tone: string;
}

/** Kinds sharing an existing `--node-*` token; a script folds into bash, a
 * plannotator gate folds into approval (DESIGN.md precedent) — anything else
 * has no established color and omits the chip rather than inventing one. */
const NODE_KIND_TONE: Readonly<Record<string, string>> = {
  command: 'node-command',
  prompt: 'node-prompt',
  bash: 'node-bash',
  script: 'node-bash',
  loop: 'node-loop',
  approval: 'node-approval',
  plannotator_gate: 'node-approval',
};

export function nodeKindChip(kind: string | null | undefined): NodeKindChip | null {
  if (kind === null || kind === undefined) return null;
  const tone = NODE_KIND_TONE[kind];
  return tone === undefined ? null : { label: kind, tone };
}

export interface StatusPill {
  readonly label: string;
  /** Design-token name, or null for a neutral (no color) pill. */
  readonly tone: string | null;
}

const STATUS_PILL_TONE: Readonly<Record<string, string | null>> = {
  pending: 'accent',
  running: 'accent',
  awaiting: 'warning',
  completed: 'success',
  failed: 'error',
  skipped: null,
  cancelled: null,
};

const STATUS_PILL_LABEL: Readonly<Record<string, string>> = {
  pending: 'Pending',
  running: 'Running',
  awaiting: 'Waiting on you',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

/**
 * A restart-recovery signal overrides the row's own lifecycle-status pill:
 * the row is still non-terminal (`running`/`awaiting`), but no live provider
 * process backs it, so `Running` would claim a process that no longer
 * exists. The server tells the client this explicitly (`execution_state` on
 * the steering queue read) — it is never guessed from a timer.
 */
export function statusPill(status: string, recoveryRequired = false): StatusPill {
  if (recoveryRequired) return { label: 'Recovery required', tone: 'warning' };
  return {
    label: STATUS_PILL_LABEL[status] ?? status,
    tone: STATUS_PILL_TONE[status] ?? null,
  };
}

export interface RunOfTotal {
  readonly run: number;
  readonly total: number;
}

interface RunFamilyRow {
  readonly id: string;
  readonly status: string;
  readonly selection: ExecutionRowSelection;
}

/**
 * Retry position and count for the selected row among sibling rows in the
 * same iteration and route slot. A resume's `node_skipped_prior_success`
 * marker can carry a different retry epoch than the real row it stands in
 * for without being a second run, so skipped rows never count toward the
 * total. Null when the selection carries no retry identity, or the slot only
 * ever ran once.
 */
export function computeRunOfTotal(
  rows: readonly RunFamilyRow[],
  selectedId: string
): RunOfTotal | null {
  const selected = rows.find(candidate => candidate.id === selectedId);
  if (selected?.selection.kind !== 'occurrence') return null;
  const epochs = survivingRetryEpochs(rows, selected.selection);
  if (epochs === null || epochs.size <= 1) return null;
  const selectedEpoch = selected.selection.retryEpoch ?? 0;
  return { run: retryRunNumber(epochs, selectedEpoch), total: epochs.size };
}

/** The retry epoch an iteration selection belongs to, or null when the
 * selection is not one iteration of a loop node at all. The legacy
 * `loop_iteration` kind (pre-occurrence-tracking history) never carries a
 * retry epoch of its own — there is only ever one such live run at a time,
 * so every row of that kind belongs to the same run. */
function iterationRetryEpoch(selection: ExecutionRowSelection): number | null {
  if (selection.kind === 'loop_iteration') return 0;
  if (selection.kind === 'occurrence' && selection.iteration !== undefined) {
    return selection.retryEpoch ?? 0;
  }
  return null;
}

/**
 * How many iterations belong to the selected row's OWN run (retry epoch) —
 * the header's "of N" caption pairs this against the loop's configured cap
 * ("· max M"), so both numbers must describe the same run. Counting every
 * iteration across every retry instead reads as impossible the moment a
 * single-iteration loop retries even once ("of 2 · max 1"): "of N" would
 * count retry executions while "max M" caps iterations per run. Null when
 * the selected row is not a loop iteration at all, so the caller keeps
 * using its own generic execution count for every other node kind.
 */
export function computeLoopIterationCount(
  rows: readonly RunFamilyRow[],
  selectedId: string
): number | null {
  const selected = rows.find(candidate => candidate.id === selectedId);
  if (selected === undefined) return null;
  const selectedEpoch = iterationRetryEpoch(selected.selection);
  if (selectedEpoch === null) return null;
  return rows.filter(candidate => iterationRetryEpoch(candidate.selection) === selectedEpoch)
    .length;
}

function startedClockLabel(startedAt: string): string | null {
  const parsed = new Date(ensureUtc(startedAt));
  if (Number.isNaN(parsed.getTime())) return null;
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `started ${hours}:${minutes}`;
}

export interface HeaderMetaLineInput {
  readonly startedAt: string | null;
  readonly status: string;
  readonly durationMs: number | null;
  readonly runOfTotal: RunOfTotal | null;
  readonly provider: string | null;
  readonly model: string | null;
  /** Latest terminal execution failed for idle-await expiry. Default false. */
  readonly idleAwaitExpired?: boolean;
  /** The node's own failure reason (`ExecutionHeaderModel.statusReason`), shown
   * in place of the duration segment while `status` is `failed` and no more
   * specific reason (idle-await expiry) applies. Default null. */
  readonly statusReason?: string | null;
  /** Set only when viewing a finished iteration while the node runs live
   * elsewhere; the run count is not meaningful for that stale history view. */
  readonly iterationPrefix?: number | null;
  /** Server-reported restart recovery — see `statusPill`. Default false. */
  readonly recoveryRequired?: boolean;
}

/** The live segment a restart-recovery meta line reports instead of `running…`. */
const RECOVERY_REQUIRED_META_SEGMENT = 'restored after server restart';

const LIVE_META_STATUSES: ReadonlySet<string> = new Set(['running', 'awaiting']);

/**
 * The room header's second line: which iteration this is (only when viewing
 * finished history), start clock time, live/duration/idle-timeout state,
 * retry count, provider, and model. Each segment appears only when its own
 * data exists; the whole line is null when nothing is known yet.
 */
export function headerMetaLine(input: HeaderMetaLineInput): string | null {
  const viewingStaleIteration =
    input.iterationPrefix !== undefined && input.iterationPrefix !== null;
  const segments: string[] = [];
  if (viewingStaleIteration) {
    segments.push(`iteration ${String(input.iterationPrefix)}`);
  }
  if (input.startedAt !== null) {
    const clock = startedClockLabel(input.startedAt);
    if (clock !== null) segments.push(clock);
  }
  if (input.recoveryRequired === true) {
    segments.push(RECOVERY_REQUIRED_META_SEGMENT);
  } else if (input.status === 'failed' && input.idleAwaitExpired === true) {
    segments.push('failed after idle timeout');
  } else if (
    input.status === 'failed' &&
    input.statusReason !== null &&
    input.statusReason !== undefined &&
    input.statusReason.length > 0
  ) {
    segments.push(input.statusReason);
  } else if (LIVE_META_STATUSES.has(input.status)) {
    segments.push('running…');
  } else if (input.durationMs !== null) {
    segments.push(formatDurationLong(input.durationMs));
  }
  if (!viewingStaleIteration && input.runOfTotal !== null) {
    segments.push(`run ${String(input.runOfTotal.run)} of ${String(input.runOfTotal.total)}`);
  }
  if (input.provider !== null) segments.push(input.provider);
  if (input.model !== null) segments.push(input.model);
  return segments.length > 0 ? segments.join(' · ') : null;
}

export function roomOpenerId(surface: RoomSurface, kind: RoomOpenerKind, key: string): string {
  return `${surface}-${kind}-${encodeURIComponent(key)}`;
}

export function askCardId(requestId: string, mountContext?: string): string {
  const base = `run-ask-card-${encodeURIComponent(requestId)}`;
  return mountContext === undefined || mountContext === 'default'
    ? base
    : `${base}-${encodeURIComponent(mountContext)}`;
}

export interface RoomVisitSelection {
  nodeId: string;
  rowId: string;
  openerId: string | null;
}

export interface RoomVisitState {
  runId: string;
  selection: RoomVisitSelection | null;
  lastExplicitRowByNode: Record<string, string>;
  appliedDeepLinkNode: string | null;
  scrollTopByScope: Record<string, number>;
}

export function resetRoomVisit(runId: string): RoomVisitState {
  return {
    runId,
    selection: null,
    lastExplicitRowByNode: {},
    appliedDeepLinkNode: null,
    scrollTopByScope: {},
  };
}

export function openRoom(state: RoomVisitState, selection: RoomVisitSelection): RoomVisitState {
  return { ...state, selection };
}

export function openExplicitRoom(
  state: RoomVisitState,
  selection: RoomVisitSelection
): RoomVisitState {
  return {
    ...openRoom(state, selection),
    lastExplicitRowByNode: {
      ...state.lastExplicitRowByNode,
      [selection.nodeId]: selection.rowId,
    },
  };
}

export function closeRoom(state: RoomVisitState): RoomVisitState {
  return { ...state, selection: null };
}

export function rememberRoomScroll(
  state: RoomVisitState,
  scopeKey: string,
  scrollTop: number
): RoomVisitState {
  return {
    ...state,
    scrollTopByScope: { ...state.scrollTopByScope, [scopeKey]: scrollTop },
  };
}

export function applyRoomDeepLink(
  state: RoomVisitState,
  queryNode: string | null,
  rows: readonly ExecutionChoiceRow[]
): RoomVisitState {
  if (queryNode === null) {
    if (state.appliedDeepLinkNode === null) return state;
    return { ...state, appliedDeepLinkNode: null };
  }
  if (state.appliedDeepLinkNode === queryNode) return state;
  const row = chooseExecutionForNode(rows, queryNode, state.lastExplicitRowByNode[queryNode]);
  if (row === null) {
    return rows.length === 0 ? state : { ...state, appliedDeepLinkNode: queryNode };
  }
  return openRoom(
    { ...state, appliedDeepLinkNode: queryNode },
    { nodeId: queryNode, rowId: row.id, openerId: null }
  );
}

type NodeExecution = components['schemas']['NodeExecution'];

/** Only completed/failed/skipped are terminal raw execution statuses. */
function isTerminalNodeExecutionStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'skipped';
}

function compareWorkflowEvents(left: WorkflowEvent, right: WorkflowEvent): number {
  const orderLeft = left.event_order ?? Number.MAX_SAFE_INTEGER;
  const orderRight = right.event_order ?? Number.MAX_SAFE_INTEGER;
  if (orderLeft !== orderRight) return orderLeft - orderRight;
  const leftMs = Date.parse(left.created_at);
  const rightMs = Date.parse(right.created_at);
  const byTime = (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

/**
 * True when any raw execution is still open. Undefined/empty history is settled
 * (no catch-up traffic). Unknown future statuses fail closed as unsettled.
 */
export function hasUnsettledNodeExecutions(
  executions: readonly NodeExecution[] | null | undefined
): boolean {
  if (executions === null || executions === undefined || executions.length === 0) {
    return false;
  }
  return executions.some(execution => !isTerminalNodeExecutionStatus(execution.status));
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Live runs poll every 3s. Terminal runs keep the same 3s cadence only while
 * raw nodeExecutions still contain an unsettled row; otherwise polling stops.
 */
export function resolveRunDetailRefetchIntervalMs(
  status: string | undefined,
  executions: readonly NodeExecution[] | null | undefined
): number | false {
  if (status !== undefined && isTerminalRunStatus(status)) {
    return hasUnsettledNodeExecutions(executions) ? 3000 : false;
  }
  return 3000;
}

/**
 * True only when the selected node has ≥1 raw execution and every one of them
 * is terminal. Sibling history never marks the selected node terminal.
 */
export function hasTerminalNodeEvidence(
  executions: readonly NodeExecution[] | null | undefined,
  nodeId: string
): boolean {
  if (executions === null || executions === undefined || executions.length === 0) {
    return false;
  }
  const forNode = executions.filter(execution => execution.node_id === nodeId);
  if (forNode.length === 0) return false;
  return forNode.every(execution => isTerminalNodeExecutionStatus(execution.status));
}

/**
 * True when the selected node's latest terminal execution failed with the
 * idle-await expiry error. Requires ≥1 row for the node and every row terminal
 * so reconciliation cannot race a new attempt. Latest row is highest
 * retry_epoch (missing = 0), then started_at ?? ended_at ?? '', then later
 * original array position. Evaluates the actual selected id — grp.body vs grp
 * composite errors must not cross.
 */
export function hasIdleAwaitExpiredEvidence(
  executions: readonly NodeExecution[] | null | undefined,
  nodeId: string
): boolean {
  if (executions === null || executions === undefined || executions.length === 0) {
    return false;
  }
  const forNode: { execution: NodeExecution; index: number }[] = [];
  for (let index = 0; index < executions.length; index += 1) {
    const execution = executions[index];
    if (execution?.node_id === nodeId) {
      forNode.push({ execution, index });
    }
  }
  if (forNode.length === 0) return false;
  if (!forNode.every(entry => isTerminalNodeExecutionStatus(entry.execution.status))) {
    return false;
  }

  let latest: { execution: NodeExecution; index: number } | undefined;
  for (const candidate of forNode) {
    if (latest === undefined) {
      latest = candidate;
      continue;
    }
    const latestEpoch = latest.execution.retry_epoch ?? 0;
    const candidateEpoch = candidate.execution.retry_epoch ?? 0;
    if (candidateEpoch !== latestEpoch) {
      if (candidateEpoch > latestEpoch) latest = candidate;
      continue;
    }
    const latestTs = latest.execution.started_at ?? latest.execution.ended_at ?? '';
    const candidateTs = candidate.execution.started_at ?? candidate.execution.ended_at ?? '';
    if (candidateTs !== latestTs) {
      if (candidateTs > latestTs) latest = candidate;
      continue;
    }
    if (candidate.index > latest.index) latest = candidate;
  }
  if (latest === undefined) return false;

  return (
    latest.execution.status === 'failed' && latest.execution.error === IDLE_AWAIT_EXPIRED_ERROR
  );
}

/**
 * Stable logical execution key for a node from ordered raw events.
 * Ask resume (`interaction_resolved` kind ask + resumed true) keeps the prior
 * key across the next same-node start; every other start adopts occurrence/event
 * identity. Loop-iteration starts and siblings are ignored.
 */
export function latestNodeExecutionKey(
  events: readonly WorkflowEvent[] | null | undefined,
  nodeId: string
): string | null {
  if (events === null || events === undefined || events.length === 0) return null;

  let key: string | null = null;
  let askContinuationArmed = false;

  for (const event of events.slice().sort(compareWorkflowEvents)) {
    if (event.step_name !== nodeId) continue;

    if (event.event_type === 'interaction_resolved') {
      const data = event.data as Record<string, unknown>;
      if (data.kind === 'ask' && data.resumed === true) {
        askContinuationArmed = true;
      }
      continue;
    }

    if (
      event.event_type === 'node_retry_requested' ||
      event.event_type === 'node_completed' ||
      event.event_type === 'node_failed' ||
      event.event_type === 'node_skipped' ||
      event.event_type === 'node_skipped_prior_success'
    ) {
      askContinuationArmed = false;
      continue;
    }

    if (event.event_type !== 'node_started') continue;

    const occurrence = (event.data as Record<string, unknown>).occurrence_id;
    const identity =
      typeof occurrence === 'string' && occurrence.length > 0 ? occurrence : event.id;

    if (askContinuationArmed) {
      askContinuationArmed = false;
      if (key === null) {
        key = identity;
      }
      continue;
    }

    key = identity;
  }

  return key;
}
