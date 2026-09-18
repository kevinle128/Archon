import { describe, expect, test } from 'bun:test';

import {
  MAX_TASK_EXCERPT_CODE_POINTS,
  MAX_TASK_IDENTIFIER_CODE_UNITS,
  MAX_TASK_SUBTASKS,
  MAX_TASK_TOTAL_TEXT_CODE_UNITS,
  normalizeTaskDispatch,
  taskPromptExcerpt,
} from './task-normalize';

function ompTask(name: string, agent: string, task: string): Record<string, unknown> {
  return { name, agent, task };
}

describe('canonical provider shapes', () => {
  test('CAP-4: OMP batch {context, tasks:[a,b]} yields two TaskSubtask entries and preserves context', () => {
    const result = normalizeTaskDispatch({
      context: 'Investigate **auth** drift\n- check middleware',
      tasks: [
        ompTask('scan middleware', 'explore', 'read src/auth/**\nand report'),
        ompTask('audit tokens', 'reviewer', 'diff token issuance'),
      ],
    });
    expect(result).toEqual({
      mode: 'batch',
      context: 'Investigate **auth** drift\n- check middleware',
      subtasks: [
        { name: 'scan middleware', agent: 'explore', prompt: 'read src/auth/**\nand report' },
        { name: 'audit tokens', agent: 'reviewer', prompt: 'diff token issuance' },
      ],
    });
  });

  test('CAP-4: Claude {description, prompt, subagent_type} yields one entry with empty context', () => {
    const result = normalizeTaskDispatch({
      description: 'review the diff',
      prompt: 'read the diff\nlist risks',
      subagent_type: 'reviewer',
      model: 'sonnet',
    });
    expect(result).toEqual({
      mode: 'single',
      context: '',
      subtasks: [
        { name: 'review the diff', agent: 'reviewer', prompt: 'read the diff\nlist risks' },
      ],
    });
  });

  test('CAP-4: a Claude dispatch omitting subagent_type yields agent: null and still normalizes', () => {
    const result = normalizeTaskDispatch({ description: 'scan', prompt: 'do it' });
    expect(result).toEqual({
      mode: 'single',
      context: '',
      subtasks: [{ name: 'scan', agent: null, prompt: 'do it' }],
    });
  });

  test('OMP without context yields empty context and valid cards', () => {
    const result = normalizeTaskDispatch({
      tasks: [ompTask('a', 'b', 'c'), ompTask('d', 'e', 'f')],
    });
    expect(result?.mode).toBe('batch');
    expect(result?.context).toBe('');
    expect(result?.subtasks).toHaveLength(2);
  });

  test('blank context normalizes to empty; absent context is equivalent', () => {
    const blank = normalizeTaskDispatch({
      context: '   \n\t ',
      tasks: [ompTask('a', 'b', 'c')],
    });
    expect(blank?.context).toBe('');
    const absent = normalizeTaskDispatch({ tasks: [ompTask('a', 'b', 'c')] });
    expect(blank).toEqual(absent);
  });

  test('blank subagent_type maps to null like an absent one', () => {
    const result = normalizeTaskDispatch({
      description: 'scan',
      prompt: 'do it',
      subagent_type: '   ',
    });
    expect(result?.subtasks[0]?.agent).toBeNull();
  });

  test('an own tasks key selects OMP even when Claude keys are present', () => {
    const result = normalizeTaskDispatch({
      description: 'claude-looking description',
      prompt: 'claude-looking prompt',
      subagent_type: 'reviewer',
      tasks: [ompTask('omp name', 'omp agent', 'omp prompt')],
    });
    expect(result).toEqual({
      mode: 'batch',
      context: '',
      subtasks: [{ name: 'omp name', agent: 'omp agent', prompt: 'omp prompt' }],
    });
  });

  test('a malformed tasks value does not fall through to Claude', () => {
    for (const tasks of ['nope', 42, null, {}, []]) {
      expect(normalizeTaskDispatch({ tasks, description: 'd', prompt: 'p' })).toBeNull();
    }
  });

  test('identifiers are trimmed while prompts are preserved verbatim', () => {
    const result = normalizeTaskDispatch({
      tasks: [ompTask('  spaced name  ', '\tagent\t', '  keep\n  me  ')],
    });
    expect(result?.subtasks[0]).toEqual({
      name: 'spaced name',
      agent: 'agent',
      prompt: '  keep\n  me  ',
    });
    const claude = normalizeTaskDispatch({
      description: '  padded description ',
      prompt: ' raw\nprompt ',
      subagent_type: ' typed ',
    });
    expect(claude?.subtasks[0]).toEqual({
      name: 'padded description',
      agent: 'typed',
      prompt: ' raw\nprompt ',
    });
  });
});

