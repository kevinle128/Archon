---
phase: 5
title: 'Validation, docs, and owner-aligned closeout'
status: pending
dependencies: [4]
---

# Validation, docs, and owner-aligned closeout

## Gates

Run the narrowest tests first, then widen after shared code changes. From `packages/web`, run `bun test src/lib/room-split-layout.test.ts`, then the two split-owner and two route-owner component tests, then the two room-body tests. Run focused files in separate Bun invocations when their process-wide `mock.module()` calls conflict, following the package's test-script splits. Use `NODE_ENV=development` and the package's Radix preload for tests under `src/components/` where required by `packages/web/package.json`; Console tests run in their existing isolated invocation. Also run `src/lib/use-container-split-mode.test.tsx`, `LegacyNodeRoom.test.tsx`, `ConsoleComposerDock.test.tsx`, `ComposerDock.test.tsx`, and `console-isolation.test.ts` as affected regressions. Fix failures, never weaken assertions merely to pass.

Then run `bun --filter @archon/web test`, `(cd packages/web && bun run type-check)`, `(cd e2e && bun run typecheck)`, and the focused Playwright specs in Phase 4. If a PR is in scope after ownership resolution, run `bun run validate` before creating it, as the repository requires. Never run `bun test` from the monorepo root. No schema-upgrade gate is needed because this plan changes no schema. Record exact commands, results, and evidence captures under the chosen owner's plan reports path.

## Documentation and source consistency

`packages/docs-web/src/content/docs/brand/index.md` currently lists `--rv-panel-default/min/max-width`, while `packages/web/src/index.css` defines those variables with no source consumer. If Phase 1 removes them, remove exactly those rows from the brand table and check its remaining claims against CSS. Search evergreen docs for instructions to drag/resize the Node Room; update only a real user-facing hit. Historical `docs/superpowers/` plans and old screenshot reports remain records. Verify all plan links and file references before closeout.

## Conditional tracker and issue steps

Resolve and record the owner choice first. If **#265 remains owner**, carry this implementation detail into Story 10.1's M001/M002 work; do not mark historical Story 3.1 or Epic 3 done, edit the issue map by hand, or claim #266 delivered it. Reconcile #266 with the owner through the normal issue workflow once the chosen implementation has evidence. If **#266 is explicitly assigned M001/M002**, update the approved Epic 10 story/issue boundary before coding and specify what #265 still owns; then update only the tracker entries the revised requirements authorize. Do not silently rewrite Story 10.1 AC or declare M005 complete. An issue-map status is a tracker contract, not a harmless manual JSON edit; use its owning workflow or verify its generator before changing it.

After all criteria pass, write an acceptance report mapping A1–A6 to exact tests, browser measurements, viewport/mode, and captures. Review the changed-file list for production API/schema drift, old ratio readers/writers, obsolete docs claims, and unintended changes to historical evidence. If a PR is authorized by the resolved ownership, use `.github/pull_request_template.md`, target `develop`, link the **chosen owning issue**, and include the completed validation. Any external issue comment should report verified delivery, not a planned handoff or an unrecorded decision.

## Rollback

Revert the focused web, E2E, and brand-doc changes together. Old localStorage ratio values were left intact and become readable again by the reverted implementation. No data migration or operational rollout is required.
