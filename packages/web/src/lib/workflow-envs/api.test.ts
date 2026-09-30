/**
 * Path builders and request-shape tests for the workflow ENV API.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  buildWorkflowEnvsPath,
  buildWorkflowEnvPath,
  buildWorkflowEnvPreviewPath,
  listWorkflowEnvs,
  previewWorkflowEnv,
  getWorkflowEnv,
  createWorkflowEnv,
  updateWorkflowEnv,
  deleteWorkflowEnv,
} from './api';

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let calls: Captured[] = [];

function stubFetch(handler?: (url: string) => unknown): void {
  calls = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const payload =
      handler?.(url) ??
      (url.includes('/env-preview')
        ? {
            preview: true,
            authoritative: false,
            workflowName: 'feature',
            envId: null,
            envName: null,
            skippedNodeIds: [],
            targets: [],
            resolved: [],
          }
        : url.includes('/envs/')
          ? {
              env: {
                id: 'e1',
                workflowName: 'feature',
                name: 'fast',
                updatedAt: 't',
                patches: {},
                createdAt: 't',
                createdByUserId: null,
              },
            }
          : { envs: [{ id: 'e1', workflowName: 'feature', name: 'fast', updatedAt: 't' }] });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }) as typeof fetch;
}

describe('workflowEnvs path builders', () => {
  test('collection path encodes workflow name', () => {
    expect(buildWorkflowEnvsPath('a/b:c')).toBe('/api/workflows/a%2Fb%3Ac/envs');
  });

  test('detail path encodes both segments', () => {
    expect(buildWorkflowEnvPath('wf', 'id:1')).toBe('/api/workflows/wf/envs/id%3A1');
  });

  test('preview path requires cwd and omits empty envId', () => {
    expect(buildWorkflowEnvPreviewPath('wf', '/tmp/p')).toBe(
      '/api/workflows/wf/env-preview?cwd=%2Ftmp%2Fp'
    );
    expect(buildWorkflowEnvPreviewPath('wf', '/tmp/p', null)).toBe(
      '/api/workflows/wf/env-preview?cwd=%2Ftmp%2Fp'
    );
    expect(buildWorkflowEnvPreviewPath('wf', '/tmp/p', 'env-1')).toBe(
      '/api/workflows/wf/env-preview?cwd=%2Ftmp%2Fp&envId=env-1'
    );
  });
});

describe('workflowEnvs request functions', () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listWorkflowEnvs hits collection and returns summaries', async () => {
    const envs = await listWorkflowEnvs('feature');
    expect(calls[0]?.url).toContain('/api/workflows/feature/envs');
    expect(envs).toEqual([{ id: 'e1', workflowName: 'feature', name: 'fast', updatedAt: 't' }]);
    // Summary shape has no patches field on the list response body entries we return.
    expect(envs[0]).not.toHaveProperty('patches');
  });

  test('getWorkflowEnv hits detail path', async () => {
    const env = await getWorkflowEnv('feature', 'e1');
    expect(calls[0]?.url).toContain('/api/workflows/feature/envs/e1');
    expect(env.id).toBe('e1');
    expect(env.patches).toEqual({});
  });

  test('previewWorkflowEnv omits envId for None/YAML', async () => {
    await previewWorkflowEnv('feature', '/tmp/p', null);
    expect(calls[0]?.url).toBe('/api/workflows/feature/env-preview?cwd=%2Ftmp%2Fp');
  });

  test('previewWorkflowEnv includes envId when selected', async () => {
    await previewWorkflowEnv('feature', '/tmp/p', 'env-9');
    expect(calls[0]?.url).toContain('envId=env-9');
  });

  test('createWorkflowEnv POSTs name + complete patches map', async () => {
    const patches = {
      plan: { provider: 'claude', model: 'sonnet' },
      run_bash: { bash: 'echo hi' },
    };
    // Collection path has no trailing /envs/:id — supply create-shaped body.
    stubFetch(() => ({
      env: {
        id: 'e1',
        workflowName: 'feature',
        name: 'fast',
        updatedAt: 't',
        patches,
        createdAt: 't',
        createdByUserId: null,
      },
    }));
    const env = await createWorkflowEnv('feature', { name: 'fast', patches });
    expect(calls[0]?.url).toContain('/api/workflows/feature/envs');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      name: string;
      patches: Record<string, unknown>;
    };
    expect(body.name).toBe('fast');
    expect(body.patches).toEqual(patches);
    expect(env.id).toBe('e1');
  });

  test('updateWorkflowEnv PATCHes complete patches map (not a deep delta)', async () => {
    const patches = { plan: { model: 'only-this' } };
    await updateWorkflowEnv('feature', 'e1', { name: 'faster', patches });
    expect(calls[0]?.url).toContain('/api/workflows/feature/envs/e1');
    expect(calls[0]?.init?.method).toBe('PATCH');
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      name: string;
      patches: Record<string, unknown>;
    };
    expect(body.name).toBe('faster');
    // Whole-document replace payload — caller supplies the full map.
    expect(body.patches).toEqual(patches);
    expect(Object.keys(body.patches)).toEqual(['plan']);
  });

  test('deleteWorkflowEnv DELETEs detail path', async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }) as typeof fetch;
    const res = await deleteWorkflowEnv('feature', 'e1');
    expect(calls[0]?.url).toContain('/api/workflows/feature/envs/e1');
    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(res.deleted).toBe(true);
  });
});
