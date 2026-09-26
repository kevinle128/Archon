# Prompt Audit: Archon Prompt Surface for Claude Opus 5

Date: 2026-09-26. Branch: `develop` @ `3d4c876d`. Method: `/claude-api prompt-audit` (dated-pattern tables, keep list, report and proposed diff). The audit is read-only, so no repo file was changed.

## Outcome

The audit found 22 high and 76 medium findings across seven slices, plus about 70 low-confidence flags. Archon's own runtime code is in good shape. The Claude request config is clean: no prefill, no sampling parameters, no forced tool use and no `budget_tokens`. Most of the dated text is in three places:

1. **Pressure language.** Stacked `CRITICAL`, `MUST`, `NEVER` and `DO NOT BE LAZY` markers on rules that have real reasons. Opus 5 follows instructions closely, so shouted rules over-apply.
2. **Verification and delegation scaffolding.** Per-edit type-check hooks, self-check passes, "always launch" agents, and "UTILIZE SUBAGENTS" boosters. The Opus 5 migration guide says it already verifies on its own and delegates more readily, so this text now adds cost and latency.
3. **Stale facts.** Node-type lists without `include:` and `workflow:`, file paths that moved, dropped tables, a non-existent skill name, a broken knowledge-file name, and a retired model name in a commit template.

**Two findings are real bugs, not prompt style. Fix them first:**

- `.archon/workflows/defaults/archon-adversarial-dev.yaml:287`: the evaluator runs `pkill -f "node|bun|python|npm|next|vite|webpack"`. That matches any `bun` process, including the Archon server or CLI that is running the workflow. The first copy at `:232` uses `\|`, which `pkill` reads as a literal pipe, so it kills nothing. Verified by reading both lines. The fix is hunk W-F12.
- `packages/core/src/orchestrator/manage-run-tool.ts:136-137,345`: the preview text says "Confirm with the user" for approve and reject. The system prompt at `prompt-builder.ts:191` says an unambiguous user decision already is that confirmation. The agent can make users repeat a decision they already gave. Verified. The fix is hunk R-F1.

**Deliverables:**

- This report.
- `plans/reports/prompt-audit-260926-1537-verified-hunks.patch`: 20 hunks for the runtime and workflow slices (R-F1..F6 and W-F1..F14). Checked with `git apply --check` against the current tree, both one at a time and as one patch.
- Appendix B: the other hunks, as proposed text. Some are representative hunks for clustered findings, so they are not `git apply`-ready.

## Step 0 assumptions

| Item                     | Value                                                                                                                                         | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target model             | **Claude Opus 5**; Opus 5.5 differences are noted where they change the action                                                                | `~/.archon/config.yaml` sets `assistants.claude.model: opus`, and the `large` tier resolves to `claude/opus` (`packages/core/src/config/config-loader.ts:215`). The newest pinned ID in the repo is `claude-opus-4-8`. **If the bare `opus` alias already resolves to Claude Opus 5.5 in your SDK version, four flagged items become live findings now:** C-L1 update suppressors, B-L1 "show your analysis" (`reasoning_extraction` refusals), R-L3 `thinking: disabled`/`budgetTokens` (400s), and W-L4 effort (the Opus 5.5 default is `medium`). |
| Scope                    | All Archon-owned prompt text, plus the vendored BMAD kits (added at your request)                                                             | `packages/*/src` runtime prompts, `.archon/commands/defaults` (68 files), `.archon/workflows/defaults` (32 files), `AGENTS.md`, `.claude/{agents,commands,skills}`, project skills in `.agents/skills`, `.agents/skills/bmad-*` (107 dirs), and `_bmad/` (384 unique files)                                                                                                                                                                                                                                                                          |
| Excluded                 | `speckit-*`, `wds-*` skill dirs, obra/superpowers skills, `agent-browser`, `playwright-cli`, `remotion-best-practices`, `chrome-devtools-axi` | These are vendored, and you did not ask for them. `_bmad/wds/` was in scope because it is part of `_bmad/`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Non-Anthropic providers  | Present. The same prompts also go to Codex (`gpt-5.5`, currently `defaultAssistant`), Pi (MiniMax) and omp/grok.                              | Findings note where a change matters for them. The audit never proposes switching a provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `.claude/skills` mirrors | 77 of 79 BMAD dirs are byte-identical to `.agents/skills`. Every BMAD hunk applies to both copies.                                            | `diff -rq`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Summary by slice

