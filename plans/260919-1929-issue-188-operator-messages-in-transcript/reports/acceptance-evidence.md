# Acceptance evidence — Issue 188 / Story 2.8

Plan: `plans/260919-1929-issue-188-operator-messages-in-transcript/`
Date: 2026-09-19T21:16:06Z
Branch: `archon/thread-74969958`

## Parent-plan acceptance criteria → proving tests

| Criterion                                             | Proof                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Stored operator triple + verbatim text row            | `packages/workflows` `node-transcript.test.ts`, `dag-executor.test.ts` operator matrix (US-003) |
| Server display-name projection + fail-open            | `packages/server` `api.workflow-runs.test.ts` (US-001)                                          |
| Web history `kind: 'operator'` + both shells          | `agent-history.test.ts`, `LegacyNodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx` (US-002)         |
| Natural drain API + DOM on both surfaces              | `e2e/ui/agent-queue-guidance.spec.ts` `[V:steer.direct-{console,legacy}]`                       |
| Interrupt redirect API triple, attempt placement, DOM | `e2e/ui/agent-interrupt-redirect.spec.ts` `[V:steer.interrupt-{console,legacy}]`                |
| Visual tokens 460/1440 both shells                    | `e2e/ui/agent-interrupt-redirect.spec.ts` `[V:steer.interrupt-visual-{console,legacy}]`         |
| `listNodeMessages` type matches contract              | `e2e/lib/playwright/run-detail.ts` `NodeMessageRow`                                             |
| No third steering spec / no extra full workflow       | Diff touches only the two existing specs + helper                                               |
| No migration / no backfill                            | No SQL/schema changes in this feature branch                                                    |

## Focused package gates

| Gate                                                                 | Result                       |
| -------------------------------------------------------------------- | ---------------------------- |
| `bun --filter @archon/core test`                                     | pass                         |
| `bun --filter @archon/workflows test`                                | pass (after unblock commits) |
| `bun --filter @archon/server test`                                   | pass                         |
| `bun --filter @archon/web test`                                      | pass                         |
| `bun run type-check`                                                 | pass                         |
| `bun run lint --max-warnings 0`                                      | pass                         |
| `bun run build:web`                                                  | pass                         |
| `cd e2e && npm run typecheck` / `bunx tsc -p tsconfig.json --noEmit` | pass                         |
| `bun run validate`                                                   | pass                         |

Unblock commits required for the workflows package gate (pre-existing base failures, not story regressions):

- `chore(unblock): drop stale pr-e2e-verify loader test`
- `chore(unblock): align ralph-loop-run provider expectations`

## Playwright

Commands (repo root absolute as `ARCHON_E2E_REPO_ROOT`; free port base to avoid sibling worktree collision):

```bash
ARCHON_E2E_REPO_ROOT=<abs root> ARCHON_E2E_PORT_BASE=3550 \
  npx playwright test -c playwright.config.ts \
  --grep '\[V:steer\.(direct|interrupt|interrupt-visual)-'

ARCHON_E2E_REPO_ROOT=<abs root> ARCHON_E2E_PORT_BASE=3560 \
  npx playwright test -c playwright.config.ts \
  ui/agent-queue-guidance.spec.ts ui/agent-interrupt-redirect.spec.ts
```

Results:

- Grep suite: **13 passed**
- Full both-spec files: **22 passed**

### Visual captures (this plan only)

| Surface | Viewport | File                                                     |
| ------- | -------- | -------------------------------------------------------- |
| Console | 460×900  | `reports/evidence/us-004-console-460-operator-rows.png`  |
| Console | 1440×900 | `reports/evidence/us-004-console-1440-operator-rows.png` |
| Legacy  | 460×900  | `reports/evidence/us-004-legacy-460-operator-rows.png`   |
| Legacy  | 1440×900 | `reports/evidence/us-004-legacy-1440-operator-rows.png`  |

Historical #181/#183 evidence directories were left in place (not moved).

## Generated-type diff review

`packages/web/src/lib/api.generated.d.ts` was regenerated in US-001 only. Diff limited to:

- transcript metadata `origin` + `operator_user_id`
- text-row response `operator_display_name?: string | null`

No further OpenAPI regeneration in US-004 (type-only E2E helper widening).

## Migration / backfill

**None.** Operator rows reuse existing `remote_agent_workflow_node_messages` text rows and strict JSON metadata. No table/column/index changes. `check:schema-upgrades` not required.

## Rollout

1. Drain active steering turns (no in-flight `send_now` / natural-drain batches mid-deploy).
2. Deploy the **complete** reader+writer build (US-001…US-004 together). Never ship writer-only: an old web reader maps operator text rows to assistant prose.
3. Reload open node-room tabs so clients pick up the new history branch and shell renderers.
4. Accept new guidance only after reload.

## Rollback (downgrade-safe)

- Prefer **forward-fix**.
- Or disable the executor writer while **keeping** the widened metadata schema/parser and server projection.
- **Never** delete audit rows to roll back.
- An exact binary downgrade to a build whose strict metadata schema lacks `origin`/`operator_user_id` is **not** safe once operator rows exist (transcript routes can 500).

## Notes from outside-in proof

- Browser sends need `X-Archon-User: e2e-hitl-starter` so `operator_display_name` projects as `e2e-starter`.
- Attempt-scoped room reloads drop the interrupted attempt’s tool card once the redirect attempt starts; interrupted→operator adjacency is proven by API `seq` + live operator→echo `compareDocumentPosition`. The idle step still asserts the interrupted tool card before `Send now`.
