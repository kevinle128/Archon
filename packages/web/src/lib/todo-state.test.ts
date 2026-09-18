import { describe, expect, test } from 'bun:test';

import {
  projectTodoState,
  summarizeTodoState,
  TODO_STATUS_PRESENTATION,
  type TodoItem,
  type TodoPhase,
  type TodoStatus,
} from './todo-state';

const PENDING: TodoStatus = 'pending';
const IN_PROGRESS: TodoStatus = 'in_progress';
const COMPLETED: TodoStatus = 'completed';
const ABANDONED: TodoStatus = 'abandoned';
const BLOCKED: TodoStatus = 'blocked';

function item(content: string, status: TodoStatus, blocker?: string): TodoItem {
  return blocker === undefined ? { content, status } : { content, status, blocker };
}

function phase(name: string, items: TodoItem[]): TodoPhase {
  return { phase: name, items };
}

describe('projectTodoState — Claude TodoWrite snapshots', () => {
  test('a valid list replaces state with one Tasks phase, statuses verbatim, no leakage', () => {
    const result = projectTodoState([
      {
        todos: [
          { content: 'Read the spec', status: 'completed', activeForm: 'Reading the spec' },
          { content: 'Wire the strip', status: 'in_progress', activeForm: 'Wiring the strip' },
          { content: 'Ship it', status: 'pending' },
        ],
      },
    ]);
    expect(result).toEqual([
      phase('Tasks', [
        item('Read the spec', COMPLETED),
        item('Wire the strip', IN_PROGRESS),
        item('Ship it', PENDING),
      ]),
    ]);
    expect(Object.keys(result[0]!.items[0]!)).toEqual(['content', 'status']);
  });

  test('a later snapshot fully replaces the earlier one', () => {
    const result = projectTodoState([
      { todos: [{ content: 'first', status: 'pending' }] },
      { todos: [{ content: 'second', status: 'in_progress' }] },
      {
        todos: [
          { content: 'third a', status: 'completed' },
          { content: 'third b', status: 'pending' },
        ],
      },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('third a', COMPLETED), item('third b', PENDING)]),
    ]);
  });

  test('todos:[] clears the state', () => {
    const result = projectTodoState([
      { todos: [{ content: 'x', status: 'pending' }] },
      { todos: [] },
    ]);
    expect(result).toEqual([]);
  });

  test('one malformed entry rejects the whole call and retains prior state', () => {
    const prior = projectTodoState([{ todos: [{ content: 'keep', status: 'pending' }] }]);
    expect(prior).toEqual([phase('Tasks', [item('keep', PENDING)])]);
    const after = projectTodoState([
      { todos: [{ content: 'keep', status: 'pending' }] },
      {
        todos: [
          { content: 'fine', status: 'pending' },
          { content: 42, status: 'pending' },
        ],
      },
    ]);
    expect(after).toEqual(prior);
  });

  test('a snapshot entry with an unsupported status rejects the whole call', () => {
    const result = projectTodoState([
      { todos: [{ content: 'keep', status: 'in_progress' }] },
      {
        todos: [
          { content: 'fine', status: 'pending' },
          { content: 'bad', status: 'blocked' },
        ],
      },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('two in-progress entries remain as supplied — no OMP normalization of Claude snapshots', () => {
    const result = projectTodoState([
      {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
          { content: 'c', status: 'pending' },
        ],
      },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', IN_PROGRESS), item('b', IN_PROGRESS), item('c', PENDING)]),
    ]);
  });
});

describe('projectTodoState — OMP init', () => {
  test('phased list init replaces everything with pending items and promotes the first', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'Research', items: ['a', 'b'] },
          { phase: 'Implement', items: ['c'] },
        ],
      },
    ]);
    expect(result).toEqual([
      phase('Research', [item('a', IN_PROGRESS), item('b', PENDING)]),
      phase('Implement', [item('c', PENDING)]),
    ]);
  });

  test('flat items init under a supplied phase', () => {
    const result = projectTodoState([{ op: 'init', phase: 'Setup', items: ['x', 'y'] }]);
    expect(result).toEqual([phase('Setup', [item('x', IN_PROGRESS), item('y', PENDING)])]);
  });

  test('flat items init defaults to the Tasks phase', () => {
    const result = projectTodoState([{ op: 'init', items: ['only'] }]);
    expect(result).toEqual([phase('Tasks', [item('only', IN_PROGRESS)])]);
  });

  test('init replaces prior state entirely', () => {
    const result = projectTodoState([
      { op: 'init', items: ['old a', 'old b'] },
      { op: 'done', task: 'old a' },
      { op: 'init', items: ['fresh'] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('fresh', IN_PROGRESS)])]);
  });

  test('an explicit empty list is a valid clear', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'init', list: [] },
    ]);
    expect(result).toEqual([]);
  });

  test('flat empty items rejects and retains prior state', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      { op: 'init', items: [] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('missing init data rejects', () => {
    const result = projectTodoState([{ op: 'init', items: ['keep'] }, { op: 'init' }]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('init on empty state with missing data still produces no state', () => {
    expect(projectTodoState([{ op: 'init' }])).toEqual([]);
  });

  test('duplicate phase names in the list reject', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      {
        op: 'init',
        list: [
          { phase: 'Dup', items: ['a'] },
          { phase: 'Dup', items: ['b'] },
        ],
      },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('duplicate task contents across the list reject', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      {
        op: 'init',
        list: [
          { phase: 'One', items: ['same'] },
          { phase: 'Two', items: ['same'] },
        ],
      },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('a malformed list entry rejects the init', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      { op: 'init', list: [{ phase: 'P', items: [] }] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });
});

describe('projectTodoState — OMP append', () => {
  test('appends pending items to an existing phase', () => {
    const result = projectTodoState([
      { op: 'init', list: [{ phase: 'P', items: ['a'] }] },
      { op: 'append', phase: 'P', items: ['b', 'c'] },
    ]);
    expect(result).toEqual([
      phase('P', [item('a', IN_PROGRESS), item('b', PENDING), item('c', PENDING)]),
    ]);
  });

  test('lazily creates a new phase at the end', () => {
    const result = projectTodoState([
      { op: 'init', list: [{ phase: 'First', items: ['a'] }] },
      { op: 'append', phase: 'Second', items: ['z'] },
    ]);
    expect(result).toEqual([
      phase('First', [item('a', IN_PROGRESS)]),
      phase('Second', [item('z', PENDING)]),
    ]);
  });

  test('missing phase rejects', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      { op: 'append', items: ['b'] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('empty items rejects', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      { op: 'append', phase: 'P', items: [] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('a duplicate against existing state rejects the call', () => {
    const result = projectTodoState([
      { op: 'init', list: [{ phase: 'P', items: ['a'] }] },
      { op: 'append', phase: 'P', items: ['ok', 'a'] },
    ]);
    expect(result).toEqual([phase('P', [item('a', IN_PROGRESS)])]);
  });

  test('a duplicate within the call rejects', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a'] },
      { op: 'append', phase: 'Tasks', items: ['b', 'b'] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS)])]);
  });
});

describe('projectTodoState — OMP start', () => {
  test('exact task match starts it and demotes the previous in-progress task', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b', 'c'] },
      { op: 'start', task: 'c' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', PENDING), item('b', PENDING), item('c', IN_PROGRESS)]),
    ]);
  });

  test('missing task rejects', () => {
    const result = projectTodoState([{ op: 'init', items: ['a', 'b'] }, { op: 'start' }]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('an unknown task retains prior state and does not normalize', () => {
    const result = projectTodoState([
      {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
        ],
      },
      { op: 'start', task: 'nope' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', IN_PROGRESS)])]);
  });
});

describe('projectTodoState — OMP done and drop', () => {
  test('done by exact task completes it and auto-promotes the next pending task', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b', 'c'] },
      { op: 'done', task: 'a' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', COMPLETED), item('b', IN_PROGRESS), item('c', PENDING)]),
    ]);
  });

  test('done by exact phase completes every item in that phase', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'P1', items: ['a', 'b'] },
          { phase: 'P2', items: ['c'] },
        ],
      },
      { op: 'done', phase: 'P1' },
    ]);
    expect(result).toEqual([
      phase('P1', [item('a', COMPLETED), item('b', COMPLETED)]),
      phase('P2', [item('c', IN_PROGRESS)]),
    ]);
  });

  test('bare done completes every task in every phase', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'P1', items: ['a'] },
          { phase: 'P2', items: ['b', 'c'] },
        ],
      },
      { op: 'done' },
    ]);
    expect(result).toEqual([
      phase('P1', [item('a', COMPLETED)]),
      phase('P2', [item('b', COMPLETED), item('c', COMPLETED)]),
    ]);
  });

  test('drop supports task, phase, and all-target forms', () => {
    const byTask = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'drop', task: 'b' },
    ]);
    expect(byTask).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', ABANDONED)])]);

    const byPhase = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'P1', items: ['a'] },
          { phase: 'P2', items: ['b', 'c'] },
        ],
      },
      { op: 'drop', phase: 'P2' },
    ]);
    expect(byPhase).toEqual([
      phase('P1', [item('a', IN_PROGRESS)]),
      phase('P2', [item('b', ABANDONED), item('c', ABANDONED)]),
    ]);

    const bare = projectTodoState([{ op: 'init', items: ['a', 'b'] }, { op: 'drop' }]);
    expect(bare).toEqual([phase('Tasks', [item('a', ABANDONED), item('b', ABANDONED)])]);
  });

  test('done before any init produces no state', () => {
    expect(projectTodoState([{ op: 'done', task: 'a' }])).toEqual([]);
    expect(projectTodoState([{ op: 'done' }])).toEqual([]);
  });

  test('an unknown target retains prior state', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'done', task: 'nope' },
      { op: 'drop', phase: 'nope' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('exact matching: a prefix does not hit a longer task', () => {
    const result = projectTodoState([
      { op: 'init', items: ['Read the spec', 'Map'] },
      { op: 'done', task: 'Read' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('Read the spec', IN_PROGRESS), item('Map', PENDING)]),
    ]);
  });
});

