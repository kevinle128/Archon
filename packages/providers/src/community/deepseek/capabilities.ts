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
  // Verified against the real DSH `acp` profile binary on a live subscription
  // (route alibaba/deepseek-v4.1-flash) — Stop cancels the in-flight prompt
  // via ACP session/cancel, the node stays active and idles for redirect,
  // and the next turn resumes the SAME session id via session/resume (a
  // failed resume would surface as deepseek_resume_failed; it did not).
  // Not 'native': the session is closed and cold-resumed, not kept warm.
  interrupt: 'stream-abort',
  // ACP's tool_call_update status collapses to success/error only; DSH never
  // reports a cancelled tool distinct from the session-level abort, so a
  // still-open tool at turn end settles 'unknown', not a guessed 'interrupted'.
  interruptedToolStatus: false,
  softInjection: false,
  deliveryAck: false,
} as const satisfies ProviderCapabilities;
