/**
 * Pure, React-free presentation policy for a paired tool call.
 * Resolves the provider-sent name, input, and output into a family, chip
 * label, headline, and content badge facts. `toolRowPresentation` composes
 * that content presentation with already-derived runtime facts (outcome,
 * exit code, duration, output state) into the collapsed-row model both
 * renderers consume, plus the untouched provider-facing `rawPayload` for
 * the Raw view. The input is structural so the chat card can adopt it
 * later without a rewrite.
 */
import { formatDurationMs } from './format';
import { normalizeTaskDispatch, taskPromptExcerpt, type TaskSubtask } from './task-normalize';

export const MAX_ALIAS_NAME_CODE_UNITS = 128;
export const MAX_CHIP_CODE_POINTS = 24;
export const MAX_HEADLINE_SOURCE_CODE_UNITS = 4096;
export const MAX_GENERIC_KEYS_SCANNED = 32;
export const MAX_GENERIC_FACTS = 3;
export const MAX_GENERIC_SCALAR_CODE_POINTS = 80;
export const MAX_COUNT_OUTPUT_CODE_UNITS = 4096;
export const MAX_COUNT_KEYS_SCANNED = 32;

export type ToolFamily =
  | 'shell'
  | 'file'
  | 'search'
  | 'glob'
  | 'code'
  | 'todo'
  | 'task'
  | 'web'
  | 'generic';

export type ToolHeadlineKind = 'path' | 'text';
export type ToolOutcome = 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
export type ToolOutputState = 'full' | 'truncated' | 'missing' | 'unknown';
export type ToolStatusGlyph = '✓' | '✕' | '◐' | '⚠' | '–';
export type ToolRowBadgeKind =
  | 'state'
  | 'duration'
  | 'exit'
  | 'count'
  | 'language'
  | 'operation'
  | 'output-state'
  | 'placeholder';
export type ToolRowBadgeTone = 'neutral' | 'danger' | 'warning' | 'running' | 'muted';

export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

/**
 * Canonical Raw view of the paired call: exactly the provider-facing name,
 * input, and output — no ids, labels, icons, facts, or other UI metadata.
 * `name` is the sent name, never the normalized chip label; renderers treat
 * the whole payload as opaque.
 */
