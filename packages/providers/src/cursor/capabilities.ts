import type { ProviderCapabilities } from '../types';

/**
 * Cursor Agent SDK capabilities wired through Archon's provider contract.
 *
 * Keep nearby-but-untranslated SDK features false. In particular, Cursor's
 * local sandbox currently exposes only an enabled flag while Archon's
 * `sandbox:` node field carries a richer policy, and Cursor has no
 * schema-constrained final response API.
 */
export const CURSOR_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: true,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: true,
  structuredOutput: 'best-effort',
  envInjection: false,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: true,
  containerExec: false,
  askHuman: false,
  interrupt: 'native',
  interruptedToolStatus: false,
  softInjection: false,
  deliveryAck: false,
};
