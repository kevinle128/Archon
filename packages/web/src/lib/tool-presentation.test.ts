import { describe, expect, test } from 'bun:test';

import {
  MAX_ALIAS_NAME_CODE_UNITS,
  MAX_BODY_COMMAND_CODE_UNITS,
  MAX_BODY_FIELDS,
  MAX_CHIP_CODE_POINTS,
  MAX_COUNT_KEYS_SCANNED,
  MAX_COUNT_OUTPUT_CODE_UNITS,
  MAX_GENERIC_FACTS,
  MAX_GENERIC_KEYS_SCANNED,
  MAX_GENERIC_SCALAR_CODE_POINTS,
  MAX_HEADLINE_SOURCE_CODE_UNITS,
  toolBodyPresentation,
  toolPresentation,
  toolRawPayloadJson,
  toolRowPresentation,
  type ToolFamily,
  type ToolRowBadge,
  type ToolRowFacts,
} from './tool-presentation';
import { MAX_TASK_SUBTASKS, MAX_TASK_TOTAL_TEXT_CODE_UNITS } from './task-normalize';
import {
  MAX_FIELD_KEY_CODE_UNITS,
  MAX_LIST_ITEMS,
  MAX_OUTPUT_TEXT_CODE_UNITS,
} from './tool-output';

function call(
  name: string,
  input: unknown = undefined,
  output: unknown = undefined
): ReturnType<typeof toolPresentation> {
  return toolPresentation({ name, input, output });
}

function row(
  name: string,
  input: unknown,
  output: unknown,
  facts: ToolRowFacts
): ReturnType<typeof toolRowPresentation> {
  return toolRowPresentation({ name, input, output }, facts);
}

const SUCCEEDED: ToolRowFacts = { outcome: 'succeeded', outputState: 'full' };

describe('alias resolution', () => {
  const aliasCases: [string, ToolFamily][] = [
    ['bash', 'shell'],
    ['shell', 'shell'],
    ['run', 'shell'],
    ['command', 'shell'],
    ['execute', 'shell'],
    ['run_terminal_command', 'shell'],
    ['edit', 'file'],
    ['write', 'file'],
    ['create', 'file'],
    ['str_replace', 'file'],
    ['apply_patch', 'file'],
    ['notebook_edit', 'file'],
    ['search_replace', 'file'],
    ['delete', 'file'],
    ['read', 'file'],
    ['view', 'file'],
    ['cat', 'file'],
    ['open', 'file'],
    ['read_file', 'file'],
    ['grep', 'search'],
    ['search', 'search'],
    ['rg', 'search'],
    ['search_tool', 'search'],
    ['glob', 'glob'],
    ['find', 'glob'],
    ['ls', 'glob'],
    ['list', 'glob'],
    ['list_dir', 'glob'],
    ['eval', 'code'],
    ['run_code', 'code'],
    ['execute code', 'code'],
    ['todo', 'todo'],
    ['todo_write', 'todo'],
    ['plan', 'todo'],
    ['task', 'task'],
    ['agent', 'task'],
    ['subagent', 'task'],
    ['dispatch', 'task'],
    ['webfetch', 'web'],
    ['web_search', 'web'],
    ['fetch', 'web'],
    ['browse', 'web'],
  ];

  for (const [name, family] of aliasCases) {
    test(`${name} resolves to ${family}`, () => {
      expect(call(name).family).toBe(family);
    });
  }

  test('normalization folds case and strips separators', () => {
    expect(call('Bash').family).toBe('shell');
    expect(call('TodoWrite').family).toBe('todo');
    expect(call('read-file').family).toBe('file');
    expect(call('STR-REPLACE').family).toBe('file');
    expect(call('ReadFile').family).toBe('file');
  });

  test('search_replace resolves to file, never search', () => {
    expect(call('search_replace', { path: 'a.ts', old_string: 'x', new_string: 'y' }).family).toBe(
      'file'
    );
  });

  test('matching is exact, never substring', () => {
    expect(call('searchers').family).toBe('generic');
    expect(call('mygrep').family).toBe('generic');
    expect(call('editorial').family).toBe('generic');
  });

  test('unknown name resolves to generic', () => {
    const presentation = call('frobnicate', { alpha: 1 });
    expect(presentation.family).toBe('generic');
    expect(presentation.label).toBe('frobnicate');
  });

  test('name over the alias bound skips alias lookup', () => {
    const name = `bash${'_'.repeat(MAX_ALIAS_NAME_CODE_UNITS - 'bash'.length + 1)}`;
    expect(name.length).toBe(MAX_ALIAS_NAME_CODE_UNITS + 1);
    // Normalizing would strip the underscores and hit `bash`; the bound prevents that.
    expect(call(name).family).toBe('generic');
  });

  test('name at the alias bound still resolves', () => {
    const name = `bash${'_'.repeat(MAX_ALIAS_NAME_CODE_UNITS - 'bash'.length)}`;
    expect(name.length).toBe(MAX_ALIAS_NAME_CODE_UNITS);
    expect(call(name).family).toBe('shell');
  });
});

describe('mcp names', () => {
  test('mcp__server__tool resolves to generic with server · tool label', () => {
    const presentation = call('mcp__github__create_issue', { title: 'bug' });
    expect(presentation.family).toBe('generic');
    expect(presentation.label).toBe('github · create_issue');
    expect(presentation.headline).toBe('title: bug');
  });

  test('mcp input keys cannot reclassify the family', () => {
    const presentation = call('mcp__fs__read_text_file', { path: '/tmp/a.txt' });
    expect(presentation.family).toBe('generic');
    expect(presentation.label).toBe('fs · read_text_file');
  });

  test('mcp without scalar input falls back to the compact label headline', () => {
    const presentation = call('mcp__github__create_issue', { nested: { deep: true } });
    expect(presentation.headline).toBe('github · create_issue');
  });

  test('malformed mcp names fall through to normal resolution', () => {
    expect(call('mcp__').family).toBe('generic');
    expect(call('mcp__server').family).toBe('generic');
    expect(call('mcp___tool').family).toBe('generic');
    expect(call('mcp__server__').family).toBe('generic');
  });
});

describe('input-key inference', () => {
  test('code + language resolves to code', () => {
    const presentation = call('mystery', { code: 'print(1)', language: 'python' });
    expect(presentation.family).toBe('code');
    expect(presentation.headline).toBe('print(1)');
  });

  test('command key resolves to shell', () => {
    const presentation = call('mystery', { command: 'ls -la' });
    expect(presentation.family).toBe('shell');
    expect(presentation.headline).toBe('ls -la');
  });

  test('cmd and script keys resolve to shell', () => {
    expect(call('mystery', { cmd: 'pwd' }).family).toBe('shell');
    expect(call('mystery', { script: 'echo hi' }).family).toBe('shell');
  });

  test('path keys resolve to file in contract priority', () => {
    for (const key of ['file_path', 'path', 'target_file', 'file', 'filename', 'notebook_path']) {
      const presentation = call('mystery', { [key]: 'a/b.txt' });
      expect(presentation.family).toBe('file');
      expect(presentation.headline).toBe('a/b.txt');
      expect(presentation.headlineKind).toBe('path');
    }
  });

  test('pattern keys resolve to search', () => {
    for (const key of ['pattern', 'query', 'regex', 'search']) {
      const presentation = call('mystery', { [key]: 'TODO' });
      expect(presentation.family).toBe('search');
      expect(presentation.headline).toBe('TODO');
    }
  });

  test('url keys resolve to web', () => {
    for (const key of ['url', 'uri']) {
      const presentation = call('mystery', { [key]: 'https://example.com/a' });
      expect(presentation.family).toBe('web');
      expect(presentation.headline).toBe('https://example.com/a');
      expect(presentation.headlineKind).toBe('path');
    }
  });

  test('before/after pairs resolve to file', () => {
    for (const [before, after] of [
      ['old_string', 'new_string'],
      ['old_str', 'new_str'],
      ['content', 'new_content'],
    ]) {
      expect(call('mystery', { [before]: 'a', [after]: 'b' }).family).toBe('file');
    }
  });

  test('single before/after half does not resolve to file', () => {
    expect(call('mystery', { old_string: 'a' }).family).toBe('generic');
    expect(call('mystery', { new_content: 'b' }).family).toBe('generic');
  });

  test('inference priority: code+language beats command', () => {
    expect(call('mystery', { command: 'x', code: 'print(1)', language: 'python' }).family).toBe(
      'code'
    );
  });

  test('inference priority: command beats path', () => {
    expect(call('mystery', { command: 'ls', path: 'a.txt' }).family).toBe('shell');
  });

  test('inference priority: path beats pattern', () => {
    expect(call('mystery', { pattern: 'x', file_path: 'a.txt' }).family).toBe('file');
  });

  test('non-string signal values do not infer', () => {
    expect(call('mystery', { command: { nested: true } }).family).toBe('generic');
    expect(call('mystery', { path: 42 }).family).toBe('generic');
    expect(call('mystery', { code: 'x', language: 5 }).family).toBe('generic');
  });
});

