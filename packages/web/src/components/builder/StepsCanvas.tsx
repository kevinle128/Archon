import type { NodeStep } from '@/lib/node-steps';
import { cn } from '@/lib/utils';

/** Model tier keywords a node can name instead of a literal model. */
const TIER_KEYWORDS = new Set(['small', 'medium', 'large']);

interface StepsCanvasProps {
  steps: readonly NodeStep[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}

/** Tier label of a node card: the tier keyword, a model name, or nothing. */
export function nodeTierLabel(model: string | undefined): string {
  if (model === undefined || model === '') return '';
  return TIER_KEYWORDS.has(model) ? model : 'custom';
}

/**
 * Builder canvas in steps: one 220px column per step, left to right, computed from
 * the real `depends_on` edges. A step with no node shows the error tint.
 */
export function StepsCanvas({
  steps,
  selectedNodeId,
  onSelect,
}: StepsCanvasProps): React.ReactElement {
  if (steps.length === 0) {
    return <p className="text-sm text-text-secondary">No nodes. Add one from the left.</p>;
  }
  return (
    <ol aria-label="Steps" className="flex min-h-full w-max items-stretch">
      {steps.map((step, position) => (
        <li key={step.index} className="flex items-stretch">
          {position > 0 ? (
            <span
              aria-hidden="true"
              className="flex w-9 justify-center pt-[52px] font-extrabold text-text-tertiary"
            >
              →
            </span>
          ) : null}
          <div
            className={cn(
              'flex w-[220px] flex-col gap-2 border-t-2 border-foreground p-3',
              step.nodes.length === 0 ? 'bg-tint-error' : 'bg-surface'
            )}
          >
            <div className="flex justify-between text-[11px] tracking-[0.08em] text-text-secondary uppercase">
              <span>Step {step.number}</span>
              <span>{step.parallel ? `Parallel · ${String(step.nodes.length)}` : ''}</span>
            </div>
            {step.nodes.map(node => {
              const selected = node.id === selectedNodeId;
              const tier = nodeTierLabel(node.node.model);
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={selected}
                  data-node-id={node.id}
                  onClick={(): void => {
                    onSelect(node.id);
                  }}
                  className={cn(
                    'flex flex-col gap-1 px-3 py-2 text-left hover:border-accent',
                    selected
                      ? 'border-2 border-accent bg-selection'
                      : 'border border-line-strong bg-card'
                  )}
                >
                  <span className="flex justify-between gap-2 text-[10px] font-extrabold tracking-[0.04em] text-text-secondary">
                    <span>{node.code}</span>
                    <span>{tier}</span>
                  </span>
                  <span className="text-[13px] font-bold break-words">{node.id}</span>
                  {node.node.when !== undefined && node.node.when !== '' ? (
                    <span className="text-[11px] font-semibold text-status-waiting">
                      conditional
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}
