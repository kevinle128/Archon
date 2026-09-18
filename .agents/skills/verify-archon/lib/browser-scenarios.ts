import { createRequire } from 'node:module';
import { env as hostEnvironment } from 'node:process';
import { join, relative, basename } from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { z } from '@hono/zod-openapi';
import { command } from './cli-scenarios';
import { TOOLING_REPO, writeJson, contains } from './io';
import type { ScenarioResult } from './contract';

export const browserCases: Record<string, string[]> = {
  'ui.rooms': ['hitl.console-room-layout', 'hitl.legacy-room-layout', 'hitl.graph-selection', 'hitl.artifacts-room', 'hitl.room-deeplink', 'hitl.console-mobile-back', 'hitl.legacy-mobile-back'],
  'ui.tools': ['hitl.tool-row-console', 'hitl.tool-row-legacy', 'hitl.tool-row-console-sweep', 'hitl.tool-row-legacy-sweep', 'hitl.tool-row-contrast'],
  'ui.ask': ['hitl.console-ask-submit', 'hitl.web-ask-resume', 'hitl.ask-history', 'hitl.awaiting-focus', 'hitl.mobile-ask'],
  'ui.visual': ['verify.visual-captures'],
};
const testResultSchema = z.object({
  status: z.string(), errors: z.array(z.unknown()).optional(),
  attachments: z.array(z.object({ name: z.string(), path: z.string().optional(), body: z.string().optional() })).optional(),
});
const suiteSchema = z.object({
  title: z.string().optional(),
  specs: z.array(z.object({
    title: z.string(), tests: z.array(z.object({
      expectedStatus: z.string(), status: z.string(), results: z.array(testResultSchema),
    })),
  })).optional(),
  get suites(): z.ZodOptional<z.ZodArray<typeof suiteSchema>> { return z.array(suiteSchema).optional(); },
});

export async function runBrowserScenario(repo: string, id: string, evidence: string): Promise<ScenarioResult> {
  const cases = browserCases[id];
  if (!cases) throw new Error(`Unknown browser binding ${id}`);
  const errors: string[] = [];
  const attachments: ScenarioResult['attachments'] = [];
  const directory = join(evidence, id);
  await mkdir(directory);
  try {
    const resolveDependency = createRequire(join(TOOLING_REPO, 'e2e/package.json'));
    const cli = resolveDependency.resolve('@playwright/test/cli');
    const pattern = cases.map(item => '\\[V:' + item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]').join('|');
    const env = Object.fromEntries(Object.entries(hostEnvironment).filter((pair): pair is [string, string] => pair[1] !== undefined));
    const output = await command(['node', cli, 'test', '-c', 'playwright.config.ts', '--grep', pattern,
      '--reporter=json', '--workers=1', '--retries=0', '--output', join(directory, 'test-results')],
    join(TOOLING_REPO, 'e2e'), { ...env, ARCHON_E2E_REPO_ROOT: repo,
      ARCHON_E2E_PORT_BASE: '13400', ARCHON_E2E_PROOF: '1', ARCHON_PW_CHANNEL: env.ARCHON_PW_CHANNEL ?? 'chrome',
      ARCHON_VERIFY_EVIDENCE: directory,
    }, 600_000);
    await writeJson(join(directory, 'command.json'), output);
    attachments.push({ name: `${id}.command`, path: `${id}/command.json` });
    if (output.exit !== 0) errors.push(`Playwright exited ${output.exit}`);
    const report = z.object({ suites: z.array(suiteSchema), errors: z.array(z.unknown()).optional() }).parse(JSON.parse(output.stdout));
    await writeJson(join(directory, 'report.json'), report);
    attachments.push({ name: `${id}.report`, path: `${id}/report.json` });
    if (report.errors?.length) errors.push(JSON.stringify(report.errors));
    const specs: NonNullable<z.infer<typeof suiteSchema>['specs']> = [];
    const walk = (suite: z.infer<typeof suiteSchema>): void => {
      specs.push(...suite.specs ?? []);
      suite.suites?.forEach(walk);
    };
    report.suites.forEach(walk);
    for (const expected of cases) {
      const matching = specs.filter(spec => spec.title.includes(`[V:${expected}]`));
      if (matching.length !== 1) errors.push(`Expected one executable test for ${expected}; found ${matching.length}`);
    }
    if (specs.length !== cases.length) errors.push('Unexpected executable test set');
    let index = 0;
    for (const spec of specs) {
      for (const test of spec.tests) {
        if (test.expectedStatus !== 'passed' || test.status !== 'expected' || test.results.length !== 1 || test.results[0].status !== 'passed') {
          errors.push(`${spec.title}: ${JSON.stringify(test.results.map(result => ({ status: result.status, errors: result.errors })))}`);
        }
        for (const result of test.results) {
          for (const attachment of result.attachments ?? []) {
            if (!attachment.path) continue;
            const destination = join(directory, `${String(index++)}-${basename(attachment.path)}`);
            // Copy only files produced beneath this invocation's declared output.
            if (!contains(directory, attachment.path)) throw new Error('Playwright attachment escaped the current attempt');
            await copyFile(attachment.path, destination);
            attachments.push({ name: `${id}.${String(index)}.${attachment.name}`, path: relative(evidence, destination) });
          }
        }
      }
    }
    if (id === 'ui.visual') {
      const { reviewVisualEvidence } = await import('./visual-review');
      const review = await reviewVisualEvidence(repo, evidence, directory);
      attachments.push(...review.attachments);
      errors.push(...review.errors);
    }
    // Reading the fresh report here makes a missing current file a proof failure.
    await readFile(join(directory, 'report.json'));
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  return { id, status: errors.length ? 'failed' : 'passed', errors, attachments };
}
