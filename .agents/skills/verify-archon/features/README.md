# Archon feature map

Read the relevant feature before selecting or driving it.
Each recipe reaches the application through its public CLI, HTTP API, or browser UI.
The helper starts isolated resources and retains evidence for the selected recipe.

| Feature | User paths | Recipes |
| --- | --- | --- |
| [CLI discovery](install.md) | Version, help, workflow discovery, DAG validation | `install.health` |
| [Workflow control](workflow-cli.md) | Run, inspect, retry, approve, resume, reject, cancel | `workflow.execution`, `workflow.governance`, `workflow.invalid-input` |
| [HTTP lifecycle](http-api.md) | Projects, conversations, workflow definitions, Ask answer | `http.lifecycle` |
| [Workflow rooms](run-ui.md) | Console and Legacy rooms, tools, Ask, transcripts, queue | `ui.rooms`, `ui.tools`, `ui.ask`, `ui.transcript-display`, `ui.queue-guidance`, `ui.visual` |

Use `bun "$VERIFY_HELPER" prove --scenario ID --repo "$TARGET" --evidence-root "$EVIDENCE"` for one recipe.
Use the selector's selection file to run several behaviors together.
The JSON siblings configure the existing helper.
They do not require every changed source or evidence file to have a mapping.
