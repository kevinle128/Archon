# Visual verification for UI tasks

Apply this procedure only when a task affects a graphical user interface.
This includes mixed tasks and changes to shared code or data that alter a visible state.
Record the classification and its evidence in the selection attempt.
A frontend directory alone does not make a backend task a UI task.

## Trace the design

Read the complete request and plan, then follow relevant references through the story, epic, specification, UX documents, and design handoff.
Follow Markdown links and metadata such as `inputDocuments`, `sources`, `companions`, and `mockup`.
Read linked handoff instructions and the files needed to render the selected reference.
The plan is an entry point, not the sole source of requirements.
When a link is absent, inspect the project's story IDs and design index; do not conclude that no mockup exists from the plan alone.

Resolve relative links from the document that declares them, including valid parent-directory links.
Keep canonical repository-relative paths where possible and a visited-source set to avoid cycles.
Retain the source chain, section or anchor, revision, and content hash for each applicable requirement and reference dependency.
For an external design, retain an immutable export or pinned revision with its content hash and source URL.
Do not rely on a mutable URL as the reference identity.

Read the declared precedence between contracts, UX documents, mockups, and current design-system tokens.
Record source-backed intentional differences from the mockup.
Do not let the implementation or an incomplete plan override a normative design requirement.
An unresolved conflict or an inaccessible referenced mockup is a coverage gap, not permission to skip comparison.
If discovery finds no mockup, state that limitation and seek agreement on an alternative design reference or explicit deferral.
Do not claim mockup conformance from text-only UI checks or use a screenshot of the implementation as its own accepted reference.

## Select the relevant scope

Map each in-scope visual requirement to a live behavior and executable scenario.
Inspect the verifier's runner configuration, not only its test title or impact paths.
If no scenario represents the requirement, stop the usable selection handoff and name the verifier upgrade needed.
Use a live coverage-gap ID when one exists; never invent catalog IDs or append visual fields to v1 selections.
Keep the source trace and mapping in the attempt for review, but execute only the registered, revision-bound configuration.
A loose sidecar note or proposal rationale must not supply unvalidated runtime configuration.

The runner configuration must identify:

- Canonical source chain and hashes, mockup page or frame, and applicable source precedence.
- Stable behavior and scenario IDs, product surface, route, and target region.
- Required states and the user steps or declared fixtures that reach each state.
- Viewport, container dimensions, device scale, zoom, theme, fonts, and relevant data conditions.
- Visual criteria with source citations, measurable expectations, and justified tolerances.
- Out-of-scope regions or future-story features, plus source-backed accepted differences.

Compare only the story's applicable regions and states, not every feature shown in a full-page mockup.
Keep browser viewport size separate from panel or component width.
For example, a 460 px panel requirement is not a 460 px browser requirement.
Cover normal, narrow, expanded, loading, error, and focus states when the applicable sources or changed behavior require them.
Do not impose the same fixed state list or viewport matrix on every task.

## Capture and compare

Run the actual product from the exact target checkout through its public user path.
Render the selected mockup with its required scripts, styles, fonts, and images; source HTML alone is not a visual reference.
Wait for the expected state and loaded assets, and reject blank or broken captures.
Use native browser or platform automation already supported by the project.
Retain a context image and a crop of the target region for both reference and implementation.
Record the actual geometry and capture conditions with each image.

Align the state, region, theme, zoom, and dimensions before comparison.
Use a pixel diff or overlay when the images are comparable.
When content differs, use side-by-side image review and geometry or computed-style measurements for layout, spacing, typography, icons, truncation, borders, and control placement.
Record why a pixel threshold is unsuitable and which assertions replace it.
Mask only declared dynamic regions; do not hide the UI under test or normalize away a defect.
Never use one arbitrary similarity percentage as the complete verdict.

The declared reviewer must actually inspect both images and the relevant comparison evidence.
The runner must invoke that reviewer through a supported adapter and validate its structured response before returning success.
Declare the reviewer dependency and setup in the generated skill.
An unavailable reviewer or a human review that has not finished is incomplete proof, not PASS.
Do not add an undocumented follow-up command or rely on the agent reading screenshots after `prove` has already passed.

## Evidence and verdict

Retain source provenance, reference and actual images, geometry, comparison output, and the structured review as result attachments.
Use the generated runner's native schema to validate the review; it is attachment content, not an extension to the v1 result schema.
Bind it to the current run, target HEAD, selection and catalog identities, visual configuration revision, scenario, and image hashes.
Diagnostic runs may have null selection provenance as allowed by v1, but cannot satisfy selection-mode proof.
Require exactly one outcome for each configured visual criterion and required state.
Reject missing, duplicate, extra, stale, or mismatched outcomes and changed image bytes.

Each mismatch must give the source citation, expected appearance, actual appearance, surface and state, image region, severity, and user reproduction steps.
List accepted differences and excluded scope separately from defects.
Every required visual mismatch makes the scenario nonpassing; severity describes impact, not a silent waiver.
Overall PASS requires complete passing functional and visual proof for the selected task.
Missing reference, failed rendering, absent captures, or missing review must report the verification blocker and keep the overall result nonpassing.
Do not repair product code, rewrite design authority, approve a new baseline, or remove a failing obligation during verification.