describe('malformed inputs', () => {
  test('missing Claude description or prompt returns null', () => {
    expect(normalizeTaskDispatch({ prompt: 'p' })).toBeNull();
    expect(normalizeTaskDispatch({ description: 'd' })).toBeNull();
    expect(normalizeTaskDispatch({ description: 'd', prompt: '' })).toBeNull();
    expect(normalizeTaskDispatch({ description: '   ', prompt: 'p' })).toBeNull();
    expect(normalizeTaskDispatch({ description: 7, prompt: 'p' })).toBeNull();
  });

  test('an OMP element missing name, agent, or task rejects the whole dispatch', () => {
    const good = ompTask('a', 'b', 'c');
    for (const bad of [
      { agent: 'b', task: 'c' },
      { name: 'a', task: 'c' },
      { name: 'a', agent: 'b' },
      { name: '', agent: 'b', task: 'c' },
      { name: 'a', agent: '  ', task: 'c' },
      { name: 'a', agent: 'b', task: '' },
      { name: 'a', agent: 'b', task: ' \n ' },
      { name: 1, agent: 'b', task: 'c' },
      { name: 'a', agent: ['b'], task: 'c' },
      { name: 'a', agent: 'b', task: { nested: true } },
      null,
      'string',
      42,
      ['nested', 'array'],
    ]) {
      expect(normalizeTaskDispatch({ tasks: [bad] })).toBeNull();
      expect(normalizeTaskDispatch({ tasks: [good, bad] })).toBeNull();
    }
  });

  test('empty, non-array, and over-64 tasks all return null', () => {
    expect(normalizeTaskDispatch({ tasks: [] })).toBeNull();
    expect(normalizeTaskDispatch({ tasks: { 0: ompTask('a', 'b', 'c') } })).toBeNull();
    const over = Array.from({ length: MAX_TASK_SUBTASKS + 1 }, (_, i) =>
      ompTask(`n${String(i)}`, 'a', 'p')
    );
    expect(normalizeTaskDispatch({ tasks: over })).toBeNull();
    const at = Array.from({ length: MAX_TASK_SUBTASKS }, (_, i) =>
      ompTask(`n${String(i)}`, 'a', 'p')
    );
    expect(normalizeTaskDispatch({ tasks: at })?.subtasks).toHaveLength(MAX_TASK_SUBTASKS);
  });

  test('a present non-string context or subagent_type rejects the dispatch', () => {
    for (const context of [42, null, { text: 'x' }, ['x'], true]) {
      expect(normalizeTaskDispatch({ context, tasks: [ompTask('a', 'b', 'c')] })).toBeNull();
    }
    for (const subagent_type of [42, null, { t: 'x' }, ['x'], false]) {
      expect(normalizeTaskDispatch({ description: 'd', prompt: 'p', subagent_type })).toBeNull();
    }
  });

  test('non-object, array, and primitive inputs return null', () => {
    for (const input of [
      undefined,
      null,
      'tasks',
      42,
      true,
      [ompTask('a', 'b', 'c')],
      [['nested']],
    ]) {
      expect(normalizeTaskDispatch(input)).toBeNull();
    }
  });

  test('throwing getters return null instead of propagating', () => {
    const throwing = (key: string): Record<string, unknown> => ({
      get [key](): unknown {
        throw new Error(`boom ${key}`);
      },
    });
    expect(() => normalizeTaskDispatch(throwing('tasks'))).not.toThrow();
    expect(normalizeTaskDispatch(throwing('tasks'))).toBeNull();
    expect(normalizeTaskDispatch(throwing('context'))).toBeNull();
    expect(normalizeTaskDispatch(throwing('description'))).toBeNull();
    expect(normalizeTaskDispatch(throwing('prompt'))).toBeNull();
    expect(normalizeTaskDispatch(throwing('subagent_type'))).toBeNull();

    const hostileElement = ompTask('a', 'b', 'c');
    Object.defineProperty(hostileElement, 'name', {
      get(): unknown {
        throw new Error('boom name');
      },
    });
    expect(normalizeTaskDispatch({ tasks: [hostileElement] })).toBeNull();
  });
});