export interface ToolRawPayload {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ToolRowBadge {
  kind: ToolRowBadgeKind;
  text: string;
  tone: ToolRowBadgeTone;
}

export interface GenericField {
  key: string;
  value: string;
}

export interface TaskSubtaskCard extends TaskSubtask {
  excerpt: string;
}

export type ToolBody =
  | { kind: 'task'; context: string; subtasks: TaskSubtaskCard[] }
  | { kind: 'generic'; fields: GenericField[] };

export interface ToolPresentation {
  family: ToolFamily;
  /** Chip text: the tool name as sent when it is a single token of <=24 code points, else the family name. */
  label: string;
  /** The single salient argument — command, path, pattern. Never JSON. */
  headline: string;
  headlineKind: ToolHeadlineKind;
  /** Content-derived facts only (language, count, operation); runtime facts join in toolRowPresentation. */
  contentBadges: ToolRowBadge[];
  /** Expanded-body model; null for every family without a body arm. */
  body: ToolBody | null;
  /** Body-bar lead facts owned by the core ('batch', 'N subtasks', 'single dispatch'); empty for non-task rows. */
  bodyFacts: string[];
}

export interface ToolRowFacts {
  outcome: ToolOutcome;
  exitCode?: number | null;
  durationMs?: number | null;
  outputState?: ToolOutputState | null;
  runningElapsedMs?: number | null;
}

export interface ToolRowPresentation extends ToolPresentation {
  glyph: ToolStatusGlyph;
  statusLabel: ToolOutcome;
  initialOpen: boolean;
  badges: ToolRowBadge[];
  /** Canonical provider-facing payload for the Raw disclosure; opaque to renderers. */
  rawPayload: ToolRawPayload;
  /** Complete open-row body bar: family prefix plus fact text, composed once in the core. */
  bodyBarText: string;
}

const MCP_PREFIX = 'mcp__';
const SHELL_WRAPPER_PREFIXES = ["/bin/zsh -lc '", "/bin/bash -lc '"] as const;

const COMMAND_KEYS = ['command', 'cmd', 'script'] as const;
const PATH_KEYS = [
  'file_path',
  'path',
  'target_file',
  'file',
  'filename',
  'notebook_path',
] as const;
const PATTERN_KEYS = ['pattern', 'query', 'regex', 'search'] as const;
const URL_KEYS = ['url', 'uri'] as const;
const BEFORE_AFTER_PAIRS = [
  ['old_string', 'new_string'],
  ['old_str', 'new_str'],
  ['content', 'new_content'],
] as const;

const FAMILY_ALIASES: Record<string, ToolFamily> = {
  bash: 'shell',
  shell: 'shell',
  run: 'shell',
  command: 'shell',
  execute: 'shell',
  runterminalcommand: 'shell',
  edit: 'file',
  write: 'file',
  create: 'file',
  strreplace: 'file',
  applypatch: 'file',
  notebookedit: 'file',
  searchreplace: 'file',
  delete: 'file',
  read: 'file',
  view: 'file',
  cat: 'file',
  open: 'file',
  readfile: 'file',
  grep: 'search',
  search: 'search',
  rg: 'search',
  searchtool: 'search',
  glob: 'glob',
  find: 'glob',
  ls: 'glob',
  list: 'glob',
  listdir: 'glob',
  eval: 'code',
  runcode: 'code',
  'execute code': 'code',
  todo: 'todo',
  todowrite: 'todo',
  plan: 'todo',
  task: 'task',
  agent: 'task',
  subagent: 'task',
  dispatch: 'task',
  webfetch: 'web',
  websearch: 'web',
  fetch: 'web',
  browse: 'web',
};

const OUTCOME_GLYPH: Record<ToolOutcome, ToolStatusGlyph> = {
  succeeded: '✓',
  failed: '✕',
  running: '◐',
  interrupted: '⚠',
  unknown: '–',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstStringField(
  record: Record<string, unknown> | null,
  keys: readonly string[]
): string | null {
  if (record === null) return null;
  for (const key of keys) {
    const value = stringField(record, key);
    if (value !== null) return value;
  }
  return null;
}

/** Stays within the headline cap: a value that needs it but cannot be fully inspected yields no headline. */
function boundedString(value: string | null): string | null {
  if (value === null || value.length > MAX_HEADLINE_SOURCE_CODE_UNITS) return null;
  return value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** True when the record owns at least one enumerable key; stops after the first hit. */
function hasKeys(record: Record<string, unknown> | null): boolean {
  if (record === null) return false;
  for (const key in record) {
    if (hasOwn(record, key)) return true;
  }
  return false;
}

/** `mcp__server__tool` → `server · tool`; only well-formed bounded names qualify. */
function mcpLabel(name: string): string | null {
  if (name.length > MAX_ALIAS_NAME_CODE_UNITS || !name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const separator = rest.indexOf('__');
  if (separator <= 0 || separator + 2 >= rest.length) return null;
  return `${rest.slice(0, separator)} · ${rest.slice(separator + 2)}`;
}

function normalizeAlias(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

/**
 * The sent name earns the chip only when a bounded code-point scan proves it
 * is one non-empty, whitespace-free token of at most MAX_CHIP_CODE_POINTS.
 */
function chipLabel(name: string, family: ToolFamily): string {
  let points = 0;
  for (const char of name) {
    if (/\s/.test(char)) return family;
    points++;
    if (points > MAX_CHIP_CODE_POINTS) return family;
  }
  return points > 0 ? name : family;
}

/**
 * Codex sends whole commands as the tool name. A name carrying whitespace is
 * an argument-bearing command or a multiline script; a name beyond the
 * headline cap is a payload, not an identifier. Both resolve to shell.
 */
function isCommandLikeName(name: string): boolean {
  if (name.length > MAX_HEADLINE_SOURCE_CODE_UNITS) return true;
  return /\s/.test(name);
}

/** Removes only a complete `/bin/zsh -lc '…'` or `/bin/bash -lc '…'` wrapper; incomplete wrappers stay untouched. */
function stripShellWrapper(name: string): string {
  if (name.length > MAX_HEADLINE_SOURCE_CODE_UNITS || !name.endsWith("'")) return name;
  for (const prefix of SHELL_WRAPPER_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return name.slice(prefix.length, -1);
    }
  }
  return name;
}

/**
 * First non-empty line of a source that fits the headline cap, with a
 * trailing `…` when later non-empty lines follow. Over-cap sources return
 * null so the caller uses a safe fallback instead of a fabricated fragment.
 */
function firstNonEmptyLine(source: string): string | null {
  if (source.length > MAX_HEADLINE_SOURCE_CODE_UNITS) return null;
  let cursor = 0;
  while (cursor <= source.length) {
    const newline = source.indexOf('\n', cursor);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(cursor, end).trim();
    if (line.length > 0) {
      const rest = newline === -1 ? '' : source.slice(end + 1);
      return rest.trim().length > 0 ? `${line}…` : line;
    }
    if (newline === -1) return null;
    cursor = end + 1;
  }
  return null;
}

/** `value` truncated to at most `max` code points, `…` appended when cut. Never scans past the cut. */
function truncateCodePoints(value: string, max: number): string {
  let out = '';
  let count = 0;
  for (const char of value) {
    if (count === max) return `${out}…`;
    out += char;
    count++;
  }
  return out;
}

/** Scalar → display text, or null for values that must not reach the collapsed headline. */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    return truncateCodePoints(value, MAX_GENERIC_SCALAR_CODE_POINTS);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/** Up to MAX_GENERIC_FACTS `key: value` entries over at most MAX_GENERIC_KEYS_SCANNED own keys. */
function genericFacts(record: Record<string, unknown> | null): string[] {
  if (record === null) return [];
  const facts: string[] = [];
  let scanned = 0;
  for (const key in record) {
    if (!hasOwn(record, key)) continue;
    if (scanned >= MAX_GENERIC_KEYS_SCANNED) break;
    scanned++;
    const text = scalarText(record[key]);
    if (text === null) continue;
    facts.push(`${key}: ${text}`);
    if (facts.length >= MAX_GENERIC_FACTS) break;
  }
  return facts;
}

/** Body-row value text: bounded scalar, `[n]` for arrays, `{…}` for objects, null for values that emit no row. */
function genericBodyValue(value: unknown): string | null {
  const scalar = scalarText(value);
  if (scalar !== null) return scalar;
  if (Array.isArray(value)) return `[${String(value.length)}]`;
  if (value !== null && typeof value === 'object') return '{…}';
  if (value === null) return 'null';
  return null;
}

/**
 * Bounded generic-body projection over at most MAX_GENERIC_KEYS_SCANNED own
 * keys, emitting at most MAX_GENERIC_FACTS rows. Unlike the collapsed
 * genericFacts(), non-scalar values stay visible as `[n]`/`{…}` markers and
 * the key text is bounded as well. Nothing is ever stringified, and hostile
 * enumeration reduces the whole projection to an empty field list.
 */
function genericBodyFields(record: Record<string, unknown> | null): GenericField[] {
  try {
    if (record === null) return [];
    const fields: GenericField[] = [];
    let scanned = 0;
    for (const key in record) {
      if (!hasOwn(record, key)) continue;
      if (scanned >= MAX_GENERIC_KEYS_SCANNED) break;
      scanned++;
      const value = genericBodyValue(record[key]);
      if (value === null) continue;
      fields.push({
        key: truncateCodePoints(key, MAX_GENERIC_SCALAR_CODE_POINTS),
        value,
      });
      if (fields.length >= MAX_GENERIC_FACTS) break;
    }
    return fields;
  } catch {
    return [];
  }
}

function singularOrPlural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

function isCountValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Bounded count extraction: a finite nonnegative integer scalar, a digit-only
 * string within the output cap, or a shallow `count` field found within
 * MAX_COUNT_KEYS_SCANNED own keys. No recursion and no prose regexing.
 */
function extractCount(output: unknown): number | null {
  if (isCountValue(output)) return output;
  if (typeof output === 'string') {
    if (output.length > MAX_COUNT_OUTPUT_CODE_UNITS) return null;
    const trimmed = output.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return isCountValue(parsed) ? parsed : null;
  }
  const record = asRecord(output);
  if (record === null) return null;
  let scanned = 0;
  for (const key in record) {
    if (!hasOwn(record, key)) continue;
    if (scanned >= MAX_COUNT_KEYS_SCANNED) break;
    scanned++;
    if (key === 'count') {
      const value = record[key];
      return isCountValue(value) ? value : null;
    }
  }
  return null;
}

/** Tier-2 duck-typing on known input keys, in contract priority order. */
function inferFamily(record: Record<string, unknown>): ToolFamily | null {
  if (stringField(record, 'code') !== null && stringField(record, 'language') !== null) {
    return 'code';
  }
  if (firstStringField(record, COMMAND_KEYS) !== null) return 'shell';
  if (firstStringField(record, PATH_KEYS) !== null) return 'file';
  if (firstStringField(record, PATTERN_KEYS) !== null) return 'search';
  if (firstStringField(record, URL_KEYS) !== null) return 'web';
  for (const [before, after] of BEFORE_AFTER_PAIRS) {
    if (record[before] !== undefined && record[after] !== undefined) return 'file';
  }
  return null;
}

function shellHeadline(name: string, record: Record<string, unknown> | null): string | null {
  const command = firstStringField(record, COMMAND_KEYS);
  if (command !== null) return firstNonEmptyLine(command);
  if (hasKeys(record)) return null;
  return firstNonEmptyLine(stripShellWrapper(name));
}

function searchHeadline(record: Record<string, unknown> | null): string | null {
  const pattern = boundedString(firstStringField(record, PATTERN_KEYS));
  if (pattern === null) return null;
  const scope = boundedString(stringField(record, 'path'));
  return scope === null ? pattern : `${pattern} in ${scope}`;
}

function globHeadline(record: Record<string, unknown> | null): string | null {
  const pattern = boundedString(stringField(record, 'pattern'));
  if (pattern !== null) return pattern;
  return boundedString(stringField(record, 'path'));
}

function taskHeadline(record: Record<string, unknown> | null): string | null {
  const description = stringField(record, 'description');
  if (description !== null) return firstNonEmptyLine(description);
  const tasks = record?.tasks;
  if (Array.isArray(tasks) && tasks.length > 0) {
    const name = stringField(asRecord(tasks[0]), 'name');
    if (name !== null) return firstNonEmptyLine(name);
  }
  const context = stringField(record, 'context');
  if (context !== null) return firstNonEmptyLine(context);
  return null;
}

function operationBadge(record: Record<string, unknown> | null): ToolRowBadge | null {
  const text = scalarText(record?.op);
  if (text === null) return null;
  return { kind: 'operation', text: `op: ${text}`, tone: 'neutral' };
}

function languageBadge(record: Record<string, unknown> | null): ToolRowBadge | null {
  const language = stringField(record, 'language');
  if (language === null) return null;
  return {
    kind: 'language',
    text: truncateCodePoints(language, MAX_GENERIC_SCALAR_CODE_POINTS),
    tone: 'neutral',
  };
}

function countBadge(output: unknown): ToolRowBadge | null {
  const count = extractCount(output);
  if (count === null) return null;
  return { kind: 'count', text: `${String(count)} matches`, tone: 'neutral' };
}

function resolveToolPresentation(input: ToolPresentationInput): ToolPresentation {
  const name = typeof input.name === 'string' ? input.name : '';
  const record = asRecord(input.input);

  // Bounded `mcp__server__tool` shape: forced generic, and input keys never reclassify it.
  const mcp = mcpLabel(name);
  if (mcp !== null) {
    const facts = genericFacts(record);
    return {
      family: 'generic',
      label: mcp,
      headline: facts.length > 0 ? facts.join(' · ') : mcp,
      headlineKind: 'text',
      contentBadges: [],
      body: null,
      bodyFacts: [],
    };
  }

  const alias =
    name.length <= MAX_ALIAS_NAME_CODE_UNITS
      ? (FAMILY_ALIASES[normalizeAlias(name)] ?? null)
      : null;
  const family =
    alias ??
    (record !== null ? inferFamily(record) : null) ??
    (isCommandLikeName(name) && !hasKeys(record) ? 'shell' : null) ??
    'generic';

  let headline: string | null = null;
  let headlineKind: ToolHeadlineKind = 'text';
  const contentBadges: ToolRowBadge[] = [];
  let body: ToolBody | null = null;
  let bodyFacts: string[] = [];

  switch (family) {
    case 'shell':
      headline = shellHeadline(name, record);
      break;
    case 'file':
      headline = boundedString(firstStringField(record, PATH_KEYS));
      headlineKind = 'path';
      break;
    case 'search': {
      headline = searchHeadline(record);
      const count = countBadge(input.output);
      if (count !== null) contentBadges.push(count);
      break;
    }
    case 'glob':
      headline = globHeadline(record);
      headlineKind = 'path';
      break;
    case 'code': {
      const code = stringField(record, 'code');
      headline = code === null ? null : firstNonEmptyLine(code);
      const language = languageBadge(record);
      if (language !== null) contentBadges.push(language);
      break;
    }
    case 'todo': {
      headline = 'todo updated';
      const operation = operationBadge(record);
      if (operation !== null) contentBadges.push(operation);
      break;
    }
    case 'task': {
      const dispatch = normalizeTaskDispatch(input.input);
      if (dispatch !== null) {
        const subtasks: TaskSubtaskCard[] = dispatch.subtasks.map(subtask => ({
          ...subtask,
          excerpt: taskPromptExcerpt(subtask.prompt),
        }));
        body = { kind: 'task', context: dispatch.context, subtasks };
        bodyFacts =
          dispatch.mode === 'batch'
            ? ['batch', singularOrPlural(subtasks.length, 'subtask')]
            : ['single dispatch'];
        contentBadges.push({
          kind: 'count',
          text: singularOrPlural(subtasks.length, 'subagent'),
          tone: 'neutral',
        });
      } else {
        body = { kind: 'generic', fields: genericBodyFields(record) };
      }
      try {
        // Field access stays inside the task branch: a malformed getter falls
        // back to the label headline and keeps the body already resolved above.
        headline = taskHeadline(record);
      } catch {
        headline = null;
      }
      break;
    }
    case 'web':
      headline = boundedString(firstStringField(record, URL_KEYS));
      headlineKind = 'path';
      break;
    case 'generic': {
      const facts = genericFacts(record);
      headline = facts.length > 0 ? facts.join(' · ') : null;
      break;
    }
  }

  const label = chipLabel(name, family);
  return {
    family,
    label,
    headline: headline ?? label,
    headlineKind,
    contentBadges,
    body,
    bodyFacts,
  };
}

/** Safe generic row used when resolution itself fails; the sent name is only reused if it is chip-worthy. */
function safePresentation(input: ToolPresentationInput): ToolPresentation {
  try {
    const name = typeof input.name === 'string' ? input.name : '';
    const label = chipLabel(name, 'generic');
    return {
      family: 'generic',
      label,
      headline: label,
      headlineKind: 'text',
      contentBadges: [],
      body: null,
      bodyFacts: [],
    };
  } catch {
    return {
      family: 'generic',
      label: 'generic',
      headline: 'generic',
      headlineKind: 'text',
      contentBadges: [],
      body: null,
      bodyFacts: [],
    };
  }
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation {
  try {
    return resolveToolPresentation(input);
  } catch {
    return safePresentation(input);
  }
}

function elapsedText(facts: ToolRowFacts): string {
  const elapsed = facts.runningElapsedMs;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) {
    return 'running';
  }
  return `running · ${formatDurationMs(elapsed)}`;
}

/**
 * Verbatim capture of the provider-facing trio for the Raw view — never
 * rebuilt from the normalized label, headline, or fact text, which may
 * differ from what was sent. Total: any throw while reading yields the
 * deterministic generic fallback rather than leaking through the row.
 */
function captureRawPayload(input: ToolPresentationInput): ToolRawPayload {
  try {
    const name = input.name;
    return {
      name: typeof name === 'string' ? name : 'generic',
      input: input.input,
      output: input.output,
    };
  } catch {
    return { name: 'generic', input: undefined, output: undefined };
  }
}

/** The payload's name when it reads as a string without throwing, else 'generic'. */
function safeRawName(payload: ToolRawPayload): string {
  try {
    const name = payload.name;
    return typeof name === 'string' ? name : 'generic';
  } catch {
    return 'generic';
  }
}

/**
 * Pretty-prints the canonical Raw payload in a fixed name → input → output
 * key order; absent `undefined` fields are omitted and `null` is kept.
 * Total: cycles, bigint, or a hostile getter yield a valid
 * `{ name, error }` document — never a throw, never exception text or
 * inspection output, and no replacer that could silently alter values.
 */
export function toolRawPayloadJson(payload: ToolRawPayload): string {
  try {
    return JSON.stringify(
      { name: payload.name, input: payload.input, output: payload.output },
      null,
      2
    );
  } catch {
    // Both fields are plain strings, so this document cannot fail to serialize.
    return JSON.stringify(
      { name: safeRawName(payload), error: 'payload is not serializable' },
      null,
      2
    );
  }
}

export function toolRowPresentation(
  input: ToolPresentationInput,
  facts: ToolRowFacts
): ToolRowPresentation {
  const content = toolPresentation(input);
  const rawPayload = captureRawPayload(input);
  const outcome = facts.outcome;
  const badges: ToolRowBadge[] = [];

  if (outcome === 'running') {
    badges.push({ kind: 'state', text: elapsedText(facts), tone: 'running' });
  } else if (outcome === 'interrupted') {
    badges.push({ kind: 'state', text: 'interrupted', tone: 'warning' });
  } else if (outcome === 'unknown') {
    badges.push({ kind: 'state', text: 'output unknown', tone: 'muted' });
  }

  badges.push(...content.contentBadges);

  if (typeof facts.exitCode === 'number' && Number.isFinite(facts.exitCode)) {
    badges.push({
      kind: 'exit',
      text: `exit ${String(facts.exitCode)}`,
      tone: facts.exitCode === 0 ? 'neutral' : 'danger',
    });
  }

  // The three state rules replace inferred missing/unknown markers; a recorded
  // truncation is a real fact and survives on settled and interrupted rows.
  const suppressMarker =
    outcome === 'running' || outcome === 'interrupted' || outcome === 'unknown';
  if (facts.outputState === 'truncated') {
    badges.push({ kind: 'output-state', text: 'truncated', tone: 'warning' });
  } else if (facts.outputState === 'missing' && !suppressMarker) {
    badges.push({ kind: 'output-state', text: 'output missing', tone: 'warning' });
  } else if (facts.outputState === 'unknown' && !suppressMarker) {
    badges.push({ kind: 'output-state', text: 'output unknown', tone: 'muted' });
  }

  if (
    typeof facts.durationMs === 'number' &&
    Number.isFinite(facts.durationMs) &&
    facts.durationMs >= 0
  ) {
    badges.push({ kind: 'duration', text: formatDurationMs(facts.durationMs), tone: 'muted' });
  }

  if (badges.length === 0) {
    badges.push({ kind: 'placeholder', text: '—', tone: 'muted' });
  }

  // The core owns the complete body bar: a normalized task leads with its
  // bodyFacts and drops the redundant subagent count badge; every other row
  // maps non-placeholder badges exactly as the renderers used to compose them.
  const isTaskBody = content.body?.kind === 'task';
  const barBadges = badges
    .filter(badge => badge.kind !== 'placeholder')
    .filter(badge => !(isTaskBody && badge.kind === 'count'))
    .map(badge => badge.text);
  const bodyBarText = [
    content.family,
    ...(isTaskBody ? [...content.bodyFacts, ...barBadges] : barBadges),
  ].join(' · ');

  return {
    ...content,
    glyph: OUTCOME_GLYPH[outcome],
    statusLabel: outcome,
    initialOpen: outcome === 'failed',
    badges,
    rawPayload,
    bodyBarText,
  };
}
