import { describe, expect, test } from 'bun:test';

import type { DashboardRunResponse, WorkflowRunResponse } from '@/lib/api';

import { exactWorkflowRuns, newestRun, runsOfConversation } from './queries';

describe('exactWorkflowRuns', () => {
  test('keeps only runs of exactly that workflow', () => {
    const runs = [
      { id: 'a', workflow_name: 'review' },
      { id: 'b', workflow_name: 'review-pr' },
      { id: 'c', workflow_name: 'fix', user_message: 'please review' },
    ] as DashboardRunResponse[];
    expect(exactWorkflowRuns(runs, 'review').map(run => run.id)).toEqual(['a']);
  });
});

describe('newestRun', () => {
  test('picks the latest start', () => {
    const runs = [
      { id: 'old', started_at: '2026-10-01T10:00:00Z' },
      { id: 'new', started_at: '2026-10-02T10:00:00Z' },
    ] as WorkflowRunResponse[];
    expect(newestRun(runs)?.id).toBe('new');
  });

  test('is null when the conversation has no run yet', () => {
    expect(newestRun([])).toBeNull();
  });
});

describe('runsOfConversation', () => {
  test('matches runs started from the chat and runs in it', () => {
    const runs = [
      { id: 'web', parent_conversation_id: 'chat-1', conversation_id: 'worker-1' },
      { id: 'cli', parent_conversation_id: null, conversation_id: 'chat-1' },
      { id: 'other', parent_conversation_id: 'chat-2', conversation_id: 'worker-2' },
    ] as WorkflowRunResponse[];
    expect(runsOfConversation(runs, 'chat-1').map(run => run.id)).toEqual(['web', 'cli']);
  });
});
