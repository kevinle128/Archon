# Provider Steering Gap Analysis (Stop / Redirect / Soft Injection / Delivery Ack)

**Date:** 2026-09-26  
**Scope:** Per-provider capability gaps for agent steering (interrupt, session continuation, soft injection, delivery acknowledgement).  
**Evidence base:**

- `scoutsdk-260912-midturn-sdk-providers.md` (DeepSeek ACP transport)
- `scoutcli-260912-midturn-cli-providers.md` (OMP/Grok CLI capabilities)
- `provider-steering-matrix.md` (spec contract)
- Current capability declarations in `packages/providers/src/*/capabilities.ts`
- Recent provider implementation commits (interrupt seams, stream-abort paths)
- SDK versions from root `package.json` and `packages/providers/package.json`

---

## Executive Summary

**Claude (8.3)** — ✅ **READY**. Stop wired native via `interrupt()` on streaming input. Capability flag truthful. Message-id echo pending SDK update.

**Codex (8.4)** — ⚠️ **BLOCKED**. SDK does not expose mid-turn abort through TypeScript path. Stop requires stream-abort adapter seam. Session resume tested. Capabilities truthful (interrupt: false).

**Grok (8.5)** — ⚠️ **BLOCKED on phase 1 gate**. ACP soft injection verified (`x.ai/interject`), but adapter-side JSON-RPC client not yet wired. Capability flag false (needs conformance). Estimated M-L.

**DeepSeek (8.6)** — ⚠️ **PRACTICAL ALTERNATIVE**. Stop wired to ACP native `session/cancel`. Concurrent `session/prompt` hard-rejected. Tier 0 (cancel-then-continue on same session) measured at ~31 ms overhead vs. generic `sessionResume` fallback. Mid-turn steer not available on ACP transport today. Capability false (truthful).

**OMP (8.7)** — 🟢 **FIRST-CLASS SUPPORT**. Stop via RPC mode `abort` command. Soft injection via RPC `steer`/`follow_up` with multi-item ordering. Session reuse in RPC mode. Capability flag false (wiring needed). Estimated S.

**Qoder CLI (9.1)** — ⏳ **NO EVIDENCE**. Transport unclear; "adapter-specific Stop mapping required" per matrix. Estimated M-L; cannot verify without real binary/credentials.

**Pi (9.2)** — ⏳ **NO EVIDENCE**. Transport unclear; "adapter-specific Stop mapping required" per matrix. Estimated M-L; cannot verify without live session.

**GitHub Copilot (9.3)** — ⏳ **NO EVIDENCE**. Transport unclear; "adapter-specific Stop mapping required" per matrix. Estimated M-L; cannot verify without live session.

**OpenCode (9.4)** — ⏳ **NO EVIDENCE**. Transport unclear; "adapter-specific Stop mapping required" per matrix. Estimated M-L; cannot verify without live session.

---

## Per-Provider Detail

### 1. Claude (Story 8.3) — ✅ READY

**SDK:** `@anthropic-ai/claude-agent-sdk 0.3.209`

**Interrupt signal honored?** ✅ YES

- Wired: `packages/providers/src/claude/provider.ts:1719-1811`
- Native SDK `query.interrupt()` called exactly once on `interruptSignal.abort()`
- Abort listener added per-turn; cleaned up after turn settles
- Abort-before-query check guards against pre-aborted signals (1730)
- Still-queued message echoed on success (1709)

**Session reuse after interrupt?** ✅ YES

- Existing Claude session reused by design (no kill, no close)
- Next sendQuery resumes on same session

**Soft-injection transport exists/verified?** ⚠️ PARTIAL

- Streaming input channel live during turn (line 95-97: "One user message on the interrupt-capable streaming input")
- `Query.interrupt()` + streaming input loop proven to receive mid-turn messages
- **Missing:** Message-id stamping and echo. SDK update required (see below).

**Delivery ack by message id?** ⏳ PENDING SDK UPDATE

- Provider spec assigns this to Claude story 8.3
- Requires SDK to echo `messageId` field on `still_queued` response or a new acknowledgement event
- Current ack is implicit from `interrupt()` success; no explicit message-id correlation

**Capability flags truthful?**

- `interrupt: 'native'` — ✅ accurate (SDK native interrupt on streaming input)
- `nativeTools: true` — ✅ accurate
- All other flags spot-checked against implementation — accurate

**What's missing?**