describe('projectTodoState — OMP block and unblock', () => {
  test('block by task collapses blocker whitespace', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'block', task: 'b', reason: 'waiting\n  on\tCI   results' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', IN_PROGRESS), item('b', BLOCKED, 'waiting on CI results')]),
    ]);
  });

  test('block by phase blocks the open items of that phase only', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'P', items: ['a', 'b', 'c'] },
          { phase: 'Q', items: ['z'] },
        ],
      },
      { op: 'done', task: 'a' },
      { op: 'block', phase: 'P', reason: 'r' },
    ]);
    expect(result).toEqual([
      phase('P', [item('a', COMPLETED), item('b', BLOCKED, 'r'), item('c', BLOCKED, 'r')]),
      phase('Q', [item('z', IN_PROGRESS)]),
    ]);
  });

  test('block requires a task or phase target', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'block', reason: 'no target' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('re-block updates the reason', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a'] },
      { op: 'block', task: 'a', reason: 'first' },
      { op: 'block', task: 'a', reason: 'second' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', BLOCKED, 'second')])]);
  });

  test('re-block without a reason clears the blocker', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a'] },
      { op: 'block', task: 'a', reason: 'first' },
      { op: 'block', task: 'a' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', BLOCKED)])]);
  });

  test('block does not reopen completed or abandoned tasks', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b', 'c'] },
      { op: 'done', task: 'a' },
      { op: 'drop', task: 'c' },
      { op: 'block', phase: 'Tasks', reason: 'r' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', COMPLETED), item('b', BLOCKED, 'r'), item('c', ABANDONED)]),
    ]);
  });

  test('unblock returns blocked items to pending and clears the reason', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'block', task: 'b', reason: 'r' },
      { op: 'unblock', task: 'b' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('unblock only affects blocked items', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b', 'c'] },
      { op: 'done', task: 'a' },
      { op: 'block', task: 'c', reason: 'r' },
      { op: 'unblock', phase: 'Tasks' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', COMPLETED), item('b', IN_PROGRESS), item('c', PENDING)]),
    ]);
  });

  test('unblock requires a target', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a'] },
      { op: 'block', task: 'a' },
      { op: 'unblock' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', BLOCKED)])]);
  });
});

