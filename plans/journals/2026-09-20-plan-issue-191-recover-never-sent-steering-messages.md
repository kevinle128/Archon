---
title: "Plan issue 191: recover never-sent steering messages"
date: 2026-09-20
summary: Deep TDD plan for Story 2.11 terminal reconciliation in both node-room shells
---

# Plan issue 191: recover never-sent steering messages

## What was planned

Deep TDD plan for issue #191 / Story 2.11 at
`plans/260920-1136-issue-191-recover-never-sent-messages/` (4 phases, ~14h):
shared `steering-dock.ts` core (accepted ledger + `reconcileNeverSent` +
`finished` mode), both dock renderers (read-only `NEVER SENT` box with one
assertive alert), both panes (post-terminal transcript drain gate), then E2E
evidence, authority sync, and tracker closeout. Client-only; no server,
schema, or API change.

## Non-obvious findings

- Cancel discards the steering registry synchronously in `cancelWorkflowRun`
  (`discardRunSteeringHandles`), but the executor writes `node_failed` up to
  10 s later (`CANCEL_CHECK_INTERVAL_MS`) and the web run query stops polling
  the moment it sees `cancelled` — so the browser may never observe the node
  terminal *event*. The plan keys reconciliation on the settled terminal row
  status (or non-live run) plus one transcript drain started after that
  observation, and records this as an AD-11 clarification.
- `NodeSteeringHandle.drain()` empties the queue before the operator row is
  written (row lands at the guidance turn's first stream yield). A queue
  snapshot in that window wipes the client's `sent`, so a drained-but-unwritten
  message would vanish; the plan adds a tab-local accepted ledger and
  reconciles ledger ∪ shown queue.
- Advisor red-team blocker: `retry-node`/`resume` re-run the same row under
  the same dock `key`, so a sticky `finished` mode would hide the composer.
  Fixed by gating `finished` on a still-terminal row and resetting dock/pane
  state when the row returns to running.
- EXPERIENCE.md's "same register as the stop wait" (polite status) conflicts
  with the story's assertive `role="alert"`; the story AC wins and is recorded.

## Process

The first advisor call timed out; the plan was drafted from direct scouting
and the advisor review ran successfully afterwards on the durable files.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
