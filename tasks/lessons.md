# Lessons

- When a workflow author supplies a provider-specific model reference as one string, preserve that exact string in workflow YAML. Do not reinterpret or split it into provider-internal routing fields unless the user explicitly requests that transformation. Let the selected provider own model-reference handling; use the E2E result to expose any provider contract defect.
- Do not infer that a missing provider API-key environment variable means the upstream harness is unauthenticated. Check subscription/OAuth/token-plan login state first. A provider adapter must not reject before launching an upstream harness that owns a valid ambient login flow.
- Before hard-coding an E2E model reference, confirm the exact requested model variant. If the user corrects it, rename the workflow and file too so test identity cannot drift from the model under test.

## 2026-09-26 — Scope is not limited to what a mockup draws

- Mistake: read "some features are not in the mockup, e.g. providers" as "providers are out of scope".
- Rule: a feature the mockup does not draw can still be in scope when it is configured elsewhere (for example, the provider is set in the node config). Before cutting scope from a user remark, confirm the direction ("do you mean skip X, or also build X?").

## 2026-09-26 — Verify merged UI in a real browser, not only the agent's screenshots

- Mistake: Phase A's own screenshots looked right, but after merge the run log column overflowed to ~6600px (flex child without `min-w-0`) and hid the fixed-width room.
- Rule: after each UI merge, open the real app at a common width and measure `scrollWidth` vs `innerWidth`; a "deep link does not open" report can be an off-screen layout bug.
