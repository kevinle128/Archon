# Node Types

## Table of Contents

- Common node fields
- Prompt nodes
- Command nodes
- Bash nodes
- Script nodes
- Loop nodes
- Route-loop nodes
- Approval nodes
- Plannotator gate nodes
- Cancel nodes
- Conditions and trigger rules
- Retry, hooks, MCP, skills, and agents

## Common Node Fields

Every node requires `id`.
Node IDs must match `[A-Za-z_][A-Za-z0-9_-]{0,63}`.
Node IDs must not be `__proto__`, `prototype`, or `constructor`.
Prefer lowercase kebab-case even though the schema allows more.

Each node must define exactly one action key:

- `prompt`
- `command`
- `bash`
- `script`
- `loop`
- `route_loop`
- `approval`
- `plannotator_gate`
- `cancel`

Common fields:

| Field          | Applies to                                | Notes                                                |
| -------------- | ----------------------------------------- | ---------------------------------------------------- |
| `depends_on`   | all nodes                                 | Array of upstream node IDs.                          |
| `when`         | most nodes except `route_loop`            | Conditional expression evaluated after dependencies. |
| `trigger_rule` | most nodes except `route_loop`            | Defaults to `all_success`.                           |
| `retry`        | most nodes except `loop` and `route_loop` | Retries transient or all errors.                     |
| `idle_timeout` | AI and loop nodes                         | Milliseconds without output before timeout handling, including embedded Plannotator prepare and rework calls. |
| `always_run`   | all nodes                                 | Opt out of resume skip caching.                      |
| `output_type`  | all nodes                                 | Writes typed sidecar artifact under run artifacts.   |

AI-oriented fields:

| Field             | Notes                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| `provider`        | Node-level provider override.                                                        |
| `model`           | Node-level model override.                                                           |
| `context`         | `fresh` or `shared`; `fresh` disables session inheritance and cross-run persistence. |
| `output_format`   | JSON Schema for structured output.                                                   |
| `allowed_tools`   | Tool allowlist; use `[]` for no tools.                                               |
| `denied_tools`    | Tool denylist.                                                                       |
| `mcp`             | Path to MCP JSON config.                                                             |
| `hooks`           | Static provider hook responses.                                                      |
| `skills`          | Skill names available to supporting providers.                                       |
| `agents`          | Inline sub-agent definitions for supporting providers.                               |
| `effort`          | Non-empty provider-specific string, passed through exactly.                          |
| `thinking`        | Claude-style thinking config.                                                        |
| `maxBudgetUsd`    | Claude cost cap.                                                                     |
| `systemPrompt`    | Non-empty system prompt string.                                                      |
| `fallbackModel`   | Claude fallback model.                                                               |
| `betas`           | Non-empty Claude beta header list.                                                   |
| `sandbox`         | Claude sandbox settings.                                                             |
| `persist_session` | Cross-run node session persistence for eligible AI nodes.                            |

AI-oriented fields on bash and script nodes are stripped or ignored.
AI-oriented fields on loop nodes are mostly ignored except `provider`, `model`, `pi`, and `effort`.

## Prompt Nodes

Use a prompt node for inline AI work.
Use it for classification, investigation, synthesis, code changes, PR creation, or report writing.

```yaml
- id: classify
  prompt: |
    Classify this request: $ARGUMENTS
  model: small
  allowed_tools: []
  output_format:
    type: object
    properties:
      kind:
        type: string
        enum: [bug, feature, question]
    required: [kind]
```

Prompt nodes can use every AI-oriented field.
Use `context: fresh` when the node must not inherit prior sequential AI context.

## Command Nodes

Use a command node when the prompt should live in `.archon/commands/<name>.md`.
The `command` value is a command name without `.md`.

```yaml
- id: implement
  command: archon-implement
  model: large
  depends_on: [plan]
  context: fresh
```

Command nodes use the same AI-oriented fields as prompt nodes.
Use command files for reusable, long, or independently validated prompts.

## Bash Nodes

