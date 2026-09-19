import { describe, expect, spyOn, test } from 'bun:test';
import { buildWorkflowEventEnvelope } from './workflow-event-envelope';
import {
  ProviderBindingTransformError,
  assertJsonTransformResult,
  normalizeProviderBindingTransform,
  transformWorkflowEventBody,
  validateProviderBindingTransform,
} from './provider-binding-transform';

function transform(expression: string) {
  return normalizeProviderBindingTransform({ engine: 'jsonata', expression });
}

describe('provider-binding JSONata policy', () => {
  test('normalizes defaults and rejects an oversized UTF-8 expression with a safe error', () => {
    expect(transform('{ "ok": true }')).toMatchObject({
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    });
    try {
      normalizeProviderBindingTransform({
        engine: 'jsonata',
        expression: 'é'.repeat(16_385),
      });
      throw new Error('expected normalization failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderBindingTransformError);
      expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_CONFIG_INVALID');
      expect((error as Error).message).toBe('TRANSFORM_CONFIG_INVALID');
      expect((error as Error).message).not.toContain('é');
    }
  });

  test('accepts canonical field selection and approved direct functions', () => {
    expect(() =>
      validateProviderBindingTransform(
        transform('{ "eventType": $uppercase(eventType), "runId": workflowRunRef.runId }')
      )
    ).not.toThrow();
  });

  test('rejects disallowed, unknown, dynamic, and aliased calls without source leakage', () => {
    for (const expression of [
      '$eval("1")',
      '$now()',
      '$millis()',
      '$random()',
      '$pad("x", 8)',
      '($f := $now; $f())',
      '($f := $uppercase; $f("x"))',
      '($uppercase := $eval; {"x": $uppercase("1+1")})',
    ]) {
      try {
        validateProviderBindingTransform(transform(expression));
        throw new Error('expected policy failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderBindingTransformError);
        expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_FUNCTION_DISALLOWED');
        expect((error as Error).message).not.toContain(expression);
      }
    }
  });

  test('enforces the expression byte cap on already-typed persisted values', () => {
    expect(() =>
      validateProviderBindingTransform({
        ...transform('{ "ok": true }'),
        expression: 'x'.repeat(32_769),
      })
    ).toThrow(/TRANSFORM_CONFIG_INVALID/);
  });

  test('rejects partials, apply, lambdas, transform expressions, and regex AST nodes', () => {
    for (const expression of [
      '$string(?)',
      '"x" ~> $uppercase()',
      'function($x){$x}',
      'payload ~> |foo|{bar: 1}|',
      '$contains(eventType, /run/)',
    ]) {
      expect(() => validateProviderBindingTransform(transform(expression))).toThrow(
        /TRANSFORM_AST_DISALLOWED/
      );
    }
  });

  test('classifies syntax failures without token text', () => {
    try {
      validateProviderBindingTransform(transform('{'));
      throw new Error('expected compile failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderBindingTransformError);
      expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_COMPILE_FAILED');
      expect((error as Error).message).toBe('TRANSFORM_COMPILE_FAILED');
      expect((error as Error).message).not.toContain('{');
    }
  });
});

const envelope = buildWorkflowEventEnvelope({
  eventId: 'evt-1',
  eventType: 'workflow.run.started',
  occurredAt: '2026-07-25T00:00:00.000Z',
  run: { id: 'run-1', workflow_name: 'bmad-dev-story' },
  codebase: {
    id: 'cb-1',
    name: 'workflow-engine',
    default_cwd: '/workspace/workflow-engine',
    default_branch: 'dev',
  },
  binding: { provider: 'archon', name: 'workflow-engine-primary' },
  payload: { state: 'running', startedAt: '2026-07-25T00:00:00.000Z' },
});

describe('transformWorkflowEventBody', () => {
  test('preserves the exact current identity serialization', async () => {
    const result = await transformWorkflowEventBody(envelope, null);
    expect(result).toEqual({
      body: JSON.stringify(envelope),
      outputBytes: new TextEncoder().encode(JSON.stringify(envelope)).length,
      engine: 'identity',
      durationMs: expect.any(Number),
    });
  });

  test('returns exact JSONata serialization and UTF-8 byte length', async () => {
    const result = await transformWorkflowEventBody(
      envelope,
      normalizeProviderBindingTransform({
        engine: 'jsonata',
        expression: '{ "eventType": eventType, "value": "é" }',
        timeoutMs: 200,
      })
    );
    expect(result.body).toBe('{"eventType":"workflow.run.started","value":"é"}');
    expect(result.outputBytes).toBe(new TextEncoder().encode(result.body).length);
    expect(result.engine).toBe('jsonata');
  });

  test('rejects scalar top-level output and UTF-8 output over the configured limit', async () => {
    await expect(
      transformWorkflowEventBody(envelope, transform('eventType'))
    ).rejects.toMatchObject({
      code: 'TRANSFORM_RESULT_INVALID',
    });
    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "v": "éé" }',
          maxOutputBytes: 5,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_OUTPUT_TOO_LARGE' });
  });

  test('rejects every non-JSON result shape and accepts repeated non-cyclic references', () => {
    for (const invalid of [
      undefined,
      () => 'x',
      Symbol('x'),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      new Date('2026-07-25T00:00:00.000Z'),
    ]) {
      expect(() => assertJsonTransformResult(invalid)).toThrow(/TRANSFORM_RESULT_INVALID/);
    }
    const sparse: unknown[] = [];
    sparse[1] = 'x';
    expect(() => assertJsonTransformResult(sparse)).toThrow(/TRANSFORM_RESULT_INVALID/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertJsonTransformResult(cyclic)).toThrow(/TRANSFORM_RESULT_INVALID/);
    const shared = { value: 'ok' };
    expect(() => assertJsonTransformResult({ left: shared, right: shared })).not.toThrow();
    expect(() =>
      assertJsonTransformResult(Object.assign(Object.create(null), { ok: true }))
    ).not.toThrow();
  });

  test('maps deterministic sequence, stack, and timeout guardrail failures', async () => {
    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "n": [1..20] }',
          maxSequenceSize: 10,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_SEQUENCE_LIMIT' });

    await expect(
      transformWorkflowEventBody(
        envelope,
        normalizeProviderBindingTransform({
          engine: 'jsonata',
          expression: '{ "v": $string($string($string($string("x")))) }',
          stackDepth: 2,
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSFORM_STACK_LIMIT' });

    let now = 0;
    const dateNow = spyOn(Date, 'now').mockImplementation(() => {
      now += 10;
      return now;
    });
    try {
      await expect(
        transformWorkflowEventBody(
          envelope,
          normalizeProviderBindingTransform({
            engine: 'jsonata',
            expression: '{ "n": [1..20] }',
            timeoutMs: 1,
            maxSequenceSize: 100,
          })
        )
      ).rejects.toMatchObject({ code: 'TRANSFORM_TIMEOUT' });
    } finally {
      dateNow.mockRestore();
    }
  });
});