describe('codex name-only shell path', () => {
  test('command-like name with absent input resolves to shell', () => {
    const presentation = call('npm test');
    expect(presentation.family).toBe('shell');
    expect(presentation.headline).toBe('npm test');
    expect(presentation.label).toBe('shell');
  });

  test('command-like name with empty input object resolves to shell', () => {
    expect(call('git status', {}).family).toBe('shell');
  });

  test('single-token name with absent input resolves to generic', () => {
    expect(call('frobnicate').family).toBe('generic');
  });

  test('multiline script name headlines the first non-empty line with ellipsis', () => {
    const presentation = call('for i in 1 2 3\ndo echo $i\ndone');
    expect(presentation.family).toBe('shell');
    expect(presentation.headline).toBe('for i in 1 2 3…');
    expect(presentation.headline).not.toContain('\n');
  });

  test('leading blank lines are skipped before the headline line', () => {
    const presentation = call('\n\n git log --oneline\nnext');
    expect(presentation.headline).toBe('git log --oneline…');
  });

  test('complete /bin/zsh -lc wrapper is stripped before the headline', () => {
    const presentation = call("/bin/zsh -lc 'ls -la /tmp'");
    expect(presentation.family).toBe('shell');
    expect(presentation.headline).toBe('ls -la /tmp');
    expect(presentation.headline.startsWith('/bin/')).toBe(false);
  });

  test('complete /bin/bash -lc wrapper is stripped', () => {
    const presentation = call("/bin/bash -lc 'bun test foo'");
    expect(presentation.headline).toBe('bun test foo');
  });

  test('incomplete wrapper stays untouched', () => {
    const name = "/bin/zsh -lc 'ls -la";
    const presentation = call(name);
    expect(presentation.headline).toBe(name);
  });

  test('overlong multiline name resolves to shell', () => {
    const name = `${'a'.repeat(MAX_HEADLINE_SOURCE_CODE_UNITS + 1)} rest`;
    expect(call(name).family).toBe('shell');
    expect(call(name).headline).toBe('shell');
  });
});

describe('family headlines', () => {
  test('shell headlines the command input', () => {
    const presentation = call('Bash', { command: 'bun test node-room' });
    expect(presentation.headline).toBe('bun test node-room');
    expect(presentation.headlineKind).toBe('text');
    expect(presentation.label).toBe('Bash');
  });

  test('shell command input keeps first line with ellipsis for later lines', () => {
    const presentation = call('bash', { command: 'echo one\necho two' });
    expect(presentation.headline).toBe('echo one…');
  });

  test('file headlines the first present path key in priority order', () => {
    const presentation = call('Edit', { file_path: 'a.ts', path: 'b.ts' });
    expect(presentation.headline).toBe('a.ts');
    expect(presentation.headlineKind).toBe('path');
  });

  test('search headlines pattern plus scope', () => {
    const presentation = call('Grep', { pattern: 'TODO', path: 'packages/web' });
    expect(presentation.headline).toBe('TODO in packages/web');
    expect(presentation.headlineKind).toBe('text');
  });

  test('search without scope headlines the pattern alone', () => {
    expect(call('grep', { pattern: 'TODO' }).headline).toBe('TODO');
  });

  test('claude glob headlines pattern and does not show the scope path', () => {
    const presentation = call('Glob', { pattern: '**/*.tsx', path: 'packages/web' });
    expect(presentation.family).toBe('glob');
    expect(presentation.headline).toBe('**/*.tsx');
    expect(presentation.headline).not.toContain('packages/web');
    expect(presentation.headlineKind).toBe('path');
  });

  test('omp glob headlines path when no pattern exists', () => {
    const presentation = call('glob', { path: 'packages/web/src' });
    expect(presentation.headline).toBe('packages/web/src');
    expect(presentation.headlineKind).toBe('path');
  });

  test('code headlines the first non-empty source line', () => {
    const presentation = call('eval', { code: '\n  const x = 1;\nreturn x;', language: 'ts' });
    expect(presentation.headline).toBe('const x = 1;…');
    expect(presentation.headlineKind).toBe('text');
  });

  test('code language becomes a content badge', () => {
    const presentation = call('eval', { code: 'print(1)', language: 'python' });
    expect(presentation.contentBadges).toEqual([
      { kind: 'language', text: 'python', tone: 'neutral' },
    ]);
  });

  test('todo headlines the folded-call headline', () => {
    const presentation = call('TodoWrite', { todos: [{ content: 'x' }] });
    expect(presentation.family).toBe('todo');
    expect(presentation.headline).toBe('todo updated');
  });

  test('todo op becomes a bounded operation badge', () => {
    const presentation = call('todo', { op: 'add', text: 'thing' });
    expect(presentation.contentBadges).toEqual([
      { kind: 'operation', text: 'op: add', tone: 'neutral' },
    ]);
  });

  test('task prefers description, then first task name, then context', () => {
    expect(call('task', { description: 'review the diff' }).headline).toBe('review the diff');
    expect(call('task', { tasks: [{ name: 'scan repo', agent: 'x', task: 'do' }] }).headline).toBe(
      'scan repo'
    );
    expect(call('task', { context: 'first line\nsecond' }).headline).toBe('first line…');
  });

  test('web headlines the url', () => {
    const presentation = call('WebFetch', { url: 'https://example.com/docs/page' });
    expect(presentation.headline).toBe('https://example.com/docs/page');
    expect(presentation.headlineKind).toBe('path');
  });

  test('generic headlines up to three scalar key: value facts', () => {
    const presentation = call('custom_tool', { a: 1, b: 'two', c: true, d: 'four' });
    expect(presentation.headline).toBe('a: 1 · b: two · c: true');
    expect(presentation.headline).not.toContain('d:');
  });

  test('generic objects and arrays never serialize into the headline', () => {
    const presentation = call('custom_tool', { nested: { deep: [1, 2] }, list: [1], ok: 'yes' });
    expect(presentation.headline).toBe('ok: yes');
    expect(presentation.headline).not.toContain('{');
    expect(presentation.headline).not.toContain('[');
    expect(presentation.headline).not.toContain('…]');
  });

  test('generic with no scalar facts falls back to the compact label', () => {
    expect(call('frobnicate', { nested: {} }).headline).toBe('frobnicate');
    const longName = 'x'.repeat(100);
    expect(call(longName, { nested: {} }).headline).toBe('generic');
  });

  test('generic scalar values truncate at the scalar bound', () => {
    const value = 'v'.repeat(MAX_GENERIC_SCALAR_CODE_POINTS + 10);
    const presentation = call('custom_tool', { big: value });
    expect(presentation.headline).toBe(`big: ${'v'.repeat(MAX_GENERIC_SCALAR_CODE_POINTS)}…`);
  });
});

describe('chip label', () => {
  test('sent name kept verbatim within the bound', () => {
    expect(call('read_file').label).toBe('read_file');
    expect(call('Edit').label).toBe('Edit');
    expect(call('eval').label).toBe('eval');
  });

  test('chip is never the normalized form', () => {
    const presentation = call('read_file');
    expect(presentation.label).not.toBe('readfile');
  });

  test('name at the chip bound is kept', () => {
    const name = 'a'.repeat(MAX_CHIP_CODE_POINTS);
    expect(call(name).label).toBe(name);
  });

  test('name one code point over the chip bound falls back to family', () => {
    const name = 'a'.repeat(MAX_CHIP_CODE_POINTS + 1);
    expect(call(name).label).toBe('generic');
  });

  test('unicode names count code points not code units', () => {
    const name = '🔧'.repeat(MAX_CHIP_CODE_POINTS);
    expect([...name].length).toBe(MAX_CHIP_CODE_POINTS);
    expect(call(name).label).toBe(name);
    const over = '🔧'.repeat(MAX_CHIP_CODE_POINTS + 1);
    expect(call(over).label).toBe('generic');
  });

  test('whitespace or newline in the name falls back to family', () => {
    expect(call('not a name').label).toBe('shell');
    expect(call('two\nlines').label).toBe('shell');
    expect(call('with\ttab').label).toBe('shell');
    expect(call('execute code').label).toBe('code');
  });

  test('rejected name never leaks into the label or headline', () => {
    const rejected = `bad name ${'z'.repeat(60)}`;
    const presentation = call(rejected, { alpha: 'x' });
    expect(presentation.label).not.toContain('bad name');
    expect(presentation.headline).not.toContain('bad name');
  });

  test('emoji-bearing name passes through unchanged', () => {
    expect(call('🔧fix').label).toBe('🔧fix');
  });

  test('label stays within the chip bound for ordinary tools', () => {
    for (const name of ['bash', 'read_file', 'TodoWrite', 'x'.repeat(200), 'some tool name']) {
      expect([...call(name).label].length).toBeLessThanOrEqual(MAX_CHIP_CODE_POINTS);
    }
  });
});

describe('headline source bound', () => {
  test('path at the bound is accepted whole', () => {
    const path = 'a/'.repeat(MAX_HEADLINE_SOURCE_CODE_UNITS / 2);
    const presentation = call('Read', { path });
    expect(presentation.headline).toBe(path);
  });

  test('path over the bound falls back instead of fabricating a partial path', () => {
    const path = 'a/'.repeat(MAX_HEADLINE_SOURCE_CODE_UNITS);
    expect(path.length).toBeGreaterThan(MAX_HEADLINE_SOURCE_CODE_UNITS);
    const presentation = call('Read', { path });
    expect(presentation.headline).toBe('Read');
    expect(presentation.headline).not.toContain('a/');
  });

  test('command over the bound falls back to the label', () => {
    const command = `echo ${'x'.repeat(MAX_HEADLINE_SOURCE_CODE_UNITS)}`;
    const presentation = call('bash', { command });
    expect(presentation.headline).toBe('bash');
  });

  test('single line command without newline inside the bound stays whole', () => {
    const command = 'x'.repeat(MAX_HEADLINE_SOURCE_CODE_UNITS);
    expect(call('bash', { command }).headline).toBe(command);
  });
});