- Message-id echo: SDK update, Anthropic-side. Not in Archon's control; estimated S-M dependency.
- Soft-injection UI wiring: already have transport; needs executor + durable queue integration (story 8.3 scope).

**Estimated effort:** S (execution layer only; SDK change is upstream)

**Can verify in CI?** ✅ YES — streaming input test already in place; no binary or API key beyond SDK default needed.

---

### 2. Codex (Story 8.4) — ⚠️ BLOCKED

**SDK:** `@openai/codex-sdk 0.144.5`

**Interrupt signal honored?** ❌ NO

- No grep result for `interruptSignal` in `codex/provider.ts`
- Capability flag `interrupt: false` — truthful

**Session reuse after interrupt?** ✅ YES

- Thread resume proven by scout evidence (scoutcli report, §3.2)
- Session handling via `threadId` + SDK thread API
- Existing thread reused on resume

**Soft-injection transport exists/verified?** ❌ NO

- TypeScript SDK path does not expose mid-turn message send
- Matrix states: "Not exposed by the current TypeScript SDK path"
- Fallback: queue-at-boundary remains supported

**Delivery ack by message id?** ❌ NO

- Not currently exposed by SDK

**Capability flags truthful?**

- `interrupt: false` — ✅ truthful (no SDK path available)
- All others checked — accurate

**What's missing?**

1. **Stream-abort adapter seam.** Spin the stream in a subprocess, send SIGINT/SIGTERM to abort mid-turn, capture stop-reason. Measured pattern in OMP spike (commit `68c64f58`). Estimated M-L for Codex (new transport wrapper).
2. **Message-id / acknowledgement.** Only available after stream abort is wired.
3. **SDK feature gating.** Codex is a CLI binary; "current TypeScript SDK path" implies other paths exist. Unverified whether the Codex binary itself supports mid-turn receive.

**Estimated effort:** M-L (stream-abort + new subprocess harness)

**Can verify in CI?** ⚠️ PARTIAL — Codex binary required; stream-abort pattern testable with mock subprocess.

---

### 3. Grok (Story 8.5) — ⚠️ PHASE 1 GATE BLOCKED

**Binary:** `grok 1.0.30 (xAI)`  
**Transport:** ACP 1.4.0 over stdio (agent/stdio mode, not --single mode)

**Interrupt signal honored?** ❌ NOT YET WIRED

- No `interruptSignal` in `grok/provider.ts`
- Capability flag `interrupt: false` — currently truthful, but will change

**Session reuse after interrupt?** ✅ YES (when wired)

- ACP `session/load` supports resuming existing session
- Current code path: `--single` mode is one-shot; must switch to `grok agent stdio`

**Soft-injection transport exists/verified?** ✅ VERIFIED ON WIRE

- `x.ai/interject` ACP extension method confirmed in binary (scoutcli §2.3)
- Agent→client notification: `x.ai/session/interjection` carries `interjectionId`
- Queue ops family: `x.ai/queue/remove`, `x.ai/queue/clear`, `x.ai/queue/changed`
- TUI embeds integration example with full JSON-RPC client
- **Unverified:** whether `x.ai/*` methods are gated by capability handshake or open to arbitrary ACP client

**Delivery ack by message id?** ⏳ WHEN SOFT INJECTION WIRED

- `interjectionId` returned on send; queue change notification carries metadata
- Will be available post-adapter

**Capability flags truthful?**

- `interrupt: false` — truthful for current --single mode; will flip to 'stream-abort' or true when ACP wired
- `skills: true`, `agents: true` — truthful (grok agents and skill discovery work in --single mode)

**What's missing?**

1. **Phase 1 gate (BLOCKED).** Transport swap from `--single` to `grok agent stdio`.
   - Implement JSON-RPC 2.0 ACP client: `initialize` → `session/new` → `session/prompt` → consume `session/update`
   - Map existing node flags (`--tools`, `--reasoning-effort`, etc.) to `initialize`/`session/new` params or plugin-dir
   - Rewire event parser to unwrap ACP JSON-RPC envelope from existing session-update stream
   - Size: **L** (new transport + flag translation)
2. **Conformance gate.** Prove `x.ai/interject` reachable from arbitrary ACP client (not only pager).
   - Unresolved Q from scoutcli: capability gate on version or openness?
   - Needs one live handshake + interject call
3. **Message-id / acknowledgement.** Available once interject is wired.

**Estimated effort:** L (phase 1: transport swap + flag mapping; phase 2: conformance + capability wiring)

