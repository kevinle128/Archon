# Acceptance — Story 2.9 / Issue #189

Live queue shared across tabs and operators. Evidence collected after green
gates on this worktree. No destructive “red run on develop” claim: focused
unit/component tests own race/error/focus proof; multi-view Playwright owns
outside-in convergence.

## Story 2.9 Given/When/Then map

### 1. Same live node in two tabs / two operators converges

**Criterion** (epics.md ~677–679): when either view queues or withdraws, both
views converge on the same `QUEUED · n` and ordered message list.

| Evidence          | Detail                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright        | `[V:steer.converge-console]`, `[V:steer.converge-legacy]`                                                                                                                                                                                                                                       |
| Shells            | Console + Legacy at 460×900; Console also 1440×900 at two-row and one-row                                                                                                                                                                                                                       |
| Proof             | Three authenticated views (starterA + starterB same context, teammate context). After starter send → all DOM lists + starter GET + teammate GET = `[starterId]`. After teammate send → all five observations = `[starterId, teammateId]` with `QUEUED · 2`, exact id/text/order, no duplicates. |
| Screenshots       | `converge-{console,legacy}-460-two-row-{starterA,starterB,teammate}.png`; `converge-console-1440-two-row-starterA.png`; one-row counterparts                                                                                                                                                    |
| Measurements      | `evidence/convergence-console.json`, `evidence/convergence-legacy.json`                                                                                                                                                                                                                         |
| Phase 1–2 focused | Server GET hot path + generation-guarded `applyQueueSnapshot` (`api.workflow-runs.test.ts`, `steering-dock.test.ts`); dock poll wiring (`ComposerDock.test.tsx`, `ConsoleComposerDock.test.tsx`)                                                                                                |

### 2. Unsent drafts stay tab-local

**Criterion** (epics.md ~681–684): only queued items are shared; each unsent
draft remains local to its tab.

| Evidence          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright        | Same converge journeys                                                                                                                                                                                                                                                                                                                                                                                                  |
| Proof             | `draft-alpha-<tag>` typed in starterB and `draft-beta-<tag>` in teammate before any mutation; both field values and `sessionStorage` keys `archon:steering-draft:<runId>:steer-a` asserted. After starter queues, both drafts/storage unchanged. After teammate queues its draft, teammate field+storage clear while starterB draft/storage remain byte-for-byte. After full empty queue, starterB draft still present. |
| Measurements      | `draftsBefore` / `final.drafts` in each `convergence-*.json`                                                                                                                                                                                                                                                                                                                                                            |
| Phase 1–2 focused | `applyQueueSnapshot` never touches draft/sessionStorage; dock component case “remote snapshot leaves draft and sessionStorage byte-for-byte unchanged”                                                                                                                                                                                                                                                                  |

### 3. Remote withdraw — no duplicate DELETE, no stale count

**Criterion** (epics.md ~686–688): withdrawn item disappears in the other view
without a duplicate request or stale count.

| Evidence          | Detail                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright        | Same converge journeys                                                                                                                                                                                                                                                                                                                                                          |
| Proof             | starterB focuses starterId delete; starterA withdraws via keyboard. All views + both identity GETs → `[teammateId]`. starterB DELETE count = 0 for the entire journey; teammate DELETE count unchanged during first removal. After teammate withdraws remaining id → all observations `[]`, no `QUEUED` band, starterB focus on composer field (not `<body>`), draft preserved. |
| Screenshots       | `converge-*-460-one-row-*.png`, `converge-*-460-empty-starterB.png`, `converge-console-1440-one-row-starterB.png`                                                                                                                                                                                                                                                               |
| Measurements      | `activeBeforeFirstRemoval` / `activeAfterFirstRemoval` / `activeAfterEmpty`, `requestCounts.starterBDeletes`                                                                                                                                                                                                                                                                    |
| Phase 1–2 focused | `focusTargetAfterSnapshot` next→previous→field; dock cases for focused remote removal; withdraw route already owned by `agent-withdraw-guidance.spec.ts` (not re-tested here)                                                                                                                                                                                                   |

### 4. Two-tab E2E: convergence, identity, keyboard, no cross-node leakage

**Criterion** (epics.md ~690–692): two-tab coverage verifies convergence,
message identity, keyboard access, and no cross-node leakage.

| Evidence     | Detail                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright   | `[V:steer.converge-*]` (convergence, identity headers via `viewer_is_starter`, keyboard withdraw, focus) + `[V:steer.scope-console]`, `[V:steer.scope-legacy]` (pair nodes)                                                                                         |
| Scope proof  | Own pair run; both `steer-a`/`steer-b` `node_started` + empty GETs; page A queues `A-only`, page B queues `B-only`; DOM+server = `[aId]` / `[bId]` with no text/id leakage. Navigate A→B hydrates exactly `[bId]`; back to A exactly `[aId]`; page B stays `[bId]`. |
| Screenshots  | `scope-{console,legacy}-460-node{A,B}.png`, `scope-console-1440-nodeA.png`                                                                                                                                                                                          |
| Measurements | `evidence/scope-console.json`, `evidence/scope-legacy.json`                                                                                                                                                                                                         |
| Keyboard     | Converge journey uses native delete focus + Enter (Console) / Space (Legacy) activation; response waiter armed before keypress                                                                                                                                      |

## Validation commands and results

| Step         | Command                                                                                      | Result                      |
| ------------ | -------------------------------------------------------------------------------------------- | --------------------------- |
| Web bundle   | `bun run build:web`                                                                          | pass                        |
| E2E types    | `(cd e2e && npm run typecheck)`                                                              | pass                        |
| New spec     | `(cd e2e && npx playwright test -c playwright.config.ts ui/agent-queue-convergence.spec.ts)` | 4 passed                    |
| All steering | `(cd e2e && npx playwright test -c playwright.config.ts --grep '\[V:(steer\|withdraw)\.')`   | 20 passed                   |
| Repo gate    | `bun run validate`                                                                           | pass (recorded at closeout) |

## Out of scope (owned elsewhere)

- Route error ladder 404/409/422/500 + auth matrix — Phase 1 server tests
- Provider-drain of withdrawn text — `agent-withdraw-guidance.spec.ts`
- Detached send-triggered disclosure — existing `[V:steer.detached-*]` scenarios
- Design source hash updates — none required (no pinned design source change)

## Tracker

After the gates above: only
`2-9-see-the-same-live-queue-across-tabs-and-operators` flipped
`backlog` → `done` in
`_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.
Unrelated stale `2-1-...` entry left untouched.
