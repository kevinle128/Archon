/**
 * Tool Call Formatter
 *
 * Formats a tool call announcement for platform adapters that have no
 * structured tool-call rendering of their own (Slack, Telegram, GitHub
 * comments, CLI text output). It resolves the same family, headline, and
 * outcome glyph as `packages/web/src/lib/tool-presentation.ts` so a reader
 * switching between the Web UI and a text platform sees the same meaning —
 * only the transport-appropriate shape differs.
 *
 * `@archon/workflows` cannot depend on `@archon/web` (package dependency
 * order runs the other way), so the resolver below is an independent copy of
 * the same four-tier contract, not a shared import. A fixture-driven parity
 * test in this package proves the two stay in agreement; see
 * `tool-formatter.fixtures.test.ts`.
 */

const MAX_ALIAS_NAME_CODE_UNITS = 128;
const MAX_CHIP_CODE_POINTS = 24;
const MAX_HEADLINE_SOURCE_CODE_UNITS = 4096;
const MAX_GENERIC_KEYS_SCANNED = 32;
const MAX_GENERIC_FACTS = 3;
const MAX_GENERIC_SCALAR_CODE_POINTS = 80;
const MAX_COUNT_OUTPUT_CODE_UNITS = 4096;
const MAX_COUNT_KEYS_SCANNED = 32;
const MAX_TASK_SUBTASKS = 64;

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
export type ToolOutcome = 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';

export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output?: unknown;
}

export interface ToolPresentationFacts {
  outcome: ToolOutcome;
  exitCode?: number | null;
  durationMs?: number | null;
}

export interface ToolPresentationBadge {
  kind: 'state' | 'exit' | 'duration' | 'count' | 'language' | 'operation' | 'placeholder';
  text: string;
}

