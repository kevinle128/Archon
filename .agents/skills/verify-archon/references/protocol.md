# Portable project-verification protocol v1

This protocol separates author-time structure from runtime proof. JSON Schema checks document shape. A generated skill's native helper must implement selection, launch, execution, evidence, and freshness checks; schema conformance is never behavioral proof.

## Files and commands

The generated skill writes `contract.json` at the verifier root. The descriptor declares `protocol: project-verification`, integer `version: 1`, the skill name, an argv-array entrypoint, and paths to the six runtime schemas relative to the descriptor directory. Feature files validate against `catalog.schema.json#/$defs/feature`; there is no separate feature schema.

The entrypoint provides these operations:

```text
catalog --json
snapshot --repo PATH --base REF
normalize-selection PROPOSAL --repo PATH --out SELECTION [--base REF] [--historical]
validate-selection SELECTION --repo PATH [--base REF] [--historical]
prove --selection SELECTION --repo PATH [--base REF] [--historical] [--evidence-root PATH]
prove --scenario ID --repo PATH [--evidence-root PATH]
```

`doctor --repo PATH` may be supplied as an additional preflight operation. `snapshot` requires the caller's base. For normalization, validation, and selection proof, `--base REF` is an independently pinned caller bound; when omitted, the helper resolves and documents the observed development-branch merge-base. The helper resolves the bound itself and compares that SHA with the snapshot and proposal; it never treats `proposal.base_sha` as authority. `--historical` is independent of `--base`: an empty diff is rejected unless historical mode is explicit and the proposal names at least one affected behavior. Normal change selection always rejects an empty diff. There is no implicit state file and no separate behavior flag.

`prove --selection` validates the selection against the independently pinned base and current checkout immediately before proof, then revalidates the same invariants after proof before it can report PASS. `prove --scenario` is diagnostic and runs exactly one named scenario. Both accept an evidence root and atomically create a new, never-reused child directory for every attempt. A failed preflight still writes a fresh FAIL result there; provenance and digests that could not be computed are `null`, and `errors` explains why. A diagnostic result may likewise use `null` for unavailable product or selection provenance. A prior PASS never substitutes for a missing current result.

## Artifact storage and handoff

The default retained artifact root is `TARGET/.plans/verifications/`, resolved from the explicitly chosen product repository.
An explicit user-supplied root overrides this default; both skills must use the same resolved root.
Store each selection attempt at `{artifact_root}/{feature_name}/{attempt_id}/`.
Use the caller's feature name, or the supplied plan filename without its extension, as one safe directory component.
Reject absolute names, separators, `.` and `..` rather than allowing a name to escape the root.
Use a unique ID for each attempt.
Create each attempt exclusively before its snapshot; never reuse an existing directory.
Retain the complete request and plan, `snapshot.json`, `proposal.json`, `selection.json`, and command records there.

The selector returns the absolute selection path and the proof command with the same independently pinned target and base.
The verifier reads that exact file through `prove --selection` and uses `{attempt}/evidence` as its evidence root.
Without an explicit evidence root, selection proof defaults to the supplied selection's parent directory plus `evidence/`.
Diagnostic proof defaults to `{artifact_root}/{scenario_id}/evidence/`; validate the scenario path component before creating directories.
Each proof still creates a unique child directory with its own `result.json` and attachments.
Explicit external evidence roots remain supported for existing callers.

Keep the existing `--selection` input contract.
The verifier consumes the supplied file and validates it against the independently chosen target and base.
A missing file, failed attempt, or stale identity stops the handoff.
Do not add feature-name lookup, a latest-file search, or an implicit state file.

Resolve paths before checking containment; reject other in-repository evidence roots and paths that escape into source or verifier code through symlinks.
Runtime scratch files can use operating-system temporary directories.
Retained selections, reports, and evidence survive process cleanup and must not default to an operating-system temporary directory.

## Catalog and matching

Catalog identities are globally unique within their kind; behavior and gap identities must not collide. Duplicate feature, behavior, scenario, gap, or attachment identities are errors, never silently deduplicated. Every behavior scenario ID resolves to exactly one declared scenario. Every runner is a `{kind,id}` binding resolved through the native helper's documented registry. Unknown bindings fail before proof; prose is not executable configuration.

Each behavior identity occurs at most once in a proposal. Reject repeated proposal behavior IDs, including entries with conflicting confidence, rather than deduplicating them or allowing one entry to overwrite another.

`impact_paths` contains literal repository-relative files or subtree prefixes ending `/`. Wildcards, absolute paths, `..`, and implicit glob syntax are forbidden. A changed file matches an identical file entry or a subtree prefix. Compute the full base-to-head diff and include both endpoints of additions, deletions, and renames. Reject changed paths not covered by a feature, behavior, or declared gap. A changed path matching a known gap fails selection.

Every behavior directly matched by the diff is selected. A feature matched by the diff but omitted from the proposal expands to all its behaviors. A changed path that matches a feature but none of that feature's behavior mappings also expands the feature completely, even when another behavior in that feature was proposed; record every such feature in `broadened_features`. Medium- or low-confidence proposals likewise broaden to every behavior and scenario in the containing feature. Resolve the actual scenario IDs from the catalog and fail unknown IDs. Known gaps participate in the catalog digest. A gap may have no impact paths when no stable implementation boundary represents it; it then fails only when explicitly named. It does not cause unrelated feature changes to fail.

