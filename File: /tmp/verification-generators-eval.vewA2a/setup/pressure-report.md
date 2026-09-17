# Setup orchestration decision report

## Case 1

- **Next action and arguments:** Invoke `create-select-verify-target-skill` through the runtime skill mechanism. Pass the complete original user request, the resolved project and verification-target identity, repository/project root, any separately requested output root, every explicit constraint, and the exact qualified verifier path `/workspace/demo/.agents/skills/verify-demo`.
- **Allowed invocation:** The selector generator may run. The verifier generator need not run again on the stated facts.
- **Completion status:** Incomplete. Setup becomes complete only if the selector reports qualification with its actual report and evidence, including the required cold pair exercise against this verifier.
- **Required user input:** None on the stated facts. Any approval or prerequisite subsequently requested by the selector remains a boundary.

## Case 2

- **Next action and arguments:** Invoke `create-select-verify-target-skill` through the runtime skill mechanism with the complete original request, resolved project and target identity, roots, explicit constraints, and exact qualified verifier path `/workspace/demo/quality/custom-verifier`.
- **Allowed invocation:** The selector generator may run. The demonstrated product `FAIL` and exit 1 do not disqualify the verifier because current behavioral evidence covers the approved scope and controls.
- **Completion status:** Incomplete until selector qualification and cold pair evidence exist. Do not repair the product, change the product verdict, or call the setup failed merely because the qualified verifier found a product defect.
- **Required user input:** None on the stated facts.

## Case 3

- **Next action and arguments:** Stop before selector generation and report the verifier stage as partial, naming the two agreed scenarios lacking current evidence and any artifacts already written. Existing selector files do not bypass the verifier qualification gate.
- **Allowed invocation:** The selector generator may not run. The setup skill does not specify an automatic verifier retry or resume mechanism; further verifier work may occur only through whatever explicit continuation or prerequisite boundary the verifier generator itself provides, with the original request, resolved identities and roots, and constraints preserved.
- **Completion status:** Incomplete because current evidence does not cover every executable item in the approved scope.
- **Required user input:** None is established by the case. Request input only if the verifier generator identified a specific approval or prerequisite; the missing-evidence fact alone does not define what user response would resolve it.

## Case 4

- **Next action and arguments:** Preserve the verifier generator's approval boundary and wait for the user's scope confirmation. Present its proposed journeys and dependency edits without approving them on the user's behalf.
- **Allowed invocation:** The selector generator may not run. The verifier generator may continue only after the requested user confirmation, retaining the complete original request, resolved project/target/roots, and explicit constraints.
- **Completion status:** Incomplete; no verifier qualification has been established.
- **Required user input:** Explicit confirmation, rejection, or requested revision of the proposed scope and dependency edits.

## Case 5

- **Next action and arguments:** Stop during preflight. Report `create-select-verify-target-skill` as the exact missing installation prerequisite. Do not install it and do not infer readiness from the earlier local verifier.
- **Allowed invocation:** Neither generator may run in this setup attempt because preflight must confirm both are installed and loadable before any write or generator invocation.
- **Completion status:** Incomplete; no setup stage has started.
- **Required user input:** The user must arrange installation/availability of `create-select-verify-target-skill`, then request or resume setup. The setup skill supplies no installation mechanism.

## Case 6

- **Next action and arguments:** Stop during preflight. Report `create-verification-skill` as the exact missing installation prerequisite. Do not install it.
- **Allowed invocation:** Neither generator may run. Selector-first execution is forbidden, and both dependencies must be loadable before setup begins.
- **Completion status:** Incomplete; no setup stage has started.
- **Required user input:** The user must arrange installation/availability of `create-verification-skill`, then request or resume setup. The setup skill supplies no installation mechanism.

## Case 7

- **Next action and arguments:** Stop and report: the verifier stage is qualified and retained; selector files and selection-case validation exist; the selector qualification is partial because required cold selection-to-proof evidence is missing. Do not substitute author-side checks or claim product `PASS`.
- **Allowed invocation:** No additional generator invocation is authorized by the stated completed attempt. In particular, do not rerun the verifier merely because the selector is partial. The setup skill does not define selector retry/resume mechanics; a later continuation may use the selector generator only if its own explicit mechanism permits it, passing the original setup arguments and exact qualified verifier path again.
- **Completion status:** Incomplete. Selector file generation and selection-case validation do not replace the mandatory cold pair evidence.
- **Required user input:** None is established by the case. If the selector's report names a user-resolvable prerequisite for the failed cold handoff, request precisely that; otherwise report the technical blocker without inventing a user action.

## Case 8

- **Next action and arguments:** Treat the old reports as non-current and begin the verifier stage by invoking `create-verification-skill` through the runtime skill mechanism. Pass the complete current request, current resolved project and target identity, roots, and the explicit constraints to preserve existing work and review changes before overwrite. The verifier generator must inspect the existing artifacts and decide whether to preserve or compatibly upgrade them; it must not blindly regenerate them.
- **Allowed invocation:** Only the verifier generator may run initially. The selector generator may run later only after current verifier qualification, and must receive the exact verifier path returned by that qualification plus the same request, identities, roots, and constraints.
- **Completion status:** Incomplete. The existence of both generated skills and reports for an older identity is not current qualification evidence.
- **Required user input:** None before verifier inspection on the stated facts. If the verifier proposes scope or overwrite-affecting changes and pauses for approval, explicit user approval or revision is required; after verifier qualification, the selector must likewise preserve or compatibly upgrade existing selector artifacts under the user's review-before-overwrite constraint.

## Skill-level ambiguities

- The setup skill defines stop/continue gates but does not define how a partially qualified generator is resumed or retried. Cases 3 and 7 therefore cannot justify an invented resume command, arguments beyond the normal generator handoff, or automatic reinvocation.
- The setup skill does not define how a missing generator is installed or discovered beyond the runtime's native mechanism. Cases 5 and 6 can name the exact prerequisite but cannot prescribe installation mechanics.
- The phrase "changes reviewed before overwrite" does not identify a special review API. The enforceable decision is to preserve the generator-owned approval boundary and prohibit silent overwrite; the underlying generator owns the concrete inspection and approval interaction.
