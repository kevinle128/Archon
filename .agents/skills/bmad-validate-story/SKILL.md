---
name: bmad-validate-story
description: Validates and repairs an existing BMAD story. Use when the user says "validate story" or "revalidate story" before planning or development.
---

# Validate Story

## Overview

Act as an independent reviewer of one existing story file.
Deliver a story that is safe to use for planning and development, or specific questions that block it.

## On Activation

Require its path and accept the earlier findings and user answers when provided.
Do not create a story, select another story, or call a nonexistent `bmad-create-story` mode.

Read the full story, its sprint entry, the project configuration, `{project-root}/.agents/skills/bmad-create-story/checklist.md`, and `{project-root}/brain/StoryProofGuardrails.md` when present.
Check every acceptance criterion against the approved Epic, PRD, architecture, UX, mockup, current code, and relevant tests.
Treat every visible mockup feature as current scope unless the user explicitly decides otherwise.
Check source links, required behavior, affected boundaries, regressions, and positive, negative, and transition cases.
An existing `ready-for-dev` label is not proof that this independent review passed.

## When the story is not ready

List each blocking problem with its story location, source evidence, and proposed correction.
Show the full list to the user and ask for the missing decisions or approval of the proposed corrections.
Do not ask the user to supply facts that the approved sources or code already establish.
Do not guess unclear behavior, mark the review as passed, or start a plan.
Keep the story and sprint status unchanged while waiting for an answer.

After the user answers, repair only the affected story content and repeat the full review.
If an answer changes an approved source, stop and identify the owning BMAD document or workflow that must be updated first.
Continue this review-and-repair cycle until no blocker remains.

For a non-interactive workflow call, do not wait for a reply inside the command node.
Return the findings and questions so the workflow can ask the user, pass them back with the answer and the same story path, and run validation again.
The workflow must branch on this verdict, not on the story's current status label.
Return only one JSON object with `result: "negative"`, the unchanged `story_path`, non-empty `findings`, and non-empty `questions`.
Each finding must include `id`, `location`, `problem`, `evidence`, and `proposed_change`.
Each question must include its matching `finding_id` and `question`.
Missing files, unreadable sources, and invalid story identity are errors, not a negative quality verdict.

## When the story is ready

Set the story status and its matching sprint entry to `ready-for-dev` only after a clean review.
Accept only `draft` or `ready-for-dev` as the prior story status and `backlog` or `ready-for-dev` as the prior sprint status.
Stop without changing an unexpected status.
Preserve all other sprint entries and comments.
Verify both saved statuses, source links, and `git diff --check`.
For an interactive call, report what was checked and any tests that were not run.
For a workflow call, return only one JSON object with `result: "positive"`, the unchanged `story_path`, and empty `findings` and `questions` arrays.
