# Reconcile — `imports/mockup-live-interaction.html`

The steering mockup the user reviewed and approved, checked claim by claim against the two spines after this update. Source: `plans/260912-1405-agent-steering/mockup-live-interaction.html`, copied here unchanged.

## Landed

| From the mock                                                         | Where it lives now                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Three-state flow: running → stopped → resumed                         | EXPERIENCE.md State Patterns (dock rows), `mockups/key-steering-dock.html`                                                                     |
| `Queue` / `Send now` reading from node state, reverting automatically | Component Patterns → Send control; Key Flow 4 step 7                                                                                           |
| `Stop node` in the node's chrome                                      | Component Patterns → Stop control — **placement changed, see Diverged**                                                                        |
| Draft box present only when non-empty, header word signals the mode   | Component Patterns → Draft box; DESIGN.md Components → Draft box                                                                               |
| Send delivers queue + the new message, in written order               | Component Patterns → Send control; Interaction Primitives                                                                                      |
| Three message states, `delivered` only where echoed                   | Component Patterns → Message status; Accessibility Floor → The dock                                                                            |
| Per-provider capability matrix                                        | Stayed in the spec (`provider-steering-matrix.md`). A capability table is contract, not experience — the spine cites it rather than copying it |
| "The real blocker is ours, not theirs"                                | Stayed in the spec (`SPEC.md` constraints, `engine-integration.md`). Architecture, not UX                                                      |

## Diverged — and why

**The stop control moved out of the panel header and onto the dock.** The mock drew it in the header, and the spec's prose followed the mock. Measuring the shipped header killed it: `NodeRoomHeader.tsx:58-95` is a `flex-wrap` row already carrying eight items at Legacy's 460px, so a control placed there wraps — and the control that stops an agent is the one that must never wrap. User settled it: one dock, stop at its left edge, send at its right.
_Upstream repair owed:_ `spec-live-agent-steering` still says "a stop control in the node's header" in SPEC.md CAP-2 and in `control-states.md`. Offered to the user.

**A `stopping` state was added that the mock does not have.** The mock flips running → stopped directly. That is not what the engine does: the stop reaches the node on a status poll of up to ten seconds (`dag-executor.ts:2304-2334`, interval `:682`), so an immediate flip would leave the interface wrong for most of that window. Rendered in `mockups/key-steering-dock.html`, column 2.

## Dropped, deliberately

| From the mock                                               | Why it did not land                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Phase 2 section (what changes when mid-turn delivery lands) | A roadmap, not an experience. Lives in `SPEC.md` CAP-5                   |
| "New versus existing" inventory                             | Planning scaffolding for the build, not a contract a renderer reads      |
| The mock's own panel width and chrome                       | Illustrative; the room contract owns both widths (Responsive & Platform) |

## Qualitative ideas surfaced but not adopted

From the aion research the mock was drawn against, two ideas were weighed and rejected here rather than silently lost:

- **Auto-send queue mode** — a pill that drains the queue automatically after each reply. Recorded as a non-goal in `SPEC.md`: every send stays operator-initiated.
- **Persist-before-deliver with a server-assigned id** — would buy crash safety and a consumed badge. The user chose browser state explicitly; the cost is recorded in `SPEC.md` constraints rather than treated as free.

## Nothing lost

Every load-bearing claim in the mock is either in a spine, in the spec it belongs to, or listed above with its reason. The mock itself is kept at `imports/` unchanged; where it disagrees with the spines, the spines win.
