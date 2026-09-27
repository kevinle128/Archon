import type { ProviderCapabilities } from '../../types';

/**
 * OMP capabilities wired through Archon's node fields.
 * A capability remains false when OMP supports a nearby feature but Archon's corresponding node field is not translated.
 */
export const OMP_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: false,
  hooks: false,
  skills: true,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'best-effort',
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: true,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
  askHuman: false,
  // Verified true against the real binary (omp/18.1.21, 2026-09-27): the
  // provider now runs `--mode rpc` as a warm per-node-session process. Stop
  // sends the in-band `{type:"abort"}` command without killing the child —
  // classified from the turn's own terminal event (the aborted assistant
  // message's `stopReason: 'aborted'`), never from the abort command's own
  // JSON-RPC response, which stays unreliable exactly as the earlier
  // `--mode json` + SIGTERM spike found. Verified on both mid-text-stream
  // and mid-active-tool-call Stop, each followed by a same-process redirect
  // that proved it kept the interrupted turn's context. `'stream-abort'`
  // (not `'native'`): the executor synthesizes the interrupted result from
  // `STREAM_ABORTED_TERMINAL_REASON`, matching every other adapter that
  // aborts its own transport rather than calling an SDK-native interrupt —
  // the distinction here is that the child process itself is never killed.
  interrupt: 'stream-abort',
  // The aborted turn reports no per-tool interrupted status, so a tool still
  // open at Stop settles 'unknown' instead of a guessed 'interrupted'.
  interruptedToolStatus: false,
  // Verified false on the RPC transport too: `steer` sent in the documented
  // "between tool calls" gap did not change the model's already-planned
  // next tool call — the second call still ran unchanged, and the steer
  // content was appended as a queued follow-up turn after the original plan
  // finished (`followUp` semantics, not mid-turn injection). Independently
  // gated behind `interrupt` regardless.
  softInjection: false,
  // Verified false: no built or spiked transport surfaces a provider
  // acknowledgement correlated to a caller-stamped message id. The abort
  // command's own response is the closest candidate and it is unreliable
  // (see `interrupt` above), so it is not a delivery-ack transport either.
  deliveryAck: false,
};
