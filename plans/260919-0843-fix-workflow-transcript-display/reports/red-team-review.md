# Red-team review

## Session

- Date: 2026-09-19
- Scope: `plans/260919-0843-fix-workflow-transcript-display/`
- Findings considered: 15
- Accepted: 11
- Rejected: 4
- Severity mix: 8 high and 7 medium

## Accepted findings

1. The loop missing-output re-ask must rotate the transcript attempt before the next provider pass.
   The invalid-output branch already rotates at `packages/workflows/src/dag-executor.ts:6630`, while the missing-output branch increments the re-ask counter without rotation near `packages/workflows/src/dag-executor.ts:6660`.
   Phase 1 now requires the production fix and direct and loop persistence tests.

2. All three local CSS containment fixes are mandatory.
   The hidden-label containing block, right-panel containment, and transcript overscroll rule address different failure paths.
   Only the conditional `Layout.tsx` escalation can stop when local proof succeeds.

3. Every exact-matching projected assistant block must unwrap independently.
   Phase 2 now covers intermediate blocks separated by tool rows and does not restrict the rule to the terminal result.

4. Console browser assertions must follow the actual mount lifecycle.
   The plan now checks inline history before selection, then scopes the selected-room check to the opened room because selection suspends inline history.

5. Browser fallback claims require prepared failure data.
   The fixture must provide malformed, extra-key, multi-field, schema-less, duplicate-key, and noncanonical-escape rows.

6. A shared Layout change requires a route sweep.
   If the conditional fallback is used, executable checks must cover Legacy Chat, Dashboard, Workflows, Builder, and Settings.

7. Phase 2 rollback must remove all test infrastructure added only for this behavior.
   The rollback now includes the fake provider scenario, workflow fixture, runtime helper, and browser spec.

8. Duplicate JSON keys and noncanonical raw JSON must fail closed.
   Phase 2 requires raw text to equal `JSON.stringify(parsed)` before unwrapping, which rejects duplicate keys, noncanonical whitespace, and escape transformations.

9. Long browser cases must use the established extended timeout class and stable readiness checks.
   Phase 3 now separates desktop scroll, narrow layout, and graph proofs into `T.xlong` cases and polls stable row load and geometry.

10. Keyboard behavior needs direct browser proof.
    Phase 3 now covers Tab and Shift+Tab order, visible focus, keyboard scrolling, Ask or composer reachability, and focus restoration at both viewports.

11. New browser scenarios need governed verifier registration.
    Phase 3 now updates `.agents/skills/verify-archon/lib/browser-scenarios.ts` and `.agents/skills/verify-archon/features/run-ui.json`, then runs the verifier support checks.

## Rejected findings

1. Redesign remote-image rendering was rejected.
   The existing Markdown renderer already owns that policy, and this plan does not add a new HTML or image path.
   Canonical raw equality also prevents escaped punctuation from silently becoming active Markdown through this transform.

2. Storing historical schema snapshots was rejected.
   The current-definition reinterpretation risk is already documented and is an accepted frontend-only trade-off for existing runs.
   Stored transcript text and API audit output remain unchanged.

3. Requiring live Devin or DeepSeek credentials was rejected.
   The official ACP `agent_message_chunk` contract is append-only, and the deterministic child-process test proves Archon's real SDK and NDJSON transport without nondeterministic external accounts.

4. Treating the Runtime Flow Proof `PASSED` status as completed implementation testing was rejected.
   In this planning workflow, `PASSED` means the actor, trigger, complete planned path, data, external boundary, and planned E2E proof are specified.
   Execution evidence remains unchecked in the phase acceptance and regression gates.

## Consistency sweep

The main plan and all three phase files were reconciled after adjudication.
The accepted findings changed 11 design or validation requirements.
No stale phase dependency, rollback contradiction, or unresolved decision remains.
