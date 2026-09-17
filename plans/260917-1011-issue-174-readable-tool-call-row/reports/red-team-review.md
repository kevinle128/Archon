# Red-team review

## Material draft problems and corrections

| Severity | Draft problem                                                                                                                       | Correction                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Blocker  | Claimed no matching PR and an active alternate plan/run without current evidence                                                    | Recorded closed/unmerged PR #194, completed reported run, absent claimed path, and a fresh mutable-state preflight                      |
| Blocker  | Allowed `{…}` / `[n]` in the collapsed generic row despite the Story 1.1 no-serialized-punctuation criterion                        | Deferred object/array markers to Story 1.3's expanded generic body; collapsed generic uses scalar facts or safe label                   |
| Major    | Outcome precedence said direct result metadata beat the required adjacent interruption fold                                         | Made exact adjacent `interrupted` the final display override and added failed-plus-interrupted coverage                                 |
| Major    | Counted only two obsolete E2E cases                                                                                                 | Identified and planned all three across two specs                                                                                       |
| Major    | Required an unexplained-difference-free comparison with final mockups that contain later stories                                    | Limited comparison to Story 1.1-owned anatomy/states and named expected Raw/body/diff/todo/task/occurrence differences                  |
| Major    | Omitted Console inline history from regression coverage                                                                             | Added `ConsoleExecutionHistory.test.tsx` to inventory and gates                                                                         |
| Major    | Accessible-name requirements were incomplete                                                                                        | Specified state → tool/family → target → facts, hidden decoration, family channels, native key behavior, and two-OS announcement checks |
| Major    | Visual criteria retained old card depth and lacked exact focus/body geometry                                                        | Required transparent rest state, hover-only fill, body rail/indent/padding, and surface-specific focus offsets                          |
| Major    | Disclosure state did not fully cover keyboard toggles, programmatic toggle events, identity changes, or never-auto-close behavior   | Added a concrete touched-state transition contract and equivalent tests in both shells                                                  |
| Major    | Bounds were stated but not implementable                                                                                            | Added named numerical caps, bounded name/key/source/count operations, and limit/limit+1 tests                                           |
| Major    | A presenter-side headline cut would violate the design's full-DOM/CSS-elision rule                                                  | Ordinary accepted headlines stay complete; over-cap adversarial values fall back safely instead of fabricating a partial path           |
| Major    | Count extraction could scan or guess arbitrary output prose                                                                         | Limited it to capped scalar/shallow structured forms and omission on unsupported shapes; never load full output for a badge             |
| Major    | Precomputed presentation could leave a stale `truncated` badge after local full-output loading                                      | Both shells rerun the same pure row composer with loaded output and `outputState: full` while preserving disclosure state               |
| Major    | The draft did not preserve the canonical three-field `ToolPresentationInput` contract                                               | Kept canonical content input and added a separate typed row-facts composition function for current runtime facts                        |
| Major    | Existing transcript `gap-3`/`p-3` would keep card spacing even after the card markup changed                                        | Added 10 px/12 px transcript padding, compact adjacent tool rhythm, and explicit mixed-content spacing tests                            |
| Major    | Todo headline behavior was guessed from one complete-state mock                                                                     | Used the final design's folded-call `todo updated` plus bounded `op` badge; todo state/progress remains Story 1.5                       |
| Major    | The initial row model missed final state badges, the no-fact `—`, and running elapsed while current `outputState` would say missing | Added canonical per-state badge overrides and deterministic elapsed from existing `tool_called.created_at` plus caller clock; no timer  |
| Major    | Rollback proposed restoring obsolete desired E2E behavior                                                                           | Defined whole-feature code/test rollback without treating visible JSON as the forward contract                                          |
| Minor    | The draft treated the Console mock's width and complete body as direct Story 1.1 acceptance                                         | Used canonical 460 px and isolated later-story body differences                                                                         |

## Deliberate exclusions

- No new sanitizer: stored strings render only as React text nodes.
- No production-corpus release gate: Story 1.3 owns it.
- No family bodies, final Raw control, diff, todo state, task normalization, or occurrence grouping.
- No partial transcript/steering live-region mechanism: the serialized NFR8 channel is broader than Story 1.1 and is allocated to later steering stories. Static accessibility semantics remain mandatory here.
- No fake-provider expansion solely for visual states; deterministic production-markup component tests cover states absent from the real fixture.
- No shared React component or speculative provider-normalizer layer.

## Nine-perspective final audit

1. **Product:** The scope now maps exactly to scanning a tool call without JSON.
2. **Architecture:** One pure policy and two boundary-safe shells use the existing shared projection seam.
3. **Contracts:** Pairing, IDs, paging, full-output behavior, array return type, and non-tool ordering are preserved.
4. **Security/reliability/data:** Bounded JSON handling, text-node rendering, fail-safe generic fallback, and unchanged corrupt-row/API behavior are explicit.
5. **Performance:** All potentially wide/long presenter operations have named deterministic caps; no full-output fetch occurs for a summary.
6. **Completeness:** All direct consumers, the Console indirect mount, three stale behavior cases, and old visual false positive are covered.
7. **Testing:** Evidence is layered correctly across pure, projection, interactive component, real E2E, computed geometry, human visual, and AT checks.
8. **Operations:** No migration, feature flag, rollout order, or backend compatibility step is needed; rollback is Web-only and reversible.
9. **Maintainability:** Later stories remain deferred; no new dependency, token, component abstraction, or return-type widening is introduced.

## Result

No unresolved design or implementation blocker remains in the revised plan. Manual screen-reader and visual checks are completion gates for implementation, not assumptions that they already passed.
