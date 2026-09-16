import { describe, expect, test } from 'bun:test';

import {
  elideHeadline,
  FAMILY_CHIP_TOKEN,
  toolPresentation,
  type ToolFamily,
} from './tool-presentation';

interface FamilyCase {
  name: string;
  input: unknown;
  family: ToolFamily;
}

const FAMILY_CASES: readonly FamilyCase[] = [
  ...['Bash', 'shell', 'run', 'command', 'execute', 'run_terminal_command'].map(name => ({
    name,
    input: { command: 'bun test' },
    family: 'shell' as const,
  })),
  ...[
    'edit',
    'write',
    'create',
    'str_replace',
    'apply_patch',
    'notebook_edit',
    'search_replace',
    'delete',
    'read',
    'view',
    'cat',
    'open',
    'read_file',
  ].map(name => ({ name, input: { file_path: 'a.ts' }, family: 'file' as const })),
  ...['grep', 'search', 'rg', 'search_tool'].map(name => ({
    name,
    input: { pattern: 'needle' },
    family: 'search' as const,
  })),
  ...['glob', 'find', 'ls', 'list', 'list_dir'].map(name => ({
    name,
    input: { path: 'packages/web/src' },
    family: 'glob' as const,
  })),
  ...['eval', 'run_code', 'execute code'].map(name => ({
    name,
    input: { code: '1 + 1', language: 'javascript' },
    family: 'code' as const,
  })),
  ...['todo', 'todo_write', 'plan'].map(name => ({ name, input: {}, family: 'todo' as const })),
  ...['task', 'agent', 'subagent', 'dispatch'].map(name => ({
    name,
    input: {},
    family: 'task' as const,
  })),
  ...['web_fetch', 'web_search', 'fetch', 'browse'].map(name => ({
    name,
    input: { url: 'https://archon.diy' },
    family: 'web' as const,
  })),
];

describe('toolPresentation family resolution', () => {
  test('matches every declared Tier 1 alias exactly', () => {
    for (const fixture of FAMILY_CASES) {
      expect(toolPresentation({ ...fixture, output: undefined }).family).toBe(fixture.family);
    }
  });

  test('uses input keys when the name is unknown', () => {
    expect(
      toolPresentation({ name: 'mystery', input: { target_file: 'x.ts' }, output: undefined })
        .family
    ).toBe('file');
    expect(
      toolPresentation({
        name: 'mystery',
        input: { old_str: 'a', new_str: 'b' },
        output: undefined,
      }).family
    ).toBe('file');
    expect(
      toolPresentation({
        name: 'mystery',
        input: { old_string: 'a', new_string: 'b' },
        output: undefined,
      }).family
    ).toBe('file');
  });

  test('never mistakes search_replace for a search tool', () => {
    expect(
      toolPresentation({
        name: 'search_replace',
        input: { old_string: 'a', new_string: 'b' },
        output: undefined,
      }).family
    ).toBe('file');
  });

  test('headlines Claude glob with pattern and OMP glob with path', () => {
    const claude = toolPresentation({
      name: 'Glob',
      input: { pattern: '**/*.tsx', path: 'packages/web' },
      output: undefined,
    });
    const omp = toolPresentation({
      name: 'glob',
      input: { path: 'packages/web/src' },
      output: undefined,
    });
    expect(claude).toMatchObject({ family: 'glob', headline: '**/*.tsx', headlineKind: 'path' });
    expect(claude.headline).not.toBe('packages/web');
    expect(omp).toMatchObject({
      family: 'glob',
      headline: 'packages/web/src',
      headlineKind: 'path',
    });
  });

  test('routes malformed inputs and invalid names to generic without throwing', () => {
    for (const input of [null, [], 'bad', 3]) {
      expect(toolPresentation({ name: 'mystery', input, output: undefined }).family).toBe(
        'generic'
      );
    }
    expect(() =>
      toolPresentation({ name: 123 as unknown as string, input: {}, output: undefined })
    ).not.toThrow();
  });
});

