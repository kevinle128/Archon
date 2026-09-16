---
description: Run BMAD correct-course in Archon automation mode without HITL pauses
argument-hint: (optional change trigger; workflow nodes usually provide readiness context)
---

# BMAD Correct Course

This command is an Archon wrapper around the installed BMAD `bmad-correct-course` workflow.
It preserves the BMAD impact analysis and change proposal discipline while removing interactive human-in-the-loop gates for automated readiness repair loops.

User request:
$ARGUMENTS

## Required Reads

Read these files before acting:

- `AGENTS.md` and `CLAUDE.md` if present.
- `_bmad/bmm/config.yaml`.
- `_bmad-output/project-context.md` if present.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` if present.
- `.agents/skills/bmad-correct-course/SKILL.md`.
- `.agents/skills/bmad-correct-course/checklist.md`.
- `$ARTIFACTS_DIR/bmad-readiness-correct-course-loop/state.json` if present.

Also load the planning artifacts discovered from `_bmad/bmm/config.yaml`.
At minimum, load PRD and epics when available.
Load architecture, UX, specs, and project knowledge when they exist and are relevant to the readiness findings.

## Non-Interactive Contract

Run the complete BMAD correct-course workflow in automated batch mode.
Treat the latest implementation readiness result as the change trigger when this command is run from `bmad-readiness-correct-course-loop`.
Treat this workflow invocation as the user's batch-mode selection and explicit approval of in-scope planning-artifact corrections.
Do not ask for the change trigger, mode selection, proposal review, Continue/Edit, yes/no approval, or any other user confirmation.
Do not stop after merely drafting a Sprint Change Proposal when the correction is supported by existing project facts.
Apply approved in-scope corrections directly to affected BMAD planning artifacts.
Prefer direct updates to epics, stories, PRD, architecture, UX, or sprint status over broad replanning.
Address only issues identified by the readiness result or by direct consequences of those issues.
Do not introduce unrelated scope changes.

## Safety Rules

Do not invent product decisions, acceptance criteria, architecture decisions, UX requirements, or stakeholder intent.
If a correction is impossible without missing project facts, leave unsupported sections unchanged and return `BLOCKED`.
If the readiness result is already clean, return `NO_CHANGES`.
If a proposed correction would require major replanning rather than direct artifact repair, write the Sprint Change Proposal and return `BLOCKED` with the escalation reason.
Never modify generated files or changelogs.
When editing long Markdown planning artifacts, put each full sentence on its own physical line.
Summarize every artifact changed and why it was changed.

## Sprint Change Proposal

Write a Sprint Change Proposal when changes are applied or when escalation is needed.
Write the proposal inside the selected target's dedicated planning package.
Never write a target-owned proposal directly under the configured `planning_artifacts` root.
The proposal must include issue summary, impact analysis, recommended approach, detailed change proposals, implementation handoff, and final status.
When changes are applied directly, the proposal records what was changed and why rather than asking for approval.

## Final Response

Final response must be exactly one JSON object with this shape:

```json
{
  "status": "APPLIED",
  "proposal_file": "_bmad-output/planning-artifacts/<target-package>/sprint-change-proposal-YYYY-MM-DD.md",
  "changed_artifacts": ["_bmad-output/planning-artifacts/<target-package>/epics.md"],
  "blocked_reasons": [],
  "summary": "Updated epic coverage for missing readiness findings.",
  "validation": "Re-run bmad-check-implementation-readiness."
}
```

Use `status: "APPLIED"` when planning artifacts were changed.
Use `status: "NO_CHANGES"` when the readiness result required no correction.
Use `status: "BLOCKED"` when missing facts or required escalation prevents a direct correction.
Use `status: "FAILED"` only for execution errors unrelated to project facts.
