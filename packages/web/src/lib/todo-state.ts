/**
 * Renderer-free fold of recorded todo tool inputs into current checklist state.
 *
 * Three provider shapes share the concept and nothing else:
 * - Claude `TodoWrite`: `{ todos: [{ content, status, activeForm }] }`, a
 *   whole-list snapshot with three explicit statuses and no phases. Folding is
 *   last-call-wins onto a single `Tasks` phase.
 * - OMP `todo`: `{ op, ... }` mutations over named phases, plus the legacy
 *   `{ ops: [...] }` batch. Status is implied by which op ran.
 * - Claude `TaskCreate`/`TaskUpdate`: one task per call, identified by a
 *   `taskId` the caller stamps onto the record (the tool assigns it in its
 *   *output*, which this module never sees — see `TodoItem.id`), not by its
 *   renamable `content`. All Task-family items live in one `Tasks` phase,
 *   like `TodoWrite`; a call the caller cannot correlate to a known id is a
 *   no-op, never a fabricated blank row.
 *
 * Every call applies to a scratch copy and commits only on success, so a
 * malformed call never manufactures a state the provider did not commit. After
 * each successful mutating OMP op the state is normalized: at most one
 * in-progress item survives, and the first pending item is promoted when none
 * is running. `view` is a true read-only no-op — it does not even normalize.
 * Task-family calls skip this normalization entirely: unlike OMP, Claude's
 * own tool never implies a side effect on a task the call did not name.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  blocker?: string;
  /**
   * Stable identity for a source whose items can be renamed after creation
   * (Claude's `TaskCreate`/`TaskUpdate`, keyed by `taskId`) — `content` is
   * not safe to match on there the way OMP's and TodoWrite's immutable
   * `content` already is. Undefined for every other source.
   * `projectTerminalTodoState`'s rebuilt items drop it, matching `blocker`:
   * once a checklist reaches its terminal presentation it never folds again.
   */
  id?: string;
}

export interface TodoPhase {
  phase: string;
  items: TodoItem[];
}

export interface TodoSummary {
  done: number;
  total: number;
  current: TodoItem | null;
}

export const TODO_STATUS_PRESENTATION: Readonly<
  Record<TodoStatus, Readonly<{ glyph: string; label: string }>>
> = {
  completed: { glyph: '☑', label: 'completed' },
  in_progress: { glyph: '◐', label: 'in progress' },
  blocked: { glyph: '⊘', label: 'blocked' },
  pending: { glyph: '☐', label: 'pending' },
  abandoned: { glyph: '☐', label: 'abandoned' },
};

type TodoOp = 'init' | 'append' | 'start' | 'done' | 'drop' | 'block' | 'unblock' | 'rm' | 'view';

const KNOWN_OPS: ReadonlySet<string> = new Set([
  'init',
  'append',
  'start',
  'done',
  'drop',
  'block',
  'unblock',
  'rm',
  'view',
]);

const CLAUDE_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

const DEFAULT_PHASE = 'Tasks';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneItem(item: TodoItem): TodoItem {
  const clone: TodoItem = { content: item.content, status: item.status };
  if (item.blocker !== undefined) clone.blocker = item.blocker;
  if (item.id !== undefined) clone.id = item.id;
  return clone;
}

function clonePhases(phases: readonly TodoPhase[]): TodoPhase[] {
  return phases.map(phase => ({ phase: phase.phase, items: phase.items.map(cloneItem) }));
}

function findTask(
  phases: readonly TodoPhase[],
  content: string
): { item: TodoItem; phase: TodoPhase } | null {
  for (const phase of phases) {
    const item = phase.items.find(candidate => candidate.content === content);
    if (item) return { item, phase };
  }
  return null;
}

/**
 * Collapse in-progress to the first running task and, when none remains,
 * promote the first pending one. Runs only after a successful mutating op, so
 * a call can change a task it never named.
 */
function normalizeInProgress(phases: TodoPhase[]): void {
  const all = phases.flatMap(phase => phase.items);
  if (all.length === 0) return;
  const running = all.filter(item => item.status === 'in_progress');
  for (const extra of running.slice(1)) {
    extra.status = 'pending';
  }
  if (running.length > 0) return;
  const firstPending = all.find(item => item.status === 'pending');
  if (firstPending) firstPending.status = 'in_progress';
}

