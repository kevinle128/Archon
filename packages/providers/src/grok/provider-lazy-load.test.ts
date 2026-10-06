/**
 * Regression test: @agentclientprotocol/sdk must not load at module-import time.
 *
 * Grok is a BUILT-IN provider — `registry.ts` imports `grok/provider.ts`
 * statically, unlike DeepSeek/Devin (community providers, dynamically
 * imported). A static SDK value import anywhere in that module graph would
 * evaluate ACP on every Archon boot, even for installs that never run Grok.
 * `provider.ts` imports `./acp-client`'s runtime export as `import type`
 * only and loads the real function inside `acpQuery()` with a dynamic
 * `await import('./acp-client')`. Detection uses a factory counter, not a
 * throw, so a leak stays an assertion failure instead of an import crash.
 *
 * Runs in its own `bun test` invocation because Bun's `mock.module` is
 * process-wide and would poison `acp-client.test.ts` / `provider.test.ts`.
 */
import { expect, mock, test } from 'bun:test';

let acpSdkLoadCount = 0;

mock.module('@agentclientprotocol/sdk', () => {
  acpSdkLoadCount += 1;
  return {};
});

test('importing the registry and instantiating GrokProvider does not evaluate the ACP SDK', async () => {
  const { GrokProvider } = await import('./provider');
  const { clearRegistry, getProviderCapabilities, registerBuiltinProviders } =
    await import('../registry');

  clearRegistry();
  registerBuiltinProviders();
  expect(getProviderCapabilities('grok')).toBeDefined();

  const provider = new GrokProvider();
  expect(provider.getType()).toBe('grok');
  expect(provider.getCapabilities()).toBeDefined();
  expect(acpSdkLoadCount).toBe(0);
});
