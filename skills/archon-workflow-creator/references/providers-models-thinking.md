# Providers, Models, and Thinking

## Table of Contents

- Provider IDs
- Provider capabilities
- Config locations
- Model references
- Built-in tier defaults
- Provider-specific model and thinking guidance
- Tool and structured-output guidance

## Provider IDs

Common registered provider IDs in this Archon version:

- `claude`
- `codex`
- `opencode`
- `pi`
- `copilot`
- `qodercli`
- `omp`

Provider identity is validated at workflow load time.
Model strings are not validated by Archon and pass through to provider SDKs.
Always run local validation because community providers can change.

## Provider Capabilities

| Provider   | Session resume | MCP | Hooks | Skills               | Agents | Tool restrictions | Structured output | Effort or thinking                      |
| ---------- | -------------- | --- | ----- | -------------------- | ------ | ----------------- | ----------------- | --------------------------------------- |
| `claude`   | yes            | yes | yes   | yes                  | yes    | yes               | enforced          | yes                                     |
| `codex`    | yes            | yes | no    | filesystem discovery | no     | no                | enforced          | through assistant config or tier preset |
| `opencode` | yes            | yes | no    | yes                  | yes    | yes               | enforced          | use OpenCode agent config               |
| `pi`       | yes            | no  | no    | yes                  | no     | yes               | best-effort       | yes                                     |
| `copilot`  | yes            | yes | no    | yes                  | yes    | yes               | best-effort       | yes                                     |
| `qodercli` | yes            | yes | no    | no                   | no     | yes               | best-effort       | yes                                     |
| `omp`      | yes            | no  | no    | filtered discovery   | no     | no                | best-effort       | yes                                     |

The DAG executor sends user-visible warnings when a node sets fields unsupported by the resolved provider.
Treat those warnings as authoring failures unless the ignored behavior is intentional.

## Config Locations

Repo config lives in `.archon/config.yaml`.
Global config lives in `~/.archon/config.yaml`.
Per-user AI preferences can override tiers, aliases, and default provider when enabled.

Typical config:

```yaml
defaultAssistant: claude

assistants:
  claude:
    model: sonnet
    settingSources: [project, user]
  codex:
    model: gpt-5.5
    modelReasoningEffort: high
    webSearchMode: disabled
    additionalDirectories:
      - /absolute/path/to/other/repo
  pi:
    model: anthropic/claude-sonnet-4-6
    maxConcurrent: 2
  opencode:
    model: anthropic/claude-sonnet-4-6
    baseUrl: http://127.0.0.1:4096
    opencode:
      agent: build
  copilot:
    model: gpt-5
    modelReasoningEffort: high
  omp:
    model: openai-codex/gpt-6-sol
    modelReasoningEffort: high
    enableExtensions: false

tiers:
  large: { provider: claude, model: opus }
  medium: { provider: codex, model: gpt-5.5, effort: high }
  small: { provider: pi, model: anthropic/claude-haiku-4-5 }

aliases:
  '@cheap-review': { provider: codex, model: gpt-5-mini, effort: low }
  '@deep-plan': { provider: claude, model: opus, effort: max, thinking: adaptive }
```

Custom alias names must start with `@`.
Alias names `small`, `medium`, and `large` are reserved tier names and must not be used as custom aliases.

## Model References

Workflow and node `model:` accepts:

| Form    | Example               | Meaning                                         |
| ------- | --------------------- | ----------------------------------------------- |
| tier    | `small`               | Resolve through tier defaults and config tiers. |
| alias   | `@deep-plan`          | Resolve through config aliases.                 |
| literal | `sonnet` or `gpt-5.5` | Pass directly to resolved provider.             |

Tier and alias entries include `provider` and `model`.
They can change the effective provider even when `provider:` is set elsewhere.
If that happens, Archon warns and uses the model preset provider.

Tier fallback:

| Requested | Fallback order             |
| --------- | -------------------------- |
| `large`   | `large`, `medium`, `small` |
| `medium`  | `medium`, `large`, `small` |
| `small`   | `small`, `medium`, `large` |

Bundled and global workflows should not depend on `@custom` aliases.
Project workflows can use aliases because the project controls `.archon/config.yaml`.

## Built-in Tier Defaults

Built-in defaults by default provider:

