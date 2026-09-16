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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function present(
  family: ToolFamily,
  name: string,
  record: Record<string, unknown> | null
): ToolPresentation {
  const label = name;
  return {
    family,
    label,
    chipAriaLabel: chipAriaLabelFor(label, family),
    headline: headlineFor(family, name, record),
    headlineKind: headlineKindFor(family),
    badges: badgesFor(family, record),
  };
}

function headlineFor(
  family: ToolFamily,
  name: string,
  record: Record<string, unknown> | null
): string {
  if (record === null) {
    return name;
  }
  switch (family) {
    case 'shell':
      return firstString(record, COMMAND_KEYS) ?? name;
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
    case 'generic':
      return name;
  }
}

function badgesFor(family: ToolFamily, record: Record<string, unknown> | null): string[] {
  if (family !== 'code' || record === null) {
    return [];
  }
  const language = record.language;
  return typeof language === 'string' && language !== '' ? [language] : [];
}

function genericPresentation(name: string): ToolPresentation {
  return present('generic', name, null);
}

function isEmptyRecord(record: Record<string, unknown>): boolean {
  return Object.keys(record).length === 0;
}

export function toolPresentation(input: ToolPresentationInput): ToolPresentation {
  const rawName = input.name;
  const validName = typeof rawName === 'string';
  const name = validName ? rawName : '';

  if (!validName || (input.input !== undefined && !isPlainObject(input.input))) {
    return genericPresentation(name);
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
    return genericPresentation(name);
  }

  return present('shell', name, null);
}
