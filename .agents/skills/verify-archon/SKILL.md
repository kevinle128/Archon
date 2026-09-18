---
name: verify-archon
description: Prove Archon CLI workflows, solo HTTP API, and Console/Legacy run UI from an explicit selection; retain functional and visual evidence.
---

# Verify Archon

Use the executable catalog as the scope authority.
Read [contract.json](contract.json), [protocol](references/protocol.md), and `features/*.json` before selection or proof.
This skill tests the product; it does not authorize product repairs, commits, publication, or baseline changes.

## Target and prerequisites

`TOOLING` is the repository that contains this skill.
`TARGET` is the absolute product repository supplied by the caller.
They can be different checkouts.
Never substitute the shell working directory for `TARGET`.
The helper is `TOOLING/.agents/skills/verify-archon/bin/verify.ts` and runs with Bun.
Git, Bun, and the locked root dependencies are required.
Use the declared target install, not dependencies in an ambient parent directory.
Dependencies and fixture files under `e2e/` belong to the tooling checkout.

The CLI scenarios use disposable Git projects, SQLite databases, and `ARCHON_HOME` directories.
They do not need a server, browser, mockup, reviewer, or provider credential.
HTTP and browser scenarios build the exact target Web UI and reuse `e2e/lib/playwright/archon-runtime.ts`.
The runtime starts a local server on port 13400, uses a fresh SQLite database, and uses the existing deterministic E2E provider.
It polls readiness and refuses an occupied port.
It does not stop an existing listener.
Browser scenarios require the dependencies in `e2e/package-lock.json` and Chrome, or a configured Playwright browser through `ARCHON_PW_CHANNEL`.
If these dependencies are absent, obtain installation authorization before `npm ci --prefix "$TOOLING/e2e"`.

`ui.visual` also requires an authenticated `codex exec` with image input and structured output support.
It invokes the reviewer inside proof with a read-only sandbox and an isolated working directory.
Review uses Codex authentication with user configuration disabled and medium reasoning effort.
This keeps unrelated MCP servers, hooks, and user plugins out of the review process.
An unavailable reviewer is incomplete proof and returns FAIL.
Do not replace review with screenshot capture or a later informal approval.

## Inspect and run

Set task-specific shell variables from the caller's paths.
Do not change `HOME` or `CODEX_HOME`.

```sh
VERIFY_HELPER="$TOOLING/.agents/skills/verify-archon/bin/verify.ts"
bun "$VERIFY_HELPER" --help
bun "$VERIFY_HELPER" catalog --json
bun "$VERIFY_HELPER" doctor --repo "$TARGET"
bun "$VERIFY_HELPER" snapshot --repo "$TARGET" --base "$BASE_SHA"
bun "$VERIFY_HELPER" normalize-selection "$ATTEMPT/proposal.json" --repo "$TARGET" --base "$BASE_SHA" --out "$ATTEMPT/selection.json"
bun "$VERIFY_HELPER" validate-selection "$ATTEMPT/selection.json" --repo "$TARGET" --base "$BASE_SHA"
bun "$VERIFY_HELPER" prove --selection "$ATTEMPT/selection.json" --repo "$TARGET" --base "$BASE_SHA"
```

Obtain `BASE_SHA` independently from the change request or integration branch.
The default is the merge base with local `dev`, then `origin/dev` if local `dev` is absent.
A one-commit repository can use its initial commit.
Otherwise a missing base is an error.
Never trust the proposal to supply the expected base.
For an explicitly requested historical check with an empty diff, add `--historical` to normalization, validation, and proof.
Selection mode requires clean source and exact current identities.

An explicit diagnostic can run `bun "$VERIFY_HELPER" prove --scenario install.health --repo "$TARGET" --base "$BASE_SHA"`.
Diagnostic mode can inspect dirty authoring work but does not qualify a selection.
Never use diagnostic mode to recover from failed selection.

## Retained artifacts

