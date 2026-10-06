import { RoomPlaceholder, RoomRegion } from './NodeRoom';
import type { ChildRunRef } from './select-room-data';

export interface ChildWorkflowRoomProps {
  nodeId: string;
  child: ChildRunRef;
}

export function ChildWorkflowRoom({ nodeId, child }: ChildWorkflowRoomProps): React.ReactElement {
  const hasContent =
    child.childRunId !== null || child.fanOut || child.output !== null || child.paused;
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium text-text-primary">Child run</h3>
        {child.paused && (
          <p className="rounded border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
            {child.message ?? 'Sub-run is paused awaiting review'}
          </p>
        )}
        {child.fanOut && (
          <p className="text-sm text-text-secondary">This node spawned multiple child runs</p>
        )}
        {child.childRunId !== null && (
          <a
            href={`/workflows/runs/${encodeURIComponent(child.childRunId)}`}
            className="text-sm text-primary hover:underline"
          >
            Open child run
          </a>
        )}
        {child.output !== null && (
          <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-sm text-text-primary">
            {child.output}
          </pre>
        )}
        {!hasContent && <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>}
      </div>
    </RoomRegion>
  );
}
