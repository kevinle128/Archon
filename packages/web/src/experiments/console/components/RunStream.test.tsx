import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  aggregateUsageMetrics,
  collectUsageByNode,
  pairToolEvents,
  RunStream,
  sumNullableMetric,
} from './RunStream';
import { buildNodeLedgerUsageReport, NodeDivider } from './NodeDivider';
import { foldNodeRuns, toRunEvent } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { UsageMetrics, UsageReport, UsageReportGroup } from '../skills/usage';
import type { WorkflowEvent, WorkflowNodeState } from '../skills/runs';
import { StreamContextProvider } from '../lib/stream-context';
import { buildConsoleLogEntries } from './inspect/build-console-log-entries';
import { buildLogRows } from './inspect/build-log-rows';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';

type Raw = Parameters<typeof toRunEvent>[0];

function raw(over: Partial<Raw> & { event_type: string }): Raw {
  return {
    id: 'e1',
    workflow_run_id: 'r1',
    step_index: null,
    step_name: 'node-a',
    data: {},
    created_at: '2026-06-05T10:00:00Z',
    ...over,
  };
}

describe('pairToolEvents — node identity threading', () => {
  test('each paired call carries its source event nodeId (step_name) + duration', () => {
    const events = [
      toRunEvent(
        raw({
          id: 's1',
          event_type: 'tool_called',
          step_name: 'plan',
          data: { tool_name: 'Read', tool_input: { path: 'a' } },
        })
      ),
      toRunEvent(
        raw({
          id: 'c1',
          event_type: 'tool_completed',
          step_name: 'plan',
          data: { tool_name: 'Read', duration_ms: 120 },
        })
      ),
      toRunEvent(
        raw({
          id: 's2',
          event_type: 'tool_called',
          step_name: 'implement',
          data: { tool_name: 'Bash', tool_input: { cmd: 'ls' } },
        })
      ),
      toRunEvent(
        raw({
          id: 'c2',
          event_type: 'tool_completed',
          step_name: 'implement',
          data: { tool_name: 'Bash', duration_ms: 300 },
        })
      ),
    ];

    const paired = pairToolEvents(events);
    expect(paired).toHaveLength(2);
    const byId = new Map(paired.map(p => [p.id, p]));
    expect(byId.get('s1')?.nodeId).toBe('plan');
    expect(byId.get('s1')?.call.durationMs).toBe(120);
    expect(byId.get('s1')?.call.outcome).toBe('succeeded');
    expect(byId.get('s2')?.nodeId).toBe('implement');
    expect(byId.get('s2')?.call.durationMs).toBe(300);
    expect(byId.get('s2')?.call.outcome).toBe('succeeded');
  });

  test('a tool_called with a null step_name stays unattributed (nodeId null)', () => {
    const paired = pairToolEvents([
      toRunEvent(
        raw({ id: 's1', event_type: 'tool_called', step_name: null, data: { tool_name: 'Read' } })
      ),
    ]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.nodeId).toBeNull();
  });

  test('an unmatched call (no tool_completed yet) is running', () => {
    const paired = pairToolEvents([
      toRunEvent(raw({ id: 's1', event_type: 'tool_called', data: { tool_name: 'Bash' } })),
    ]);
    expect(paired[0]?.call.outcome).toBe('running');
    expect(paired[0]?.call.durationMs).toBeUndefined();
  });

  test('a persisted failed outcome and exit code carry through to the paired call', () => {
    const events = [
      toRunEvent(
        raw({ id: 's1', event_type: 'tool_called', data: { tool_name: 'Bash', tool_input: {} } })
      ),
      toRunEvent(
        raw({
          id: 'c1',
          event_type: 'tool_completed',
          data: { tool_name: 'Bash', duration_ms: 50, tool_outcome: 'error', exit_code: 1 },
        })
      ),
    ];
    const paired = pairToolEvents(events);
    expect(paired[0]?.call.outcome).toBe('failed');
    expect(paired[0]?.call.exitCode).toBe(1);
    expect(paired[0]?.call.durationMs).toBe(50);
  });
});

