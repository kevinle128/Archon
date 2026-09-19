/**
 * Pure, React-free presentation policy for a paired tool call.
 * Resolves the provider-sent name, input, and output into a family, chip
 * label, headline, and content badge facts. `toolRowPresentation` composes
 * that content presentation with already-derived runtime facts (outcome,
 * exit code, duration, output state) into the collapsed-row model both
 * renderers consume, plus the untouched provider-facing `rawPayload` for
 * the Raw view. `toolBodyPresentation` resolves the expanded body lazily
 * — only while a row is open and Raw is closed — against the already-resolved
 * family, so polling never pays for output normalization. The input is
 * structural so the chat card can adopt it later without a rewrite.
 */
import { diffHunks, type DiffHunksResult } from './diff-hunks';
import { formatDurationMs } from './format';
import { normalizeTaskDispatch, taskPromptExcerpt, type TaskSubtask } from './task-normalize';
import {
  MAX_LIST_ITEMS,
  MAX_LIST_ITEM_TEXT_CODE_UNITS,
  MAX_FIELD_KEY_CODE_UNITS,
  MAX_OUTPUT_TEXT_CODE_UNITS,
  fieldValue,
  looksLikeJson,
  normalizeToolOutput,
  parseMatchLine,
  sanitizeBounded,
  type BoundedList,
  type NormalizedToolOutput,
  type ToolOutputField,
  type ToolOutputMatch,
} from './tool-output';

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
  | 'diff'
  | 'placeholder';
export type ToolRowBadgeTone = 'neutral' | 'danger' | 'warning' | 'running' | 'muted' | 'success';

/** The diff a qualified file row carries; renderers consume this type, never the differ. */
export type FileDiff = DiffHunksResult;

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

export interface TaskSubtaskCard extends TaskSubtask {
  excerpt: string;
}

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

/**
 * Own-property before/after pair for a resolved `file` row. Both keys must be
 * own properties before either value is read, `''` is a valid side, and a
 * throwing accessor is a non-qualifying pair — never a reason to reclassify
 * the row or block the transcript. Runs only after family resolves to `file`;
 * alias-shaped keys on any other family never reach this helper.
 */
