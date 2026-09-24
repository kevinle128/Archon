---
name: claude-design-feature-extractor
description: Extract approved Claude Design mockups, compare them with the current product and completed Epics, and produce an evidence-backed manifest of changed features and unchanged context.
---

# Claude Design Feature Extractor

Create the product truth that downstream planning checks must use.

This skill first freezes what the approved mockups show.
It then compares that inventory with the current product and completed Epics to determine what the mockups add or change.

## Required input

Get the exact paths of every approved `.dc.html` file and each script that supplies product behavior.
Get a browser URL that renders those files.
If either input is missing, ask the user for it before extraction.

Discover the current implementation, tests, and completed Epic sources after the mockup-only inventory is frozen.
Do not ask the user to remember which controls changed.
Determine that from the approved mockup, current product behavior, and completed Epics.

Treat generic Claude Design runtime code, editor controls, and review scaffolding as tooling, not product behavior.
Confirm that distinction from the mockup source, the current product, and completed Epics.
Do not ask the user to identify the change boundary or remember which controls are existing product behavior.

Existing product UI can appear in a mockup only to provide screen context.
Do not treat unchanged context as a newly introduced feature.
Classify it as `UNCHANGED_CONTEXT` when current implementation or completed Epic evidence proves that the approved mockup does not change it.
Do not ask the user to restate existing behavior that can be discovered from the product or repository.

## Evidence boundary

Until `mockup_inventory` is complete and frozen, do not read or use these sources:

- PRD, Architecture, Epic, Story, or implementation files.
- README or handoff claims that tell planning documents to override the mockup.
- Issue, pull request, reconciliation, backlog, or historical decision text.

These sources can contaminate the mockup-side extraction with behavior that the mockup does not prove.

After `mockup_inventory` is frozen, read the current implementation, its tests, and completed Epics only to classify each inventory item as changed or unchanged.
Baseline evidence must never fill or repair a mockup behavior field.
Do not use open pull requests, future plans, reconciliation notes, or historical decision text to decide what the approved mockup currently shows.

Use only these evidence types:

- `rendered`: an exact rendered state and element.
- `interaction_code`: executable mockup code that handles the interaction or state change.
- `annotation`: an explicit annotation inside the approved mockup source.
- `user_answer`: an exact answer from the user.

Use `implementation` and `epic` evidence only in `classification_evidence` and the derived `change_boundary`.
Never use those evidence kinds inside a change feature's behavior signature.

A visible label, position, or enabled state proves only that visible fact.
It does not prove the action target, target count, timing, effect on active work, collection changes, result, or next state.

## Extraction workflow

1. Create a source fingerprint before analysis.

   ```bash
   python3 {skill-root}/scripts/validate-mockup-manifest.py fingerprint \
     --root {project-root} \
     <approved-mockup-file> [<behavior-script> ...]
   ```

   Copy the returned `sources` and `source_fingerprint` into the manifest.

2. Render every approved `.dc.html` file in a browser.

3. Exercise every product state, selector, toggle, expansion, control, and conditional branch that the mockup exposes.
   Record every reviewed state in `source_reviews`.

4. Read the executable interaction code in each `.dc.html` file.
   Use it to confirm behavior and to find states that are not visible in the initial render.

5. Freeze one `mockup_inventory` row for every visible product control, state, transition, and automatic behavior.
   Give each row a stable inventory ID and exact rendered evidence.
   Complete this inventory before reading current implementation or Epic files.

6. Discover and fingerprint the current implementation, relevant tests, and completed Epic sources.
   Record them in `comparison_sources` with `implementation` or `epic` kinds.

7. Compare every frozen inventory row with the current product and completed Epics.
   Use `CHANGE_FEATURE` when direct comparison evidence shows that the mockup adds or changes the item.
   Use `UNCHANGED_CONTEXT` when direct comparison evidence shows that the item already exists with the same visible and behavioral contract.
   Every inventory ID must be classified exactly once.
   Do not ask the user to classify changes or recall existing behavior.
   If evidence is incomplete, inspect more implementation, tests, rendered current-product states, or completed Epic text.

8. Create one feature row for each atomic `CHANGE_FEATURE` control, state, transition, or automatic behavior.
   Keep two controls as separate rows when their state, target, target count, timing, effect, result, or next state differs.
   Cite the inventory IDs and exact comparison evidence that prove the change.

9. Create one `unchanged_context` row for every visible product element classified as `UNCHANGED_CONTEXT`.
   Record the inventory IDs, exact element, state, current scope, reason, and comparison evidence that proves it is unchanged.
   Do not require or invent a complete behavior signature for unchanged context.