describe('toolPresentation chip, headline, and safe degradation', () => {
  test('keeps a short sent name and falls back for whitespace or over 24 characters', () => {
    expect(
      toolPresentation({ name: 'read_file', input: { path: 'a.ts' }, output: undefined }).label
    ).toBe('read_file');
    expect(toolPresentation({ name: '🚀run', input: {}, output: undefined }).label).toBe('🚀run');
    expect(toolPresentation({ name: 'npm test', input: undefined, output: undefined }).label).toBe(
      'shell'
    );
    expect(toolPresentation({ name: 'x'.repeat(25), input: {}, output: undefined }).label).toBe(
      'shell'
    );
    for (const fixture of FAMILY_CASES) {
      expect(toolPresentation({ ...fixture, output: undefined }).label.length).toBeLessThanOrEqual(
        24
      );
    }
  });

  test('formats MCP names without violating the chip cap', () => {
    expect(
      toolPresentation({ name: 'mcp__server__tool', input: {}, output: undefined })
    ).toMatchObject({
      family: 'generic',
      label: 'server · tool',
      headline: 'server · tool',
    });
    expect(
      toolPresentation({
        name: `mcp__${'s'.repeat(20)}__${'t'.repeat(20)}`,
        input: {},
        output: undefined,
      }).label
    ).toBe('generic');
  });

  test('strips a Codex shell wrapper only from the first-line headline', () => {
    const zsh = toolPresentation({
      name: "/bin/zsh -lc 'bun test'",
      input: undefined,
      output: undefined,
    });
    const bash = toolPresentation({
      name: "/bin/bash -lc 'ls -la'",
      input: undefined,
      output: undefined,
    });
    const multiline = toolPresentation({
      name: '\nfor f in *.ts; do\n  echo "$f"\ndone',
      input: undefined,
      output: undefined,
    });
    expect(zsh.headline).toBe('bun test');
    expect(bash.headline).toBe('ls -la');
    expect(multiline.headline).toBe('for f in *.ts; do…');
    expect(multiline.headline).not.toContain('\n');
  });

  test('does not truncate a code headline to the generic scalar limit', () => {
    const source = `const value = ${'x'.repeat(120)};`;
    const value = toolPresentation({
      name: 'eval',
      input: { code: source, language: 'javascript' },
      output: undefined,
    });
    expect(value).toMatchObject({ family: 'code', headline: source, badges: ['javascript'] });
    expect(value.headline.length).toBeGreaterThan(80);
  });

  test('elides path headlines at the last slash and leaves text unchanged', () => {
    expect(elideHeadline('packages/web/src/lib/tool-presentation.ts', 'path')).toEqual({
      kind: 'path',
      head: 'packages/web/src/lib/',
      tail: 'tool-presentation.ts',
    });
    expect(elideHeadline('README', 'path')).toEqual({ kind: 'path', head: '', tail: 'README' });
    expect(elideHeadline('bun test', 'text')).toEqual({ kind: 'text', text: 'bun test' });
  });

  test('maps each family to the chip token from the plan', () => {
    expect(FAMILY_CHIP_TOKEN).toEqual({
      shell: '--node-bash',
      code: '--node-bash',
      file: '--node-command',
      web: '--node-command',
      search: '--node-prompt',
      glob: '--node-prompt',
      todo: '--node-approval',
      task: '--node-approval',
      generic: '--text-secondary',
    });
  });

  test('uses family-aware chip aria labels', () => {
    expect(
      toolPresentation({ name: 'read_file', input: { path: 'a.ts' }, output: undefined })
        .chipAriaLabel
    ).toBe('read_file, file tool');
    expect(
      toolPresentation({ name: 'npm test', input: undefined, output: undefined }).chipAriaLabel
    ).toBe('shell tool');
  });

  test('uses at most three scalar pairs for a generic collapsed headline', () => {
    const value = toolPresentation({
      name: 'mystery',
      input: { a: 1, nested: { x: 1 }, b: 'two', list: [1, 2], c: true, d: 'ignored' },
      output: undefined,
    });
    expect(value).toMatchObject({ family: 'generic', headline: 'a: 1 · b: two · c: true' });
    expect(value.headline).not.toMatch(/[{}[\]"]/);
  });

  test('bounds generic scalar display and terminates on a large source line', () => {
    const scalar = toolPresentation({
      name: 'mystery',
      input: { value: 'z'.repeat(200) },
      output: undefined,
    });
    const source = 'a'.repeat(100_000);
    const code = toolPresentation({
      name: 'eval',
      input: { code: source, language: 'txt' },
      output: undefined,
    });
    expect(scalar.headline).toBe(`value: ${'z'.repeat(80)}…`);
    expect(code.headline).toBe(source);
  });

  test('does not traverse a hostile __proto__ value', () => {
    const hostile: unknown = JSON.parse('{"__proto__":{"polluted":true},"safe":"ok"}');
    const value = toolPresentation({ name: 'mystery', input: hostile, output: undefined });
    expect(value.headline).toBe('safe: ok');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
