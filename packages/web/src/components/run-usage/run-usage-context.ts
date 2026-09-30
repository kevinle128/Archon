import { createContext, useContext } from 'react';

import type { RunDetailUsage } from '@/lib/settings/usage';

export interface RunUsageValue {
  /** Direct-run usage grouped by node. `null` means the usage query failed. */
  usage: RunDetailUsage;
  /** Older run total from run metadata, used only when the ledger has nothing. */
  legacyCostUsd: number | null;
}

/**
 * Carries the run's usage report down to the node room without threading props
 * through every intermediate pane. `undefined` means no run supplied usage, so
 * usage UI stays hidden.
 */
export const runUsageContext = createContext<RunUsageValue | undefined>(undefined);

export function useRunUsage(): RunUsageValue | undefined {
  return useContext(runUsageContext);
}
