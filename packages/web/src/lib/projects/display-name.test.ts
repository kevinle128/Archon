import { describe, expect, test } from 'bun:test';

import { ownerRepoFromUrl, projectDisplayName } from './display-name';

describe('ownerRepoFromUrl', () => {
  test('reads owner/repo from an HTTPS URL', () => {
    expect(ownerRepoFromUrl('https://github.com/anhle128/Archon')).toBe('anhle128/Archon');
  });

  test('drops a .git suffix and a trailing slash', () => {
    expect(ownerRepoFromUrl('https://github.com/acme/api.git')).toBe('acme/api');
    expect(ownerRepoFromUrl('https://github.com/acme/api/')).toBe('acme/api');
  });

  test('reads owner/repo from an SSH URL', () => {
    expect(ownerRepoFromUrl('git@github.com:acme/api.git')).toBe('acme/api');
  });

  test('returns null when the URL has no owner and repo', () => {
    expect(ownerRepoFromUrl('https://github.com/acme')).toBeNull();
    expect(ownerRepoFromUrl('')).toBeNull();
  });
});

describe('projectDisplayName', () => {
  test('prefers owner/repo from the repository URL', () => {
    expect(projectDisplayName({ name: 'api', repository_url: 'https://github.com/acme/api' })).toBe(
      'acme/api'
    );
  });

  test('falls back to the stored name for a folder project', () => {
    expect(projectDisplayName({ name: 'ops-folder', repository_url: null })).toBe('ops-folder');
  });

  test('falls back to the stored name when the URL cannot be read', () => {
    expect(projectDisplayName({ name: 'odd', repository_url: 'https://example.com' })).toBe('odd');
  });
});
