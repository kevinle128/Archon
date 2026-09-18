import { describe, expect, test } from 'bun:test';

import {
  MAX_ALIAS_NAME_CODE_UNITS,
  MAX_CHIP_CODE_POINTS,
  MAX_COUNT_KEYS_SCANNED,
  MAX_COUNT_OUTPUT_CODE_UNITS,
  MAX_GENERIC_FACTS,
  MAX_GENERIC_KEYS_SCANNED,
  MAX_GENERIC_SCALAR_CODE_POINTS,
  MAX_HEADLINE_SOURCE_CODE_UNITS,
  toolPresentation,
  toolRowPresentation,
  type ToolFamily,
  type ToolRowFacts,
} from './tool-presentation';

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