describe('generic bounds', () => {
  test('keys at the scan bound are all eligible', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < MAX_GENERIC_KEYS_SCANNED; i++) input[`k${String(i)}`] = i;
    const presentation = call('custom_tool', input);
    expect(presentation.headline).toBe('k0: 0 · k1: 1 · k2: 2');
  });

  test('keys past the scan bound are never enumerated', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < MAX_GENERIC_KEYS_SCANNED; i++) input[`k${String(i)}`] = 'skip';
    input.target = 'found';
    const presentation = call('custom_tool', input);
    expect(presentation.headline).not.toContain('target');
    expect(presentation.headline).toBe('k0: skip · k1: skip · k2: skip');
  });

  test('fourth scalar fact is omitted', () => {
    const input = { a: 1, b: 2, c: 3, d: 4 };
    const facts = call('custom_tool', input).headline.split(' · ');
    expect(facts).toHaveLength(MAX_GENERIC_FACTS);
  });

  test('non-scalar values do not consume fact slots', () => {
    const presentation = call('custom_tool', {
      o: { x: 1 },
      l: [1, 2],
      a: 'v',
      b: 2,
      c: true,
      d: 'z',
    });
    expect(presentation.headline).toBe('a: v · b: 2 · c: true');
  });
});

describe('adversarial inputs', () => {
  test('null, array, primitive inputs never throw', () => {
    for (const input of [null, undefined, [1, 2, 3], 'text', 42, true]) {
      expect(() => call('whatever', input)).not.toThrow();
      expect(call('whatever', input).family).toBeDefined();
    }
  });

  test('deeply nested input never throws and scans bounded keys', () => {
    let nested: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 100; i++) nested = { next: nested };
    const presentation = call('custom_tool', nested);
    expect(presentation.family).toBe('generic');
    expect(presentation.headline).toBe('custom_tool');
  });

  test('huge string values never throw', () => {
    const big = 'x'.repeat(200_000);
    expect(() => call('custom_tool', { big })).not.toThrow();
    expect(() => call('Read', { path: big })).not.toThrow();
    expect(() => call('bash', { command: big })).not.toThrow();
    expect(() => call('eval', { code: big, language: 'ts' })).not.toThrow();
  });

  test('huge names never throw and stay bounded', () => {
    const name = 'z'.repeat(100_000);
    const presentation = call(name);
    expect(presentation.label).toBe('shell');
    expect(presentation.family).toBe('shell');
    expect(presentation.headline).toBe('shell');
  });

  test('non-string name input never throws', () => {
    const weird = { name: 42, input: { a: 1 }, output: null };
    const presentation = toolPresentation(
      weird as unknown as Parameters<typeof toolPresentation>[0]
    );
    expect(presentation.family).toBe('generic');
  });
});

describe('count fact', () => {
  test('finite nonnegative integer output becomes a matches badge for search', () => {
    const presentation = call('grep', { pattern: 'x' }, 14);
    expect(presentation.contentBadges).toContainEqual({
      kind: 'count',
      text: '14 matches',
      tone: 'neutral',
    });
  });

  test('integer string output within the output bound counts', () => {
    const presentation = call('grep', { pattern: 'x' }, '7');
    expect(presentation.contentBadges).toContainEqual({
      kind: 'count',
      text: '7 matches',
      tone: 'neutral',
    });
  });

  test('shallow exact count field on object output counts', () => {
    const presentation = call('grep', { pattern: 'x' }, { count: 3 });
    expect(presentation.contentBadges).toContainEqual({
      kind: 'count',
      text: '3 matches',
      tone: 'neutral',
    });
  });

  test('count field past the key scan bound is ignored', () => {
    const output: Record<string, unknown> = {};
    for (let i = 0; i < MAX_COUNT_KEYS_SCANNED; i++) output[`k${String(i)}`] = i;
    output.count = 9;
    const presentation = call('grep', { pattern: 'x' }, output);
    expect(presentation.contentBadges).toHaveLength(0);
  });

  test('output string over the bound is rejected before parsing', () => {
    const output = `${'9'.repeat(MAX_COUNT_OUTPUT_CODE_UNITS + 1)}`;
    const presentation = call('grep', { pattern: 'x' }, output);
    expect(presentation.contentBadges).toHaveLength(0);
  });

  test('output string at the bound still counts', () => {
    const output = ` ${' '.repeat(MAX_COUNT_OUTPUT_CODE_UNITS - 2)}5`;
    expect(output.length).toBe(MAX_COUNT_OUTPUT_CODE_UNITS);
    const presentation = call('grep', { pattern: 'x' }, output);
    expect(presentation.contentBadges).toContainEqual({
      kind: 'count',
      text: '5 matches',
      tone: 'neutral',
    });
  });

  test('unsupported count shapes are omitted', () => {
    for (const output of [3.5, -1, { count: 'three' }, { count: { n: 1 } }, [4], 'x results']) {
      const presentation = call('grep', { pattern: 'x' }, output);
      expect(presentation.contentBadges).toHaveLength(0);
    }
  });

  test('count does not attach to non-search families', () => {
    const presentation = call('Read', { path: 'a.txt' }, 5);
    expect(presentation.contentBadges).toHaveLength(0);
  });
});

describe('row state table', () => {
  const cases: [
    ToolRowFacts,
    ReturnType<typeof toolRowPresentation>['glyph'],
    ReturnType<typeof toolRowPresentation>['statusLabel'],
    boolean,
  ][] = [
    [{ outcome: 'succeeded', outputState: 'full' }, '✓', 'succeeded', false],
    [{ outcome: 'failed', outputState: 'full' }, '✕', 'failed', true],
    [{ outcome: 'running', outputState: 'missing' }, '◐', 'running', false],
    [{ outcome: 'interrupted', outputState: 'missing' }, '⚠', 'interrupted', false],
    [{ outcome: 'unknown', outputState: 'unknown' }, '–', 'unknown', false],
  ];

  for (const [facts, glyph, label, open] of cases) {
    test(`${facts.outcome} → glyph ${glyph}, label ${label}, open ${String(open)}`, () => {
      const presentation = row('Read', { path: 'a.txt' }, 'out', facts);
      expect(presentation.glyph).toBe(glyph);
      expect(presentation.statusLabel).toBe(label);
      expect(presentation.initialOpen).toBe(open);
    });
  }

  test('succeeded row with no extra facts renders the placeholder', () => {
    const presentation = row('Read', { path: 'a.txt' }, 'out', SUCCEEDED);
    expect(presentation.badges).toEqual([{ kind: 'placeholder', text: '—', tone: 'muted' }]);
  });

  test('running shows elapsed and suppresses the premature missing marker', () => {
    const presentation = row('bash', { command: 'bun test' }, undefined, {
      outcome: 'running',
      outputState: 'missing',
      runningElapsedMs: 2400,
    });
    expect(presentation.badges).toEqual([
      { kind: 'state', text: 'running · 2.4s', tone: 'running' },
    ]);
  });

  test('running without an elapsed value still shows the running state', () => {
    const presentation = row('bash', { command: 'bun test' }, undefined, {
      outcome: 'running',
      outputState: 'missing',
    });
    expect(presentation.badges).toEqual([{ kind: 'state', text: 'running', tone: 'running' }]);
  });

  test('interrupted shows the interrupted state instead of missing', () => {
    const presentation = row('bash', { command: 'x' }, undefined, {
      outcome: 'interrupted',
      outputState: 'missing',
    });
    expect(presentation.badges).toEqual([{ kind: 'state', text: 'interrupted', tone: 'warning' }]);
  });

  test('interrupted keeps a recorded truncated marker', () => {
    const presentation = row('bash', { command: 'x' }, 'partial', {
      outcome: 'interrupted',
      outputState: 'truncated',
    });
    expect(presentation.badges).toEqual([
      { kind: 'state', text: 'interrupted', tone: 'warning' },
      { kind: 'output-state', text: 'truncated', tone: 'warning' },
    ]);
  });

  test('unknown shows output unknown as its state', () => {
    const presentation = row('Read', { path: 'a' }, null, {
      outcome: 'unknown',
      outputState: 'unknown',
    });
    expect(presentation.badges).toEqual([{ kind: 'state', text: 'output unknown', tone: 'muted' }]);
  });
});

