import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { listWorkflows, createConversation, runWorkflow, deleteConversation } from '@/lib/api';
import { partitionWorkflows } from '@/components/workflows/partition-workflows';
import { useProject } from '@/contexts/ProjectContext';

interface WorkflowInvokerProps {
  codebaseId?: string;
}

export function WorkflowInvoker({ codebaseId }: WorkflowInvokerProps): React.ReactElement | null {
  const navigate = useNavigate();
  const { codebases } = useProject();
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cwd = codebaseId ? codebases?.find(cb => cb.id === codebaseId)?.default_cwd : undefined;

  const { data: workflowsResult, isError: isErrorWorkflows } = useQuery({
    queryKey: ['workflows', cwd ?? null],
    queryFn: () => listWorkflows(cwd),
    refetchInterval: 30_000,
  });

  if (isErrorWorkflows) {
    return <p className="text-xs text-error">Failed to load workflows. Retrying.</p>;
  }

  const workflows = workflowsResult?.workflows;
  const recommendedNames = workflowsResult?.recommended ?? [];
  if (!workflows || workflows.length === 0) {
    return <p className="text-sm text-text-secondary">No workflows available for this project.</p>;
  }

  // Partition into recommended (declared order) + rest. Empty recommended → flat options.
  // The helper keys on `name`, so flatten each entry briefly before partitioning.
  const flat = workflows.map(entry => ({ name: entry.workflow.name, entry }));
  const { recommended: recPairs, rest: otherPairs } = partitionWorkflows(flat, recommendedNames);
  const recommendedEntries = recPairs.map(p => p.entry);
  const otherEntries = otherPairs.map(p => p.entry);

  const handleRun = async (): Promise<void> => {
    if (!selectedWorkflow || !message.trim() || running) return;
    setRunning(true);
    setError(null);
    let conversationId: string | undefined;
    let workflowStarted = false;
    try {
      ({ conversationId } = await createConversation(codebaseId ?? undefined));
      await runWorkflow(selectedWorkflow, conversationId, message.trim());
      workflowStarted = true;
      setSelectedWorkflow(null);
      setMessage('');
      navigate(`/chat/${conversationId}`);
    } catch (err) {
      console.error('[WorkflowInvoker] Failed to start workflow', { err });
      setError(err instanceof Error ? err.message : 'Failed to start workflow');
      if (conversationId !== undefined && !workflowStarted) {
        void deleteConversation(conversationId).catch((cleanupErr: unknown) => {
          console.warn('[WorkflowInvoker] Failed to clean up orphan conversation', {
            conversationId,
            error: cleanupErr,
          });
        });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-3">
      <select
        value={selectedWorkflow ?? ''}
        onChange={(e): void => {
          setSelectedWorkflow(e.target.value || null);
          setError(null);
        }}
        aria-label="Workflow"
        className="h-8 w-full border border-line-strong bg-card px-2 text-[13px] text-text-primary"
      >
        <option value="">Choose a workflow</option>
        {recommendedEntries.length > 0 ? (
          <>
            <optgroup label="Recommended">
              {recommendedEntries.map(entry => (
                <option key={entry.workflow.name} value={entry.workflow.name}>
                  {entry.workflow.name}
                </option>
              ))}
            </optgroup>
            {otherEntries.length > 0 && (
              <optgroup label="Other workflows">
                {otherEntries.map(entry => (
                  <option key={entry.workflow.name} value={entry.workflow.name}>
                    {entry.workflow.name}
                  </option>
                ))}
              </optgroup>
            )}
          </>
        ) : (
          workflows.map(entry => (
            <option key={entry.workflow.name} value={entry.workflow.name}>
              {entry.workflow.name}
            </option>
          ))
        )}
      </select>
      {selectedWorkflow && (
        <div className="grid gap-2">
          <input
            type="text"
            value={message}
            onChange={(e): void => {
              setMessage(e.target.value);
            }}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleRun();
              }
            }}
            placeholder="Input for the workflow"
            name="workflow-message"
            autoComplete="off"
            disabled={running}
            aria-label="Workflow input"
            className="h-8 w-full border border-line-strong bg-card px-2 text-[13px] text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
            autoFocus
          />
          <div className="flex items-center justify-end gap-3">
            {error && (
              <span className="line-clamp-2 flex-1 text-xs font-semibold text-error">{error}</span>
            )}
            <button
              onClick={(): void => {
                void handleRun();
              }}
              disabled={running || !message.trim()}
              className="inline-flex h-8 items-center gap-2 bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {running && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
              {running ? 'Starting…' : 'Start run →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
