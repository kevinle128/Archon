import { describe, expect, test } from 'bun:test';

import { toolPresentation, type ToolFamily } from './tool-presentation';

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
