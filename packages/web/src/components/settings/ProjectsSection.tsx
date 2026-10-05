import { useState, type FormEvent, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  addCodebase,
  deleteCodebase,
  deleteCodebaseEnvVar,
  getCodebaseEnvVars,
  getCodebaseInput,
  listCodebases,
  setCodebaseEnvVar,
} from '@/lib/api';
import type { CodebaseResponse } from '@/lib/api';
import { settingsKeys } from '@/lib/settings/query-keys';
import {
  Btn,
  Field,
  HelpText,
  InlineError,
  LoadingLine,
  MONO_CONTROL_CLASS,
  ROW_CLASS,
  SettingsSection,
  TextInput,
} from './primitives';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Env var keys for one project. Values are write-only: the API never returns them. */
function EnvVarsEditor({ codebaseId }: { codebaseId: string }): ReactElement {
  const queryClient = useQueryClient();
  const queryKey = ['codebaseEnvVars', codebaseId] as const;
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getCodebaseEnvVars(codebaseId),
  });

  const setMutation = useMutation({
    mutationFn: (data: { key: string; value: string }) => setCodebaseEnvVar(codebaseId, data),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey });
      if (editingKey === variables.key) {
        setEditingKey(null);
        setEditValue('');
      } else {
        setNewKey('');
        setNewValue('');
      }
      setError(null);
    },
    onError: (err: unknown) => {
      setError(errorMessage(err, 'Failed to save the variable.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteCodebaseEnvVar(codebaseId, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      setError(null);
    },
    onError: (err: unknown) => {
      setError(errorMessage(err, 'Failed to remove the variable.'));
    },
  });

  function handleAdd(e: FormEvent): void {
    e.preventDefault();
    if (newKey.trim() && newValue !== '') {
      setMutation.mutate({ key: newKey.trim(), value: newValue });
    }
  }

  return (
    <div className="col-span-full grid gap-4 border-l border-border pl-4">
      {isLoading ? <LoadingLine /> : null}
      {!isLoading && keys.length === 0 ? <HelpText>No env vars set.</HelpText> : null}
      {keys.map(key => (
        <div key={key} className="grid gap-2">
          <div className="flex min-h-11 flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary">
              {key}
            </span>
            <span className="font-mono text-xs text-text-tertiary">value hidden</span>
            <Btn
              variant="ghost"
              onClick={() => {
                setEditingKey(editingKey === key ? null : key);
                setEditValue('');
              }}
            >
              {editingKey === key ? 'Cancel' : 'Replace'}
            </Btn>
            <Btn
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() => {
                deleteMutation.mutate(key);
              }}
              aria-label={`Remove ${key}`}
            >
              Remove
            </Btn>
          </div>
          {editingKey === key ? (
            <form
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
              onSubmit={e => {
                e.preventDefault();
                if (editValue !== '') setMutation.mutate({ key, value: editValue });
              }}
            >
              <TextInput
                type="password"
                autoComplete="off"
                autoFocus
                value={editValue}
                onChange={e => {
                  setEditValue(e.target.value);
                }}
                placeholder="New value"
                aria-label={`New value for ${key}`}
                className="font-mono"
              />
              <Btn type="submit" disabled={setMutation.isPending || editValue === ''}>
                Save
              </Btn>
            </form>
          ) : null}
        </div>
      ))}
      <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <TextInput
          value={newKey}
          onChange={e => {
            setNewKey(e.target.value);
          }}
          placeholder="KEY"
          aria-label="Env var name"
          className={MONO_CONTROL_CLASS}
        />
        <TextInput
          type="password"
          autoComplete="off"
          value={newValue}
          onChange={e => {
            setNewValue(e.target.value);
          }}
          placeholder="Value"
          aria-label="Env var value"
          className="font-mono"
        />
        <Btn
          type="submit"
          disabled={setMutation.isPending || newKey.trim() === '' || newValue === ''}
        >
          Add variable
        </Btn>
      </form>
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}

function projectSubtitle(cb: CodebaseResponse): string {
  const parts: string[] = [cb.kind === 'folder' ? 'folder' : 'repo'];
  if (cb.repository_url) parts.push(cb.repository_url);
  if (cb.default_branch) parts.push(cb.default_branch);
  return parts.join(' · ');
}

export function ProjectsSection(): ReactElement {
  const queryClient = useQueryClient();
  const [addValue, setAddValue] = useState('');
  const [addEmptyError, setAddEmptyError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    data: codebases,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: settingsKeys.codebases,
    queryFn: listCodebases,
  });

  const addMutation = useMutation({
    mutationFn: (value: string) => addCodebase(getCodebaseInput(value)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.codebases });
      setAddValue('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCodebase(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.codebases });
    },
  });

  function handleAdd(e: FormEvent): void {
    e.preventDefault();
    if (addValue.trim() === '') {
      setAddEmptyError(true);
      return;
    }
    setAddEmptyError(false);
    addMutation.mutate(addValue.trim());
  }

  return (
    <SettingsSection
      id="set-projects"
      title="Projects"
      description="Registered codebases. Env vars are injected into Claude, Codex, bash and script nodes."
    >
      <form onSubmit={handleAdd} className="grid gap-2">
        <Field
          label="GitHub URL or local path"
          error={
            addEmptyError
              ? 'Enter a GitHub URL or a local path.'
              : addMutation.isError
                ? errorMessage(addMutation.error, 'Failed to add project')
                : null
          }
        >
          {({ id, describedBy, invalid }) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <TextInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={addValue}
                onChange={e => {
                  setAddValue(e.target.value);
                  setAddEmptyError(false);
                }}
                placeholder="GitHub URL or local path"
              />
              <Btn type="submit" variant="primary" disabled={addMutation.isPending}>
                <Plus aria-hidden strokeWidth={1.75} className="size-4" />
                {addMutation.isPending ? 'Adding...' : 'Add project'}
              </Btn>
            </div>
          )}
        </Field>
      </form>

      {isLoading ? <LoadingLine /> : null}
      {loadError ? (
        <InlineError>{errorMessage(loadError, 'Failed to load projects.')}</InlineError>
      ) : null}
      {codebases?.length === 0 ? <HelpText>No projects registered.</HelpText> : null}
      {codebases && codebases.length > 0 ? (
        <div className="border-t border-border">
          {codebases.map(cb => (
            <div key={cb.id} className={ROW_CLASS}>
              <div className="grid min-w-0 gap-1">
                <div className="text-sm font-medium text-text-primary">{cb.name}</div>
                <div className="break-words font-mono text-xs text-text-tertiary">
                  {projectSubtitle(cb)}
                </div>
                <div className="break-words font-mono text-xs text-text-tertiary">
                  {cb.default_cwd}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Btn
                  aria-expanded={expanded === cb.id}
                  onClick={() => {
                    setExpanded(expanded === cb.id ? null : cb.id);
                  }}
                >
                  Edit env vars
                </Btn>
                <Btn
                  variant="danger"
                  disabled={deleteMutation.isPending}
                  aria-label={`Remove ${cb.name}`}
                  onClick={() => {
                    deleteMutation.mutate(cb.id);
                  }}
                >
                  Remove
                </Btn>
              </div>
              {expanded === cb.id ? <EnvVarsEditor codebaseId={cb.id} /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {deleteMutation.isError ? (
        <InlineError>{errorMessage(deleteMutation.error, 'Failed to remove project.')}</InlineError>
      ) : null}
    </SettingsSection>
  );
}