/**
 * Resolve one record to an OMP op. Returns null when the record cannot be
 * resolved — the caller treats that as a no-op for a single call or as an
 * invalid entry inside an `{ops:[…]}` batch.
 */
function resolveOp(phases: readonly TodoPhase[], record: Record<string, unknown>): TodoOp | null {
  const raw = record.op;
  if (raw !== undefined) {
    return typeof raw === 'string' && KNOWN_OPS.has(raw) ? (raw as TodoOp) : null;
  }
  const list = record.list;
  if (Array.isArray(list) && list.length > 0) return 'init';
  const items = record.items;
  if (Array.isArray(items) && items.length > 0) {
    const phase = record.phase;
    if (typeof phase === 'string' && phase) return 'append';
    if (phases.length === 0) return 'init';
  }
  return null;
}

function applyInit(record: Record<string, unknown>): TodoPhase[] | null {
  const rawList = record.list;
  if (rawList !== undefined && rawList !== null) {
    if (!Array.isArray(rawList)) return null;
    const phases: TodoPhase[] = [];
    const seenPhases = new Set<string>();
    const seenTasks = new Set<string>();
    for (const listEntry of rawList) {
      if (!isRecord(listEntry)) return null;
      const phaseName = listEntry.phase;
      const items = listEntry.items;
      if (typeof phaseName !== 'string' || !Array.isArray(items) || items.length === 0) {
        return null;
      }
      if (seenPhases.has(phaseName)) return null;
      seenPhases.add(phaseName);
      const phaseItems: TodoItem[] = [];
      for (const content of items) {
        if (typeof content !== 'string' || seenTasks.has(content)) return null;
        seenTasks.add(content);
        phaseItems.push({ content, status: 'pending' });
      }
      phases.push({ phase: phaseName, items: phaseItems });
    }
    return phases;
  }
  const rawItems = record.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const phaseField = record.phase;
  if (phaseField !== undefined && phaseField !== null && typeof phaseField !== 'string') {
    return null;
  }
  const phaseName = phaseField === undefined || phaseField === null ? DEFAULT_PHASE : phaseField;
  const seen = new Set<string>();
  const items: TodoItem[] = [];
  for (const content of rawItems) {
    if (typeof content !== 'string' || seen.has(content)) return null;
    seen.add(content);
    items.push({ content, status: 'pending' });
  }
  return [{ phase: phaseName, items }];
}

function applyAppend(phases: TodoPhase[], record: Record<string, unknown>): TodoPhase[] | null {
  const phaseName = record.phase;
  if (typeof phaseName !== 'string' || !phaseName) return null;
  const items = record.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const seen = new Set<string>();
  for (const content of items) {
    if (typeof content !== 'string' || seen.has(content) || findTask(phases, content)) {
      return null;
    }
    seen.add(content);
  }
  let target = phases.find(phase => phase.phase === phaseName);
  if (!target) {
    target = { phase: phaseName, items: [] };
    phases.push(target);
  }
  for (const content of items) {
    target.items.push({ content, status: 'pending' });
  }
  return phases;
}

function applyStart(phases: TodoPhase[], record: Record<string, unknown>): TodoPhase[] | null {
  const task = record.task;
  if (typeof task !== 'string' || !task) return null;
  const hit = findTask(phases, task);
  if (!hit) return null;
  for (const phase of phases) {
    for (const candidate of phase.items) {
      if (candidate.status === 'in_progress' && candidate !== hit.item) {
        candidate.status = 'pending';
      }
    }
  }
  hit.item.status = 'in_progress';
  return phases;
}

/**
 * Resolve the provider's task/phase/all targeting: a truthy `task` or `phase`
 * must match exactly, and neither means every task in every phase.
 */
