/** Centralized cache key constructors. Refactoring key shape = one file. */

import { usageCacheKey, type UsageQuery } from '../skills/usage';
import {
  workflowEnvsCacheKey,
  workflowEnvCacheKey,
  workflowEnvPreviewCacheKey,
} from '../skills/workflowEnvs';

/** A scope is either the literal 'all' or a project id. Encoded as a string. */
export type Scope = string;
export const ALL_SCOPE = 'all';

export const scopeKey = (scope: Scope): string =>
  scope === ALL_SCOPE ? 'all' : `project:${scope}`;

export const K = {
  projects: 'projects' as const,
  project: (id: string): string => `project:${id}`,
  workflows: (cwd: string): string => `workflows:${cwd}`,
  // Encode both parts: workflow names may contain `:`, so a raw join could let
  // distinct (cwd, name) pairs collapse to the same cache key.
  workflow: (cwd: string, name: string): string =>
    `workflow:${encodeURIComponent(cwd)}:${encodeURIComponent(name)}`,
  worktrees: (projectId: string): string => `worktrees:${projectId}`,
  runs: (scope: Scope): string => `runs:${scopeKey(scope)}`,
  run: (id: string): string => `run:${id}`,
  messages: (conversationId: string): string => `messages:${conversationId}`,
  conversations: (projectId: string): string => `conversations:${projectId}`,
  parentConversation: (platformId: string | null): string =>
    platformId === null
      ? 'parent-conversation:none'
      : `parent-conversation:${encodeURIComponent(platformId)}`,
  countsGlobal: 'counts:global' as const,
  pendingRuns: 'pendingRuns' as const,
  envVars: (projectId: string): string => `envVars:${projectId}`,
  /** Install-wide workflow ENV summaries (no patches). */
  workflowEnvs: (workflowName: string): string => workflowEnvsCacheKey(workflowName),
  /** Full workflow ENV row (includes patches) — edit path only. */
  workflowEnv: (workflowName: string, envId: string): string =>
    workflowEnvCacheKey(workflowName, envId),
  /**
   * ENV preview keyed by cwd + workflow + env id (`null` → `none`).
   * Distinct keys keep a slower prior preview from overwriting a newer selection.
   */
  workflowEnvPreview: (cwd: string, workflowName: string, envId: string | null): string =>
    workflowEnvPreviewCacheKey(cwd, workflowName, envId),
  artifacts: (runId: string): string => `artifacts:${runId}`,
  filesChanged: (runId: string): string => `files-changed:${runId}`,
  nodeMessages: (runId: string, nodeId: string): string =>
    `run-node-messages:${encodeURIComponent(runId)}:${encodeURIComponent(nodeId)}`,
  workflowDagNodes: (cwd: string | undefined, workflowName: string): string =>
    `workflow-dag-nodes:${encodeURIComponent(cwd ?? '')}:${encodeURIComponent(workflowName)}`,
  // Installation-wide settings surfaces (static keys — one row each).
  config: 'config' as const,
  // Health has two consumers — the Settings SystemPanel and the IDE docker-check.
  // Both must read via lib/health's useHealth() so they share this one cache entry
  // instead of issuing duplicate /api/health fetches.
  health: 'health' as const,
  providers: 'providers' as const,
  updateCheck: 'update-check' as const,
  githubConnection: 'github-connection' as const,
  providerConnections: 'provider-connections' as const,
  userAiPrefs: 'user-ai-prefs' as const,
  piModels: 'pi-models' as const,
  /** Usage report key includes every filter + groupBy value. */
  usage: (query: UsageQuery): string => usageCacheKey(query),
} as const;
