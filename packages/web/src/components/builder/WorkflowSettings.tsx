import { useProviders } from '@/hooks/useProviders';

const FIELD_CLASS =
  'w-full border border-line-strong bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary';

interface WorkflowSettingsProps {
  description: string;
  provider: string | undefined;
  model: string | undefined;
  onDescriptionChange: (description: string) => void;
  onProviderChange: (provider: string | undefined) => void;
  onModelChange: (model: string | undefined) => void;
}

/** Inspector content when no node is selected: settings of the whole workflow. */
export function WorkflowSettings({
  description,
  provider,
  model,
  onDescriptionChange,
  onProviderChange,
  onModelChange,
}: WorkflowSettingsProps): React.ReactElement {
  const { providers } = useProviders();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        Select a node to edit it. These settings apply to the whole workflow.
      </p>
      <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
        Description
        <textarea
          rows={4}
          value={description}
          onChange={(event): void => {
            onDescriptionChange(event.target.value);
          }}
          className={`${FIELD_CLASS} resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
        Provider
        <select
          value={provider ?? ''}
          onChange={(event): void => {
            onProviderChange(event.target.value === '' ? undefined : event.target.value);
          }}
          className={FIELD_CLASS}
        >
          <option value="">Config default</option>
          {providers.map(item => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
        Model
        <input
          value={model ?? ''}
          placeholder="Tier, @alias, or model name"
          onChange={(event): void => {
            onModelChange(event.target.value === '' ? undefined : event.target.value);
          }}
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
    </div>
  );
}