Use a bash node for deterministic shell work with no AI call.
Stdout becomes `$nodeId.output`.
Stderr is surfaced as a warning.
Default timeout is 120000 ms.

```yaml
- id: inspect
  bash: |
    set -euo pipefail
    git status --short
  timeout: 60000
```

Use bash for simple git checks, package commands, file existence checks, and glue logic.
Avoid complex JSON transforms in bash.
Use a script node instead.

Do not double-quote `$node.output` references in bash bodies.
Archon injects those substitutions already quoted.

Correct:

```yaml
bash: |
  status=$classify.output.kind
  printf 'status=%s\n' "$status"
```

Risky:

```yaml
bash: |
  status="$classify.output.kind"
```

## Script Nodes

Use a script node for deterministic TypeScript, JavaScript, or Python.
Script nodes have no AI call.
Stdout becomes `$nodeId.output`.
Stderr is surfaced as a warning.
Default timeout is 120000 ms.

Required fields:

| Field     | Values                       |
| --------- | ---------------------------- |
| `script`  | Inline code or named script. |
| `runtime` | `bun` or `uv`.               |

Optional fields:

| Field     | Notes                                                                     |
| --------- | ------------------------------------------------------------------------- |
| `deps`    | Dependency list for `uv` inline or named Python scripts; ignored for Bun. |
| `timeout` | Positive timeout in milliseconds.                                         |

Inline Bun:

```yaml
- id: parse
  script: |
    const input = $classify.output;
    console.log(JSON.stringify({ kind: input.kind.toUpperCase() }));
  runtime: bun
```

Inline Python:

```yaml
- id: parse-python
  script: |
    import json
    data = json.loads("""$classify.output""")
    print(json.dumps({"kind": data["kind"].upper()}))
  runtime: uv
  deps: []
```

Named script:

```yaml
- id: summarize
  script: summarize-run
  runtime: bun
  timeout: 30000
```

Named scripts resolve from `.archon/scripts/` or `~/.archon/scripts/`.
The validator expects `runtime` to match the discovered script extension.

## Loop Nodes

Use a loop node when an AI task must repeat until it emits a completion signal or a deterministic bash check passes.
Loop nodes manage their own per-iteration AI sessions.
`retry` is not supported on loop nodes.

```yaml
- id: refine
  loop:
    prompt: |
      Improve the plan.
      Original request: $ARGUMENTS
      Previous output: $LOOP_PREV_OUTPUT
      User feedback: $LOOP_USER_INPUT
      Emit PLAN_READY only when complete.
    until: PLAN_READY
    max_iterations: 5
    fresh_context: false
```

Loop config fields:

| Field            | Required         | Meaning                                                  |
| ---------------- | ---------------- | -------------------------------------------------------- |
| `prompt`         | yes              | Prompt repeated each iteration.                          |
| `until`          | yes              | Completion signal string detected in AI output.          |
| `max_iterations` | yes              | Positive integer.                                        |
| `fresh_context`  | no               | Start each iteration fresh; defaults to false.           |
| `until_bash`     | no               | Bash command run after each iteration; exit 0 completes. |
| `interactive`    | no               | Pause between iterations for user input.                 |
| `gate_message`   | when interactive | Message shown at pause.                                  |

Interactive loop:

```yaml
- id: explore
  loop:
    prompt: |
      Discuss the request.
      Latest user input: $LOOP_USER_INPUT
      Emit READY_TO_PLAN only when the user explicitly says ready.
    until: READY_TO_PLAN
    max_iterations: 10
    interactive: true
    gate_message: 'Reply with more details or say ready.'
```

Set root `interactive: true` when using interactive loops from user-facing surfaces.

## Route-loop Nodes

Use `route_loop` for deterministic routing after a review or check node.
It chooses one of three target nodes: `positive`, `negative`, or `exhausted`.
It is a controller node, not an AI node.
It differs from `loop` because it reruns a DAG path rather than repeating one prompt.

Required structure:

```yaml
- id: review
  depends_on: [fix]
  prompt: |
    Review the fix and return JSON.
  output_format:
    type: object
    properties:
      result:
        type: string
        enum: [positive, negative]
    required: [result]

- id: review-router
  depends_on: [review]
  route_loop:
    from: review
    condition: "$review.output.result == 'positive'"
    max_iterations: 3
    routes:
      positive: done
      negative: fix
      exhausted: escalation
```

Route-loop config:

| Field                         | Required | Meaning                                                                 |
| ----------------------------- | -------- | ----------------------------------------------------------------------- |
| `depends_on`                  | yes      | Exactly one entry, and it must equal `route_loop.from`.                 |
| `route_loop.from`             | yes      | Source node whose latest completed output drives the route decision.    |
| `route_loop.condition`        | yes      | Condition expression evaluated against the source node output.          |
| `route_loop.max_iterations`   | no       | Integer from 1 through 100. Defaults to 10. Counts false decisions.     |
| `route_loop.routes.positive`  | yes      | Target activated when the condition evaluates true.                     |
| `route_loop.routes.negative`  | yes      | Target activated when the condition evaluates false and budget remains. |
| `route_loop.routes.exhausted` | yes      | Target activated when a false decision consumes the budget.             |

Route-loop validation rules:

- The route-loop node must declare exactly one `depends_on`.
- That dependency must equal `route_loop.from`.
- `route_loop.from` must reference an existing node.
- The `from` node must not declare `when`.
- All three route targets must exist.
- A route target must not be the route-loop node itself.
- `positive` and `exhausted` routes must be exit paths.
- `negative` can route back to the rerun path.
- If the negative rerun path has dependencies, they must be self-contained inside that path.
- `when`, `trigger_rule`, and `retry` are not supported on the route-loop node.
- `route_loop.condition` may only reference the `from` node.
- Field references in `condition` require the `from` node to declare `output_format.properties`.

Route-loop condition supports the same atom grammar as `when`.
Use field references for robust routing.
Whole-output conditions do not require `output_format`.
Field conditions require the source field to be declared.
If the condition cannot be parsed, or a referenced field is missing, the route-loop node fails instead of silently routing negative.

Outcome behavior:

- `positive` means the condition evaluated true. It activates `routes.positive` and resets only this route-loop node's negative counter.
- `negative` means the condition evaluated false and budget remains. It increments the negative counter, then activates `routes.negative`.
- `exhausted` means the condition evaluated false after the budget was consumed. It activates `routes.exhausted`.

With `max_iterations: 1`, the first false decision routes to `negative`.
The second consecutive false decision routes to `exhausted`.
Unselected route targets stay dormant and are not marked as skipped.

Every route decision emits a `node_routed` workflow event.
The route-loop node completes with JSON route metadata as `$review-router.output`, including `from`, `outcome`, `to`, redacted `condition`, `condition_result`, `negative_count`, `max_iterations`, `attempt`, and `execution_seq`.
The route-loop output never copies the source node output; read the source node directly when downstream work needs the latest review result.

Do not retry a route-loop controller directly.
Retry the source node named by `route_loop.from`:

```bash
archon workflow retry-node <run-id> review
```

Retrying the source lets the refreshed output flow through the controller again.
Resume preserves route-loop counters, route activations, attempts, and execution sequence metadata.

In the Web Builder, the single input edge writes both `depends_on[0]` and `route_loop.from`.
The three output handles write `routes.positive`, `routes.negative`, and `routes.exhausted`.
Route edges are controller outcomes, not normal dependency edges, and do not make unselected branches run.

## Approval Nodes

Use approval nodes for human-in-the-loop gates.
Approval nodes pause the workflow.
On approval, the node completes and later nodes can continue.

```yaml
- id: approve-plan
  approval:
    message: |
      Review the generated plan:
      $plan.output
    capture_response: true
  depends_on: [plan]
```

Approval config:

| Field                    | Meaning                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `message`                | Required non-empty message shown to the user.                   |
| `capture_response`       | When true, approval text becomes node output.                   |
| `on_reject.prompt`       | AI prompt to run after rejection before showing the gate again. |
| `on_reject.max_attempts` | Integer 1 through 10; defaults to 3.                            |

