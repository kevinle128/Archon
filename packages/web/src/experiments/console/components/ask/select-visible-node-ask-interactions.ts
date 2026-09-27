import type { PendingInteraction, WorkflowNodeMessage } from '../../skills/runs';
import type { LogRowSelection } from '../inspect/build-log-rows';

function collectToolIds(messages: readonly WorkflowNodeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

function sortedBySeq(messages: readonly WorkflowNodeMessage[]): WorkflowNodeMessage[] {
  return [...messages].sort((left, right) => left.seq - right.seq);
}

function visibleReachesTranscriptTail(
  allMessages: readonly WorkflowNodeMessage[],
  visibleMessages: readonly WorkflowNodeMessage[]
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
  allMessages: readonly WorkflowNodeMessage[];
  visibleMessages: readonly WorkflowNodeMessage[];
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
