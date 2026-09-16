---
description: Run BMAD implementation readiness in Archon automation mode without HITL pauses
argument-hint: (optional readiness scope or extra context)
---

# BMAD Check Implementation Readiness

This command is an Archon wrapper around the installed BMAD `bmad-check-implementation-readiness` workflow.
It preserves the BMAD assessment logic and removes only the interactive human-in-the-loop gates that would block an automated Archon DAG.

User request:
$ARGUMENTS

## Required Reads

Read these files before acting:

- `AGENTS.md` and `CLAUDE.md` if present.
- `_bmad/bmm/config.yaml`.
- `_bmad-output/project-context.md` if present.
- `.agents/skills/bmad-check-implementation-readiness/SKILL.md`.
- `.agents/skills/bmad-check-implementation-readiness/steps/step-01-document-discovery.md`.
- `.agents/skills/bmad-check-implementation-readiness/steps/step-02-prd-analysis.md`.
- `.agents/skills/bmad-check-implementation-readiness/steps/step-03-epic-coverage-validation.md`.
- `.agents/skills/bmad-check-implementation-readiness/steps/step-04-ux-alignment.md`.
- `.agents/skills/bmad-check-implementation-readiness/steps/step-05-epic-quality-review.md`.
- `.agents/skills/bmad-check-implementation-readiness/steps/step-06-final-assessment.md`.
- `.agents/skills/bmad-check-implementation-readiness/templates/readiness-report-template.md`.
- `$ARTIFACTS_DIR/bmad-readiness-correct-course-loop/state.json` if present.

## Non-Interactive Contract

Run the complete BMAD implementation readiness workflow in automation mode.
Treat the workflow invocation as authorization to complete every readiness step without asking for confirmation.
Do not present or wait at menus, including the Step 1 [C] checkpoint.
Do not ask the user to choose between duplicate document formats.
When both whole and sharded versions of an artifact exist, use the whole document, record the duplicate as a finding in the readiness report, and continue.
When a required artifact is missing or facts are insufficient, record the problem in the readiness report and return `NOT_READY` or `BLOCKED`.
Do not ask the user a question and do not invent content.
Initialize the report from the BMAD readiness report template.
Write and finalize the implementation readiness report inside the same dedicated planning package as the selected target epics.
Never write a target-owned readiness report directly under the configured `planning_artifacts` root.
Stop after the readiness result.
Do not invoke `bmad-help` or start another interactive workflow.

## Assessment Rules

Return `READY` only when the assessment finds no issue requiring correction before implementation.
Return `NEEDS_WORK` when issues are actionable from existing planning artifacts and can be corrected by the BMAD correct-course wrapper.
Return `NOT_READY` when required planning artifacts are missing, inconsistent, or too incomplete for implementation.
Return `BLOCKED` only when the assessment cannot be completed from repository facts without inventing product decisions.
Count critical, major, minor, and warning findings explicitly.
Treat duplicate whole and sharded documents as at least a warning.
Treat missing PRD or missing epics as `NOT_READY`.
Treat missing architecture or UX as issue severity based on project evidence rather than automatically blocking.

## Final Response

Final response must be exactly one JSON object with this shape:

```json
{
  "result": "positive",
  "readiness_status": "READY",
  "report_file": "_bmad-output/planning-artifacts/<target-package>/implementation-readiness-report-YYYY-MM-DD.md",
  "issues_count": 0,
  "critical_count": 0,
  "major_count": 0,
  "minor_count": 0,
  "warnings_count": 0,
  "findings_summary": "No readiness issues requiring correction.",
  "recommended_action": "Proceed to implementation."
}
```

Use `result: "positive"` only when `readiness_status` is `READY` and `issues_count` is `0`.
Use `result: "negative"` for `NEEDS_WORK`, `NOT_READY`, `BLOCKED`, or any nonzero issue count.
