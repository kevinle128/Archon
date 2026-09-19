import type { ProviderCapabilities } from '../../types';

/**
 * Devin CLI capabilities — every flag mirrors wired ACP behavior.
 * `askHuman` rides ACP elicitation of Devin's native ask_user_question tool.
 * `mcp` and `nativeTools` stay false: per-session ACP MCP servers are spawned
 * by Devin but never exposed to its model, so nothing Archon attaches per turn
 * can be called. Effort lives inside Devin model ids, hence no effortControl.
 */
export const DEVIN_CAPABILITIES = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: true,
  interrupt: false,
} as const satisfies ProviderCapabilities;
