import type { ProviderCapabilities } from '../../types';

/**
 * DeepSeek Harness capabilities — flags must match wired ACP behavior.
 * `mcp: true` is stdio + Streamable HTTP only; SSE is rejected at conversion.
 */
export const DEEPSEEK_CAPABILITIES = {
  sessionResume: true,
  mcp: true,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
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
} as const satisfies ProviderCapabilities;
