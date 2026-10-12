import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { getConfig, type CommandEntry } from '@/lib/api';
import { settingsKeys } from '@/lib/settings/query-keys';
import type { DagNodeData } from '@/components/workflows/DagNodeComponent';
import {
  AdvancedTab,
  ExecutionTab,
  GeneralTab,
  ToolsTab,
} from '@/components/workflows/NodeInspector';

type TierChoice = 'small' | 'medium' | 'large' | 'custom';

const TIERS: readonly TierChoice[] = ['small', 'medium', 'large'];

const KIND_LABEL: Readonly<Record<string, string>> = {
  command: 'Command',
  prompt: 'Prompt',
  bash: 'Bash',
  route_loop: 'Route',
  loop: 'Loop',
  approval: 'Approval',
  plannotator_gate: 'Plannotator gate',
  cancel: 'Cancel',
};

/** Tier the node names, or "custom" for a literal model or alias. Null when it names none. */
export function tierChoiceOf(model: string | undefined): TierChoice | null {
  if (model === undefined || model === '') return null;
  return (TIERS as readonly string[]).includes(model) ? (model as TierChoice) : 'custom';
}

interface BuilderInspectorProps {
  node: DagNodeData;
  commands: CommandEntry[];
  /** 1-based step of the node, for the Step control. */
  stepNumber: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (updates: Partial<DagNodeData>) => void;
  onDelete: () => void;
}

/** Builder inspector for one node: the main fields first, the rest under Advanced. */
export function BuilderInspector({
  node,
  commands,
  stepNumber,
  canMoveLeft,
  canMoveRight,
  onMove,
  onUpdate,
  onDelete,
}: BuilderInspectorProps): React.ReactElement {
  const usesModel = node.nodeType !== 'bash' && node.nodeType !== 'route_loop';
  const hasAdvanced =
    node.nodeType !== 'route_loop' &&
    node.nodeType !== 'plannotator_gate' &&
    node.nodeType !== 'cancel';
  const showAiSections = usesModel && hasAdvanced;
  const tier = tierChoiceOf(node.model);

  const { data: config } = useQuery({
    queryKey: settingsKeys.config,
    queryFn: getConfig,
    staleTime: 60_000,
  });
  const resolved =
    tier !== null && tier !== 'custom'
      ? (config?.config.tiers?.[tier] ?? config?.config.tierDefaults?.[tier])
      : undefined;

  return (
    <div key={node.id} className="flex flex-col gap-3">
      <span className="text-xs text-text-secondary">
        {KIND_LABEL[node.nodeType] ?? node.nodeType} node
      </span>
      <div className="-mx-4">
        <GeneralTab node={node} commands={commands} onUpdate={onUpdate} />
      </div>
      <dl className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-text-secondary">Step</dt>
        <dd className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            aria-label="Move to the step before"
            disabled={!canMoveLeft}
            onClick={(): void => {
              onMove(-1);
            }}
          >
            ←
          </Button>
          <span className="font-bold">{String(stepNumber).padStart(2, '0')}</span>
          <Button
            variant="secondary"
            size="xs"
            aria-label="Move to the step after"
            disabled={!canMoveRight}
            onClick={(): void => {
              onMove(1);
            }}
          >
            →
          </Button>
        </dd>
        <dt className="text-text-secondary">Depends on</dt>
        <dd className="font-semibold break-words">
          {(node.depends_on ?? []).length > 0
            ? (node.depends_on ?? []).join(', ')
            : 'Nothing, runs first'}
        </dd>
      </dl>
      {usesModel ? (
        <div className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
          Model tier
          <Segmented<TierChoice>
            aria-label="Model tier"
            value={tier ?? 'custom'}
            onValueChange={(next): void => {
              if (next !== 'custom') onUpdate({ model: next });
            }}
            options={[
              { value: 'small', label: 'small' },
              { value: 'medium', label: 'medium' },
              { value: 'large', label: 'large' },
              { value: 'custom', label: 'custom' },
            ]}
            className="grid grid-cols-4"
          />
          <span className="font-normal">
            {tier === null
              ? 'Uses the workflow or config default.'
              : tier === 'custom'
                ? `Custom model ${node.model ?? ''}. Edit it under Advanced.`
                : resolved !== undefined
                  ? `Resolves to ${resolved.provider} · ${resolved.model}`
                  : 'Resolves from the config tiers.'}
          </span>
        </div>
      ) : null}
      {hasAdvanced ? (
        <details className="border-t border-border pt-2">
          <summary className="cursor-pointer text-xs font-semibold text-text-secondary">
            Advanced
          </summary>
          <div className="-mx-4">
            <ExecutionTab node={node} onUpdate={onUpdate} />
            {showAiSections ? <ToolsTab node={node} onUpdate={onUpdate} /> : null}
            {showAiSections ? <AdvancedTab key={node.id} node={node} onUpdate={onUpdate} /> : null}
          </div>
        </details>
      ) : null}
      <Button
        variant="danger-outline"
        size="sm"
        className="self-start"
        aria-label="Delete node"
        onClick={onDelete}
      >
        Delete node
      </Button>
    </div>
  );
}
