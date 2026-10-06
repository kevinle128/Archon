import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChildWorkflowRoom } from './ChildWorkflowRoom';

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const BASE = {
  childRunId: null as string | null,
  fanOut: false,
  output: null as string | null,
  paused: false,
  message: null as string | null,
  status: 'completed' as const,
};

describe('ChildWorkflowRoom', () => {
  test('links one child run without rendering a transcript', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom nodeId="child" child={{ ...BASE, childRunId: 'child-1' }} />
    );
    expect(markup).toContain('Child run');
    expect(markup).toContain('href="/workflows/runs/child-1"');
    expect(markup).toContain('Open child run');
    expect(markup).not.toContain('chat-markdown');
  });

  test('renders the paused-child message and current child link', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom
        nodeId="child"
        child={{
          ...BASE,
          childRunId: 'child-1',
          paused: true,
          message: 'Child needs review',
          status: 'running',
        }}
      />
    );
    expect(markup).toContain('Child needs review');
    expect(markup).toContain('Open child run');
  });

  test('renders fan-out summary without inventing a single child link', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom
        nodeId="children"
        child={{
          ...BASE,
          childRunId: null,
          fanOut: true,
          output: '3 children completed',
        }}
      />
    );
    expect(markup).toContain('This node spawned multiple child runs');
    expect(markup).toContain('3 children completed');
    expect(markup).not.toContain('Open child run');
  });

  test('uses the shared no-output copy without losing the selected region', () => {
    const markup = renderToStaticMarkup(
      <ChildWorkflowRoom nodeId="child" child={{ ...BASE, childRunId: null, status: 'pending' }} />
    );
    expect(visibleText(markup)).toContain("Node hasn't produced output");
    expect(markup).toContain('aria-label="child room"');
  });
});