function emptyMetrics(overrides: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: null,
    reportedUsd: null,
    estimatedUsd: null,
    recordCount: 0,
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

function group(
  dims: UsageReportGroup['dimensions'],
  metrics: Partial<UsageMetrics> = {}
): UsageReportGroup {
  return { dimensions: dims, metrics: emptyMetrics(metrics) };
}

function nodeReport(groups: UsageReportGroup[]): UsageReport {
  return {
    scope: { from: null, to: null, includesChildRollup: false, runId: 'run-1' },
    groupBy: 'node',
    totals: emptyMetrics(),
    groups,
    coverage: {
      usageEventCount: groups.length,
      ledgeredEventCount: groups.length,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    },
  };
}

describe('sumNullableMetric', () => {
  test('all-null stays null; zero stays zero; present values sum', () => {
    expect(sumNullableMetric(null, null)).toBeNull();
    expect(sumNullableMetric(0, null)).toBe(0);
    expect(sumNullableMetric(null, 0)).toBe(0);
    expect(sumNullableMetric(1.5, 0.5)).toBe(2);
    expect(sumNullableMetric(null, 3)).toBe(3);
  });
});

describe('aggregateUsageMetrics', () => {
  test('preserves missingness and sums known zeros, values, and counters', () => {
    const a = group(
      { nodeId: 'plan', provider: 'anthropic', model: 'sonnet', modelSource: 'reported' },
      {
        tokensInput: null,
        tokensOutput: 0,
        reportedUsd: 0.1,
        estimatedUsd: null,
        recordCount: 1,
        missingTokensInput: 1,
        rowsMissingUsd: 0,
      }
    );
    const b = group(
      {
        nodeId: 'plan',
        provider: 'openai',
        model: 'gpt-4.1',
        modelSource: 'requested',
        kind: 'advisor',
      },
      {
        tokensInput: null,
        tokensOutput: 40,
        reportedUsd: null,
        estimatedUsd: 0.004,
        recordCount: 2,
        missingTokensInput: 2,
        rowsMissingUsd: 1,
        requests: 0,
      }
    );

    const agg = aggregateUsageMetrics([a, b]);
    expect(agg.tokensInput).toBeNull();
    expect(agg.tokensOutput).toBe(40);
    expect(agg.reportedUsd).toBe(0.1);
    expect(agg.estimatedUsd).toBe(0.004);
    expect(agg.recordCount).toBe(3);
    expect(agg.missingTokensInput).toBe(3);
    expect(agg.rowsMissingUsd).toBe(1);
    expect(agg.requests).toBe(0);
  });

  test('empty groups → empty null metrics', () => {
    const agg = aggregateUsageMetrics([]);
    expect(agg.tokensInput).toBeNull();
    expect(agg.reportedUsd).toBeNull();
    expect(agg.recordCount).toBe(0);
  });
});

describe('collectUsageByNode', () => {
  test('two API groups sharing nodeId keep both rows and cumulative totals', () => {
    const primary = group(
      {
        nodeId: 'implement',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelSource: 'reported',
        kind: null,
      },
      { reportedUsd: 0.2, estimatedUsd: null, tokensInput: 100, recordCount: 1 }
    );
    const advisor = group(
      {
        nodeId: 'implement',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        modelSource: 'requested',
        kind: 'advisor',
      },
      { reportedUsd: null, estimatedUsd: 0.05, tokensInput: 50, recordCount: 1 }
    );
    const other = group(
      { nodeId: 'plan', provider: 'anthropic', model: 'haiku', modelSource: 'reported' },
      { reportedUsd: 0.01, recordCount: 1 }
    );

    const map = collectUsageByNode(nodeReport([primary, advisor, other]));
    expect(map.size).toBe(2);

    const implement = map.get('implement');
    expect(implement).toBeDefined();
    if (implement === undefined) {
      throw new Error('expected implement node usage collection');
    }
    expect(implement.groups).toHaveLength(2);
    expect(implement.groups).toEqual([primary, advisor]);
    expect(implement.aggregate.reportedUsd).toBe(0.2);
    expect(implement.aggregate.estimatedUsd).toBe(0.05);
    expect(implement.aggregate.tokensInput).toBe(150);
    expect(implement.aggregate.recordCount).toBe(2);

    // Provider/model/source/kind siblings are not discarded by node id overwrite.
    expect(implement.groups[0]?.dimensions.provider).toBe('anthropic');
    expect(implement.groups[1]?.dimensions.provider).toBe('openai');
    expect(implement.groups[1]?.dimensions.kind).toBe('advisor');

    const plan = map.get('plan');
    expect(plan?.groups).toHaveLength(1);
    expect(plan?.aggregate.reportedUsd).toBe(0.01);
  });

  test('non-node groupBy or null usage yields empty map', () => {
    expect(collectUsageByNode(null).size).toBe(0);
    expect(
      collectUsageByNode({
        ...nodeReport([]),
        groupBy: 'provider',
        groups: [group({ provider: 'anthropic', nodeId: 'x' }, { recordCount: 1 })],
      }).size
    ).toBe(0);
  });

  test('blank nodeId groups are skipped', () => {
    const map = collectUsageByNode(
      nodeReport([
        group({ nodeId: null, provider: 'anthropic' }, { recordCount: 1 }),
        group({ nodeId: '', provider: 'openai' }, { recordCount: 1 }),
        group({ nodeId: 'ok', provider: 'anthropic' }, { reportedUsd: 1, recordCount: 1 }),
      ])
    );
    expect(map.size).toBe(1);
    expect(map.get('ok')?.groups).toHaveLength(1);
  });
});

describe('buildNodeLedgerUsageReport', () => {
  test('node A ledger groups do not inherit node B run-wide unledgered as local coverage', () => {
    const nodeA = group(
      {
        nodeId: 'node-a',
        provider: 'anthropic',
        model: 'sonnet',
        modelSource: 'reported',
        agentProvider: 'claude',
      },
      { reportedUsd: 0.2, recordCount: 1, tokensInput: 40 }
    );
    const runUsage: UsageReport = {
      ...nodeReport([
        nodeA,
        group(
          { nodeId: 'node-b', provider: 'openai', model: 'gpt', modelSource: 'requested' },
          { reportedUsd: 0.05, recordCount: 1 }
        ),
      ]),
      coverage: {
        usageEventCount: 3,
        ledgeredEventCount: 2,
        // Unledgered event belongs to another node / pass — still run-wide only.
        unledgeredEventCount: 1,
        hasRecordedUsage: true,
        historicalBackfill: false,
        filterScope: 'date-project-run-node',
      },
    };

    const { report, runWideCoverage } = buildNodeLedgerUsageReport({
      usageGroups: [nodeA],
      usageAggregate: aggregateUsageMetrics([nodeA]),
      runUsage,
    });

    expect(report.groups).toEqual([nodeA]);
    expect(report.totals.reportedUsd).toBe(0.2);
    expect(report.totals.recordCount).toBe(1);
    // Never invent per-node event coverage from ledger row counts.
    expect(report.coverage.usageEventCount).toBe(0);
    expect(report.coverage.ledgeredEventCount).toBe(0);
    expect(report.coverage.unledgeredEventCount).toBe(0);
    expect(report.coverage.hasRecordedUsage).toBe(true);
    // Run-wide incomplete is retained only as separately labeled context.
    expect(runWideCoverage).toEqual(runUsage.coverage);
    expect(runWideCoverage?.unledgeredEventCount).toBe(1);
  });

  test('fully ledgered run yields no run-wide coverage warning payload', () => {
    const nodeA = group(
      { nodeId: 'node-a', provider: 'anthropic', model: 'sonnet', modelSource: 'reported' },
      { reportedUsd: 0.1, recordCount: 2 }
    );
    const runUsage = nodeReport([nodeA]);

    const { report, runWideCoverage } = buildNodeLedgerUsageReport({
      usageGroups: [nodeA],
      usageAggregate: aggregateUsageMetrics([nodeA]),
      runUsage,
    });

    expect(report.coverage.unledgeredEventCount).toBe(0);
    expect(runWideCoverage).toBeNull();
  });
});

describe('NodeDivider legacy cost zero', () => {
  function renderDivider(props: {
    costUsd?: number | null;
    hasLedgerUsage?: boolean;
    reportedUsd?: number | null;
    estimatedUsd?: number | null;
  }): string {
    return renderToStaticMarkup(
      createElement(StreamContextProvider, {
        value: { runStartedAt: '2026-06-05T10:00:00Z' },
        children: createElement(NodeDivider, {
          rowId: 'step',
          nodeId: 'step',
          nodeName: 'step',
          selected: false,
          onSelect: (): void => undefined,
          status: 'completed',
          durationMs: 1000,
          timestamp: '2026-06-05T10:00:01Z',
          costUsd: props.costUsd ?? null,
          hasLedgerUsage: props.hasLedgerUsage ?? false,
          reportedUsd: props.reportedUsd,
          estimatedUsd: props.estimatedUsd,
        }),
      })
    );
  }

  test('explicit legacy cost 0 renders $0.00 when no ledger rows', () => {
    const markup = renderDivider({ costUsd: 0 });
    expect(markup).toContain('$0.00');
  });

  test('absent legacy cost stays absent (no zero fabrication)', () => {
    const markup = renderDivider({ costUsd: null });
    expect(markup).not.toContain('$0.00');
    expect(markup).not.toContain('n/a');
  });

  test('ledgered reported zero takes precedence over legacy positive cost', () => {
    const markup = renderDivider({
      costUsd: 1.5,
      hasLedgerUsage: true,
      reportedUsd: 0,
      estimatedUsd: null,
    });
    expect(markup).toContain('$0.00');
    expect(markup).toContain('n/a');
    // Ledger path formats reported/estimated pair, not bare legacy alone.
    expect(markup).toContain('$0.00 / n/a');
  });

  test('sub-micro positive legacy cost never rounds into zero representation', () => {
    const markup = renderDivider({ costUsd: 1e-9 });
    // renderToStaticMarkup HTML-escapes `<` → `&lt;`
    expect(markup).toContain('&lt;$0.000001');
    // Exact zero form is `$0.00` with a word/space boundary after — not the floor prefix.
    expect(markup).not.toMatch(/\$0\.00(?!\d)/);
  });
});

const RUN_STARTED = '2026-06-05T10:00:00Z';

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'>
): WorkflowNodeState {
  return { retryEpoch: 0, ...overrides };
}

