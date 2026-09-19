import type { ProviderCapabilities } from '../../types';

/**
 * OMP capabilities wired through Archon's node fields.
 * A capability remains false when OMP supports a nearby feature but Archon's corresponding node field is not translated.
 */
export const OMP_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: true,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: true,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: false,
  interrupt: false,
};
