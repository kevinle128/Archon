---
title: Planned workflow transcript display and Legacy viewport fixes
date: 2026-09-19
summary: 'Created and independently verified a three-phase TDD plan for transcript rendering, ACP chunk grouping, Legacy scroll containment, and runtime minimap removal.'
---

# Planned workflow transcript display and Legacy viewport fixes

## Outcome

Created `plans/260919-0843-fix-workflow-transcript-display/` as the active P1 plan.
The plan has 3 phases and 39 unchecked implementation tasks.
GitHub issue [#208](https://github.com/kevinle128/Archon/issues/208) tracks delivery and includes the Codex reproduction.

## Decisions

Devin and DeepSeek ACP message chunks use the existing delta contract.
A loop missing-output re-ask rotates its transcript attempt before retry.
Structured transcript display unwraps only a canonical one-string JSON envelope after text projection.
The API, persisted transcript, and structured node output stay unchanged.
All three local scroll containment fixes are mandatory before any shared Layout fallback.
Only the Legacy runtime `WorkflowDagViewer` minimap is removed.

## Verification

An independent read-only verifier confirmed all five runtime-flow rows, at least ten source claims per phase, the TDD structure, and red-team reconciliation.
`ak plan validate` passed.
Actual product behavior remains unverified until implementation runs the planned tests and governed UI proof.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