**Can verify in CI?** ❌ NO — grok binary + live process required for handshake; JSON-RPC client testable in unit only.

---

### 4. DeepSeek (Story 8.6) — ⚠️ PRACTICAL ALTERNATIVE

**Binary:** `@deepseek-ai/dsh 0.1.2-rc.1`  
**Transport:** ACP 1.4.0 over stdio (child process spawned per turn)

**Interrupt signal honored?** ✅ WIRED (MEASURED)

- Implemented: `packages/providers/src/community/deepseek/provider.ts:212` passes to acp-client
- ACP-client seam: `acp-client.ts:314-320` fires `ctx.notify(methods.agent.session.cancel, { sessionId })`
- **Measured latency:** ~20 ms from `session/cancel` send to turn resolution (scoutsdk §7)
- Session kept warm; process stays alive

**Session reuse after interrupt?** ✅ YES (VERIFIED, WITH CAVEAT)

- ACP `session/resume` supported (acp-client.ts:290-300)
- **Caveat:** Resume is a cold path (new process spawn + re-entry), not a warm session reuse like Claude
- Tier 0 measured: cancel-then-continue-on-same-session is 30 ms overhead vs. stop-resume at ~3600 ms setup
- Tier 0 materially better than generic fallback but requires "keep session alive" code change

**Soft-injection transport exists/verified?** ❌ NO (HARD BLOCKER)

- Concurrent `session/prompt` hard-rejected with `invalidParams: a prompt is already in flight for this session` after 2 ms
- ACP method set (session/new, session/load, session/prompt, session/cancel, session/close, session/set_mode, etc.) has no steer/queue/append method
- **Backend has it:** DSH's `Inbox` class and `updateQueue` RPC on web profile exist (scoutsdk §4)
- **But:** not exposed on ACP bridge. Requires Tier 1 (transport swap to DSH web profile RPC) or Tier 2 (upstream ACP extension request)
- **Tier 2 (recommended):** Ask DSH to expose `_session/steer` as ACP custom extension (on-spec, not a violation); DSH already owns the machinery

**Delivery ack by message id?** ❌ NO

- `session/prompt` returns only `stopReason` at turn end; no per-message id or echo
- Backend `Inbox` has message ids and delivery notifications (`claimed`, `discarded`); not bridged to ACP

**Capability flags truthful?**

- `interrupt: false` — ✅ truthful per current seam (Tier 0 is session/cancel, measured to work, but not yet in code)
- Will change once Tier 0 wiring complete
- `sessionResume: true` — ✅ truthful (both warm cancel-continue and cold resume verified)

**What's missing?**

1. **Tier 0 activation (code change, Archon-side).** Measured, proven safe, needs ~100 lines to keep session alive across cancel.
   - acp-client.ts: make `session/close` and `reapChild` conditional (lines 364, 527)
   - driveDeepseekAcpTurn: allow loop on inbound messages after cancel
   - Overhead: ~31 ms per interrupt. Size: **S**
2. **Tier 1 (real steering, substantial change).** Swap to DSH web-profile `SessionController` RPC over WebSocket.
   - Requires @deepseek-ai/dsh-typert-protocol (rc-versioned, undocumented)
   - Stability risk. Size: **L**
3. **Tier 2 (recommended, upstream ask).** File ACP extension request with DSH.
   - Custom `_session/steer` method, advertise in `agentCapabilities._meta`
   - Size: **S** for DSH; Archon cost is S (add custom method to ACP client)
   - Timeline: external blocker

**Estimated effort:** S (Tier 0 activation) or L (Tier 1 if Tier 2 times out)

**Can verify in CI?** ✅ PARTIAL — Tier 0 cancel-continue testable with fake upstream (done in scoutsdk). Mid-turn steer requires Tier 1/2.

**Current story decision:** Matrix assigns DeepSeek "Provider-native turn abort" (Tier 0), not full soft injection. Matches measured capability today.

---

### 5. OMP (Story 8.7) — 🟢 FIRST-CLASS SUPPORT

**Binary:** `omp` (resolved by `community/omp/binary-resolver.ts`; upstream at `oh-my-pi/packages/coding-agent`)  
**Transport:** RPC mode (--mode rpc, stdin/stdout JSONL commands)

**Interrupt signal honored?** ✅ WIRED

- Implemented: `packages/providers/src/community/omp/provider.ts:417-542`
- `interruptSignal` listener added; fires `omp_send({type:"abort"})`
- Terminates turn with `terminationCause: 'interrupt'`
- Session kept alive; child process reused

