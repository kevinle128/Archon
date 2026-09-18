# Set up Archon verification

Status: complete.

Current phase: completed with retained qualification evidence.

## Outcome

Recreate the project verifier and its selector from current source.
Do not read old skill versions from Git.
Keep the project-verification v1 contract and the explicit `--selection` interface.

## Scope

- CLI workflow discovery, validation, execution, persisted results, approval, rejection, resume, retry, cancellation, and invalid input.
- Solo Web UI on Console and Legacy: run detail, logs, graph, artifacts, node rooms, tool rows, Raw disclosure, and Ask answers.
- Local HTTP API: project and conversation creation, workflow save/read/delete, run execution, persisted decisions, and invalid or conflicting requests.
- Functional and visual proof with current design sources, desktop and narrow layouts, and keyboard access.
- Selection conformance, failure controls, and a cold selector-to-verifier handoff.

Login, multi-user authorization, real provider reasoning, and external platform delivery remain explicit gaps.
The existing test provider can supply deterministic agent events; it cannot prove a real provider.

## Constraints

Use isolated runtime homes and disposable project data.
Do not repair product code, change workflows, commit product changes or consumer artifacts, publish, or install global skills.
Qualification uses isolated disposable fixture commits.
Keep existing verification consumers compatible where the canonical contract permits it.
Retain evidence at `TARGET/.plans/verifications/{feature_name}/{attempt_id}/`.
Keep runtime scratch separate and stop owned processes after each run.

## Steps and acceptance

1. Implement the verifier, canonical schemas, catalog, runner bindings, and native conformance checks.
2. Execute every agreed scenario and the required lifecycle and visual controls through the public helper.
3. Report actual product verdicts and qualify the verifier only with complete evidence.
4. Generate the selector only after verifier qualification.
5. Qualify selection cases and the cold pair with the exact selection file.

Playwright was installed with the user's approval through `npm ci --prefix e2e`.
The contract and isolation checks pass (48 checks).
The initial public CLI health proof passed in diagnostic mode.
The clean product checkout is pinned to `c655c9f1898b19c363be09bf033ba6a25e61587e`.
Console/Legacy room, graph, artifact, tool/Raw, and Ask functional proofs passed.
The lifecycle controls detected missing current attachments, changed tooling, malformed catalogs, unknown bindings, and persistence failures.
The final image review contains 12 states, 48 images, and 24 outcomes.
Two Console Ask card style mismatches remain product FAIL; all functional scenarios pass.
The verifier is qualified for the declared scope, including failure and visual controls.
The selector stage is now authorized by that qualification gate.
The first selector fixtures lacked a CLI entrypoint and correctly stopped at doctor.
Corrected independent fixtures pass their decision, bounded mapping, discovery, and failed-attempt checks.
The first cold pair exposed an invalid-DAG fixture that stopped at missing description.
The fixture and assertion are corrected, and a fresh public health proof, 48 native checks, type check, and focused lint pass.
A new cold consumer completed the final pair against an independent complete product checkout with native PASS.
The exact missing-dependency error, unchanged selection, current identities, readable evidence, and clean process environment were confirmed.
A separate missing-selection invocation produced a fresh FAIL with no reused selection.
The public helper rejects stale base, HEAD, paths, catalog, dirty source, unknown identities, known gaps, and missing current selections.
Retained qualification receipts are in `.plans/verifications/setup-verify/20260918-qualification/`.
Both generated skills are qualified; the setup is complete.
The pair PASS covers its selected CLI scenario and does not replace the baseline visual FAIL.
Owned runtime scratch and processes are removed; all qualification artifacts and fixture checkouts remain for review.

## Completion evidence

- [Verifier qualification](../../.plans/verifications/setup-verify/20260918-qualification/verifier-qualification.md).
- [Selector and cold-pair qualification](../../.plans/verifications/setup-verify/20260918-qualification/selector-qualification.md).
- [Implementation review](../../.plans/verifications/setup-verify/20260918-qualification/review.md).
