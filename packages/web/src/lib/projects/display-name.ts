import type { CodebaseResponse } from '@/lib/api';

/**
 * Reads `owner/repo` from a repository URL. Accepts HTTPS, SSH (`git@host:owner/repo`)
 * and an optional `.git` suffix. Returns null when the URL has fewer than two path parts.
 */
export function ownerRepoFromUrl(url: string): string | null {
  const trimmed = url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const path = trimmed.includes('://')
    ? trimmed
        .slice(trimmed.indexOf('://') + 3)
        .split('/')
        .slice(1)
    : trimmed.slice(trimmed.indexOf(':') + 1).split('/');
  const parts = path.filter(part => part !== '');
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** Name to show for a project: `owner/repo` from its repository URL, else its stored name. */
export function projectDisplayName(
  codebase: Pick<CodebaseResponse, 'name' | 'repository_url'>
): string {
  if (codebase.repository_url) {
    const ownerRepo = ownerRepoFromUrl(codebase.repository_url);
    if (ownerRepo) return ownerRepo;
  }
  return codebase.name;
}
