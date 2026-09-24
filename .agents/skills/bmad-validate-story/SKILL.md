---
name: validate-story
description: Independently validate one existing BMAD draft story against approved requirements, current code, and tests before development.
---

# Validate Story

Require exactly one existing story-file path. Run in a fresh context, separate from the agent that created or repaired the story. Do not select a backlog story or create a new one.

1. Read the complete story, its matching sprint status, the resolved project configuration, and the project's story proof rules. Read `../bmad-create-story/checklist.md` as review guidance. Do not execute the create-story workflow or its legacy `_bmad` workflow.
2. Independently check every acceptance criterion against the approved Epic, PRD, specification, architecture, UX, mockup manifest when one exists, and the current code and tests. Resolve conflicts by the project's recorded decisions; do not invent behavior or defer an approved visible mockup feature. Verify the proposed changes preserve existing behavior and cover both positive and negative cases, transitions, boundaries, and affected test surfaces. Check cited paths and validation commands.
3. If any required behavior, implementation guard, or proof is missing or conflicts with an approved source, report specific findings with source evidence. Leave the story and sprint status unchanged. Send the findings to Create Story Repair Mode, then require another fresh validation.
4. If no blocker remains, change only the story status and validation completion note to `ready-for-dev`. Change only its matching sprint entry from `backlog` to `ready-for-dev` and update the sprint timestamp while preserving all other entries and comments. If the current status is unexpected, stop without changing it. Do not rewrite substantive story content in Validate Mode.
5. Verify the saved story and sprint entry both say `ready-for-dev`, source links still resolve, and `git diff --check` passes. Report the verdict and any remaining limitations. Do not claim that implementation tests passed unless they actually ran.
