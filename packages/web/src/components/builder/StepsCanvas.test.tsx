import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DagNode } from '@/lib/api';
import { groupNodesIntoSteps } from '@/lib/node-steps';

import { tierChoiceOf } from './BuilderInspector';
import { nodeTierLabel, StepsCanvas } from './StepsCanvas';

const NODES = [
  { id: 'plan', prompt: 'p', model: 'large' },
  { id: 'build', prompt: 'b', depends_on: ['plan'], when: '$plan.output.ok == true' },
  { id: 'lint', bash: 'l', depends_on: ['plan'] },
] as DagNode[];

describe('StepsCanvas', () => {
  test('draws one column per step with parallel labels and node facts', () => {
    const html = renderToStaticMarkup(
      <StepsCanvas
        steps={groupNodesIntoSteps(NODES)}
        selectedNodeId="build"
        onSelect={(): void => undefined}
      />
    );
    expect(html).toContain('Step 01');
    expect(html).toContain('Step 02');
    expect(html).toContain('Parallel · 2');
    expect(html).toContain('conditional');
    expect(html).toContain('large');
    expect(html).toContain('aria-pressed="true"');
  });

  test('an empty workflow asks for a first node', () => {
    const html = renderToStaticMarkup(
      <StepsCanvas steps={[]} selectedNodeId={null} onSelect={(): void => undefined} />
    );
    expect(html).toContain('No nodes. Add one from the left.');
  });
});

describe('tier labels', () => {
  test('a tier keyword reads as itself and a model as custom', () => {
    expect(nodeTierLabel('small')).toBe('small');
    expect(nodeTierLabel('claude-opus-5-5')).toBe('custom');
    expect(nodeTierLabel(undefined)).toBe('');
  });

  test('the tier control reads the node model', () => {
    expect(tierChoiceOf('medium')).toBe('medium');
    expect(tierChoiceOf('@fast')).toBe('custom');
    expect(tierChoiceOf(undefined)).toBeNull();
  });
});
