import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import type { NodeStep, StepNode } from '@/lib/node-steps';
import { roomOpenerId } from '@/lib/execution-room-model';
import { cn } from '@/lib/utils';

export interface NodeRowInfo {
  status: string;
  /** Duration text or a live timer, right-aligned. */
  right?: React.ReactNode;
  /** Second-line extras such as "iteration 2 of 8". */
  extras: readonly string[];
}

interface NodeStepListProps {
  steps: readonly NodeStep[];
  infoOf: (nodeId: string) => NodeRowInfo;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}

const MUTED_STATUSES = new Set(['pending', 'skipped']);

function NodeRow({
  node,
  info,
  selected,
  onSelect,
}: {
  node: StepNode;
  info: NodeRowInfo;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}): React.ReactElement {
  const presentation = getStatusPresentation(info.status);
  const second = [node.code, ...info.extras].join(' · ');
  return (
    <button
      type="button"
      id={roomOpenerId('legacy', 'graph', node.id)}
      data-node-id={node.id}
      aria-current={selected ? 'true' : undefined}
      onClick={(): void => {
        onSelect(node.id);
      }}
      className={cn(
        '-ml-2 my-0.5 grid w-full cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 border-l-[3px] px-2 py-2 text-left hover:bg-selection',
        selected ? 'border-l-accent bg-selection' : 'border-l-transparent'
      )}
    >
      <span
        aria-hidden="true"
        className={cn('text-[13px] font-extrabold', STATUS_TONE_TEXT_CLASS[presentation.tone])}
      >
        {presentation.glyph}
      </span>
      <span
        className={cn(
          'text-sm font-semibold break-words',
          MUTED_STATUSES.has(info.status) ? 'text-text-secondary' : 'text-text-primary'
        )}
      >
        {node.id}
        <span className="sr-only">, {presentation.label}</span>
      </span>
      <span className="text-xs text-text-secondary">{info.right}</span>
      <span />
      <span className="col-[2/-1] text-[11px] text-text-secondary">{second}</span>
    </button>
  );
}

/** Nodes of a run grouped into steps. Parallel steps carry a left bracket. */
export function NodeStepList({
  steps,
  infoOf,
  selectedNodeId,
  onSelect,
}: NodeStepListProps): React.ReactElement {
  return (
    <ol aria-label="Nodes" className="grid">
      {steps.map(step => (
        <li key={step.index} className="grid grid-cols-[28px_minmax(0,1fr)] border-t border-border">
          <span className="pt-2.5 text-[11px] text-text-tertiary">{step.number}</span>
          <div className={cn('flex flex-col', step.parallel && 'border-l-2 border-border pl-3')}>
            {step.parallel ? (
              <span className="pt-1.5 text-[11px] text-text-tertiary">
                Parallel · {String(step.nodes.length)}
              </span>
            ) : null}
            {step.nodes.map(node => (
              <div key={node.id}>
                <NodeRow
                  node={node}
                  info={infoOf(node.id)}
                  selected={node.id === selectedNodeId}
                  onSelect={onSelect}
                />
                {node.children.length > 0 ? (
                  <div className="pl-3">
                    {node.children.map(child => (
                      <NodeRow
                        key={child.id}
                        node={child}
                        info={infoOf(child.id)}
                        selected={child.id === selectedNodeId}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
