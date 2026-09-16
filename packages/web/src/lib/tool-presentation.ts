/**
 * Classify a provider tool payload into a render-neutral presentation.
 * No React or @archon/* imports — both Legacy and Console consume this.
 */

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

export interface ToolPresentationInput {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ToolPresentation {
  family: ToolFamily;
  label: string;
  chipAriaLabel: string;
  headline: string;
  headlineKind: 'path' | 'text';
  badges: string[];
}

export type ElidedHeadline =
  | { kind: 'path'; head: string; tail: string }
  | { kind: 'text'; text: string };

const MAX_LABEL_LENGTH = 24;
const MAX_GENERIC_SCALARS = 3;
const MAX_GENERIC_VALUE_LENGTH = 80;

export const FAMILY_CHIP_TOKEN: Record<ToolFamily, string> = {
  shell: '--node-bash',
  code: '--node-bash',
  file: '--node-command',
  web: '--node-command',
  search: '--node-prompt',
  glob: '--node-prompt',
  todo: '--node-approval',
  task: '--node-approval',
  generic: '--text-secondary',
};

const MCP_NAME = /^mcp__(.+?)__(.+)$/;
const CODEX_SHELL_WRAPPER = /^\/bin\/(?:zsh|bash) -lc '([\s\S]*)'$/;
const CHIP_SENT_NAME = /^\S+$/;

const FAMILY_ALIASES: readonly (readonly [ToolFamily, readonly string[]])[] = [
  ['shell', ['bash', 'shell', 'run', 'command', 'execute', 'runterminalcommand']],
  [
    'file',
    [
      'edit',
      'write',
      'create',
      'strreplace',
      'applypatch',
      'notebookedit',
      'searchreplace',
      'delete',
      'read',
      'view',
      'cat',
      'open',
      'readfile',
    ],
  ],
  ['search', ['grep', 'search', 'rg', 'searchtool']],
  ['glob', ['glob', 'find', 'ls', 'list', 'listdir']],
  ['code', ['eval', 'runcode', 'execute code', 'executecode']],
  ['todo', ['todo', 'todowrite', 'plan']],
  ['task', ['task', 'agent', 'subagent', 'dispatch']],
  ['web', ['webfetch', 'websearch', 'fetch', 'browse']],
];

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replaceAll(/[_-]/g, '');
}

function matchAlias(name: string): ToolFamily | null {
  const normalized = normalizeToolName(name);
  for (const [family, aliases] of FAMILY_ALIASES) {
    if (aliases.includes(normalized)) {
      return family;
    }
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

function hasCodePair(record: Record<string, unknown>): boolean {
  return typeof record.code === 'string' && Object.hasOwn(record, 'language');
}

function hasCommandKey(record: Record<string, unknown>): boolean {
  return firstString(record, COMMAND_KEYS) !== null;
}

function hasPathKey(record: Record<string, unknown>): boolean {
  return firstString(record, PATH_KEYS) !== null;
}

function hasPatternKey(record: Record<string, unknown>): boolean {
  return firstString(record, PATTERN_KEYS) !== null;
}

function hasUrlKey(record: Record<string, unknown>): boolean {
  return firstString(record, URL_KEYS) !== null;
}

function hasBeforeAfterPair(record: Record<string, unknown>): boolean {
  for (const [before, after] of BEFORE_AFTER_KEYS) {
    if (typeof record[before] === 'string' && typeof record[after] === 'string') {
      return true;
    }
  }
  return false;
}

function duckTypeFamily(record: Record<string, unknown>): ToolFamily | null {
  if (hasCodePair(record)) {
    return 'code';
  }
  if (hasCommandKey(record)) {
    return 'shell';
  }
  if (hasPathKey(record)) {
    return 'file';
  }
  if (hasPatternKey(record)) {
    return 'search';
  }
  if (hasUrlKey(record)) {
    return 'web';
  }
  if (hasBeforeAfterPair(record)) {
    return 'file';
  }
  return null;
}

function firstNonEmptyLine(source: string): string {
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() !== '') {
      return line;
    }
  }
  return '';
}

function headlineKindFor(family: ToolFamily): 'path' | 'text' {
  return family === 'file' || family === 'glob' ? 'path' : 'text';
}

function chipAriaLabelFor(label: string, family: ToolFamily): string {
  return label !== family ? `${label}, ${family} tool` : `${family} tool`;
}

function chipLabelFor(name: string, family: ToolFamily): string {
  return CHIP_SENT_NAME.test(name) && name.length <= MAX_LABEL_LENGTH ? name : family;
}

function present(
  family: ToolFamily,
  name: string,
  record: Record<string, unknown> | null
): ToolPresentation {
  const label = chipLabelFor(name, family);
  return {
    family,
    label,
    chipAriaLabel: chipAriaLabelFor(label, family),
    headline: headlineFor(family, name, record),
    headlineKind: headlineKindFor(family),
    badges: badgesFor(family, record),
  };
}

