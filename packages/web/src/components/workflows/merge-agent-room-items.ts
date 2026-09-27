/**
 * Loop-safe Ask selection and ordered merge of transcript messages with Ask cards.
 */
import type { PendingInteraction, WorkflowNodeMessageResponse } from '@/lib/api';

import type { LogRowSelection } from './build-log-rows';

export const UNSCOPED_INTERACTION_LIMITATION =
  'Execution scope was not recorded for this interaction.';

export type AgentRoomItem =
  | { kind: 'message'; id: string; message: WorkflowNodeMessageResponse }
  | { kind: 'ask'; id: string; interaction: PendingInteraction };

function collectToolIds(messages: readonly WorkflowNodeMessageResponse[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

function sortedBySeq(
  messages: readonly WorkflowNodeMessageResponse[]
): WorkflowNodeMessageResponse[] {
  return [...messages].sort((left, right) => left.seq - right.seq);
}

function visibleReachesTranscriptTail(
  allMessages: readonly WorkflowNodeMessageResponse[],
  visibleMessages: readonly WorkflowNodeMessageResponse[]
): boolean {
  const full = sortedBySeq(allMessages);
  if (full.length === 0) {
    return true;
  }
  const visible = sortedBySeq(visibleMessages);
  if (visible.length === 0) {
    return false;
  }
  return visible[visible.length - 1].id === full[full.length - 1].id;
}

export function selectVisibleNodeAskInteractions(input: {
  pending: readonly PendingInteraction[];
  nodeId: string;
  selection: LogRowSelection;
  allMessages: readonly WorkflowNodeMessageResponse[];
  visibleMessages: readonly WorkflowNodeMessageResponse[];
  ownsUnscopedInteractions: boolean;
}): PendingInteraction[] {
  const allToolIds = collectToolIds(input.allMessages);
  const visibleToolIds = collectToolIds(input.visibleMessages);
  const atTail = visibleReachesTranscriptTail(input.allMessages, input.visibleMessages);

  const selected: PendingInteraction[] = [];
  for (const interaction of input.pending) {
    if (interaction.kind !== 'ask') {
      continue;
    }
    if (interaction.node_id !== input.nodeId) {
      continue;
    }
    if (interaction.status !== 'pending' && interaction.status !== 'answered') {
      continue;
    }
    if (interaction.execution_scope == null && !input.ownsUnscopedInteractions) {
      continue;
    }
    // Occurrence-scoped only (CAP-6): an ask raised during one provider turn
    // of a steered node belongs to the whole occurrence, not one attempt.
    if (
      interaction.execution_scope != null &&
      (input.selection.kind !== 'occurrence' ||
        interaction.execution_scope.occurrence_id !== input.selection.occurrenceId)
    ) {
      continue;
    }
    const anchored = allToolIds.has(interaction.tool_use_id);
    if (anchored) {
      if (!visibleToolIds.has(interaction.tool_use_id)) {
        continue;
      }
    } else if (!atTail) {
      continue;
    }
    selected.push(interaction);
  }
  return selected;
}

export function mergeAgentRoomItems(
  visibleMessages: readonly WorkflowNodeMessageResponse[],
  interactions: readonly PendingInteraction[]
): AgentRoomItem[] {
  const items: AgentRoomItem[] = [];
  const placed = new Set<string>();

  for (const message of sortedBySeq(visibleMessages)) {
    items.push({ kind: 'message', id: message.id, message });
    if (message.kind !== 'tool') {
      continue;
    }
    const toolId = message.payload.id;
    for (const interaction of interactions) {
      if (placed.has(interaction.id) || interaction.tool_use_id !== toolId) {
        continue;
      }
      placed.add(interaction.id);
      items.push({ kind: 'ask', id: `ask:${interaction.id}`, interaction });
    }
  }

  for (const interaction of interactions) {
    if (placed.has(interaction.id)) {
      continue;
    }
    placed.add(interaction.id);
    items.push({ kind: 'ask', id: `ask:${interaction.id}`, interaction });
  }

  return items;
}
