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
  // `sendQuery()` now defaults to `grok agent stdio` (ACP) instead of
  // `--single`, specifically to make this true: the shipped `--single`
  // transport (one-shot argv prompt, `stdin: 'ignore'`) has no channel to
  // send anything on mid-turn, so the OS-level SIGTERM/SIGKILL path in
  // `interrupt-resume-spike.ts` (B7/B9) reliably finds surviving
  // descendants. ACP's in-band `session/cancel` notification asks the agent
  // to stop its OWN turn instead: `session-cancel-spike.ts` ran this
  // against a fingerprinted, confirmed-alive tool-process descendant and
  // got a clean reap 6/6 (3 trials each on grok 1.0.41 and the 1.0.42
  // alpha) in 16-27ms, every time, with `stopReason: "cancelled"`. Session
  // continuation after cancel also passed 6/6, both same-process and
  // cross-process (`session/resume` from a brand-new spawn — the shape
  // Archon's per-call `sendQuery()` needs) — the model recalled a planted
  // token both ways. Not `'native'`: `runGrokAcpTurn` spawns a fresh
  // process per call and closes the session on every turn end, so a
  // redirect after Stop is a cold `session/resume`, not a kept-warm
  // connection — same posture as the DeepSeek ACP client.
  //
  // Not every `buildGrokArgs()` CLI flag has a verified ACP equivalent
  // (`--tools`/`--disallowed-tools`, `--json-schema`,
  // `--system-prompt-override`/`--rules`, `--agents`, `--fork-session`,
  // and any `--permission-mode` beyond the default all had no proof found
  // live — see `selectGrokTransport()` in `provider.ts` for the exact
  // evidence per flag). Those node configs still run on `--single`, losing
  // Stop for that one turn only; `sendQuery()` says so in a `system` chunk
  // since this flag cannot vary per turn.
  interrupt: 'stream-abort',
  // ACP's `tool_call_update` has no distinct cancelled status either (same
  // as DeepSeek): a tool cut short by `session/cancel` observed live never
  // received ANY terminal update at all, so the fallback settles it
  // `'unknown'` (`closeOutstandingGrokAcpTools`) rather than a guessed
  // `'interrupted'` — there is no per-tool marker to remap from.
  interruptedToolStatus: false,
  // Verified false: gated behind `interrupt !== false` regardless. Also
  // independently disproven on its own terms — see deliveryAck below.
  softInjection: false,
  // Verified false against the real binary. `interject-param-spike.ts`
  // resolved the param shape a prior scout left open: `_x.ai/interject`
  // (underscored; the unprefixed `x.ai/interject` is still -32601 Method
  // not found) takes `{sessionId, text: string}` — a flat string field, not
  // the `ContentBlock[]` shape `session/prompt` uses. Six guesses nesting
  // the message under `content`/`prompt` all failed identically with
  // `-32602 invalid params: missing field \`text\`` (captured via the
  // JSON-RPC error's own `data`, not just its code) until the flat shape
  // was tried, which returned a genuine result. But a successful ack alone
  // is not soft injection: `interject-mechanism-spike.ts` ran the same
  // discriminator the OMP RPC `steer` finding used — two sequential shell
  // tool calls, interject sent in the gap between the first call's result
  // and the second call's dispatch, instructing the model to skip the
  // second one — and the second call ran anyway
  // (`secondCallRanAnyway: true`). The interject content is not consulted
  // before the model's already-planned next tool call, matching OMP's
  // `followUp` semantics (CAP-8 Queue) rather than CAP-12 mid-turn
  // injection. `deliveryAck` is unrelated: nothing resembling Claude's
  // `--replay-user-messages` echo-back was found for Grok on either
  // transport, so there is no acknowledgement channel to wire regardless
  // of `interrupt`/`softInjection`.
  deliveryAck: false,
};
