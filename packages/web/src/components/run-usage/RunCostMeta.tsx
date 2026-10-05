import type { ReactElement } from 'react';

import { describeRunCost } from '@/lib/run-usage/run-usage';
import { formatUsdAmount } from '@/lib/settings/usage-view';

import { useRunUsage } from './run-usage-context';

const VALUE_CLASS = 'font-mono font-normal text-text-primary';

/**
 * Run cost for the header metadata row. Reported and estimated USD stay separate;
 * a failed usage query, an event-only ledger and a run with no recorded usage each
 * read differently from a real zero.
 */
export function RunCostMeta(): ReactElement | null {
  const value = useRunUsage();
  if (value === undefined) return null;
  const cost = describeRunCost(value.usage, value.legacyCostUsd);

  switch (cost.kind) {
    case 'unavailable':
      return (
        <span data-testid="run-cost" data-usage-state="unavailable">
          cost{' '}
          <b
            className="font-mono font-normal text-warning"
            title="The usage query failed for this run. This is not zero cost."
          >
            usage unavailable
          </b>
        </span>
      );
    case 'event-only':
      return (
        <span data-testid="run-cost" data-usage-state="event-only">
          cost{' '}
          <b className="font-mono font-normal text-warning" title={cost.message}>
            incomplete · event-only
          </b>
        </span>
      );
    case 'ledger':
      return (
        <span
          data-testid="run-cost"
          data-usage-state="ledger"
          title={cost.incompleteMessage ?? 'Direct-run ledger only, no child run rollup'}
        >
          cost{' '}
          <b className={VALUE_CLASS} title="Provider-reported USD">
            {formatUsdAmount(cost.reportedUsd, false)}
          </b>{' '}
          reported ·{' '}
          <b className={VALUE_CLASS} title="Estimated USD">
            {formatUsdAmount(cost.estimatedUsd, true)}
          </b>{' '}
          estimated
          {cost.incompleteMessage !== null ? (
            <b
              className="ml-2 font-mono font-normal text-warning"
              data-usage-state="partial-unledgered"
            >
              incomplete
            </b>
          ) : null}
        </span>
      );
    case 'legacy':
      return (
        <span
          data-testid="run-cost"
          data-usage-state="legacy"
          title="Legacy run total, not from the usage ledger"
        >
          cost <b className={VALUE_CLASS}>{formatUsdAmount(cost.costUsd, false)}</b> legacy total
        </span>
      );
    case 'not-recorded':
      return (
        <span data-testid="run-cost" data-usage-state="not-recorded">
          cost{' '}
          <b
            className="font-mono font-normal text-text-tertiary"
            title="No usage events were recorded for this run"
          >
            not recorded
          </b>
        </span>
      );
  }
}
