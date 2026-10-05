/**
 * Create/edit form for one workflow ENV overlay: name plus per-node patches
 * restricted to the fields the server reports as allowed for each node.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createWorkflowEnv,
  getWorkflowEnv,
  updateWorkflowEnv,
  type WorkflowEnvPreviewTarget,
} from '@/lib/workflow-envs/api';
import {
  allowedFieldsForNode,
  buildPatchesFromDrafts,
  draftsFromPatches,
  emptyNodeDraft,
  formatWorkflowEnvActionError,
  isValidEnvName,
  type AllowedField,
  type NodePatchDraft,
  type ThinkingEditorValue,
  type ThinkingMode,
} from '@/lib/workflow-envs/editor';
import {
  FIELD_CLASS,
  FIELD_LABEL_CLASS,
  GHOST_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from './styles';

export interface WorkflowEnvEditorViewProps {
  mode: 'create' | 'edit';
  workflowName: string;
  envId: string | null;
  targets: WorkflowEnvPreviewTarget[];
  targetsLoading: boolean;
  targetsError: Error | undefined;
  busy: boolean;
  setBusy: (v: boolean) => void;
  actionError: string | null;
  setActionError: (v: string | null) => void;
  onCancel: () => void;
  onSaved: (envId: string) => void;
}

export function WorkflowEnvEditorView({
  mode,
  workflowName,
  envId,
  targets,
  targetsLoading,
  targetsError,
  busy,
  setBusy,
  actionError,
  setActionError,
  onCancel,
  onSaved,
}: WorkflowEnvEditorViewProps): ReactElement {
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<NodePatchDraft[]>([]);
  const [loaded, setLoaded] = useState(mode === 'create');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch full ENV (with patches) only when opening edit — never from the summary list.
  useEffect(() => {
    if (mode !== 'edit' || envId === null) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    void getWorkflowEnv(workflowName, envId)
      .then(env => {
        if (cancelled) return;
        setName(env.name);
        setDrafts(draftsFromPatches(env.patches));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(formatWorkflowEnvActionError(err));
        setLoaded(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [mode, workflowName, envId]);

  const updateDraft = (index: number, next: NodePatchDraft): void => {
    setDrafts(prev => prev.map((d, i) => (i === index ? next : d)));
    if (actionError !== null) setActionError(null);
  };

  const removeDraft = (index: number): void => {
    setDrafts(prev => prev.filter((_, i) => i !== index));
    if (actionError !== null) setActionError(null);
  };

  const addDraft = (): void => {
    const used = new Set(drafts.map(d => d.nodeId));
    const nextTarget = targets.find(t => !used.has(t.id));
    setDrafts(prev => [...prev, emptyNodeDraft(nextTarget?.id ?? '')]);
    if (actionError !== null) setActionError(null);
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isValidEnvName(name)) {
      setActionError('ENV name must be 1–64 chars: start with alphanumeric, then [A-Za-z0-9._-].');
      return;
    }
    // Distinguish discovery loading/failure from successful zero-target discovery.
    // Only loading/error block submit — empty targets is a valid no-op ENV (patches: {}).
    if (targetsLoading) {
      setActionError(
        'Baseline targets still loading — cannot save until the field matrix resolves.'
      );
      return;
    }
    if (targetsError !== undefined) {
      setActionError(
        targetsError.message.length > 0
          ? targetsError.message
          : 'Baseline targets unavailable — cannot edit patches without server field matrix.'
      );
      return;
    }
    const built = buildPatchesFromDrafts(drafts, targets);
    if (!built.ok) {
      setActionError(built.error);
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      if (mode === 'create') {
        const created = await createWorkflowEnv(workflowName, {
          name: name.trim(),
          patches: built.patches,
        });
        onSaved(created.id);
      } else if (envId !== null) {
        // Full patch map replacement — never a deep delta.
        const updated = await updateWorkflowEnv(workflowName, envId, {
          name: name.trim(),
          patches: built.patches,
        });
        onSaved(updated.id);
      }
    } catch (err: unknown) {
      setActionError(formatWorkflowEnvActionError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <p className="text-sm text-text-tertiary">Loading ENV…</p>;
  }
  if (loadError !== null) {
    return (
      <div>
        <p className="text-sm text-error">{loadError}</p>
        <button type="button" onClick={onCancel} className={cn(GHOST_BUTTON_CLASS, 'mt-3')}>
          Back
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={e => {
        void onSubmit(e);
      }}
      className="space-y-3"
      data-testid="env-editor-form"
    >
      <label className="block">
        <span className={FIELD_LABEL_CLASS}>Name</span>
        <input
          value={name}
          onChange={e => {
            setName(e.target.value);
            if (actionError !== null) setActionError(null);
          }}
          disabled={busy}
          autoFocus={mode === 'create'}
          spellCheck={false}
          placeholder="fast-sonnet"
          data-testid="env-editor-name"
          className={cn(FIELD_CLASS, 'mt-1 font-mono')}
        />
      </label>

      {targetsLoading ? (
        <p className="text-sm text-text-tertiary">Loading allowed target fields…</p>
      ) : targetsError !== undefined ? (
        <p className="text-sm text-error">Baseline preview failed: {targetsError.message}</p>
      ) : (
        <div className="space-y-2" data-testid="env-patch-editor">
          <div className="flex items-center justify-between gap-2">
            <span className={FIELD_LABEL_CLASS}>Patches</span>
            <button
              type="button"
              onClick={addDraft}
              disabled={busy || targets.length === 0}
              className={GHOST_BUTTON_CLASS}
            >
              <Plus className="size-4" strokeWidth={1.75} />
              Node
            </button>
          </div>
          {drafts.length === 0 ? (
            <p
              className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-tertiary"
              data-testid="env-empty-patches"
            >
              {targets.length === 0
                ? 'No editable target nodes — saving creates a no-op ENV with patches: {}.'
                : 'No patches yet — saving creates a no-op ENV with patches: {}. Add a node to set fields; each chosen node still needs at least one allowed field.'}
            </p>
          ) : (
            drafts.map((draft, index) => (
              <NodePatchEditor
                key={`draft-${String(index)}`}
                draft={draft}
                targets={targets}
                allowedFields={allowedFieldsForNode(draft.nodeId, targets)}
                disabled={busy}
                onChange={next => {
                  updateDraft(index, next);
                }}
                onRemove={() => {
                  removeDraft(index);
                }}
              />
            ))
          )}
        </div>
      )}

      {actionError !== null ? (
        <p className="text-sm text-error" role="alert" data-testid="env-editor-error">
          {actionError}
        </p>
      ) : null}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 bg-surface-elevated pt-2">
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || targetsLoading || targetsError !== undefined}
          data-testid="env-editor-submit"
          className={PRIMARY_BUTTON_CLASS}
        >
          {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export interface NodePatchEditorProps {
  draft: NodePatchDraft;
  targets: WorkflowEnvPreviewTarget[];
  allowedFields: AllowedField[];
  disabled?: boolean;
  onChange: (next: NodePatchDraft) => void;
  onRemove: () => void;
}

/**
 * One node row: target select + only server-allowed fields.
 * Exported for component tests of allowed-field rendering.
 */
