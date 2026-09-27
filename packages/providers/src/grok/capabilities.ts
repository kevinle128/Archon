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
  // Still false, but the underlying mechanism is now proven, not just
  // blocked: the shipped adapter uses `--single` (one-shot argv prompt,
  // `stdin: 'ignore'`) — there is no channel to send anything on mid-turn,
  // so the OS-level SIGTERM/SIGKILL path in `interrupt-resume-spike.ts`
  // (B7/B9) reliably finds surviving descendants (owned-tree mid-tool Stop
  // and node-Cancel both fail on grok 1.0.41/1.0.42). The alternative real
  // transport, `grok agent stdio` (ACP), has an in-band `session/cancel`
  // notification that asks the agent to stop its OWN turn instead of being
  // killed from outside: `session-cancel-spike.ts` ran this against a
  // fingerprinted, confirmed-alive tool-process descendant and got a clean
  // reap 6/6 (3 trials each on 1.0.41 and 1.0.42) in 16-27ms, every time,
  // with `stopReason: "cancelled"`. Session continuation after cancel also
  // passed 6/6, both same-process (`session/prompt` again on the identical
  // connection) and cross-process (`session/load` from a brand-new spawn
  // with no `--resume` flag, the shape Archon's per-call `sendQuery()`
  // would actually need) — the model recalled a planted token both ways.
  // This is a stronger, cleaner result than OMP's RPC-mode finding (whose
  // abort ack was not reliably acknowledged): Grok's is fully green. Still
  // `false` because adopting it means swapping `--single` for `agent
  // stdio` project-wide, not toggling a flag — every `buildGrokArgs()` CLI
  // flag (`--tools`/`--disallowed-tools`, `--json-schema`,
  // `--system-prompt-override`/`--rules`, `--agents`, `--session-id`/
  // `--fork-session`, `--permission-mode`) would need an ACP-protocol
  // equivalent re-verified one by one, exactly the kind of transport
  // migration this same phase scoped as its own follow-up story for OMP's
  // RPC mode rather than a rushed leg of this one.
  interrupt: false,
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
