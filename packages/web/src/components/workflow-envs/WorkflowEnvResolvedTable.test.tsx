import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RESOLVED_REQUEST_CAPTION, WorkflowEnvResolvedTable } from './WorkflowEnvResolvedTable';
import type { RunEnvOverlay } from './WorkflowEnvResolvedTable';

function render(overlay: RunEnvOverlay): string {
  return renderToStaticMarkup(createElement(WorkflowEnvResolvedTable, { overlay }));
}

const complete: RunEnvOverlay = {
  envId: 'e1',
  envName: 'fast',
  workflowName: 'feature',
  complete: true,
  skippedNodeIds: ['gone'],
  latestMissingNodeIds: ['plan'],
  resolved: [
    {
      nodeId: 'implement',
      provider: 'claude',
      model: 'sonnet',
      effort: 'high',
      thinking: { type: 'adaptive' },
    },
    {
      nodeId: 'plan',
      provider: 'claude',
      tier: 'large',
    },
  ],
};

describe('WorkflowEnvResolvedTable', () => {
  test('renders resolved rows, warnings, caption; never prompt/bash', () => {
    const html = render(complete);
    expect(html).toContain('env: fast');
    expect(html).toContain('implement');
    expect(html).toContain('claude');
    expect(html).toContain('sonnet');
    expect(html).toContain('tier:large');
    expect(html).toContain('high');
    expect(html).toContain('adaptive');
    expect(html).toContain('Skipped missing nodes at start: gone');
    expect(html).toContain('Originally applied ids missing on latest resume: plan');
    expect(html).toContain(RESOLVED_REQUEST_CAPTION);
    expect(html).not.toContain('prompt');
    expect(html).not.toContain('bash');
    expect(html.toLowerCase()).not.toContain('secret');
  });

  test('pending overlay shows pending copy without empty table claim', () => {
    const html = render({
      ...complete,
      complete: false,
      resolved: null,
      latestMissingNodeIds: [],
    });
    expect(html).toContain('(pending)');
    expect(html).toContain('resolved request rows appear once execution starts');
    expect(html).not.toContain('<table');
  });

  test('complete empty resolved map shows empty copy', () => {
    const html = render({
      ...complete,
      skippedNodeIds: [],
      latestMissingNodeIds: [],
      resolved: [],
    });
    expect(html).toContain('No provider-turn request rows recorded');
  });
});
