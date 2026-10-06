import { type ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NONE_ENV_SELECTION } from '@/lib/workflow-envs/draft-env';
import type { WorkflowEnvSummary } from '@/lib/workflow-envs/api';
import { FIELD_CLASS } from './styles';

export interface WorkflowEnvPickerProps {
  envs: WorkflowEnvSummary[];
  /** `null` = None (YAML). */
  value: string | null;
  onChange: (envId: string | null) => void;
  disabled?: boolean;
  /** List fetch failed: only None remains selectable. */
  listError?: boolean;
}

/**
 * Compact ENV selector shown next to the Run button.
 * Default is None (YAML). A list failure keeps None usable and never invents ENVs.
 */
export function WorkflowEnvPicker({
  envs,
  value,
  onChange,
  disabled = false,
  listError = false,
}: WorkflowEnvPickerProps): ReactElement {
  const selected = value ?? '';
  // If the operator already picked an ENV and the list later fails or drops it,
  // keep that option visible so the selection is never silently reset to None.
  const selectedMissing = value !== null && value.length > 0 && !envs.some(env => env.id === value);
  return (
    <div className="grid gap-1">
      <div className="relative w-56 max-w-full">
        <label className="sr-only" htmlFor="workflow-run-env">
          Workflow ENV overlay
        </label>
        <select
          id="workflow-run-env"
          value={selected}
          disabled={disabled}
          onChange={e => {
            const next = e.target.value;
            onChange(next.length === 0 ? NONE_ENV_SELECTION : next);
          }}
          className={cn(FIELD_CLASS, 'appearance-none pr-9')}
        >
          <option value="">None (YAML)</option>
          {selectedMissing ? <option value={value}>{`selected (${value})`}</option> : null}
          {!listError
            ? envs.map(env => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))
            : null}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
          strokeWidth={1.75}
        />
      </div>
      {listError ? (
        <span className="text-xs text-text-tertiary">
          Environment list unavailable. Running from the workflow YAML still works.
        </span>
      ) : null}
    </div>
  );
}