/** The compact-form counterpart of the Web summary layer: no body, no diff — see the module docblock. */
export interface ToolPresentationSummary {
  family: ToolFamily;
  label: string;
  headline: string;
  glyph: string;
  badges: ToolPresentationBadge[];
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
const BEFORE_AFTER_KEYS = [
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

const OUTCOME_GLYPH: Record<ToolOutcome, string> = {
  succeeded: '✓',
  failed: '✕',
  running: '◐',
  interrupted: '⚠',
  unknown: '–',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
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

function boundedString(value: string | null): string | null {
  if (value === null || value.length > MAX_HEADLINE_SOURCE_CODE_UNITS) return null;
  return value;
}

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

/** The sent name earns the chip only when it is one non-empty, whitespace-free token of at most MAX_CHIP_CODE_POINTS. */
function chipLabel(name: string, family: ToolFamily): string {
  let points = 0;
  for (const char of name) {
    if (/\s/.test(char)) return family;
    points++;
    if (points > MAX_CHIP_CODE_POINTS) return family;
  }
  return points > 0 ? name : family;
}

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

/** First non-empty line of a source that fits the headline cap, with a trailing `…` when later non-empty lines follow. */
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

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return truncateCodePoints(value, MAX_GENERIC_SCALAR_CODE_POINTS);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
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
    const boundedKey = truncateCodePoints(key, MAX_GENERIC_SCALAR_CODE_POINTS);
    if (boundedKey.length === 0) continue;
    facts.push(`${boundedKey}: ${text}`);
    if (facts.length >= MAX_GENERIC_FACTS) break;
  }
  return facts;
}

function singularOrPlural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

function isCountValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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

/** Bounded count extraction: a finite nonnegative integer scalar, a digit-only or small JSON record string, or a shallow recognized numeric key. */
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

/** Tier-2 duck-typing on known input keys, in contract priority order. */
function inferFamily(record: Record<string, unknown>): ToolFamily | null {
  if (stringField(record, 'code') !== null && stringField(record, 'language') !== null)
    return 'code';
  if (firstStringField(record, COMMAND_KEYS) !== null) return 'shell';
  if (firstStringField(record, PATH_KEYS) !== null) return 'file';
  if (firstStringField(record, PATTERN_KEYS) !== null) return 'search';
  if (firstStringField(record, URL_KEYS) !== null) return 'web';
  for (const [before, after] of BEFORE_AFTER_KEYS) {
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

/**
 * Subtask count only — the badge this family shows. Full task-dispatch
 * normalization (OMP batch vs Claude single, excerpts, validation) lives in
 * `packages/web/src/lib/task-normalize.ts` and backs the Node Room task
 * body; this backend surface never renders that body, so it needs only the
 * count. `tasks` selects the OMP batch shape even over Claude-like keys;
 * a `description`+`prompt` pair is exactly one dispatch.
 */
function taskSubtaskCount(record: Record<string, unknown> | null): number | null {
  if (record === null) return null;
  const tasks = record.tasks;
  if (Array.isArray(tasks)) {
    const count = tasks.length;
    return count >= 1 && count <= MAX_TASK_SUBTASKS ? count : null;
  }
  if (stringField(record, 'description') !== null && stringField(record, 'prompt') !== null)
    return 1;
  return null;
}

function operationBadge(record: Record<string, unknown> | null): ToolPresentationBadge | null {
  const text = scalarText(record?.op);
  if (text === null) return null;
  return { kind: 'operation', text: `op: ${text}` };
}

function languageBadge(record: Record<string, unknown> | null): ToolPresentationBadge | null {
  const language = stringField(record, 'language');
  if (language === null) return null;
  return { kind: 'language', text: truncateCodePoints(language, MAX_GENERIC_SCALAR_CODE_POINTS) };
}

function countBadge(output: unknown): ToolPresentationBadge | null {
  const count = extractCount(output);
  if (count === null) return null;
  return { kind: 'count', text: `${String(count.value)} ${count.unit}` };
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface ResolvedContent {
  family: ToolFamily;
  headline: string | null;
  contentBadges: ToolPresentationBadge[];
}

function resolveContent(
  name: string,
  record: Record<string, unknown> | null,
  output: unknown
): ResolvedContent {
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
  const contentBadges: ToolPresentationBadge[] = [];

  switch (family) {
    case 'shell':
      headline = shellHeadline(name, record);
      break;
    case 'file':
      headline = boundedString(firstStringField(record, PATH_KEYS));
      break;
    case 'search': {
      headline = searchHeadline(record);
      const count = countBadge(output);
      if (count !== null) contentBadges.push(count);
      break;
    }
    case 'glob':
      headline = globHeadline(record);
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
      headline = taskHeadline(record);
      const count = taskSubtaskCount(record);
      if (count !== null)
        contentBadges.push({ kind: 'count', text: singularOrPlural(count, 'subagent') });
      break;
    }
    case 'web':
      headline = boundedString(firstStringField(record, URL_KEYS));
      break;
    case 'generic': {
      const facts = genericFacts(record);
      headline = facts.length > 0 ? facts.join(' · ') : null;
      break;
    }
  }

  return { family, headline, contentBadges };
}

/**
 * The same four-tier resolution `tool-presentation.ts` runs, reduced to the
 * fields a compact text message needs: family, chip label, headline, glyph,
 * and ordered badges. No body, no diff (the differ is a Web-only dependency —
 * see the module docblock), no output-state tracking (this surface only ever
 * announces a call before its result exists). Malformed input degrades to
 * the safe generic fallback rather than throwing.
 */
export function resolveToolPresentationSummary(
  toolInput: ToolPresentationInput,
  facts: ToolPresentationFacts
): ToolPresentationSummary {
  try {
    const name = typeof toolInput.name === 'string' ? toolInput.name : '';
    const record = asRecord(toolInput.input);

    const mcp = mcpLabel(name);
    if (mcp !== null) {
      const contentFacts = genericFacts(record);
      return {
        family: 'generic',
        label: mcp,
        headline: contentFacts.length > 0 ? contentFacts.join(' · ') : mcp,
        glyph: OUTCOME_GLYPH[facts.outcome],
        badges: badgesFor([], facts),
      };
    }

    const { family, headline, contentBadges } = resolveContent(name, record, toolInput.output);
    const label = chipLabel(name, family);
    return {
      family,
      label,
      headline: headline ?? label,
      glyph: OUTCOME_GLYPH[facts.outcome],
      badges: badgesFor(contentBadges, facts),
    };
  } catch {
    return {
      family: 'generic',
      label: 'generic',
      headline: 'generic',
      glyph: OUTCOME_GLYPH[facts.outcome],
      badges: badgesFor([], facts),
    };
  }
}

/** State badge, then content badges, then exit, then duration — the same order `toolRowPresentation` composes, minus the output-state tier this surface never has evidence for. */
function badgesFor(
  contentBadges: ToolPresentationBadge[],
  facts: ToolPresentationFacts
): ToolPresentationBadge[] {
  const badges: ToolPresentationBadge[] = [];
  if (facts.outcome === 'running') badges.push({ kind: 'state', text: 'running' });
  else if (facts.outcome === 'interrupted') badges.push({ kind: 'state', text: 'interrupted' });
  else if (facts.outcome === 'unknown') badges.push({ kind: 'state', text: 'output unknown' });

  badges.push(...contentBadges);

  if (typeof facts.exitCode === 'number' && Number.isFinite(facts.exitCode)) {
    badges.push({ kind: 'exit', text: `exit ${String(facts.exitCode)}` });
  }
  if (
    typeof facts.durationMs === 'number' &&
    Number.isFinite(facts.durationMs) &&
    facts.durationMs >= 0
  ) {
    badges.push({ kind: 'duration', text: formatDurationMs(facts.durationMs) });
  }
  if (badges.length === 0) badges.push({ kind: 'placeholder', text: '—' });
  return badges;
}

/**
 * Format a tool-call announcement for display.
 *
 * Only ever called at call-start (no output exists yet), so the outcome is
 * always `running` — this is the announcement, not the result. The glyph
 * already says "running"; repeating it as a badge on every single line would
 * be noise, so this wrapper drops the state badge `resolveToolPresentationSummary`
 * would otherwise add and keeps only badges that resolve from the input
 * itself (language, an operation, a subtask count).
 *
 * @param toolName - Name of the tool being called
 * @param toolInput - Input parameters for the tool
 * @returns A compact one-line summary: glyph, family chip, headline, and any input-derived badge
 */
export function formatToolCall(toolName: string, toolInput?: Record<string, unknown>): string {
  const summary = resolveToolPresentationSummary(
    { name: toolName, input: toolInput ?? {} },
    { outcome: 'running' }
  );
  const inputDerivedBadges = summary.badges.filter(
    badge => badge.kind !== 'placeholder' && badge.kind !== 'state'
  );
  const badgeSuffix =
    inputDerivedBadges.length > 0 ? ` (${inputDerivedBadges.map(b => b.text).join(' · ')})` : '';
  return `${summary.glyph} [${summary.label}] ${summary.headline}${badgeSuffix}`;
}

/**
 * Format thinking/reasoning for display (optional)
 *
 * @param thinking - Thinking text from AI
 * @returns Formatted thinking message
 */
export function formatThinking(thinking: string): string {
  const maxLength = 200;
  if (thinking.length > maxLength) {
    return `💭 ${thinking.substring(0, maxLength)}...`;
  }
  return `💭 ${thinking}`;
}