describe('identifier bounds', () => {
  test('a name at the identifier bound succeeds; one over rejects the dispatch', () => {
    const at = 'n'.repeat(MAX_TASK_IDENTIFIER_CODE_UNITS);
    const over = 'n'.repeat(MAX_TASK_IDENTIFIER_CODE_UNITS + 1);
    expect(normalizeTaskDispatch({ tasks: [ompTask(at, 'a', 'p')] })).not.toBeNull();
    expect(normalizeTaskDispatch({ tasks: [ompTask(over, 'a', 'p')] })).toBeNull();
    expect(normalizeTaskDispatch({ tasks: [ompTask('n', over, 'p')] })).toBeNull();
    expect(normalizeTaskDispatch({ description: over, prompt: 'p' })).toBeNull();
    expect(
      normalizeTaskDispatch({ description: 'd', prompt: 'p', subagent_type: over })
    ).toBeNull();
  });
});

describe('cumulative text budget', () => {
  test('a dispatch at the cumulative bound is accepted byte-for-byte', () => {
    const prompt = 'p'.repeat(MAX_TASK_TOTAL_TEXT_CODE_UNITS - 'name'.length - 'agent'.length);
    const result = normalizeTaskDispatch({ tasks: [ompTask('name', 'agent', prompt)] });
    expect(result?.subtasks[0]?.prompt).toBe(prompt);
    expect(result?.subtasks[0]?.prompt.length).toBe(prompt.length);
  });

  test('one code unit over the cumulative bound rejects the whole dispatch', () => {
    const prompt =
      'p'.repeat(MAX_TASK_TOTAL_TEXT_CODE_UNITS - 'name'.length - 'agent'.length) + 'x';
    expect(normalizeTaskDispatch({ tasks: [ompTask('name', 'agent', prompt)] })).toBeNull();
  });

  test('the budget sums context plus every entry before trimming', () => {
    // context + name + agent + prompt must fit inside one cumulative budget.
    const context = 'x'.repeat(Math.floor(MAX_TASK_TOTAL_TEXT_CODE_UNITS / 2) - 2);
    const prompt = 'x'.repeat(Math.floor(MAX_TASK_TOTAL_TEXT_CODE_UNITS / 2));
    expect(context.length + 'a'.length + 'b'.length + prompt.length).toBe(
      MAX_TASK_TOTAL_TEXT_CODE_UNITS
    );
    expect(
      normalizeTaskDispatch({
        context,
        tasks: [ompTask('a', 'b', prompt)],
      })
    ).not.toBeNull();
    expect(
      normalizeTaskDispatch({
        context: `${context}x`,
        tasks: [ompTask('a', 'b', prompt)],
      })
    ).toBeNull();
    // The sum runs on untrimmed text: leading whitespace still spends the
    // budget, so a padded prompt that would fit after trimming still rejects.
    const paddedPrompt =
      ' '.repeat(Math.floor(MAX_TASK_TOTAL_TEXT_CODE_UNITS / 2)) +
      'p'.repeat(Math.floor(MAX_TASK_TOTAL_TEXT_CODE_UNITS / 2) + 10);
    expect(paddedPrompt.trim().length).toBeLessThan(MAX_TASK_TOTAL_TEXT_CODE_UNITS);
    expect(normalizeTaskDispatch({ tasks: [ompTask('a', 'b', paddedPrompt)] })).toBeNull();
  });

  test('the walk stops at the entry bound and never accepts a partial batch', () => {
    const tasks = Array.from({ length: MAX_TASK_SUBTASKS }, (_, i) =>
      ompTask(`n${String(i)}`, 'a', 'p')
    );
    tasks[MAX_TASK_SUBTASKS - 1] = ompTask('n', 'a', 'p'.repeat(MAX_TASK_TOTAL_TEXT_CODE_UNITS));
    expect(normalizeTaskDispatch({ tasks })).toBeNull();
  });

  test('the bounded walk uses captured array indexes, not a caller-controlled iterator', () => {
    const tasks = [ompTask('indexed', 'agent', 'prompt')];
    tasks[Symbol.iterator] = function* (): ArrayIterator<Record<string, unknown>> {
      yield ompTask('iterator-only', 'agent', 'must not be visited');
      throw new Error('unbounded iterator path');
    };
    expect(normalizeTaskDispatch({ tasks })).toEqual({
      mode: 'batch',
      context: '',
      subtasks: [{ name: 'indexed', agent: 'agent', prompt: 'prompt' }],
    });
  });

  test('the bounded walk captures a proxied array length once', () => {
    let lengthReads = 0;
    const tasks = new Proxy([ompTask('indexed', 'agent', 'prompt')], {
      get(target, property, receiver): unknown {
        if (property === 'length') {
          lengthReads++;
          return lengthReads === 1 ? 1 : MAX_TASK_SUBTASKS + 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTaskDispatch({ tasks })?.subtasks).toEqual([
      { name: 'indexed', agent: 'agent', prompt: 'prompt' },
    ]);
    expect(lengthReads).toBe(1);
  });
});

describe('result integrity', () => {
  test('returned arrays and objects are fresh copies', () => {
    const input = {
      context: 'ctx',
      tasks: [ompTask('a', 'b', 'c'), ompTask('d', 'e', 'f')],
    };
    const first = normalizeTaskDispatch(input);
    const second = normalizeTaskDispatch(input);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first?.subtasks).not.toBe(second?.subtasks);
    expect(first?.subtasks[0]).not.toBe(second?.subtasks[0]);
    expect(first?.subtasks[0]).not.toBe(input.tasks[0]);
  });

  test('mutating a result does not corrupt the stored input or later calls', () => {
    const input = { tasks: [ompTask('a', 'b', 'c')] };
    const result = normalizeTaskDispatch(input);
    result?.subtasks.push({ name: 'injected', agent: 'x', prompt: 'y' });
    if (result?.subtasks[0] !== undefined) result.subtasks[0].name = 'mutated';
    expect(normalizeTaskDispatch(input)).toEqual({
      mode: 'batch',
      context: '',
      subtasks: [{ name: 'a', agent: 'b', prompt: 'c' }],
    });
  });
});

describe('taskPromptExcerpt', () => {
  test('collapses paragraphs and repeated whitespace to one line', () => {
    expect(taskPromptExcerpt('line one\n\nline   two\t\tthree')).toBe('line one line two three');
    expect(taskPromptExcerpt('  padded\n\n')).toBe('padded');
  });

  test('returns the collapsed text unchanged when it fits the cap', () => {
    const exact = 'x'.repeat(MAX_TASK_EXCERPT_CODE_POINTS);
    expect(taskPromptExcerpt(exact)).toBe(exact);
    expect(taskPromptExcerpt(`${exact}   \n`)).toBe(exact);
  });

  test('caps at 160 code points and adds an ellipsis only when content was omitted', () => {
    const over = 'x'.repeat(MAX_TASK_EXCERPT_CODE_POINTS + 5);
    expect(taskPromptExcerpt(over)).toBe(`${'x'.repeat(MAX_TASK_EXCERPT_CODE_POINTS)}…`);
    const withTail = 'x'.repeat(MAX_TASK_EXCERPT_CODE_POINTS - 1) + ' y';
    const excerpt = taskPromptExcerpt(withTail);
    expect([...excerpt.replace('…', '')].length).toBe(MAX_TASK_EXCERPT_CODE_POINTS);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('never splits a surrogate pair at the cut', () => {
    // Code point 160 is the emoji; the cut must keep the pair whole, then add
    // the ellipsis — never emit a lone surrogate.
    const source = 'x'.repeat(MAX_TASK_EXCERPT_CODE_POINTS - 1) + '😀' + 'tail';
    expect(taskPromptExcerpt(source)).toBe(`${'x'.repeat(MAX_TASK_EXCERPT_CODE_POINTS - 1)}😀…`);
  });

  test('is total and deterministic on edge inputs', () => {
    expect(taskPromptExcerpt('')).toBe('');
    expect(taskPromptExcerpt('   \n\t ')).toBe('');
    // A source far beyond the cumulative scan bound still yields the same
    // bounded prefix excerpt without scanning the tail.
    const huge = `${'a '.repeat(MAX_TASK_EXCERPT_CODE_POINTS)}${'z'.repeat(
      MAX_TASK_TOTAL_TEXT_CODE_UNITS * 2
    )}`;
    const excerpt = taskPromptExcerpt(huge);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toContain('z');
  });
});
