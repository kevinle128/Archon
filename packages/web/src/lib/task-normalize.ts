/**
 * Render-neutral normalization of a stored task-dispatch tool input.
 * Two provider shapes collapse to one canonical model: OMP's batch
 * `{ context?, tasks: [{ name, agent, task }] }` and Claude's single
 * `{ description, prompt, subagent_type? }`. Validation is all-or-nothing —
 * malformed or over-budget input returns null so the presenter falls back to
 * the bounded generic body; it never truncates a card or returns a partial
 * batch. Dependency-free and React-free on purpose: tool-presentation.ts
 * imports this module, so importing back would cycle.
 */

export const MAX_TASK_SUBTASKS = 64;
export const MAX_TASK_IDENTIFIER_CODE_UNITS = 256;
export const MAX_TASK_TOTAL_TEXT_CODE_UNITS = 256 * 1024;
export const MAX_TASK_EXCERPT_CODE_POINTS = 160;

export interface TaskSubtask {
  name: string;
  agent: string | null;
  prompt: string;
}

export interface NormalizedTaskDispatch {
  mode: 'batch' | 'single';
  context: string;
  subtasks: TaskSubtask[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Trimmed identifier within the code-unit bound, or null when blank/over-long. */
function boundedIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_IDENTIFIER_CODE_UNITS) {
    return null;
  }
  return trimmed;
}

function normalizeBatch(record: Record<string, unknown>): NormalizedTaskDispatch | null {
  const rawTasks = record.tasks;
  if (!Array.isArray(rawTasks)) {
    return null;
  }

  // Enforce the cumulative bound before trimming/scanning context content.
  // `rawTasks.length` is captured so a caller-controlled array iterator (or a
  // later length mutation) cannot make this walk exceed MAX_TASK_SUBTASKS.
  const taskCount = rawTasks.length;
  if (!Number.isInteger(taskCount) || taskCount < 1 || taskCount > MAX_TASK_SUBTASKS) {
    return null;
  }
  // Optional batch context: absent/blank becomes '', a present non-string
  // rejects the dispatch, and a non-blank string is preserved verbatim.
  const rawContext = record.context;
  let total = 0;
  let context = '';
  if (rawContext === undefined) {
    context = '';
  } else if (typeof rawContext !== 'string') {
    return null;
  } else {
    total = rawContext.length;
    if (total > MAX_TASK_TOTAL_TEXT_CODE_UNITS) return null;
    if (rawContext.trim() !== '') context = rawContext;
  }

  // Sum original UTF-16 lengths before trimming or allocating the result,
  // walking at most MAX_TASK_SUBTASKS entries and rejecting as soon as the
  // cumulative budget is exceeded.
  const raws: { name: string; agent: string; prompt: string }[] = [];
  for (let index = 0; index < taskCount; index++) {
    const element = rawTasks[index];
    const task = asRecord(element);
    if (task === null) return null;
    const name = task.name;
    const agent = task.agent;
    const prompt = task.task;
    if (typeof name !== 'string' || typeof agent !== 'string' || typeof prompt !== 'string') {
      return null;
    }
    total += name.length + agent.length + prompt.length;
    if (total > MAX_TASK_TOTAL_TEXT_CODE_UNITS) return null;
    raws.push({ name, agent, prompt });
  }

  const subtasks: TaskSubtask[] = [];
  for (const raw of raws) {
    const name = boundedIdentifier(raw.name);
    const agent = boundedIdentifier(raw.agent);
    if (name === null || agent === null || raw.prompt.trim().length === 0) {
      return null;
    }
    subtasks.push({ name, agent, prompt: raw.prompt });
  }
  return { mode: 'batch', context, subtasks };
}

function normalizeSingle(record: Record<string, unknown>): NormalizedTaskDispatch | null {
  const description = record.description;
  const prompt = record.prompt;
  const subagentType = record.subagent_type;
  if (typeof description !== 'string' || typeof prompt !== 'string') return null;
  if (subagentType !== undefined && typeof subagentType !== 'string') return null;

  const total =
    description.length +
    prompt.length +
    (typeof subagentType === 'string' ? subagentType.length : 0);
  if (total > MAX_TASK_TOTAL_TEXT_CODE_UNITS) return null;

  const name = boundedIdentifier(description);
  if (name === null || prompt.trim().length === 0) return null;
  // Absent or blank subagent_type maps to a null agent; a non-blank one is a
  // bounded identifier and an over-long one rejects the dispatch.
  let agent: string | null = null;
  if (typeof subagentType === 'string' && subagentType.trim() !== '') {
    agent = boundedIdentifier(subagentType);
    if (agent === null) return null;
  }
  return { mode: 'single', context: '', subtasks: [{ name, agent, prompt }] };
}

/**
 * Canonical dispatch model, or null for malformed/over-budget input. An own
 * `tasks` key selects the OMP batch shape even when Claude-like keys coexist;
 * a malformed tasks value never falls through to the single shape. Throwing
 * getters and exotic values are contained here and yield null.
 */
export function normalizeTaskDispatch(input: unknown): NormalizedTaskDispatch | null {
  try {
    const record = asRecord(input);
    if (record === null) return null;
    if (hasOwn(record, 'tasks')) return normalizeBatch(record);
    return normalizeSingle(record);
  } catch {
    return null;
  }
}

/**
 * Bounded one-line preview of a prompt: whitespace collapsed, at most
 * MAX_TASK_EXCERPT_CODE_POINTS code points (never splitting a surrogate
 * pair), '…' only when content was omitted. Total and deterministic; the
 * source is never scanned beyond MAX_TASK_TOTAL_TEXT_CODE_UNITS.
 */
export function taskPromptExcerpt(prompt: string): string {
  if (typeof prompt !== 'string') return '';
  const bounded =
    prompt.length > MAX_TASK_TOTAL_TEXT_CODE_UNITS
      ? prompt.slice(0, MAX_TASK_TOTAL_TEXT_CODE_UNITS)
      : prompt;
  const collapsed = bounded.trim().replace(/\s+/g, ' ');
  let out = '';
  let count = 0;
  for (const char of collapsed) {
    if (count === MAX_TASK_EXCERPT_CODE_POINTS) return `${out}…`;
    out += char;
    count++;
  }
  return out;
}