function stripCodexShellWrapper(source: string): string {
  const match = CODEX_SHELL_WRAPPER.exec(source);
  return match?.[1] ?? source;
}

function firstLineHeadline(source: string): string {
  let first: string | null = null;
  for (const line of stripCodexShellWrapper(source).split(/\r?\n/)) {
    if (line.trim() !== '') {
      if (first !== null) {
        return `${first}…`;
      }
      first = line;
    }
  }
  return first ?? '';
}

function isGenericScalar(value: unknown): value is string | number | boolean | null {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value);
}

function formatGenericScalar(value: string | number | boolean | null): string {
  const raw = value === null ? 'null' : String(value);
  if (raw.length > MAX_GENERIC_VALUE_LENGTH) {
    return `${raw.slice(0, MAX_GENERIC_VALUE_LENGTH)}…`;
  }
  return raw;
}

function genericHeadline(name: string, record: Record<string, unknown> | null): string {
  if (record === null) {
    return name;
  }
  const pairs: string[] = [];
  for (const key of Object.keys(record)) {
    if (pairs.length >= MAX_GENERIC_SCALARS) {
      break;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      continue;
    }
    const value = descriptor.value as unknown;
    if (!isGenericScalar(value)) {
      continue;
    }
    pairs.push(`${key}: ${formatGenericScalar(value)}`);
  }
  return pairs.length === 0 ? name : pairs.join(' · ');
}

function headlineFor(
  family: ToolFamily,
  name: string,
  record: Record<string, unknown> | null
): string {
  if (family === 'shell') {
    return firstLineHeadline(firstString(record ?? {}, COMMAND_KEYS) ?? name);
  }
  if (record === null) {
    return name;
  }
  switch (family) {
    case 'file':
      return firstString(record, PATH_KEYS) ?? name;
    case 'search':
      return firstString(record, PATTERN_KEYS) ?? name;
    case 'glob':
      return firstString(record, ['pattern']) ?? firstString(record, PATH_KEYS) ?? name;
    case 'web':
      return firstString(record, URL_KEYS) ?? name;
    case 'code': {
      const source = typeof record.code === 'string' ? record.code : name;
      const line = firstNonEmptyLine(source);
      return line === '' ? source : line;
    }
    case 'todo':
    case 'task':
      return name;
    case 'generic':
      return genericHeadline(name, record);
  }
}

function badgesFor(family: ToolFamily, record: Record<string, unknown> | null): string[] {
  if (family !== 'code' || record === null) {
    return [];
  }
  const language = record.language;
  return typeof language === 'string' && language !== '' ? [language] : [];
}

function genericPresentation(
  name: string,
  record: Record<string, unknown> | null = null
): ToolPresentation {
  return present('generic', name, record);
}

function isEmptyRecord(record: Record<string, unknown>): boolean {
  return Object.keys(record).length === 0;
}

function mcpPresentation(name: string): ToolPresentation | null {
  const match = MCP_NAME.exec(name);
  if (match === null) {
    return null;
  }
  const formatted = `${match[1]} · ${match[2]}`;
  const label = formatted.length <= MAX_LABEL_LENGTH ? formatted : 'generic';
  return {
    family: 'generic',
    label,
    chipAriaLabel: chipAriaLabelFor(label, 'generic'),
    headline: formatted,
    headlineKind: 'text',
    badges: [],
  };
}

export function elideHeadline(headline: string, headlineKind: 'path' | 'text'): ElidedHeadline {
  if (headlineKind === 'text') {
    return { kind: 'text', text: headline };
  }
  const lastSlash = headline.lastIndexOf('/');
  if (lastSlash === -1) {
    return { kind: 'path', head: '', tail: headline };
  }
  return {
    kind: 'path',
    head: headline.slice(0, lastSlash + 1),
    tail: headline.slice(lastSlash + 1),
  };
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation {
  let name = 'generic';
  try {
    const rawName = input.name;
    if (typeof rawName !== 'string') {
      return genericPresentation(name);
    }
    name = rawName;

    if (input.input !== undefined && !isPlainObject(input.input)) {
      return genericPresentation(name);
    }

    const mcp = mcpPresentation(name);
    if (mcp !== null) {
      return mcp;
    }

    const record = isPlainObject(input.input) ? input.input : null;
    const aliasFamily = matchAlias(name);
    if (aliasFamily !== null) {
      return present(aliasFamily, name, record);
    }

    if (record !== null) {
      const ducked = duckTypeFamily(record);
      if (ducked !== null) {
        return present(ducked, name, record);
      }
      if (isEmptyRecord(record)) {
        return present('shell', name, record);
      }
      return genericPresentation(name, record);
    }

    return present('shell', name, null);
  } catch {
    return genericPresentation(name);
  }
}
