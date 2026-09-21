# Characterization evidence — Issue #193 / Story 2.13

**Branch**: `archon/thread-1d25203e`
**Date**: 2026-09-20
**Scope**: Prove concurrent-operator receipt order and attribution through registry → route → executor → E2E (Legacy + Console). Test/docs-only; no production defect found.

## Verdict

| Layer                                                            | Result                                 | Production change      |
| ---------------------------------------------------------------- | -------------------------------------- | ---------------------- |
| Registry mixed-sender FIFO / idempotent replay / idle `send_now` | PASS                                   | None — already correct |
| Deterministic overlapping Hono route (identity-hold)             | PASS                                   | None — already correct |
| Executor direct / idle `send_now` / loop mixed-sender drains     | PASS                                   | None — already correct |
| E2E two-operator journeys (Console + Legacy)                     | PASS                                   | None — already correct |
| Neighbor E2E + `bun run validate`                                | PASS after unblock commits (see below) | None for #193 behavior |

**No lock, lane, timestamp sort, schema, OpenAPI, queue-response, or transcript-metadata contract change.** Queue GET remains `{ message_id, message }` only. Transcript operator rows keep `origin` / `operator_user_id` / `message_id`.

## Semantics pinned

- **Global order** = synchronous `NodeSteeringHandle.accept()` order (not click order, request-creation order, response-completion order, or timestamps).
- **Within-sender order** assumes one dock/request stream waits for its prior send response before the next.
- **No cross-user leakage** = no sender substitution on written/displayed rows; the node queue is deliberately shared.
- **E2E oracle** = observed pre-drain queue id order; transcript + DOM must equal that order.

## Scenario / test map

| ID / name                                                                    | Location                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| mixed-sender drain + cross-sender duplicate-id + idle `send_now` batch       | `packages/workflows/src/steering-registry.test.ts`     |
| `overlapping identity streams preserve accept order and request attribution` | `packages/server/src/routes/api.workflow-runs.test.ts` |
| direct / interrupt idle / loop mixed-sender strengthenings                   | `packages/workflows/src/dag-executor.test.ts`          |
| `[V:steer.concurrent-operators-console]`                                     | `e2e/ui/agent-queue-convergence.spec.ts`               |
| `[V:steer.concurrent-operators-legacy]`                                      | `e2e/ui/agent-queue-convergence.spec.ts`               |

## Commands and results

### Narrow gates

```text
(cd packages/workflows && bun test src/steering-registry.test.ts src/node-transcript.test.ts)
→ 71 pass, 0 fail

(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
→ 296 pass, 9 todo, 0 fail

(cd packages/workflows && bun test src/dag-executor.test.ts)
→ 659 pass, 0 fail

(cd e2e && npm run typecheck)
→ exit 0

(cd e2e && npx playwright test agent-queue-convergence --grep 'steer.concurrent-operators')
→ 2 passed (console + legacy)
```

### Neighbor + repository gates

```text
(cd e2e && npx playwright test agent-queue-convergence agent-queue-guidance)
→ 16 passed, 1 flaky (blocked-legacy focus race; passed on retry); exit 0
  includes both concurrent-operators scenarios + visual guidance after unblock

bun run validate
→ exit 0 after unblock commits (type-check, lint, format:check, full package tests)
```

Lockfiles: `bun.lock` and `e2e/package-lock.json` **unchanged**.

## Unblock commits (pre-existing gate debt, not #193 behavior)

Closeout required neighbor E2E + `bun run validate`. Base failures blocked those gates and were fixed in separate `chore(unblock):` commits with **zero** Story 2.13 product changes:

1. **`chore(unblock): fix pre-existing prettier failure blocking validate`**
   - Fingerprint: `format:check` → `packages/web/src/lib/steering-dock.test.ts`
   - Cause: unfinished-iteration expect formatting drifted from Prettier (Story 2.10 land).
   - Fix: Prettier rewrite of that expect only.

2. **`chore(unblock): fix focus-ring contrast probes blocking neighbor E2E`**
   - Fingerprint: `steer.visual-{console,legacy}` → `focus indicator ≥ 3:1` received ~1.03
   - Cause: `resolveColorIn(field, …)` appends a probe `<span>` into a `<textarea>`, which cannot host children → empty/near-bg color → false contrast fail. Product outline (`focus-visible:outline-accent-bright`) was already correct.
   - Fix: host probes on the room container; keyboard-focus the field so `:focus-visible` paints; assert outline resolves to `--accent-bright`. Applied in `agent-queue-guidance.spec.ts` and the same pattern in `agent-interrupt-redirect.spec.ts`.

3. **`chore(unblock): refresh visual pins blocking verify-feature-gate`**
   - Fingerprint: `scripts/verify-feature-gate.test.ts` → `Pinned visual source changed: …/SPEC.md`
   - Cause: Story 2.10+ docs changed SPEC.md / DESIGN.md / EXPERIENCE.md without refreshing `visual-config.json` sha256 pins or the catalog `ui.visual` runner binding digest.
   - Fix: re-pin the three sources and update `features/run-ui.json` browser visual binding id to `visualBinding()`.

## Production defects fixed for #193

**None.** Characterization only across US-001…US-004.

## Tracker / docs

- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` — concurrent-operators section maps the four proof layers and states the semantics above.
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` — only `2-13-preserve-message-order-and-attribution-under-concurrent-operators` → `done` after gates pass.
- No evergreen product docs, migrations, config, generated output, or background processes.

## Story commits (implement)

| Story  | Commit subject                                         |
| ------ | ------------------------------------------------------ |
| US-001 | `feat: Registry mixed-sender characterization`         |
| US-002 | `feat: Deterministic route concurrency test`           |
| US-003 | `feat: Executor mixed-sender transcript chain`         |
| US-004 | `feat: E2E two-operator journey on Legacy and Console` |
| US-005 | this closeout (evidence + test plan + tracker)         |
