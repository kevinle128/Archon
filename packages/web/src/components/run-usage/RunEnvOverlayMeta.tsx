import { useId, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  WorkflowEnvResolvedTable,
  type RunEnvOverlay,
} from '@/components/workflow-envs/WorkflowEnvResolvedTable';

/**
 * Header metadata item naming the ENV overlay a run used. The name expands the
 * resolved request settings table on its own line below the metadata row.
 * Render only when the run has an overlay.
 */
export function RunEnvOverlayMeta({ overlay }: { overlay: RunEnvOverlay }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <>
      <span data-testid="run-env-chip">
        environment{' '}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          title={`Workflow ENV overlay: ${overlay.envName}${overlay.complete ? '' : ' (pending snapshot)'}`}
          onClick={(): void => {
            setExpanded(open => !open);
          }}
          className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-[10px] font-mono text-text-primary transition-colors duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          {overlay.envName}
          {overlay.complete ? '' : ' (pending)'}
          {expanded ? (
            <ChevronDown aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
          )}
        </button>
      </span>
      {expanded ? (
        <div id={panelId} className="w-full py-1">
          <WorkflowEnvResolvedTable overlay={overlay} />
        </div>
      ) : null}
    </>
  );
}
