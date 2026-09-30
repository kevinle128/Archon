import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { DagNodeData } from './DagNodeComponent';
import type { RouteLoopDecisionData, RuntimeNodeMetadata, WorkflowStepStatus } from '@/lib/types';
import { formatDurationMs } from '@/lib/format';
import { NODE_HEIGHT, NODE_WIDTH } from '@/lib/run-graph/constants';
import { nodeStatusLabel } from './awaiting-chrome';
import { StatusIcon } from './StatusIcon';

export interface ExecutionNodeData extends DagNodeData, RuntimeNodeMetadata {
  status?: WorkflowStepStatus;
  duration?: number;
  error?: string;
  selected?: boolean;
  currentIteration?: number;
  maxIterations?: number;
  expectedIterations?: number;
  routeDecision?: RouteLoopDecisionData | Record<string, unknown>;
  openerId?: string;
}

export type ExecutionFlowNode = Node<ExecutionNodeData>;

const STATUS_STYLES: Partial<Record<WorkflowStepStatus, string>> = {
  completed: 'border-l-2 border-success bg-success/5',
  running: 'border-l-2 border-accent-bright bg-accent/5 shadow-[0_0_8px_var(--accent)]',
  awaiting: 'border-l-2 border-warning bg-warning/5 animate-pulse motion-reduce:animate-none',
  failed: 'border-l-2 border-error bg-error/5',
  skipped: 'opacity-50 border-l-2 border-border',
};
const DEFAULT_STYLE = 'border-l-2 border-border bg-surface-elevated';

const TYPE_COLORS: Record<string, string> = {
  command: 'text-node-command',
  prompt: 'text-accent-bright',
  bash: 'text-node-bash',
  loop: 'text-node-loop',
  route_loop: 'text-node-loop',
  approval: 'text-node-approval',
  plannotator_gate: 'text-node-approval',
  cancel: 'text-error',
};

const TYPE_LABELS: Record<string, string> = {
  command: 'CMD',
  bash: 'BASH',
  prompt: 'PROMPT',
  loop: 'LOOP',
  route_loop: 'ROUTE',
  approval: 'APPROVAL',
  plannotator_gate: 'REVIEW',
  cancel: 'CANCEL',
};

function formatRouteDecisionField(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function formatThinkingMetadata(thinking: RuntimeNodeMetadata['thinking']): string | null {
  if (!thinking) return null;
  if (thinking.type === 'enabled' && thinking.budgetTokens !== undefined) {
    return `${thinking.type} ${String(thinking.budgetTokens)}`;
  }
  return thinking.type;
}

export function formatRuntimeMetadata(metadata: RuntimeNodeMetadata): string | null {
  if (!metadata.provider) return null;
  const modelOrTier = metadata.model ?? metadata.tier;
  const reasoning =
    metadata.modelReasoningEffort ?? metadata.effort ?? formatThinkingMetadata(metadata.thinking);
  return [metadata.provider, modelOrTier, reasoning].filter(Boolean).join(' - ');
}

function ExecutionDagNodeRender({ data }: NodeProps<ExecutionFlowNode>): React.ReactElement {
  const style = (data.status && STATUS_STYLES[data.status]) ?? DEFAULT_STYLE;
  const typeLabel = TYPE_LABELS[data.nodeType] ?? 'PROMPT';
  const routeOutcome = formatRouteDecisionField(data.routeDecision?.outcome, 'route');
  const routeTarget = formatRouteDecisionField(data.routeDecision?.to, '');
  const runtimeMetadata = formatRuntimeMetadata({
    provider: data.provider,
    model: data.model,
    tier: data.tier,
    modelReasoningEffort: data.modelReasoningEffort,
    effort: data.effort,
    thinking: data.thinking,
  });

  return (
    <div
      id={data.openerId}
      tabIndex={-1}
      className={`rounded-lg border border-border px-3 py-2 transition-all duration-300 ${style}${data.selected ? ' ring-2 ring-accent-bright' : ''}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <StatusIcon status={data.status ?? 'pending'} />
        <span
          className={`text-[length:var(--rv-node-kind-size)] font-medium ${TYPE_COLORS[data.nodeType] ?? 'text-text-tertiary'}`}
        >
          {typeLabel}
        </span>
        <span className="text-[length:var(--rv-node-label-size)] font-medium text-text-primary truncate max-w-[100px]">
          {data.label}
        </span>
        {data.duration !== undefined && (
          <span className="text-[length:var(--rv-node-meta-size)] text-text-tertiary ml-auto shrink-0">
            {formatDurationMs(data.duration)}
          </span>
        )}
      </div>
      {data.status === 'awaiting' && (
        <div className="mt-0.5 text-[length:var(--rv-node-meta-size)] text-warning">
          {nodeStatusLabel('awaiting')}
        </div>
      )}
      {data.currentIteration !== undefined && data.maxIterations !== undefined && (
        <div className="text-[length:var(--rv-node-meta-size)] text-text-tertiary mt-0.5">
          {data.expectedIterations !== undefined
            ? `${data.currentIteration}/${data.expectedIterations} (max ${data.maxIterations})`
            : `${data.currentIteration}/${data.maxIterations} iterations`}
        </div>
      )}
      {runtimeMetadata && (
        <div
          className="mx-auto mt-0.5 w-full max-w-[190px] truncate text-center text-[length:var(--rv-node-meta-size)] text-text-secondary"
          title={runtimeMetadata}
        >
          {runtimeMetadata}
        </div>
      )}
      {data.routeDecision && (
        <div className="text-[length:var(--rv-node-meta-size)] text-text-tertiary mt-0.5 truncate">
          {routeOutcome} {'->'} {routeTarget}
        </div>
      )}
      {data.error && (
        <div
          className="text-[length:var(--rv-node-meta-size)] text-error mt-1 truncate"
          title={data.error}
        >
          {data.error.slice(0, 60)}
        </div>
      )}
      {data.nodeType === 'route_loop' ? (
        <>
          <Handle
            id="positive"
            type="source"
            position={Position.Bottom}
            className="!bg-success !w-2 !h-2"
            style={{ left: '25%' }}
          />
          <Handle
            id="negative"
            type="source"
            position={Position.Bottom}
            className="!bg-accent !w-2 !h-2"
            style={{ left: '50%' }}
          />
          <Handle
            id="exhausted"
            type="source"
            position={Position.Bottom}
            className="!bg-error !w-2 !h-2"
            style={{ left: '75%' }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2" />
      )}
    </div>
  );
}

export const executionDagNode = memo(ExecutionDagNodeRender);
