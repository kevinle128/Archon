/**
 * Group projected agent history items by execution occurrence and compose the
 * canonical Run/Iteration labels. Pure: one pass in transcript sequence order,
 * no React, DOM, shell tokens, provider branches, parsing, or network access.
 */
import type { AgentHistoryItem, TranscriptExecution } from './agent-history';

export interface OccurrenceGroup {
  key: string;
  label: string;
  items: readonly AgentHistoryItem[];
  iteration: number | null;
  retryEpoch: number;
  failed: boolean;
}

export interface OccurrenceGrouping {
  prefixItems: readonly AgentHistoryItem[];
  groups: readonly OccurrenceGroup[];
  showHeaders: boolean;
}

interface GroupDraft {
  key: string;
  execution: TranscriptExecution;
  items: AgentHistoryItem[];
  failed: boolean;
}

interface GroupFacts {
  base: string;
  iteration: number | null;
  retryEpoch: number;
  ancestryPath: string | null;
}

function factsOf(draft: GroupDraft): GroupFacts {
  const execution = draft.execution;
  const ancestry = execution.loop_ancestry;
  const last = ancestry?.[ancestry.length - 1];
  const retryEpoch = execution.retry_epoch ?? 0;
  return {
    base: last !== undefined ? `Iteration ${last.iteration}` : `Run ${retryEpoch + 1}`,
    iteration: last?.iteration ?? null,
    retryEpoch,
    ancestryPath:
      ancestry !== undefined && ancestry.length >= 2
        ? ancestry.map(entry => `Iteration ${entry.iteration}`).join(' › ')
        : null,
  };
}

function reasonSuffix(draft: GroupDraft, facts: GroupFacts): string {
  if (facts.iteration !== null) return '';
  return `${facts.retryEpoch > 0 ? ' · retry' : ''}${draft.failed ? ' · failed' : ''}`;
}

/** Index sets that still share one label — the candidates needing another qualifier. */
function tiedIndexSets(values: readonly string[]): number[][] {
  const byValue = new Map<string, number[]>();
  values.forEach((value, index) => {
    const bucket = byValue.get(value);
    if (bucket === undefined) {
      byValue.set(value, [index]);
    } else {
      bucket.push(index);
    }
  });
  return [...byValue.values()].filter(bucket => bucket.length > 1);
}

/** The nearest (leaf-most) ancestry depth whose node_ids differ inside a tied set, or null. */
function differingAncestryNodeIds(
  drafts: readonly GroupDraft[],
  tied: readonly number[]
): Map<number, string> | null {
  const ancestries = tied.map(index => drafts[index]?.execution.loop_ancestry ?? []);
  const maxDepth = Math.max(...ancestries.map(ancestry => ancestry.length));
  for (let depth = maxDepth - 1; depth >= 0; depth--) {
    const ids = ancestries.map(ancestry => ancestry[depth]?.node_id);
    if (new Set(ids).size <= 1) continue;
    const resolved = new Map<number, string>();
    tied.forEach((draftIndex, position) => {
      const id = ids[position];
      if (id !== undefined) resolved.set(draftIndex, id);
    });
    return resolved;
  }
  return null;
}

/**
 * B4 disambiguation: inside a maximal same-base-label set, each group takes the
 * first qualifier that makes it unique — ` #N` route activations, the root→leaf
 * iteration path, the nearest differing ancestry node_id, then `· occurrence K`.
 */
function qualifiedBases(drafts: readonly GroupDraft[], facts: readonly GroupFacts[]): string[] {
  if (drafts.length === 1) {
    return [facts[0]?.base ?? ''];
  }

  const sequences = drafts.map(draft => draft.execution.route_activation_seq);
  if (
    sequences.every(seq => typeof seq === 'number') &&
    new Set(sequences).size === drafts.length
  ) {
    return drafts.map(
      (draft, index) =>
        `${facts[index]?.base ?? ''} #${String(draft.execution.route_activation_seq)}`
    );
  }

  const resolved = facts.map(factsEntry => factsEntry.ancestryPath ?? factsEntry.base);
  for (const tied of tiedIndexSets(resolved)) {
    const nodeIds = differingAncestryNodeIds(drafts, tied);
    if (nodeIds === null) continue;
    for (const index of tied) {
      const nodeId = nodeIds.get(index);
      if (nodeId !== undefined) resolved[index] = `${resolved[index]} · ${nodeId}`;
    }
  }
  for (const tied of tiedIndexSets(resolved)) {
    for (const index of tied) {
      const order = index + 1;
      if (order > 1) resolved[index] = `${resolved[index]} · occurrence ${String(order)}`;
    }
  }
  return resolved;
}

export function groupByOccurrence(items: readonly AgentHistoryItem[]): OccurrenceGrouping {
  const prefixItems: AgentHistoryItem[] = [];
  const drafts: GroupDraft[] = [];
  const byKey = new Map<string, GroupDraft>();
  let current: GroupDraft | undefined;

  for (const item of items) {
    const execution = item.execution;
    if (execution === null) {
      if (current === undefined) {
        prefixItems.push(item);
      } else {
        current.items.push(item);
      }
      continue;
    }
    const key = execution.occurrence_id;
    let draft = byKey.get(key);
    if (draft === undefined) {
      draft = { key, execution, items: [], failed: false };
      byKey.set(key, draft);
      drafts.push(draft);
    }
    draft.items.push(item);
    if (item.kind === 'lifecycle' && item.state === 'failed') draft.failed = true;
    current = draft;
  }

  const facts = drafts.map(factsOf);
  const sets = new Map<string, number[]>();
  facts.forEach((factsEntry, index) => {
    const bucket = sets.get(factsEntry.base);
    if (bucket === undefined) {
      sets.set(factsEntry.base, [index]);
    } else {
      bucket.push(index);
    }
  });

  const qualified = new Array<string>(drafts.length);
  for (const indices of sets.values()) {
    const bases = qualifiedBases(
      indices.map(index => drafts[index]),
      indices.map(index => facts[index])
    );
    indices.forEach((draftIndex, position) => {
      qualified[draftIndex] = bases[position] ?? '';
    });
  }

  const groups: OccurrenceGroup[] = drafts.map((draft, index) => {
    const factsEntry = facts[index];
    return {
      key: draft.key,
      label: `${qualified[index] ?? factsEntry.base}${reasonSuffix(draft, factsEntry)}`,
      items: draft.items,
      iteration: factsEntry.iteration,
      retryEpoch: factsEntry.retryEpoch,
      failed: draft.failed,
    };
  });

  return { prefixItems, groups, showHeaders: groups.length >= 2 };
}