function fileEditPair(record: Record<string, unknown>): { before: string; after: string } | null {
  try {
    for (const [before, after] of BEFORE_AFTER_PAIRS) {
      if (!hasOwn(record, before) || !hasOwn(record, after)) continue;
      const beforeValue = record[before];
      const afterValue = record[after];
      if (typeof beforeValue === 'string' && typeof afterValue === 'string') {
        return { before: beforeValue, after: afterValue };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** `replace_all: true|false` — only when the input carries it as an own boolean. */
function replaceAllFact(record: Record<string, unknown>): string | null {
  try {
    if (!hasOwn(record, 'replace_all')) return null;
    const value = record.replace_all;
    return typeof value === 'boolean' ? `replace_all: ${String(value)}` : null;
  } catch {
    return null;
  }
}

/**
 * Row-level diff cache keyed by the input record object. The summary and the
 * file body arm see the same record, so the bounded differ runs once per
 * record; equal strings on a freshly parsed object reuse the differ's pair
 * cache. `null` covers both a non-qualifying pair and a refusal — either way
 * the row keeps the path-plus-preview fallback.
 */
const fileDiffCache = new WeakMap<object, DiffHunksResult | null>();

function fileDiffFor(record: Record<string, unknown>): DiffHunksResult | null {
  const cached = fileDiffCache.get(record);
  if (cached !== undefined) return cached;
  const pair = fileEditPair(record);
  const result = pair === null ? null : diffHunks(pair.before, pair.after);
  fileDiffCache.set(record, result);
  return result;
}

/** True when a bounded scan finds an own enumerable key. */
function hasKeys(record: Record<string, unknown> | null): boolean {
  if (record === null) return false;
  let scanned = 0;
  for (const key in record) {
    if (scanned >= MAX_GENERIC_KEYS_SCANNED) break;
    scanned++;
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
    if (scanned >= MAX_GENERIC_KEYS_SCANNED) break;
    scanned++;
    if (!hasOwn(record, key)) continue;
    const text = scalarText(record[key]);
    if (text === null) continue;
    const boundedKey = sanitizeBounded(key, MAX_FIELD_KEY_CODE_UNITS).text;
    if (boundedKey.length === 0) continue;
    facts.push(`${boundedKey}: ${text}`);
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
function genericBodyFields(record: Record<string, unknown> | null): ToolField[] {
  try {
    if (record === null) return [];
    const fields: ToolField[] = [];
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
 * or small JSON record string within the output cap, or a shallow recognized
 * numeric key — `count`/`numMatches` report matches, `numFiles` reports files —
 * found within MAX_COUNT_KEYS_SCANNED own keys. No recursion, no prose
 * regexing, and never the full normalizer.
 */
function extractCount(output: unknown): { value: number; unit: 'matches' | 'files' } | null {
  if (isCountValue(output)) return { value: output, unit: 'matches' };
  if (typeof output === 'string') {
    if (output.length > MAX_COUNT_OUTPUT_CODE_UNITS) return null;
    const trimmed = output.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return isCountValue(parsed) ? { value: parsed, unit: 'matches' } : null;
    }
    if (!trimmed.startsWith('{')) return null;
    try {
      return extractCountFromRecord(asRecord(JSON.parse(trimmed)));
    } catch {
      return null;
    }
  }
  return extractCountFromRecord(asRecord(output));
}

function extractCountFromRecord(
  record: Record<string, unknown> | null
): { value: number; unit: 'matches' | 'files' } | null {
  if (record === null) return null;
  let scanned = 0;
  let files: number | null = null;
  for (const key in record) {
    if (scanned >= MAX_COUNT_KEYS_SCANNED) break;
    scanned++;
    if (!hasOwn(record, key)) continue;
    if (key === 'count' || key === 'numMatches') {
      const value = record[key];
      return isCountValue(value) ? { value, unit: 'matches' } : null;
    }
    if (key === 'numFiles') {
      const value = record[key];
      if (isCountValue(value) && files === null) files = value;
    }
  }
  return files === null ? null : { value: files, unit: 'files' };
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
  return { kind: 'count', text: `${String(count.value)} ${count.unit}`, tone: 'neutral' };
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
    case 'file': {
      headline = boundedString(firstStringField(record, PATH_KEYS));
      headlineKind = 'path';
      const diff = record === null ? null : fileDiffFor(record);
      if (diff !== null) {
        if (diff.added > 0) {
          contentBadges.push({ kind: 'diff', text: `+${String(diff.added)}`, tone: 'success' });
        }
        if (diff.deleted > 0) {
          contentBadges.push({ kind: 'diff', text: `−${String(diff.deleted)}`, tone: 'danger' });
        }
        bodyFacts.push(
          diff.hunks.length === 0 ? 'no changes' : singularOrPlural(diff.hunks.length, 'hunk')
        );
        const replaceAll = record === null ? null : replaceAllFact(record);
        if (replaceAll !== null) bodyFacts.push(replaceAll);
      }
      break;
    }
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
        body = {
          kind: 'generic',
          fields: genericBodyFields(record),
          markdown: null,
          unreadable: false,
        };
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
  // bodyFacts and drops the redundant subagent count badge; a file row leads
  // with its hunk/no-changes fact and keeps its `+n −m` badges out of the bar;
  // every other family composes identically since only these two set facts.
  // The chip prints the sent name only when it is chip-worthy; when it fell
  // back the body bar carries the full name instead (a Codex wrapped command,
  // an over-long tool name), so it stays readable and selectable.
  const isTaskBody = content.body?.kind === 'task';
  const sentName = safeRawName(rawPayload);
  const barName =
    content.label !== sentName ? sanitizeBounded(sentName, MAX_ALIAS_NAME_CODE_UNITS).text : null;
  const barBadges = badges
    .filter(badge => badge.kind !== 'placeholder' && badge.kind !== 'diff')
    .filter(badge => !(isTaskBody && badge.kind === 'count'))
    .map(badge => badge.text);
  const bodyBarText = [
    content.family,
    ...content.bodyFacts,
    ...(barName !== null && barName.length > 0 ? [barName] : []),
    ...barBadges,
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

// --- Lazy expanded bodies ---
// The body resolver runs on demand — a row open with Raw closed — and consumes
// the already-resolved family plus bounded normalized output channels. Output
// picks the arm within a family; it can never change the family itself.

export const MAX_BODY_COMMAND_CODE_UNITS = 65_536;
export const MAX_BODY_SOURCE_CODE_UNITS = 65_536;
/** One shared cap over input fields then output fields on a generic body. */
export const MAX_BODY_FIELDS = 3;

export type MatchItem = ToolOutputMatch;
export type ToolField = ToolOutputField;

export type ToolBody =
  | { kind: 'task'; context: string; subtasks: TaskSubtaskCard[] }
  | { kind: 'terminal'; command: string; output: string | null; unreadable: boolean }
  | {
      kind: 'file';
      path: string;
      preview: string | null;
      unreadable: boolean;
      /** The qualified before/after diff, or null when the row keeps the preview fallback. */
      diff: FileDiff | null;
    }
  | {
      kind: 'matches';
      pattern: string;
      scope: string | null;
      items: MatchItem[];
      omitted: number | null;
      truncated: boolean;
    }
  | {
      kind: 'paths';
      pattern: string;
      scope: string | null;
      items: string[];
      omitted: number | null;
      truncated: boolean;
    }
  | {
      kind: 'code';
      language: string | null;
      source: string;
      result: string | null;
      truncated: boolean;
    }
  | {
      kind: 'web';
      url: string;
      title: string | null;
      markdown: string | null;
      omitted: number | null;
      truncated: boolean;
    }
  | { kind: 'generic'; fields: ToolField[]; markdown: string | null; unreadable: boolean };

/** Input keys carrying the content a file-writing tool produced, in contract order. */
const FILE_PREVIEW_KEYS = ['content', 'new_content', 'new_string', 'new_str'] as const;
const CODE_SOURCE_KEYS = ['code', 'source', 'script'] as const;

type SearchMode = 'content' | 'files_with_matches' | 'count';

function isSearchMode(value: unknown): value is SearchMode {
  return value === 'content' || value === 'files_with_matches' || value === 'count';
}

/**
 * Salient input argument for a body field; when absent, the chip-worthy name
 * stands in — the same fallback the summary headline uses.
 */
function salientField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
  name: string,
  family: ToolFamily
): string {
  return boundedString(firstStringField(record, keys)) ?? chipLabel(name, family);
}

/**
 * Generic-body input fields in stable own-key order, using the normalized
 * field convention — objects `{…}`, arrays `[n]`, scalars as bounded text.
 * A throwing key is skipped; the body keeps what it honestly read.
 */
function inputFields(record: Record<string, unknown> | null): ToolField[] {
  if (record === null) return [];
  const fields: ToolField[] = [];
  let scanned = 0;
  for (const key in record) {
    if (scanned >= MAX_GENERIC_KEYS_SCANNED) break;
    scanned++;
    if (!hasOwn(record, key)) continue;
    let value: unknown;
    try {
      value = record[key];
    } catch {
      continue;
    }
    const text = fieldValue(value);
    if (text === null) continue;
    const boundedKey = sanitizeBounded(key, MAX_FIELD_KEY_CODE_UNITS).text;
    if (boundedKey.length === 0) continue;
    fields.push({ key: boundedKey, value: text });
    if (fields.length >= MAX_BODY_FIELDS) break;
  }
  return fields;
}

/** Add a visible truncation marker without exceeding the original code-unit budget. */
function withBoundedEllipsis(value: string, maxUnits: number): string {
  if (maxUnits <= 0) return '';
  if (value.length < maxUnits) return `${value}…`;
  if (maxUnits === 1) return '…';
  const last = value.charCodeAt(maxUnits - 1);
  const cut = last >= 0xdc00 && last <= 0xdfff ? maxUnits - 2 : maxUnits - 1;
  return `${value.slice(0, Math.max(0, cut))}…`;
}

function normalizedDisplayText(normalized: NormalizedToolOutput): string | null {
  if (normalized.text === null || !normalized.textTruncated) return normalized.text;
  return withBoundedEllipsis(normalized.text, MAX_OUTPUT_TEXT_CODE_UNITS);
}

/**
 * Non-empty lines of normalized text as bounded list items. `textTruncated`
 * means the source tail is unknowable, so a cut list reports `omitted: null`;
 * otherwise the bounded tail is counted exactly for `+n more`.
 */
function boundedTextLines<T>(
  text: string | null,
  textTruncated: boolean,
  map: (line: string) => T | null
): BoundedList<T> {
  const items: T[] = [];
  if (text === null) return { items, omitted: 0, truncated: false };
  const lines = text.split('\n');
  let i = 0;
  for (; i < lines.length && items.length < MAX_LIST_ITEMS; i++) {
    const mapped = map(lines[i]);
    if (mapped !== null) items.push(mapped);
  }
  const cut = i < lines.length;
  if (!cut && !textTruncated) return { items, omitted: 0, truncated: false };
  if (textTruncated) return { items, omitted: null, truncated: true };
  let omitted = 0;
  for (let j = i; j < lines.length; j++) {
    if (map(lines[j]) !== null) omitted++;
  }
  return { items, omitted, truncated: true };
}

function pathLine(line: string): string | null {
  if (line.trim().length === 0) return null;
  return sanitizeBounded(line, MAX_LIST_ITEM_TEXT_CODE_UNITS).text;
}

function matchLine(line: string): MatchItem | null {
  if (line.trim().length === 0) return null;
  const parsed = parseMatchLine(line);
  if (parsed === null) return null;
  return {
    path:
      parsed.path === null
        ? null
        : sanitizeBounded(parsed.path, MAX_LIST_ITEM_TEXT_CODE_UNITS).text,
    line: parsed.line,
    text: sanitizeBounded(parsed.text, MAX_LIST_ITEM_TEXT_CODE_UNITS).text,
  };
}

/**
 * Search body arm precedence: a recognized `output_mode` input, then the
 * output's own declared mode or an unmistakable structured channel (matches
 * win over paths because content-mode output also lists matched filenames),
 * then the sent-alias default — exact `Grep` is files_with_matches; `grep` and
 * other search aliases are content.
 */
function searchBodyMode(
  record: Record<string, unknown> | null,
  name: string,
  normalized: NormalizedToolOutput
): SearchMode {
  const requested = stringField(record, 'output_mode');
  if (isSearchMode(requested)) return requested;
  if (normalized.mode !== null) return normalized.mode;
  if (normalized.matches.items.length > 0) return 'content';
  if (normalized.paths.items.length > 0) return 'files_with_matches';
  return name === 'Grep' ? 'files_with_matches' : 'content';
}

/** `count` mode keeps the search family but renders the generic body arm with just the count. */
function countBody(normalized: NormalizedToolOutput): ToolBody {
  const fields: ToolField[] = [];
  if (normalized.counts.matches !== null) {
    fields.push({ key: 'matches', value: String(normalized.counts.matches) });
  }
  if (normalized.counts.files !== null && fields.length < MAX_BODY_FIELDS) {
    fields.push({ key: 'files', value: String(normalized.counts.files) });
  }
  return { kind: 'generic', fields, markdown: null, unreadable: normalized.unreadable };
}

function genericBody(
  record: Record<string, unknown> | null,
  output: unknown,
  normalized: NormalizedToolOutput
): ToolBody {
  const fields = inputFields(record);
  for (const field of normalized.fields) {
    if (fields.length >= MAX_BODY_FIELDS) break;
    fields.push(field);
  }
  // Only a plain non-JSON string is prose worth rendering; JSON fragments and
  // structured records stay as fields, never markdown.
  const markdown =
    typeof output === 'string' && !looksLikeJson(output) ? normalizedDisplayText(normalized) : null;
  return { kind: 'generic', fields, markdown, unreadable: normalized.unreadable };
}

function webMarkdown(normalized: NormalizedToolOutput): {
  markdown: string | null;
  omitted: number | null;
  truncated: boolean;
} {
  const parts: string[] = [];
  let units = 0;
  const text = normalizedDisplayText(normalized);
  if (text !== null) {
    parts.push(text);
    units = text.length;
  }

  let renderedResults = 0;
  for (const result of normalized.webResults.items) {
    const line = `- [${result.title ?? result.url}](${result.url})`;
    const separator = renderedResults > 0 ? '\n' : parts.length === 0 ? '' : '\n\n';
    if (units + separator.length + line.length > MAX_OUTPUT_TEXT_CODE_UNITS) break;
    if (separator.length > 0) parts.push(separator);
    parts.push(line);
    units += separator.length + line.length;
    renderedResults++;
  }

  const locallyOmitted = normalized.webResults.items.length - renderedResults;
  const omitted =
    normalized.webResults.omitted === null ? null : normalized.webResults.omitted + locallyOmitted;
  return {
    markdown: parts.length === 0 ? null : parts.join(''),
    omitted,
    truncated: normalized.webResults.truncated || locallyOmitted > 0,
  };
}

function resolveToolBody(
  input: ToolPresentationInput,
  family: ToolFamily,
  normalized: NormalizedToolOutput
): ToolBody {
  const name = typeof input.name === 'string' ? input.name : '';
  const record = asRecord(input.input);

  switch (family) {
    case 'shell': {
      const sent = firstStringField(record, COMMAND_KEYS) ?? name;
      const command = sanitizeBounded(sent, MAX_BODY_COMMAND_CODE_UNITS);
      return {
        kind: 'terminal',
        command: command.truncated
          ? withBoundedEllipsis(command.text, MAX_BODY_COMMAND_CODE_UNITS)
          : command.text,
        output: normalizedDisplayText(normalized),
        unreadable: normalized.unreadable,
      };
    }
    case 'file': {
      let preview = normalized.text;
      if (preview === null) {
        const written = firstStringField(record, FILE_PREVIEW_KEYS);
        if (written !== null) {
          const bounded = sanitizeBounded(written, MAX_OUTPUT_TEXT_CODE_UNITS);
          preview = bounded.truncated
            ? withBoundedEllipsis(bounded.text, MAX_OUTPUT_TEXT_CODE_UNITS)
            : bounded.text;
        }
      } else {
        preview = normalizedDisplayText(normalized);
      }
      return {
        kind: 'file',
        path: salientField(record, PATH_KEYS, name, 'file'),
        preview,
        unreadable: normalized.unreadable,
        diff: record === null ? null : fileDiffFor(record),
      };
    }
    case 'search': {
      const pattern = salientField(record, PATTERN_KEYS, name, 'search');
      const scope = boundedString(stringField(record, 'path'));
      const mode = searchBodyMode(record, name, normalized);
      if (mode === 'count') return countBody(normalized);
      if (mode === 'files_with_matches') {
        const list =
          normalized.paths.items.length > 0
            ? normalized.paths
            : boundedTextLines(normalized.text, normalized.textTruncated, pathLine);
        return {
          kind: 'paths',
          pattern,
          scope,
          items: list.items,
          omitted: list.omitted,
          truncated: list.truncated,
        };
      }
      const list =
        normalized.matches.items.length > 0
          ? normalized.matches
          : boundedTextLines(normalized.text, normalized.textTruncated, matchLine);
      return {
        kind: 'matches',
        pattern,
        scope,
        items: list.items,
        omitted: list.omitted,
        truncated: list.truncated,
      };
    }
    case 'glob': {
      const patternKey = boundedString(stringField(record, 'pattern'));
      const pathKey = boundedString(stringField(record, 'path'));
      const list =
        normalized.paths.items.length > 0
          ? normalized.paths
          : boundedTextLines(normalized.text, normalized.textTruncated, pathLine);
      return {
        kind: 'paths',
        pattern: patternKey ?? pathKey ?? chipLabel(name, 'glob'),
        scope: patternKey === null ? null : pathKey,
        items: list.items,
        omitted: list.omitted,
        truncated: list.truncated,
      };
    }
    case 'code': {
      const source = sanitizeBounded(
        firstStringField(record, CODE_SOURCE_KEYS) ?? '',
        MAX_BODY_SOURCE_CODE_UNITS
      );
      const language = stringField(record, 'language');
      return {
        kind: 'code',
        language:
          language === null ? null : truncateCodePoints(language, MAX_GENERIC_SCALAR_CODE_POINTS),
        source: source.text,
        result: normalizedDisplayText(normalized),
        truncated: source.truncated,
      };
    }
    case 'web': {
      const content = webMarkdown(normalized);
      return {
        kind: 'web',
        url: salientField(record, URL_KEYS, name, 'web'),
        title: normalized.fields.find(field => field.key === 'title')?.value ?? null,
        markdown: content.markdown,
        omitted: content.omitted,
        truncated: content.truncated,
      };
    }
    default:
      // 'generic', plus the todo/task families the caller already filtered.
      return genericBody(record, input.output, normalized);
  }
}

/**
 * The expanded body for a row that is open with Raw closed. The supplied
 * family is trusted — it is never re-resolved from input or output. `todo`
 * and `task` return `null`: their bodies belong to their own stories.
 * Malformed or adversarial values degrade to a bounded unreadable generic
 * body rather than throwing.
 */
export function toolBodyPresentation(
  input: ToolPresentationInput,
  resolvedFamily: ToolFamily
): ToolBody | null {
  if (resolvedFamily === 'todo' || resolvedFamily === 'task') return null;
  try {
    return resolveToolBody(input, resolvedFamily, normalizeToolOutput(input.output));
  } catch {
    return { kind: 'generic', fields: [], markdown: null, unreadable: true };
  }
}