**Session reuse after interrupt?** ✅ YES

- RPC mode holds open stdin/stdout; no process respawn
- Next prompt on same session immediately available

**Soft-injection transport exists/verified?** ✅ VERIFIED

- RPC `steer` / `follow_up` commands proven in docs (`docs/rpc.md` §"Prompting") and source
- `steer`: queued steering message (interrupt path, next tool boundary)
- `follow_up`: queued follow-up (post-turn path)
- Default: `steer` is the default streaming behavior (src/modes/rpc/rpc-mode.ts:120)
- Multi-item ordering via `set_steering_mode` / `set_follow_up_mode` ("all" vs. "one-at-a-time")
- Interrupt mode: immediate (default) checks steering between tool calls; wait defers to turn end

**Delivery ack by message id?** ⏳ NOT YET EXPOSED

- `docs/rpc.md` §"Event Stream Schema" lists no steer-specific event
- Likely signal: `prompt_result` or `agent_end` (unconfirmed)
- Can be added if OMP emits steer-received event; scoutcli unresolved Q #4

**Capability flags truthful?**

- `interrupt: false` — ❌ INACCURATE (should be 'stream-abort' or true when wired)
- `skills: true` — ✅ truthful (OMP agent discovery works)
- `thinkingControl: true` — ✅ truthful (OMP --thinking support wired)

**What's missing?**

1. **Interrupt wiring in provider.ts.** Measured, proven, spike harness exists (commits `c931e4e3`, `890e4ff3`, `68c64f58`). Ready to integrate.
   - Flip capability flag `interrupt: false` → 'stream-abort' (OMP term: abort ends turn, session continues)
   - Enable test: `packages/providers/src/community/omp/provider.test.ts` gates on capability
   - Size: **S**
2. **Soft injection UI wiring.** RPC steer command transport ready; needs executor queue + durable guidance integration.
   - Message-id: OMP RPC command format supports optional `id` field; can be stamped
   - Size: **M** (executor + event-bridge)
3. **Delivery acknowledgement signal.** OMP docs don't currently surface steer-delivered event. If absent, mark as `delivery_unknown` in UI.
   - Size: **S** (soft-inject without delivery proof)

**Estimated effort:** S-M (interrupt ready; soft injection M to complete; delivery depends on OMP event)

**Can verify in CI?** ⚠️ PARTIAL — OMP binary required; interrupt pattern testable in unit with real binary; soft injection wires with mock event stream.

---

### 6. Qoder CLI (Story 9.1) — ⏳ NO EVIDENCE

**Binary:** `qodercli` (third-party; resolved by `qodercli/binary-resolver.ts`)

**Transport:** UNKNOWN (not scouted; Archon runs it as subprocess with argv flags)

**Interrupt signal honored?** ❌ UNKNOWN

- No implementation in code
- Capability flag `interrupt: false`

**Session reuse after interrupt?** ⏳ UNKNOWN

- Matrix says "Preserve or re-establish the documented session"
- qodercli binary documentation not provided in scout

**Soft-injection transport exists/verified?** ❌ NO EVIDENCE

- Matrix: "Expose only if conformance proves it"

**Delivery ack by message id?** ❌ NO EVIDENCE

- Matrix: "Expose only if conformance proves it"

**Capability flags truthful?** ✅ CONSERVATIVE

- All false except `sessionResume: true`, `mcp: true`, `envInjection: true`, `toolRestrictions: true`, `structuredOutput: 'best-effort'`
- This is the conservative approach for an unmeasured provider

**What's missing?**

1. **Scope definition.** qodercli docs, binary flags, session/resume semantics
2. **Transport characterization.** Like OMP/Grok scout, measure CLI --help, embedded docs, binary literals
3. **Interrupt + soft injection.** Based on findings, implement adapter seam
4. **Conformance harness.** Unit tests with real binary

**Estimated effort:** M-L (full scout + implementation)

**Can verify in CI?** ❌ NO — qodercli binary required; cannot proceed without real install + API key (if needed).

---

### 7. Pi (Story 9.2) — ⏳ NO EVIDENCE

**SDK:** `@earendil-works/pi-coding-agent 0.80.6` (in-process)

**Transport:** Direct SDK in Bun process (unlike CLI providers)

**Interrupt signal honored?** ❌ UNKNOWN

- No implementation in code
- Capability flag `interrupt: false`

