import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import type { WorkflowListEntry } from '@/lib/api';

import { categoryCounts, rowDescription, WorkflowsListColumn } from './WorkflowsListColumn';

function entry(
  name: string,
  description: string,
  source: WorkflowListEntry['source'] = 'bundled'
): WorkflowListEntry {
  return {
    workflow: { name, description, nodes: [{ id: 'a', prompt: 'x' }] },
    source,
  } as WorkflowListEntry;
}

describe('categoryCounts', () => {
  test('counts every entry under All and each under its category', () => {
    const counts = categoryCounts([
      entry('archon-review-pr', 'Review a pull request'),
      entry('archon-fix-issue', 'Fix a GitHub issue'),
    ]);
    expect(counts.get('All')).toBe(2);
    const total = [...counts.entries()]
      .filter(([category]) => category !== 'All')
      .reduce((sum, [, count]) => sum + count, 0);
    expect(total).toBe(2);
  });
});

describe('rowDescription', () => {
  test('falls back to the whole description', () => {
    expect(rowDescription('Plain text.')).toBe('Plain text.');
  });
});

describe('WorkflowsListColumn', () => {
  function render(recommended: WorkflowListEntry[], rest: WorkflowListEntry[]): string {
    return renderToStaticMarkup(
      <MemoryRouter>
        <WorkflowsListColumn
          searched={[...recommended, ...rest]}
          recommended={recommended}
          rest={rest}
          total={recommended.length + rest.length}
          selectedName={rest[0]?.workflow.name ?? null}
          onSelect={(): void => undefined}
          query=""
          onQueryChange={(): void => undefined}
          category="All"
          onCategoryChange={(): void => undefined}
          status={null}
        />
      </MemoryRouter>
    );
  }

  test('pins recommended rows above the rest', () => {
    const html = render([entry('pinned', 'First')], [entry('other', 'Second', 'project')]);
    expect(html.indexOf('Recommended')).toBeLessThan(html.indexOf('Pinned'));
    expect(html.indexOf('Pinned')).toBeLessThan(html.indexOf('All workflows'));
  });

  test('tags the source and marks the selected row', () => {
    const html = render([], [entry('other', 'Second', 'project')]);
    expect(html).toContain('Project');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="Category"');
    expect(html).toContain('data-list-filter=""');
  });
});
