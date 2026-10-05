import { ChevronDown } from 'lucide-react';
import type { WorkflowDefinition } from '@/lib/api';
import { cn } from '@/lib/utils';
import { serializeWorkflowToYaml } from '@/lib/workflow-yaml';

interface YamlCodeViewProps {
  definition: WorkflowDefinition | null;
  mode: 'split' | 'full';
  /** Shown in split mode so the preview can be folded away. */
  onCollapse?: () => void;
}

export const serializeToYaml = serializeWorkflowToYaml;

export function YamlCodeView({
  definition,
  mode,
  onCollapse,
}: YamlCodeViewProps): React.ReactElement {
  const yamlText = definition ? serializeWorkflowToYaml(definition) : '';

  return (
    <div className="flex h-full flex-col bg-surface-inset">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <b className="whitespace-nowrap text-sm font-semibold text-text-primary">YAML preview</b>
        <span className="whitespace-nowrap font-mono text-xs text-text-tertiary">read only</span>
        <span className="flex-1" />
        {mode === 'split' && onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse YAML preview"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <pre
        className={cn(
          'flex-1 overflow-auto px-4 py-3',
          'font-mono text-xs leading-relaxed text-text-primary',
          'whitespace-pre-wrap break-words'
        )}
      >
        {yamlText || '# No workflow definition'}
      </pre>
    </div>
  );
}
