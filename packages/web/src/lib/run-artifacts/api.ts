import type { components } from '@/lib/api.generated';

export type RunArtifactFile = components['schemas']['ArtifactFile'];

/**
 * The server answers 404 when it cannot resolve where a run's output lives
 * (run deleted, or its project no longer registered). That is a different
 * state from a resolved location that holds no files, so it gets its own type.
 */
export class RunArtifactsUnavailableError extends Error {
  constructor(runId: string) {
    super(`Artifacts unavailable for run ${runId}`);
    this.name = 'RunArtifactsUnavailableError';
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : `${fallback} (${res.status.toString()})`;
}

/** URL of a single artifact file; each path segment is encoded separately. */
export function runArtifactUrl(runId: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/api/artifacts/${encodeURIComponent(runId)}/${encodedPath}`;
}

/** List every file on disk under the run's artifact directory. */
export async function listRunArtifacts(runId: string): Promise<RunArtifactFile[]> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
  if (res.status === 404) throw new RunArtifactsUnavailableError(runId);
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to list artifacts'));
  const body = (await res.json()) as { files: RunArtifactFile[] };
  return body.files;
}

/** Fetch one artifact file as text. */
export async function fetchRunArtifact(runId: string, path: string): Promise<string> {
  const res = await fetch(runArtifactUrl(runId, path));
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load artifact'));
  return res.text();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.mdx');
}
