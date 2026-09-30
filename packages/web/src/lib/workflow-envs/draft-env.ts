/**
 * Pure helpers for the workflow run card's ENV selection.
 *
 * Kept out of React so unit tests can cover Start gating, workflow-change
 * reset, and preview-key race isolation without mounting the UI.
 */

import type { WorkflowEnvPreview } from './api';

/** Sentinel for "None (YAML)" — no overlay on Start. */
export const NONE_ENV_SELECTION = null;

/**
 * Whether Start must stay disabled because an ENV is selected but its
 * preview is still loading or failed. None/YAML never blocks on preview —
 * list failure leaves explicit YAML Start usable.
 *
 * Never silently resets selection to None after an ENV fetch error.
 */
export function isStartBlockedBySelectedEnv(args: {
  selectedEnvId: string | null;
  preview: WorkflowEnvPreview | undefined;
  previewError: Error | undefined;
}): boolean {
  if (args.selectedEnvId === null) return false;
  if (args.previewError !== undefined) return true;
  return args.preview === undefined;
}

/**
 * Human-readable reason Start is blocked by ENV state, or null when clear.
 * Used for the disabled control's helper text (never a silent dead button).
 */
export function envStartBlockReason(args: {
  selectedEnvId: string | null;
  preview: WorkflowEnvPreview | undefined;
  previewError: Error | undefined;
}): string | null {
  if (args.selectedEnvId === null) return null;
  if (args.previewError !== undefined) {
    return 'ENV preview failed — fix or pick None (YAML) before starting.';
  }
  if (args.preview === undefined) {
    return 'Loading ENV preview…';
  }
  return null;
}
