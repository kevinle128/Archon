# Plannotator Gate Prepare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `plannotator_gate` generate its initial HTML through an embedded AI `prepare` call, then own review, annotation rework, recovery, and approval in one DAG node.

**Architecture:** Add a backward-compatible `prepare` input mode to the existing gate schema, mutually exclusive with `document`.
The gate executor runs preparation once for a fresh gate, validates and persists the HTML path, and reuses the persisted path during review recovery.
The existing supervisor remains the sole owner of pause, Plannotator subprocess, rework, and continuation semantics.

**Tech Stack:** Bun, TypeScript, Zod via `@hono/zod-openapi`, YAML workflows, Bun test.

## Global Constraints

- Keep existing `document: "$producer.output"` gates backward-compatible.
- Require exactly one of `plannotator_gate.document` and `plannotator_gate.prepare`.
- `prepare` supports only `prompt`, `provider`, `model`, `effort`, `allowed_tools`, and `denied_tools`.
- Prepare and rework are independent fresh AI calls.
  When their own values are absent, the provider inherits the workflow provider.
  The model inherits the workflow model only while the effective provider remains the workflow provider; otherwise it uses the selected provider's assistant model.
  Phase-local alias and tier references use normal resolution.
- Node-level `idle_timeout` applies to embedded gate AI calls.
- Preflight Plannotator before spending an AI call on preparation.
- Reuse a matching persisted paused-gate document during resume or `review-open`; never regenerate it.
- Preserve content-versus-visual annotation behavior.
- Do not add a database migration, dependency, API route, or new DAG node type.
- Never manually edit generated files; run the repository generators.
- Use strict TypeScript annotations and no unjustified `any`.
- Do not manually edit `CHANGELOG.md`.

---

### Task 1: Add the `prepare` schema and reference surfaces

**Files:**

- Modify: `packages/workflows/src/schemas/dag-node.ts`
- Modify: `packages/workflows/src/schemas.test.ts`
- Modify: `packages/workflows/src/loader.ts`
- Modify: `packages/workflows/src/loader.test.ts`
- Modify: `packages/workflows/src/include-expander.ts`
- Modify: `packages/workflows/src/include-expander.test.ts`

**Interfaces:**

- Produces `plannotatorGatePrepareConfigSchema` and its inferred type.
- Changes `PlannotatorGateConfig.document` to optional while schema refinement guarantees exactly one input mode.
- Adds `prepare.prompt` to node-output validation, include namespacing, `$INPUTS` substitution, and loop-body substitution.

- [ ] Write failing schema tests for prepare-only success, document-only compatibility, both-mode rejection, neither-mode rejection, empty prompt rejection, and unknown nested prepare keys.
- [ ] Run the focused schema tests and confirm failures are caused by missing `prepare` support.
- [ ] Implement the minimal schema and nested-key registration.
- [ ] Write failing loader/include tests proving prepare prompt references are validated and rewritten.
- [ ] Run the focused loader/include tests and confirm the new cases fail.
- [ ] Extend every existing Plannotator text-surface enumeration to cover optional `prepare.prompt` and optional `document` safely.
- [ ] Run `bun test packages/workflows/src/schemas.test.ts packages/workflows/src/loader.test.ts packages/workflows/src/include-expander.test.ts` and confirm it passes.
- [ ] Commit with `feat(workflows): add plannotator gate prepare schema`.

### Task 2: Execute preparation once and recover from the persisted document

**Files:**

- Modify: `packages/workflows/src/plannotator-gate-executor.ts`
- Modify: `packages/workflows/src/plannotator-gate-executor.test.ts`
- Modify: `packages/workflows/src/dag-executor.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`

**Interfaces:**

- The gate executor resolves its initial document from matching unresolved approval metadata first, then `document`, then `prepare`.
- The embedded gate AI helper receives a phase-specific config and returns assistant text whose entire trimmed value must be one HTML path.
- Prepare prompts receive standard workflow-variable and `$node.output` substitution before the provider call.
- Rework keeps single-pass `$REVIEW_DOCUMENT` and `$REVIEW_ANNOTATIONS` substitution.

- [ ] Write a failing executor test where prepare creates an HTML file and returns its path before the first annotate spawn.
- [ ] Run the focused test and confirm it fails because prepare is unsupported.
- [ ] Implement the minimal embedded prepare call, Plannotator preflight ordering, standard substitutions, timeout, and existing path validation.
- [ ] Write failing tests for prepare failure without pause, invalid prepare path, and persisted-document recovery without another prepare call.
- [ ] Run the new cases and confirm each fails for the intended missing behavior.
- [ ] Implement matching approval-metadata reuse and fail-fast behavior.
- [ ] Extend provider compatibility preflight to inspect both prepare and rework providers.
- [ ] Add a production-path DAG test proving prepare → approve → downstream executes exactly once, plus a regression test for legacy document mode.
- [ ] Run `bun test packages/workflows/src/plannotator-gate-executor.test.ts packages/workflows/src/dag-executor.test.ts` and confirm it passes.
- [ ] Commit with `feat(workflows): prepare plannotator review documents in gate`.

### Task 3: Migrate the bundled workflow and update authoring documentation

**Files:**

- Modify: `.archon/workflows/defaults/archon-speckit-feature.yaml`
- Modify: `.agents/skills/archon-workflow-creator/SKILL.md`
- Modify: `.agents/skills/archon-workflow-creator/references/node-types.md`
- Modify: `.agents/skills/archon-workflow-creator/references/workflow-anatomy.md`
- Modify: `.agents/skills/archon-workflow-creator/references/examples.md`
- Modify: `.agents/skills/archon-workflow-creator/references/validation.md`
- Regenerate: `packages/workflows/src/defaults/bundled-defaults.generated.ts`
- Regenerate: `packages/web/src/lib/api.generated.d.ts`
- Test: `packages/workflows/src/loader.test.ts`
- Test: `packages/workflows/src/dag-executor.test.ts`

**Interfaces:**

- `clarify-gate` depends directly on `clarify-respond`.
- `red-team-gate` depends directly on `red-team-respond`.
- The convergence route's negative target is `speckit-converge-review-gate`, which owns the delta-only prepare prompt.

- [ ] Update structural/default-workflow tests to expect the three consolidated gate nodes and no standalone explain nodes, then verify they fail.
- [ ] Move each existing explainer prompt and its provider/model/tool restrictions into the corresponding gate `prepare` block and remove the producer nodes.
- [ ] Keep the `tasks` node provider/model pair consistent; after syncing current `dev`, retain its `provider: codex` and `model: gpt-6-sol` pair.
- [ ] Run the default Speckit FAIL → review → Ralph retry → PASS production-path test.
- [ ] Update the workflow-creator skill and references to document both gate input modes, lifecycle, validation, and examples.
- [ ] Run `bun run generate:bundled`; do not hand-edit its generated output.
- [ ] Start the server, run `bun --filter @archon/web generate:types`, stop the server, and confirm the generated API type exposes optional `document` and `prepare`.
- [ ] Run `bun run cli validate workflows archon-speckit-feature`.
- [ ] Run focused workflow tests, `bun run check:bundled`, and `bun run validate`.
- [ ] Commit with `refactor(workflows): consolidate speckit plannotator gates`.