describe('badge ordering', () => {
  test('settled rows keep their recorded output-state marker', () => {
    const presentation = row('Read', { path: 'a' }, null, {
      outcome: 'succeeded',
      outputState: 'missing',
    });
    expect(presentation.badges).toEqual([
      { kind: 'output-state', text: 'output missing', tone: 'warning' },
    ]);
  });

  test('truncated wording is preserved', () => {
    const presentation = row('Read', { path: 'a' }, 'x', {
      outcome: 'succeeded',
      outputState: 'truncated',
    });
    expect(presentation.badges).toEqual([
      { kind: 'output-state', text: 'truncated', tone: 'warning' },
    ]);
  });

  test('failed keeps the recorded unknown marker', () => {
    const presentation = row('Read', { path: 'a' }, undefined, {
      outcome: 'failed',
      outputState: 'unknown',
    });
    expect(presentation.badges).toEqual([
      { kind: 'output-state', text: 'output unknown', tone: 'muted' },
    ]);
  });

  test('full output state produces no marker', () => {
    const presentation = row('Read', { path: 'a' }, 'x', SUCCEEDED);
    expect(presentation.badges.every(badge => badge.kind !== 'output-state')).toBe(true);
  });

  test('full order: state, content, exit, output-state, duration', () => {
    const presentation = row('bash', { command: 'bun test' }, 'oops', {
      outcome: 'interrupted',
      exitCode: 1,
      outputState: 'truncated',
      durationMs: 2400,
    });
    expect(presentation.badges).toEqual([
      { kind: 'state', text: 'interrupted', tone: 'warning' },
      { kind: 'exit', text: 'exit 1', tone: 'danger' },
      { kind: 'output-state', text: 'truncated', tone: 'warning' },
      { kind: 'duration', text: '2.4s', tone: 'muted' },
    ]);
  });

  test('content fact lands between state and exit', () => {
    const presentation = row('eval', { code: 'x=1', language: 'ts' }, '1', {
      outcome: 'failed',
      exitCode: 2,
      outputState: 'full',
      durationMs: 100,
    });
    expect(presentation.badges).toEqual([
      { kind: 'language', text: 'ts', tone: 'neutral' },
      { kind: 'exit', text: 'exit 2', tone: 'danger' },
      { kind: 'duration', text: '100ms', tone: 'muted' },
    ]);
  });

  test('exit zero stays neutral', () => {
    const presentation = row('bash', { command: 'true' }, '', {
      outcome: 'succeeded',
      exitCode: 0,
      outputState: 'full',
    });
    expect(presentation.badges).toEqual([{ kind: 'exit', text: 'exit 0', tone: 'neutral' }]);
  });

  test('duration uses the shared formatter', () => {
    const presentation = row('Read', { path: 'a' }, 'x', {
      outcome: 'succeeded',
      outputState: 'full',
      durationMs: 1500,
    });
    expect(presentation.badges).toEqual([{ kind: 'duration', text: '1.5s', tone: 'muted' }]);
  });
});

describe('task body', () => {
  const ompInput = {
    context: 'Investigate **auth** drift',
    tasks: [
      { name: 'scan middleware', agent: 'explore', task: 'read src/auth/**\nand report' },
      { name: 'audit tokens', agent: 'reviewer', task: 'diff token issuance' },
    ],
  };

  test('OMP batch produces a task body, subagent count badge, and batch facts', () => {
    const presentation = call('Task', ompInput);
    expect(presentation.family).toBe('task');
    expect(presentation.body).toEqual({
      kind: 'task',
      context: 'Investigate **auth** drift',
      subtasks: [
        {
          name: 'scan middleware',
          agent: 'explore',
          prompt: 'read src/auth/**\nand report',
          excerpt: 'read src/auth/** and report',
        },
        {
          name: 'audit tokens',
          agent: 'reviewer',
          prompt: 'diff token issuance',
          excerpt: 'diff token issuance',
        },
      ],
    });
    expect(presentation.bodyFacts).toEqual(['batch', '2 subtasks']);
    expect(presentation.contentBadges).toEqual([
      { kind: 'count', text: '2 subagents', tone: 'neutral' },
    ]);
  });

  test('a one-task OMP dispatch uses singular wording', () => {
    const presentation = call('task', {
      tasks: [{ name: 'only', agent: 'a', task: 'do it' }],
    });
    expect(presentation.bodyFacts).toEqual(['batch', '1 subtask']);
    expect(presentation.contentBadges).toEqual([
      { kind: 'count', text: '1 subagent', tone: 'neutral' },
    ]);
  });

  test('Claude single produces one card, no context, and single-dispatch facts', () => {
    const presentation = call('Agent', {
      description: 'review the diff',
      prompt: 'list risks',
      subagent_type: 'reviewer',
    });
    expect(presentation.body).toEqual({
      kind: 'task',
      context: '',
      subtasks: [
        {
          name: 'review the diff',
          agent: 'reviewer',
          prompt: 'list risks',
          excerpt: 'list risks',
        },
      ],
    });
    expect(presentation.bodyFacts).toEqual(['single dispatch']);
    expect(presentation.contentBadges).toEqual([
      { kind: 'count', text: '1 subagent', tone: 'neutral' },
    ]);
  });

  test('Claude without subagent_type keeps a null agent on the card', () => {
    const presentation = call('Agent', { description: 'scan', prompt: 'do it' });
    expect(presentation.body).toMatchObject({
      kind: 'task',
      subtasks: [{ name: 'scan', agent: null, prompt: 'do it' }],
    });
    expect(presentation.bodyFacts).toEqual(['single dispatch']);
  });

  test('the card excerpt is computed by the core while the prompt stays whole', () => {
    const prompt = `intro\n\n${'x'.repeat(300)}`;
    const presentation = call('task', {
      tasks: [{ name: 'a', agent: 'b', task: prompt }],
    });
    if (presentation.body?.kind !== 'task') throw new Error('expected task body');
    const card = presentation.body.subtasks[0];
    expect(card?.prompt).toBe(prompt);
    expect(card?.excerpt).not.toContain('\n');
    expect(card?.excerpt.endsWith('…')).toBe(true);
  });

  test('malformed task input produces a bounded generic body and no count badge', () => {
    const presentation = call('Task', { tasks: 'not-an-array', other: 1 });
    expect(presentation.body).toEqual({
      kind: 'generic',
      fields: [
        { key: 'tasks', value: 'not-an-array' },
        { key: 'other', value: '1' },
      ],
      markdown: null,
      unreadable: false,
    });
    expect(presentation.bodyFacts).toEqual([]);
    expect(presentation.contentBadges).toEqual([]);
  });

  test('over-budget and over-count task input degrades to the generic body', () => {
    const over = Array.from({ length: MAX_TASK_SUBTASKS + 1 }, (_, i) => ({
      name: `n${String(i)}`,
      agent: 'a',
      task: 'p',
    }));
    const byCount = call('task', { tasks: over });
    expect(byCount.body?.kind).toBe('generic');
    expect(byCount.contentBadges).toEqual([]);

    const huge = 'p'.repeat(MAX_TASK_TOTAL_TEXT_CODE_UNITS + 1);
    const byBudget = call('task', { tasks: [{ name: 'a', agent: 'b', task: huge }] });
    expect(byBudget.body?.kind).toBe('generic');
    expect(byBudget.contentBadges).toEqual([]);
  });

  test('the generic body projects markers, never stringified data', () => {
    const presentation = call('task', {
      nothing: 'valid',
      list: [1, 2, 3],
      nested: { deep: { deeper: true } },
      flag: false,
    });
    expect(presentation.body).toEqual({
      kind: 'generic',
      fields: [
        { key: 'nothing', value: 'valid' },
        { key: 'list', value: '[3]' },
        { key: 'nested', value: '{…}' },
      ],
      markdown: null,
      unreadable: false,
    });
    // The fourth key is past the fact bound and never appears.
    expect(JSON.stringify(presentation.body)).not.toContain('flag');
    expect(JSON.stringify(presentation.body)).not.toContain('deeper');
  });

  test('the generic body bounds hostile keys and scalar values', () => {
    const longKey = 'k'.repeat(MAX_GENERIC_SCALAR_CODE_POINTS + 50);
    const longValue = 'v'.repeat(MAX_GENERIC_SCALAR_CODE_POINTS + 50);
    const presentation = call('task', { [longKey]: longValue });
    if (presentation.body?.kind !== 'generic') throw new Error('expected generic body');
    const field = presentation.body.fields[0];
    expect([...(field?.key ?? '')].length).toBeLessThanOrEqual(MAX_GENERIC_SCALAR_CODE_POINTS + 1);
    expect([...(field?.value ?? '')].length).toBeLessThanOrEqual(
      MAX_GENERIC_SCALAR_CODE_POINTS + 1
    );
  });

  test('the generic body stops at the scan and fact bounds', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < MAX_GENERIC_KEYS_SCANNED + 10; i++) {
      input[`k${String(i)}`] = i;
    }
    const presentation = call('task', input);
    if (presentation.body?.kind !== 'generic') throw new Error('expected generic body');
    expect(presentation.body.fields).toHaveLength(MAX_GENERIC_FACTS);
    expect(presentation.body.fields.map(field => field.key)).toEqual(['k0', 'k1', 'k2']);
  });

  test('hostile enumeration reduces to an empty generic field list', () => {
    const hostile = {
      get tasks(): unknown {
        throw new Error('boom');
      },
      get alsoThrows(): unknown {
        throw new Error('boom2');
      },
    };
    const presentation = call('task', hostile);
    expect(presentation.body).toEqual({
      kind: 'generic',
      fields: [],
      markdown: null,
      unreadable: false,
    });
    expect(presentation.contentBadges).toEqual([]);
  });

  test('a malformed task headline getter falls back to the label and keeps the generic body', () => {
    const hostile = {
      get description(): unknown {
        throw new Error('boom');
      },
    };
    const presentation = call('Task', hostile);
    expect(presentation.family).toBe('task');
    expect(presentation.headline).toBe('Task');
    expect(presentation.body).toEqual({
      kind: 'generic',
      fields: [],
      markdown: null,
      unreadable: false,
    });
  });
});

