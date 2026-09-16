# Prove Claude and Pi Resume After AskHuman Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md`
Derived slug: `2026-09-06-askhuman-resume-spike`

## Overview

Story 6.1 is a provider protocol spike, not production HITL implementation.
It must produce executable, redacted evidence that determines whether Claude can durably resume a custom `AskHuman` call and whether Pi can durably continue after dispose and reopen.
The evidence must then either confirm or amend AD-6 before Story 6.3 may implement continue.

## Problem

The adopted AD-6 currently specifies provider-owned resume injection but explicitly leaves Claude's runtime mechanism and Pi's cross-process reopen order as spikes (`_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md:95-100`).
Claude SDK types and current documentation suggest `PreToolUse` `defer` plus `tool_deferred`, while the prior host-abort path is a different mechanism that must not be assumed from declarations alone (`_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/reviews/review-version-reality.md:56-89`).
Pi exposes `continue()` on `session.agent`, not on `AgentSession`, and Archon currently disposes the session in its event bridge, so durable reopen behavior needs a real-SDK characterization rather than source-text proof (`packages/providers/src/community/pi/event-bridge.ts:362-378`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/reviews/review-version-reality.md:93-122`).

## Solution

Pin the Claude spike dependency exactly to `0.3.209`, build and test a fail-closed classifier plus a manual live Claude harness, characterize Pi using real persistence with only a deterministic faux transport, record two redacted Claude evidence files, and reconcile the outcome, AD-6, diagrams, and sprint state.
The required version remains `0.3.209`; an isolated `0.3.261` run is comparison evidence only and can never substitute for the required proof (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:108-114`).

## Goals and Success Metrics

| Goal | Success metric | Evidence |
| --- | --- | --- |
| Reproducible Claude spike | Root manifest, providers manifest, and lockfile specify exact `0.3.209`; frozen install succeeds | Exact-pin check and Bun install commands (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:147-180`) |
| Fail-closed Claude protocol choice | Both `sonnet` and `opus` independently prove the same allowed protocol, otherwise the result is `inconclusive` | Classifier tests and JSON evidence (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:85-114`) |
| Durable Pi resume proof | A matching persisted `ToolResultMessage` is the continuation context tail after dispose, reopen, append, recreate, and `session.agent.continue()` | Focused real-SDK characterization (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:116-124`) |
| Safe evidence handling | Claude output contains only permitted metadata and redacted failure categories, with no prompts, answers, transcripts, credentials, environment values, or tokens | Evidence JSON shape and secrecy checks (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:864-905`) |
| Truthful architecture handoff | Outcome, AD-6, diagrams, and sprint state agree; Story 6.3 stays blocked unless the whole completion gate passes | Completion gate and cross-check (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:126-130`, `1033-1045`) |

## Non-Goals

- Implementing `AskHuman`, `AskHumanAwaitingError`, `resumeInteractions`, pending-interaction storage, routes, SSE, node states, or UI.
- Changing `NativeTool`, `SendQueryOptions`, `ProviderCapabilities`, production `sendQuery` methods, or code in workflows, core, server, or web.
- Adding a resume mapper, protocol constant, or exported production surface without a production caller.
- Using Claude's built-in `AskUserQuestion`, inferring asks from prose, or embedding answers in workflow prompts.
- Automatically upgrading Claude after an inconclusive result, changing Pi packages beyond lockfile `0.80.6`, or calling a vendor API from Pi tests or CI.
- Running the Claude live harness in CI or the ordinary provider test script.

## Technical Context

- `package.json:76` and `packages/providers/package.json:38` currently use a caret for the Claude SDK, while `bun.lock:8`, `bun.lock:144`, and `bun.lock:269` resolve `0.3.209`; both manifest specifications must become exact without changing the resolved package.
- Provider tests must each run in an isolated Bun process because the package test command is a chained set of individual invocations (`packages/providers/package.json:33-35`); append the two new focused tests there, but keep the manual Claude script out of it.
- The custom server name is `archon` (`packages/providers/src/claude/native-tools.ts:13-14`) and its existing in-process MCP builder uses `tool()` plus `createSdkMcpServer()` (`packages/providers/src/claude/native-tools.ts:70-86`), so the only permitted live ask target is `mcp__archon__AskHuman`.
- Claude's existing provider resumes using `options.resume = resumeSessionId` (`packages/providers/src/claude/provider.ts:1510`); the spike must test both host abort and custom-tool `PreToolUse` defer independently without modifying this production path.
- Pi session resolution already opens a matching persisted path through `SessionManager.open()` (`packages/providers/src/community/pi/session-resolver.ts:47-73`), while `bridgeSession()` guarantees `session.dispose()` in its `finally` path (`packages/providers/src/community/pi/event-bridge.ts:362-378`).
- `packages/providers/tsconfig.json:6-8` excludes test files; a Bun test is runtime characterization evidence, not a substitute for production type checking.
- AD-6 keeps answer injection provider-owned and prohibits workflows from encoding answer prose (`_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md:95-100`), while AD-9 mandates the custom `AskHuman` invocation and rejects `AskUserQuestion` as a product channel (`_bmad-output/planning-artifacts/architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md:113-117`).
- The plan's global safety limits are binding: no `any`, direct SDK-owned types, ambient auth only for the manual Claude run, strict evidence redaction, no unscoped root `bun test`, and `bun run validate` before a done sprint state (`docs/superpowers/plans/2026-09-06-askhuman-resume-spike.md:18-41`).

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Pin Claude SDK reproducibly | - | 134-193 |
| 2 | US-002 | Test the fail-closed Claude classifier | US-001 | 197-406 |
| 3 | US-003 | Build the manual Claude protocol harness | US-002 | 408-605 |
| 4 | US-004 | Characterize Pi durable reopen and continue | US-001 | 609-836 |
| 5 | US-005 | Record exact 0.3.209 Claude evidence | US-003 | 840-874 |
| 6 | US-006 | Record isolated 0.3.261 comparison evidence | US-003, US-005 | 875-927 |
| 7 | US-007 | Write outcome and reconcile architecture | US-004, US-005, US-006 | 931-1045 |
| 8 | US-008 | Validate the spike and apply the final gate | US-007 | 1049-1149 |

## Ralph Execution Notes

- Implement exactly one story per fresh-context Ralph iteration and do not begin it until every `dependsOn` story has `passes: true`.
- The live Claude stories are manual diagnostic work. They may legitimately record valid `inconclusive` evidence; that is a truthful result, not permission to change the required version or implement production resume plumbing.
- Only US-008 may retain a `done` sprint key, and only after all validation and every Completion Gate condition pass. If any provider conclusion is inconclusive, preserve `in-progress` and keep Story 6.3 blocked.
- Keep the implementation limited to the plan File Map. Do not create production behavior to make the spike appear conclusive.