10. Fill each change-feature behavior field independently and attach exact mockup or user evidence to that field.
   Do not use one broad citation for the whole row.

11. Use the exact string `UNKNOWN` when direct mockup or user evidence does not prove a change-feature field.
   Mark the row `UNCLEAR` and ask the user one focused question immediately.
   Record the exact answer as `user_answer` evidence, then continue.

12. Set every product feature that is visible in an approved mockup to `CURRENT` scope, including unchanged context.
   Never label it future, deferred, post-version, optional, or out of scope unless the user explicitly changes the approved mockup first.

13. Group change-feature controls that have the same visible label or apparent user intent in `action_identity_groups`.
   Give those controls the same normalized `action_key`.
   Use `null` for a non-interactive state that has no user action.
   Compare their complete behavior signatures.
   If direct evidence does not prove whether they are separate approved actions or a contradiction, mark the group `UNCLEAR` and ask the user.

14. Derive `change_boundary` from the complete set of `CHANGE_FEATURE` rows and their comparison evidence.
   Do not ask the user to supply it from memory.

15. Save the JSON manifest outside the Claude Design source bundle.
    In a BMAD project, use `{planning_artifacts}/mockup-manifests/<target>.json` unless the project defines another location.

16. Validate the result.

    ```bash
    python3 {skill-root}/scripts/validate-mockup-manifest.py validate \
      --root {project-root} \
      --expected-target <target> \
      <manifest.json>
    ```

Do not start PRD, Architecture, Epic, Story, or implementation comparison until validation passes and no row or action group is `UNCLEAR`.

## Manifest contract

The first JSON block shows top-level placement only.
Use the complete row contracts below when creating a valid manifest.

Use this top-level shape:

```json
{
  "schema_version": 3,
  "target": "agent-node-room",
  "scope_policy": "ALL_VISIBLE_PRODUCT_FEATURES_ARE_CURRENT",
  "comparison_policy": "MOCKUP_VS_CURRENT_PRODUCT_AND_COMPLETED_EPICS",
  "change_boundary": {
    "description": "Queue steering controls differ from the current product and completed Epics.",
    "evidence": [
      {"kind": "implementation", "source": "packages/web/src/example.tsx#QueueItem", "detail": "The current queue item does not expose the approved action."},
      {"kind": "epic", "source": "_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#queue", "detail": "The completed Epic describes the previous queue behavior."}
    ]
  },
  "sources": [
    {"path": "claude-design/example.dc.html", "sha256": "<64 lowercase hex characters>"}
  ],
  "source_fingerprint": "<64 lowercase hex characters>",
  "source_reviews": [
    {
      "mockup_file": "claude-design/example.dc.html",
      "rendered_states": ["collapsed", "expanded"],
      "interaction_code_reviewed": true
    }
  ],
  "comparison_sources": [
    {"kind": "implementation", "path": "packages/web/src/example.tsx", "sha256": "<64 lowercase hex characters>"},
    {"kind": "epic", "path": "_bmad-output/planning-artifacts/epics-agent-node-room/epics.md", "sha256": "<64 lowercase hex characters>"}
  ],
  "mockup_inventory": [
    {
      "id": "I001",
      "mockup_file": "claude-design/example.dc.html",
      "rendered_state": "generating with one queued message",
      "control_or_state": "Per-item Send now button",
      "visible_evidence": [
        {"kind": "rendered", "source": "claude-design/example.dc.html#state=generating control=Send now", "detail": "The queued item shows Send now."}
      ]
    }
  ],
  "features": [],
  "unchanged_context": [],
  "action_identity_groups": []
}
```

Each feature must contain these keys:

