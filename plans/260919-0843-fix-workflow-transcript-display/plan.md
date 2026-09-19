---
title: 'Fix workflow transcript display and Legacy run viewport'
description: 'Repair structured transcript presentation, ACP chunk grouping, Legacy room scroll containment, and the Legacy runtime graph minimap.'
status: pending
priority: P1
issue: 'https://github.com/kevinle128/Archon/issues/208'
effort: '3 phases'
branch: develop
tags: [bugfix, frontend, providers, e2e, tdd]
blockedBy: []
blocks: []
created: 2026-09-19
revised: 2026-09-19
---

# Fix workflow transcript display and Legacy run viewport

## Outcome

Workflow rooms show a schema-declared single string result as readable Markdown instead of a raw JSON wrapper.
New Devin and DeepSeek ACP text fragments form one assistant message without changing stored audit rows or structured node output.
The Legacy run page keeps document scroll at zero when the pointer is inside or outside the transcript region, and the pictured Legacy runtime graph no longer shows a minimap.

## Scope boundary

- Preserve immutable transcript rows, structured node output, downstream `$node.output.<field>` references, and provider-neutral projection.
- Apply the structured display rule to Legacy, the Console selected room, and Console inline execution history because all three call the shared projection.
- Fix the shared hidden-label geometry in both renderer copies, but limit panel scroll work and minimap removal to the Legacy runtime run view shown in the screenshots.
- Keep workflow-builder minimaps, complex multi-field structured objects, historical rows without reliable `text_mode`, and non-Web platform batch formatting out of scope.
- Do not add a database migration, API transform, generated type, provider buffer, fabricated stream identifier, wheel handler, or new dependency.

## Evidence checked

