import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { keepaliveNode } from './api';
import { SteeringRequestError } from './steering-dock';

Object.assign(globalThis, {
  window: { location: { origin: 'http://localhost' } },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe('keepaliveNode', () => {
  // T3.12 Client helper
  test('T3.12 posts encoded URL with empty body and no JSON content type', async () => {
    const response = { success: true as const };
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(response));

    const result = await keepaliveNode('run/a', 'node b');

    expect(result).toEqual(response);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fa/nodes/node%20b/keepalive', {
      method: 'POST',
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  test('T3.12 normalizes nested 422 into SteeringRequestError', async () => {
    const body = {
      success: false,
      error: {
        code: 'not_steerable_here',
        message: 'No live steering session for this node in this process',
      },
    };
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body, 422));

    let caught: unknown;
    try {
      await keepaliveNode('run-1', 'plan');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SteeringRequestError);
    const normalized = caught as SteeringRequestError;
    expect(normalized.status).toBe(422);
    expect(normalized.code).toBe('not_steerable_here');
    expect(normalized.message).toBe('No live steering session for this node in this process');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
