import assert from 'node:assert/strict';
import { env } from 'node:process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import { z } from '@hono/zod-openapi';
import { TOOLING_REPO, writeJson } from './io';
import type { ScenarioResult } from './contract';
import type { ArchonRuntime } from '../../../../e2e/lib/playwright/archon-runtime';

export async function runApiScenario(repo: string, id: string, evidence: string): Promise<ScenarioResult> {
  env.ARCHON_E2E_REPO_ROOT = repo;
  env.ARCHON_E2E_PORT_BASE = '13400';
  const runtimeModule: typeof import('../../../../e2e/lib/playwright/archon-runtime') =
    await import(pathToFileURL(join(TOOLING_REPO, 'e2e/lib/playwright/archon-runtime.ts')).href);
  const transcript: unknown[] = [];
  const errors: string[] = [];
  let runtime: ArchonRuntime | undefined;
  let cleaned = false;
  const attachment = `${id}.json`;
  try {
    runtime = await runtimeModule.createArchonRuntime(0);
    const active = runtime;
    const call = async (path: string, method = 'GET', body?: unknown, status = 200): Promise<unknown> => {
      const response = await fetch(active.baseURL + path, {
        method, headers: { 'Content-Type': 'application/json', 'X-Archon-User': active.starterWebUser },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      transcript.push({ path, method, body, status: response.status, response: text });
      await writeJson(join(evidence, attachment), { transcript, cleaned });
      assert.equal(response.status, status, `${method} ${path}: ${text}`);
      return JSON.parse(text) as unknown;
    };
    await call('/api/health');
    assert.equal(z.object({ enabled: z.boolean() }).parse(await call('/api/auth/status')).enabled, false);
    const project = z.object({ id: z.string(), default_cwd: z.string() }).parse(await call('/api/codebases', 'POST', { path: active.workdir }, 201));
    const conversation = z.object({ conversationId: z.string() }).parse(await call('/api/conversations', 'POST', { codebaseId: project.id }));
    await call(`/api/conversations/${conversation.conversationId}`, 'PATCH', { title: 'Verifier conversation' });
    assert.ok(JSON.stringify(await call(`/api/conversations/${conversation.conversationId}`)).includes('Verifier conversation'));
    await call('/api/conversations', 'POST', { codebaseId: 10 }, 400);
    const target = `?cwd=${encodeURIComponent(project.default_cwd)}&source=project`;
    const workflow = { name: 'verify-http', description: 'Verification HTTP fixture', nodes: [{ id: 'done', bash: 'echo http-complete' }] };
    await call('/api/workflows/verify-http' + target, 'PUT', { definition: workflow });
    assert.ok(JSON.stringify(await call('/api/workflows/verify-http' + target)).includes('http-complete'));
    await call('/api/workflows/verify-http' + target, 'PUT', { definition: { ...workflow, nodes: [{ id: 'done', bash: 'echo updated' }] } });
    assert.ok(JSON.stringify(await call('/api/workflows/verify-http' + target)).includes('updated'));
    await call('/api/workflows/verify-http' + target, 'DELETE');
    await call('/api/workflows/verify-http' + target, 'GET', undefined, 404);
    await call('/api/workflows/validate', 'POST', { definition: 'invalid' }, 400);

    const started = await active.runHitlWorkflowViaWeb();
    transcript.push({ webStartedRun: started });
    const detailSchema = z.object({
      run: z.object({ status: z.string() }),
      pending_interactions: z.array(z.object({ tool_use_id: z.string(), status: z.string(), answer: z.unknown().optional() }).passthrough()),
    });
    const path = `/api/workflows/runs/${started.runId}`;
    const paused = detailSchema.parse(await call(path));
    assert.equal(paused.run.status, 'paused');
    const request = paused.pending_interactions.find(item => item.status === 'pending');
    assert.ok(request, 'Real Ask invocation must create a pending request');
    const answerPath = `${path}/ask/${encodeURIComponent(request.tool_use_id)}/answer`;
    const answer = { answers: [{ questionId: 'proceed', value: 'yes' }] };
    await call(answerPath, 'POST', answer);
    await call(answerPath, 'POST', answer, 409);
    await active.waitForRunStatus(started.runId, 'completed');
    const completed = detailSchema.parse(await call(path));
    assert.equal(completed.run.status, 'completed');
    assert.deepEqual(completed.pending_interactions.find(item => item.tool_use_id === request.tool_use_id)?.answer, answer);
    await call(`/api/conversations/${conversation.conversationId}`, 'DELETE');
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  finally {
    try {
      if (runtime) {
        const home = runtime.home;
        await runtime.stop();
        assert.equal(await stat(home).then(() => true, () => false), false, 'Runtime scratch must be removed');
        transcript.push({ home, baseURL: runtime.baseURL, cleanup: 'stopped and removed' });
      }
      cleaned = true;
    } catch (error) { errors.push(`Cleanup failed: ${String(error)}`); }
    await writeJson(join(evidence, attachment), { transcript, cleaned, errors });
  }
  return { id, status: errors.length ? 'failed' : 'passed', errors,
    attachments: [{ name: `${id}.transcript`, path: attachment }] };
}
