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
  // Verified false against the real binary (spike:interrupt:omp, omp/18.1.21,
  // re-confirmed 2026-09-27): the shipped `--mode json` + SIGTERM path
  // cannot resume a freshly-interrupted session from disk — both the
  // assistant-text and active-tool conformance cases failed resume this
  // run (a prior run passed active-tool; this run did not, so the failure
  // is not even consistent across runs). `--mode rpc` looks like the real
  // fix (spike:rpc:omp: an in-band `{type:"abort"}` never kills the
  // process, and a same-pid redirect afterward correctly proved it kept
  // turn 1's context) but the abort command's own acknowledgement did not
  // reliably echo back by id across repeated runs, and porting the
  // provider's whole turn loop, event parser, and usage tracker to RPC
  // framing is a substantial migration, not something a conformance spike
  // alone can prove.
  interrupt: false,
  interruptedToolStatus: false, // no turn interrupt at all, so no per-tool proof either
  // Verified false: RPC `steer` sent in the documented "between tool calls"
  // gap did not change the model's already-planned next tool call — the
  // second call still ran unchanged, and the steer content was appended as
  // a queued follow-up turn after the original plan finished (`followUp`
  // semantics, not mid-turn injection). Gated behind `interrupt` regardless
  // (softInjection requires interrupt !== false).
  softInjection: false,
  // Verified false: no built or spiked transport surfaces a provider
  // acknowledgement correlated to a caller-stamped message id.
  deliveryAck: false,
};
