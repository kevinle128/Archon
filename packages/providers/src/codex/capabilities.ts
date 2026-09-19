import type { ProviderCapabilities } from '../types';

export const CODEX_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: true,
  hooks: false,
  // Codex has native filesystem skills, but does not implement Archon's per-node
  // `skills:` list. Workflow nodes suppress the automatic catalog and authors
  // invoke installed skills explicitly with `$skill-name` in the node body.
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'enforced', // SDK outputSchema grammar-constrains decoding
  envInjection: true,
  costControl: false,
  // Codex reads node-level `effort:` and passes the provider-owned value to the SDK.
  effortControl: true,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false, // Claude Agent SDK-only knob (which setting sources the agent loads)
  nativeTools: false,
  containerExec: false, // no in-container spawn path yet (fail-fast source of truth)
  askHuman: false,
  interrupt: false,
};
