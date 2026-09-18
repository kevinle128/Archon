/**
 * Renderer-free fold of recorded todo tool inputs into current checklist state.
 *
 * Two provider shapes share the concept and nothing else:
 * - Claude `TodoWrite`: `{ todos: [{ content, status, activeForm }] }`, a
 *   whole-list snapshot with three explicit statuses and no phases. Folding is
 *   last-call-wins onto a single `Tasks` phase.
 * - OMP `todo`: `{ op, ... }` mutations over named phases, plus the legacy
 *   `{ ops: [...] }` batch. Status is implied by which op ran.
 *
 * Every call applies to a scratch copy and commits only on success, so a
 * malformed call never manufactures a state the provider did not commit. After
 * each successful mutating OMP op the state is normalized: at most one
 * in-progress item survives, and the first pending item is promoted when none
 * is running. `view` is a true read-only no-op — it does not even normalize.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  blocker?: string;
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
  return item.blocker === undefined
    ? { content: item.content, status: item.status }
    : { content: item.content, status: item.status, blocker: item.blocker };
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