Before selection, require the expected base to be an ancestor of the target head, require the proposal base/head and changed-path set to equal the independently computed snapshot, and require a clean target checkout. Path arrays are sets for comparisons, so ordering is irrelevant. Dirty or substituted targets fail closed.

Historical mode changes only the empty-diff admission rule. Identity validation, confidence broadening, feature impact expansion, gap rejection, scenario resolution, provenance, and every other selection rule apply unchanged.

## Conditional visual scenarios

Tasks with UI impact require the [visual verification procedure](visual-verification.md).
Tasks without UI impact keep the normal functional proof path.
The selector determines semantic UI impact from the complete request, plan, sources, and diff; the helper validates the resulting live scenario bindings.
Do not implement intent classification by parsing prose with keyword rules.

Visual proof uses ordinary behaviors, scenarios, typed runner bindings, and result attachments in v1.
Bind each covered UI behavior to its required functional and visual scenarios so selection cannot omit visual proof by choosing a functional test alone.
Keep non-UI behavior mappings separate where their effects are separate; retain conservative expansion when shared code actually affects UI.
Do not add undeclared keys to the descriptor, proposal, selection, or result schemas.
The visual runner owns validated configuration for source provenance, reference content hashes, scope, capture conditions, and comparison obligations.
Publish its location and binding rules in the generated verifier so a cold selector can inspect it.
Expose the applicable source citations and visual obligations in the live catalog for semantic selection.
Bind each visual runner ID to a revision of that configuration, including reference and asset hashes, so a configuration change changes the live catalog digest and invalidates old selections.
Use exact registry lookup, not parsing of IDs, rationale, or proof-obligation prose.
Include the configuration, reviewer adapter, comparison code, and pinned reference material in the tooling digest.
Validate source hashes before and after proof; do not silently refresh a changed reference to make a run pass.

A visual scenario can pass only after its runner validates all required captures, measurements, and image-review results for the current attempt.
Propagate a visual mismatch as a nonpassing scenario and top-level FAIL even if all functional tests pass.
Missing or unsupported visual proof is also nonpassing, but the errors must identify incomplete verification rather than claim a demonstrated product defect.
The existing result completeness guard must enforce these runner obligations before emitting PASS.
Consumers must use that final guarded result, not a browser exit code or an earlier functional-only report.

## Proof lifecycle

When provided, run `doctor` before selection or proof. It verifies the intended repo, product build/version, declared helper dependencies, runner registry, and required tools. Dependency resolution must come from the target repo or its declared environment, never an ambient author checkout. Doctor or startup failure is setup failure and is not a product negative control.

For each selected scenario: resolve the runner binding, verify prerequisites, start only resources owned by this attempt, wait for readiness with a bounded timeout, execute the real user path, collect every proof obligation, and record attachments under the fresh evidence child. Startup, readiness timeout, execution timeout, unsupported binding, missing evidence, and cleanup failure all produce a nonpassing scenario status and top-level FAIL. Cleanup runs after success and failure, targets only resources recorded as owned by the attempt, preserves evidence, and records cleanup errors rather than hiding them.

Attachment paths are relative to the result's `evidence_dir`. Resolve each path beneath that directory and reject absolute paths, `..`, backslashes, NUL, or any resolved escape. Native guard tests consume the `current_context.attachment_inventory` list; they may materialize those named fixture files when exercising filesystem validation. The author checker validates only their structure and does not pretend to execute a filesystem proof.

A selection-mode PASS requires a clean non-null product snapshot matching the current checkout, current catalog/selection/tooling digests, exactly one passed result for every selected scenario, no missing or extra scenario, and no errors. `failed`, `flaky`, `skipped`, `missing`, and `unsupported` are all nonpassing. Scenario-debug results never satisfy selection proof.

After real scenario execution, recompute product, catalog, selection, and tooling context and apply the same completeness guard used by native conformance tests before emitting PASS. Public `prove` operations and native tests share that production guard; a test-only look-alike validator is not conformance.

## Canonicalization and hashing

Canonical JSON is UTF-8, compact (`,` and `:` separators), with object keys sorted by Unicode code point, Unicode emitted directly, and NaN/Infinity rejected. Protocol counters are integers. Scenario payloads are evidence and are not hashed through an unspecified floating-point serializer.

Normalize only these set-valued arrays before hashing: impact and changed paths, behavior IDs, scenario IDs, broadened feature IDs, coverage-gap IDs, prerequisites, and proof obligations. Sort by Unicode code point and reject duplicates for identity arrays; do not normalize result ordering or argv entrypoints. Hash SHA-256 bytes of the canonical form. Compute `catalog_sha256` over the entire catalog including known gaps but excluding `catalog_sha256` itself. `selection_sha256` covers the normalized selection. `tooling_sha256` covers the helper, runner registry, scenario/fixture/config source bytes, declared dependency lock/material, and protocol schemas.

The conformance file supplies exact cross-language digests and semantic guard fixtures. Selection and result cases are inputs for native helper tests. Fixture labels may be expanded before execution, but a label alone is never proof. Result cases are guard conformance fixtures, not claims that a product behavior ran.

## CLI boundary

`catalog`, `snapshot`, `normalize-selection`, `validate-selection`, and both `prove` forms emit their machine result as JSON on stdout. Human diagnostics go to stderr. Normalization and validation exit nonzero on failure; proof exits zero only for PASS. Malformed or unknown options exit nonzero. Implementations reject unrecognized arguments and must not fall back to permissive smoke behavior.
