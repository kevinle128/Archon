# Story 2.2 — Withdraw a queued guidance message: acceptance report

Date: 2026-09-19
Issue: https://github.com/kevinle128/Archon/issues/182
Spec under test: `e2e/ui/agent-withdraw-guidance.spec.ts` (self-contained; local copies of `openGuidanceRoom`, field/list locators, route paths, node-start poll, transcript projection — `e2e/ui/agent-queue-guidance.spec.ts` untouched)

All statements below are observed results from the runs listed; nothing is pre-claimed.

## Validation sequence (run in order)

| Command                                                          | Result                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(cd e2e && npm run typecheck)`                                  | pass, 0 errors                                                                                                                                                                                                            |
| `bun run --cwd e2e test:ui -- --grep 'withdraw'`                 | 5 passed (2.6m)                                                                                                                                                                                                           |
| `bun run --cwd e2e test:ui -- --grep 'withdraw\|queue guidance'` | 16 passed — 5 new withdraw + 11 Story 2.1 regression (agent-queue-guidance)                                                                                                                                               |
| `bun run validate`                                               | exit 0 — check:bundled\*, type-check, lint `--max-warnings 0`, format:check, test:install, full parallel package sweep, `bun test ./scripts/` (158 pass / 2 skip / 0 fail), `test:verification-skills` (48 pass / 0 fail) |
| `bun run format:check`                                           | pass                                                                                                                                                                                                                      |
| `git diff --check`                                               | clean on the final diff                                                                                                                                                                                                   |

Pre-existing blockers were cleared en route as separate `chore(unblock)` commits (no story content in any): `c28c802b` raised wall-clock budgets on five tests starved by the parallel sweep on this box (implicit 5s bun default / 50ms JSONata eval deadline; assertions unchanged); `75d83b65` re-pinned six drifted visual-source sha256 values plus the `ui.visual` catalog binding in `.agents/skills/verify-archon/` (drift introduced by earlier merged feature work); `f49947c0` made the CLI-046 concurrent-retry test poll the detached worker's log flush instead of racing it; `e31e44ae` raised the large-corpus audit test's budget (5459ms under load vs the implicit 5s default).

## Runtime environment

Playwright 1.60.0, bundled Chromium (1243). Each Playwright worker owns an isolated Archon server + SQLite + `ARCHON_HOME`. Runs were web-dispatched via `startWorkflowViaWeb('e2e-queue-guidance')`; the fixture's 30 s first-turn provider delay kept the node steerable while messages were queued and withdrawn. No fixed sleeps anywhere in the spec — all waits are event/response/DOM/status based.

## Criterion → evidence mapping

### 1. Two-row withdraw + delivery exclusion — `[V:withdraw.drain-console]`, `[V:withdraw.drain-legacy]`

Both tests: queued two rows (`queued · 2` visible), withdrew the first via keyboard (Enter on Console, Space on Legacy), then let the run complete.

- Exactly one `DELETE` request fired; `request().postData()` was `null` (bodyless); path contained the exact `runId/nodeId/messageId`; response JSON was exactly `{ "success": true, "message_id": <firstId> }` with status 200.
- After deletion: `queued · 1` visible, one `listitem` remained containing only the sibling marker; `document.activeElement` was the remaining row's delete button (`drain-*-one-row` in `withdraw-measurements.json`).
- Provider transcript (`listNodeMessages`, kind `text`): exactly **one** `[e2e-fake] resumed echo: SECOND-<tag>` and **zero** texts containing `WITHDRAWN-<tag>` — the withdrawn prompt never reached the provider.
- Run finished `completed` with exactly **one** `nodeExecutions` row and exactly **one** `node_started` event for the node — the queue drained into a single provider turn.
- Accessible names observed (measurements): `delete · <full message text>` — e.g. `delete · WITHDRAWN-c9f1cefdf787 obsolete operator instruction padding …` (Console) and `delete · <<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>>SECOND-c9f1cefdf787` (sibling). Button `type="button"` on both surfaces.
- Measured target size: Console **55.125 × 24 px**; Legacy **55.609 × 24 px** — both ≥ 24 × 24.
- Focused focus-ring computed values (via real Shift+Tab traversal, so `:focus-visible` applied): Console `2px solid oklab(0.64 0.255478 -0.1475 / 0.578909)`; Legacy `2px solid oklab(0.654009 -0.0615636 -0.169145 / 0.514741)`.
- Elision/overflow facts: first message span `scrollWidth` 3260 (Console) / 3298 (Legacy) vs `clientWidth` 346 / 341, `text-overflow: ellipsis`, `white-space: nowrap`, `overflow-x: hidden`; the room-driven overflow assertion (`expectNoRoomDrivenOverflow`) passed on Console at 1440 × 900 **and** at a 460 px re-check, and on Legacy at 460 × 900 — no room element overflowed the page and the room itself had no horizontal scroll.
- Screenshots: `withdraw-drain-console-two-rows.png`, `withdraw-drain-console-460-two-rows.png`, `withdraw-drain-console-one-row.png`, `withdraw-drain-legacy-two-rows.png`, `withdraw-drain-legacy-one-row.png` (all under `reports/evidence/`).

### 2. Last-row withdraw restores the field — `[V:withdraw.last-console]`, `[V:withdraw.last-legacy]`

Single echo-marked message queued, deleted via the surface's activation key:

- Exact `DELETE` 200 `{ success: true, message_id }`; bodyless request.
- Queue band/list disappeared: `queueList` count 0, no `queued ·` text.
- `document.activeElement` was the labelled composer `textarea` (`last-*` measurements: `activeElement: "textarea"`); explicitly asserted `!== BODY`.
- Reduced-motion parity: under `page.emulateMedia({ reducedMotion: 'reduce' })` the final DOM and focus state were identical (`reducedMotionParity: true`); captures `withdraw-last-console-reduced-motion.png`, `withdraw-last-legacy-reduced-motion.png` sit next to the normal-motion `withdraw-last-*-removed.png`.
- After `completed`, no transcript text contained the unique `LAST-<tag>` marker.

### 3. Route ladder — `[V:withdraw.route-ladder]` via `archon.starterFetch`

Against a live web-dispatched run (one message queued via POST):

- Live-node `DELETE` → 200 `{ success: true, message_id }`.
- Repeat `DELETE` → identical 200 (idempotent).
- Never-queued valid UUID → 200 echoing the requested id.
- `'not-a-uuid'` → 400, nested `{ success: false, error: { code: "invalid_request" } }`.
- Unknown node id → 404, nested `not_found`. Unknown run id → 404, nested `not_found`.
- Detached CLI run (started via `startDetachedWorkflow`, node live) → 422, nested `not_steerable_here`.
- Completed run → 409, nested `node_finished`.
- Node-message counts compared before/after every refusal request: unchanged (asserted both mid-ladder and after the finished-run refusal). The test does **not** claim to inspect the process-local queue — refusal immutability is proven at the node-message store level plus US-001's unit-level queue assertions.

Parked-handle removal, actor/permission matrix, 500 internals, and the final-phase race are covered by US-001's 19-case route suite and are intentionally not duplicated here.

## Delivery-exclusion assertion (summary)

Across both drain tests: withdrawn unique markers (`WITHDRAWN-<tag>`) appear zero times in persisted node transcript texts after completion; the sibling echo (`SECOND-<tag>`) appears exactly once as a `resumed echo`. Single execution, single `node_started`.

## Race / refusal assertions (summary)

Synchronous splice happens only after auth → params → run load → projection/handle → refusal ladder → run re-read → post-await `handle.snapshot().phase` recheck (US-001). E2E proves: refusal statuses per ladder above; no node-message mutation on any refusal; idempotent 200s. The final-phase race itself (handle closed between phase check and withdraw → 409, item still queued) is unit-tested, not E2E — noted as a limitation below.

## Evidence inventory (`reports/evidence/`)

| File                                                        | Content                                                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `withdraw-drain-console-two-rows.png`                       | Console 1440 × 900, two queued rows, first delete focused (room width 464 px)                                                |
| `withdraw-drain-console-460-two-rows.png`                   | Console re-checked at 460 px — no room-driven overflow                                                                       |
| `withdraw-drain-console-one-row.png`                        | Console after removal: one row, focus on sibling delete                                                                      |
| `withdraw-drain-legacy-two-rows.png`                        | Legacy 460 × 900, two queued rows (room width 460 px)                                                                        |
| `withdraw-drain-legacy-one-row.png`                         | Legacy after removal: one row, focus on sibling delete                                                                       |
| `withdraw-last-console-removed.png` / `-reduced-motion.png` | Console last-row: band gone, focus on textarea (normal + reduced motion)                                                     |
| `withdraw-last-legacy-removed.png` / `-reduced-motion.png`  | Legacy same pair                                                                                                             |
| `withdraw-measurements.json`                                | All measured values cited above (names, types, sizes, outlines, elision, active element, viewport/room widths, parity flags) |

## Known limitations

- **Drain-race ambiguity**: a withdraw racing the executor's drain boundary is inherently timing-dependent; E2E proves the well-separated case (queued → withdrawn → drain → sibling delivered, withdrawn absent). The interleaved phase-check race is covered by US-001 unit tests, not provable deterministically in a browser run.
- **Local-only UI**: both docks render the local registry projection; cross-operator/cross-tab queue consistency is a separate story (2-9/2-13 scope).
- **Process-local queue**: E2E cannot inspect the in-memory `pending[]`; exclusion is proven via transcript payloads and node-message counts, not queue introspection.
- **PR creation**: owned by the parent workflow per the ralph contract — no `gh pr create` was run in this iteration; that acceptance item lands when the parent opens the PR.

## Explicitly unrun checks

- axe / automated accessibility scan — not run.
- Live screen-reader pass (VoiceOver/NVDA) — not run; accessibility evidence is DOM/ARIA-level only (roles, names, focus order).
- Parked-handle DELETE and actor-matrix refusals — covered by unit tests (US-001), intentionally not re-run through Playwright.