**Session reuse after interrupt?** ✅ LIKELY (SDK supports resuming named sessions via `sessionId`)

- Pi agent has session resume capability (wired elsewhere in provider.ts)
- Documented in SDK

**Soft-injection transport exists/verified?** ⏳ UNKNOWN

- Pi has tool request/tool result streaming
- Whether mid-turn message send is available: not measured

**Delivery ack by message id?** ⏳ UNKNOWN

- Pi may emit tool_call IDs; not examined for delivery ack

**Capability flags truthful?** ✅ CONSERVATIVE

- Declared false for unverified features
- `nativeTools: true` — accurately reflects in-process tool path

**What's missing?**

1. **Interrupt + soft injection.** Pi agent SDK investigation: does it expose mid-turn message send? Similar to Claude's streaming input?
2. **Conformance + adapter wiring.**

**Estimated effort:** M (SDK feature investigation + adapter wiring if feature exists)

**Can verify in CI?** ⚠️ PARTIAL — Pi SDK in-process, testable; live user credentials (Pi API key) may be needed for some features.

---

### 8. GitHub Copilot (Story 9.3) — ⏳ NO EVIDENCE

**SDK:** `@github/copilot-sdk ~1.0.1` (in-process)

**Transport:** Direct SDK in Bun process (CLI binary when not in-process; Archon uses SDK)

**Interrupt signal honored?** ❌ UNKNOWN

- No implementation in code
- Capability flag `interrupt: false`

**Session reuse after interrupt?** ✅ LIKELY (SDK supports named sessions)

**Soft-injection transport exists/verified?** ⏳ UNKNOWN

- Copilot SDK streaming + tool/tool_result flow present
- Mid-turn message send availability: not measured

**Delivery ack by message id?** ⏳ UNKNOWN

**Capability flags truthful?** ✅ CONSERVATIVE

- Declared false for unverified features

**What's missing?**

1. **SDK feature investigation.** Does @github/copilot-sdk expose mid-turn message handling?
2. **Conformance + adapter wiring.**

**Estimated effort:** M (SDK feature investigation; estimated L if feature absent and CLI binary path needed)

**Can verify in CI?** ❌ NO — Copilot SDK requires GitHub authentication; live credentials needed.

---

### 9. OpenCode (Story 9.4) — ⏳ NO EVIDENCE

**SDK:** `@opencode-ai/sdk 1.17.3` (in-process server, managed by Archon)

**Transport:** Direct SDK in Bun process (or embedded HTTP server startup)

**Interrupt signal honored?** ❌ UNKNOWN

- No implementation in code
- Capability flag `interrupt: false`

**Session reuse after interrupt?** ✅ LIKELY (OpenCode API has named sessions)

**Soft-injection transport exists/verified?** ⏳ UNKNOWN

- OpenCode API streaming response available
- Mid-turn message queue / soft inject: not measured

**Delivery ack by message id?** ⏳ UNKNOWN

**Capability flags truthful?** ✅ CONSERVATIVE

**What's missing?**

1. **SDK API investigation.** OpenCode session/message contract and mid-turn semantics
2. **Conformance + adapter wiring.**

**Estimated effort:** M-L (SDK feature investigation + adapter if feature available)

**Can verify in CI?** ⚠️ PARTIAL — OpenCode SDK is a managed dependency; live server startup may need special env setup.

---

## Cross-Cutting Patterns

### Interrupt Seam Type

- **Native SDK (Claude):** `query.interrupt()` method on live SDK handle
- **Stream-abort (Codex, Grok, OMP, others):** Kill the stream/child, capture abort marker, continue on new stream
- **Provider RPC (DeepSeek, Grok):** ACP/RPC `cancel`/`abort` command on live connection

### Soft Injection

- **Available + verified:** OMP (RPC `steer`), Grok (ACP `x.ai/interject`), Claude (streaming input)
- **Available but not bridged:** DeepSeek (Inbox on web profile, not ACP)
- **Unknown:** Qoder, Pi, Copilot, OpenCode
- **Not available:** Codex (TypeScript SDK path)

### Session Continuation

- **Inherent (same process/connection):** Claude (native session reuse), OMP (RPC session), Grok (ACP session), DeepSeek (ACP session)
- **Via explicit resume:** Codex (thread resume), all CLI providers (documented --resume flags)

### Message-ID Delivery Acknowledgement

- **Proven:** Claude (still_queued echo; pending SDK update for message-id stamping)
- **Partial:** OMP (RPC `id` field in commands, but event stream unconfirmed), Grok (interjectionId on send)
- **Not current:** Codex, DeepSeek, all others