Rejection prompt example:

```yaml
approval:
  message: 'Approve the plan.'
  capture_response: true
  on_reject:
    prompt: |
      The reviewer rejected the plan for this reason:
      $REJECTION_REASON
      Revise the plan and summarize changes.
    max_attempts: 3
```

Set root `interactive: true` when using approval nodes from user-facing surfaces.

## Plannotator Gate Nodes

Use `plannotator_gate` when a human must review a real HTML or Markdown document in a live local Plannotator annotate session.
This is different from a normal `approval` node because the gate owns the annotate subprocess, supports annotation-driven AI rework, and reopens the updated document until it is approved.

```yaml
- id: build-review-document
  bash: |
    set -euo pipefail
    review_file="$ARTIFACTS_DIR/review.html"
    printf '%s\n' '<!doctype html><html><body><h1>Review me</h1></body></html>' > "$review_file"
    printf '%s\n' "$review_file"

- id: review-document
  depends_on: [build-review-document]
  plannotator_gate:
    document: "$build-review-document.output"
    message: |
      Review the document in Plannotator.
      Approve it or send annotations for one rework pass.
    capture_response: true
    rework:
      provider: codex
      model: gpt-5.6-terra
      effort: medium
      prompt: |
        Update the HTML document at $REVIEW_DOCUMENT to address these annotations:
        $REVIEW_ANNOTATIONS

        Keep the file as readable HTML under its current path.
        Print exactly the absolute HTML path on one line and no other text.
```

Plannotator gate config:

| Field                           | Required | Meaning                                                                                         |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `document`                      | one mode | Existing HTML or Markdown path, or a `$node.output` reference that resolves to one path line. |
| `prepare`                       | one mode | Fresh embedded AI call that creates or selects the initial review document.                  |
| `prepare.prompt`                | yes      | Initial-document prompt.                                                                        |
| `prepare.provider`              | no       | Provider override for preparation; otherwise the workflow provider is used.                     |
| `prepare.model`                 | no       | Model override passed to the preparation provider.                                              |
| `prepare.effort`                | no       | Provider-specific effort override for preparation.                                              |
| `prepare.allowed_tools`         | no       | Tool allowlist for preparation.                                                                 |
| `prepare.denied_tools`          | no       | Tool denylist for preparation.                                                                  |
| `message`                       | no       | User-facing review instructions shown by the workflow surface.                                  |
| `capture_response`              | no       | When true, the approval feedback becomes the gate node output.                                  |
| `rework.prompt`                 | yes      | AI prompt used after the reviewer sends annotations.                                            |
| `rework.provider`               | no       | Provider override for rework; otherwise the workflow provider is used.                          |
| `rework.model`                  | no       | Model override passed to the rework provider.                                                   |
| `rework.effort`                 | no       | Provider-specific effort override for rework.                                                   |

The gate requires exactly one initial mode: `document` or `prepare`.
`prepare` accepts only `prompt`, `provider`, `model`, `effort`, `allowed_tools`, and `denied_tools`.
Use `document` when a prior node has already produced an HTML or Markdown document.
Use `prepare` when the gate should create or select its initial review document.

Document boundary rules:

- After output substitution, `document` must contain exactly one non-empty line.
- Relative paths resolve from the workflow `cwd`.
- The real path must remain inside the real workflow `cwd` or the existing `$ARTIFACTS_DIR`, including after symlink resolution.
- The target must be a readable regular file ending in `.html`, `.htm`, or `.md`.
- Every prepare or rework response must also print exactly one valid review-document path line and no prose or Markdown fence.
- Put rework provider, model, and effort inside `plannotator_gate.rework`; node-level AI fields do not configure the rework call.

Runtime lifecycle:

1. Archon checks the local `plannotator` binary with `plannotator annotate --help` and requires both `--persist-session` and `--result-file`.
2. For a fresh gate, Archon runs `prepare` only after this capability preflight; a matching unresolved persisted review document is reused by resume or `review-open` instead of preparing again.
3. The gate pauses the persisted workflow with a unique `gateId`, opens the annotate subprocess, and remains the sole live supervisor.
4. `Approve` in Plannotator records the decision, resumes the same supervisor once, and allows downstream nodes to run once.
5. `Send Annotations` runs the configured rework provider, validates its returned document path, and opens another annotate attempt under the same gate owner.
6. An approval from Web UI, CLI, Slack, or another external surface records the decision only; the existing live Plannotator supervisor owns continuation and prevents a second executor.
7. Closing or dismissing the annotate window leaves the run paused and idle instead of implicitly approving it.
8. `archon workflow review-open <run-id>` is explicit crash recovery: it atomically rotates ownership and starts a replacement supervisor in human CLI mode.
9. `archon workflow review-open <run-id> --json` records the takeover but requires a separate `archon workflow resume <run-id>` call because JSON mode never streams continuation inline.
10. Cancellation, abandonment, or takeover terminates the stale child, and a stale supervisor must not emit completion or run downstream work.

Set workflow-root `interactive: true` for Web UI or chat runs so the pause and review instructions remain foreground-visible.
The Plannotator binary runs on the Archon server host, so the browser and server must share access to that local review surface.
Use `PLANNOTATOR_BIN` only when the compatible binary is not discoverable as `plannotator` on the server `PATH`.

## Cancel Nodes

Use cancel nodes to terminate the workflow with a reason.
The reason supports `$node.output` substitution.

```yaml
- id: abort-if-invalid
  cancel: |
    Preconditions failed.
    Details: $preflight.output
  depends_on: [preflight]
  when: '$preflight.output.ok == false'
```

Cancel nodes can use `depends_on`, `when`, `trigger_rule`, and `retry`.
They do not call an AI provider.

## Conditions and Trigger Rules

`when` expressions support:

- `$node.output == 'text'`
- `$node.output.field == 'value'`
- `$node.field == 'value'` as shorthand for `$node.output.field`
- `==`, `!=`, `<`, `<=`, `>`, `>=`
- quoted string right-hand values
- unquoted numeric and boolean right-hand values
- `&&` and `||` without parentheses

Malformed `when` expressions fail closed and skip the node.
Unresolvable field references throw and fail the consuming node.

Trigger rules:

| Rule                          | Runs when                                      |
| ----------------------------- | ---------------------------------------------- |
| `all_success`                 | All dependencies completed.                    |
| `one_success`                 | At least one dependency completed.             |
| `none_failed_min_one_success` | At least one completed and none failed.        |
| `all_done`                    | Dependencies are no longer pending or running. |

Use `all_done` for cleanup, reporting, and final summaries that must run after failures or skips.

## Retry, Hooks, MCP, Skills, and Agents

Retry config:

```yaml
retry:
  max_attempts: 2
  delay_ms: 5000
  on_error: transient
```

`max_attempts` is 1 through 5 and does not include the initial attempt.
`delay_ms` is 1000 through 60000.
`on_error` is `transient` or `all`.
Fatal errors are not retried.

Hooks are keyed by provider hook event name:

```yaml
hooks:
  PreToolUse:
    - matcher: 'Bash'
      response:
        hookSpecificOutput:
          hookEventName: PreToolUse
          permissionDecision: deny
          permissionDecisionReason: 'No shell access here'
```

Supported hook event keys include `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, and `InstructionsLoaded`.

MCP config:

```yaml
mcp: .archon/mcp/github.json
```

The file must exist and be valid JSON object.

Skills:

```yaml
skills:
  - bmad-code-review
```

Archon validates skill names against `.claude/skills/<name>/SKILL.md` and `~/.claude/skills/<name>/SKILL.md`.

Inline agents:

```yaml
agents:
  brief-gen:
    description: 'Create a concise issue brief.'
    prompt: 'Return JSON only.'
    model: haiku
    tools: [Bash, Read]
    skills: []
    maxTurns: 3
```

Agent IDs must be kebab-case with lowercase letters, digits, and hyphens.
Each agent requires `description` and `prompt`.
Avoid using `dag-node-skills` as an agent ID because Archon reserves it for the skills wrapper.
