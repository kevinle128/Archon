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
  // Mirrors Claude's proof shape (see provider.ts's own 'interrupted' toolOutcome)
  // so E2E runs also exercise the tool-level-proof presentation branch.
  interruptedToolStatus: true,
  softInjection: false,
  deliveryAck: false,
};

/**
 * Variant that also declares mid-turn soft injection and delivery
 * acknowledgement, registered under its own provider id so the default
 * `e2e-fake` provider keeps its queue-only behavior. It models the accepted
 * transport contract: a message handed to the live turn is echoed back by id
 * (`operator_delivery_ack`) only once the turn reaches its next boundary.
 */
export const E2E_FAKE_SOFT_INJECT_CAPABILITIES: ProviderCapabilities = {
  ...E2E_FAKE_CAPABILITIES,
  softInjection: true,
  deliveryAck: true,
};
