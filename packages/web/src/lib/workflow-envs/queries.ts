/**
 * React Query bindings for workflow ENV overlays.
 *
 * Every key is scoped by workflow name so a mutation can drop the list and all
 * previews of that workflow with one prefix invalidation. The preview key also
 * carries cwd and env id: a slower response for a previous selection lands in
 * its own cache entry and cannot overwrite the current one.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  listWorkflowEnvs,
  previewWorkflowEnv,
  type WorkflowEnvPreview,
  type WorkflowEnvSummary,
} from './api';

export const workflowEnvKeys = {
  workflow: (workflowName: string) => ['workflow-envs', workflowName] as const,
  list: (workflowName: string) => ['workflow-envs', workflowName, 'list'] as const,
  preview: (workflowName: string, cwd: string, envId: string | null) =>
    ['workflow-envs', workflowName, 'preview', cwd, envId] as const,
};

/** Result shape shared by the list and preview hooks. */
export interface EnvQueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** ENV summaries (no patch bodies) for one workflow. Disabled while no workflow is selected. */
export function useWorkflowEnvs(workflowName: string | null): EnvQueryState<WorkflowEnvSummary[]> {
  const query = useQuery({
    queryKey: workflowEnvKeys.list(workflowName ?? ''),
    queryFn: () => listWorkflowEnvs(workflowName ?? ''),
    enabled: workflowName !== null,
    retry: false,
  });
  return {
    data: query.data,
    error: query.error ?? undefined,
    loading: query.isLoading,
  };
}

/**
 * Server-authoritative preview for None (`envId: null`) or a selected ENV.
 * Needs a project cwd; without one the query stays idle and reports no data.
 */
export function useWorkflowEnvPreview(
  workflowName: string | null,
  cwd: string | undefined,
  envId: string | null
): EnvQueryState<WorkflowEnvPreview> {
  const enabled = workflowName !== null && cwd !== undefined && cwd.length > 0;
  const query = useQuery({
    queryKey: workflowEnvKeys.preview(workflowName ?? '', cwd ?? '', envId),
    queryFn: () => previewWorkflowEnv(workflowName ?? '', cwd ?? '', envId),
    enabled,
    retry: false,
    // A preview reflects live config, so the dialog and Run card refetch on mount.
    staleTime: 0,
  });
  return {
    data: query.data,
    error: query.error ?? undefined,
    loading: enabled && query.isLoading,
  };
}

/** Drop the list and every preview of a workflow after create, update or delete. */
export function invalidateWorkflowEnvQueries(client: QueryClient, workflowName: string): void {
  void client.invalidateQueries({ queryKey: workflowEnvKeys.workflow(workflowName) });
}
