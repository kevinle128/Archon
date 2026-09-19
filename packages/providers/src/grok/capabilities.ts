import type { ProviderCapabilities } from '../types';

export const GROK_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: true,
  agents: true,
  toolRestrictions: true,
  structuredOutput: 'enforced',
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: false,
  interrupt: false,
};