describe('body invariants', () => {
  test('every non-task family keeps body null and empty bodyFacts', () => {
    const cases: [string, unknown][] = [
      ['bash', { command: 'ls' }],
      ['Read', { path: 'a.txt' }],
      ['grep', { pattern: 'x' }],
      ['Glob', { pattern: '**/*.ts' }],
      ['eval', { code: 'x=1', language: 'ts' }],
      ['TodoWrite', { todos: [] }],
      ['WebFetch', { url: 'https://example.com' }],
      ['custom_tool', { a: 1 }],
      ['mcp__github__create_issue', { title: 'bug' }],
    ];
    for (const [name, input] of cases) {
      const presentation = call(name, input);
      expect(presentation.body).toBeNull();
      expect(presentation.bodyFacts).toEqual([]);
    }
  });

  test('safePresentation returns body null and empty bodyFacts', () => {
    const poisoned = {
      get name(): string {
        throw new Error('boom');
      },
      input: {},
      output: null,
    };
    const presentation = toolPresentation(poisoned);
    expect(presentation.body).toBeNull();
    expect(presentation.bodyFacts).toEqual([]);
  });
});

describe('bodyBarText', () => {
  test('a non-task row maps badges byte-for-byte after the family prefix', () => {
    const presentation = row('bash', { command: 'bun test' }, 'oops', {
      outcome: 'interrupted',
      exitCode: 1,
      outputState: 'truncated',
      durationMs: 2400,
    });
    expect(presentation.bodyBarText).toBe('shell · interrupted · exit 1 · truncated · 2.4s');
  });

  test('a bare non-task row is the family alone', () => {
    const presentation = row('Read', { path: 'a' }, 'x', SUCCEEDED);
    expect(presentation.bodyBarText).toBe('file');
  });

  test('a non-task count badge stays in the bar', () => {
    const presentation = row('grep', { pattern: 'x' }, 14, {
      outcome: 'succeeded',
      outputState: 'full',
      durationMs: 120,
    });
    expect(presentation.bodyBarText).toBe('search · 14 matches · 120ms');
  });

  test('a batch task row leads with the task facts and never repeats the count', () => {
    const presentation = row(
      'Task',
      {
        context: 'ctx',
        tasks: [
          { name: 'a', agent: 'x', task: 'p1' },
          { name: 'b', agent: 'y', task: 'p2' },
        ],
      },
      'done',
      { outcome: 'succeeded', outputState: 'full', durationMs: 1500 }
    );
    expect(presentation.bodyBarText).toBe('task · batch · 2 subtasks · 1.5s');
    expect(presentation.bodyBarText).not.toContain('subagent');
    // The collapsed row still carries the subagent count badge.
    expect(presentation.badges).toContainEqual({
      kind: 'count',
      text: '2 subagents',
      tone: 'neutral',
    });
  });

  test('a single task row produces "task · single dispatch · <duration>" exactly once', () => {
    const presentation = row('Agent', { description: 'scan', prompt: 'do it' }, 'done', {
      outcome: 'succeeded',
      outputState: 'full',
      durationMs: 800,
    });
    expect(presentation.bodyBarText).toBe('task · single dispatch · 800ms');
    expect(presentation.bodyBarText.split('single dispatch')).toHaveLength(2);
    expect(presentation.bodyBarText).not.toContain('subagent');
  });

  test('runtime facts follow a task row once, in existing order', () => {
    const presentation = row('task', { tasks: [{ name: 'a', agent: 'b', task: 'p' }] }, 'partial', {
      outcome: 'interrupted',
      exitCode: 2,
      outputState: 'truncated',
      durationMs: 100,
    });
    expect(presentation.bodyBarText).toBe(
      'task · batch · 1 subtask · interrupted · exit 2 · truncated · 100ms'
    );
  });

  test('a malformed task row carries no explicit task facts in the bar', () => {
    const presentation = row('task', { tasks: 'nope' }, 'x', {
      outcome: 'failed',
      exitCode: 1,
      outputState: 'full',
    });
    expect(presentation.bodyBarText).toBe('task · exit 1');
    expect(presentation.bodyBarText).not.toContain('batch');
    expect(presentation.bodyBarText).not.toContain('subtask');
  });
});

describe('failure containment', () => {
  test('toolPresentation returns a safe generic row when internals throw', () => {
    const poisoned = {
      get name(): string {
        throw new Error('boom');
      },
      input: {},
      output: null,
    };
    const presentation = toolPresentation(poisoned);
    expect(presentation.family).toBe('generic');
    expect(presentation.label).toBe('generic');
    expect(presentation.headline).toBe('generic');
    expect(presentation.headlineKind).toBe('text');
  });

  test('toolRowPresentation keeps the derived outcome when content fails', () => {
    const poisoned = {
      get name(): string {
        throw new Error('boom');
      },
      input: {},
      output: null,
    };
    const presentation = toolRowPresentation(poisoned, {
      outcome: 'failed',
      exitCode: 1,
      outputState: 'full',
      durationMs: 10,
    });
    expect(presentation.glyph).toBe('✕');
    expect(presentation.statusLabel).toBe('failed');
    expect(presentation.initialOpen).toBe(true);
    expect(presentation.badges).toEqual([
      { kind: 'exit', text: 'exit 1', tone: 'danger' },
      { kind: 'duration', text: '10ms', tone: 'muted' },
    ]);
  });
});

function body(
  name: string,
  input: unknown,
  output: unknown,
  family: ToolFamily
): ReturnType<typeof toolBodyPresentation> {
  return toolBodyPresentation({ name, input, output }, family);
}

describe('lazy family-body resolver', () => {
  test('resolved family is authoritative — never re-resolved from input or output', () => {
    const terminal = body('Read', { file_path: '/x.ts', command: 'cat /x.ts' }, 'out', 'shell');
    expect(terminal?.kind).toBe('terminal');
    const web = body('Bash', { command: 'ls', url: 'https://a.dev' }, 'text', 'web');
    expect(web?.kind).toBe('web');
    if (web?.kind === 'web') expect(web.url).toBe('https://a.dev');
  });

  test('todo and task return null — their bodies belong to their own stories', () => {
    expect(toolBodyPresentation({ name: 'TodoWrite', input: {}, output: {} }, 'todo')).toBeNull();
    expect(toolBodyPresentation({ name: 'Task', input: {}, output: {} }, 'task')).toBeNull();
  });

  test('summary paths never read deep output channels; the body does', () => {
    let filenamesRead = 0;
    const output = {
      numMatches: 4,
      get filenames(): string[] {
        filenamesRead++;
        return ['a.ts'];
      },
    };
    const input = { name: 'Grep', input: { pattern: 'x' }, output };
    toolPresentation(input);
    toolRowPresentation(input, { outcome: 'succeeded', outputState: 'full' });
    expect(filenamesRead).toBe(0);
    toolBodyPresentation(input, 'search');
    expect(filenamesRead).toBeGreaterThan(0);
  });

  test('malformed hostile output degrades to a bounded unreadable body', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new Error('nope');
        },
        get(): never {
          throw new Error('nope');
        },
      }
    );
    const result = toolBodyPresentation({ name: 'x', input: {}, output: hostile }, 'generic');
    expect(result).toEqual({ kind: 'generic', fields: [], markdown: null, unreadable: true });
  });

  test('output never reclassifies family — identical with output absent vs real output', () => {
    const fixtures: [string, unknown, unknown, ToolFamily][] = [
      ['Bash', { command: 'ls' }, { stdout: 'x' }, 'shell'],
      ['Read', { file_path: '/a.ts' }, { file: { content: 'x' } }, 'file'],
      ['Grep', { pattern: 'x' }, { mode: 'content', content: 'a:1:x' }, 'search'],
      ['Glob', { pattern: '*' }, { filenames: ['a'] }, 'glob'],
      ['eval', { code: 'x', language: 'py' }, '1', 'code'],
      ['TodoWrite', { todos: [] }, null, 'todo'],
      ['Task', { description: 'd' }, 'done', 'task'],
      ['WebFetch', { url: 'https://a.dev' }, { result: 't' }, 'web'],
      ['mystery', { a: 1 }, { b: 2 }, 'generic'],
    ];
    for (const [name, input, output, family] of fixtures) {
      const bare = toolPresentation({ name, input, output: undefined });
      const full = toolPresentation({ name, input, output });
      expect(bare.family).toBe(family);
      expect(full.family).toBe(family);
      const row = toolRowPresentation(
        { name, input, output },
        { outcome: 'succeeded', outputState: 'full' }
      );
      expect(row.family).toBe(family);
    }
  });
});