export function NodePatchEditor({
  draft,
  targets,
  allowedFields,
  disabled = false,
  onChange,
  onRemove,
}: NodePatchEditorProps): ReactElement {
  const allowed = new Set<AllowedField>(allowedFields);
  const fieldClass = cn(FIELD_CLASS, 'mt-1 font-mono');

  return (
    <div
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="env-node-patch"
      data-node-id={draft.nodeId}
    >
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1">
          <span className={FIELD_LABEL_CLASS}>Node</span>
          <select
            value={draft.nodeId}
            disabled={disabled}
            onChange={e => {
              onChange({ ...draft, nodeId: e.target.value });
            }}
            aria-label="Target node"
            className={fieldClass}
            data-testid="env-node-select"
          >
            <option value="">Select node…</option>
            {targets.map(t => (
              <option key={t.id} value={t.id}>
                {t.id} ({t.nodeType})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove node patch"
          className={cn(SECONDARY_BUTTON_CLASS, 'mt-5 hover:text-error')}
        >
          Remove
        </button>
      </div>

      {draft.nodeId.length > 0 && allowedFields.length === 0 ? (
        <p className="mt-2 text-sm text-text-tertiary">No patchable fields for this node type.</p>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {allowed.has('provider') ? (
          <Field
            label="provider"
            value={draft.provider}
            disabled={disabled}
            onChange={v => {
              onChange({ ...draft, provider: v });
            }}
            className={fieldClass}
          />
        ) : null}
        {allowed.has('model') ? (
          <Field
            label="model"
            value={draft.model}
            disabled={disabled}
            onChange={v => {
              onChange({ ...draft, model: v });
            }}
            className={fieldClass}
          />
        ) : null}
        {allowed.has('effort') ? (
          <Field
            label="effort"
            value={draft.effort}
            disabled={disabled}
            onChange={v => {
              onChange({ ...draft, effort: v });
            }}
            className={fieldClass}
            placeholder="low | medium | high | …"
          />
        ) : null}
        {allowed.has('thinking') ? (
          <ThinkingField
            value={draft.thinking}
            disabled={disabled}
            onChange={thinking => {
              onChange({ ...draft, thinking });
            }}
            className={fieldClass}
          />
        ) : null}
      </div>

      {allowed.has('prompt') ? (
        <BodyField
          label="prompt"
          enabled={draft.promptEnabled}
          value={draft.prompt}
          disabled={disabled}
          className={fieldClass}
          onEnabledChange={enabled => {
            onChange({
              ...draft,
              promptEnabled: enabled,
              prompt: enabled ? draft.prompt : '',
            });
          }}
          onValueChange={value => {
            onChange({ ...draft, promptEnabled: true, prompt: value });
          }}
        />
      ) : null}

      {allowed.has('bash') ? (
        <BodyField
          label="bash"
          enabled={draft.bashEnabled}
          value={draft.bash}
          disabled={disabled}
          className={fieldClass}
          onEnabledChange={enabled => {
            onChange({
              ...draft,
              bashEnabled: enabled,
              bash: enabled ? draft.bash : '',
            });
          }}
          onValueChange={value => {
            onChange({ ...draft, bashEnabled: true, bash: value });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * prompt/bash body control: enable toggle separates omission from presence-with-empty.
 * Enabled + empty string is a deliberate `prompt: ''` / `bash: ''` patch value.
 */
function BodyField({
  label,
  enabled,
  value,
  disabled,
  className,
  onEnabledChange,
  onValueChange,
}: {
  label: 'prompt' | 'bash';
  enabled: boolean;
  value: string;
  disabled: boolean;
  className: string;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="mt-2 block" data-testid={`env-field-${label}-wrap`}>
      <div className="flex items-center justify-between gap-2">
        <span className={FIELD_LABEL_CLASS}>{label}</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={e => {
              onEnabledChange(e.target.checked);
            }}
            data-testid={`env-field-${label}-enabled`}
            aria-label={`Include ${label} in patch`}
          />
          include
        </label>
      </div>
      <textarea
        value={value}
        disabled={disabled || !enabled}
        onChange={e => {
          onValueChange(e.target.value);
        }}
        rows={3}
        spellCheck={false}
        placeholder={enabled ? '(empty body)' : 'Enable to set body (empty allowed)'}
        className={`${className} resize-y py-2 ${enabled ? '' : 'opacity-50'}`}
        data-testid={`env-field-${label}`}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  className,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  className: string;
  placeholder?: string;
}): ReactElement {
  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => {
          onChange(e.target.value);
        }}
        className={className}
        data-testid={`env-field-${label}`}
      />
    </label>
  );
}

function ThinkingField({
  value,
  onChange,
  disabled,
  className,
}: {
  value: ThinkingEditorValue;
  onChange: (v: ThinkingEditorValue) => void;
  disabled: boolean;
  className: string;
}): ReactElement {
  return (
    <div className="block sm:col-span-2">
      <span className={FIELD_LABEL_CLASS}>thinking</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          value={value.mode}
          disabled={disabled}
          onChange={e => {
            const mode = e.target.value as ThinkingMode;
            onChange({
              mode,
              budgetTokens: mode === 'enabled' ? value.budgetTokens : '',
            });
          }}
          aria-label="thinking mode"
          className={className}
          data-testid="env-field-thinking-mode"
        >
          <option value="unset">unset</option>
          <option value="adaptive">adaptive</option>
          <option value="enabled">enabled</option>
          <option value="disabled">disabled</option>
        </select>
        {value.mode === 'enabled' ? (
          <input
            value={value.budgetTokens}
            disabled={disabled}
            placeholder="budgetTokens (optional)"
            spellCheck={false}
            onChange={e => {
              onChange({ ...value, budgetTokens: e.target.value });
            }}
            className={className}
            data-testid="env-field-thinking-budget"
          />
        ) : null}
      </div>
    </div>
  );
}
