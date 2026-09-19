import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
} from '@xyflow/react';
import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import type { DagNodeState, RuntimeNodeMetadata } from '@/lib/types';
import type { DagNode } from '@/lib/api';
import { formatDurationMs } from '@/lib/format';
import { buildWorkflowDagViewModel } from './build-workflow-dag-view-model';
import { executionDagNode, formatRuntimeMetadata } from './ExecutionDagNode';
import { RunGraphRouteEdge } from './RunGraphRouteEdge';

import '@xyflow/react/dist/style.css';

// Defined at module scope — prevents ReactFlow from remounting nodes/edges on every render
const nodeTypes: NodeTypes = { executionNode: executionDagNode };
const edgeTypes: EdgeTypes = { runGraphRoute: RunGraphRouteEdge };

interface WorkflowDagViewerProps {
  dagNodes: readonly DagNode[];
  liveStatus: readonly DagNodeState[];
  isRunning: boolean;
  currentlyExecuting?: { nodeName: string; startedAt: number } & RuntimeNodeMetadata;
  selectedNodeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
}

export function WorkflowDagViewer({
  dagNodes,
  liveStatus,
  isRunning,
  currentlyExecuting,
  selectedNodeId,
  onNodeClick,
}: WorkflowDagViewerProps): React.ReactElement {
  const { nodes, edges } = useMemo(
    () =>
      buildWorkflowDagViewModel({
        dagNodes,
        liveStatus,
        selectedNodeId: selectedNodeId ?? null,
      }),
    [dagNodes, liveStatus, selectedNodeId]
  );

  const executingMetadata = currentlyExecuting ? formatRuntimeMetadata(currentlyExecuting) : null;

  return (
    <div className="h-full w-full relative">
      {isRunning && currentlyExecuting && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md bg-surface/90 backdrop-blur-sm border border-border px-3 py-1.5 text-xs">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-bright animate-pulse" />
          <span className="text-text-secondary">Executing:</span>
          <span className="font-medium text-text-primary">{currentlyExecuting.nodeName}</span>
          {executingMetadata && (
            <span className="max-w-[220px] truncate text-text-secondary" title={executingMetadata}>
              {executingMetadata}
            </span>
          )}
          <span className="text-text-tertiary">
            {formatDurationMs(Date.now() - currentlyExecuting.startedAt)}
          </span>
        </div>
      )}
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          onNodeClick={
            onNodeClick
              ? (_event, node): void => {
                  onNodeClick(node.id);
                }
              : undefined
          }
          fitView
          fitViewOptions={{ padding: 0.15 }}
          panOnDrag
          zoomOnScroll
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
          <Controls showInteractive={false} className="!bg-surface !border-border" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
