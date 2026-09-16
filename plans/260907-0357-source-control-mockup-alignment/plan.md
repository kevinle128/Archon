---
title: 'Source Control Mockup Alignment'
description: 'Align the legacy Source Control run tab with the restored 2026-09-05 UX mockup while preserving later functional capabilities.'
status: in-progress
priority: P1
effort: 2d
issue:
branch: dev
tags: [bugfix, frontend, ux, source-control]
blockedBy: []
blocks: []
created: 2026-09-07
---

# Source Control Mockup Alignment

## Overview

Align the legacy Source Control tab with the restored `ux-Archon-source-control-2026-09-05` mockup and design documents.
Keep all later accepted Source Control capabilities that are not present in the older mockup.

## Outcome

- The Source Control tab matches the restored master-detail layout, density, typography, colors, responsive behavior, and UI states.
- Later commit, virtualization, large-file, binary, Close, Escape, and frozen Reload behaviors remain intact.

## Constraints

- The mockup, `DESIGN.md`, and `EXPERIENCE.md` are the visual authority.
- Later epics, PRDs, and current tests are the functional authority.
- The implementation must reuse current components, tokens, and dependencies.
- The implementation must match mockup geometry and density while mapping colors through existing semantic tokens.
- Diff line tints must target 14 percent and may change only when a contrast check requires it.
- The implementation must keep strict TypeScript and accessibility behavior.

## Non-Goals

- Do not change the Console run view.
- Do not change server, API, database, git, or workflow-engine contracts.
- Do not add stage, commit, discard, or other write actions.
- Do not add a screenshot framework or a new dependency.
- Do not fix defects outside the Source Control tab in this plan.
- Record any adjacent defect as a separate follow-up finding.

## Cross-Plan Dependencies

The pending Node Cost Model Breakdown plan changes the Console run view and does not block this legacy Source Control work.

The [Workflow Run HITL Mockup Alignment plan](../260907-1454-workflow-run-hitl-mockup-alignment/plan.md) changes the surrounding run screen and preserves this Source Control tab.
There is no blocking dependency between the plans.
Its final checks must include switching into Source Control after a node panel was open, with no leaked panel width or styles.
This link does not close the remaining validation gate in this plan.

## Phases

| #   | Phase                                                                                        | Status    | Effort |
| --- | -------------------------------------------------------------------------------------------- | --------- | ------ |
| 1   | [Establish Visual Baseline and Contract](./phase-01-establish-visual-baseline.md)            | Completed | 3h     |
| 2   | [Align Source Control Visual System](./phase-02-align-source-control-visual-system.md)       | Completed | 1d     |
| 3   | [Verify States and Responsive Behavior](./phase-03-verify-states-and-responsive-behavior.md) | Completed | 5h     |

## Success Criteria

- [x] The desktop layout uses a resizable 30/70 split with a 20–70 percent left range.
- [x] Widths below 900 pixels stack lists above the viewer and stack diff panes vertically.
- [x] Changes stay compact while History fills the remaining left-panel height.
- [x] Rows, headers, badges, viewer chrome, diff colors, loading states, empty states, errors, and stale states match the restored design.
- [x] All protected later Source Control behaviors still pass their tests.
- [ ] Focus, keyboard, overflow, contrast, type-check, build, and repository validation checks pass.

## Validation

- Run focused Source Control component tests first.
- Run the mounted Source Control integration test next.
- Run the Web type-check and build.
- Inspect the state and viewport matrix in the live Vite UI at port `5173`.
- Run `bun run validate` before delivery.

## Open Questions

None.

## Validation Log

### Session 1 — 2026-09-07

**Trigger:** The user requested `/ak:plan validate` for the active plan.
**Questions asked:** 3.

#### Initial Verification Results

- **Tier:** Standard.
- **Claims checked:** 30.
- **Verified:** 25.
- **Failed:** 5.
- **Unverified:** 0.

##### Initial Failures

1. The Source Control tab path is wrong in Phase 1 and Phase 2.
   The verified owner is `packages/web/src/components/workflows/source-control/source-control-tab.tsx:255`.
2. `packages/web/src/components/workflows/source-control/changed-file-row.test.tsx` does not exist.
   Existing row coverage is in `packages/web/src/components/workflows/source-control/source-control-panel.test.tsx:29`.
3. `packages/web/src/components/workflows/source-control/virtualized-diff.test.tsx` does not exist.
   Existing diff coverage is in `packages/web/src/components/workflows/source-control/file-viewer.test.tsx:166`.
4. `packages/web/src/components/workflows/source-control/source-control-layout.test.tsx` does not exist.
   Existing breakpoint coverage is in `packages/web/src/components/workflows/source-control/use-stacked-viewport.test.ts:5`, and pane layout coverage is in `packages/web/src/components/workflows/source-control/file-viewer.test.tsx:209`.

All initial failures were accepted for correction in this validation session.

#### Questions and Answers

1. **[Architecture]** Plan nên xử lý các đường dẫn test không tồn tại theo cách nào?
   - Options: Tái dùng test hiện có (Recommended) | Tạo test chuyên biệt | Giữ nguyên plan.
   - **Answer:** Tái dùng test hiện có (Recommended).
   - **Rationale:** Existing owner tests cover the same contracts without new test-file boundaries.
2. **[Tradeoff]** Khi CSS mockup khác hệ thống token hiện tại, mức ưu tiên nào được áp dụng?
   - Options: Khớp hình bằng token (Recommended) | Sao chép CSS mockup | Ưu tiên UI hiện tại.
   - **Answer:** Khớp hình bằng token (Recommended).
   - **Rationale:** This keeps theme compatibility while preserving the required geometry and density.
3. **[Scope]** Nếu kiểm tra trình duyệt thấy lỗi giao diện ngoài tab Source Control, plan nên làm gì?
   - Options: Ghi nhận riêng (Recommended) | Sửa legacy screen | Mở rộng Console.
   - **Answer:** Ghi nhận riêng (Recommended).
   - **Rationale:** This keeps the implementation focused and makes rollback simple.

#### Confirmed Decisions

- Reuse existing owner tests and correct all invalid paths.
- Match the mockup with current semantic tokens instead of literal copied colors.
- Keep implementation changes inside the legacy Source Control tab.

#### Action Items

- [x] Correct the Source Control tab path in Phase 1 and Phase 2.
- [x] Replace nonexistent test paths with existing owner tests in Phase 3.
- [x] Add the semantic-token fidelity rule to the plan and Phase 2.
- [x] Add the adjacent-defect scope rule to the plan and validation phase.

#### Impact on Phases

- Phase 1 now reads the correct Source Control tab owner and records adjacent defects separately.
- Phase 2 now uses semantic tokens as the color implementation boundary.
- Phase 3 now updates the existing panel, viewer, viewport, graph, and integration tests.

#### Final Verification Results

- **Tier:** Standard.
- **Claims rechecked:** 30.
- **Verified:** 30.
- **Failed:** 0.
- **Unverified:** 0.
- The corrected source and test paths exist in the current codebase.
- The current component consumers support the planned frontend-only change boundary.

#### Whole-Plan Consistency Sweep

- **Files reread:** `plan.md` and all three phase files.
- **Decision deltas checked:** 3.
- **Reconciled stale references:** 5.
- **Historical failure references retained as resolved evidence:** 4 unique paths.
- **Unresolved contradictions:** 0.

<!-- slug: source-control-mockup-alignment -->
