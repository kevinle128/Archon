/**
 * Place pending Ask and approval interactions on exact log executions.
 * Unscoped items attach only to the latest row for that node.
 */
import type { PendingInteraction } from '../../skills/runs';

import type { ConsoleLogEntry } from './build-console-log-entries';
import type { LogRow } from './build-log-rows';

export const UNSCOPED_INTERACTION_LIMITATION =
  'Execution scope was not recorded for this interaction.';

export interface ExecutionInteractionAssignment {
  interactions: PendingInteraction[];
  showApproval: boolean;
  scopeLimitation: string | null;
}

// Occurrence-scoped only (CAP-6): an ask raised during one provider turn of
// a steered node still belongs to the row projecting the whole occurrence,
// even once that row's own attempt_id has moved on to a later turn.
function matchesScope(
  scope: NonNullable<PendingInteraction['execution_scope']>,
  row: LogRow
): boolean {
  return row.selection.kind === 'occurrence' && scope.occurrence_id === row.selection.occurrenceId;
}

function latestEntryForNode(
  entries: readonly ConsoleLogEntry[],
  nodeId: string
): ConsoleLogEntry | null {
  const matching = entries.filter(entry => entry.row.nodeId === nodeId);
  if (matching.length === 0) return null;
  return matching.reduce((best, entry) => (entry.row.order >= best.row.order ? entry : best));
}

function assignedEntry(
  nodeId: string,
  scope: PendingInteraction['execution_scope'] | undefined,
  allEntries: readonly ConsoleLogEntry[]
): { entry: ConsoleLogEntry; limitation: string | null } | null {
  if (scope !== undefined && scope !== null) {
    const found = allEntries.find(
      candidate => candidate.row.nodeId === nodeId && matchesScope(scope, candidate.row)
    );
    return found === undefined ? null : { entry: found, limitation: null };
  }
  const latest = latestEntryForNode(allEntries, nodeId);
  if (latest === null) return null;
  return { entry: latest, limitation: UNSCOPED_INTERACTION_LIMITATION };
}

export function interactionsForExecution(
  interactions: readonly PendingInteraction[],
  entry: ConsoleLogEntry,
  allEntries: readonly ConsoleLogEntry[],
  approvalNodeId: string | null = null
): ExecutionInteractionAssignment {
  const assignedAsks: PendingInteraction[] = [];
  let limitation: string | null = null;
  let showApproval = false;

  for (const interaction of interactions) {
    if (interaction.node_id !== entry.row.nodeId) continue;
    if (interaction.kind !== 'ask') continue;
    if (interaction.status !== 'pending' && interaction.status !== 'answered') continue;
    const target = assignedEntry(interaction.node_id, interaction.execution_scope, allEntries);
    if (target?.entry.row.id !== entry.row.id) continue;
    if (target.limitation !== null) limitation = target.limitation;
    assignedAsks.push(interaction);
  }

  if (approvalNodeId !== null && approvalNodeId === entry.row.nodeId) {
    const target = assignedEntry(approvalNodeId, undefined, allEntries);
    if (target !== null && target.entry.row.id === entry.row.id) {
      showApproval = true;
      if (target.limitation !== null) limitation = target.limitation;
    }
  }

  return {
    interactions: assignedAsks,
    showApproval,
    scopeLimitation: limitation,
  };
}