function resolveTargets(phases: TodoPhase[], record: Record<string, unknown>): TodoItem[] | null {
  const task = record.task;
  const phase = record.phase;
  // Optional target fields still have to be strings when present. Without
  // this guard, malformed falsy values such as `task: 0` fall through to the
  // provider's bare all-target form and can complete/drop every task.
  if (task !== undefined && typeof task !== 'string') return null;
  if (phase !== undefined && typeof phase !== 'string') return null;
  if (task) {
    const hit = findTask(phases, task);
    return hit ? [hit.item] : null;
  }
  if (phase) {
    const target = phases.find(candidate => candidate.phase === phase);
    return target ? [...target.items] : null;
  }
  return phases.flatMap(phase => phase.items);
}

function applySetStatus(
  phases: TodoPhase[],
  record: Record<string, unknown>,
  status: 'completed' | 'abandoned'
): TodoPhase[] | null {
  const targets = resolveTargets(phases, record);
  if (!targets) return null;
  for (const task of targets) {
    task.status = status;
  }
  return phases;
}

function applyBlock(phases: TodoPhase[], record: Record<string, unknown>): TodoPhase[] | null {
  if (!record.task && !record.phase) return null;
  const reason = record.reason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') return null;
  const blocker =
    typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() || undefined : undefined;
  const targets = resolveTargets(phases, record);
  if (!targets) return null;
  for (const task of targets) {
    if (task.status !== 'pending' && task.status !== 'in_progress' && task.status !== 'blocked') {
      continue;
    }
    task.status = 'blocked';
    if (blocker === undefined) {
      delete task.blocker;
    } else {
      task.blocker = blocker;
    }
  }
  return phases;
}

function applyUnblock(phases: TodoPhase[], record: Record<string, unknown>): TodoPhase[] | null {
  if (!record.task && !record.phase) return null;
  const targets = resolveTargets(phases, record);
  if (!targets) return null;
  for (const task of targets) {
    if (task.status === 'blocked') {
      task.status = 'pending';
      delete task.blocker;
    }
  }
  return phases;
}

function applyRemove(phases: TodoPhase[], record: Record<string, unknown>): TodoPhase[] | null {
  const task = record.task;
  const phaseName = record.phase;
  if (task !== undefined && typeof task !== 'string') return null;
  if (phaseName !== undefined && typeof phaseName !== 'string') return null;
  if (task) {
    const hit = findTask(phases, task);
    if (!hit) return null;
    hit.phase.items = hit.phase.items.filter(candidate => candidate !== hit.item);
    return phases;
  }
  if (phaseName) {
    const target = phases.find(phase => phase.phase === phaseName);
    if (!target) return null;
    target.items = [];
    return phases;
  }
  for (const phase of phases) {
    phase.items = [];
  }
  return phases;
}

/**
 * Apply one resolved op to `phases`, returning the next working state or null
 * when the call is rejected. `init` returns a fresh array; the other ops
 * mutate the scratch in place. `view` succeeds without touching anything.
 */
function applyOp(
  phases: TodoPhase[],
  op: TodoOp,
  record: Record<string, unknown>
): TodoPhase[] | null {
  switch (op) {
    case 'init':
      return applyInit(record);
    case 'append':
      return applyAppend(phases, record);
    case 'start':
      return applyStart(phases, record);
    case 'done':
      return applySetStatus(phases, record, 'completed');
    case 'drop':
      return applySetStatus(phases, record, 'abandoned');
    case 'block':
      return applyBlock(phases, record);
    case 'unblock':
      return applyUnblock(phases, record);
    case 'rm':
      return applyRemove(phases, record);
    case 'view':
      return phases;
  }
}

/**
 * Validate a whole Claude snapshot and build the replacement phase. Returns
 * null — rejecting the entire call — when any entry lacks a string `content`
 * or one of Claude's three statuses.
 */
function applyClaudeSnapshot(todos: readonly unknown[]): TodoPhase[] | null {
  const items: TodoItem[] = [];
  for (const entry of todos) {
    if (!isRecord(entry)) return null;
    const { content, status } = entry;
    if (typeof content !== 'string' || typeof status !== 'string' || !CLAUDE_STATUSES.has(status)) {
      return null;
    }
    items.push({ content, status: status as TodoStatus });
  }
  return items.length === 0 ? [] : [{ phase: DEFAULT_PHASE, items }];
}

