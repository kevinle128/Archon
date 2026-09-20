---
phase: 3
title: 'Contract and docs synchronization, matrix, and closeout'
status: pending
priority: P2
effort: '0.5d'
dependencies: [1, 2]
---

# Phase 3: contract and docs synchronization, matrix, and closeout

## Goal

Make the canonical engine/test contract, public OMP documentation, generated capability matrix, and sprint record match the verified implementation, then run the proportional repository gates.

## Files

| File                                                                       | Change                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `_bmad-output/specs/spec-agent-node-room/engine-integration.md`            | replace OMP's obsolete throw-only description with normalized marked-result behavior |
| `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`            | update OMP conformance fixture while retaining defensive thrown-abort coverage       |
| `packages/docs-web/src/content/docs/getting-started/ai-assistants.md`      | concise OMP Stop/resume/failure-boundary note                                        |
| `packages/docs-web/src/content/docs/reference/provider-capabilities.md`    | regenerate; do not hand-edit                                                         |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | `backlog` to `done` only at final closeout                                           |

Do not edit the historical files below `_bmad-output/specs/spec-agent-node-room/sources/`, the high-level provider matrix (its `stream-abort` statement is already correct), or UI files.

## Contract synchronization

Update the two root companions after code/test behavior is known:

- OMP owns a per-turn interrupt signal, waits for the real session header when necessary, uses the proven graceful platform mechanism (SIGTERM on POSIX), and returns one deterministic `stream_aborted` result carrying the session/accounting evidence.
- The executor case-2 path classifies that result only with the matching operator flag. The case-3 abort-like throw remains supported when a session id was already observed; it is defensive compatibility, not the primary first-turn provider shape.
- Cancel still dominates; natural-end races remain natural; force-kill/first-cause failures are unmarked errors and fail the node.
- Direct and AI-loop conformance are required. Do not claim a separate loop-group provider path.

Re-read each document before editing and keep anchors/rationale that remain true. Do not rewrite unrelated stories.

## Public OMP documentation

In the existing OMP section, add the smallest user-facing note that explains:

- `Stop` ends only the current OMP turn with graceful process interruption; it does not cancel the workflow node or undo files already written;
- after idle, `Send now` sends queued guidance as the next turn on the same OMP session; OMP RPC soft-inject is not used;
- identify the OMP version/platform pairs characterized for this release and recommend re-running compatibility checks after changing either; unexpected protocol/termination behavior fails the node instead of pretending redirect is safe;
- usage already reported by OMP and discoverable hidden-session usage is retained best-effort; an unfinished provider event may not contain final primary-turn usage.

Do not duplicate generic route authorization, dock layout, or the capability table in the provider setup guide. Do not hardcode timing samples as product constants; link to the spike report only from maintainer/PR evidence, not the public guide.

## Generated matrix

Run the generator, never edit the generated file by hand. The OMP cell in `Turn interrupt (operator Stop)` must become `**stream-abort**`, while Claude remains `**native**`.

```bash
bun run generate:capability-matrix
bun run check:capability-matrix
```

## UI/design scope and inherited acceptance

No UI implementation is in scope because the route projection and both docks are provider-neutral. `e2e/ui/agent-interrupt-redirect.spec.ts` already proves the shared behavior for Legacy and Console and writes into #183's tracked evidence directory, so do not rerun or overwrite that evidence for a provider-only change. The Phase 2 capability/projection fixture is the proof that OMP enters this shared path.

At normal desktop width and the authoritative 460px room width, verify:

- generating: dock remains at the panel bottom with `Stop` left and fixed-position `Queue` right;
- interrupting: `Stopping…` remains focusable with `aria-disabled`, at least the existing text-secondary contrast, no progress bar, and queue action still available;
- idle: Stop is gone, focus moves to fixed-position `Send now`, the `WILL SEND` band and “files already written stay written” disclosure appear, and the active tool shows `⚠ interrupted`, not failed;
- resumed: `Stop` and `Queue` return together; no dock/room overflow, layout shift, extra breakpoint, or shell divergence at 460px.

These criteria come from the ratified `control-states.md`, `DESIGN.md`, and `EXPERIENCE.md`; the older imported HTML mockup's durable “stopped node” language is superseded and must not be reintroduced.

If implementation unexpectedly changes a server/UI production file or any criterion above, expand scope explicitly, then run `cd e2e && bun run typecheck` and `bun run --cwd e2e test:ui -- --grep 'interrupt and redirect'` in a clean worktree after deciding where new evidence belongs. Do not silently overwrite #183's evidence.

## Final validation and status order

1. Confirm the platform-wide gate or an owner-approved platform-specific contract is recorded, then run all focused commands from Phases 1 and 2.
2. Generate/check the matrix. Confirm `git diff` contains no server/UI production files; otherwise follow the conditional visual gate above.
3. Run preliminary `bun run validate` from the root. Do not run root `bun test`.
4. Only after the spike, focused gates, matrix check, scope check, and preliminary validate are green, change `2-5-interrupt-and-redirect-a-running-omp-agent` from `backlog` to `done`.
5. Run `bun run validate` again so the status/document edits are covered. Restore `backlog` if the final gate fails.

If a PR is requested, target `develop`, explicitly use `.github/pull_request_template.md`, cite `plans/reports/omp-interrupt-resume-spike.md` plus the direct/loop tests, and include `Closes #185`.

## Completion gate

- Canonical companions, code, tests, and public docs describe one non-conflicting end shape.
- Generated matrix is current and untouched by hand.
- No UI/server production diff; if that changes, both visual surfaces pass all four states at desktop and 460px without overwriting prior evidence.
- Final `bun run validate` passes with sprint status included.
