import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { listCodebases } from '@/lib/api';
import { settingsKeys } from '@/lib/settings/query-keys';
import { buildUsageSearchParams, getUsageReport } from '@/lib/settings/usage';
import type {
  UsageGroupBy,
  UsageKindFilter,
  UsageMetrics,
  UsageReport,
  UsageReportGroup,
} from '@/lib/settings/usage';
import {
  USAGE_GROUP_OPTIONS,
  USAGE_KIND_OPTIONS,
  costFiltersToQuery,
  defaultCostFilters,
  describeUsageState,
  eventOnlyUsageMessage,
  fmtTok,
  formatMissingMeasures,
  formatUsdAmount,
  groupLabel,
  type CostFilters,
} from '@/lib/settings/usage-view';
import {
  Btn,
  Field,
  HelpText,
  InlineError,
  LoadingLine,
  MONO_CONTROL_CLASS,
  SelectInput,
  SettingsSection,
  TextInput,
} from './primitives';

/** Run-detail route for a run group; deleted projects and unknown runs stay unlinked. */
function runHref(group: UsageReportGroup): string | null {
  const runId = group.dimensions.runId;
  if (runId === undefined || runId === '') return null;
  return `/workflows/runs/${encodeURIComponent(runId)}`;
}

const TH = 'whitespace-nowrap px-2.5 py-2 text-xs font-medium text-text-secondary';
const TD = 'px-2.5 py-2.5 text-right font-mono text-xs tabular-nums text-text-secondary';

function MetricCells({ m }: { m: UsageMetrics }): ReactElement {
  return (
    <>
      <td className={TD}>{fmtTok(m.requests)}</td>
      <td className={TD}>{fmtTok(m.tokensInput)}</td>
      <td className={TD}>{fmtTok(m.tokensOutput)}</td>
      <td className={TD}>{formatUsdAmount(m.reportedUsd, false)}</td>
      <td className={TD}>{formatUsdAmount(m.estimatedUsd, true)}</td>
      <td className={`${TD} text-text-tertiary`} title="Rows with no reported or estimated USD">
        {String(m.rowsMissingUsd)}
      </td>
    </>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'info';
  title: string;
  children: string;
}): ReactElement {
  return (
    <div
      role="status"
      className={`rounded-xl border bg-surface p-4 ${tone === 'warn' ? 'border-warning' : 'border-border'}`}
    >
      <p
        className={`text-sm font-medium ${tone === 'warn' ? 'text-warning' : 'text-text-primary'}`}
      >
        {title}
      </p>
      <p className="mt-1 text-sm text-text-secondary">{children}</p>
    </div>
  );
}

/**
 * Usage table for one report. Reported and estimated USD stay in separate columns
 * and are never summed; states (unavailable, never recorded, event-only, filter
 * miss, data) are distinct so missing data never reads as a known $0.00.
 */
