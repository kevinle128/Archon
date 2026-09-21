import { describe, expect, test } from 'bun:test';
import { nodeTranscriptMetadataSchema, transcriptExecutionScopeSchema } from './node-execution';
import { appendNodeMessageSchema, nodeMessageSchema } from './node-message';

describe('transcriptExecutionScopeSchema', () => {
  test('requires UUID occurrence and attempt ids', () => {
    const scope = transcriptExecutionScopeSchema.parse({
      occurrence_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      retry_epoch: 0,
    });
    expect(scope.occurrence_id).toMatch(/11111111/);
    expect(
      transcriptExecutionScopeSchema.safeParse({
        occurrence_id: 'not-a-uuid',
        attempt_id: '22222222-2222-4222-8222-222222222222',
      }).success
    ).toBe(false);
  });
});

describe('node message metadata compatibility', () => {
  test('accepts old rows with no metadata key', () => {
    const parsed = nodeMessageSchema.parse({
      id: 'message-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      seq: 1,
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1' },
      created_at: '2026-09-06T00:00:00.000Z',
    });
    expect(parsed.metadata).toBeUndefined();
  });

  test('accepts null metadata from older writers', () => {
    const parsed = appendNodeMessageSchema.parse({
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'hello' },
      metadata: null,
    });
    expect(parsed.metadata).toBeNull();
  });

  test('accepts provider outcome and exit code on result rows', () => {
    expect(
      nodeTranscriptMetadataSchema.parse({
        tool_phase: 'result',
        outcome: 'error',
        exit_code: 2,
        output_state: 'truncated',
        truncated: true,
      })
    ).toEqual({
      tool_phase: 'result',
      outcome: 'error',
      exit_code: 2,
      output_state: 'truncated',
      truncated: true,
    });
    expect(
      nodeTranscriptMetadataSchema.safeParse({
        tool_phase: 'call',
        invented: true,
      }).success
    ).toBe(false);
  });

  test('accepts operator origin triple with non-null sender', () => {
    expect(
      nodeTranscriptMetadataSchema.parse({
        origin: 'operator',
        operator_user_id: 'user-operator-1',
        message_id: 'msg-operator-1',
      })
    ).toEqual({
      origin: 'operator',
      operator_user_id: 'user-operator-1',
      message_id: 'msg-operator-1',
    });
  });

  test('accepts explicit null operator_user_id', () => {
    expect(
      nodeTranscriptMetadataSchema.parse({
        origin: 'operator',
        operator_user_id: null,
        message_id: 'msg-operator-2',
      })
    ).toEqual({
      origin: 'operator',
      operator_user_id: null,
      message_id: 'msg-operator-2',
    });
  });

  test('rejects unsupported origin values', () => {
    expect(
      nodeTranscriptMetadataSchema.safeParse({
        origin: 'assistant',
        operator_user_id: 'user-1',
        message_id: 'msg-1',
      }).success
    ).toBe(false);
  });

  test('still rejects unknown sibling keys under .strict()', () => {
    expect(
      nodeTranscriptMetadataSchema.safeParse({
        origin: 'operator',
        operator_user_id: 'user-1',
        message_id: 'msg-1',
        invented: true,
      }).success
    ).toBe(false);
  });
});
