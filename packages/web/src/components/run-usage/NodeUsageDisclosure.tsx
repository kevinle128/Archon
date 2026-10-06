import { useId, useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  collectUsageByNode,
  runWideCoverageMessage,
  usageGroupDetail,
  usageGroupLabel,
} from '@/lib/run-usage/run-usage';
import { fmtTok, formatUsdAmount } from '@/lib/settings/usage-view';
import type { UsageMetrics } from '@/lib/settings/usage';

import { useRunUsage } from './run-usage-context';

const NUMBER_CELL = 'px-2 py-1.5 text-right font-mono tabular-nums';

function MetricCells({ metrics }: { metrics: UsageMetrics }): ReactElement {
  return (
    <>
      <td className={`${NUMBER_CELL} text-text-primary`}>
        {formatUsdAmount(metrics.reportedUsd, false)}
      </td>
      <td className={`${NUMBER_CELL} text-text-primary`}>
        {formatUsdAmount(metrics.estimatedUsd, true)}
      </td>
      <td className={`${NUMBER_CELL} text-text-secondary`}>{fmtTok(metrics.tokensInput)}</td>
      <td className={`${NUMBER_CELL} text-text-secondary`}>{fmtTok(metrics.tokensOutput)}</td>
      <td className={`${NUMBER_CELL} text-text-secondary`}>{fmtTok(metrics.requests)}</td>
    </>
  );
}

/**
 * Quiet "Show usage breakdown" control for one node room. It renders nothing when
 * the run has no ledger usage for the node, so a node that never called a model
 * does not gain empty chrome. Reported and estimated USD stay in separate columns.
 */
export function NodeUsageDisclosure({ nodeId }: { nodeId: string }): ReactElement | null {
  const value = useRunUsage();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const usage = value?.usage ?? null;
  const nodeUsage = useMemo(() => collectUsageByNode(usage).get(nodeId), [usage, nodeId]);

  if (nodeUsage === undefined || usage === null) return null;
  const { groups, aggregate } = nodeUsage;
  const runWide = usage.coverage.unledgeredEventCount > 0 ? usage.coverage : null;

  return (
    <div className="shrink-0 border-b border-border px-8" data-testid="node-usage">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={(): void => {
          setExpanded(open => !open);
        }}
        className="-ml-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[10px] px-2 text-xs text-text-tertiary transition-colors duration-150 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
        )}
        {expanded ? 'Hide usage breakdown' : 'Show usage breakdown'}
        <span className="font-mono tabular-nums" data-testid="node-usage-summary">
          {formatUsdAmount(aggregate.reportedUsd, false)} ·{' '}
          {formatUsdAmount(aggregate.estimatedUsd, true)}
        </span>
      </button>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2 pb-3 pt-1">
          <div className="max-h-64 overflow-auto rounded-xl border border-border bg-surface">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-text-tertiary">
                  <th className="px-3 py-1.5 font-normal">Usage · {nodeId}</th>
                  <th className={`${NUMBER_CELL} font-normal`}>Reported</th>
                  <th className={`${NUMBER_CELL} font-normal`}>Estimated</th>
                  <th className={`${NUMBER_CELL} font-normal`}>In</th>
                  <th className={`${NUMBER_CELL} font-normal`}>Out</th>
                  <th className={`${NUMBER_CELL} font-normal`}>Requests</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, index) => {
                  const detail = usageGroupDetail(group);
                  return (
                    <tr
                      key={`${usageGroupLabel(group)}:${String(index)}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-3 py-1.5 text-text-primary">
                        <span className="break-all font-mono">{usageGroupLabel(group)}</span>
                        {detail !== '' ? (
                          <span className="block text-text-tertiary">{detail}</span>
                        ) : null}
                      </td>
                      <MetricCells metrics={group.metrics} />
                    </tr>
                  );
                })}
                {groups.length > 1 ? (
                  <tr className="border-t border-border font-medium">
                    <td className="px-3 py-1.5 text-text-primary">Node total</td>
                    <MetricCells metrics={aggregate} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {aggregate.rowsMissingUsd > 0 ? (
            <p className="text-xs text-text-tertiary">
              {String(aggregate.rowsMissingUsd)} usage row
              {aggregate.rowsMissingUsd === 1 ? ' has' : 's have'} no USD amount. Totals exclude{' '}
              {aggregate.rowsMissingUsd === 1 ? 'it' : 'them'}.
            </p>
          ) : null}
          {runWide !== null ? (
            <p
              role="status"
              className="text-xs text-warning"
              data-usage-state="run-wide-unledgered"
            >
              {runWideCoverageMessage(runWide)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