| Default provider | small                         | medium                        | large                       |
| ---------------- | ----------------------------- | ----------------------------- | --------------------------- |
| `claude`         | `haiku`                       | `sonnet`                      | `opus`                      |
| `codex`          | `gpt-5.5` with minimal effort | `gpt-5.5` with medium effort  | `gpt-5.5` with high effort  |
| `pi`             | `anthropic/claude-haiku-4-5`  | `anthropic/claude-sonnet-4-6` | `anthropic/claude-opus-4-7` |
| `copilot`        | `gpt-5-mini`                  | `gpt-5`                       | `claude-sonnet-4.5`         |
| `opencode`       | `anthropic/claude-haiku-4-5`  | `anthropic/claude-sonnet-4-6` | `anthropic/claude-opus-4-7` |

Override tiers in config when the install uses different model names.

## Claude

Use Claude for workflows that need the broadest Archon feature support.
Claude supports MCP, hooks, skills, inline agents, tool restrictions, structured output, env injection, cost control, fallback model, sandbox, and native tools.

Workflow or node examples:

```yaml
provider: claude
model: sonnet
effort: high
thinking: adaptive
```

Common Claude effort examples:

- `low`
- `medium`
- `high`
- `max`

Claude thinking forms:

```yaml
thinking: adaptive
```

```yaml
thinking: enabled
```

```yaml
thinking: disabled
```

```yaml
thinking:
  type: enabled
  budgetTokens: 8000
```

Sandbox example:

```yaml
sandbox:
  enabled: true
  network:
    allowedDomains: [api.github.com]
  filesystem:
    allowWrite: ['$ARTIFACTS_DIR']
```

Use `fallbackModel` only with Claude-capable paths.

## Codex

Use Codex for OpenAI-backed coding workflows.
Codex supports session resume, MCP, filesystem-discovered skills, env injection, enforced structured output, and raw `effort` passthrough.
Codex does not support `thinking`, `fallbackModel`, `sandbox`, `hooks`, inline agents, or tool restrictions.

Configure Codex reasoning through assistant config:

```yaml
assistants:
  codex:
    model: gpt-5.5
    modelReasoningEffort: xhigh
    webSearchMode: disabled
```

Workflow, node, tier, and alias presets can use `effort`:

```yaml
tiers:
  large: { provider: codex, model: gpt-5.5, effort: high }
```

Then use the tier from workflow YAML:

```yaml
provider: codex
model: large

nodes:
  - id: deep-review
    prompt: 'Review the implementation.'
    effort: xhigh
```

Common Codex reasoning examples:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

`webSearchMode` values:

- `disabled`
- `cached`
- `live`

The workflow schema accepts root `modelReasoningEffort` as a legacy fallback and `webSearchMode`.
There is no per-node `modelReasoningEffort` field; use node `effort` instead.

Migration rule:

- In a Codex-only workflow, set root `effort: xhigh` so inheriting AI nodes receive it.
- In a mixed-provider workflow, set `effort: xhigh` only on Codex AI nodes.
- Remove root `modelReasoningEffort` from mixed-provider workflows because it is a provider-neutral legacy fallback and can be inherited by non-Codex nodes.

## Pi

Use Pi for community multi-backend models.
Model refs use `<pi-provider-id>/<model-id>`, such as `google/gemini-2.5-pro` or `anthropic/claude-haiku-4-5`.

Pi supports session resume, skills, tool restrictions, env injection, best-effort structured output, native tools, effort, and thinking control.
Pi does not support MCP, hooks, inline agents, fallback model, or sandbox.

Use YAML `effort` for Pi thinking level:

```yaml
provider: pi
model: anthropic/claude-sonnet-4-6

nodes:
  - id: analyze
    prompt: 'Analyze $ARGUMENTS'
    effort: high
```

Archon passes `effort` exactly to Pi's SDK reasoning field. Do not rely on Archon translating `max` to `xhigh`; use the exact Pi value you intend.
Do not use Claude object-form `thinking` with Pi.

Optional Pi assistant config:

```yaml
assistants:
  pi:
    model: google/gemini-2.5-pro
    enableExtensions: false
    interactive: false
    maxConcurrent: 2
    env:
      PLANNOTATOR_REMOTE: '1'
```

Only enable extensions for trusted repos because extension discovery can load code from the workflow cwd.

## Qoder CLI

Qoder CLI accepts raw workflow/node/tier/alias `effort` through its `--reasoning-effort` flag. Archon does not translate or allow-list the value.

