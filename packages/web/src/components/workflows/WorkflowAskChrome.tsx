import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import {
  countPendingAsks,
  firstPendingAskAwaitingInteraction,
  isAskAwaitingRun,
  isAskHumanUnsupportedError,
} from './awaiting-chrome';

export interface WorkflowAskChromeProps {
  status: WorkflowRunStatus;
  pendingInteractions: readonly PendingInteraction[];
  nodeStates: readonly WorkflowNodeStateResponse[];
  runError: string | null;
  onSelectAwaitingNode: (nodeId: string, interaction: PendingInteraction) => void;
  onRequestGraphView: () => void;
}

export function WorkflowAskChrome({
  status,
  pendingInteractions,
  nodeStates,
  runError,
  onSelectAwaitingNode,
  onRequestGraphView,
}: WorkflowAskChromeProps): React.ReactElement | null {
  if (status === 'failed' && isAskHumanUnsupportedError(runError)) {
    return (
      <div
        role="alert"
        className="rounded-md border border-error bg-error/10 px-3 py-2 text-sm text-error"
      >
        {runError}
      </div>
    );
  }

  if (!isAskAwaitingRun(status, pendingInteractions)) {
    return null;
  }

  const handleClick = (): void => {
    const interaction = firstPendingAskAwaitingInteraction({
      pending: pendingInteractions,
      nodes: nodeStates,
    });
    if (interaction === null) {
      return;
    }
    onRequestGraphView();
    onSelectAwaitingNode(interaction.node_id, interaction);
  };

  return (
    <button
      type="button"
      aria-live="polite"
      className="cursor-pointer border border-status-waiting bg-card px-2.5 py-1 text-xs font-semibold text-status-waiting hover:bg-selection"
      onClick={handleClick}
    >
      {`Awaiting input (${countPendingAsks(pendingInteractions)})`}
    </button>
  );
}
