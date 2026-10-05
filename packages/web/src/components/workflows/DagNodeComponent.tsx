import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { DagNode } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface DagNodeData extends DagNode {
  /** For command nodes: the command name. For prompt nodes: display label ("Prompt"). For bash: display label ("Shell"). */
  label: string;
  nodeType:
    | 'command'
    | 'prompt'
    | 'bash'
    | 'loop'
    | 'route_loop'
    | 'approval'
    | 'plannotator_gate'
    | 'cancel';
  promptText?: string;
  bashScript?: string;
  bashTimeout?: number;
  /** Required by React Flow's Node<T> constraint — do not rely on this for typed access. */
  [key: string]: unknown;
}

export type DagFlowNode = Node<DagNodeData>;

const TYPE_CONFIG = {
  command: { kind: 'Command', dot: 'bg-node-command' },
  prompt: { kind: 'Prompt', dot: 'bg-node-prompt' },
  bash: { kind: 'Bash', dot: 'bg-node-bash' },
  loop: { kind: 'Loop', dot: 'bg-node-loop' },
  route_loop: { kind: 'Route', dot: 'bg-node-loop' },
  approval: { kind: 'Approval', dot: 'bg-node-approval' },
  plannotator_gate: { kind: 'Review', dot: 'bg-node-approval' },
  cancel: { kind: 'Cancel', dot: 'bg-error' },
} as const;

export function getContentPreview(data: DagNodeData): string {
  switch (data.nodeType) {
    case 'command':
      return data.label;
    case 'prompt':
    case 'loop':
    case 'route_loop':
      return data.promptText?.split('\n')[0] ?? '';
    case 'bash':
      return data.bashScript?.split('\n')[0] ?? '';
    case 'approval':
      return '';
    case 'plannotator_gate':
      return (
        data.plannotator_gate?.message?.split('\n')[0] ??
        data.plannotator_gate?.document ??
        data.plannotator_gate?.prepare?.prompt.split('\n')[0] ??
        ''
      );
    case 'cancel':
      return data.cancel?.split('\n')[0] ?? '';
  }
}

function MetadataPill({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
      {children}
    </span>
  );
}

// Handles stay quiet: the React Flow tokens in index.css supply the fill and
// ring in both themes, so only the size is set here.
const HANDLE_CLASS = '!size-2.5';

function DagNodeRender({ data, selected }: NodeProps<DagFlowNode>): React.ReactElement {
  const config = TYPE_CONFIG[data.nodeType];
  const preview = getContentPreview(data);
  const hasPills =
    data.model ||
    data.output_format ||
    data.when ||
    (data.trigger_rule && data.trigger_rule !== 'all_success') ||
    (data.skills && data.skills.length > 0) ||
    data.mcp;

  return (
    <div
      className={cn(
        'w-[180px] cursor-pointer rounded-xl border bg-surface px-3 py-2.5 transition-colors duration-200 motion-reduce:transition-none',
        selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-bright'
      )}
    >
      <Handle type="target" position={Position.Top} className={HANDLE_CLASS} />

      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary">
        <span className={cn('size-1.5 shrink-0 rounded-full', config.dot)} aria-hidden="true" />
        <span>{config.kind}</span>
      </div>
      <div className="truncate text-sm font-medium text-text-primary">{data.label}</div>

      {preview && (
        <div className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{preview}</div>
      )}

      {hasPills && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {data.model && <MetadataPill>{data.model}</MetadataPill>}
          {data.output_format && <MetadataPill>{'{}'} JSON</MetadataPill>}
          {data.when && <MetadataPill>when</MetadataPill>}
          {data.trigger_rule && data.trigger_rule !== 'all_success' && (
            <MetadataPill>{data.trigger_rule}</MetadataPill>
          )}
          {data.skills && data.skills.length > 0 && <MetadataPill>skills</MetadataPill>}
          {data.mcp && <MetadataPill>mcp</MetadataPill>}
        </div>
      )}

      {data.nodeType === 'route_loop' && (
        <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[10px] font-medium text-text-tertiary">
          <span className="text-success">pos</span>
          <span className="text-text-secondary">neg</span>
          <span className="text-error">end</span>
        </div>
      )}

      {data.nodeType === 'route_loop' ? (
        <>
          <Handle
            id="positive"
            type="source"
            position={Position.Bottom}
            className={cn(HANDLE_CLASS, '!bg-success')}
            style={{ left: '25%' }}
          />
          <Handle
            id="negative"
            type="source"
            position={Position.Bottom}
            className={cn(HANDLE_CLASS, '!bg-text-secondary')}
            style={{ left: '50%' }}
          />
          <Handle
            id="exhausted"
            type="source"
            position={Position.Bottom}
            className={cn(HANDLE_CLASS, '!bg-error')}
            style={{ left: '75%' }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className={HANDLE_CLASS} />
      )}
    </div>
  );
}

// memo() for React Flow performance; exported as a named function component
export const dagNodeComponent = memo(DagNodeRender);