function workflowEvent(overrides: {
  id: string;
  event_type: string;
  step_name: string;
  created_at: string;
  data?: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: overrides.id,
    workflow_run_id: 'r1',
    event_type: overrides.event_type,
    step_index: null,
    step_name: overrides.step_name,
    data: overrides.data ?? {},
    created_at: overrides.created_at,
  };
}

function routeEvent(id: string, executionSeq: number, created_at: string): WorkflowEvent {
  return workflowEvent({
    id,
    event_type: 'node_routed',
    step_name: 'router',
    created_at,
    data: {
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      execution_seq: executionSeq,
    },
  });
}

function assistantMessage(id: string, content: string, timestamp: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    toolCalls: [],
    error: null,
    category: null,
    dispatch: null,
    workflowResult: null,
  };
}

function fiveDividerFixture(): {
  logEntries: ReturnType<typeof buildConsoleLogEntries>;
  runEvents: ReturnType<typeof toRunEvent>[];
  messages: Message[];
  usage: UsageReport;
} {
  const rawEvents: WorkflowEvent[] = [
    workflowEvent({
      id: 'plan-start',
      event_type: 'node_started',
      step_name: 'plan',
      created_at: '2026-06-05T10:00:01Z',
      data: { name: 'Plan' },
    }),
    workflowEvent({
      id: 'plan-done',
      event_type: 'node_completed',
      step_name: 'plan',
      created_at: '2026-06-05T10:00:02Z',
      data: {
        name: 'Plan',
        duration_ms: 1000,
        cost_usd: 0.5,
        num_turns: 2,
        stop_reason: 'end_turn',
      },
    }),
    workflowEvent({
      id: 'loop-start',
      event_type: 'node_started',
      step_name: 'loop',
      created_at: '2026-06-05T10:00:03Z',
      data: { name: 'Loop' },
    }),
    workflowEvent({
      id: 'loop-i1-start',
      event_type: 'loop_iteration_started',
      step_name: 'loop',
      created_at: '2026-06-05T10:00:03Z',
      data: { iteration: 1 },
    }),
    workflowEvent({
      id: 'loop-i1-done',
      event_type: 'loop_iteration_completed',
      step_name: 'loop',
      created_at: '2026-06-05T10:00:03.500Z',
      data: { iteration: 1, duration: 2000 },
    }),
    workflowEvent({
      id: 'router-start',
      event_type: 'node_started',
      step_name: 'router',
      created_at: '2026-06-05T10:00:04Z',
      data: { name: 'Router' },
    }),
    routeEvent('route-1', 1, '2026-06-05T10:00:04Z'),
    routeEvent('route-2', 2, '2026-06-05T10:00:07Z'),
    workflowEvent({
      id: 'loop-i2-start',
      event_type: 'loop_iteration_started',
      step_name: 'loop',
      created_at: '2026-06-05T10:00:09Z',
      data: { iteration: 2 },
    }),
  ];
  const runEvents = rawEvents.map(toRunEvent);
  const logEntries = buildConsoleLogEntries({
    rows: buildLogRows(
      [
        nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' }),
        nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' }),
        nodeState({ nodeId: 'router', name: 'Router', status: 'running' }),
      ],
      rawEvents
    ),
    rawEvents,
    nodeRuns: foldNodeRuns(runEvents),
    runStartedAt: RUN_STARTED,
  });
  const loopGroup = group(
    { nodeId: 'loop', provider: 'anthropic', model: 'sonnet', modelSource: 'reported' },
    { reportedUsd: 1.25, estimatedUsd: 1.4, recordCount: 2 }
  );
  return {
    logEntries,
    runEvents,
    messages: [
      assistantMessage('plan-prose', 'plan output', '2026-06-05T10:00:01.500Z'),
      assistantMessage('router-prose', 'router output', '2026-06-05T10:00:05Z'),
    ],
    usage: nodeReport([loopGroup]),
  };
}

