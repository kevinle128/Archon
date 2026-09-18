# Research synthesis

## Product and design evidence

Issue #174 is Story 1.1 of Epic 1: make each stored tool call scannable as one readable row in Legacy and Console. The story's direct references are CAP-1, NFR1–3, UX-DR1–2, `tool-presentation-contract.md`, and `test-plan.md`; later stories own Raw, family bodies, diff, todo, task, and occurrence behavior.

The canonical row is native `<details>/<summary>` with chevron, glyph, chip, flexible headline, and right facts. Final measurements are 12 px row text, 11 px chip/badge text, 4 px/6 px padding, 8 px gaps, 6 px radius, and at least 24 px height. Verify at 460 px. Path/URL headlines preserve the final segment, text headlines end-elide, and duration drops before critical facts. Focus is a 2 px opaque accent outline (Legacy offset −2 px, Console +2 px); chevron motion is 120 ms and disabled for reduced motion.

The final documents override stale artifact details such as a 22 px target or 520 px as the contract width. The complete mockups also include later-story bodies and Raw controls, so Story 1.1 comparison must not demand those.

One contract tension was resolved using the higher-priority Story 1.1 criterion and the mockup itself: generic `{…}` and `[n]` markers belong in the expanded generic body. The collapsed generic example contains scalar `key: value` facts only. A collapsed row must not show presenter-generated object/array syntax or a JSON dump; legitimate shell/code/pattern characters are not stripped.

## Code-path evidence

- `pair-tool-transcript.ts` pairs calls/results and retains exit code and identity.
- `agent-history.ts` is the shared projection seam. It currently drops exit code after outcome derivation and emits status rows as lifecycle rows.
- Persisted `tool_called` events carry the tool ID and `created_at`; all three callers already take a `Date.now()` snapshot later in the same render and live paths refresh every second. Running elapsed time therefore needs deterministic clock plumbing, not a backend field or new timer.
- The production consumers are Legacy through `NodeTranscriptPane.tsx`, Console selected-room through `ConsoleNodeRoom.tsx`, and Console inline history through `ConsoleExecutionHistory.tsx`.
- Legacy renders tools in `NodeRoom.tsx`; both Console mounts share `ConsoleAgentHistoryList.tsx`.
- The current renderers use filled `.ptool` cards and open Input/Output disclosures. Full-output load/error/retry behavior is already present and must survive behind closed diagnostics.
- Server-side Zod parsing rejects corrupt persisted node-message rows before Web presentation. The presenter still must handle every schema-valid JSON value safely.
- Console isolation permits approved shared `@/lib` logic but prohibits importing Legacy components. A shared pure presenter and two small shells fit the boundary.

No provider, workflow, server, route, OpenAPI, generated type, database, schema, migration, dependency, or new token is required.

## Test and CI evidence

Three E2E cases encode the obsolete visible-output behavior: two in `workflow-run-hitl.spec.ts` and `[V:hitl.agent-history]` in `workflow-run-hitl-room.spec.ts`. All three must be rewritten; the draft's “two cases” count was incomplete.

`workflow-run-hitl-visual.spec.ts` uses `.ptool` plus descendant output text as readiness, which can pass while that text is hidden. Its locator needs a narrow direct-summary correction. The new Story 1.1 visual test must keep uppercase `HITL` in its title because CI runs `test:ui:hitl` with that grep. Playwright is outside the Bun workspace and is not included by `bun run validate`.

The real fake-provider fixture supplies a successful call only. Failed, interrupted, unknown, adversarial, and live-transition behavior belongs in deterministic shared/component tests; do not expand provider behavior just for screenshots.

## Current ownership evidence

GitHub PR #194, `feat(web): render tool calls as readable rows (ANR 1.1)`, exists but is closed and unmerged. Its diff is useful negative evidence (for example, it left raw failed-body content exposed and retained card styling) but must not be cherry-picked wholesale.

Issue #174 remains labeled `status:processing`, while the run ID in its latest comment is completed. The alternate active plan/path claimed by the original draft was not present. There is no evidenced current ownership blocker, but implementation must recheck the mutable issue/PR/run/worktree state immediately before editing.

## Chosen solution

Add one bounded React-free row presenter under `packages/web/src/lib`, attach its result and exit code in `buildAgentHistory()`, and fold only an exact immediately adjacent interrupted status. Render native disclosures in the two existing shells. Preserve operator choice with explicit untouched/touched state, retain closed diagnostic disclosures temporarily, and prove real success plus deterministic edge states at the appropriate layers.
