---
title: 'Plan: issue 187 interrupt and redirect a running DeepSeek agent'
date: 2026-09-19
summary: Deep+TDD plan for Story 2.7; provider-seam change over the Story 2.3 steering machinery
---

# Plan: issue 187 interrupt and redirect a running DeepSeek agent

## What was planned

Plan directory: `plans/260919-1931-issue-187-interrupt-and-redirect-deepseek-agent/` (3 phases).

Story 2.7 turned out to be a provider-seam story: every steering layer shipped by Story 2.3 (registry, executor five-case classification, interrupt route, sub-state projection, both docks) gates on `capabilities.interrupt !== false`, with zero provider-id branches (scout-verified). The work is: flip `DEEPSEEK_CAPABILITIES.interrupt` to `'native'`, plumb `interruptSignal` into `driveDeepseekAcpTurn` next to the existing `abortSignal` listener (one `session/cancel`), stamp `terminalReason` on `abortedResult()`, add that value to the executor's `INTERRUPT_TERMINAL_REASONS`, and add a DeepSeek conformance fixture to the executor matrix.

## Non-obvious findings

- ACP 1.4.0 `StopReason` includes `cancelled` and the schema mandates it as the answer to a cancelled `session/prompt`; but `ToolCallStatus` has no `cancelled` value, so a cut-off tool may arrive as `failed` before the abort result and close the card as an error instead of `⚠`. Spike-gated bridge mapping (`cancelRequested` → `toolOutcome:'interrupted'`).
- `acp-client.ts` discards `promptResponse` on the abort path; the plan forwards its `stopReason` as `terminalReason` so the result chunk is the spike's evidence.
- Advisor caught a provider-layer race: a Stop firing after the prompt resolved (during `session/close`) would stamp the abort marker on a natural end. The plan freezes the abort decision when the prompt request settles and adds a test for it.
- `dag-executor.test.ts` never registers the DeepSeek provider; `getProviderCapabilities('deepseek')` throws there today.
- "Same session" for DeepSeek means the ACP session id survives across per-turn DSH children (`session/resume`), not a warm process; resume-after-cancel is the Phase 1 real-DSH gate.

## Process notes

The `ak-journal` skill was not in the session allowlist, so this entry was written via `ak journal create`. Red-team/validation gates ran as the requested advisor review (non-interactive run).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
