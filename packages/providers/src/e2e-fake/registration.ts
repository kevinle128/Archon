import { isRegisteredProvider, registerProvider } from '../registry';

import { E2E_FAKE_CAPABILITIES, E2E_FAKE_SOFT_INJECT_CAPABILITIES } from './capabilities';
import { E2E_FAKE_SOFT_INJECT_PROVIDER_ID, E2eFakeProvider } from './provider';

/**
 * Register the E2E fake provider — ONLY when `ARCHON_E2E_FAKE_PROVIDER` is set.
 *
 * Called from `registerCommunityProviders()` so every entrypoint that sets up
 * providers (server, CLI, config-loader bootstrap) picks it up uniformly; the
 * env gate keeps it entirely absent from the registry in production, so it
 * never appears in the capability matrix and a workflow referencing
 * `provider: e2e-fake` fails load exactly as any unknown provider would.
 */
export function registerE2eFakeProvider(): void {
  if (!process.env.ARCHON_E2E_FAKE_PROVIDER) return;
  if (!isRegisteredProvider('e2e-fake')) {
    registerProvider({
      id: 'e2e-fake',
      displayName: 'E2E Fake',
      factory: () => new E2eFakeProvider(),
      capabilities: E2E_FAKE_CAPABILITIES,
      builtIn: false,
      credentials: { kind: 'static', specs: [] },
    });
  }
  if (!isRegisteredProvider(E2E_FAKE_SOFT_INJECT_PROVIDER_ID)) {
    registerProvider({
      id: E2E_FAKE_SOFT_INJECT_PROVIDER_ID,
      displayName: 'E2E Fake (soft injection)',
      factory: () => new E2eFakeProvider({ softInjectable: true }),
      capabilities: E2E_FAKE_SOFT_INJECT_CAPABILITIES,
      builtIn: false,
      credentials: { kind: 'static', specs: [] },
    });
  }
}
