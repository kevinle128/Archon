import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowEnvPreviewTable, PREVIEW_DISCLAIMER } from './WorkflowEnvPreviewTable';
import type { WorkflowEnvPreview } from '@/lib/workflow-envs/api';

function render(props: {
  preview?: WorkflowEnvPreview;
  loading?: boolean;
  error?: Error;
  envSelected?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(WorkflowEnvPreviewTable, {
      preview: props.preview,
      loading: props.loading,
      error: props.error,
      envSelected: props.envSelected ?? false,
    })
  );
}

const preview: WorkflowEnvPreview = {
  preview: true,
  authoritative: false,
  workflowName: 'feature',
  envId: 'e1',
  envName: 'fast',
  skippedNodeIds: ['gone'],
  targets: [{ id: 'plan', nodeType: 'prompt', allowedFields: ['provider', 'model'] }],
  resolved: [
    {
      nodeId: 'plan',
      provider: 'claude',
      model: 'sonnet',
      effort: 'high',
      thinking: { type: 'enabled', budgetTokens: 2000 },
    },
    {
      nodeId: 'group.child',
      provider: 'codex',
      tier: 'large',
    },
  ],
};

describe('WorkflowEnvPreviewTable', () => {
  test('renders provider-turn rows, skipped warnings, and disclaimer', () => {
    const html = render({ preview });
    expect(html).toContain('plan');
    expect(html).toContain('claude');
    expect(html).toContain('sonnet');
    expect(html).toContain('high');
    expect(html).toContain('enabled(2000)');
    expect(html).toContain('group.child');
    expect(html).toContain('codex');
    expect(html).toContain('tier:large');
    expect(html).toContain('Skipped missing nodes: gone');
    expect(html).toContain(PREVIEW_DISCLAIMER);
    expect(html).toContain('env: fast');
    // Never leak prompt/bash bodies even if present on targets-only payload.
    expect(html).not.toContain('prompt body');
    expect(html).not.toContain('bash body');
  });

  test('loading state for selected ENV', () => {
    const html = render({ loading: true, envSelected: true });
    expect(html).toContain('Loading ENV preview');
  });

  test('error state disables messaging when ENV selected', () => {
    const html = render({
      error: new Error('network'),
      envSelected: true,
    });
    expect(html).toContain('Run is disabled');
    expect(html).toContain('network');
  });

  test('error with None keeps YAML run usable messaging', () => {
    const html = render({
      error: new Error('network'),
      envSelected: false,
    });
    expect(html).toContain('running from the YAML still works');
  });
});