```yaml
provider: qodercli
model: qoder-pro
effort: max
```

Qoder CLI 1.0.x documents `low`, `medium`, `high`, and `max`; use `max` for its highest reasoning level. Do not use Codex's `xhigh` value for Qoder.

`assistants.qodercli.modelReasoningEffort` remains a legacy provider default when no more specific effort is set.

## OMP CLI

Use OMP for a user-installed CLI that owns its authentication, model setup, and persisted sessions.
Set `provider: omp` and pass a provider-owned model reference through unchanged.
Archon passes raw `effort` and string `thinking` values, including `off` and `auto`, to OMP's `--thinking` flag.
OMP resumes persisted sessions when Archon supplies a session ID.
Per-node `skills` filters OMP skill discovery through `--skills`.
Project and user extensions are executable code and disabled by default; set `assistants.omp.enableExtensions: true` only for trusted extension roots and repositories.
OMP does not translate Archon `mcp`, `hooks`, `agents`, or tool-restriction node fields.

```yaml
provider: omp
model: openai-codex/gpt-6-sol
effort: high
skills: [archon]
```

## OpenCode

Use OpenCode when the project is already configured for OpenCode or models.dev style providers.
Model refs normally use `<provider>/<model>`, such as `anthropic/claude-sonnet-4-6`.

OpenCode supports session resume, MCP, skills, agents, tool restrictions, env injection, and enforced structured output.
OpenCode handles effort and thinking through OpenCode agent config rather than Archon node fields.

Example:

```yaml
provider: opencode
model: anthropic/claude-sonnet-4-6

nodes:
  - id: multi
    prompt: 'Run specialist agents and summarize.'
    agents:
      first-agent:
        description: 'Return first finding.'
        prompt: 'Return FIRST.'
      second-agent:
        description: 'Return second finding.'
        prompt: 'Return SECOND.'
```

## Copilot

Use Copilot when GitHub Copilot credentials are available.
Copilot supports session resume, MCP, skills, agents, tool restrictions, env injection, best-effort structured output, effort, and thinking control.
Copilot does not support hooks, fallback model, sandbox, or native tools.

Configure default reasoning:

```yaml
assistants:
  copilot:
    model: gpt-5
    modelReasoningEffort: high
```

Node-level `effort` can set Copilot reasoning:

```yaml
- id: plan
  provider: copilot
  model: gpt-5
  effort: max
  prompt: 'Create the implementation plan.'
```

Archon passes node `effort` exactly to Copilot `reasoningEffort`; use `xhigh` when that is the provider value you intend. The separate string `thinking` shorthand retains its legacy `max` to `xhigh` mapping.
Use `effort` rather than Claude object-form `thinking`.

## Effort Resolution and Validation

Archon does not use a shared effort vocabulary. It preserves any non-empty string exactly, including whitespace, so users must enter the value expected by the selected provider. Provider rejection is surfaced and does not fall back to a lower-precedence value.

Resolution order is node `effort`, workflow `effort`, legacy workflow `modelReasoningEffort`, tier/alias `effort`, legacy `assistants.<provider>.modelReasoningEffort`, then the provider default. A provider with `effortControl: false` fails before dispatch when explicit effort is resolved.

## Tool and Structured-output Guidance

Use `allowed_tools: []` for classification, routing, and JSON-only summarization nodes.
Use `denied_tools` for safety constraints on AI nodes that should not mutate files.

Structured output support:

| Provider   | Behavior                                                            |
| ---------- | ------------------------------------------------------------------- |
| `claude`   | Enforced by SDK or backend and validated by Archon.                 |
| `codex`    | Enforced by SDK or backend and validated by Archon.                 |
| `opencode` | Enforced by backend and validated by Archon.                        |
| `pi`       | Best-effort JSON prompt, repair, reask up to 3 attempts, then fail. |
| `copilot`  | Best-effort JSON prompt, repair, reask up to 3 attempts, then fail. |
| `qodercli` | Best-effort JSON prompt, repair, reask up to 3 attempts, then fail. |
| `omp`      | Best-effort JSON prompt, repair, reask up to 3 attempts, then fail. |

For best-effort providers, make prompts explicit:

```text
Return only a JSON object matching the schema.
Do not include prose or code fences.
```

Always declare `required` fields in `output_format` when downstream logic depends on them.
