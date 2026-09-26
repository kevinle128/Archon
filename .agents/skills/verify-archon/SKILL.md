---
name: verify-archon
description: Drive Archon through its CLI, HTTP API, and Console/Legacy UI; check user-facing behavior and retain evidence.
disable-model-invocation: true
---

# Verify Archon

Follow the [pstack verification skill design](https://github.com/backnotprop/pstack/blob/main/skills/create-verification-skill/SKILL.md): drive the real application, check observable results and side effects, retain evidence, and clean up owned resources.
Read the supplied target file and the [feature map](features/README.md).
Without a target file, use the caller's requested behavior and its feature recipe; ask for scope only when it is missing.
A workflow checkpoint does not invalidate the targets.
Verification uses the current application without a matching HEAD or clean-checkout requirement.
Preserve local work; do not commit, stash, restore, or repair product code during verification.

## Launch

Set `TARGET` to the absolute Archon checkout and `TOOLING` to the checkout containing this skill.
Set `VERIFY_HELPER="$TOOLING/.agents/skills/verify-archon/bin/verify.ts"`.
Install missing locked dependencies with `bun install --frozen-lockfile` in the checkout that needs them.
HTTP and browser recipes also need `npm ci --prefix "$TOOLING/e2e"`.
These declared installs do not need separate approval.

The helper starts and stops each recipe.
CLI recipes use private Git projects, SQLite databases, and `ARCHON_HOME` directories.
HTTP and browser recipes build the current target Web UI, then use `e2e/lib/playwright/archon-runtime.ts` for a private server and database.
The runtime polls readiness on port 13400 and refuses an occupied port.
Check with `lsof -i :13400`; never stop another process to take its port.
Browser recipes use Chrome or the configured `ARCHON_PW_CHANNEL`.
The deterministic E2E provider isolates the external model boundary; it does not prove live model reasoning.

## Doctor

```sh
bun "$VERIFY_HELPER" doctor --repo "$TARGET"
```

This read-only check confirms the target manifest, CLI entry point, and configured runners.
Run it before the first drive and again when unexpected behavior suggests a setup problem.
The runtime also checks server readiness before browser or HTTP actions.
Report the exact failed prerequisite; startup failure is not evidence of a product defect.

## Drive

Follow every selected feature's public entry points, actions, expected results, and side-effect checks.
Use the exact target checkout and selection path supplied by the selector.

```sh
bun "$VERIFY_HELPER" prove --selection "$SELECTION" --repo "$TARGET" --evidence-root "$EVIDENCE"
bun "$VERIFY_HELPER" prove --scenario install.health --repo "$TARGET" --evidence-root "$EVIDENCE"
```

For Markdown target notes, follow the named recipes directly and report each outcome.
A missing recipe needs a concrete harness extension or a documented manual drive.
Never claim coverage for an untested behavior or replace it with a convenient smoke test.
For visible changes, preserve approved design decisions and follow the [visual procedure](references/visual-verification.md).
The existing `ui.visual` recipe uses `visual-config.json`, matched captures, measurements, and an authenticated `codex exec` image reviewer.
Missing required review or captures leaves that check incomplete.

## Evidence

Keep targets, command output, reports, and images under `TARGET/.plans/verifications/<feature>/<attempt>/`, or the caller's evidence directory.
Each execution creates a fresh evidence child with `result.json`.
Capture actions and resulting state, including persisted data where the recipe requires it.
Read the new result and attachments from disk.
Report passed, failed, and untested targets separately with evidence paths.
PASS requires every selected recipe and its required evidence to pass; failed, skipped, flaky, or missing work is nonpassing.

## Cleanup

Recipes stop only their own processes and remove only their temporary runtime data, including after failure.
Never kill by process name or restore tracked user files to make the checkout look clean.
Keep reports and captures, and confirm they still exist after cleanup.

## Helpers

`bin/verify.ts --help` describes the executable helper.
`catalog --json` lists its supported behaviors and recipes.
The JSON feature files configure the runner; the Markdown feature map explains the user paths.
`normalize-selection` resolves named behaviors, and `validate-selection` checks that target list.
Neither operation compares commits or requires every changed file to have a mapping.
See `coverage-gaps.json` for current limits, including authentication, external platforms, and live providers.

After helper changes, run `bun run test:verification-skills`.
For browser support changes, also run `npm run typecheck --prefix e2e`.
