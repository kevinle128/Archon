process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';

import { WorkflowAskChrome, type WorkflowAskChromeProps } from './WorkflowAskChrome';

const CREATED_AT = '2026-09-07T12:00:00.000Z';

function interaction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-a',
    kind: 'ask',
    status: 'pending',
    envelope: {},
    answer: null,
    provider_session_id: 'sess-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function node(
  overrides: Partial<WorkflowNodeStateResponse> &
    Pick<WorkflowNodeStateResponse, 'nodeId' | 'status'>
): WorkflowNodeStateResponse {
  return {
    name: overrides.nodeId,
    retryEpoch: 0,
    ...overrides,
  };
}

function renderChrome(overrides: Partial<WorkflowAskChromeProps> = {}): React.ReactElement | null {
  return WorkflowAskChrome({
    status: 'paused',
    pendingInteractions: [
      interaction(),
      interaction({ id: 'ask-2', tool_use_id: 'tool-b', node_id: 'ship' }),
    ],
    nodeStates: [
      node({ nodeId: 'setup', status: 'completed' }),
      node({ nodeId: 'review', status: 'awaiting' }),
      node({ nodeId: 'ship', status: 'running' }),
    ],
    runError: null,
    onSelectAwaitingNode: (_nodeId: string): void => undefined,
    onRequestGraphView: (): void => undefined,
    ...overrides,
  });
}

function clickRootButton(element: React.ReactElement | null): void {
  expect(element).not.toBeNull();
  expect(element?.type).toBe('button');
  const onClick = (element?.props as { onClick?: () => void }).onClick;
  onClick?.();
}

describe('WorkflowAskChrome', () => {
  test('renders awaiting pill or CAP-7 error banner', () => {
    const awaiting = renderChrome();
    const awaitingMarkup = renderToStaticMarkup(awaiting);
    expect(awaitingMarkup).toContain('Awaiting input (2)');
    expect(awaitingMarkup).toContain('text-status-waiting');
    expect(awaitingMarkup).toContain('aria-live="polite"');
    expect(awaitingMarkup).not.toContain('text-error');

    const order: string[] = [];
    clickRootButton(
      renderChrome({
        onRequestGraphView: (): void => {
          order.push('graph');
        },
        onSelectAwaitingNode: (nodeId: string): void => {
          order.push(nodeId);
        },
      })
    );
    expect(order).toEqual(['graph', 'review']);

    const noopCalls: string[] = [];
    clickRootButton(
      renderChrome({
        nodeStates: [node({ nodeId: 'setup', status: 'completed' })],
        onRequestGraphView: (): void => {
          noopCalls.push('graph');
        },
        onSelectAwaitingNode: (nodeId: string): void => {
          noopCalls.push(nodeId);
        },
      })
    );
    expect(noopCalls).toEqual([]);

    const cap7 = renderChrome({
      status: 'failed',
      pendingInteractions: [],
      runError: 'AskHuman is not supported by provider: grok',
    });
    const cap7Markup = renderToStaticMarkup(cap7);
    expect(cap7Markup).toContain('AskHuman is not supported by provider: grok');
    expect(cap7Markup).toContain('role="alert"');
    expect(cap7Markup).toContain('text-error');
    expect(cap7Markup).not.toContain('Awaiting input');
    expect(cap7Markup).not.toContain('text-status-waiting');
  });
});