function findTaskById(phases: readonly TodoPhase[], id: string): TodoItem | null {
  for (const phase of phases) {
    const item = phase.items.find(candidate => candidate.id === id);
    if (item !== undefined) return item;
  }
  return null;
}

/** Claude's `TaskUpdate.status` values this fold recognizes; anything else is malformed. */
const TASK_UPDATE_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'in_progress',
  'completed',
  'deleted',
]);

/**
 * Widens Claude's four `TaskUpdate` statuses into the shared five. `deleted`
 * has no direct match — OMP's `drop` already means "no longer active, not
 * completed" and renders the same struck-through way, so it is the nearest
 * honest analogue rather than a new status this contract would have to add.
 */
const TASK_STATUS_TO_TODO: Readonly<Record<string, TodoStatus>> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'completed',
  deleted: 'abandoned',
};

/**
 * Upsert one `TaskCreate`/`TaskUpdate` call by its `taskId` — every
 * Task-family record carries this key by the time it reaches this fold
 * (`agent-history.ts` merges a `TaskCreate` call's output-assigned id onto
 * its input under the same key `TaskUpdate` already sends natively). All
 * Task-family items live in the one `Tasks` phase; the tool has no phase
 * concept of its own. Only `subject` (title) and `status` drive the
 * checklist — `description`, `activeForm`, `addBlocks`, `addBlockedBy`,
 * `owner`, and `metadata` are real fields the agent reads but carry nothing
 * a flat checklist renders. A `taskId` this fold has not seen before, with
 * no `subject` to establish it, is rejected rather than fabricating a blank
 * row — the same "unknown target is a no-op" rule OMP's own `findTask`
 * already enforces.
 */
function applyTaskRecord(phases: TodoPhase[], record: Record<string, unknown>): TodoPhase[] | null {
  const taskId = record.taskId;
  if (typeof taskId !== 'string' || taskId.length === 0) return null;
  const subject = record.subject;
  if (subject !== undefined && (typeof subject !== 'string' || subject.length === 0)) return null;
  const status = record.status;
  if (status !== undefined && (typeof status !== 'string' || !TASK_UPDATE_STATUSES.has(status))) {
    return null;
  }
  const existing = findTaskById(phases, taskId);
  if (existing === null) {
    if (typeof subject !== 'string') return null;
    let target = phases.find(candidate => candidate.phase === DEFAULT_PHASE);
    if (target === undefined) {
      target = { phase: DEFAULT_PHASE, items: [] };
      phases.push(target);
    }
    target.items.push({
      content: subject,
      status: typeof status === 'string' ? TASK_STATUS_TO_TODO[status] : 'pending',
      id: taskId,
    });
    return phases;
  }
  if (typeof subject === 'string') existing.content = subject;
  if (typeof status === 'string') existing.status = TASK_STATUS_TO_TODO[status];
  return phases;
}

/**
 * Fold ordered tool inputs into the current todo phases. Never throws, never
 * mutates inputs, and returns fresh objects containing only non-empty phases.
 */
export function projectTodoState(inputs: readonly unknown[]): TodoPhase[] {
  let state: TodoPhase[] = [];
  for (const input of inputs) {
    if (!isRecord(input)) continue;
    if (Array.isArray(input.todos)) {
      const snapshot = applyClaudeSnapshot(input.todos);
      if (snapshot !== null) state = snapshot;
      continue;
    }
    if (typeof input.taskId === 'string' && input.taskId.length > 0) {
      const scratch = clonePhases(state);
      const next = applyTaskRecord(scratch, input);
      if (next !== null) state = next;
      continue;
    }
    if (Array.isArray(input.ops)) {
      let scratch = clonePhases(state);
      let ok = true;
      for (const entry of input.ops) {
        if (!isRecord(entry)) {
          ok = false;
          break;
        }
        const op = resolveOp(scratch, entry);
        if (op === null) {
          ok = false;
          break;
        }
        const next = applyOp(scratch, op, entry);
        if (next === null) {
          ok = false;
          break;
        }
        scratch = next;
        if (op !== 'view') normalizeInProgress(scratch);
      }
      if (ok) state = scratch;
      continue;
    }
    const op = resolveOp(state, input);
    if (op === null) continue;
    const scratch = clonePhases(state);
    const next = applyOp(scratch, op, input);
    if (next === null) continue;
    const committed = next;
    if (op !== 'view') normalizeInProgress(committed);
    state = committed;
  }
  return state
    .filter(phase => phase.items.length > 0)
    .map(phase => ({ phase: phase.phase, items: phase.items.map(cloneItem) }));
}

