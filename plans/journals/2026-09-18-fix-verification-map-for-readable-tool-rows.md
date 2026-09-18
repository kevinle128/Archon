---
title: Fix verification map for readable tool rows
date: 2026-09-18
summary: Mapped Story 1.1 paths so verify-archon can create a complete selection.
---

# Fix verification map for readable tool rows

## What happened

Selection failed with `Unmapped changed path: e2e/ui/agent-tool-row-visual.spec.ts`.
The HITL and verification-contract manifests did not cover 46 changed paths in the readable tool-row branch.

## Decision

Add narrow impact paths for the new E2E test, shared presentation files, responsive navigation, plan evidence, and bundled-default test.
Add a regression test that normalizes representative paths to the six intended behaviors without broadening.

## Result

The verification skill tests pass.
Selection normalization and validation pass for base `8c90cb6` and head `b5558465`.

## Next steps

Run `verify-archon prove` with the normalized selection from a clean checkout when execution proof is requested.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
