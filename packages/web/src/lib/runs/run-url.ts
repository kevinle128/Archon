/**
 * URLs of the Runs workspace: `/runs`, `/runs/:runId`, `/runs/:runId/:nodeId?tab=<tab>`.
 */

/** Tabs that show one node. */
export const NODE_TABS = ['stream', 'history', 'output', 'raw'] as const;
/** Tabs that show the whole run. They stay mounted when the node changes. */
export const RUN_TABS = [
  'changes',
  'files',
  'terminal',
  'artifacts',
  'logs',
  'conversation',
] as const;

export type NodeTab = (typeof NODE_TABS)[number];
export type RunTab = (typeof RUN_TABS)[number];
export type NodeColumnTab = NodeTab | RunTab;

export const DEFAULT_NODE_COLUMN_TAB: NodeColumnTab = 'stream';

/** Runs list tabs. */
export const RUN_LIST_FILTERS = ['active', 'needs', 'finished', 'all'] as const;
export type RunListFilter = (typeof RUN_LIST_FILTERS)[number];
export const DEFAULT_RUN_LIST_FILTER: RunListFilter = 'active';

export function isRunTab(tab: NodeColumnTab): tab is RunTab {
  return (RUN_TABS as readonly string[]).includes(tab);
}

/** Reads the `tab` query value. An unknown or missing value is the live stream tab. */
export function parseNodeColumnTab(value: string | null): NodeColumnTab {
  if (value === null) return DEFAULT_NODE_COLUMN_TAB;
  const all: readonly string[] = [...NODE_TABS, ...RUN_TABS];
  return all.includes(value) ? (value as NodeColumnTab) : DEFAULT_NODE_COLUMN_TAB;
}

/** Path of a run, optionally of one node and one tab. The default tab is not written. */
export function buildRunPath(runId: string, nodeId?: string | null, tab?: NodeColumnTab): string {
  const nodePart = nodeId ? `/${encodeURIComponent(nodeId)}` : '';
  const tabPart = tab !== undefined && tab !== DEFAULT_NODE_COLUMN_TAB ? `?tab=${tab}` : '';
  return `/runs/${encodeURIComponent(runId)}${nodePart}${tabPart}`;
}

/** Reads the `filter` query value. An unknown or missing value is the default filter. */
export function parseRunListFilter(value: string | null): RunListFilter {
  return value !== null && (RUN_LIST_FILTERS as readonly string[]).includes(value)
    ? (value as RunListFilter)
    : DEFAULT_RUN_LIST_FILTER;
}

/** Maps an old Dashboard `status` filter to the Runs list tab that contains it. */
export function filterFromLegacyStatus(status: string): RunListFilter {
  switch (status) {
    case 'running':
      return 'active';
    case 'paused':
      return 'needs';
    case 'completed':
    case 'failed':
      return 'finished';
    default:
      return 'all';
  }
}

/** Target of an old run detail link `/workflows/runs/:runId?node=<id>`. */
export function legacyRunTarget(runId: string, search: string): string {
  const node = new URLSearchParams(search).get('node');
  return buildRunPath(runId, node);
}

/** Query keys of the runs list. They travel with every Runs workspace link. */
const LIST_PARAM_KEYS = ['filter', 'range', 'q'] as const;

/** Adds the current runs list filters to a Runs workspace path. The path's own query wins. */
export function keepListParams(path: string, current: URLSearchParams): string {
  const [pathname, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  for (const key of LIST_PARAM_KEYS) {
    const value = current.get(key);
    if (value !== null && !params.has(key)) params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? (pathname ?? path) : `${pathname ?? path}?${text}`;
}