describe('projectTodoState — OMP rm', () => {
  test('rm by exact task removes it', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b', 'c'] },
      { op: 'rm', task: 'b' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('c', PENDING)])]);
  });

  test('rm by phase removes the whole phase', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'P1', items: ['a'] },
          { phase: 'P2', items: ['b'] },
        ],
      },
      { op: 'rm', phase: 'P1' },
    ]);
    expect(result).toEqual([phase('P2', [item('b', IN_PROGRESS)])]);
  });

  test('bare rm clears everything and returns []', () => {
    const result = projectTodoState([{ op: 'init', items: ['a', 'b'] }, { op: 'rm' }]);
    expect(result).toEqual([]);
  });

  test('removing the final item of a phase drops the phase, no empty header survives', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          { phase: 'P1', items: ['a'] },
          { phase: 'P2', items: ['b'] },
        ],
      },
      { op: 'rm', task: 'a' },
    ]);
    expect(result).toEqual([phase('P2', [item('b', IN_PROGRESS)])]);
  });

  test('rm with an unknown task rejects', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { op: 'rm', task: 'nope' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });
});

describe('projectTodoState — OMP view', () => {
  test('view leaves a deliberately non-normalized snapshot byte-for-byte unchanged', () => {
    const inputs = [
      {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
          { content: 'c', status: 'pending' },
        ],
      },
      { op: 'view' },
    ];
    const result = projectTodoState(inputs);
    expect(result).toEqual([
      phase('Tasks', [item('a', IN_PROGRESS), item('b', IN_PROGRESS), item('c', PENDING)]),
    ]);
  });
});