/** Node lifecycle statuses that reach the checklist's terminal projection. */
export type TodoTerminalOutcome = 'completed' | 'interrupted';

const TODO_TERMINAL_OUTCOME_BY_NODE_STATUS: Readonly<Record<string, TodoTerminalOutcome>> = {
  completed: 'completed',
  failed: 'interrupted',
  // `LogRow['status']` folds a cancelled execution into `skipped`
  // (`statusFromNodeExecution` in build-log-rows.ts) — a cancelled row's own
  // status is never literally `'cancelled'`. `cancelled` stays mapped too
  // for a caller holding the run-level status instead of the row's.
  cancelled: 'interrupted',
  skipped: 'interrupted',
};

/**
 * The node lifecycle status a checklist reads to pick its terminal outcome,
 * or null while the node is still `pending`/`running`/`awaiting`/`skipped` —
 * the raw folded state renders unprojected in every one of those.
 */
export function todoTerminalOutcome(nodeStatus: string): TodoTerminalOutcome | null {
  return TODO_TERMINAL_OUTCOME_BY_NODE_STATUS[nodeStatus] ?? null;
}

/**
 * A single item's terminal projection. A completed node finished the plan it
 * declared, so every item still short of `completed` reads as done — this
 * never applies to `abandoned`, which is already the agent's own terminal
 * claim about that item, not a claim this projection gets to overrule. An
 * interrupted node proved nothing about work still in flight, so only the
 * `in_progress` item — the one the strip would otherwise show mid-run forever
 * — steps back to `pending`; every other status already recorded the
 * agent's own verdict and stays exactly as folded.
 */
function projectTerminalItem(itemValue: TodoItem, outcome: TodoTerminalOutcome): TodoItem {
  if (outcome === 'completed') {
    if (itemValue.status === 'completed' || itemValue.status === 'abandoned') return itemValue;
    return { content: itemValue.content, status: 'completed' };
  }
  return itemValue.status === 'in_progress'
    ? { content: itemValue.content, status: 'pending' }
    : itemValue;
}

/**
 * Presentation-only terminal fold: never rewrites the persisted todo events
 * `projectTodoState` already committed, only the phases a renderer is about
 * to draw for a node that has reached a terminal lifecycle status. Returns
 * the input unchanged while the node is still live.
 */
export function projectTerminalTodoState(
  phases: readonly TodoPhase[],
  nodeStatus: string
): readonly TodoPhase[] {
  const outcome = todoTerminalOutcome(nodeStatus);
  if (outcome === null) return phases;
  return phases.map(phase => ({
    phase: phase.phase,
    items: phase.items.map(item => projectTerminalItem(item, outcome)),
  }));
}

/**
 * Flatten phases into headline data: completed count, total, and the
 * representative item — first in-progress, else first blocked, else last
 * completed, else the first remaining item, else null.
 */
export function summarizeTodoState(phases: readonly TodoPhase[]): TodoSummary {
  let done = 0;
  let total = 0;
  let firstInProgress: TodoItem | undefined;
  let firstBlocked: TodoItem | undefined;
  let lastCompleted: TodoItem | undefined;
  let firstItem: TodoItem | undefined;
  for (const phase of phases) {
    for (const item of phase.items) {
      total += 1;
      if (!firstItem) firstItem = item;
      if (item.status === 'completed') {
        done += 1;
        lastCompleted = item;
      } else if (item.status === 'in_progress' && !firstInProgress) {
        firstInProgress = item;
      } else if (item.status === 'blocked' && !firstBlocked) {
        firstBlocked = item;
      }
    }
  }
  const current = firstInProgress ?? firstBlocked ?? lastCompleted ?? firstItem ?? null;
  return { done, total, current: current ? cloneItem(current) : null };
}
