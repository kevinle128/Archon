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
  // Verified false against the real binary. No transport is currently
  // wired at all — the shipped adapter uses `--single` (one-shot argv
  // prompt, no stdin/no ACP), which cannot Stop or resume mid-turn by
  // construction. The alternative real transport, `grok agent stdio`
  // (ACP), was re-gated on grok 1.0.41 (up from 1.0.30/1.0.34 at the prior
  // spikes): GROK_SPIKE_ONLY=B7,B9 (spike:interrupt:grok) still finds
  // descendantsAliveAfterExit true for both the owned-tree mid-tool Stop
  // and node-Cancel tree-termination gates — the same process-tree reaping
  // failure the original round-2 spike found, unchanged across two binary
  // versions. Text-only Stop/resume/fork passed in the original spike;
  // mid-tool Stop did not, and a capability is not advertised on a partial
  // pass.
  interrupt: false,
  // Verified false: gated behind `interrupt !== false` regardless. Also
  // independently disproven on its own terms — see deliveryAck below.
  softInjection: false,
  // Verified false against the real binary (acp-handshake-spike.ts): a
  // generic ACP client (`initialize` -> `session/new` -> `session/prompt`)
  // reaches a live mid-turn session. `x.ai/interject` (the exact literal
  // recovered from the binary by the earlier scout) returns JSON-RPC
  // -32601 "Method not found" — wrong name. Every OTHER server-emitted
  // notification in the same session uses an `_x.ai/...` (underscored)
  // namespace; retrying as `_x.ai/interject` gets -32602 "Invalid params"
  // instead of -32601, proving the METHOD is recognized under that name.
  // Two param shapes were tried (`{sessionId, message}` and `{sessionId,
  // prompt: ContentBlock[]}`, matching `session/prompt`) — both rejected
  // the same way. The exact required shape is unresolved; a live client is
  // reachable but this spike could not complete a successful call within
  // its time-box. This narrows but does not fully resolve whether the
  // method is reachable by an arbitrary ACP client at all — a follow-up
  // spike with more param-shape guesses (or captured traffic from grok's
  // own pager) is the next step, not a dead end.
  deliveryAck: false,
};
