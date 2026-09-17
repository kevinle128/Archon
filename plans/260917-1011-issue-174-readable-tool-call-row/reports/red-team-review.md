# Red-team review

## Review setup

Three independent read-only reviews covered security and trust boundaries, assumptions and contracts, and failure modes and test adequacy.
The user-review prompt returned no selection, so the recommended evidence-backed changes were applied with the default workflow judgment.

## Accepted findings

| #   | Severity | Finding                                                                                              | Disposition                                                                                                          |
| --- | -------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Major    | The no-JSON wording incorrectly banned the contract's bounded `{…}` and `[n]` generic markers.       | The plan now bans raw serialized dumps and explicitly allows only the bounded markers.                               |
| 2   | Major    | Proxy and throwing-getter tests did not match the real schema-parsed JSON boundary.                  | The plan now tests unusual valid JSON values and leaves corrupt-row handling in the existing API path.               |
| 3   | Major    | Count-badge extraction had no explicit output bound or huge-output test.                             | Phase 1 now names a separate extraction cap and tests small, huge, and unloaded outputs.                             |
| 4   | Major    | The provider-specific glob path rule was not explicit.                                               | Phase 1 now tests Claude `{ pattern, path }` and OMP `{ path }` shapes and states the exact headline and scope rule. |
| 5   | Major    | A duration hidden under width pressure could become unreachable without a body bar.                  | Phase 2 now adds only a minimal open-row facts line and still defers family-specific bodies and Raw.                 |
| 6   | Blocker  | Existing HITL E2E specs required output to be visible before disclosure.                             | Both stale behavior specs become the outside-in red tests in Phase 1 and must turn green in Phase 2.                 |
| 7   | Major    | The static Legacy renderer test cannot prove rerender, toggle, or keyboard behavior.                 | Interactive cases move through the existing `LegacyNodeRoom.test.tsx` happy-dom harness.                             |
| 8   | Major    | Broad DOM text helpers could treat hidden diagnostic text as visible.                                | The plan requires summary-scoped assertions and separately checks that nested diagnostics are closed.                |
| 9   | Major    | Removing the shared context field made the Phase 2 rollback incomplete.                              | Phase 2 now owns the shared-history cleanup and defines one safe rollback unit across shared and renderer files.     |
| 10  | Minor    | Ratio and drag checks did not prove the required 460 px width.                                       | Phase 3 now requires a measured `460 ± 2` px helper before each narrow-layout assertion.                             |
| 11  | Major    | The old visual readiness locator could pass because a visible ancestor contained hidden output text. | Phase 3 updates that locator and keeps new issue captures in Playwright output instead of the old plan directory.    |

## Rejected findings

| Finding                                                                                | Reason for rejection                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new serialized live-region announcement system to Story 1.1.                     | Story 1.1 cites CAP-1, NFR1–3, and UX-DR1–2; the proposed shared steering announcement mechanism belongs to broader NFR8 and later delivery work.       |
| Implement grep body-arm selection for all output modes now.                            | Family-specific expanded bodies belong to Story 1.3; Story 1.1 needs only the bounded count badge case.                                                 |
| Add an HTML sanitizer for headline and chip content.                                   | Both target renderers use React text nodes and do not introduce HTML injection APIs.                                                                    |
| Treat the row-only presenter as invalid because the full contract also defines bodies. | The epic explicitly splits the row, Raw, and family-body work across Stories 1.1, 1.2, and 1.3.                                                         |
| Remove the temporary closed diagnostic disclosures.                                    | Keeping them closed preserves current diagnostic and full-output behavior without showing serialized data by default; Story 1.2 owns their replacement. |

## Result

No blocker remains after the accepted changes.
The implementation scope remains Story 1.1 only.