describe('terminal body', () => {
  test('carries the command and normalized output text', () => {
    const b = body('Bash', { command: 'ls -la' }, { stdout: 'a\nb', stderr: '' }, 'shell');
    expect(b).toEqual({
      kind: 'terminal',
      command: 'ls -la',
      output: 'a\nb',
      unreadable: false,
    });
  });

  test('command falls back to the sent name and is bounded with an explicit ellipsis', () => {
    const long = 'x'.repeat(MAX_BODY_COMMAND_CODE_UNITS + 10);
    const b = body('Bash', { command: long }, 'done', 'shell');
    if (b?.kind !== 'terminal') throw new Error('expected terminal');
    expect(b.command.endsWith('…')).toBe(true);
    expect(b.command).toHaveLength(MAX_BODY_COMMAND_CODE_UNITS);
  });

  test('wrapper-preserving sent name supplies the command when input lacks one', () => {
    const b = body("/bin/zsh -lc 'ls -la'", {}, 'out', 'shell');
    if (b?.kind !== 'terminal') throw new Error('expected terminal');
    expect(b.command).toBe("/bin/zsh -lc 'ls -la'");
  });
});

describe('file body', () => {
  test('shows the path and normalized preview text', () => {
    const b = body('Read', { file_path: '/a.ts' }, { file: { content: 'line1\nline2' } }, 'file');
    expect(b).toEqual({
      kind: 'file',
      path: '/a.ts',
      preview: 'line1\nline2',
      unreadable: false,
      diff: null,
    });
  });

  test('preview falls back to written input content when output has no text', () => {
    const b = body('Write', { file_path: '/a.ts', content: 'body text' }, null, 'file');
    if (b?.kind !== 'file') throw new Error('expected file');
    expect(b.preview).toBe('body text');
    expect(b.diff).toBeNull();
  });
});