describe('projectTodoState — auto-promotion', () => {
  test('a mutating op promotes a task the call never named', () => {
    const result = projectTodoState([
      { op: 'init', items: ['first', 'second'] },
      { op: 'done', task: 'first' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('first', COMPLETED), item('second', IN_PROGRESS)]),
    ]);
  });

  test('a mutating op collapses extra in-progress items to the first', () => {
    const result = projectTodoState([
      {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
          { content: 'c', status: 'pending' },
        ],
      },
      { op: 'block', task: 'c', reason: 'r' },
    ]);
    expect(result).toEqual([
      phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING), item('c', BLOCKED, 'r')]),
    ]);
  });

  test('a rejected call does not normalize', () => {
    const result = projectTodoState([
      {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
        ],
      },
      { op: 'done', task: 'nope' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', IN_PROGRESS)])]);
  });

  test('when nothing is in progress and nothing is pending, no promotion is invented', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a'] },
      { op: 'done', task: 'a' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', COMPLETED)])]);
  });
});

describe('projectTodoState — missing-op inference', () => {
  test('a non-empty list infers init', () => {
    const result = projectTodoState([{ list: [{ phase: 'P', items: ['x', 'y'] }] }]);
    expect(result).toEqual([phase('P', [item('x', IN_PROGRESS), item('y', PENDING)])]);
  });

  test('non-empty items plus a truthy phase infers append', () => {
    const result = projectTodoState([
      { op: 'init', list: [{ phase: 'P', items: ['a'] }] },
      { items: ['b'], phase: 'P' },
    ]);
    expect(result).toEqual([phase('P', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('non-empty bare items infer init only when no phases exist', () => {
    const result = projectTodoState([{ items: ['x', 'y'] }]);
    expect(result).toEqual([phase('Tasks', [item('x', IN_PROGRESS), item('y', PENDING)])]);
  });

  test('bare items on a non-empty state are a no-op', () => {
    const result = projectTodoState([{ op: 'init', items: ['keep'] }, { items: ['new'] }]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });

  test('everything else is a no-op', () => {
    const result = projectTodoState([
      { op: 'init', items: ['keep'] },
      { task: 'keep' },
      { phase: 'Tasks' },
      { items: [] },
      { list: [] },
      { items: ['x'], phase: 42 },
      { op: 'bogus', items: ['x'] },
      { reason: 'r' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('keep', IN_PROGRESS)])]);
  });
});

describe('projectTodoState — legacy {ops:[...]} batch', () => {
  test('a valid batch equals the same entries as separate ordered calls', () => {
    const batch = projectTodoState([
      {
        ops: [
          { op: 'init', items: ['a', 'b', 'c'] },
          { op: 'done', task: 'a' },
          { op: 'block', task: 'c', reason: 'r' },
        ],
      },
    ]);
    const separate = projectTodoState([
      { op: 'init', items: ['a', 'b', 'c'] },
      { op: 'done', task: 'a' },
      { op: 'block', task: 'c', reason: 'r' },
    ]);
    expect(batch).toEqual(separate);
    expect(batch).toEqual([
      phase('Tasks', [item('a', COMPLETED), item('b', IN_PROGRESS), item('c', BLOCKED, 'r')]),
    ]);
  });

  test('an invalid entry rejects the entire batch, retaining pre-batch state', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      {
        ops: [
          { op: 'done', task: 'a' },
          { op: 'done', task: 'nope' },
        ],
      },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('a batch entry that cannot resolve to an op rejects the batch', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      {
        ops: [{ op: 'done', task: 'a' }, { comment: 'not an op' }, { op: 'done', task: 'b' }],
      },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('a batch with an unknown operation retains prior state', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a', 'b'] },
      { ops: [{ op: 'frobnicate' }] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', PENDING)])]);
  });

  test('missing init data inside a batch retains prior state and does not normalize', () => {
    const result = projectTodoState([
      {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
        ],
      },
      { ops: [{ op: 'init' }] },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS), item('b', IN_PROGRESS)])]);
  });
});

describe('projectTodoState — output hygiene and robustness', () => {
  test('never mutates inputs and returns fresh objects', () => {
    const inputs = [
      { op: 'init', items: ['a', 'b'] },
      { op: 'done', task: 'a' },
      { op: 'block', task: 'b', reason: 'r' },
    ];
    const snapshot = JSON.parse(JSON.stringify(inputs)) as typeof inputs;
    const result = projectTodoState(inputs);
    expect(inputs).toEqual(snapshot);
    const again = projectTodoState(inputs);
    expect(again).toEqual(result);
    expect(again).not.toBe(result);
    expect(again[0]).not.toBe(result[0]);
    expect(again[0]!.items[0]).not.toBe(result[0]!.items[0]);
  });

  test('mixed garbage never throws and never invents state', () => {
    const result = projectTodoState([
      null,
      undefined,
      42,
      'text',
      true,
      ['a'],
      { todos: 'not an array' },
      { ops: 'not an array' },
      { op: 42 },
      { op: null },
      { op: 'view', extra: 'ignored' },
      { plan: 'exit the plan' },
      { operation: 'init' },
      { op: 'init', items: 'not an array' },
      { op: 'done', task: { nested: 1 } },
      { op: 'block', task: 'a', reason: 42 },
    ]);
    expect(result).toEqual([]);
  });

  test('a {view} entry is the only no-op that resolves; other shapes stay no-ops', () => {
    const result = projectTodoState([
      { op: 'init', items: ['a'] },
      42,
      null,
      { view: true },
      { op: 'view' },
    ]);
    expect(result).toEqual([phase('Tasks', [item('a', IN_PROGRESS)])]);
  });

  test('phase and task text are preserved verbatim, including empty strings', () => {
    const result = projectTodoState([{ op: 'init', phase: '', items: ['', '  padded  '] }]);
    expect(result).toEqual([phase('', [item('', IN_PROGRESS), item('  padded  ', PENDING)])]);
  });

  test('the observed two-phase fold reproduces the expected state', () => {
    const result = projectTodoState([
      {
        op: 'init',
        list: [
          {
            phase: 'Research',
            items: [
              'Read the spec',
              'Map the message path',
              'Check contract conflicts',
              'Inspect the mockups',
              'Confirm the tokens',
              'Define acceptance cases',
            ],
          },
          {
            phase: 'Implement',
            items: [
              'Add the fold',
              'Wire Legacy',
              'Wire Console',
              'Add the tests',
              'Run the suite',
              'Review output',
            ],
          },
        ],
      },
      { op: 'done', task: 'Read the spec' },
      { op: 'block', task: 'Run the suite', reason: 'CI has one build job' },
      { op: 'drop', task: 'Review output' },
    ]);
    expect(result).toEqual([
      phase('Research', [
        item('Read the spec', COMPLETED),
        item('Map the message path', IN_PROGRESS),
        item('Check contract conflicts', PENDING),
        item('Inspect the mockups', PENDING),
        item('Confirm the tokens', PENDING),
        item('Define acceptance cases', PENDING),
      ]),
      phase('Implement', [
        item('Add the fold', PENDING),
        item('Wire Legacy', PENDING),
        item('Wire Console', PENDING),
        item('Add the tests', PENDING),
        item('Run the suite', BLOCKED, 'CI has one build job'),
        item('Review output', ABANDONED),
      ]),
    ]);
  });
});

describe('summarizeTodoState', () => {
  test('counts only completed items as done', () => {
    const summary = summarizeTodoState([
      phase('P', [
        item('a', COMPLETED),
        item('b', ABANDONED),
        item('c', PENDING),
        item('d', BLOCKED),
      ]),
    ]);
    expect(summary.done).toBe(1);
    expect(summary.total).toBe(4);
  });

  test('representative precedence: first in-progress wins', () => {
    const summary = summarizeTodoState([
      phase('P', [
        item('done', COMPLETED),
        item('blocked', BLOCKED),
        item('run1', IN_PROGRESS),
        item('run2', IN_PROGRESS),
      ]),
    ]);
    expect(summary.current).toEqual(item('run1', IN_PROGRESS));
  });

  test('no in-progress falls back to the first blocked item', () => {
    const summary = summarizeTodoState([
      phase('P', [item('done', COMPLETED), item('b1', BLOCKED, 'r1'), item('b2', BLOCKED, 'r2')]),
    ]);
    expect(summary.current).toEqual(item('b1', BLOCKED, 'r1'));
  });

  test('no in-progress or blocked falls back to the last completed item', () => {
    const summary = summarizeTodoState([
      phase('P', [item('c1', COMPLETED), item('c2', COMPLETED), item('x', ABANDONED)]),
    ]);
    expect(summary.current).toEqual(item('c2', COMPLETED));
  });

  test('no in-progress, blocked, or completed falls back to the first item', () => {
    const pending = summarizeTodoState([phase('P', [item('p1', PENDING), item('p2', PENDING)])]);
    expect(pending.current).toEqual(item('p1', PENDING));
    const abandoned = summarizeTodoState([phase('P', [item('x', ABANDONED)])]);
    expect(abandoned.current).toEqual(item('x', ABANDONED));
  });

  test('empty state returns a null current', () => {
    expect(summarizeTodoState([])).toEqual({ done: 0, total: 0, current: null });
  });
});

describe('TODO_STATUS_PRESENTATION', () => {
  test('contains all five statuses with the contract glyph and label', () => {
    expect(TODO_STATUS_PRESENTATION).toEqual({
      completed: { glyph: '☑', label: 'completed' },
      in_progress: { glyph: '◐', label: 'in progress' },
      blocked: { glyph: '⊘', label: 'blocked' },
      pending: { glyph: '☐', label: 'pending' },
      abandoned: { glyph: '☐', label: 'abandoned' },
    });
  });
});