function UsageTable({
  report,
  unavailable,
}: {
  report: UsageReport | null;
  unavailable: boolean;
}): ReactElement {
  const state = describeUsageState(report, unavailable);
  if (state === 'unavailable' || report === null) {
    return (
      <Notice tone="warn" title="Usage report unavailable">
        The usage query failed. This is not zero cost. Try Refresh later.
      </Notice>
    );
  }
  if (state === 'not-recorded') {
    return (
      <Notice tone="info" title="No usage recorded">
        No workflow AI usage events in this scope. That is not the same as a known $0.00 cost.
      </Notice>
    );
  }
  const { coverage } = report;
  if (state === 'event-only') {
    return (
      <Notice tone="warn" title="Incomplete usage coverage">
        {eventOnlyUsageMessage(coverage)}
      </Notice>
    );
  }
  const unledgered =
    coverage.unledgeredEventCount > 0 ? (
      <Notice tone="warn" title="Some usage events lack ledger rows">
        {`${String(coverage.unledgeredEventCount)} usage event${coverage.unledgeredEventCount === 1 ? '' : 's'} lack ledger rows (event-only fallback). Totals under-count until those rows are repaired.`}
      </Notice>
    ) : null;
  if (state === 'filter-empty') {
    return (
      <div className="grid gap-3">
        {unledgered}
        <Notice tone="info" title="No groups matched filters">
          Provider, model or kind filters matched no ledger rows. This is not missing usage.
        </Notice>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {unledgered}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>
                {USAGE_GROUP_OPTIONS.find(o => o.value === report.groupBy)?.label ?? 'Group'}
              </th>
              <th className={`${TH} text-right`}>Requests</th>
              <th className={`${TH} text-right`}>Input tokens</th>
              <th className={`${TH} text-right`}>Output tokens</th>
              <th className={`${TH} text-right`}>Reported USD</th>
              <th className={`${TH} text-right`}>Estimated USD</th>
              <th className={`${TH} text-right`}>Unpriced</th>
            </tr>
          </thead>
          <tbody>
            {report.groups.map((g, i) => {
              const label = groupLabel(g, report.groupBy);
              const href = report.groupBy === 'run' ? runHref(g) : null;
              return (
                <tr key={`${label}:${String(i)}`} className="border-b border-border">
                  <td className="px-2.5 py-2.5 font-mono text-xs text-text-primary">
                    {href ? (
                      <Link to={href} className="text-accent underline-offset-2 hover:underline">
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </td>
                  <MetricCells m={g.metrics} />
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className="px-2.5 py-2.5 text-text-primary">Totals</td>
              <MetricCells m={report.totals} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="font-mono text-xs tabular-nums text-text-tertiary">
        Ledger coverage {String(coverage.ledgeredEventCount)}/{String(coverage.usageEventCount)}{' '}
        ledgered &middot; missing measures {formatMissingMeasures(report.totals)}
      </p>
    </div>
  );
}

/**
 * Installation usage and cost. Direct workflow AI usage only, no SSE; dates are UTC
 * calendar days. Draft edits apply on Apply; Refresh re-fetches the applied query.
 */
export function UsageSection(): ReactElement {
  const [draft, setDraft] = useState<CostFilters>(() => defaultCostFilters());
  const [applied, setApplied] = useState<CostFilters>(() => defaultCostFilters());
  const [localError, setLocalError] = useState<string | null>(null);

  const queryOrError = useMemo(() => costFiltersToQuery(applied), [applied]);
  const query = 'error' in queryOrError ? null : queryOrError;
  const appliedError = 'error' in queryOrError ? queryOrError.error : null;

  const {
    data: report,
    error: fetchError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: settingsKeys.usage(query ? buildUsageSearchParams(query).toString() : 'invalid'),
    queryFn: () =>
      query ? getUsageReport(query) : Promise.reject(new Error('Invalid usage filters')),
    enabled: query !== null,
    retry: false,
  });

  const { data: projects } = useQuery({ queryKey: settingsKeys.codebases, queryFn: listCodebases });

  const patch = <K extends keyof CostFilters>(key: K, value: CostFilters[K]): void => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const apply = (): void => {
    const next = costFiltersToQuery(draft);
    if ('error' in next) {
      setLocalError(next.error);
      return;
    }
    setLocalError(null);
    setApplied(draft);
  };

  const refresh = (): void => {
    const next = costFiltersToQuery(draft);
    if ('error' in next) {
      setLocalError(next.error);
      return;
    }
    setLocalError(null);
    setApplied(draft);
    void refetch();
  };

  const displayError = localError ?? appliedError;
  const unavailable = fetchError !== null;

  return (
    <SettingsSection
      id="set-usage"
      title="Usage and cost"
      description="Token usage and spend reported by providers. Estimated USD applies list prices where the provider reports none. Reported and estimated USD are never combined."
    >
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={e => {
          e.preventDefault();
          apply();
        }}
      >
        <Field label="From (UTC)">
          {({ id }) => (
            <TextInput
              id={id}
              type="date"
              className="font-mono"
              value={draft.fromDay}
              onChange={e => {
                patch('fromDay', e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Through (UTC)">
          {({ id }) => (
            <TextInput
              id={id}
              type="date"
              className="font-mono"
              value={draft.throughDay}
              onChange={e => {
                patch('throughDay', e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Group by">
          {({ id }) => (
            <SelectInput
              id={id}
              value={draft.groupBy}
              onChange={e => {
                patch('groupBy', e.target.value as UsageGroupBy);
              }}
            >
              {USAGE_GROUP_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field label="Kind">
          {({ id }) => (
            <SelectInput
              id={id}
              value={draft.kind}
              onChange={e => {
                patch('kind', e.target.value as '' | UsageKindFilter);
              }}
            >
              {USAGE_KIND_OPTIONS.map(o => (
                <option key={o.value || 'any'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field label="Project">
          {({ id }) => (
            <SelectInput
              id={id}
              value={draft.codebaseId}
              onChange={e => {
                patch('codebaseId', e.target.value);
              }}
            >
              <option value="">All projects</option>
              {(projects ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        {(
          [
            ['agentProvider', 'Agent provider', 'any'],
            ['provider', 'Provider', 'any'],
            ['model', 'Model', 'any'],
            ['runId', 'Run ID', 'any'],
            ['nodeId', 'Node ID', 'needs run id'],
          ] as const
        ).map(([key, label, placeholder]) => (
          <Field key={key} label={label}>
            {({ id }) => (
              <TextInput
                id={id}
                className={MONO_CONTROL_CLASS}
                value={draft[key]}
                placeholder={placeholder}
                onChange={e => {
                  patch(key, e.target.value);
                }}
              />
            )}
          </Field>
        ))}
        <div className="flex items-end gap-2">
          <Btn type="submit">Apply</Btn>
          <Btn variant="ghost" aria-label="Refresh usage" onClick={refresh} disabled={isFetching}>
            <RefreshCw aria-hidden strokeWidth={1.75} className="size-4" />
          </Btn>
        </div>
      </form>

      {displayError ? <InlineError>{displayError}</InlineError> : null}
      {unavailable && fetchError instanceof Error ? (
        <HelpText>{fetchError.message}</HelpText>
      ) : null}

      {query === null ? null : report === undefined && !unavailable ? (
        <LoadingLine>Loading usage...</LoadingLine>
      ) : (
        <UsageTable report={unavailable ? null : (report ?? null)} unavailable={unavailable} />
      )}
    </SettingsSection>
  );
}