describe('file edit diff', () => {
  const DIFF_BADGE_SUCCESS: ToolRowBadge = { kind: 'diff', text: '+1', tone: 'success' };
  const DIFF_BADGE_DANGER: ToolRowBadge = { kind: 'diff', text: '−1', tone: 'danger' };

  test('canonical pair qualifies: +n success and −m danger badges plus a hunk fact', () => {
    const presentation = row(
      'Edit',
      { file_path: '/a.ts', old_string: 'x\ny', new_string: 'x\nz' },
      'ok',
      SUCCEEDED
    );
    expect(presentation.family).toBe('file');
    expect(presentation.badges).toContainEqual(DIFF_BADGE_SUCCESS);
    expect(presentation.badges).toContainEqual(DIFF_BADGE_DANGER);
    expect(presentation.bodyFacts).toEqual(['1 hunk']);
    expect(presentation.bodyBarText).toBe('file · 1 hunk');
  });

  test('both alias pairs qualify on file-family names', () => {
    const aliased = call('str_replace', { path: 'a', old_str: 'x', new_str: 'y' });
    expect(aliased.family).toBe('file');
    expect(aliased.contentBadges).toContainEqual(DIFF_BADGE_SUCCESS);
    expect(aliased.contentBadges).toContainEqual(DIFF_BADGE_DANGER);
    const contentPair = call('Edit', { file_path: 'a', content: 'x', new_content: 'y' });
    expect(contentPair.contentBadges).toContainEqual(DIFF_BADGE_SUCCESS);
  });

  test('empty sides qualify: insert-only and delete-only emit only their own badge', () => {
    const insertOnly = row(
      'Edit',
      { file_path: 'a', old_string: '', new_string: 'x' },
      'ok',
      SUCCEEDED
    );
    expect(insertOnly.badges).toContainEqual(DIFF_BADGE_SUCCESS);
    expect(insertOnly.badges.filter(badge => badge.kind === 'diff')).toHaveLength(1);
    const deleteOnly = row(
      'Edit',
      { file_path: 'a', old_string: 'x', new_string: '' },
      'ok',
      SUCCEEDED
    );
    expect(deleteOnly.badges).toContainEqual(DIFF_BADGE_DANGER);
    expect(deleteOnly.badges.filter(badge => badge.kind === 'diff')).toHaveLength(1);
  });

  test('replace_all composes only for an own boolean input', () => {
    const exact = row(
      'Edit',
      { file_path: 'a', old_string: 'x', new_string: 'y', replace_all: false },
      'ok',
      SUCCEEDED
    );
    expect(exact.bodyBarText).toBe('file · 1 hunk · replace_all: false');
    const truthy = call('Edit', {
      file_path: 'a',
      old_string: 'x',
      new_string: 'y',
      replace_all: true,
    });
    expect(truthy.bodyFacts).toEqual(['1 hunk', 'replace_all: true']);
    const nonBoolean = call('Edit', {
      file_path: 'a',
      old_string: 'x',
      new_string: 'y',
      replace_all: 'yes',
    });
    expect(nonBoolean.bodyFacts).toEqual(['1 hunk']);
    const inherited = call(
      'Edit',
      Object.assign(Object.create({ replace_all: true }), {
        file_path: 'a',
        old_string: 'x',
        new_string: 'y',
      })
    );
    expect(inherited.bodyFacts).toEqual(['1 hunk']);
  });

  test('plural hunk fact for multi-hunk diffs', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${String(i)}`).join('\n');
    const after = before.replace('line2', 'LINE2').replace('line17', 'LINE17');
    const presentation = call('Edit', { file_path: 'a', old_string: before, new_string: after });
    expect(presentation.bodyFacts).toEqual(['2 hunks']);
  });

  test('identical pair yields the no-changes fact and no diff badges', () => {
    const presentation = row(
      'Edit',
      { file_path: 'a', old_string: 'x', new_string: 'x' },
      'ok',
      SUCCEEDED
    );
    expect(presentation.bodyFacts).toEqual(['no changes']);
    expect(presentation.badges.filter(badge => badge.kind === 'diff')).toHaveLength(0);
    expect(presentation.bodyBarText).toBe('file · no changes');
  });

  test('diff badges never reach the body bar', () => {
    const presentation = row('Edit', { file_path: 'a', old_string: 'x', new_string: 'y' }, 'ok', {
      outcome: 'succeeded',
      outputState: 'full',
      durationMs: 120,
    });
    expect(presentation.bodyBarText).toBe('file · 1 hunk · 120ms');
    expect(presentation.bodyBarText).not.toContain('+1');
    expect(presentation.bodyBarText).not.toContain('−1');
  });

  test('file body arm carries the diff result; refused and missing pairs keep the preview fallback', () => {
    const qualified = body(
      'Edit',
      { file_path: '/a.ts', old_string: 'x\ny', new_string: 'x\nz' },
      null,
      'file'
    );
    if (qualified?.kind !== 'file') throw new Error('expected file');
    expect(qualified.diff).not.toBeNull();
    expect(qualified.diff?.added).toBe(1);
    expect(qualified.diff?.deleted).toBe(1);
    expect(qualified.diff?.hunks).toHaveLength(1);
    expect(qualified.preview).toBe('x\nz');

    const overLines = `a\n${'x\n'.repeat(2_001)}`;
    const refused = body(
      'Edit',
      { file_path: '/a.ts', old_string: 'a', new_string: overLines },
      null,
      'file'
    );
    if (refused?.kind !== 'file') throw new Error('expected file');
    expect(refused.diff).toBeNull();
    expect(refused.preview).toBe(overLines);

    const oneSided = body('Edit', { file_path: '/a.ts', old_string: 'a' }, null, 'file');
    if (oneSided?.kind !== 'file') throw new Error('expected file');
    expect(oneSided.diff).toBeNull();

    const wrongTypes = body(
      'Edit',
      { file_path: '/a.ts', old_string: 1, new_string: 'b' },
      null,
      'file'
    );
    if (wrongTypes?.kind !== 'file') throw new Error('expected file');
    expect(wrongTypes.diff).toBeNull();

    const noInput = body('Edit', undefined, null, 'file');
    if (noInput?.kind !== 'file') throw new Error('expected file');
    expect(noInput.diff).toBeNull();
  });

  test('throwing accessors and inherited pair keys are non-qualifying, never a reclassification', () => {
    const throwing = Object.create(null) as Record<string, unknown>;
    throwing.file_path = '/a.ts';
    Object.defineProperty(throwing, 'old_string', {
      enumerable: true,
      get() {
        throw new Error('hostile getter');
      },
    });
    throwing.new_string = 'y';
    const presentation = call('Edit', throwing);
    expect(presentation.family).toBe('file');
    expect(presentation.contentBadges.filter(badge => badge.kind === 'diff')).toHaveLength(0);
    expect(presentation.bodyFacts).toEqual([]);
    const b = body('Edit', throwing, null, 'file');
    if (b?.kind !== 'file') throw new Error('expected file');
    expect(b.diff).toBeNull();

    const inherited = call(
      'Edit',
      Object.create({ old_string: 'x', new_string: 'y', file_path: '/a.ts' })
    );
    expect(inherited.contentBadges.filter(badge => badge.kind === 'diff')).toHaveLength(0);
    expect(inherited.bodyFacts).toEqual([]);
  });

  test('aliases on non-file families never produce a diff', () => {
    const shell = call('bash', { command: 'x', old_string: 'a', new_string: 'b' });
    expect(shell.family).toBe('shell');
    expect(shell.contentBadges.filter(badge => badge.kind === 'diff')).toHaveLength(0);
    expect(shell.bodyFacts).toEqual([]);
    const mcp = call('mcp__srv__edit', { old_string: 'a', new_string: 'b' });
    expect(mcp.family).toBe('generic');
    expect(mcp.contentBadges).toHaveLength(0);
  });

  test('repeated summary/body calls for the same record read the pair once', () => {
    let reads = 0;
    const input = { file_path: '/a.ts', new_string: 'y' } as Record<string, unknown>;
    Object.defineProperty(input, 'old_string', {
      enumerable: true,
      get() {
        reads++;
        return 'x';
      },
    });
    const presentation = toolRowPresentation({ name: 'Edit', input, output: 'ok' }, SUCCEEDED);
    expect(presentation.badges).toContainEqual(DIFF_BADGE_SUCCESS);
    const firstReads = reads;
    const b = toolBodyPresentation({ name: 'Edit', input, output: null }, 'file');
    expect(reads).toBe(firstReads);
    if (b?.kind !== 'file') throw new Error('expected file');
    expect(b.diff).not.toBeNull();
  });

  test('a second record with equal strings reuses the same pair-cache result object', () => {
    const first = body('Edit', { file_path: 'a', old_string: 'x', new_string: 'y' }, null, 'file');
    const second = body('Edit', { file_path: 'b', old_string: 'x', new_string: 'y' }, null, 'file');
    if (first?.kind !== 'file' || second?.kind !== 'file') throw new Error('expected file');
    expect(first.diff).not.toBeNull();
    expect(second.diff).toBe(first.diff);
  });

  test('raw payload keeps the untouched pair', () => {
    const input = { file_path: '/a.ts', old_string: 'x', new_string: 'y' };
    const presentation = row('Edit', input, 'ok', SUCCEEDED);
    expect(presentation.rawPayload.input).toBe(input);
  });
});

describe('search body', () => {
  test('content mode yields structured matches with path and line', () => {
    const b = body(
      'Grep',
      { pattern: 'foo', output_mode: 'content' },
      {
        mode: 'content',
        file_matches: [{ path: 'a.ts', matches: [{ content: 'hit', line_number: 3 }] }],
      },
      'search'
    );
    expect(b).toEqual({
      kind: 'matches',
      pattern: 'foo',
      scope: null,
      items: [{ path: 'a.ts', line: 3, text: 'hit' }],
      omitted: 0,
      truncated: false,
    });
  });

  test('content lines parse anchored path:line:text; unmatched lines stay as text items', () => {
    const b = body(
      'grep',
      { pattern: 'foo', output_mode: 'content' },
      { mode: 'content', content: 'a.ts:2:hello\nplain line' },
      'search'
    );
    if (b?.kind !== 'matches') throw new Error('expected matches');
    expect(b.items).toEqual([
      { path: 'a.ts', line: 2, text: 'hello' },
      { path: null, line: null, text: 'plain line' },
    ]);
  });

  test('files_with_matches yields bounded paths', () => {
    const b = body(
      'Grep',
      { pattern: 'foo', output_mode: 'files_with_matches' },
      { mode: 'files_with_matches', filenames: ['a.ts', 'b.ts'] },
      'search'
    );
    expect(b).toEqual({
      kind: 'paths',
      pattern: 'foo',
      scope: null,
      items: ['a.ts', 'b.ts'],
      omitted: 0,
      truncated: false,
    });
  });

  test('count mode keeps the search family but renders a generic count body', () => {
    const b = body(
      'Grep',
      { pattern: 'foo', output_mode: 'count' },
      { mode: 'count', numMatches: 7, numFiles: 2 },
      'search'
    );
    expect(b).toEqual({
      kind: 'generic',
      fields: [
        { key: 'matches', value: '7' },
        { key: 'files', value: '2' },
      ],
      markdown: null,
      unreadable: false,
    });
  });

  test('input output_mode wins over the declared output mode', () => {
    const b = body(
      'Grep',
      { pattern: 'x', output_mode: 'files_with_matches' },
      { mode: 'content', content: 'a.ts:1:x' },
      'search'
    );
    expect(b?.kind).toBe('paths');
  });

  test('declared output mode beats structural channels', () => {
    const b = body(
      'Grep',
      { pattern: 'x' },
      {
        mode: 'files_with_matches',
        file_matches: [{ path: 'a.ts', matches: [{ content: 'x', line_number: 1 }] }],
      },
      'search'
    );
    expect(b?.kind).toBe('paths');
  });

  test('structured matches imply content when no mode is declared', () => {
    const b = body(
      'grep',
      { pattern: 'x' },
      { file_matches: [{ path: 'a.ts', matches: [{ content: 'x', line_number: 1 }] }] },
      'search'
    );
    expect(b?.kind).toBe('matches');
  });

  test('a filenames channel implies files_with_matches when no mode is declared', () => {
    const b = body('grep', { pattern: 'x' }, { filenames: ['a.ts'] }, 'search');
    expect(b?.kind).toBe('paths');
  });

  test('absent mode defaults by sent alias — Grep lists paths, grep parses content', () => {
    const output = 'a.ts\nb.ts';
    const claude = body('Grep', { pattern: 'x' }, output, 'search');
    expect(claude?.kind).toBe('paths');
    if (claude?.kind === 'paths') expect(claude.items).toEqual(['a.ts', 'b.ts']);
    const omp = body('grep', { pattern: 'x' }, output, 'search');
    expect(omp?.kind).toBe('matches');
    if (omp?.kind === 'matches') {
      expect(omp.items).toEqual([
        { path: null, line: null, text: 'a.ts' },
        { path: null, line: null, text: 'b.ts' },
      ]);
    }
  });

  test('a paths arm reports the exact omitted count when the source total is known', () => {
    const filenames = Array.from({ length: MAX_LIST_ITEMS + 7 }, (_, i) => `f${String(i)}.ts`);
    const b = body(
      'Grep',
      { pattern: 'x', output_mode: 'files_with_matches' },
      { mode: 'files_with_matches', filenames },
      'search'
    );
    if (b?.kind !== 'paths') throw new Error('expected paths');
    expect(b.items).toHaveLength(MAX_LIST_ITEMS);
    expect(b.omitted).toBe(7);
    expect(b.truncated).toBe(true);
  });
});

describe('glob body', () => {
  test('lists bounded paths with pattern and scope', () => {
    const b = body(
      'Glob',
      { pattern: '**/*.ts', path: 'src' },
      { filenames: ['a.ts', 'b.ts'] },
      'glob'
    );
    expect(b).toEqual({
      kind: 'paths',
      pattern: '**/*.ts',
      scope: 'src',
      items: ['a.ts', 'b.ts'],
      omitted: 0,
      truncated: false,
    });
  });

  test('an OMP path-only input uses the path as pattern with no scope', () => {
    const b = body('list_dir', { path: 'src' }, { filenames: ['a.ts'] }, 'glob');
    expect(b).toEqual({
      kind: 'paths',
      pattern: 'src',
      scope: null,
      items: ['a.ts'],
      omitted: 0,
      truncated: false,
    });
  });

  test('falls back to non-empty text lines when no filenames channel exists', () => {
    const b = body('Glob', { pattern: 'x' }, 'a.ts\n\nb.ts', 'glob');
    if (b?.kind !== 'paths') throw new Error('expected paths');
    expect(b.items).toEqual(['a.ts', 'b.ts']);
  });
});

describe('code body', () => {
  test('keeps full source past the 80-char headline cap, with language and result', () => {
    const source = `print(${'1'.repeat(200)})`;
    const b = body('eval', { code: source, language: 'python' }, '1', 'code');
    expect(b).toEqual({
      kind: 'code',
      language: 'python',
      source,
      result: '1',
      truncated: false,
    });
  });

  test('source over the display cap reports explicit truncation', () => {
    const source = 'x'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS + 1);
    const b = body('eval', { code: source, language: 'python' }, 'ok', 'code');
    if (b?.kind !== 'code') throw new Error('expected code');
    expect(b.truncated).toBe(true);
    expect(b.source.length).toBe(MAX_OUTPUT_TEXT_CODE_UNITS);
  });
});

describe('web body', () => {
  test('carries url, title, and safe markdown text', () => {
    const b = body(
      'WebFetch',
      { url: 'https://x.dev' },
      { result: '# Hi\nbody', title: 'X' },
      'web'
    );
    expect(b).toEqual({
      kind: 'web',
      url: 'https://x.dev',
      title: 'X',
      markdown: '# Hi\nbody',
      omitted: 0,
      truncated: false,
    });
  });

  test('search results become an inert markdown list', () => {
    const b = body(
      'WebSearch',
      { url: 'query' },
      { results: [{ url: 'https://a', title: 'A' }, { url: 'https://b' }] },
      'web'
    );
    if (b?.kind !== 'web') throw new Error('expected web');
    expect(b.markdown).toBe('- [A](https://a)\n- [https://b](https://b)');
    expect(b.title).toBeNull();
  });

  test('assembled web markdown stays inside the text budget and reports omitted results', () => {
    const results = Array.from({ length: MAX_LIST_ITEMS }, (_, i) => ({
      title: `title-${String(i)}-${'x'.repeat(900)}`,
      url: `https://example.com/${String(i)}/${'y'.repeat(900)}`,
    }));
    const b = body('WebSearch', { url: 'query' }, { results }, 'web');
    if (b?.kind !== 'web') throw new Error('expected web');
    expect(b.markdown?.length ?? 0).toBeLessThanOrEqual(MAX_OUTPUT_TEXT_CODE_UNITS);
    expect(b.truncated).toBe(true);
    expect(b.omitted).toBeGreaterThan(0);
  });
});

