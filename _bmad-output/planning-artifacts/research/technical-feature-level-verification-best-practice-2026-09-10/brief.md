---
topic: 'Feature-level verification best practices for real user journeys and fail-closed quality gates'
type: technical
decision: 'How should Archon design feature-level verification and its pre-merge gate so tests prove real behavior rather than shallow rendering or smoke paths?'
shape: explore
topology: breadth-first
preset: standard
validation: normal
approved: 2026-09-10
---

# Research brief

## Decision

Determine a practical, general verification model for current and future Archon features. HITL is the motivating example, not the scope boundary.

## Dimensions

1. Risk-based feature coverage: how teams decide which journeys, behavior partitions, and test layers are required without creating an exhaustive Cartesian product.
2. Requirements-to-test traceability and quality gates: how changed behavior maps to executable scenarios, how uncovered behavior is surfaced, and when a gate should fail closed.
3. Real-user browser E2E: how Playwright and other authoritative guidance define user-facing actions, real application boundaries, persistence/state assertions, isolation, retries, traces, and flaky-test controls.

## Questions

- What is a feature-level test expected to prove beyond rendering?
- How should teams combine unit, integration, API, and browser tests around a user-visible feature?
- How can a selector map a diff or requirement to precise executable scenarios rather than coarse feature labels?
- What evidence should an interactive, stateful feature produce before merge?
- Which boundaries may be mocked, and which application paths must remain real?
- How should risk, identities, entry points, state transitions, concurrency, and separate UI implementations influence scenario selection?
- How do mature practices avoid both shallow smoke tests and an unmanageable combinatorial matrix?

## Source policy

Prefer primary and official sources: Playwright documentation, Google Testing Blog, Martin Fowler, Microsoft/GitHub engineering documentation, ISTQB where directly useful, and authoritative testing literature. Use secondary sources only for concrete production experience or contrary evidence. Every recommendation must trace to a retrieved source.

## Deliverable

A cited recommendation applied to Archon's `select-verify-archon-targets` and `verify-archon` workflow. No product or test implementation is included.
