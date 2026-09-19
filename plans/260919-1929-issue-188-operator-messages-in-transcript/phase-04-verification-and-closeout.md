---
phase: 4
title: 'Verification and closeout'
status: pending
priority: P1
effort: '0.5 session'
dependencies: [1, 2, 3]
---

# Phase 4: verification and closeout

## Goal

Prove Story 2.8 outside-in on both surfaces with one Playwright spec that
reuses the interrupt-and-redirect fixture, run the full validation gate, record
the acceptance evidence, move the sprint tracker to `done`, and open the PR
from the template with `Closes #188`.

## Scout before executing

- `e2e/ui/agent-interrupt-redirect.spec.ts:430-600`: the
  `[V:steer.interrupt-${surface}]` flow — `archon.startWorkflowViaWeb`,
  `openGuidanceRoom`, `stopButton`, `guidanceField`, `sendNowButton`,
  `trackPosts`, the `REDIRECT_TEXT` constant, and the `resumed echo` assertion.
  These helpers are file-local; copy the ~10 needed ones into the new spec (the
  suite has no shared steering-helper module — do not create one for a single
  extra consumer).
- `e2e/lib/playwright/run-detail.ts:47` `listNodeMessages` returns `kind`,
  `payload`, and `metadata.execution` only — widen its return type to include
  `seq`, `metadata.origin`, `metadata.message_id`, `metadata.operator_user_id`,
  and `operator_display_name` (pure type widening; the helper already returns
  the full JSON).
- `e2e/lib/playwright/archon-runtime.ts:370-390`: the web identity is seeded
  with `display_name = 'e2e-starter'`. **Verify before writing the identity
  assertions:** `starterFetch` (`:922-930`) adds `X-Archon-User` only to
  fixture-side `fetch`, and `run-detail.ts:178-187` attaches it as
  `extraHTTPHeaders` only on contexts created through that helper. Confirm the
  `page` the interrupt spec uses comes from an identity-bearing context (so
  the UI's own send POST resolves a user); if it does not, open the room via
  the `starter` context from `run-detail.ts`, otherwise the row records
  `operator_user_id: null` and the `e2e-starter` label assertion is wrong —
  assert a bare `operator` label in that case instead of guessing.
- `e2e/README.md` for the local run recipe (`bun run build:web`, then
  `npx playwright test --grep '\[V:steer.operator-row'`).
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:75`.
- `.github/pull_request_template.md`.

## Files

| File | Action |
|------|--------|
| `e2e/ui/agent-operator-transcript-row.spec.ts` | New spec: one `[P1] [V:steer.operator-row-${surface}]` test per surface plus one API-shape test. |
| `e2e/lib/playwright/run-detail.ts` | Widen the `listNodeMessages` return type. |
| `plans/260919-1929-issue-188-operator-messages-in-transcript/reports/acceptance-evidence.md` | Test output, Playwright result, and screenshots of the operator row on both surfaces. |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | `2-8-see-operator-messages-in-the-transcript: done`. |

## Steps

### Step 1 — outside-in spec (red until Phases 1–3 land together)

For each `surface` in `['console', 'legacy']`:

1. Start `e2e-queue-guidance` via web, open the room, wait for the running tool
   row (as the interrupt spec does).
2. Queue `first` and `second` with the Queue button; press Stop; wait for the
   idle dock (`will send · 2`).
3. Type `REDIRECT_TEXT`, press `Send now`, capture the three posted
   `message_id`s in order from the tracked POSTs.
4. Wait for the resumed echo row, then assert on the room:
   - `room.locator('[data-operator-row]')` has count 3;
   - their label texts are `operator · e2e-starter`, each carries a
     `[data-operator-delivery]` reading `sent` (via `toHaveText(/sent/i)`)
     and never `delivered`;
   - body texts are `first`, `second`, `REDIRECT_TEXT` in DOM order;
   - document order: the `[data-tool-id]` row whose summary says
     `interrupted` precedes the first operator row, and the `resumed echo`
     text follows the last operator row (compare `boundingBox().y` or use
     `locator.evaluate` with `compareDocumentPosition`).
5. Assert on the API with `listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)`:
   - exactly three rows with `metadata.origin === 'operator'`, in `seq` order,
     `metadata.message_id` equal to the captured ids, `operator_display_name === 'e2e-starter'`,
     `metadata.operator_user_id` a non-empty string;
   - the `status` row with `state === 'interrupted'` has a lower `seq` than the
     first operator row; the echo text row has a higher `seq` than the last;
   - the three operator rows share the echo row's `execution.attempt_id` and
     differ from the interrupted status row's.
6. `captureEvidence(room, 'operator-row-${surface}', testInfo)` into this
   plan's `reports/evidence/`.

Add one surface-independent API test: after a natural-boundary drain (reuse
the queue-guidance flow without Stop) the operator rows precede the drained
turn's echo and carry the same triple — proving the non-interrupt path.

### Step 2 — full gate

```bash
bun run validate                        # every step must pass
cd e2e && npx playwright test --grep '\[V:steer.operator-row'   # after bun run build:web
npx playwright test --grep '\[V:steer.interrupt|\[V:steer.direct|\[V:steer.loop'  # regressions
```

### Step 3 — evidence and closeout

- Write `reports/acceptance-evidence.md`: the AC table from Story 2.8 with
  the test name(s) proving each row, the `bun run validate` tail, the
  Playwright summary, and the two captures.
- Edit `sprint-status.yaml:75` to `done`. Leave the unrelated `2-1` entry as
  is.
- Open the PR against `develop` from the template body (copied explicitly —
  GitHub does not auto-apply it via `gh`): Problem and outcome, Review
  guidance (start at the executor `turns:` head write), Solution (D1–D4),
  Behavior change (operator rows now appear in transcripts), Validation, and
  `Closes #188`. No AI references in the commit messages; conventional commit
  format (`feat(workflows): record delivered operator guidance in the node transcript`).

## Verification

- [ ] New Playwright spec green on both surfaces plus the API test.
- [ ] Existing steering specs still green.
- [ ] `bun run validate` green (includes `check:bundled`, `check:capability-matrix`, type-check, lint, all package tests).
- [ ] Evidence report written; tracker updated; PR opened with `Closes #188`.

## Risks and rollback

The spec is additive. If the redirect fixture's timing proves flaky on a
loaded machine, prefer widening the `T.*` wait on the echo row over
re-ordering assertions — order is the story's acceptance criterion and must
stay asserted.