function renderStreamMarkup(args: {
  selectedNodeId?: string;
  selectedLogRowId?: string | null;
  onSelectLogRow?: (rowId: string, nodeId: string) => void;
}): string {
  const fixture = fiveDividerFixture();
  return renderToStaticMarkup(
    createElement(StreamContextProvider, {
      value: { runStartedAt: RUN_STARTED },
      children: createElement(RunStream, {
        messages: fixture.messages,
        events: fixture.runEvents,
        showToolCalls: false,
        showSystem: true,
        selectedNodeId: args.selectedNodeId ?? 'all',
        usage: fixture.usage,
        logEntries: fixture.logEntries,
        selectedLogRowId: args.selectedLogRowId ?? null,
        onSelectLogRow: args.onSelectLogRow ?? ((): void => undefined),
      }),
    })
  );
}

function dividerIds(markup: string): string[] {
  return [...markup.matchAll(/id="node-transition-([^"]+)"/g)].map(match => match[1] ?? '');
}

describe('RunStream selectable unmerged log rows', () => {
  test('ordinary, two-iteration, and two-route rows render as five chronological dividers', () => {
    const markup = renderStreamMarkup({});
    expect(dividerIds(markup)).toEqual([
      'plan-start',
      'loop-i1-start',
      'route-1',
      'route-2',
      'loop-i2-start',
    ]);
    expect(markup).toContain('Plan');
    expect(markup).toContain('Loop ×1');
    expect(markup).toContain('Router #1');
    expect(markup).toContain('Router #2');
    expect(markup).toContain('Loop ×2');
    expect(markup).toContain('data-execution-row-id="plan-start"');
    expect(markup).toContain('completed');
    expect(markup).toContain('00:01');
    expect(markup).toContain('2t');
    expect(markup).toContain('end_turn');
  });

  test('filtering to one node hides other node rows and messages; All nodes restores them', () => {
    const filtered = renderStreamMarkup({ selectedNodeId: 'plan' });
    expect(dividerIds(filtered)).toEqual(['plan-start']);
    expect(filtered).toContain('data-execution-row-id="plan-start"');
    expect(filtered).not.toContain('Loop ×1');
    expect(filtered).not.toContain('Router #1');
    expect(filtered).not.toContain('router output');

    const restored = renderStreamMarkup({ selectedNodeId: 'all' });
    expect(dividerIds(restored)).toHaveLength(5);
    expect(restored).toContain('Loop ×2');
    expect(restored).not.toContain('plan output');
    expect(restored).not.toContain('router output');
  });

  test('cumulative node usage renders only on the showNodeUsage row', () => {
    const markup = renderStreamMarkup({});
    const loopOne = markup.slice(
      markup.indexOf('id="node-transition-loop-i1-start"'),
      markup.indexOf('id="node-transition-route-1"')
    );
    const loopTwo = markup.slice(markup.indexOf('id="node-transition-loop-i2-start"'));
    expect(loopOne).toContain('Loop ×1');
    expect(loopOne).not.toContain('$1.25');
    expect(loopOne).not.toContain('Show usage breakdown for this node');
    expect(loopTwo).toContain('Loop ×2');
    expect(loopTwo).toContain('$1.25');
    expect(loopTwo).toContain('Show usage breakdown for this node');
  });
});

