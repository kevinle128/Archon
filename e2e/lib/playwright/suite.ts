import { test as base, expect } from '@playwright/test';

import { createArchonRuntime, type ArchonRuntime } from './archon-runtime';

type WorkerFixtures = {
  archon: ArchonRuntime;
  /**
   * Optional E2E-only idle-await duration (ms). When set, the worker's server
   * receives ARCHON_E2E_STEERING_IDLE_AWAIT_MS. Specs that omit it keep the
   * production 30-minute default.
   */
  idleAwaitMs: number | undefined;
};

/**
 * Test fixture: every worker gets its own isolated Archon runtime, and `baseURL`
 * points at that worker's server. Import `test`/`expect` from here instead of
 * from `@playwright/test`.
 */
export const test = base.extend<{}, WorkerFixtures>({
  idleAwaitMs: [undefined, { scope: 'worker', option: true }],
  archon: [
    async ({ idleAwaitMs }, use, workerInfo) => {
      const serverEnv =
        idleAwaitMs !== undefined
          ? { ARCHON_E2E_STEERING_IDLE_AWAIT_MS: String(idleAwaitMs) }
          : undefined;
      const runtime = await createArchonRuntime(workerInfo.workerIndex, { serverEnv });
      try {
        await use(runtime);
      } finally {
        await runtime.stop();
      }
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ archon }, use) => {
    await use(archon.baseURL);
  },
});

export { expect };
