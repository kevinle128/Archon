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
  // Stop for that one turn only; this flag cannot vary per turn, so
  // `sendQuery()` reports the downgrade with a typed `turn_not_interruptible`
  // chunk instead (see `selectGrokTransport()`'s doc comment).
  interrupt: 'stream-abort',
  // ACP's `tool_call_update` has no distinct cancelled status either (same
  // as DeepSeek): a tool cut short by `session/cancel` observed live never
  // received ANY terminal update at all, so the fallback settles it
  // `'unknown'` (`closeOutstandingGrokAcpTools`) rather than a guessed
  // `'interrupted'` — there is no per-tool marker to remap from.
  interruptedToolStatus: false,
  // Verified TRUE against the real binary on the ACP transport: `_x.ai/interject`
  // (`{sessionId, text}`, acked `{result: {status: 'queued'}}`) sent while a shell tool
  // call is in flight is consumed by the model inside the SAME
  // `session/prompt` turn - one prompt response, `end_turn`, and the final
  // answer carried the operator's requested token, in every run. An earlier
  // spike judged the method a queued follow-up because it required the
  // interject to cancel an already-dispatched second tool call; a message is
  // read at the model's next step, so that bar tested preemption, not
  // same-turn delivery. Only the ACP transport has the method. A turn that
  // falls back to `--single` (see `selectGrokTransport()`) reports
  // `turn_not_interruptible`, which projects no steering sub-state for that
  // turn, so the dock offers no per-item Send now and the send route answers
  // 409 if one arrives anyway; the entry stays queued.
  softInjection: true,
  // Verified false against the real binary: nothing resembling Claude's
  // `--replay-user-messages` echo-back exists on either transport (an
  // interject is acked `queued` with no later echo of the message), so an
  // injected entry stays `sent` and is never advanced to `delivered`.
  deliveryAck: false,
};