describe('RunStream exact execution sections', () => {
  test('renders one section per log entry with only that entry body', () => {
    const fixture = fiveDividerFixture();
    const markup = renderToStaticMarkup(
      createElement(StreamContextProvider, {
        value: { runStartedAt: RUN_STARTED },
        children: createElement(RunStream, {
          messages: fixture.messages,
          events: fixture.runEvents,
          showToolCalls: false,
          showSystem: false,
          selectedNodeId: 'all',
          usage: fixture.usage,
          logEntries: fixture.logEntries,
          renderExecutionBody: (entry): ReactElement =>
            createElement('div', { 'data-testid': `body-${entry.row.id}` }, entry.row.id),
        }),
      })
    );
    const ids = [...markup.matchAll(/data-execution-row-id="([^"]+)"/g)].map(
      match => match[1] ?? ''
    );
    expect(ids).toEqual(['plan-start', 'loop-i1-start', 'route-1', 'route-2', 'loop-i2-start']);
    const planStart = markup.indexOf('data-execution-row-id="plan-start"');
    const loopStart = markup.indexOf('data-execution-row-id="loop-i1-start"');
    const planSection = markup.slice(planStart, loopStart);
    expect(planSection).toContain('data-testid="body-plan-start"');
    expect(planSection).not.toContain('data-testid="body-loop-i1-start"');
    expect(planSection).not.toContain('plan output');
    expect(planSection).not.toContain('router output');
    const loopSection = markup.slice(loopStart, markup.indexOf('data-execution-row-id="route-1"'));
    expect(loopSection).toContain('data-testid="body-loop-i1-start"');
    expect(loopSection).not.toContain('data-testid="body-plan-start"');
  });
});

describe('RunStream row selection', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  test('choosing a row reports its row id and node id', async () => {
    const fixture = fiveDividerFixture();
    const selected: [string, string][] = [];
    await act(async () => {
      root.render(
        createElement(StreamContextProvider, {
          value: { runStartedAt: RUN_STARTED },
          children: createElement(RunStream, {
            messages: fixture.messages,
            events: fixture.runEvents,
            showToolCalls: false,
            showSystem: false,
            selectedNodeId: 'all',
            usage: fixture.usage,
            logEntries: fixture.logEntries,
            selectedLogRowId: 'route-1',
            onSelectLogRow: (rowId: string, nodeId: string): void => {
              selected.push([rowId, nodeId]);
            },
          }),
        })
      );
    });

    const routeOne = host.querySelector('#node-transition-route-1');
    if (!(routeOne instanceof HTMLElement)) {
      throw new Error('route-1 row');
    }
    expect(routeOne.querySelector('[aria-current="true"]')).not.toBeNull();
    const identity = routeOne.querySelector('button');
    if (!(identity instanceof HTMLButtonElement)) {
      throw new Error('route-1 identity');
    }
    await act(async () => {
      identity.click();
    });
    expect(selected).toEqual([['route-1', 'router']]);
  });
});
