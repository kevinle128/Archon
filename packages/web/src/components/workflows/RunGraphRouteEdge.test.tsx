import { describe, expect, test } from 'bun:test';
import { Position, type EdgeProps } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LayoutRoute } from '@/lib/run-graph';
import { RunGraphRouteEdge, shortEdgeLabel, type RunGraphFlowEdge } from './RunGraphRouteEdge';

const SHARED_PATH = 'M 90 80 C 90 116 90 124 90 160';

function route(overrides: Partial<LayoutRoute> = {}): LayoutRoute {
  return {
    edgeId: 'a->b',
    source: 'a',
    target: 'b',
    kind: 'dependency',
    sourcePort: 'bottom',
    targetPort: 'top',
    path: SHARED_PATH,
    labelPosition: { x: 98, y: 120 },
    backEdge: false,
    taken: false,
    ...overrides,
  };
}

function props(layoutRoute: LayoutRoute): EdgeProps<RunGraphFlowEdge> {
  return {
    id: layoutRoute.edgeId,
    source: layoutRoute.source,
    target: layoutRoute.target,
    type: 'runGraphRoute',
    data: { route: layoutRoute },
    sourceX: 90,
    sourceY: 80,
    targetX: 90,
    targetY: 160,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    markerEnd: 'url(#marker)',
    label: layoutRoute.label,
  };
}

function render(layoutRoute: LayoutRoute): string {
  return renderToStaticMarkup(<RunGraphRouteEdge {...props(layoutRoute)} />);
}

describe('RunGraphRouteEdge', () => {
  test('untaken edge renders the shared path with border stroke', () => {
    const markup = render(route());
    expect(markup).toContain(`d="${SHARED_PATH}"`);
    expect(markup).toContain('stroke:var(--border)');
    expect(markup).not.toContain('stroke-dasharray');
  });

  test('taken dependency uses accent-bright', () => {
    const markup = render(route({ taken: true, kind: 'dependency' }));
    expect(markup).toContain(`d="${SHARED_PATH}"`);
    expect(markup).toContain('stroke:var(--accent-bright)');
  });

  test('taken conditional uses success', () => {
    const markup = render(route({ taken: true, kind: 'conditional', label: '$a.ok' }));
    expect(markup).toContain('stroke:var(--success)');
    expect(markup).toContain('stroke-dasharray');
  });

  test('taken else dependency uses accent', () => {
    const markup = render(
      route({ taken: true, kind: 'dependency', outcome: 'negative', label: 'else' })
    );
    expect(markup).toContain('stroke:var(--accent)');
  });

  test('taken positive route uses success', () => {
    const markup = render(
      route({ taken: true, kind: 'route', outcome: 'positive', label: 'positive' })
    );
    expect(markup).toContain('stroke:var(--success)');
  });

  test('taken negative route uses accent', () => {
    const markup = render(
      route({ taken: true, kind: 'route', outcome: 'negative', label: 'negative' })
    );
    expect(markup).toContain('stroke:var(--accent)');
  });

  test('taken exhausted route uses error', () => {
    const markup = render(
      route({ taken: true, kind: 'route', outcome: 'exhausted', label: 'exhausted' })
    );
    expect(markup).toContain('stroke:var(--error)');
  });

  test('conditional and back-edge routes are dashed', () => {
    expect(render(route({ kind: 'conditional', label: '$a.ok' }))).toContain('stroke-dasharray');
    expect(render(route({ backEdge: true }))).toContain('stroke-dasharray');
  });

  test('empty path renders an empty string', () => {
    expect(render(route({ path: '' }))).toBe('');
  });
});

describe('shortEdgeLabel', () => {
  test('keeps short labels and missing labels as they are', () => {
    expect(shortEdgeLabel(undefined)).toBeUndefined();
    expect(shortEdgeLabel('positive')).toBe('positive');
    expect(shortEdgeLabel('x'.repeat(24))).toBe('x'.repeat(24));
  });

  test('cuts a long condition to 24 characters with an ellipsis', () => {
    const label = "$seed.output == 'sentinel-never-produced-e2e'";
    const short = shortEdgeLabel(label);
    expect(short).toHaveLength(24);
    expect(short?.endsWith('…')).toBe(true);
    expect(label.startsWith(short?.slice(0, -1) ?? '')).toBe(true);
  });
});
