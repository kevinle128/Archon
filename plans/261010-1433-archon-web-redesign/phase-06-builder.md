# Phase 06: Builder

Status: pending. Depends on: 02. Effort: 2d. Can run in parallel with 03, 04, 05, 07.

## Context

- Spec: README "Screens > 4. Builder". Behavior: `Archon Builder.dc.html` `renderVals()` (`load` as `<name>-copy`, `add` to selected step + 1, `errs`, `cols`, `tiers`, `moveLeft`/`moveRight`, `yaml`, notice kinds ok/err/saved).
- Today (`routes/WorkflowBuilderPage.tsx` -> `components/workflows/WorkflowBuilder.tsx`, 670 lines): React Flow canvas `WorkflowCanvas.tsx` (598 lines, free edges, minimap, controls), `NodeInspector.tsx` (948 lines: Node ID, Type, Command, Prompt, Shell Script, Timeout, route Condition / Max Iterations / outcome routes, gate payload, Dependencies, When Condition, Provider, Model, Context, Trigger Rule, Idle Timeout, retry Max Attempts / Delay / On Error, tool Mode / Presets / Allowed / Denied, Output Format, Skills, MCP Config Path, Hooks, "Delete node"), `NodeLibrary.tsx` (kinds command, prompt, bash "Shell", route_loop "Route"), `NodePalette.tsx`, `CommandPicker.tsx`, `QuickAddPicker.tsx`, `BuilderToolbar.tsx` (uses `ProjectContext` for the save target), `ValidationPanel.tsx`, `YamlCodeView.tsx`, `DagNodeComponent.tsx`. `?edit=<name>` loads a saved workflow (`searchParams.get('edit')`).
- Logic to reuse: `useBuilderValidation(workflowName, workflowDescription, nodes, edges)` + `getDebouncedIssues`, `useBuilderUndo()` (`pushSnapshot`, `undo`, `redo`), `useBuilderKeyboard` (mod+s save, mod+z / mod+shift+z, `\`, `j`, `.`, `d`, `0`, `a`, single keys `n` `p` `b` `Delete`), `serializeWorkflowToYaml` in `lib/workflow-yaml.ts`, `computeTopologicalLayers`, `hasCycle`, `dagNodesToReactFlow`, `resolveNodeDisplay` in `lib/dag-layout.ts`; server `validateWorkflow`, `saveWorkflow`.
- `lib/dag-layout.ts` `resolveNodeDisplay` reads loop, approval, plannotator_gate, cancel nodes; `NodeInspector` edits command, prompt, bash, route_loop and shows plannotator_gate/cancel read-only. The builder cannot create loop or approval nodes today; `WorkflowCanvas.tsx` keeps loaded `loop`, `loop_group`, `approval`, `script`, `include`, `workflow`, `plannotator_gate`, `cancel` nodes verbatim and read-only (`READ_ONLY_WIRE_KEYS`). Keep that preservation in both canvas views.
- Model tiers: `GET /api/config` returns `tiers`, `tierDefaults`, `aliases` (resolve "Resolves to <model>").

## Requirements

1. Columns `minmax(220px,260px) | 1fr | minmax(300px,380px)`.
2. Left: "Start from" select: "Blank workflow" or any workflow from `listWorkflows`; loading one sets name `<name>-copy` and keeps all node fields. `?edit=<name>` still edits a workflow in place (name not suffixed). "Add node" palette rows (code, label, description, "+" accent) for every kind the builder can author today (Command, Prompt, Bash, Route). Loop and Approval rows are left out (locked decision 4). Hint "Adds to the step after <selected>." / "Adds a new step at the end."
3. Toolbar: name input (Archivo 800 20px; spaces become hyphens), stats "N nodes · N steps · N errors" (failed tone when errors), "Validate" (runs `validateWorkflow`, shows result in the notice), primary "Save" / "Saved" (blocked with error notice when `useBuilderValidation` reports errors). Keep undo/redo buttons and all `useBuilderKeyboard` shortcuts. Notice bar under the toolbar: info (selection bg, accent), error (`--tint-error`, failed), saved (`--tint-success`, done). `ValidationPanel` issues list under the notice; clicking an issue selects its node.
4. Canvas, two views (segmented "Steps | Graph"):
   - Steps (default, prototype): horizontal step columns 220px, 2px text-color top rule, surface bg (empty step `--tint-error`), "STEP 01" + "Parallel · N", "→" 36px gutters. Steps come from the real edges (`node-steps.ts`, phase 01). Node card: white, 1px strong border (selected 2px accent + selection bg), kind code + tier, id 13px/700, "conditional" in waiting tone when `when` is set.
   - Graph: the existing `WorkflowCanvas` (React Flow, free edge drawing, minimap, controls), restyled. Edge editing stays here.
5. Inspector / YAML tabs. Inspector shows the prototype fields first: kind; ID (mono, editable); Step with ← / → ; Depends on (explicit multi-select of node ids; shows "Nothing, runs first" when empty); Model tier segmented small/medium/large + "Custom" (keeps today's free model/alias input) and "Resolves to <model>" from config; body field labelled by kind (Command file / Prompt / Script / Route settings); "Run only when" (`when`). All other current fields move under a collapsible "Advanced" section unchanged. "Delete node" (danger outline). YAML tab: `serializeWorkflowToYaml` output in a code block + path `.archon/workflows/<name>.yaml`.
6. Step ← / →: per locked decision 4 = set the node's `depends_on` to all nodes of the step before the target step, push an undo snapshot, and show the new list in "Depends on". No implicit edge rewrite on load or save.
7. Save target: the filter project (`?cwd` of the selected codebase). With "All projects", Save asks the user to pick a project (inline select in the notice), as `BuilderToolbar` does today.

## Kept features (new home)

| Feature                                                                                                                | New home                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| React Flow canvas, edge drawing, minimap, controls                                                                     | Canvas "Graph" view                      |
| Advanced inspector fields (provider, context, trigger rule, retry, tools, output format, skills, MCP, hooks, timeouts) | Inspector "Advanced" section             |
| Undo/redo, keyboard shortcuts                                                                                          | Toolbar + `useBuilderKeyboard`           |
| Validation panel                                                                                                       | Under the notice bar                     |
| Command picker, quick add                                                                                              | Palette Command row and canvas quick add |
| `?edit=<name>`                                                                                                         | Unchanged                                |

## Files

Create: `src/components/builder/BuilderPalette.tsx`, `BuilderHeader.tsx`, `StepCanvas.tsx`, `StepNodeCard.tsx`, `BuilderInspectorTabs.tsx`, `TierPicker.tsx`; `src/lib/builder/step-moves.ts` (pure: move node to step k, returns new edges), `src/lib/builder/queries.ts` (tier resolution from config); tests beside each.

Modify: `src/routes/WorkflowBuilderPage.tsx`; `src/components/workflows/WorkflowBuilder.tsx`, `WorkflowCanvas.tsx`, `NodeInspector.tsx`, `NodeLibrary.tsx`, `NodePalette.tsx`, `CommandPicker.tsx`, `QuickAddPicker.tsx`, `BuilderToolbar.tsx`, `ValidationPanel.tsx`, `YamlCodeView.tsx`, `DagNodeComponent.tsx` (restyle, and split prototype fields vs "Advanced" in `NodeInspector`). These files are not touched by phase 03.

## Steps

1. Add `step-moves.ts` with tests (move left/right, first step, empty step error, undo snapshot shape).
2. Build Steps view on top of the same `nodes`/`edges` state that `WorkflowCanvas` uses, so both views edit one model.
3. Restyle toolbar, palette, inspector, YAML.
4. Round-trip check: open three bundled workflows with `?edit=`, switch views, save as copy, diff YAML against the source: only intended changes.

## Tests

- Add: `step-moves.test.ts`, `StepCanvas.test.tsx` (columns, parallel label, empty step tint, select), `TierPicker.test.tsx` (tier -> model text, custom keeps literal), `BuilderPalette.test.tsx` (adds to selected step + 1).
- Keep: `useBuilderValidation.test.ts`, `useBuilderKeyboard.test.ts`, `dag-layout.test.ts`, `WorkflowCanvas.test.ts`, `DagNodeComponent.test.ts`.
- e2e: `workflow-transcript-display.spec.ts` expects `.react-flow`, `.react-flow__minimap`, `.react-flow__controls` on `/workflows/builder?edit=…`. Update: click the "Graph" segment first (or make Graph the default when `?edit=` is present if decision 2 says so).

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, round-trip check above, `npx playwright test -c e2e/playwright.config.ts ui/workflow-transcript-display.spec.ts`.

## Risks

| Risk                                      | L x I       | Mitigation                                                                          |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Step moves corrupt real dependency graphs | High x High | Explicit deps; moves only on user click; round-trip diff check; locked decision 4.  |
| Two canvas views drift                    | Med x Med   | One `nodes`/`edges` state; views are renderers only.                                |
| Inspector field loss during the split     | Med x High  | Move JSX blocks, do not rewrite them; checklist of the 30 `Field` labels in the PR. |

## Rollback

Revert the PR; the old builder returns.