| Slice                                 | High | Medium | Low          | Hunks               | Top issue                                                                                                                                                  |
| ------------------------------------- | ---- | ------ | ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime TS prompts (`packages/*/src`) | 0    | 6      | 6            | R-F1..F6, verified  | The `manage_run` confirmation contradicts the system prompt; AskHuman is under-described                                                                   |
| Default commands (68)                 | 0    | 9      | 8            | C-M1..M9, text      | A forced `Task`/`Explore` subagent is marked CRITICAL (that tool doesn't exist on Codex or Pi); an `implement-issue` mission list contradicts its own body |
| Default workflows (32)                | 4    | 10     | 10           | W-F1..F14, verified | Per-edit verification hooks; the `pkill` bug                                                                                                               |
| Project skills, agents, AGENTS.md     | 7    | 15     | 6            | S-F1..F22, text     | Node-type lists are missing `include`/`workflow`; stale paths, tables and branch names                                                                     |
| BMAD testarch/QA/TEA                  | 1    | 6      | 5            | T-F1..F7, text      | A broken `test-priorities.md` reference; `auto` mode fans out subagents                                                                                    |
| BMAD personas/CIS/review              | 4    | 9      | 12           | G-H1..M8, text      | A "3-10 issues minimum" quota plus insults in the automator review; a wrong skill name                                                                     |
| BMAD planning/dev                     | 1    | 15     | 8            | P-F1..F15, text     | story-automator runs a deterministic loop through the model; readiness steps contradict themselves                                                         |
| `_bmad/`                              | 5    | 6      | 2 (+7 flags) | B-1..16, text       | Laziness and subagent boosters; a retired model in a commit template                                                                                       |

## Verified by me (not only by subagents)

I checked these claims myself against the tree:

- The `pkill` pattern (W-F12).
- The `manage_run` versus `prompt-builder` contradiction (R-F1). `GATE_ACTIONS` exists at `manage-run-tool.ts:59`.
- The schema has `route_loop`, `plannotator_gate`, `include` and `workflow` node keys (`dag-node.ts:446,552,627,710`), and the skills omit the last two (S-F1, S-F2).
- `.claude/rules/` does not exist (S-F8).
- The only integration branch on the remote is `origin/develop`; there is no `origin/dev` and no `origin/main`. The `release` skill says `dev` 72 times (S-F9).
- `grok` is registered in `registry.ts:157`, but AGENTS.md's provider lists leave it out (S-F3).
- `bmad-builder-setup` does not exist; the setup skill is `bmad-bmb-setup` (G-M6).
- Only `test-priorities-matrix.md` exists in the knowledge folder, yet the checklists name `test-priorities.md` (T-F1).
- `_bmad/tea/config.yaml:11` sets `tea_execution_mode: auto` (T-F4).
- `_bmad/wds/skills/shared/git.md:16` pins `Claude Sonnet 4.6` (B-5).
- "UTILIZE SUBPROCESSES AND SUBAGENTS" appears in 12 `_bmad` files (B-2). The subagent reported 11.
- The readiness step-02 header says "NEVER generate content without user input", and the same step auto-proceeds at `:142` (P-F3).
- The readiness and UX mirrors differ between `.agents` and `.claude`. `claude-design-feature-extractor` is absent from `.claude/skills` (P, section 1c).

## Decisions only you can make (no hunk applied)

These touch choices you made, so per your review rules they are listed here rather than changed:

1. **S-F17: the code-reviewer "80+ confidence only" filter** (`.claude/agents/code-reviewer.md:3,7-20,87-97,147`; `validation/code-review.md:81`). The audit's concern is that current models apply the bar literally and suppress bugs they found. The documented Opus 4.7+ and Sonnet 5 guidance is to report everything with confidence and severity, then filter downstream. Options: **keep**; **change** (hunk S-F17); or **hybrid** (report everything, and have the caller filter at 80+).
2. **S-F18: the "Always launch" agents in the `archon-dev` plan and review cookbooks.** These encode your global rule "Use subagents liberally". The audit's concern is that Opus 5 already over-delegates, so small changes cost more for no gain. Options: **keep**; **change** (size-based conditions, hunk S-F18); or **hybrid** (always launch for large or cross-package changes, read directly otherwise).
3. **W-L1..L3: the speckit workflows.** They pin `claude-opus-4-8[1M]` five times, and carry "spawn sub-agents for help" and "trigger advisor review". You wrote these on 2026-09-18. Moving to `opus` (Opus 5) means removing the delegation line too, because it is right for 4.8 (which under-delegates) and wrong for 5.
4. **P-F14b: story-automator contradicts itself on PREFERENCE escalations.** `escalation-triggers.md` and `orchestrator-rules.md` say "escalate, don't decide". `stop-hook-recovery.md` says "Never wait for user". Options: **keep** auto-decide and document it; **change** so PREFERENCE escalations remove the marker while waiting; or **hybrid**, auto-deciding after a timeout and logging the choice.
5. **S-F9 / S-L2: does this fork cut releases?** If it does, rename `dev` to `develop` in the `release` skill and fix the `coleam00` tap paths. If it doesn't, the skill is dead weight.

## Upstream versus local

All BMAD findings (the testarch, g2, g3 and `_bmad` slices) are in vendored BMAD-METHOD and bmalph output. A reinstall overwrites every hunk except B-15 and B-16, which live in `_bmad/custom/*.toml`, the only layer that survives an upgrade. Recommendation: send the High and Medium BMAD findings upstream. Locally, apply only what you need now:

- B-15 and B-16, which add the delegation cap and the "finish the whole story" rule in the upgrade-safe layer.
- Set `tea_execution_mode: sequential` in `_bmad/tea/config.yaml:11`. This one config line neutralizes T-F4 without any skill edit.
- The factual fixes: T-F1, G-M6, B-5.

**Mirror drift to resolve regardless of the audit.** `.claude/skills/bmad-check-implementation-readiness` and `.claude/skills/bmad-ux` are the older stock copies. The `.agents` copies carry your 2026-09-25 local edits (automatic doc-set selection, the mockup-manifest gate). Claude Code loads `.claude/skills`, so it runs the old behavior, and it cannot reach the mockup gate because `claude-design-feature-extractor` and `bmad-validate-story` exist only in `.agents/skills`.

---

## Appendix A: Findings detail

The confidence rubric: **High** means documented in current Claude docs, or factually wrong against the code. **Medium** means consistent, widely observed behavior on current models. **Low** means flagged only, with no edit. Actions are `remove`, `rewrite`, `move`, `add` or `flag`.

### A1. Runtime TypeScript prompts (hunks in the verified patch)

| ID   | Location                                                            | Pattern                                                          | Why obsolete                                                                                                                                                                                     | Conf. | Action                                                                     |
| ---- | ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------- |
| R-F1 | `manage-run-tool.ts:136-137,343-346` vs `prompt-builder.ts:191-194` | Duplicates that disagree (keep-list #8 exception); tool contract | The tool result arrives later and is followed literally, so the agent asks the user to re-confirm a decision already given                                                                       | Med   | rewrite (approve/reject use the user's decision; cancel/abandon still ask) |
| R-F2 | `manage-run-tool.ts:152,154`                                        | Group 3: the description does not match behavior                 | The help promises "continues on its own", but `:431` returns "stays paused… resumed separately", and container runs go through the CLI                                                           | Med   | rewrite                                                                    |
| R-F3 | `packages/workflows/src/ask-human.ts:36-40,55-56`                   | Group 3: under-described                                         | 5 fields have no descriptions. "Wait after calling" is wrong: the call pauses the run and ends the turn                                                                                          | Med   | add                                                                        |
| R-F4 | `orchestrator-agent.ts:1611`                                        | Tool names in prose; fossil                                      | "Read, View": no `View` tool exists, and Codex and Pi use different tool names                                                                                                                   | Med   | rewrite ("Read them from these paths")                                     |
| R-F5 | `prompt-builder.ts:267`                                             | 1a pressure plus 1c repetition                                   | `IMPORTANT: Always clone…` repeats step 1                                                                                                                                                        | Med   | rewrite (merge into step 1)                                                |
| R-F6 | `providers/src/community/pi/provider.ts:280-284`                    | Group 3: prose tool list that shadows the real one               | Wrong when `allowed_tools` restricts the node, and it omits AskHuman and skills. **Before merging, re-run the #1831/#2243 OAuth wire check** (the Anthropic classifier accepts the current text) | Med   | rewrite                                                                    |

Low (flag only):

- **R-L1:** `router.ts:73-138` `buildRouterPrompt` is dead code with CRITICAL/MUST wording.
- **R-L2:** `structured-output.ts:43` starts with "CRITICAL:". It is only used by non-native harnesses, and 4 tests assert on the prefix.
- **R-L3:** `dag-node.ts:78-91` accepts `thinking: disabled` and `budgetTokens`. These are 400s on Opus 5.5, and `disabled`+`xhigh`/`max` is a 400 on Opus 5. Consider a load-time warning.
- **R-L4, R-L5, R-L6:** design notes on `manage_run` help round trips, the dual `/invoke-workflow` and `manage_run.start` paths, and verbosity (measure it before adding Opus 5 conciseness text).

### A2. Default commands (`.archon/commands/defaults/`)

| ID   | Location                                                                                         | Pattern                                                                                                                                                                                                                   | Conf. | Action                        |
| ---- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------- |
| C-M1 | `archon-implement-issue.md:2,22-23`                                                              | 1d: an unenforced instruction that contradicts the body (`:479` "Skip archiving"). It invites an extra self-review comment                                                                                                | Med   | rewrite                       |
| C-M2 | `archon-create-plan.md:21,187`; `archon-investigate-issue.md:168`; `archon-ralph-generate.md:85` | 1a plus tool names in prose. `CRITICAL: Use Task tool with subagent_type="Explore" thoroughness="very thorough"`. Opus 5 over-delegates, `thoroughness` isn't a Task parameter, and the tool doesn't exist on Codex or Pi | Med   | rewrite (optional delegation) |
| C-M3 | 8 sites: the 5 review agents, `pr-review-scope:403`, `plan-setup:71,212`                         | 1a: shouted "NOT Building" banner. The constraint is real, so keep it at normal volume with its reason                                                                                                                    | Med   | rewrite                       |
| C-M4 | `archon-validate-pr-e2e-{feature,main}.md:10,~181-186`                                           | 1a: `YOU MUST LOAD THE AGENT-BROWSER SKILL NOW`. The reason (`--session` isolation) is a few lines below. Keep the incident-derived kill and cleanup rules                                                                | Med   | rewrite                       |
| C-M5 | `archon-assist.md:16-30`                                                                         | 1c generic virtues plus a prose capability list. It is the router fallback, and the list is wrong on Codex and Pi                                                                                                         | Med   | rewrite                       |
| C-M6 | `archon-create-plan.md:125,141-146`                                                              | 1a plus a list the model already knows                                                                                                                                                                                    | Med   | rewrite                       |
| C-M7 | `archon-implement.md:226`                                                                        | 1a: doubled emphasis                                                                                                                                                                                                      | Med   | rewrite                       |
| C-M8 | `archon-workflow-summary.md:28`                                                                  | 1a: "Read EVERY artifact… Miss nothing"                                                                                                                                                                                   | Med   | rewrite                       |
| C-M9 | `archon-web-research.md:250-256`                                                                 | 1c: a "What NOT To Do" list that restates the quality table                                                                                                                                                               | Med   | remove                        |

Low (flag only):

- **C-L1:** "Do NOT narrate" blocks. **Keep for Opus 5.** `dag-executor.ts:2569` appends all assistant text to `$node.output`. Re-test if the target moves to Opus 5.5.
- **C-L2:** `PHASE_N_CHECKPOINT` lists in 28 files.
- **C-L3:** numeric floors ("at least 3").
- **C-L4:** JSON output shapes stated in prose instead of `output_format`.
- **C-L5:** `bun run type-check` hard-coded in generic commands.
- **C-L6:** "Lean aggressively towards fixing".
- **C-L7:** the Ralph iteration prompt never names the `terminal` field.
- **C-L8:** two single emphasis markers.

Kept on purpose: severity labels (CRITICAL/HIGH/… as data), the Ralph NEVER limits with their reasons, git and PR contracts, harness needle and verdict formats, and scope rules that counter Opus 5's scope expansion.

### A3. Default workflows (`.archon/workflows/defaults/`, hunks in the verified patch)

| ID    | Location                                                  | Pattern                                                                                                                                                                                           | Conf.           | Action                                                                         |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| W-F1  | `archon-architect.yaml:191-197` (+ `:170,:176`)           | A PostToolUse hook re-injects "type-check NOW / is it ACTUALLY simpler" after every edit. Opus 5 over-verification plus re-insertion                                                              | High            | rewrite (keep a one-line "why simpler" hook; the workflow is a hooks showcase) |
| W-F2  | `archon-architect.yaml:278-284`                           | The hook duplicates the prompt's own step 4                                                                                                                                                       | High            | remove                                                                         |
| W-F3  | `archon-refactor-safely.yaml:267-275` (+ `:7,15,222,236`) | Per-edit type-check hook; the prompt already checks once per task and a validate node follows. **The description calls it a "key safety feature", so decline if per-edit checking is deliberate** | High            | rewrite                                                                        |
| W-F4  | `archon-refactor-safely.yaml:361-367`                     | The same duplicate hook as W-F2                                                                                                                                                                   | High            | remove                                                                         |
| W-F5  | `archon-ralph-dag.yaml:345-356`                           | Per-file type-check that repeats the Phase 3 gate. The patch carries it rebuilt to apply after W-F7                                                                                               | Med             | remove                                                                         |
| W-F6  | `archon-piv-loop.yaml:482,652`                            | Per-file type-check. At `:482` the command ends in `\|\| true`, so its result is discarded                                                                                                        | Med             | remove                                                                         |
| W-F7  | `archon-ralph-dag.yaml:258,305,358,417,469,535`           | Six self-check lists that nothing reads (the loop exits on `until_field`)                                                                                                                         | Med             | remove                                                                         |
| W-F8  | `archon-piv-loop.yaml:156-164,334-336,645-646`            | 1a: "CRITICAL — READ THIS CAREFULLY… NEVER output…". The `<promise>` tokens stay byte-identical because `until:` matches on them                                                                  | Med             | rewrite                                                                        |
| W-F9  | `archon-interactive-prd.yaml:127`                         | 1a                                                                                                                                                                                                | Med             | rewrite                                                                        |
| W-F10 | `archon-adversarial-dev.yaml:58-59`                       | An emphasized duplicate of `:31`                                                                                                                                                                  | Med             | remove                                                                         |
| W-F11 | `archon-adversarial-dev.yaml:206`                         | Re-verify, where the evaluator role already verifies                                                                                                                                              | Med             | rewrite                                                                        |
| W-F12 | `archon-adversarial-dev.yaml:228-233,285-288`             | 1a, plus the **`pkill` bug**                                                                                                                                                                      | Med (bug: High) | rewrite (record `$!`, kill that PID)                                           |
| W-F13 | `archon-superpower-feature-verify-loop.yml:75`            | "Return only JSON" on a Claude node with SDK-enforced `output_format`. Keep it on the Codex, omp and Pi nodes                                                                                     | Med             | remove                                                                         |
| W-F14 | `archon-architect.yaml:95`                                | Tells the model to write a file with the Write tool while the node denies Write                                                                                                                   | Med             | rewrite                                                                        |

Low (flag only):

- **W-L1..L3:** speckit pins and delegation. See decision 3.
- **W-L4:** `effort: xhigh` on an Opus `write-plan`. Opus 5 guidance is to start at `high`.
- **W-L5:** `effort: hight` typo at speckit-ralph-native `:853` and no-hitl `:661`. It passes schema validation because the field is `z.string()`, and is sent to omp. **Worth fixing.**
- **W-L6:** the architect Read-rubric hook.
- **W-L7:** ralph-dag-project-aware has the same checks as W-F5/F7, on omp/grok.
- **W-L8:** the "You are not helpful" evaluator persona.
- **W-L9:** hand-edited state counters in the model's prompt.
- **W-L10:** piv-loop idioms such as "DO YOUR HOMEWORK".
- **Docs follow-on:** `packages/docs-web/.../book/hooks-and-quality.md:132` and `guides/authoring-commands.md:171-518` teach the per-edit hook and checkpoint patterns.

### A4. Project skills, agents, AGENTS.md

| ID    | Location                                                                                            | Pattern                                                                                                                                | Conf. | Action                           |
| ----- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------- |
| S-F1  | `.claude/skills/archon/SKILL.md:200`, `references/workflow-dag.md:111`                              | G2 volatile: "exactly ONE of" lists 8 keys, while the schema has 12 (it lacks `route_loop`, `plannotator_gate`, `include`, `workflow`) | High  | rewrite                          |
| S-F2  | `.agents/skills/archon-workflow-creator/references/node-types.md:25-35`                             | Same; it lacks `loop_group`, `include`, `workflow`, and disagrees with S-F1                                                            | High  | rewrite                          |
| S-F3  | `AGENTS.md:288,329-333,353`                                                                         | Hand-listed providers, stale (grok, opencode, copilot, omp… are missing)                                                               | High  | rewrite (point to `registry.ts`) |
| S-F4  | `AGENTS.md:100`                                                                                     | Raw line number `cli.ts:256-258` has moved (now around `:687`)                                                                         | High  | rewrite (text anchor)            |
| S-F5  | `.claude/commands/validation/validate-2.md`                                                         | The whole file is stale: dropped `command_templates` table, removed `/command-invoke`, "6 tables"                                      | High  | remove                           |
| S-F6  | `.claude/commands/prime-backend.md:42-47`, `prime-workflows.md:18-22`                               | Paths that no longer exist (`core/src/providers/*`, `workflows/src/types.ts`)                                                          | High  | rewrite                          |
| S-F7  | `.claude/skills/validate-ui/SKILL.md:537-562`                                                       | Stale file map. "Stale workflow detection (15min)" contradicts the No Autonomous Lifecycle Mutation rule                               | High  | rewrite                          |
| S-F8  | `commit.md:72,80`, `validation/code-review.md:17`, `execution-report.md:78`, `system-review.md:147` | Dead `.claude/rules/` reference                                                                                                        | Med   | rewrite (to AGENTS.md)           |
| S-F9  | `.claude/skills/release/SKILL.md` (72 sites)                                                        | `dev` vs `develop`. See decision 5                                                                                                     | Med   | rewrite                          |
| S-F10 | `test-release/SKILL.md:304,356-363`                                                                 | A stale heading plus a history block that only exists to patch it                                                                      | Med   | rewrite / remove                 |
| S-F11 | `.agents/skills/github-issue-tracker/SKILL.md:3,159`                                                | A prohibition against a script that was already deleted, carried in the trigger text                                                   | Med   | rewrite                          |
| S-F12 | `AGENTS.md:144,436`                                                                                 | Incident narrative where the rule already stands                                                                                       | Med   | remove / rewrite                 |
| S-F13 | `AGENTS.md:254,261,542,585`                                                                         | Plan-phase labels (also against your global rule)                                                                                      | Med   | remove                           |
| S-F14 | `AGENTS.md:192` (+ `scripts/check-schema-upgrades.ts:104`)                                          | Frozen count "21 tags / 8 baselines"; there are 23 tags now                                                                            | Med   | rewrite                          |
| S-F15 | `AGENTS.md:630-631`                                                                                 | The BMAD section assumes Codex `$command`, but Claude reads it too                                                                     | Med   | rewrite                          |
| S-F16 | line 9 of 8 `.claude/agents/*.md`                                                                   | 1a: every agent opens with a "CRITICAL:" header (one template import)                                                                  | Med   | rewrite                          |
| S-F17 | `.claude/agents/code-reviewer.md`                                                                   | Severity/confidence filter that lowers recall. **Decision 1**                                                                          | Med   | rewrite (pending)                |
| S-F18 | `archon-dev/cookbooks/{plan,review,research}.md`, `plan-feature.md:33`, `rca.md:29`                 | "Always launch" agents. **Decision 2**                                                                                                 | Med   | rewrite (pending)                |
| S-F19 | `.claude/commands/create-command.md:114,207`                                                        | 1b: "Think deeply" / "Use extended thinking" written into every generated command                                                      | Med   | rewrite                          |
| S-F20 | `.claude/skills/archon/references/troubleshooting.md:70,90`                                         | Migration-relative "no longer" wording                                                                                                 | Med   | rewrite                          |
| S-F21 | `archon/SKILL.md:12-14`, `archon-dev/SKILL.md:26-27`                                                | Trigger enumeration; "ANY development task"                                                                                            | Med   | rewrite                          |
| S-F22 | `.claude/agents/codebase-analyst.md:129`                                                            | Padding: "Be thorough, precise, and factual"                                                                                           | Med   | remove                           |

Low (flag only):

- **S-L1:** `variables.md:30` mentions a "one-release" warning.
- **S-L2:** release tap paths. See decision 5.
- **S-L3:** harness tool names in `archon/SKILL.md:104`.
- **S-L4:** an unenforced "always flagged" table in `code-reviewer.md`.
- **S-L5:** a triple "never hand-roll" that is consistent, so harmless.
- **S-L6:** an accurate tier table that could point at `tier-defaults.json`.
- **S-L7 (add):** AGENTS.md lacks the Opus 5 guidance on scope, deliverable length and "communicating with the user" (`model-migration.md` → Opus 5 checklist `[TUNE]` items).

### A5. BMAD testarch/QA/TEA (13 dirs, 246 unique files)

| ID   | Location                                                                                                                  | Pattern                                                                                                                                                     | Conf.    | Action                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| T-F1 | `bmad-testarch-automate/checklist.md:55,104,409`; `bmad-testarch-trace/checklist.md:271`                                  | Broken reference to `test-priorities.md`; only `test-priorities-matrix.md` exists                                                                           | High     | rewrite                                                               |
| T-F5 | teach-me-testing steps (about 12 files)                                                                                   | 1d patch accretion: three variants of "NEVER generate content" beside a "FACILITATOR" line, in steps whose job is to teach                                  | Med-High | rewrite                                                               |
| T-F2 | 45-58 step files                                                                                                          | 1a/1c: sequence ceremony stated four ways; "Master Rule: Skipping steps is FORBIDDEN"                                                                       | Med      | rewrite (one sentence with its reason; keep the Save Progress blocks) |
| T-F3 | test-review `03f`, trace `04`/`05`, nfr `04e`, automate `03c`, atdd `04c`                                                 | 1b/G4: pseudo-JS scoring and gates the model runs in its head. Latent bugs: `getQualityAssessment` is undefined, and "PARALLEL / ~60% faster" is hard-coded | Med      | move to a script                                                      |
| T-F4 | `auto` branch in 8 step files, plus "Parallel Gain ~40-70%" lines                                                         | Opus 5 delegation. **Simplest fix: set `tea_execution_mode: sequential` in `_bmad/tea/config.yaml:11`**                                                     | Med      | rewrite                                                               |
| T-F6 | `bmad-teach-me-testing/SKILL.md:78-96`                                                                                    | 1a: "Critical Rules (NO EXCEPTIONS)" duplicates the processing rules                                                                                        | Med      | rewrite                                                               |
| T-F7 | "Polish Output" in 5 step files                                                                                           | Opus 5 self-check trap                                                                                                                                      | Med      | rewrite                                                               |
| T-F8 | `pact-consumer-framework-setup.md`, `contract-testing.md`, `pactjs-utils-overview.md`, `test-quality.md`, `tea-index.csv` | G2: knowledge copies that contradict each other                                                                                                             | Med      | re-sync upstream (no hunk)                                            |

### A6. BMAD personas, CIS and review (43 dirs)

| ID   | Location                                                                                                                                 | Pattern                                                                                                                                      | Conf.            | Action                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------- |
| G-H1 | `bmad-story-automator-review/instructions.xml:6-10`                                                                                      | 1a/1f: emoji `<critical>` tags, "3-10 issues minimum", "this slop". Feeds unattended auto-fix, so invented findings become real code changes | High             | rewrite                               |
| G-H2 | `bmad-review/references/lens-edge-case-hunter.md:5`                                                                                      | 1a: "MANDATORY… IN EXACT ORDER"                                                                                                              | High             | remove                                |
| G-H3 | `bmad-code-review/SKILL.md:80-86`                                                                                                        | 1a: "Critical Rules (NO EXCEPTIONS)" duplicates `:65-78`                                                                                     | High             | remove                                |
| G-H4 | `bmad-code-review` SKILL.md plus 4 steps                                                                                                 | 1a: "YOU MUST ALWAYS SPEAK OUTPUT" ×5                                                                                                        | High             | rewrite                               |
| G-M1 | `lens-adversarial.md:7`                                                                                                                  | 1f: "at least ten issues", contradicting `bmad-review/SKILL.md:8` "never pad"                                                                | Med              | rewrite                               |
| G-M2 | edge-case lens `:48,50`; checkpoint-preview `step-02:42`, `step-01:61`                                                                   | 1b/1f: numeric caps                                                                                                                          | Med              | rewrite                               |
| G-M3 | edge-case lens `:23-26`; verification-gap `:62-64`                                                                                       | Opus 5 self-check. **Re-test recall**                                                                                                        | Med              | remove                                |
| G-M4 | tech-writer `write-document.md:17`; workflow-builder `producing-workflow-patterns.md:34`                                                 | Subagent used for review; the second spreads into every workflow the builder generates                                                       | Med              | rewrite / remove                      |
| G-M5 | module-builder `create-module.md:15`, `validate-module.md:32`; agent-builder `scan-architecture.md:31`; `bmad-brainstorming/SKILL.md:21` | Delegation thresholds set too low                                                                                                            | Med              | rewrite                               |
| G-M6 | `bmad-module-builder/SKILL.md:20`                                                                                                        | Refers to `bmad-builder-setup`, which doesn't exist (the skill is `bmad-bmb-setup`)                                                          | Med (fact: High) | rewrite                               |
| G-M7 | tech-writer `validate-doc.md`, `explain-concept.md`, `mermaid-gen.md`                                                                    | 1c: generic step scripts                                                                                                                     | Med              | remove                                |
| G-M8 | `bmad-review/references/editorial-common.md:42`                                                                                          | 1c: "prefer lists over prose" when reviewing prompts                                                                                         | Med              | rewrite                               |
| G-M9 | `bmad-bmad-help/SKILL.md:2` (collides with `bmad-help`) plus 4 bmalph shims                                                              | G3: overlapping skills                                                                                                                       | Med              | remove in the bmalph config (no hunk) |

Low: G-L1..L12 (CIS teaching beats, fine-grained halts, fixed question lists, a no-reason "no time estimates" rule, dangling `discover_inputs`, `bmad-investigate` missing, and others).

### A7. BMAD planning/dev (51 dirs)

| ID    | Location                                                                                                     | Pattern                                                                                                                                           | Conf. | Action                                               |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| P-F1  | `bmad-create-story/{SKILL.md:14, checklist.md:20-22, discover-inputs.md:45}`; story-automator `steps-v`      | 1a: "DO NOT BE LAZY… 5% chance"                                                                                                                   | High  | rewrite                                              |
| P-F2  | create-story `SKILL.md:15`, `checklist.md:24-26`; `loop-sweep/SKILL.md:54`; `stop-hook-recovery.md:18,37,65` | "Delegate more" guidance                                                                                                                          | Med   | rewrite                                              |
| P-F3  | readiness `steps/step-02..06` headers                                                                        | Self-contradiction (NEVER generate vs auto-proceed); `step-01` was already fixed locally                                                          | Med   | rewrite                                              |
| P-F4  | `bmad-retrospective/SKILL.md` (193 dialogue lines, e.g. 644-654)                                             | 1c: invented specifics ("Lost almost a full sprint") that leak into hands-off retro documents and break its own no-time rule                      | Med   | rewrite (label as illustrative; use placeholders)    |
| P-F5  | `bmad-dev-story/SKILL.md:367,463`                                                                            | Duplicate suite run and checklist pass                                                                                                            | Med   | remove                                               |
| P-F6  | `bmad-dev-auto/step-02-plan.md:17`                                                                           | Self-review before a gate that re-verifies the same thing                                                                                         | Med   | remove                                               |
| P-F7  | `bmad-dev-story/SKILL.md:15,82-84,339-340`                                                                   | 1a: "Absolutely DO NOT stop"                                                                                                                      | Med   | rewrite (the Opus 5 "finish the whole task" wording) |
| P-F8  | `bmad-dev-story/SKILL.md:361`                                                                                | 1a: "NO LYING OR CHEATING"                                                                                                                        | Med   | rewrite                                              |
| P-F9  | 26 sites                                                                                                     | 1a: "YOU MUST ALWAYS SPEAK OUTPUT"                                                                                                                | Med   | rewrite                                              |
| P-F10 | readiness, epics, quick-dev, story-automator `SKILL`/`workflow`                                              | 1a: duplicate "Critical Rules" blocks                                                                                                             | Med   | rewrite                                              |
| P-F11 | `bmad-create-story/checklist.md:3,7,28-30,221,341,349`                                                       | 1c: "COMPETITION", "Outperform the Original LLM"                                                                                                  | Med   | rewrite                                              |
| P-F12 | `story-automator/data/subagent-prompts.md:13-17`                                                             | 1a/1d: "(v1.2.0 - strengthened)", "Your job is CRITICAL"                                                                                          | Med   | rewrite                                              |
| P-F13 | `story-automator/data/orchestrator-rules.md:20-28,136-145,161-170`                                           | 1a/1e: triple "NEVER, EVER" (the reasons are kept)                                                                                                | Med   | rewrite                                              |
| P-F14 | `stop-hook-recovery.md:74`                                                                                   | "Do whatever it takes" works against scope discipline                                                                                             | Med   | rewrite                                              |
| P-F15 | bmalph `validate-*` stubs                                                                                    | G3: trigger text copied from the create workflow                                                                                                  | Med   | rewrite (upstream in bmalph)                         |
| P-F16 | story-automator `step-03*` and data files                                                                    | G4: the model runs a deterministic loop that `bmad-loop` already implements. Keep the model calls for escalations, ambiguous parses and the retro | Med   | move (architecture, no diff)                         |

Low (flag only):

- **P-F17..F24:**
  - version and session tags;
  - SUCCESS/FAILURE lists;
  - hype headers;
  - "continue silently" (keep for Opus 5; re-test on 5.5);
  - the loud retro line;
  - old model pins in config examples;
  - deliberate subagent fan-out;
  - the "no time estimates" caps.

### A8. `_bmad/` (384 unique files, 19 skipped as duplicates of `.agents/skills`)

| ID   | Location                                                                                                      | Pattern                                                                                            | Conf. | Action                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------ |
| B-1  | `bmm/.../bmad-create-story/workflow.md:10`, `discover-inputs.md:45`                                           | 1a laziness boosters                                                                               | High  | rewrite                                                      |
| B-2  | 12 files (create-story, technical, domain and market research steps, the orphaned `market-steps/`)            | "UTILIZE SUBPROCESSES AND SUBAGENTS"                                                               | High  | remove                                                       |
| B-3  | `bmad-quick-dev/steps/step-04-self-check.md`                                                                  | Opus 5 over-verification: a self-check step followed by an external review                         | High  | remove (keep the tech-spec update and the summary)           |
| B-4  | `core/skills/bmad-review-edge-case-hunter/workflow.md:34-37`                                                  | Self-check re-pass                                                                                 | High  | remove                                                       |
| B-5  | `wds/skills/shared/git.md:16`                                                                                 | Fossil: `Co-Authored-By: Claude Sonnet 4.6`, which contradicts `:29`                               | High  | rewrite                                                      |
| B-6  | 20 PRD validate and edit step files                                                                           | Subagent for a single-document check; "Not attempting subprocess architecture" listed as a failure | Med   | rewrite                                                      |
| B-7  | 110 step files                                                                                                | 1a/1d: "📖 CRITICAL: ALWAYS read the complete step file" ×5 per file                               | Med   | rewrite                                                      |
| B-8  | 161 + 46 files                                                                                                | 1a: "YOU MUST ALWAYS SPEAK OUTPUT" / "WRITE all artifact"                                          | Med   | rewrite                                                      |
| B-9  | 11 "Master Rule… SYSTEM FAILURE" files, 33 "Follow this sequence exactly" files, 52 "SYSTEM FAILURE" headings | 1c/1a                                                                                              | Med   | rewrite (keep the halt and wait rules)                       |
| B-10 | `bmm/.../bmad-dev-story/workflow.md:11,48-50,318`; `dev.agent.yaml:29`                                        | 1a: "DO NOT stop", "NO LYING"                                                                      | Med   | rewrite                                                      |
| B-11 | `bmad-validate-prd/steps-v/step-v-03-density-validation.md:57-116` (+ create-prd copy)                        | G4/1b: phrase counting and thresholds done by the model                                            | Med   | move to `_bmad/scripts/check_prd_density.py` (to be written) |
| B-12 | `_bmad/lite/create-prd.md`, Game row                                                                          | G2: refers to a Game Module that isn't installed. The rest of the file is clean                    | Med   | rewrite                                                      |
| B-13 | `_bmad/custom/bmad-{create,dev}-story.toml`                                                                   | Keep-list #11 (add). **The upgrade-safe layer**                                                    | Med   | add (hunks B-15, B-16)                                       |

Low (flag only):

- **B-L1:** "Show your analysis" in 43 files. It becomes an audit item on Opus 5.5 (`reasoning_extraction` refusals).
- **B-L2:** Anti-Bias Protocol.
- **B-L3:** repeated full-suite runs.
- **B-L4:** "Re-verify after adjustments".
- **B-L5:** the F1.1-scoped rule in `custom/bmad-code-review.toml`.
- **B-L6:** 15-word caps.
- **B-L7:** duplicate and orphaned step trees.

---

## Appendix B: Proposed diff, the hunks not in the verified patch

Apply one finding per hunk. For clustered findings, one representative hunk is shown and the same change goes at every location listed in Appendix A. BMAD hunks go into `.agents/skills/` and the `.claude/skills/` mirror, and also `.qoder/skills/` where that copy exists. After editing `.archon/commands/defaults` or `.archon/workflows/defaults`, run `bun run generate:bundled`, then `bun run validate`.

### Commands

```diff
# C-M1
--- a/.archon/commands/defaults/archon-implement-issue.md
+++ b/.archon/commands/defaults/archon-implement-issue.md
-description: Implement a fix from investigation artifact - code changes, PR, and self-review
+description: Implement a fix from investigation artifact - code changes, validation, and PR
@@
 6. Create PR linked to issue
-7. Run self-review and post findings
-8. Archive the artifact
```

```diff
# C-M2 (same style at investigate-issue:168 and ralph-generate:85)
--- a/.archon/commands/defaults/archon-create-plan.md
+++ b/.archon/commands/defaults/archon-create-plan.md
-**Agent Strategy**: Use Task tool with subagent_type="Explore" for codebase intelligence gathering. This ensures thorough pattern discovery before any external research.
+**Codebase exploration**: Gather the codebase patterns in Phase 2 before any external research. A single exploration sub-agent is fine for a wide multi-file search if your environment provides one; for a narrow feature, search directly.
@@
-**CRITICAL: Use Task tool with subagent_type="Explore" with thoroughness="very thorough"**
+Search the codebase (directly, or through one exploration sub-agent when the search is wide) and collect the following:
-### 2.1 Launch Explore Agent
+### 2.1 What to Find
```

```diff
# C-M3 (same wording in comment-quality, error-handling, docs-impact, test-coverage agents; plan-setup:212)
--- a/.archon/commands/defaults/archon-code-review-agent.md
+++ b/.archon/commands/defaults/archon-code-review-agent.md
-**CRITICAL**: Check for "NOT Building (Scope Limits)" section. Items listed there are **intentionally excluded** - do NOT flag them as bugs or missing features!
+**Scope limits**: If scope.md has a "NOT Building (Scope Limits)" section, the items in it were excluded on purpose. Don't report their absence as a bug or missing feature; still report real defects in the code that was changed.
--- a/.archon/commands/defaults/archon-pr-review-scope.md
+++ b/.archon/commands/defaults/archon-pr-review-scope.md
-**CRITICAL FOR REVIEWERS**: These items are **intentionally excluded** from scope. Do NOT flag them as bugs or missing features.
+**For reviewers**: These items were excluded from scope on purpose. Don't report their absence as a bug or missing feature.
--- a/.archon/commands/defaults/archon-plan-setup.md
+++ b/.archon/commands/defaults/archon-plan-setup.md
-**CRITICAL**: The "NOT Building" section defines what is **intentionally excluded** from scope. This MUST be captured and passed to review agents so they don't flag intentional exclusions as bugs.
+Capture the "NOT Building" section in full: it lists what was excluded on purpose, and the review agents read it so they don't report those exclusions as bugs.
```

```diff
# C-M4 (same at e2e-main)
--- a/.archon/commands/defaults/archon-validate-pr-e2e-feature.md
+++ b/.archon/commands/defaults/archon-validate-pr-e2e-feature.md
-**CRITICAL**: You MUST use the `agent-browser` CLI for ALL browser interactions. Load the `/agent-browser` skill for the full command reference.
+Use the `agent-browser` CLI for all browser interactions. It is the only browser tool that supports the per-run `--session` isolation described below. The `agent-browser` skill has the full command reference.
@@
-**YOU MUST LOAD THE AGENT-BROWSER SKILL NOW.** Use `/agent-browser` or invoke the skill. This gives you the full command reference for browser automation.
+Load the `agent-browser` skill before the first browser command; it has the full command reference.
```

```diff
# C-M5
--- a/.archon/commands/defaults/archon-assist.md
+++ b/.archon/commands/defaults/archon-assist.md
-## Instructions
-
-1. **Understand the request** - What is the user actually asking for?
-2. **Take action** - Use your full Claude Code capabilities to help
-3. **Be helpful** - Answer questions, debug issues, explore code, make changes
-4. **Note the gap** - If this should have been a specific workflow, mention it:
-   "Note: Using assist mode. Consider creating a workflow for this use case."
-
-## Capabilities
-
-You have full Claude Code capabilities:
-- Read and write files
-- Run commands
-- Search the codebase
-- Make code changes
-- Answer questions
+Do what the request asks — answer, debug, explore, or change code — with the tools available in this session.
+
+If the request looks like a recurring task that a dedicated workflow should own, end your reply with:
+"Note: Using assist mode. Consider creating a workflow for this use case."
```

```diff
# C-M6
--- a/.archon/commands/defaults/archon-create-plan.md
+++ b/.archon/commands/defaults/archon-create-plan.md
-**CRITICAL**: Do NOT assume `src/` exists. Discover actual structure:
+Discover the actual layout before referencing any path (don't assume a `src/` directory):
@@
-Common alternatives to `src/`:
-- `app/` (Next.js, Rails, Laravel)
-- `lib/` (Ruby gems, Elixir)
-- `packages/` (monorepos)
-- `cmd/`, `internal/`, `pkg/` (Go)
-- Root-level source files (Python, scripts)
-
# C-M7
--- a/.archon/commands/defaults/archon-implement.md
+++ b/.archon/commands/defaults/archon-implement.md
-**You MUST write or update tests for new code.** This is not optional.
+Write or update tests for new code.
# C-M8
--- a/.archon/commands/defaults/archon-workflow-summary.md
+++ b/.archon/commands/defaults/archon-workflow-summary.md
-**CRITICAL**: Read EVERY artifact from the workflow run. Miss nothing.
+Read every artifact from this run, including those under `review/`; the summary's decision matrix is built from all of them.
# C-M9
--- a/.archon/commands/defaults/archon-web-research.md
+++ b/.archon/commands/defaults/archon-web-research.md
-## What NOT To Do
-
-- Don't guess when you can search
-- Don't fetch pages without checking search results first
-- Don't ignore publication dates on technical content
-- Don't present a single source as definitive without corroboration
-- Don't skip the Gaps section — be honest about limitations
-
----
-
```

### Project skills, agents, AGENTS.md

```diff
# S-F1a
--- a/.claude/skills/archon/SKILL.md
+++ b/.claude/skills/archon/SKILL.md
-Each node has exactly ONE of: `command`, `prompt`, `bash`, `script`, `loop`, `loop_group`, `approval`, or `cancel`.
+Each node has exactly one action key: `command`, `prompt`, `bash`, `script`, `loop`, `loop_group`, `route_loop`, `approval`, `plannotator_gate`, `cancel`, `include` (load-time inlining of another workflow's nodes), or `workflow` (a governed child sub-run). For `include`/`workflow`, see [archon.diy/guides/authoring-workflows/](https://archon.diy/guides/authoring-workflows/).
# S-F1b
--- a/.claude/skills/archon/references/workflow-dag.md
+++ b/.claude/skills/archon/references/workflow-dag.md
-Each node must have exactly ONE of these fields: `command`, `prompt`, `bash`, `script`, `loop`, `loop_group`, `approval`, or `cancel`.
+Each node must have exactly one of these fields: `command`, `prompt`, `bash`, `script`, `loop`, `loop_group`, `route_loop`, `approval`, `plannotator_gate`, `cancel`, `include`, or `workflow`.
# S-F2
--- a/.agents/skills/archon-workflow-creator/references/node-types.md
+++ b/.agents/skills/archon-workflow-creator/references/node-types.md
 - `loop`
+- `loop_group`
 - `route_loop`
 - `approval`
 - `plannotator_gate`
 - `cancel`
+- `include` (load-time inlining of another workflow's nodes, namespaced `<includeId>__<nodeId>`)
+- `workflow` (runtime child sub-run; source of truth: `packages/workflows/src/schemas/dag-node.ts`)
```

```diff
# S-F3 (AGENTS.md:288, :331-332, :353)
-- **@archon/providers**: AI agent providers (Claude, Codex, Grok, Pi community) — owns SDK deps, … Core providers live under `claude/`, `codex/`, and `grok/`; community providers live under `community/` (currently `community/pi/`, registered with `builtIn: false`). …
+- **@archon/providers**: AI agent providers — owns SDK deps, … Built-in providers live under `claude/`, `codex/`, and `grok/`; community providers live under `community/<id>/` and register with `builtIn: false`; `registry.ts` is the authoritative list. …
-- **ClaudeProvider**: `@anthropic-ai/claude-agent-sdk`
-- **CodexProvider**: `@openai/codex-sdk`
+- Registered in `packages/providers/src/registry.ts` (`registerBuiltinProviders` / `registerCommunityProviders`); e.g. Claude wraps `@anthropic-ai/claude-agent-sdk`, Codex wraps `@openai/codex-sdk`
-… otherwise the YAML is rejected with `Unknown provider '<id>'. Registered: claude, codex, pi`.
+… otherwise the YAML is rejected with `Unknown provider '<id>'. Registered: <ids from the provider registry>`.
# S-F4 (AGENTS.md:100)
-- Reference: #1216 and the CLI orphan-cleanup precedent at `packages/cli/src/cli.ts:256-258`.
+- Reference: #1216 and the CLI orphan-cleanup precedent in `packages/cli/src/cli.ts` (the "orphaned run cleanup moved to `workflow cleanup` command only" comment).
# S-F5
git rm .claude/commands/validation/validate-2.md   # no other file references it
```

```diff
# S-F6a
--- a/.claude/commands/prime-backend.md
+++ b/.claude/commands/prime-backend.md
-!`ls packages/core/src/providers/`
+!`ls packages/providers/src/ packages/providers/src/community/`
-Read `packages/core/src/providers/factory.ts` for provider selection logic.
-Read `packages/core/src/providers/claude.ts` first 50 lines — `IAgentProvider` implementation
-with streaming event loop pattern.
+Read `packages/providers/src/registry.ts` (registration and lookup) and `packages/providers/src/types.ts`
+(`IAgentProvider` contract); skim `packages/providers/src/claude/` for the streaming event loop.
# S-F6b
--- a/.claude/commands/prime-workflows.md
+++ b/.claude/commands/prime-workflows.md
-Read `packages/workflows/src/types.ts` in full — the complete type system for workflow
-definitions: `WorkflowDefinition`, `WorkflowStep`, `WorkflowNode` (DAG), `LoopConfig`,
-`NodeType` (command / prompt / bash), `TriggerRule`, `OutputFormat`, tool restriction fields.
+!`ls packages/workflows/src/schemas/`
+Read `schemas/dag-node.ts` and `schemas/workflow.ts` — the Zod schemas every workflow type
+derives from (node kinds, trigger rules, output format, loop and tool fields).
# S-F7 (also replace the web rows at :537/:540-541/:543 with a live `!ls packages/web/src/components/workflows packages/web/src/hooks`)
--- a/.claude/skills/validate-ui/SKILL.md
+++ b/.claude/skills/validate-ui/SKILL.md
-| `packages/core/src/workflows/executor.ts` | Stale workflow detection (15min), step session continuity, parallel Promise.all, loop completion signal |
-| `packages/core/src/workflows/router.ts` | Case-insensitive matching, multiline regex, fallback behavior |
-| `packages/core/src/workflows/event-emitter.ts` | Listener error isolation, max listener cap, run registration lifecycle |
+| `packages/workflows/src/dag-executor.ts`, `executor.ts` | Node session continuity, concurrent layers, loop completion channels; runs are never auto-failed on staleness (AGENTS.md → No Autonomous Lifecycle Mutation) |
+| `packages/workflows/src/router.ts` | Tiered name resolution, ambiguity errors, fallback behavior |
+| `packages/workflows/src/event-emitter.ts` | Listener error isolation, max listener cap, run registration lifecycle |
# S-F8 (same edit at commit.md:72,80, execution-report.md:78, system-review.md:147)
-- Read any relevant `.claude/rules/` files for domain-specific patterns
+- Read the relevant sections of `AGENTS.md` for domain-specific patterns
# S-F9 (pending decision 5; body: perl -pi -e 's/\bdev\b/develop/g', then review each line)
-  Create a release from dev branch. Generates changelog entries from commits,
+  Create a release from the develop branch. Generates changelog entries from commits,
```

```diff
# S-F10 (test-release/SKILL.md)
-### Test 4 — Env-leak gate refuses a leaky .env (optional, for releases including #1036/#1038/#983)
+### Test 4 — Env-leak guard strips dangerous keys from a leaky .env (optional)
@@ (delete the "> **History — do not re-assert the old criteria.** …" block, :356-363)
# S-F11 (github-issue-tracker/SKILL.md)
-… Do NOT hand-roll `gh issue create`; do NOT use the retired batch script sync-github-issues.py.
+… Do NOT hand-roll `gh issue create`.
-- NEVER recreate a batch issue creator (the old `sync-github-issues.py` was removed); create one-by-one with these scripts.
+- Create issues one at a time with these scripts; batch creation loses the per-issue workflow choice and relationship wiring.
# S-F12 (AGENTS.md)
-… apply to that leg. Stating only the first half is how #2306 ruled coverage out for the wrong leg.
+… apply to that leg.
-… start doing real I/O with no signal. This is exactly how `/workflow abandon` tests began opening a real SQLite DB: `findChildRuns` was added to `db/workflows` by #2121 but never added to `command-handler.test.ts`'s factory (see #2240). **When you add …
+… start doing real I/O with no signal — for example, a DB helper missing from a factory opens the real SQLite database (#2240). **When you add …
# S-F13 (AGENTS.md: "(#2121 Phase 2)" → "(#2121)" at :254/:542; drop "(Phase 3)" at :261; "(Phase 3; " → "(" at :585)
# S-F14 (AGENTS.md:192; also update scripts/check-schema-upgrades.ts:104)
-… (tags that did not touch the schema share a file, so 21 tags give 8 baselines) — …
+… (tags that did not touch the schema share a file; the script prints the current tag/baseline counts) — …
# S-F15 (AGENTS.md:630-631)
-BMAD commands are available as Codex skills.
-Use `$command-name` to invoke them.
+BMAD commands are installed as skills for both runtimes: Codex (`.agents/skills/`, invoke with `$command-name`)
+and Claude Code (`.claude/skills/`, invoke as `/command-name` or via the Skill tool).
# S-F16 (line 9 of code-simplifier, codebase-analyst, codebase-explorer, comment-analyzer, docs-impact, pr-test-analyzer, silent-failure-hunter, type-design-analyzer)
-## CRITICAL: Document What Exists, Nothing More
+## Document What Exists, Nothing More
```

```diff
# S-F17 (PENDING decision 1)
--- a/.claude/agents/code-reviewer.md
+++ b/.claude/agents/code-reviewer.md
-… High-confidence issues only (80+) to minimize noise.
+… Reports each finding with a confidence score and severity.
-You are an expert code reviewer. Your job is to review code against project guidelines with high precision, reporting only high-confidence issues that truly matter.
+You are an expert code reviewer. Your job is to review code against project guidelines and find real problems.
-## CRITICAL: High-Confidence Issues Only
+## What to Report
-Your ONLY job is to find real problems:
-- **DO NOT** report issues with confidence below 80
-- **DO NOT** report style preferences not in project guidelines
-- **DO NOT** flag pre-existing issues outside the diff
-- **DO NOT** nitpick formatting unless explicitly required
-- **DO NOT** suggest refactoring unless it fixes a real bug
-- **ONLY** report bugs, guideline violations, and critical quality issues
-Quality over quantity. Filter aggressively.
+Report every bug, guideline violation, and significant quality issue in the diff, including ones you are unsure about, each with a confidence (0-100) and severity so the caller can rank and filter.
+Omit only style preferences no project guideline requires, pre-existing issues outside the diff, and refactors that fix no real problem.
# (follow-on: Step 5 "Discard 0-79" → "Report as Low"; drop :97 and :147; same idea in validation/code-review.md:81)
```

```diff
# S-F18 (PENDING decision 2; plan-feature.md:33 and rca.md:29 take the same "when the area is wide" condition)
--- a/.claude/skills/archon-dev/cookbooks/plan.md
+++ b/.claude/skills/archon-dev/cookbooks/plan.md
-Launch 2-3 agents in parallel using the Agent tool:
+Use agents when the affected area is wider than a handful of files; for a small, local change, read the code directly. Launch only the agents the change needs:
-**Always launch.** Write a detailed prompt asking it to find:
+**Launch when patterns to mirror are not already obvious.** Write a detailed prompt asking it to find:
-**Always launch.** Write a detailed prompt asking it to:
+**Launch when the change crosses module or package boundaries.** Write a detailed prompt asking it to:
--- a/.claude/skills/archon-dev/cookbooks/review.md
+++ b/.claude/skills/archon-dev/cookbooks/review.md
-Launch 2-4 review agents in parallel using the Agent tool:
+For a small diff, review it directly. For a larger diff, launch the review agents that fit the change, in parallel:
-**Always launch.** Write a detailed prompt describing the specific changes, …
+**Launch for any non-trivial code change.** Write a detailed prompt describing the specific changes, …
-**Always launch.** Write a detailed prompt describing the changed files. …
+**Launch when the diff touches error handling, catch blocks, or fallbacks.** Write a detailed prompt describing the changed files. …
```

```diff
# S-F19 (create-command.md)
-Phase 3: ANALYZE/DESIGN - Think deeply
+Phase 3: ANALYZE/DESIGN - Decide the approach
-**Use extended thinking for...**
# S-F20 (archon/references/troubleshooting.md)
-Compiled-binary builds of Archon no longer embed Claude Code / Codex — …
+Compiled-binary builds of Archon do not embed Claude Code / Codex — …
-… Server startup no longer auto-fails orphaned `running` rows (per the "No Autonomous Lifecycle Mutation" rule — `CLAUDE.md`). …
+… Server startup does not auto-fail orphaned `running` rows (per the "No Autonomous Lifecycle Mutation" rule — `AGENTS.md`). …
# S-F21a (archon/SKILL.md)
-  Triggers (config): "change my archon config", "modify archon config", "archon config",
-            "change archon settings", "update my config", "help me change my config",
-            "edit archon config", "archon configuration".
+  Triggers (config): viewing or changing Archon settings or config.yaml
+            (e.g. "change my archon config", "archon settings").
# S-F21b (archon-dev/SKILL.md)
-  This skill triggers on ANY development task: researching, investigating,
-  planning, building, reviewing, debugging, committing, or shipping code.
+  Use for development work on the Archon codebase itself that matches one of
+  the cookbooks above.
# S-F22 (codebase-analyst.md:128-129)
-
-Your analysis directly enables implementation success. Be thorough, precise, and factual.
```

### BMAD testarch/QA/TEA

```diff
# T-F1
--- a/.agents/skills/bmad-testarch-automate/checklist.md
+++ b/.agents/skills/bmad-testarch-automate/checklist.md
-- [ ] `test-priorities.md` - Priority classification (P0-P3)
+- [ ] `test-priorities-matrix.md` - Priority classification (P0-P3)
-- [ ] Test priorities assigned using `test-priorities.md` framework
+- [ ] Test priorities assigned using `test-priorities-matrix.md` framework
-- [ ] Priority classification applied (from `test-priorities.md`)
+- [ ] Priority classification applied (from `test-priorities-matrix.md`)
--- a/.agents/skills/bmad-testarch-trace/checklist.md
+++ b/.agents/skills/bmad-testarch-trace/checklist.md
-- [ ] `test-priorities.md` loaded successfully
+- [ ] `test-priorities-matrix.md` loaded successfully
```

```diff
# T-F4 (simplest form; outside the skills)
--- a/_bmad/tea/config.yaml
+++ b/_bmad/tea/config.yaml
-tea_execution_mode: auto
+tea_execution_mode: sequential
# Skill-level alternative (atdd step-04 representative; same at the 7 other `auto` branches; delete every "Parallel Gain"/"faster than sequential" line)
 if (requestedMode === 'auto') {
-  if (supports.agentTeam) resolvedMode = 'agent-team';
-  else if (supports.subagent) resolvedMode = 'subagent';
-  else resolvedMode = 'sequential';
+  // Workers multiply cost: each re-reads context and the orchestrator re-reads its output.
+  // Parallelize only a wide workload (many independent endpoints/pages); use agent-team only when explicitly requested.
+  resolvedMode = wideWorkload && supports.subagent ? 'subagent' : 'sequential';
```

```diff
# T-F2 (ci step-01 representative; same shape in the other step files)
-## MANDATORY EXECUTION RULES
+## EXECUTION RULES
-- 📖 Read the entire step file before acting
+- Complete the numbered sections in order and record outputs before loading the next step: resume and later steps read the state saved in Save Progress.
-## EXECUTION PROTOCOLS:
-
-- 🎯 Follow the MANDATORY SEQUENCE exactly
-- 💾 Record outputs before proceeding
-- 📖 Load the next step only when instructed
-
-**CRITICAL:** Follow this sequence exactly. Do not skip, reorder, or improvise.
-
@@ (delete the closing "🚨 SYSTEM SUCCESS/FAILURE METRICS … Master Rule: Skipping steps is FORBIDDEN." block)
# T-F5 (teach-me step-01 representative)
-- 🛑 NEVER generate content without user input
-- 📖 CRITICAL: Read the complete step file before taking any action
-- 🔄 CRITICAL: When loading next step with 'C', ensure entire file is read
-- 📋 YOU ARE A FACILITATOR, not a content generator
-- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`
+- ⏸️ Present this step's content, then wait for the learner at every menu, question, and quiz; never answer on their behalf.
+- ✅ Speak in your agent communication style, in `{communication_language}`.
# T-F6 (teach-me SKILL.md:78-96: replace "Step Processing Rules" + "Critical Rules (NO EXCEPTIONS)" with)
+1. **FOLLOW SEQUENCE**: Execute the current step file's numbered sections in order; load one step file at a time, when the current step directs you to.
+2. **WAIT FOR INPUT**: At a menu, halt for the learner's selection; move past a Continue menu only when they select 'C'.
+3. **SAVE STATE**: Update `stepsCompleted` and session tracking in the progress file after each session and before loading the next step — resume depends on it.
+4. **LANGUAGE**: Communicate in `{communication_language}`.
# T-F7 (atdd step-05 representative; same in automate, test-design, nfr, test-review)
-## 2. Polish Output
+## 2. Finalize Output
-Before finalizing, review the complete output document for quality:
-
-1. **Remove duplication**: Progressive-append workflow may have created repeated sections — consolidate
-2. **Verify consistency**: Ensure terminology, risk scores, and references are consistent throughout
-3. **Check completeness**: All template sections should be populated or explicitly marked N/A
-4. **Format cleanup**: Ensure markdown formatting is clean (tables aligned, headers consistent, no orphaned references)
+The progressive-append workflow can leave repeated sections in the output document; consolidate them. Populate every template section or mark it N/A.
```

T-F3, moving the scoring into a script, is a larger change. It adds `scripts/aggregate-scores.mjs` per skill, and the step then calls `node {skill-root}/scripts/aggregate-scores.mjs {timestamp} {resolvedMode}` instead of the pseudo-JS. The weights (30/30/25/15) and grade bands (90/80/70/60) move into the script. Send this upstream rather than patching locally.

### BMAD personas, CIS and review

```diff
# G-H1
--- a/.agents/skills/bmad-story-automator-review/instructions.xml
+++ b/.agents/skills/bmad-story-automator-review/instructions.xml
-  <critical>🔥 YOU ARE AN ADVERSARIAL CODE REVIEWER - Find what's wrong or missing! 🔥</critical>
+  <critical>You are an adversarial code reviewer: find what is wrong or missing.</critical>
-  <critical>Find 3-10 specific issues in every review minimum - no lazy "looks good" reviews - YOU are so much better than the dev agent
-    that wrote this slop</critical>
+  <critical>Expect problems and look hard, but report only issues grounded in the code or git evidence: a manufactured finding can block the story or trigger an unneeded auto-fix.</critical>
# G-H2 (lens-edge-case-hunter.md:5)
-**MANDATORY: Execute the steps below IN EXACT ORDER. DO NOT skip steps or change the sequence. Each action within a step is a REQUIRED action to complete that step.**
-
# G-H3 (bmad-code-review/SKILL.md:80-86: delete the "### Critical Rules (NO EXCEPTIONS)" block)
# G-H4 (SKILL.md:51 and 4 step files)
-- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
+- Speak all output in `{communication_language}`.
# G-M1 (lens-adversarial.md:7)
-Review with extreme skepticism — assume problems exist. Find at least ten issues to fix or improve in the provided content. Every finding must point at something concrete in the content. Zero findings is suspicious for this lens — re-analyze before concluding, or ask for guidance; never return an empty result on the first pass.
+Review with extreme skepticism — assume problems exist and look hard for them. Every finding must point at something concrete in the content. Zero findings is suspicious for this lens — re-analyze before concluding, or ask for guidance.
# G-M2 (representatives)
-  "trigger_condition": "one-line description (max 15 words)",
+  "trigger_condition": "one-line description",
-  "potential_consequence": "what could actually go wrong (max 15 words)"
+  "potential_consequence": "what could actually go wrong, in one line"
-… describing what this location does for the concern. Keep framing under 15 words per stop.
+… describing what this location does for the concern.
-… if ≤200 tokens, display verbatim. If longer, distill to ≤200 tokens. …
+… display a short source verbatim; distill a long one to a short paragraph a reviewer reads at a glance. …
# G-M3 (edge-case lens: delete "## Step 2: Validate completeness" and renumber; verification-gap: replace "### Step 5: Confirm each finding is real" + its paragraph with "### Step 5: Exclusions", keeping the "Do not report:" line)
# G-M4
-4. **Review** — Use a subprocess to review and revise for quality of content and standards compliance
+4. **Revise** — Revise the draft for content quality and standards compliance before handing it over
-- [ ] Final polish through a subagent polish step at the end
# G-M5 (create-module.md:15; same at validate-module.md:32)
-… For 4 or fewer skills, read all SKILL.md files in a single parallel batch … For 5+ skills, spawn parallel subagents — one per skill — …
+**Read every SKILL.md in the folder**, in parallel batches (one message, multiple Read calls). Only when the set is large enough that the raw files would crowd your context, spawn subagents that each cover a group of skills and return compact JSON: `{ name, description, capabilities: [{ name, args, outputs }], dependencies }`.
# (scan-architecture.md:31: replace the "five-or-more-source … subagent per source" clause with "Subagents cost a context rebuild each, so reserve them for sizeable independent tracks; flag delegation of work a handful of tool calls would finish.")
# (bmad-brainstorming/SKILL.md:21: "On failure, use a subagent to read" → "On failure, read … directly and use defaults")
# G-M6 (bmad-module-builder/SKILL.md:20)
-… `bmad-builder-setup` can configure the module …
+… `bmad-bmb-setup` can configure the module …
# G-M7 (validate-doc.md; same for explain-concept.md, mermaid-gen.md: delete the "## Process" section, keep "## Output")
# G-M8 (editorial-common.md:42)
-- Prefer structured formats (tables, lists, YAML) over prose
+- Structured formats (tables, lists, YAML) for reference data; prose that carries the reason for behavioral guidance
```

### BMAD planning/dev

```diff
# P-F1
-- EXHAUSTIVE ANALYSIS REQUIRED: You must thoroughly analyze ALL artifacts to extract critical context - do NOT be lazy or skim! This is the most important function in the entire development process!
+- Read every artifact that bears on this story in full: the dev agent sees only the story file, so context you miss is context it never gets.
-**DO NOT BE LAZY** -- use best judgment to load documents that might have relevant information, even if there is only a 5% chance of relevance.
+Load every document that might hold relevant information, even when the chance of relevance is low.
-- 🛑 **DO NOT BE LAZY** - CHECK EVERY FIELD AND SESSION
+- Check every field and every session, not a sample.
# P-F2
-- UTILIZE SUBPROCESSES AND SUBAGENTS: Use research subagents, subprocesses or parallel processing if available to thoroughly analyze different artifacts simultaneously and thoroughly
+- Use subagents only when the artifact set is large and splits into independent parts; each subagent re-establishes context, so read smaller sets yourself.
-Use sub-agents for parallel verification when available; never ask permission.
+Verify entries yourself. Use sub-agents only when the ledger is large enough that parallel verification clearly outweighs each sub-agent re-establishing context. Never ask permission.
-1. Spawn sub-agent to analyze current context
-2. Gather: state document, recent session output, story requirements
+1. Read the state document, recent session output, and story requirements yourself
+2. Use a sub-agent only if the session output is too large to read directly
# P-F3 (readiness step-02 representative; same at 03-06; mirror identical)
-- 🛑 NEVER generate content without user input
+- 🛑 Never invent requirements; extract them from the selected documents
-- 🔄 CRITICAL: When loading next step with 'C', ensure entire file is read
-- 📋 YOU ARE A FACILITATOR, not a content generator
+- 🔄 Read the next step only after this step is saved, and read that file completely
+- 📋 This step runs autonomously and proceeds to the next step without a menu
# P-F4a (retrospective SKILL.md, party-mode protocol)
+  - Scripted dialogue in the steps below illustrates tone and turn-taking only. Every fact in dialogue (story names, problems, durations, fields, blame) must come from the Step 3 story analysis or the user; never repeat the sample content.
# P-F4b: convert invented dialogue (e.g. :644-654) to placeholders such as "{{hardest_struggle_from_step_3_analysis}}"
# P-F5 (dev-story SKILL.md)
-    <action>Run full test suite to ensure NO regressions introduced</action>
-    <action>Execute the enhanced definition-of-done checklist using the validation framework</action>
# P-F6 (dev-auto step-02-plan.md: delete "4. Self-review against READY FOR DEVELOPMENT standard." and renumber 5→4, 6→5)
# P-F7 (dev-story SKILL.md:82-84 and :15)
-  <critical>Absolutely DO NOT stop because of "milestones", "significant progress", or "session boundaries". …
+  <critical>Finish the whole story in this run: continue until every task and subtask is checked and every AC is satisfied, unless a HALT
+    condition applies or the user says otherwise. Milestones and visible progress are not stopping points.</critical>
# P-F8
-    <critical>NEVER mark a task complete unless ALL conditions are met - NO LYING OR CHEATING</critical>
+    <critical>Mark a task complete only when every gate below passes; code review and the user trust the checkbox as proof.</critical>
# P-F9 (26 sites)
-- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
-- Language MUST be tailored to `{user_skill_level}`
+- Speak all output in `{communication_language}`, in your agent communication style.
+- Tailor language to `{user_skill_level}`.
# P-F10 (delete each "### Critical Rules (NO EXCEPTIONS)" block; fold "never … plan from future step files" into the Just-In-Time Loading bullet)
# P-F11 (create-story checklist.md)
-# 🎯 Story Context Quality Competition Prompt
+# Story Context Quality Review
-## **🔥 CRITICAL MISSION: Outperform and Fix the Original Create-Story LLM**
+## Mission: find and fix what the original story missed
-**Your purpose is NOT just to validate - it's to FIX and PREVENT LLM developer mistakes, omissions, or disasters!**
+Your purpose is to fix the story, not only to validate it, so the dev agent does not repeat the mistakes below.
-### **🎯 COMPETITIVE EXCELLENCE:**
-
-This is a COMPETITION to create the **ULTIMATE story context** that makes LLM developer mistakes **IMPOSSIBLE**!
+The goal is a story file complete enough that the dev agent needs no other context.
# P-F12 (story-automator/data/subagent-prompts.md)
-**Prompt (v1.2.0 - strengthened):**
+**Prompt:**
-You are a session output parser. Your job is CRITICAL - incorrect parsing leads to workflow failures.
+You are a session output parser. The orchestrator acts on your status directly: a wrong SUCCESS skips a failed step, so prefer AMBIGUOUS over a guess.
# P-F13 (orchestrator-rules.md:20-28; same treatment at 136-145, 161-170 keeping "Why?")
-### 🚨 ABSOLUTE RULE: NEVER UPDATE sprint-status.yaml 🚨
-
-**YOU (the orchestrator) MUST NEVER, EVER write to sprint-status.yaml.**
-
-- ❌ NEVER use Edit tool on sprint-status.yaml
-- ❌ NEVER use Write tool on sprint-status.yaml
-- ❌ NEVER use Bash to modify sprint-status.yaml
-- ❌ NEVER "fix" mismatches by updating sprint-status.yaml
+### The orchestrator never writes sprint-status.yaml
+
+Do not modify sprint-status.yaml by any means (Edit, Write, Bash), including to "fix" a mismatch: a write here would hide a child workflow that failed to record its own result.
# P-F14 (stop-hook-recovery.md:74)
-Do whatever it takes. Make autonomous decisions. Only stop when genuinely unrecoverable …
+Make the routine decisions that keep the configured queue moving. Do not add stories, change a story's scope, or edit code yourself. Only stop when genuinely unrecoverable …
# P-F15 (bmalph stubs; fix upstream in the generator)
-  Guided Workflow to document technical decisions. Use when the user asks about validate architecture.
+  Validate an existing architecture document for completeness and consistency. Use when the user asks to validate or review the architecture.
-  Create the Epics and Stories Listing. Use when the user asks about validate epics stories.
+  Validate an existing epics and stories listing against the PRD and architecture. Use when the user asks to validate epics or stories.
```

### `_bmad/`

```diff
# B-1/B-2 (_bmad/bmm/workflows/4-implementation/bmad-create-story/workflow.md:10-11)
-- EXHAUSTIVE ANALYSIS REQUIRED: You must thoroughly analyze ALL artifacts to extract critical context - do NOT be lazy or skim! This is the most important function in the entire development process!
-- UTILIZE SUBPROCESSES AND SUBAGENTS: Use research subagents, subprocesses or parallel processing if available to thoroughly analyze different artifacts simultaneously and thoroughly
+- Analyze every relevant artifact closely enough to extract the context the dev agent needs; the story file is the dev agent's only source of that context.
# B-1 (discover-inputs.md:45)
-**DO NOT BE LAZY** -- use best judgment to load documents that might have relevant information, even if there is only a 5% chance of relevance.
+Load each document whose index entry suggests it bears on this workflow's objective.
# B-2 (research steps: delete the "**UTILIZE SUBPROCESSES AND SUBAGENTS**: …" paragraph at each listed site)
# B-3 (quick-dev step-04-self-check.md: retitle "Wrap Up Implementation"; delete "## SELF-CHECK AUDIT" sections 1-4 and the matching success/failure bullets; keep UPDATE TECH-SPEC and the summary)
# B-4 (edge-case-hunter workflow.md: delete "### Step 3: Validate Completeness", renumber Step 4 → 3)
# B-5 (_bmad/wds/skills/shared/git.md:16)
-Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
+Co-Authored-By: <actual model name> <noreply@anthropic.com>
# B-6 (in the 20 PRD step files: "**Try to use Task tool to spawn a subprocess:**" → "Perform this check:"; delete "- Not attempting subprocess architecture")
# B-7 (110 files)
-- 📖 CRITICAL: ALWAYS read the complete step file before taking any action - partial understanding leads to incomplete decisions
-- 🔄 CRITICAL: When loading next step with 'C', ensure the entire file is read and understood before proceeding
+- 📖 Read each step file in full before acting on it.
@@ (delete the three "❌ **CRITICAL**: Reading only partial step file / Proceeding with 'C' without … / Making decisions without complete understanding …" lines)
# B-8 (161 + 46 files)
-- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`
-- ✅ YOU MUST ALWAYS WRITE all artifact and document content in `{document_output_language}`
+- ✅ Speak to the user in `{communication_language}`, in your agent's communication style.
+- ✅ Write all artifact and document content in `{document_output_language}`.
# B-9
-**Master Rule:** Skipping steps, optimizing sequences, or not following exact instructions is FORBIDDEN and constitutes SYSTEM FAILURE.
+**Master Rule:** Follow the numbered sections in order; each builds on the previous one. Change the order only when the user asks.
-**CRITICAL:** Follow this sequence exactly. Do not skip, reorder, or improvise unless user explicitly requests a change.
+Follow the numbered sections in order; each builds on the previous one. Change the order only when the user asks.
# (rename "### ❌ SYSTEM FAILURE:" → "### ❌ FAILURE MODES:")
# B-10 (bmm dev-story workflow.md:11 and :48-50, :318; dev.agent.yaml:29)
-- Absolutely DO NOT stop because of "milestones", "significant progress", or "session boundaries". Continue in a single execution until the story is COMPLETE …
+- Finish the whole story, not just the easy part of it: continue in one execution until all ACs are satisfied and all tasks/subtasks are checked, unless a HALT condition applies or the user says otherwise. If you genuinely can't complete something, do the rest and state plainly what's missing and why.
-    <critical>NEVER mark a task complete unless ALL conditions are met - NO LYING OR CHEATING</critical>
+    <critical>Mark a task complete only when its tests exist and pass and its acceptance criteria are met; report any gap plainly instead.</critical>
-    - "NEVER lie about tests being written or passing - tests must actually exist and pass 100%"
+    - "Report test status exactly as it is: a test counts only when it exists and passes"
# B-11 (step-v-03-density-validation.md; needs a new _bmad/scripts/check_prd_density.py)
-### 1. Attempt Sub-Process Validation
+### 1. Run the Density Scan
+
+Run `python3 {project-root}/_bmad/scripts/check_prd_density.py {prd_file_path}`. It prints per-category counts, example lines with line numbers, and the severity (Critical > 10, Warning 5-10, Pass < 5). Use its output for Section 4; skip Sections 2-3 when it succeeds and fall back to them only if the script is unavailable.
-**Try to use Task tool to spawn a subprocess:**
+**Fallback scan (script unavailable):**
# B-12 (_bmad/lite/create-prd.md, Game row)
-| Game | game, player, gameplay, level, character | Use the BMAD Game Module agent and workflows instead | Game brief, GDD | Most sections |
+| Game | game, player, gameplay, level, character | Out of scope for this generator: tell the user a game design document fits better | Game brief, GDD | Most sections |
# B-15 (upgrade-safe; _bmad/custom/bmad-create-story.toml persistent_facts)
+  "Delegate to subagents only for large, genuinely independent analysis tracks; read and analyze the story's artifacts yourself when a handful of reads covers them. Subagents re-read context and report back, which multiplies cost.",
# B-16 (upgrade-safe; _bmad/custom/bmad-dev-story.toml persistent_facts)
+  "Deliver the story at the scope it defines. Finish the whole story, not just the easy part; report completion only when it is fully done. If something genuinely can't be completed, do the rest and state plainly what's missing and why.",
```

---

## Verification before merging (Step 7)

Removing a line is a hypothesis to test, not a conclusion.

- **Probe behavior on the removals that matter most.** Check whether review recall holds without G-M3 and T-F7. Check whether W-F3 (per-edit type-check) catches fewer breakages. Check whether C-L1 update suppression is still needed. Use a scratch copy and real runs, and change one thing at a time.
- **Out-of-band dependencies.** No test asserts the changed strings in the runtime, commands, workflows or project-skills slices; each slice grepped for the exact strings. Before applying the BMAD rewrites, grep for "Find at least ten issues" and "Find 3-10 specific issues": they also live in `.qoder/skills/` and `_bmad/core/skills/bmad-review-adversarial-general/workflow.md`.
- **Generated files.** Run `bun run generate:bundled` after any `.archon/**/defaults` edit, then `bun run validate`.
- **R-F6** needs the Pi Anthropic OAuth wire check (#1831/#2243) to return HTTP 200 before merging.
- **Re-audit at the next model move.** If the target becomes Opus 5.5, add these items:
  - C-L1 update suppressors;
  - B-L1 "show your analysis", which can trigger `reasoning_extraction`;
  - R-L3 `thinking: disabled` / `budgetTokens`, which are 400s;
  - W-L4 effort defaults (Opus 5.5 defaults to `medium`).

## Unresolved questions

1. Decisions 1–5 above: code-reviewer confidence filter, "always launch" agents, speckit Opus 4.8 pins, story-automator PREFERENCE escalations, fork releases.
2. Which BMAD copy is canonical, `.agents/skills` or `.claude/skills`? The readiness and UX mirrors disagree, and two skills exist only in `.agents`.
3. Should the BMAD findings go upstream (BMAD-METHOD and bmalph), or be kept as a local patch set that is re-applied after each upgrade?
4. T-F8: which `pact-consumer-framework-setup.md` guidance is correct? The copies contradict each other and both changed in the same vendored commit.
