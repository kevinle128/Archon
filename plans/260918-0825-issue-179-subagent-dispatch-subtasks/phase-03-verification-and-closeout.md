---
phase: 3
title: 'Phase 3: Verification and closeout'
status: todo
priority: P1
effort: '2h'
dependencies: [1, 2]
---

# Phase 3: Verification and closeout

## Goal

Prove the shipped task body against the visual and accessibility contract on both surfaces, pass every repository gate, record the evidence, and move the sprint tracker to `done`.

## Context links

- [plan.md](./plan.md) acceptance criteria (visual row) and "No E2E in this story".
- Prior evidence conventions: `plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md` and `reports/evidence/*.png`, `tool-row-contrast.json`.
- Tokens and contrast: `DESIGN.md:466-475` (measured table; node-approval on surface-elevated 6.5:1 / 6.8:1; 11.5px text-primary and text-secondary on surface-elevated 14.1:1 / 16.7:1 and 5.3:1 / 7.9:1), `:697` (target size).
- Sprint tracker: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:63`.
- PR template: `.github/pull_request_template.md`.

## Deep-mode scout pass (run before starting)

1. Confirm Phase 2 landed on both surfaces (`git diff develop --stat -- packages/web/src`).
2. Decide the evidence source, in this order. <!-- Updated: Red Team 2026-09-18 — finding F1 -->
   - **Preferred — a real dispatch on a scratch `ARCHON_HOME`.** With `ARCHON_HOME=$(mktemp -d)` and a Claude credential, run a throwaway one-node workflow (kept outside the repo) whose prompt asks the model to dispatch exactly one `Explore` subagent with a synthetic brief, via `bun run cli workflow run … --no-worktree`. This produces a genuine `Task` payload (which also closes the Phase 1 shape preflight with captured data) and a navigable run in the dev server pointed at that `ARCHON_HOME`.
   - **Fallback — static markup.** A throwaway test (not committed) renders the Phase 2 OMP fixture through `renderToStaticMarkup` on each surface, writes the HTML plus the built stylesheet to a temp file, and the screenshot is taken from that file in a browser.
   - **Never** insert a bare `workflow_node_messages` row: `workflow_run_id` is `NOT NULL REFERENCES remote_agent_workflow_runs(id)` (`migrations/000_combined.sql:747`, `packages/core/src/db/adapters/sqlite.ts:1106`) and the messages route 404s without a run row (`packages/server/src/routes/api.ts:5278-5279`), so a message row alone is unreachable in the UI. Never touch the shared `~/.archon/archon.db`.

## File inventory

| Path | Action | Size | Test impact |
| --- | --- | --- | --- |
| `plans/260918-0825-issue-179-subagent-dispatch-subtasks/reports/visual-acceptance.md` | Create | ~80 lines | none |
| `plans/260918-0825-issue-179-subagent-dispatch-subtasks/reports/evidence/*.png` | Create | 4–6 files | none |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Modify `:63` | 1 line | none |

## Tests before

No new red tests: this phase runs the suites Phases 1–2 wrote and adds measurement evidence. Confirm the gates are green *before* touching visuals so any regression is attributable:

```bash
cd packages/web && bun run test && bun run type-check
cd ../.. && bun run validate
```

## Refactor

None expected. If a visual check reveals a token or spacing bug, fix it on **both** surfaces, add the missing assertion to the Phase 2 test that should have caught it, and rerun the gates.

## Verification steps

1. **Static anatomy screenshot (both surfaces).** Start the dev server against the scratch `ARCHON_HOME` (`ARCHON_HOME=… bun run dev`, note the worktree port and PID), open the dispatch node from the scout pass (or the static-markup fallback) at 460px room width, expand the row, capture Legacy and Console with one card closed and one open. Save as `reports/evidence/{legacy,console}-task-body-460.png`.
2. **Mockup comparison.** Place the screenshot beside `key-transcript-states.html:293-311` and record differences: the body bar reads `task · N subagents · …` (recorded deviation from `task · batch · 2 subtasks`), everything else must match (context line, card order, agent semibold, name bold, `—` excerpt, open prompt box).
3. **Geometry.** In DevTools measure a card summary height (≥ 24px), card padding (6px/9px), radius (6px), top margin (5px), and the open body-box padding (8px/10px). Record in the report.
4. **Contrast.** Measure the actual rendered colours (computed style → sRGB) for: agent text (node-approval) on surface-elevated; name (text-primary) on surface-elevated; excerpt (text-secondary) on surface-elevated; prompt (text-primary) on surface-inset — on both surfaces. All ≥ 4.5:1. Save as `reports/evidence/task-card-contrast.json`.
5. **Keyboard.** Tab from the outer row summary reaches card 1, card 2, then `View full output` when present; Enter/Space toggle a card; focus ring is `--accent-bright` 2px with the surface's offset; the outer row does not change state. Record the sequence.
6. **Reduced motion.** With `prefers-reduced-motion: reduce`, the card chevron flips without transition.
7. **Screen reader spot check.** One pairing (VoiceOver + Safari or Chrome) on each surface: a card announces as a disclosure named `agent · name — excerpt`, collapsed/expanded; the prompt is read only when expanded. Record verbatim.
8. **Zoom sweep.** 200% zoom: cards stay one line in the summary (excerpt elides), no horizontal scroll in the room.
9. **Stop the dev server** using its recorded PID.

## Tests after

- `bun run validate` green (includes `check:bundled*`, lint with zero warnings, type-check, per-package tests).
- `console-isolation.test.ts` green.

## Regression gate

```bash
bun run validate
```

## Closeout steps

1. Write `reports/visual-acceptance.md`: mockup comparison, geometry table, contrast table, keyboard sequence, reduced-motion result, screen-reader transcript, zoom result, and the explicit note that a Playwright proof of a dispatch is out of scope because the `e2e-fake` provider emits only `Read` (`packages/providers/src/e2e-fake/provider.ts:27-29`).
2. Edit `sprint-status.yaml:63` → `1-6-inspect-a-subagent-dispatch-and-its-subtasks: done`.
3. Open the PR against `develop` (this fork's working branch — `git remote show origin`) with the repo template: Problem and outcome, Review guidance (point reviewers at the Phase 1 decision list and the two insertion lines), Solution, Validation (paste the gate commands and the report path), `Closes #179`. Conventional commit, no AI references in the commit subject/body beyond the mandated trailer.
4. If Story 1.2 (#175) has merged meanwhile, confirm the rebase moved the task body into the Raw swap slot, that 1.2's "no `<details>` inside a tool row" assertions were re-scoped to exclude `[data-subtask-index]` (Phase 2 scout pass step 3), and that both stories' tests pass together before requesting review.

## Test scenario matrix

| Priority | Scenario | Evidence |
| --- | --- | --- |
| Critical | All automated suites and `bun run validate` green | terminal output pasted in PR |
| Critical | Card anatomy matches DESIGN on both surfaces | screenshots + geometry table |
| High | Contrast ≥ 4.5:1 for the four card pairs, both surfaces | `task-card-contrast.json` |
| High | Keyboard and focus behaviour | recorded sequence |
| Medium | Reduced motion, 200% zoom | recorded results |
| Medium | Screen-reader announcement | transcript |

## Dependency map

- Depends on Phases 1–2 being merged into the working branch.
- Feeds the issue's third acceptance box (`sprint-status.yaml` → `done`) and the PR.

## Todo

- [ ] Scout pass: fixture source for a real dispatch decided.
- [ ] Gates green before visuals.
- [ ] Screenshots, geometry, contrast, keyboard, reduced-motion, screen-reader, zoom recorded.
- [ ] `reports/visual-acceptance.md` written.
- [ ] `sprint-status.yaml:63` → `done`.
- [ ] PR opened with template and `Closes #179`; dev server stopped.

## Success criteria

The report exists with every measurement filled in, all gates are green, the tracker reads `done`, and the PR is open against `develop`.

## Risk assessment

- **No real dispatch available** → run the throwaway workflow on a scratch `ARCHON_HOME`, or fall back to static markup; never mutate the shared database and never insert orphan message rows.
- **Contrast miss on the excerpt** (text-secondary on surface-elevated is 5.3:1 Legacy at 11.5px) → within budget; if a token changed since DESIGN was measured, report and stop rather than picking an ad-hoc colour.
- **Orphaned dev server** → record PID at start, stop at the end (process-management rule).

## Security considerations

Screenshots and the scratch fixture must use synthetic prompt text only — never a real user's dispatch content from the shared database.

## Next steps

Merge; Story 1.3 picks up the `generic` arm and bar words; Story 1.2 (if later) rebases the task body into the Raw swap slot.