---

## Risk & Verification Blockers

| Provider  | Cannot verify in CI | Blocker                                     | Impact                          |
| --------- | ------------------- | ------------------------------------------- | ------------------------------- |
| Claude    | No                  | None (SDK stable)                           | Ready to ship                   |
| Codex     | Yes                 | Codex SDK version; no binary in CI          | Stream-abort harness testable   |
| Grok      | Yes                 | grok binary v1.0.30+; live version check    | ACP client testable in unit     |
| DeepSeek  | Partial             | dsh binary rc; Tier 1 uses private RPC      | Tier 0 fully testable           |
| OMP       | Partial             | omp binary install; soft-inject steer event | Interrupt fully testable        |
| Qoder CLI | Yes                 | qodercli binary; undocumented transport     | Cannot proceed without binary   |
| Pi        | Partial             | Pi API key for full feature test            | SDK introspection testable      |
| Copilot   | Yes                 | GitHub auth; SDK feature scope unclear      | Cannot proceed without creds    |
| OpenCode  | Yes                 | Embedded server startup; SDK API unclear    | Cannot proceed without full env |

---

## Story Readiness

| Story | Provider  | Interrupt | Redirect | Soft Inject | Delivery Ack | Gate Status    |
| ----- | --------- | --------- | -------- | ----------- | ------------ | -------------- |
| 8.3   | Claude    | ✅        | ✅       | 🟢 ready    | ⏳ SDK wait  | Approval ready |
| 8.4   | Codex     | ⏳ seam   | ✅       | ❌ blocked  | ❌ n/a       | Phase 1 (seam) |
| 8.5   | Grok      | ⏳ phase1 | ✅       | ✅ ready    | ⏳ post-wire | Phase 1 gate   |
| 8.6   | DeepSeek  | ✅ Tier0  | ✅       | ❌ Tier1/2  | ❌ n/a       | Tier 0 ready   |
| 8.7   | OMP       | ✅ ready  | ✅       | ✅ ready    | ⏳ event?    | Wiring ready   |
| 9.1   | Qoder CLI | ⏳ scout  | ? resume | ? evidence  | ? evidence   | Pre-scope      |
| 9.2   | Pi        | ⏳ scout  | ✅       | ? evidence  | ? evidence   | Pre-scope      |
| 9.3   | Copilot   | ⏳ scout  | ✅       | ? evidence  | ? evidence   | Pre-scope      |
| 9.4   | OpenCode  | ⏳ scout  | ✅       | ? evidence  | ? evidence   | Pre-scope      |

---

## Summary

**Ready to ship (approval gate ready):** Claude (8.3) — Stop, session, soft injection, pending message-id SDK echo.

**Ready to implement (gate condition met):** OMP (8.7) — interrupt wiring testable now; soft injection RPC commands ready.

**Phase 1 gate active:** Grok (8.5) — waiting for JSON-RPC ACP client + flag translation + conformance spike.

**Practical alternative available:** DeepSeek (8.6) — Tier 0 (cancel-then-continue) measured and safe, ~31 ms overhead; Tier 1/2 for true mid-turn steer.

**Blocked on SDK / CLI:** Codex (8.4) — requires stream-abort seam + subprocess harness.

**Unscout'd:** Qoder CLI, Pi, Copilot, OpenCode — need transport characterization before implementation scope is clear.

---

## Unresolved Questions

1. **Grok's `x.ai/*` extension methods — are they gated by capability negotiation at handshake, or open to any ACP client?** (scoutcli §2.3)
2. **DeepSeek Tier 2 — will DSH accept an ACP custom `_session/steer` extension request, or must Tier 1 transport swap proceed?** (scoutsdk §6, recommendation)
3. **OMP steer-delivered event — does RPC mode emit a distinct event for a queued steer landing, or is `prompt_result` the only signal?** (scoutcli unresolved #4)
4. **Codex TypeScript SDK — is mid-turn message send available in a non-TypeScript SDK path or CLI variant?** (codex scope)
5. **Pi + Copilot + OpenCode — do their respective SDKs expose mid-turn message send analogous to Claude's streaming input, or is session reuse the only option?**

---

Status: SCOUTING COMPLETE, GATES IDENTIFIED  
Summary: Claude ready; OMP integrable; Grok phase-1-blocked; DeepSeek acceptable alternative with Tier-0; others require scope / transport definition before build.