describe('generic body', () => {
  test('uses bounded key:value fields — objects {…}, arrays [n], no serialized syntax', () => {
    const b = body('mystery', { obj: { a: 1 }, list: [1, 2], flag: true }, null, 'generic');
    expect(b).toEqual({
      kind: 'generic',
      fields: [
        { key: 'obj', value: '{…}' },
        { key: 'list', value: '[2]' },
        { key: 'flag', value: 'true' },
      ],
      markdown: null,
      unreadable: false,
    });
  });

  test('one shared cap of three fields across input then output fields', () => {
    const b = body('mystery', { a: 1, b: 2 }, { c: 3, d: 4 }, 'generic');
    if (b?.kind !== 'generic') throw new Error('expected generic');
    expect(b.fields).toHaveLength(MAX_BODY_FIELDS);
    expect(b.fields).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' },
    ]);
  });

  test('serialized object syntax never leaks; {…} markers and prose braces survive', () => {
    const b = body(
      'mystery',
      { cfg: { a: 1 }, items: [1] },
      'prose with {braces} inline',
      'generic'
    );
    if (b?.kind !== 'generic') throw new Error('expected generic');
    expect(b.fields).toEqual([
      { key: 'cfg', value: '{…}' },
      { key: 'items', value: '[1]' },
    ]);
    for (const field of b.fields) {
      expect(field.value).not.toContain('"');
      expect(field.value).not.toContain(': {');
    }
    expect(b.markdown).toBe('prose with {braces} inline');
  });

  test('plain string output becomes markdown; a JSON fragment never does', () => {
    const prose = body('mystery', {}, 'just prose', 'generic');
    if (prose?.kind !== 'generic') throw new Error('expected generic');
    expect(prose.markdown).toBe('just prose');
    const json = body('mystery', {}, '{"a":1}', 'generic');
    if (json?.kind !== 'generic') throw new Error('expected generic');
    expect(json.markdown).toBeNull();
    expect(json.fields).toEqual([{ key: 'a', value: '1' }]);
  });

  test('generic field keys are bounded and display text marks truncation within its cap', () => {
    const key = 'k'.repeat(MAX_FIELD_KEY_CODE_UNITS + 20);
    const b = body(
      'mystery',
      { [key]: true },
      'x'.repeat(MAX_OUTPUT_TEXT_CODE_UNITS + 1),
      'generic'
    );
    if (b?.kind !== 'generic') throw new Error('expected generic');
    expect(b.fields[0]?.key).toHaveLength(MAX_FIELD_KEY_CODE_UNITS);
    expect(b.markdown).toHaveLength(MAX_OUTPUT_TEXT_CODE_UNITS);
    expect(b.markdown?.endsWith('…')).toBe(true);
  });
});

describe('collapsed count extraction', () => {
  test('numMatches/numFiles record keys report their own units', () => {
    expect(call('Grep', { pattern: 'x' }, { numMatches: 5, numFiles: 2 }).contentBadges).toEqual([
      { kind: 'count', text: '5 matches', tone: 'neutral' },
    ]);
    expect(call('Grep', { pattern: 'x' }, { numFiles: 3 }).contentBadges).toEqual([
      { kind: 'count', text: '3 files', tone: 'neutral' },
    ]);
  });

  test('a small JSON record string yields a count without full normalization', () => {
    expect(call('Grep', { pattern: 'x' }, '{"numMatches":9}').contentBadges).toEqual([
      { kind: 'count', text: '9 matches', tone: 'neutral' },
    ]);
  });

  test('an over-cap string still produces no badge', () => {
    const output = `${' '.repeat(MAX_COUNT_OUTPUT_CODE_UNITS)}9`;
    expect(call('Grep', { pattern: 'x' }, output).contentBadges).toEqual([]);
  });
});

describe('raw payload', () => {
  test('generic name keeps the sent name verbatim when the label differs', () => {
    const presentation = row(
      'mcp__github__create_issue',
      { title: 'bug' },
      { issue: 42 },
      SUCCEEDED
    );
    expect(presentation.label).toBe('github · create_issue');
    expect(presentation.rawPayload).toEqual({
      name: 'mcp__github__create_issue',
      input: { title: 'bug' },
      output: { issue: 42 },
    });
  });

  test('known alias keeps the sent casing, not the normalized family', () => {
    const presentation = row('TodoWrite', { op: 'add' }, null, SUCCEEDED);
    expect(presentation.rawPayload.name).toBe('TodoWrite');
  });

  test('codex command-like name stays verbatim while the label is the family', () => {
    const name = 'npm test -- --watch';
    const presentation = row(name, undefined, 'ok', SUCCEEDED);
    expect(presentation.label).toBe('shell');
    expect(presentation.rawPayload).toEqual({ name, input: undefined, output: 'ok' });
  });

  test('over-chip-bound name stays verbatim in the payload', () => {
    const name = 'x'.repeat(MAX_CHIP_CODE_POINTS + 1);
    const presentation = row(name, undefined, undefined, SUCCEEDED);
    expect(presentation.label).toBe('generic');
    expect(presentation.rawPayload.name).toBe(name);
  });

  test('object, array, primitive, and null values are preserved structurally', () => {
    const input = { nested: { list: [1, 2] }, flag: true };
    const output = { lines: ['a', 'b'], count: 2, extra: null };
    const presentation = row('custom_tool', input, output, SUCCEEDED);
    expect(presentation.rawPayload.input).toEqual(input);
    expect(presentation.rawPayload.output).toEqual(output);

    expect(row('custom_tool', 'plain', 42, SUCCEEDED).rawPayload).toEqual({
      name: 'custom_tool',
      input: 'plain',
      output: 42,
    });
    expect(row('custom_tool', null, null, SUCCEEDED).rawPayload).toEqual({
      name: 'custom_tool',
      input: null,
      output: null,
    });
  });

  test('a non-string name still captures the readable fields', () => {
    const weird = { name: 42, input: { a: 1 }, output: null };
    const presentation = toolRowPresentation(
      weird as unknown as Parameters<typeof toolRowPresentation>[0],
      SUCCEEDED
    );
    expect(presentation.rawPayload).toEqual({ name: 'generic', input: { a: 1 }, output: null });
  });

  test('capture failure yields the deterministic generic payload', () => {
    const poisonedName = {
      get name(): string {
        throw new Error('boom');
      },
      input: { a: 1 },
      output: 'x',
    };
    expect(toolRowPresentation(poisonedName, SUCCEEDED).rawPayload).toEqual({
      name: 'generic',
      input: undefined,
      output: undefined,
    });
    const poisonedInput = {
      name: 'Read',
      get input(): unknown {
        throw new Error('boom');
      },
      output: 'x',
    };
    expect(toolRowPresentation(poisonedInput, SUCCEEDED).rawPayload).toEqual({
      name: 'generic',
      input: undefined,
      output: undefined,
    });
  });

  test('toolRawPayloadJson emits fixed key order with two-space indentation', () => {
    expect(toolRawPayloadJson({ name: 'Read', input: { path: 'a.ts' }, output: 'text' })).toBe(
      '{\n  "name": "Read",\n  "input": {\n    "path": "a.ts"\n  },\n  "output": "text"\n}'
    );
  });

  test('absent undefined fields are omitted while explicit null is kept', () => {
    expect(toolRawPayloadJson({ name: 'Bash', input: undefined, output: undefined })).toBe(
      '{\n  "name": "Bash"\n}'
    );
    expect(toolRawPayloadJson({ name: 'Bash', input: null, output: null })).toBe(
      '{\n  "name": "Bash",\n  "input": null,\n  "output": null\n}'
    );
  });

  test('special strings serialize as escaped JSON text, never markup', () => {
    const json = toolRawPayloadJson({
      name: 'Bash',
      input: { cmd: 'echo "hi" \\ done\nnext' },
      output: '<script>alert(1)</script>',
    });
    expect(JSON.parse(json)).toEqual({
      name: 'Bash',
      input: { cmd: 'echo "hi" \\ done\nnext' },
      output: '<script>alert(1)</script>',
    });
    expect(json).toContain('\\"hi\\"');
    expect(json).toContain('done\\nnext');
    expect(json).not.toContain('\\\\x3c');
  });

  test('cyclic input yields the documented fallback and keeps a readable name', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const json = toolRawPayloadJson({ name: 'Bash', input: cyclic, output: 'x' });
    expect(JSON.parse(json)).toEqual({ name: 'Bash', error: 'payload is not serializable' });
    expect(json).toBe('{\n  "name": "Bash",\n  "error": "payload is not serializable"\n}');
  });

  test('bigint output yields the documented fallback', () => {
    const json = toolRawPayloadJson({ name: 'Read', input: undefined, output: BigInt(1) });
    expect(JSON.parse(json)).toEqual({ name: 'Read', error: 'payload is not serializable' });
  });

  test('a throwing name getter still returns valid fallback JSON', () => {
    const hostile = {
      get name(): string {
        throw new Error('boom');
      },
      input: { a: 1 },
      output: 'x',
    };
    const json = toolRawPayloadJson(hostile);
    expect(JSON.parse(json)).toEqual({ name: 'generic', error: 'payload is not serializable' });
  });

  test('a non-string name in the failing document falls back to generic', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const json = toolRawPayloadJson({
      name: 42 as unknown as string,
      input: cyclic,
      output: undefined,
    });
    expect(JSON.parse(json)).toEqual({ name: 'generic', error: 'payload is not serializable' });
  });
});
