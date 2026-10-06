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
  // The executor fallback settles a tool that never received a result as
  // 'unknown': ACP has no distinct cancelled tool status. A tool that DSH
  // reports as `failed` during an operator Stop is still remapped to
  // 'interrupted' by the adapter itself (verified live), so that row keeps
  // its proven interrupted outcome.
  interruptedToolStatus: false,
  // Verified false against the real DSH `acp` profile: a second
  // `session/prompt` sent while a tool call is in flight is refused with
  // -32602 "a prompt is already in flight for this session", and the
  // installed DSH package defines no vendor method that injects a message
  // into a running prompt. A queued message waits for the turn boundary.
  softInjection: false,
  deliveryAck: false,
} as const satisfies ProviderCapabilities;