- [Structured-output presentation research](./research/researcher-01-structured-output-presentation.md)
- [Provider stream contract research](./research/researcher-02-provider-stream-contract.md)
- [Runtime-flow and E2E research](./research/researcher-03-e2e-tdd-runtime-flow.md)
- [Live Legacy scroll reproduction](./research/live-legacy-scroll-reproduction.md)
- [Scout synthesis](./reports/scout-report.md)
- [GitHub issue #208](https://github.com/kevinle128/Archon/issues/208), including the Codex reproduction of the raw structured envelope.

## Delivery phases

| #   | Phase                                                                                                | Depends on |
| --- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1   | [Provider delta boundaries](./phase-01-start.md)                                                     | —          |
| 2   | [Structured transcript presentation](./phase-02-structured-transcript-presentation.md)               | Phase 1    |
| 3   | [Legacy run viewport and regression coverage](./phase-03-legacy-run-viewport-regression-coverage.md) | Phases 1–2 |

## Design decisions

1. Mark Devin and DeepSeek ACP `agent_message_chunk` values as `textMode: 'delta'` at the provider boundary.
2. Run schema-aware presentation after `projectTextTranscript()` in `buildAgentHistory()`.
3. Unwrap only an exact canonical JSON object whose selected node schema declares exactly one top-level string property, whose payload contains exactly that key with a string value, and whose raw text equals `JSON.stringify(parsed)`.
4. Return the original text byte-for-byte for every absent, malformed, noncanonical, duplicate-key, complex, or mismatched schema and payload.
5. Keep historical untagged ACP rows unchanged because the stored data cannot distinguish fragments from valid complete messages.
6. Fix the approximately 18,000-pixel root overflow by positioning the direct `sr-only` summary labels locally, then enforce Legacy panel and overscroll containment with native CSS.
7. Remove only `WorkflowDagViewer`'s runtime minimap and preserve controls, pan, zoom, fit, layout, and node selection.

## Runtime Flow Proof

| Feature                        | Actor                   | Runtime trigger                                                    | Entry point                                     | Internal path                                                                                | Observable result                                                         | End-to-end test                                                                                                                                                                             | External mocks              | Prepared data                                                                                | Status |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| ACP chunk grouping             | Devin or DeepSeek agent | Two ACP `agent_message_chunk` notifications                        | Real ACP client update handler                  | ACP bridge → `MessageChunk.textMode` → executor metadata → attempt boundary → text projector | One assistant block for one streamed response, with re-asks kept separate | Deterministic fake ACP process sends two chunks and asserts ordered deltas; executor tests prove direct and loop persistence and re-ask boundaries; layered Web projection asserts one item | Fake ACP process only       | Two text chunks in one execution identity plus invalid and missing structured-output re-asks | PASSED |
| Readable structured report     | Workflow operator       | Open a report node transcript                                      | Legacy or Console run route                     | Definition schema → room owner → `buildAgentHistory()` → Markdown renderer                   | Report prose without JSON wrapper in all three mounts                     | Isolated real server, SQLite, fake provider, and browser run a one-string `output_format` workflow and verify API text remains raw                                                          | Env-gated AI provider only  | Fragmented report JSON plus structured result and downstream field consumer                  | PASSED |
| Lossless structured fallback   | Workflow operator       | Open malformed or complex structured text                          | Same run routes                                 | Same projection with exact schema, payload, and canonical raw-text guards                    | Original assistant text remains visible                                   | Browser and unit matrix cover absent schema, malformed JSON, duplicate keys, noncanonical escapes, extra keys, and multi-field schema                                                       | Same provider boundary      | Invalid and complex payload rows prepared by the fixture                                     | PASSED |
| Legacy scroll containment      | Workflow operator       | Scroll a long transcript, leave its scroll region, and wheel again | `/legacy/workflows/runs/:runId` Graph node room | Positioned status label → bounded resizable panel → contained transcript scroller            | Document stays fixed and no blank region appears                          | Split `T.xlong` Playwright cases measure inner scroll, root height, root scroll, label boxes, keyboard reachability, and stable headers before and after pointer exit                       | Existing fake provider only | More than 100 tool rows                                                                      | PASSED |
| Legacy runtime minimap removal | Workflow operator       | Open the Legacy Graph tab                                          | `WorkflowDagViewer`                             | Existing DAG view model → React Flow without `MiniMap`                                       | No minimap; controls and graph interactions remain                        | Browser test asserts minimap absence, viewport transform, pan, fit, and room-opening node selection                                                                                         | None                        | Deterministic workflow DAG                                                                   | PASSED |

- **Gate status:** PASSED

## Cross-plan dependencies

Issue 174 readable rows, Issue 175 Raw payloads, Issue 180 occurrence navigation, and Issue 181 queue guidance are already merged prerequisites even though their plan front matter is stale.
This plan preserves those behaviors and does not update the historical plan records.

## Red-team review

The detailed adjudication is in [reports/red-team-review.md](./reports/red-team-review.md).
The review accepted 11 evidence-backed changes and rejected 4 scope expansions that did not add new evidence against the selected design.
The accepted changes are reconciled across all three phases with no unresolved contradiction.

## Validation log

- Session: 1
- Date: 2026-09-19
- Trigger: `$kk:plan --deep --tdd`
- Questions required: 0
- Runtime Flow Proof: 5 of 5 rows VERIFIED for actor, trigger, complete path, observable result, E2E plan, external boundary, and prepared data.
- Phase claims: 12 Phase 1 claims, 12 Phase 2 claims, and 11 Phase 3 claims VERIFIED against current source and tests.
- TDD structure: Tests Before, Refactor, Tests After, and Regression Gate VERIFIED in every phase.
- Red-team reconciliation: 11 accepted findings VERIFIED in the phase requirements with no contradiction against the 4 rejected findings.
- Plan schema: `ak plan validate` PASSED after reconciliation.
- Product behavior: UNVERIFIED until implementation runs the unchecked phase commands and governed UI proof.
- Residual implementation note: the E2E fake provider must change its current `structuredOutput: false` capability and stale comment only when the opt-in scenario implements the terminal structured-output contract.

## Acceptance criteria

- [ ] New Devin and DeepSeek ACP text chunks persist as deltas and render as one assistant message within each occurrence and attempt.
- [ ] Direct and loop structured-output re-asks cannot concatenate failed and valid responses into one projected assistant block.
- [ ] The exact one-string structured envelope renders as its string value in Legacy, Console selected room, and Console inline history.
- [ ] Complex, malformed, duplicate-key, noncanonical, unmatched, and schema-less assistant text remains unchanged and auditable.
- [ ] Legacy root document height stays within two pixels of the viewport and `document.scrollingElement.scrollTop` remains zero through the pointer-exit wheel case.
- [ ] Keyboard traversal, visible focus, transcript keyboard scrolling, Ask or composer reachability, and focus restoration pass at desktop and narrow sizes.
- [ ] The Legacy runtime graph has no minimap, while zoom, pan, fit, controls, layout, and node selection still work.
- [ ] Focused tests, package-isolated suites, the focused Playwright proofs, and `bun run validate` pass without weakened assertions.

## Rollback

Each phase is independently reversible and has no data migration.
Revert provider labels, Web presentation wiring, or Legacy CSS/minimap changes separately if their phase-specific regression signals appear.

<!-- slug: fix-workflow-transcript-display -->
