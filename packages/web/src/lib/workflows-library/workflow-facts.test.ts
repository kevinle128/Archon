import { describe, expect, test } from 'bun:test';

import { inputLabel, isolationPolicy, workflowFilePath } from './workflow-facts';

describe('workflowFilePath', () => {
  test('places each source in its directory', () => {
    expect(workflowFilePath('review', 'project', 'review.yaml')).toBe(
      '.archon/workflows/review.yaml'
    );
    expect(workflowFilePath('review', 'global', 'review.yaml')).toBe(
      '~/.archon/workflows/review.yaml'
    );
    expect(workflowFilePath('review', 'bundled', 'review.yaml')).toBe('defaults/review.yaml');
  });

  test('falls back to the name when the filename is unknown', () => {
    expect(workflowFilePath('review', 'project')).toBe('.archon/workflows/review.yaml');
    expect(workflowFilePath('review', 'project', '')).toBe('.archon/workflows/review.yaml');
  });
});

describe('isolationPolicy', () => {
  test('reads the worktree and container settings', () => {
    expect(isolationPolicy({ worktree: { enabled: true } }).label).toBe('Runs in a worktree');
    expect(isolationPolicy({ worktree: { enabled: false } }).label).toBe('Runs in place');
    expect(isolationPolicy({ container: { enabled: true } }).label).toBe('Runs in a container');
    expect(isolationPolicy({}).label).toBe('Default: worktree');
  });
});

describe('inputLabel', () => {
  test('lists declared inputs or reads as free text', () => {
    expect(inputLabel({ inputs: { issue: {}, branch: {} } })).toBe('issue, branch');
    expect(inputLabel({})).toBe('Free text');
  });
});