```json
{
  "id": "M001",
  "mockup_file": "claude-design/example.dc.html",
  "rendered_state": "collapsed details panel",
  "control_or_state": "Details button",
  "inventory_ids": ["I001"],
  "action_key": "toggle-details",
  "scope": "CURRENT",
  "coverage_role": "CHANGE_FEATURE",
  "classification_evidence": [
    {"kind": "implementation", "source": "packages/web/src/example.tsx#DetailsPanel", "detail": "The current product lacks this approved transition."},
    {"kind": "epic", "source": "_bmad-output/planning-artifacts/epics-example/epics.md#completed-details", "detail": "The completed Epic defines the previous panel behavior without this transition."}
  ],
  "status": "PROVEN",
  "open_question": null,
  "signature": {
    "visible_presentation": {
      "value": "Details button beside the collapsed panel",
      "evidence": [{"kind": "rendered", "source": "claude-design/example.dc.html#state=collapsed control=Details", "detail": "The button is visible beside the panel."}]
    },
    "precondition": {
      "value": "the details panel is collapsed",
      "evidence": [{"kind": "rendered", "source": "claude-design/example.dc.html#state=collapsed", "detail": "The panel body is not visible."}]
    },
    "trigger": {
      "value": "the user selects Details",
      "evidence": [{"kind": "interaction_code", "source": "claude-design/example.dc.html#handler=onToggleDetails", "detail": "The button calls onToggleDetails."}]
    },
    "target_identity": {
      "value": "the adjacent details panel",
      "evidence": [{"kind": "interaction_code", "source": "claude-design/example.dc.html#handler=onToggleDetails", "detail": "The handler changes this panel state."}]
    },
    "target_cardinality": {
      "value": "one",
      "evidence": [{"kind": "interaction_code", "source": "claude-design/example.dc.html#handler=onToggleDetails", "detail": "The handler changes one panel state entry."}]
    },
    "timing": {
      "value": "immediate local transition",
      "evidence": [{"kind": "interaction_code", "source": "claude-design/example.dc.html#handler=onToggleDetails", "detail": "The handler updates local state directly."}]
    },
    "effect_on_active_work": {
      "value": "none",
      "evidence": [{"kind": "interaction_code", "source": "claude-design/example.dc.html#handler=onToggleDetails", "detail": "The handler only changes panel display state."}]
    },
    "collection_mutation": {
      "value": "none",
      "evidence": [{"kind": "interaction_code", "source": "claude-design/example.dc.html#handler=onToggleDetails", "detail": "The handler does not change a collection."}]
    },
    "expected_result": {
      "value": "the details body becomes visible",
      "evidence": [{"kind": "rendered", "source": "claude-design/example.dc.html#state=expanded", "detail": "The expanded render shows the details body."}]
    },
    "next_state": {
      "value": "the details panel is expanded",
      "evidence": [{"kind": "rendered", "source": "claude-design/example.dc.html#state=expanded", "detail": "The panel is expanded after the action."}]
    }
  }
}
```

Each unchanged-context row must contain these keys:

```json
{
  "id": "C001",
  "mockup_file": "claude-design/example.dc.html",
  "rendered_state": "node room shell",
  "control_or_state": "Graph navigation control",
  "inventory_ids": ["I002"],
  "scope": "CURRENT",
  "coverage_role": "UNCHANGED_CONTEXT",
  "reason": "The control is existing product navigation and is unchanged by this mockup.",
  "classification_evidence": [
    {"kind": "implementation", "source": "packages/web/src/example.tsx#GraphTab", "detail": "The current product already exposes the same Graph navigation control."},
    {"kind": "epic", "source": "_bmad-output/planning-artifacts/epics-example/epics.md#graph-navigation", "detail": "The completed Epic already defines the same Graph navigation control."}
  ]
}
```

Each evidence entry must contain `kind`, `source`, and `detail`.
For mockup evidence, format `source` as `<recorded-source-path>#<exact locator>`.
For a user answer, format `source` as `user_answer:<stable-id>` and put the exact answer in `detail`.
For classification evidence, format `source` as `<recorded-comparison-source-path>#<exact locator>`.
Every change boundary, change feature, and unchanged-context classification must cite at least one `implementation` source and one `epic` source.

A `PROVEN` row has direct evidence for every behavior field.
An `UNCLEAR` row has at least one `UNKNOWN` field and one focused `open_question`.

Each action identity group must contain `label_or_intent`, all feature IDs with that `action_key`, `outcome`, `differences`, `decision_evidence`, and `open_question`.
Each difference must name one behavior field, record that field's value for every grouped feature, and cite direct evidence.
Allowed outcomes are `SAME_ACTION`, `DISTINCT`, `CONFLICT`, and `UNCLEAR`.
Use `SAME_ACTION` only when all behavior fields match.
Use `DISTINCT` or `CONFLICT` only when direct mockup or user evidence proves that decision.

## Downstream handoff

Pass the validated manifest to PRD, Architecture, Epic, Story, and implementation-readiness workflows.
Those workflows must check the recorded source hashes before they use the manifest.
They must map every `CHANGE_FEATURE` row into the current PRD, Architecture, Epic, and Story scope.
They must preserve `UNCHANGED_CONTEXT` as current product context without requiring it to be re-specified as a new feature in the current change.
If a source hash changed, regenerate the manifest instead of repairing it from planning documents.