Use `TARGET/.plans/verifications/{feature_name}/{attempt_id}/` unless the caller gives an external root.
Resolve this path from the target, not the tooling checkout.
Use a descriptive feature slug with letters, numbers, and hyphens.
Use a new UTC timestamp plus UUID for each attempt; require the directory and output files to be absent before creation.
Keep `snapshot.json`, `proposal.json`, `selection.json`, command receipts, and source or design traces in that attempt.
Pass the exact absolute selection path through `--selection`.
The helper never searches for another selection.
It creates a unique child under `ATTEMPT/evidence/` and writes `result.json` there.
An explicit `--evidence-root` can change the parent, but never permits source or skill directories.
Repeated proof creates different children and preserves prior evidence.

Only untracked artifacts in `.plans/verifications/` are exempt from source cleanliness.
Tracked changes, other untracked source, and escaping symlinks remain dirty or invalid.
Runtime scratch stays outside this retained subtree.
The runner stops its own children and removes its own scratch after success or failure.
Retain reports after cleanup.
A failed preflight keeps a fresh FAIL receipt.
If the requested evidence location cannot accept writes, the helper attempts a failure receipt in the tooling repository's retained artifact subtree and reports that path.
If no location accepts writes, the command exits nonzero and cannot claim proof.

Read the current `result.json` from disk.
Check its run, target, base, catalog, selection, and tooling identities; required scenario set; per-scenario status; errors; and attachments.
Only complete functional and required visual proof can return PASS.
Failed, skipped, flaky, missing, or unsupported work cannot return PASS.
The helper rechecks provenance, source cleanliness, attachments, and tooling after execution.

## UI scope and design authority

Follow the complete [visual procedure](references/visual-verification.md).
[visual-config.json](visual-config.json) pins the design source chain, content hashes, surfaces, states, viewports, region width, criteria, and accepted differences.
The `ui.visual` runner identity includes that configuration's digest in the catalog.
Every UI behavior includes this scenario, even when the proposal names only a functional behavior.
Do not put ad hoc visual requirements into v1 proposal or selection fields.
A new UI requirement needs a reviewed catalog/configuration update and fresh selection.

The current matrix covers Console and Legacy tool rows, open Raw payloads, and pending Ask cards at 1440×1000 and 390×844.
At the wide viewport, the node room is 460 px wide with a 2 px layout tolerance.
The capture records viewport and actual region dimensions separately.
The current final DESIGN controls accessibility targets and Raw contrast where the older mockup differs.
Replay, steering, view-as, and future tool bodies shown in references are excluded by the accepted scope.
Data text and durations differ, so comparison uses matched region/context images, geometry, and per-criterion image review instead of one pixel percentage.
Review output is validated and bound to the current proof context, pinned configuration, manifest, and image hashes.
Missing references, changed images, missing review, and incomplete outcomes return FAIL.

## Support and limits

The helper owns its `lib/`, copied schemas, conformance vectors, catalog, and visual configuration.
It reuses native E2E support and the mapped test IDs in `lib/browser-scenarios.ts`.
`e2e/ui/verifier-visual.spec.ts` supplies matched captures.
Existing tool-row and room tests honor `ARCHON_VERIFY_EVIDENCE` to retain captures in the current attempt.
No root Playwright dependency is added.

`coverage-gaps.json` explicitly defers login and multi-user authorization, live provider reasoning, external platform delivery, other UI surfaces, and uncovered workflow semantics.
Solo mode does not prove authorization.
The test provider proves engine and UI integration, not real model reasoning.
The existing workflow gate calls the same runner, but an environment without Chrome or the declared image reviewer cannot complete UI proof.

Run native contract and isolation checks with `bun run test:verification-skills` from the tooling root.
Run `bun x tsc --noEmit -p .agents/skills/verify-archon/tsconfig.json` and `npm run typecheck --prefix e2e` for support changes.
Qualification reports belong under the target's `setup-verify` attempts and are separate from product verdicts.
