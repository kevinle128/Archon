import type { ProviderCapabilities } from '../types';

/**
 * Capabilities for the E2E fake provider.
 *
 * The fake exists to drive real executor paths without a paid AI call.
 * Usage still comes from the prompt directive. `nativeTools`, `askHuman`, and
 * `sessionResume` are on only because the implementation in `provider.ts`
 * actually calls `NativeTool.handler`, propagates `AskHumanAwaitingError`, and
 * consumes `resumeInteractions`. Other optional features stay off so a workflow
 * node that relies on one is warned exactly as it would be for any provider
 * lacking that capability. `structuredOutput` is `false` — the fake does not
 * honor `output_format`.
 */
export const E2E_FAKE_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: false,
  envInjection: false,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: true,
  containerExec: false,
  askHuman: true,
  interrupt: 'native', // deterministic equivalent so E2E runs exercise the interrupt branch
};
