process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactElement } from 'react';
import type { Root } from 'react-dom/client';

import type { UsageMetrics, UsageReport, UsageReportGroup } from '@/lib/settings/usage';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const { runUsageContext } = await import('./run-usage-context');
const runCostModule = await import('./RunCostMeta');
const disclosureModule = await import('./NodeUsageDisclosure');

const act = react.act;
const createElement = react.createElement;

function metrics(overrides: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    tokensInput: 1000,
    tokensOutput: 500,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: 1,
    reportedUsd: 0.42,
    estimatedUsd: 0,
    recordCount: 1,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
    ...overrides,
  };
}

const NODE_GROUP: UsageReportGroup = {
  dimensions: {
    nodeId: 'emit-usage',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    modelSource: 'reported',
    kind: null,
  },
  metrics: metrics(),
};

function report(coverage: Partial<UsageReport['coverage']> = {}): UsageReport {
  return {
    scope: { from: null, to: null, includesChildRollup: false },
    groupBy: 'node',
    totals: metrics(),
    groups: [NODE_GROUP],
    coverage: {
      usageEventCount: 1,
      ledgeredEventCount: 1,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
      ...coverage,
    },
  };
}

describe('run usage UI', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = reactDomClient.createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  async function renderWith(
    usage: UsageReport | null,
    child: ReactElement,
    legacyCostUsd: number | null = null
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(runUsageContext.Provider, { value: { usage, legacyCostUsd } }, child)
      );
    });
  }

  test('header shows reported and estimated USD as separate values', async () => {
    await renderWith(report(), createElement(runCostModule.RunCostMeta));
    const text = host.textContent;
    expect(text).toContain('$0.42');
    expect(text).toContain('reported');
    expect(text).toContain('≈$0.00');
    expect(text).toContain('estimated');
  });

  test('header says usage unavailable rather than zero when the query failed', async () => {
    await renderWith(null, createElement(runCostModule.RunCostMeta), 2);
    expect(host.textContent).toContain('usage unavailable');
    expect(host.textContent).not.toContain('$');
  });

  test('header says not recorded for a run with no usage events', async () => {
    await renderWith(
      report({ usageEventCount: 0, ledgeredEventCount: 0, hasRecordedUsage: false }),
      createElement(runCostModule.RunCostMeta)
    );
    expect(host.textContent).toContain('not recorded');
  });

  test('header flags event-only usage as incomplete', async () => {
    const eventOnly: UsageReport = {
      ...report({ usageEventCount: 2, ledgeredEventCount: 0, unledgeredEventCount: 2 }),
      totals: metrics({ recordCount: 0 }),
      groups: [],
    };
    await renderWith(eventOnly, createElement(runCostModule.RunCostMeta));
    expect(host.textContent).toContain('incomplete · event-only');
  });

  test('header renders nothing without a usage provider', async () => {
    await act(async () => {
      root.render(createElement(runCostModule.RunCostMeta));
    });
    expect(host.textContent).toBe('');
  });

  test('node control expands a usage table and collapses again', async () => {
    await renderWith(
      report(),
      createElement(disclosureModule.NodeUsageDisclosure, { nodeId: 'emit-usage' })
    );
    const button = host.querySelector('button');
    if (button === null) throw new Error('missing usage button');
    expect(button.textContent).toContain('Show usage breakdown');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('table')).toBeNull();

    await act(async () => {
      button.dispatchEvent(new win.Event('click', { bubbles: true }) as unknown as Event);
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toContain('Hide usage breakdown');
    expect(host.querySelector('table')?.textContent).toContain('anthropic/claude-sonnet-4');

    await act(async () => {
      button.dispatchEvent(new win.Event('click', { bubbles: true }) as unknown as Event);
    });
    expect(host.querySelector('table')).toBeNull();
  });

  test('node control is absent for a node with no ledger usage or a failed query', async () => {
    await renderWith(
      report(),
      createElement(disclosureModule.NodeUsageDisclosure, { nodeId: 'other' })
    );
    expect(host.querySelector('button')).toBeNull();
    await renderWith(
      null,
      createElement(disclosureModule.NodeUsageDisclosure, { nodeId: 'emit-usage' })
    );
    expect(host.querySelector('button')).toBeNull();
  });

  test('node expansion labels run-wide unledgered events as run scope', async () => {
    await renderWith(
      report({ usageEventCount: 3, ledgeredEventCount: 2, unledgeredEventCount: 1 }),
      createElement(disclosureModule.NodeUsageDisclosure, { nodeId: 'emit-usage' })
    );
    const button = host.querySelector('button');
    if (button === null) throw new Error('missing usage button');
    await act(async () => {
      button.dispatchEvent(new win.Event('click', { bubbles: true }) as unknown as Event);
    });
    expect(host.textContent).toContain('Run-wide: 1 usage event lacks ledger rows');
  });
});

describe('RunEnvOverlayMeta', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = reactDomClient.createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  test('names the environment and expands the resolved table on demand', async () => {
    const envModule = await import('./RunEnvOverlayMeta');
    await act(async () => {
      root.render(
        createElement(envModule.RunEnvOverlayMeta, {
          overlay: {
            envId: 'e1',
            envName: 'fast',
            workflowName: 'plan',
            complete: true,
            skippedNodeIds: [],
            latestMissingNodeIds: [],
            resolved: [{ nodeId: 'plan', provider: 'claude', model: 'sonnet' }],
          },
        })
      );
    });
    const button = host.querySelector('button');
    if (button === null) throw new Error('missing environment button');
    expect(button.textContent).toContain('fast');
    expect(host.querySelector('[data-testid="workflow-env-resolved-table"]')).toBeNull();
    await act(async () => {
      button.dispatchEvent(new win.Event('click', { bubbles: true }) as unknown as Event);
    });
    const table = host.querySelector('[data-testid="workflow-env-resolved-table"]');
    expect(table?.textContent).toContain('sonnet');
  });
});
