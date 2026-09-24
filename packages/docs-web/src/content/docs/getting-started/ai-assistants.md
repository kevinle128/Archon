---
title: AI Assistants
description: Configure Claude Code, Codex, Grok, Qoder CLI, OMP CLI, OpenCode, GitHub Copilot, Pi, DeepSeek Harness, and Devin CLI as AI assistants for Archon.
category: getting-started
area: clients
audience: [user]
status: current
sidebar:
  order: 4
---

You must configure **at least one** AI assistant.
All supported assistants can be configured and mixed within workflows.

For a canonical, at-a-glance comparison of which per-node features each provider supports, see the [Provider Capability Matrix](/reference/provider-capabilities/) — it is generated directly from the providers' capability declarations, so it never drifts from runtime behavior. The per-provider sections below add the field-level YAML syntax and caveats.

## Structured output guarantees

When a workflow node sets `output_format`, the guarantee level depends on the provider's tier (exposed as `capabilities.structuredOutput` on `GET /api/providers`):

| Provider | Tier | How it works | On a validation miss |
|----------|------|--------------|----------------------|
| Claude, Codex, Grok, OpenCode | **enforced** | The SDK/backend grammar-constrains decoding (`output_config.format` / `outputSchema` / `--json-schema` / `format:{json_schema}`). | The node **fails** — a refusal or `max_tokens` truncation can still bypass grammar enforcement, so the parsed output is validated post-parse for these too. No reask (a failure here is a genuine edge). |
| Pi, Copilot, Qoder CLI, OMP CLI, DeepSeek, Devin | **best-effort** | The schema is appended to the prompt; JSON is extracted from the response and structurally repaired (trailing commas, single quotes, truncated tails). | The executor re-asks (prompt + the schema errors) up to **3×**; if still invalid, the node **fails loudly**. |

In all cases the parsed output is **validated against your `output_format` schema** before downstream nodes see it, and a node that declares `output_format` but produces no schema-valid output **fails** rather than silently degrading. See [Authoring Workflows → `output_format`](/guides/authoring-workflows/#output_format-for-structured-json) for field-access (`$node.output.field`) semantics.

## Claude Code

**Recommended for Claude Pro/Max subscribers.**

Archon does not bundle Claude Code. Install it separately, then in compiled Archon binaries, point Archon at the executable. In dev (`bun run`), Archon finds it automatically via `node_modules`.

### Install Claude Code

Anthropic's native installer is the primary recommended install path:

**macOS / Linux / WSL:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://claude.ai/install.ps1 | iex
```

**Alternatives:**

- macOS via Homebrew: `brew install --cask claude-code`
- npm (any platform): `npm install -g @anthropic-ai/claude-code`
- Windows via winget: `winget install Anthropic.ClaudeCode`

See [Anthropic's setup guide](https://code.claude.com/docs/en/setup) for the full list and auto-update caveats per install path.

### Binary path configuration (compiled binaries only)

In compiled Archon binaries, if `claude` is not on the default install path Archon autodetects, supply the path via either:

1. **Environment variable** (highest precedence):
   ```ini
   CLAUDE_BIN_PATH=/absolute/path/to/claude
   ```
2. **Config file** (`~/.archon/config.yaml` or a repo-local `.archon/config.yaml`):
   ```yaml
   assistants:
     claude:
       claudeBinaryPath: /absolute/path/to/claude
   ```
3. **Autodetect** (zero-config fallback): Archon probes `~/.local/bin/claude` (POSIX) and `%USERPROFILE%\.local\bin\claude.exe` (Windows), matching the native curl/PowerShell installer layouts.

If none of the three resolves in a compiled binary, Archon throws with install instructions on first Claude query.

The Claude Agent SDK accepts the native compiled binary, a JS `cli.js`, or the npm platform-package directory (e.g. `@anthropic-ai/claude-code-win32-x64`) — directories are auto-expanded to the contained `claude`/`claude.exe`.

**Dev mode override:** when running from source (`bun run dev:server`), the SDK auto-resolves its bundled per-platform binary by default. Set `CLAUDE_BIN_PATH` if you need to override that — most commonly on glibc Linux where the SDK picks the musl variant first and fails to spawn. Config-file `claudeBinaryPath` is intentionally binary-mode-only (per-repo, not per-machine).

**Typical paths by install method:**

| Install method | Typical executable path |
|---|---|
| Native curl installer (macOS/Linux) | `~/.local/bin/claude` |
| Native PowerShell installer (Windows) | `%USERPROFILE%\.local\bin\claude.exe` |
| Homebrew cask | `$(brew --prefix)/bin/claude` (symlink) |
| npm global install | `$(npm root -g)/@anthropic-ai/claude-code/cli.js` |
| npm platform-package directory (Windows) | `$(npm root -g)/@anthropic-ai/claude-code-win32-x64` — directory accepted, auto-expanded to `claude.exe` |
| Windows winget | Resolvable via `where claude` |
| Docker (`ghcr.io/coleam00/archon`) | Pre-set via `ENV CLAUDE_BIN_PATH` in the image — no action required |

If in doubt, `which claude` (macOS/Linux) or `where claude` (Windows) will resolve the executable on your PATH after any of the installers above.

### Authentication Options

Claude Code supports three authentication modes via `CLAUDE_USE_GLOBAL_AUTH`:

1. **Global Auth** (set to `true`): Uses credentials from `claude /login`
2. **Explicit Tokens** (set to `false`): Uses tokens from env vars below
3. **Auto-Detect** (not set): Uses tokens if present in env, otherwise global auth

If both `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_API_KEY` are set, the OAuth token wins and no API key is passed to Claude. A per-user credential connected in Settings → Agents always takes precedence over these install-wide variables for that user's runs.

### Option 1: Global Auth (Recommended)

```ini
CLAUDE_USE_GLOBAL_AUTH=true
```

### Option 2: OAuth Token

```bash
# Install Claude Code CLI first: https://docs.claude.com/claude-code/installation
claude setup-token

# Copy the token starting with sk-ant-oat01-...
```

```ini
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-xxxxx
```

### Option 3: API Key (Pay-per-use)

1. Visit [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Create a new key (starts with `sk-ant-`)

```ini
CLAUDE_API_KEY=sk-ant-xxxxx
```

### Claude Configuration Options

You can configure Claude's behavior in `.archon/config.yaml`:

```yaml
assistants:
  claude:
    model: sonnet  # or 'opus', 'haiku', 'claude-*', 'inherit'
    settingSources:
      - project      # Default: only project-level CLAUDE.md
      - user         # Optional: also load ~/.claude/CLAUDE.md
    # Optional: absolute path to the Claude Code executable.
    # Required in compiled Archon binaries if CLAUDE_BIN_PATH is not set.
    # claudeBinaryPath: /absolute/path/to/claude
```

The `settingSources` option controls where the Claude Code SDK discovers `CLAUDE.md`, skill, command, and agent files. The default is `['project', 'user']`, which includes both the project-level `<cwd>/.claude/` and your personal `~/.claude/`. For workflow skills, discovery is only eligibility: the node's `skills:` list remains the exact active selection, and omission/`[]` activates none. Set `settingSources` to `['project']` to exclude user-level resources, or `[]` for a lean node with no setting sources; a declared skill must live under a source the node enables. See [Claude SDK Advanced Options](/guides/authoring-workflows/#claude-sdk-advanced-options).

### Set as Default (Optional)

If you want Claude to be the default AI assistant for new conversations without codebase context, set this environment variable:

```ini
DEFAULT_AI_ASSISTANT=claude
```

## Codex

Archon does not bundle the Codex CLI. Install it, then authenticate.

### Install the Codex CLI

```bash
# Any platform (primary method):
npm install -g @openai/codex

# macOS alternative:
brew install codex

# Windows: npm install works but is experimental.
# OpenAI recommends WSL2 for the best experience.
```

Native prebuilt binaries (`.dmg`, `.tar.gz`, `.exe`) are also published on the [Codex releases page](https://github.com/openai/codex/releases) for users who prefer a direct binary — drop one in `~/.archon/vendor/codex/codex` (or `codex.exe` on Windows) and Archon will find it automatically in compiled binary mode.

See [OpenAI's Codex CLI docs](https://developers.openai.com/codex/cli) for the full install matrix.

### Binary path configuration

Set `CODEX_BIN_PATH` to override the SDK-pinned CLI in development or binary auto-detection in compiled Archon builds:

```ini
CODEX_BIN_PATH=/absolute/path/to/codex
```

Compiled Archon binaries also support these fallbacks:

1. **Config file** (`~/.archon/config.yaml`):
   ```yaml
   assistants:
     codex:
       codexBinaryPath: /absolute/path/to/codex
   ```
2. **Vendor directory** (zero-config fallback): drop the native binary at `~/.archon/vendor/codex/codex` (or `codex.exe` on Windows).
3. **Autodetect** (zero-config fallback): if the vendor directory is empty, Archon probes the common npm-global install layouts: `~/.npm-global/bin/codex` (POSIX), `/opt/homebrew/bin/codex` (macOS Apple Silicon), `/usr/local/bin/codex` (macOS Intel and Linux), `%APPDATA%\npm\codex.cmd` and `%USERPROFILE%\.npm-global\codex.cmd` (Windows). For other npm prefixes or custom layouts, set `CODEX_BIN_PATH` or the config path explicitly.

Without `CODEX_BIN_PATH`, development mode (`bun run`) resolves `codex` via the SDK's `node_modules` dependency.

### Authenticate

```bash
codex login

# Follow browser authentication flow
```

### Extract Credentials from Auth File

On Linux/Mac:
```bash
cat ~/.codex/auth.json
```

On Windows:
```cmd
type %USERPROFILE%\.codex\auth.json
```

### Set Environment Variables

Set all four environment variables in your `.env`:

```ini
CODEX_ID_TOKEN=eyJhbGc...
CODEX_ACCESS_TOKEN=eyJhbGc...
CODEX_REFRESH_TOKEN=rt_...
CODEX_ACCOUNT_ID=6a6a7ba6-...
```

### Codex Configuration Options

You can configure Codex's behavior in `.archon/config.yaml`:

```yaml
assistants:
  codex:
    model: gpt-6-sol
    modelReasoningEffort: medium  # Legacy provider default; passed through unchanged
    webSearchMode: live           # 'disabled' | 'cached' | 'live'
    additionalDirectories:
      - /absolute/path/to/other/repo
```

### Set as Default (Optional)

If you want Codex to be the default AI assistant for new conversations without codebase context, set this environment variable:

```ini
DEFAULT_AI_ASSISTANT=codex
```

### Skills

Codex supports installed skills from `.agents/skills/`.
In workflow nodes, Archon turns the automatic skill catalog off, so commands and prompts invoke a skill explicitly with `$skill-name`.
Direct Codex chat keeps native discovery behavior.
Run `archon skill install` (or `archon setup`) to install the bundled `archon` and `manage-run` skills for Claude Code, Codex, and Grok.

See [Per-Node Skills](/guides/skills/#codex-compatibility) for behavior details and limitations.

## Grok Build

Archon integrates with xAI's Grok Build CLI through its headless streaming JSON protocol.
The CLI remains responsible for authentication, model access, and its own local configuration.

### Install Grok Build

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok --version
```

Archon resolves the executable from `GROK_BIN_PATH`, `assistants.grok.grokBinaryPath`, common native installer locations such as `~/.local/bin/grok`, and finally `PATH`.

```ini
GROK_BIN_PATH=/absolute/path/to/grok
```

### Authenticate

Use the Grok CLI login flow for ambient credentials:

```bash
grok login
grok models
```

You can instead connect an xAI API key through Archon's per-user credential store with `archon ai key set xai` or Settings → Agents.
Archon delivers that credential to Grok as `XAI_API_KEY` for the user's runs.
`archon setup` checks for the binary and launches `grok login` when Grok is selected, while `archon doctor` verifies both the CLI version and authenticated model listing.

### Grok Configuration Options

Configure Grok in `~/.archon/config.yaml` or a repository's `.archon/config.yaml`:

```yaml
defaultAssistant: grok
assistants:
  grok:
    model: grok-4.5
    modelReasoningEffort: high
    permissionMode: bypassPermissions
    # grokBinaryPath: /absolute/path/to/grok
```

Supported permission modes are `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, and `plan`.
Omit `model` to use the default reported by `grok models`; model availability is account-dependent.
Workflow execution defaults to `bypassPermissions` because no interactive approval channel is available to a headless provider process; set a stricter mode when the workflow's tool policy permits it.

Grok supports session resume and fork, per-node effort, tool allow/deny lists, inline `agents:`, environment injection, streamed reasoning and tool lifecycle events, usage and cost metadata, and enforced `output_format` through the native `--json-schema` flag.
Grok tool restrictions use native tool IDs such as `read_file` and `run_terminal_cmd`.
An explicitly empty `allowed_tools: []` fails fast because the Grok CLI treats an empty `--tools` value as unset, which would otherwise silently restore full tool access.
Skills are discovered by Grok from `.agents/skills/`; a workflow node's `skills:` list is informational and does not scope discovery for that process.
Per-node `mcp:` and `hooks:` fields are not translated, although Grok may still discover its own CLI configuration from the filesystem.

To set Grok as the default through the environment instead of YAML, use:

```ini
DEFAULT_AI_ASSISTANT=grok
```

## Qoder CLI (Community Provider)

**CLI-backed community provider.**
Archon invokes your locally installed `qodercli` executable in non-interactive print mode.

Qoder CLI is registered as `builtIn: false`, so it behaves like a bundled community provider rather than a core built-in.
Authentication remains owned by Qoder.
Run `qodercli login` before using it from Archon.

### Install

Install Qoder CLI using Qoder's normal installer.
Confirm Archon can see it:

```bash
qodercli --version
qodercli status -o json
```

If Archon cannot resolve the binary, set one of:

```ini
QODERCLI_BIN_PATH=/absolute/path/to/qodercli
```

```yaml
assistants:
  qodercli:
    qodercliBinaryPath: /absolute/path/to/qodercli
```

Archon also probes `~/.archon/vendor/qodercli/qodercli`, `~/.local/bin/qodercli`, common Homebrew/system paths, and PATH.

### Configuration Options

```yaml
assistants:
  qodercli:
    model: qoder-pro
    modelReasoningEffort: high  # Legacy provider default; passed through unchanged
    permissionMode: bypass_permissions
    settingSources:
      - project
      - user
```

`model` maps to `qodercli --model`.
`modelReasoningEffort` maps unchanged to `qodercli --reasoning-effort` as a legacy provider default. A tier, alias, workflow, or node `effort` overrides it and is also passed unchanged.
Workflow tiers and aliases can also route `effort` to Qoder:

```yaml
tiers:
  large:
    provider: qodercli
    model: qoder-pro
    effort: high
```

Qoder structured output is best-effort.

Qoder does **not** expose authoritative per-call usage through its CLI surface.
Archon never fabricates token, request, model, or USD observations for Qoder —
workflow usage reports simply omit Qoder passes that have no provider data.

Archon appends the JSON schema instruction to the prompt, parses the final CLI output, and validates it before downstream nodes can read it.

## OMP CLI (Community Provider)

**CLI-backed community provider.**
Archon invokes a user-installed `omp` executable once per turn in newline-delimited JSON mode.
OMP owns model discovery, authentication, and persisted session files under its normal configuration roots.

### Install and authenticate

Install OMP through one of its supported methods:

```bash
curl -fsSL https://omp.sh/install | sh
# or
brew install can1357/tap/omp
# or
bun install -g @oh-my-pi/pi-coding-agent
```

Run `omp setup` or start `omp` interactively, select a default model, and complete `/login` for that model's upstream provider.
Confirm the executable is available:

```bash
omp --version
```

### Binary path configuration

Archon resolves `OMP_BIN_PATH`, then `assistants.omp.ompBinaryPath`, then OMP's native, Bun, Homebrew, system, and PATH install locations.
`ompBinaryPath` is a private server-side configuration field.

```ini
OMP_BIN_PATH=/absolute/path/to/omp
```

```yaml
assistants:
  omp:
    ompBinaryPath: /absolute/path/to/omp
```

### Configuration

```yaml
assistants:
  omp:
    model: openai-codex/gpt-6-sol
    modelReasoningEffort: high
    enableExtensions: false
```

`model` maps unchanged to `omp --model`.
`modelReasoningEffort` is the legacy provider default for `omp --thinking`; a resolved tier, alias, workflow, or node `effort` takes precedence.
String `thinking` values, including `off` and `auto`, also map to `omp --thinking`.
Per-node `skills` names map to OMP's `--skills` filter and can select skills discovered from `.agents/skills` and OMP's other configured roots.

Archon passes `--yolo` because workflow and remote-chat turns are non-interactive.
The OMP process inherits Archon's host-user permissions and environment, including access to resources outside its working directory.
Archon's worktree isolation separates Git branches but is not a filesystem or host security boundary, so it does not contain an unsandboxed OMP process.
Run Archon and OMP inside an external sandbox, container, or virtual machine when that host-level access is unacceptable.
Worktree isolation is still recommended to prevent branch conflicts.

Project and user extension discovery is disabled by default because OMP extensions are executable code.
Set `enableExtensions: true` only when the OMP extension roots and the target repository are trusted.

OMP structured output is best-effort.
Archon appends the JSON schema instruction, parses the final assistant text, validates it, and lets the existing workflow reask loop handle schema misses.

Archon's per-node `mcp`, `hooks`, `agents`, and tool-restriction fields are not translated in this version even though OMP has its own nearby features and configuration files.

### Workflow usage enrichment (fail-soft)

Primary stream `message_end` events already carry provider, model, token,
cache, reasoning, and USD usage when OMP reports them.
After the process exits, Archon may also enrich **advisor** and **task
subagent** usage from session transcripts under the resolved session artifact
directory:

- Resume and fork are **byte-delta** safe: copied history is snapshotted before
  spawn and only appended bytes are parsed after exit. A mid-record snapshot
  end, changed prefix, wrong session header/cwd, symlink, path escape,
  unsupported layout, malformed JSONL, or size bound failure **warns and omits**
  that file — it never invents usage and never flips the node’s success/error
  status.
- Prompt, response, credential, and tool payload content never enter the usage
  object or structured logs.
- `--no-session` and unproven session layouts skip enrichment with a warning.

OMP is an external binary, not a pinned package dependency; when the layout
cannot be proven, enrichment fails closed.


## OpenCode (Community Provider)

**SDK-backed community provider.** Archon's OpenCode adapter uses `@opencode-ai/sdk`, which provides a multi-provider AI coding agent with support for Anthropic, OpenAI, Google, and more through a unified interface.

OpenCode is registered as `builtIn: false` — like Pi, it is a bundled community provider rather than a core built-in.

Archon always runs OpenCode as a **managed embedded runtime** — it spawns and owns the OpenCode server process, generates a random server password per session, and tears it down when the workflow completes. Connecting to an external OpenCode server (`baseUrl`) is not supported.

### Install

OpenCode is included as a dependency of `@archon/providers` — `bun install` pulls in the SDK automatically. It's available immediately.

### Authenticate

OpenCode handles authentication internally — Archon does not pass API keys through config. Configure credentials using one of these methods:

1. **`/connect` TUI command** — Run `opencode` in your terminal, then use the `/connect` command to interactively authenticate with your chosen provider
2. **Config file** — Store credentials in `~/.config/opencode/opencode.json` with `{env:VAR}` or `{file:PATH}` substitution
3. **Auth file** — Credentials are persisted in `~/.local/share/opencode/auth.json` after connecting

OpenCode delegates to the underlying LLM provider (Anthropic, OpenAI, Google, etc.) based on your model selection. Request-scoped env vars from Archon workflows are still merged into the OpenCode environment.

### Configuration Options

```yaml
assistants:
  opencode:
    model: anthropic/claude-3-5-sonnet  # Required: '<provider>/<model>' format
    # or build-in agent
    agent: general
```

### Model reference format

OpenCode models use a `<provider>/<model>` format. List all available models via `opencode models`:

```yaml
assistants:
  opencode:
    model: anthropic/claude-3-5-sonnet   # via Anthropic
    # model: openai/gpt-4o                # via OpenAI
    # model: google/gemini-2.5-pro        # via Google
```

### Supported Archon Features

| Feature | Support | Notes |
|---|---|---|
| Session resume | ✅ | Single-agent runs return `sessionId`; multi-agent runs do not |
| MCP servers | ✅ | `mcp: path/to/servers.json` passed through to OpenCode |
| Structured output | ✅ | `output_format:` — schema passed to OpenCode SDK |
| System prompt override | ✅ | `systemPrompt:` |
| Codebase env vars (`envInjection`) | ✅ | merged into the spawned OpenCode environment |
| Skills | ✅ | SKILL.md files with YAML frontmatter, pattern-based permissions |
| Tool restrictions | ✅ | `tools` / `disallowedTools` per agent; deny wins over allow |
| Inline agents (`agents:`) | ✅ | File-materialized agents; single and parallel multi-agent fan-out |
| Hooks | ❌ | Archon's per-node `hooks` field is Claude-SDK-shaped; the OpenCode provider has no translation site, so a node's `hooks:` is ignored (with a warning) |
| Effort / reasoning control | ❌ | No per-request param; not configurable in agent file, opencode puts it in config. |
| Thinking control | ❌ | No explicit `thinking` field in agent frontmatter; OpenCode auto-enables reasoning when `agents[].model` is a reasoning-capable model (e.g. `anthropic/claude-sonnet-4-5`) |
| Fallback model | ❌ | No native failover in the SDK |
| Sandbox | ❌ | Not native in the SDK; Archon uses worktree isolation |
| Cost limits (`maxBudgetUsd`) | ❌ | Cost tracked in result chunks, but no runtime budget enforcement |

Unsupported YAML fields trigger a visible warning from the dag-executor when the workflow runs, so you always know what was ignored.

### Usage in workflows

```yaml
name: my-workflow
provider: opencode
model: anthropic/claude-3-5-sonnet

nodes:
  - id: analyze
    prompt: "Analyze the codebase structure"
    # per-node model override:
    # model: openai/gpt-4o
```

### See also

- [Adding a Community Provider](../contributing/adding-a-community-provider/) — the contributor-facing guide for extending Archon with your own provider.
- [OpenCode on GitHub](https://github.com/opencode-ai/opencode) — upstream project.

## Pi (Community Provider)

**One adapter, ~20 LLM backends.** Pi (`@earendil-works/pi-coding-agent`) is a community-maintained coding-agent harness that Archon integrates as the first community provider. It unlocks Anthropic, OpenAI, Google (Gemini + Vertex), Groq, Mistral, Cerebras, xAI, OpenRouter, Hugging Face, and local inference (LM Studio, ollama, llamacpp, custom OpenAI-compatible endpoints registered in `~/.pi/agent/models.json`) under a single `provider: pi` entry.

Pi is registered as `builtIn: false` — it validates the community-provider seam rather than being a core-team-maintained option. If it proves stable and valuable it may be promoted to `builtIn: true` later.

### Install

Pi is included as a dependency of `@archon/providers` — no separate install needed. It's available immediately.

### Quick setup via wizard

Run `archon setup` and select **Pi (community)** in the AI assistant multiselect. The wizard prompts for your preferred backend and API key, writes the key to `~/.archon/.env`, and writes the model ref to `~/.archon/config.yaml` automatically.

### Authenticate

Pi supports both OAuth subscriptions and API keys. Archon's adapter reads your existing Pi credentials from `~/.pi/agent/auth.json` (written by running `pi` → `/login`) AND from env vars — env vars take priority per-request so codebase-scoped overrides work.

**OAuth subscriptions (run `pi /login` locally):**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

**API keys (env vars):**

| Pi provider id | Env var |
|---|---|
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN` (subscription, read first) or `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HF_TOKEN` |

The full backend → env-var map is generated from the installed Pi SDK (`bun run generate:pi-vendor-map`) and covers every key-based backend (DeepSeek, Together, Fireworks, Azure OpenAI, Vercel AI Gateway, Cloudflare, MiniMax, Moonshot, Z.AI, Xiaomi, …). Amazon Bedrock and Google Vertex authenticate via ambient cloud credentials (AWS chain / gcloud ADC) instead of a pasted key.

**Local / custom providers (no credentials needed):**

Providers that aren't in the env-var table above (LM Studio, ollama, llamacpp, custom OpenAI-compatible endpoints) work without any Archon-side configuration. Register them in `~/.pi/agent/models.json` per Pi's own docs and reference them as `<pi-provider-id>/<model-id>`:

```yaml
# .archon/config.yaml
assistants:
  pi:
    model: lm-studio/qwen2.5-coder-14b   # whatever ID you registered with Pi
```

Archon logs an info-level `pi.auth_missing` event when no credentials are found and continues — Pi's SDK then connects directly to the local endpoint defined in `models.json`. If the provider does require auth (a less-common cloud backend not in the env-var table) the SDK call fails downstream; the `pi.auth_missing` breadcrumb in the log lets you trace it back to a missing env-var mapping.

### Pi settings (baseline behavior)

Archon reads your Pi settings files as the starting point for every session:

- **`~/.pi/agent/settings.json`** — global Pi preferences (retry counts, transport, compaction strategy, thinking budgets, default model, etc.)
- **`<repo>/.pi/settings.json`** — project-level overrides on top of global

All settings flow in automatically. You do not need to re-state them in Archon's `config.yaml`. To configure baseline Pi settings, edit `~/.pi/agent/settings.json` directly.

Archon never writes back to these files — `~/.pi/agent/settings.json` is read-only from Archon's perspective. Session-level changes (model switches, thinking-level adjustments) are held in memory only and discarded when the session ends, matching Claude and Codex behavior.

If Pi settings files do not exist (Docker, first-time setup, compiled binary with no Pi home directory), Archon falls back to Pi SDK defaults. Parse errors in the settings files are logged as warnings (`pi.settings_load_error`) and never prevent the session from starting.

### Extensions (on by default)

A major reason to pick Pi is its **extension ecosystem**: community packages (installed via `pi install npm:<package>`) and your own local ones that hook into the agent's lifecycle. Extensions can intercept tool calls, gate execution on human review, post to external systems, render UIs — anything the Pi extension API exposes.

Archon turns extensions **on by default**. To opt out in `.archon/config.yaml`:

```yaml
assistants:
  pi:
    enableExtensions: false   # skip extension discovery entirely
    # interactive: false       # keep extensions loaded, but give them no UI bridge
```

Most extensions need three config surfaces:

| Surface | Purpose |
|---|---|
| `extensionFlags` | Per-extension feature flags (maps 1:1 to Pi's `--flag` CLI switches) |
| `env` | Env vars the extension reads at runtime (managed via `.archon/config.yaml` or the Web UI codebase env panel) |
| `interactive: true` | Binds a UI context so approval-gate extensions can block for human input; also set the **workflow-level** `interactive: true` on the web UI so the run stays foreground |

#### Scoping extension posture per node

`enableExtensions`, `interactive`, and `extensionFlags` are the three fields that make up a node's **extension posture**. Setting them under `assistants.pi` applies the posture to *every* Pi node in *every* workflow — which is usually wrong. A planning extension like plannotator only belongs on the node that actually plans: if the same `plan: true` flag leaks into a downstream `implement` node, that node starts in planning mode, its code edits get blocked ("edits are limited to markdown files"), and it hangs waiting on a review nobody asked for.

Scope the posture to the node that plays that role. Three layers resolve per node, in ascending precedence:

1. **Assistant-level** (`assistants.pi.*`) — the install-wide default for every Pi node.
2. **Install-level node map** (`assistants.pi.nodes.<nodeId>`) — overrides the default for a node id on this machine. Handy when you can't edit the workflow, but it's non-portable: the override lives in one machine's `config.yaml` and is keyed by node-id string, so a node rename silently orphans it.
3. **Portable node `pi:` block** — the per-node posture written directly in the workflow YAML. It travels with the workflow and wins over both layers above. This is the recommended surface.

Each layer's `extensionFlags` shallow-merge over the ones below it (later wins per key), so a node can negate an inherited flag with `plan: false`. The `pi:` block is honored on `prompt`, `command`, and `loop` nodes (a `loop:` node's per-iteration call is exactly where planning mode tends to leak); on a `loop_group` it's ignored with a warning — put it on the body nodes instead.

**Example — [plannotator](https://github.com/dmcglinn/plannotator) (human-in-the-loop plan review):**

```bash
# One-time install into your Pi home
pi install npm:@plannotator/pi-extension
```

Keep `assistants.pi` free of the planning flag — set only the extension's runtime env there:

```yaml
# .archon/config.yaml
assistants:
  pi:
    model: anthropic/claude-haiku-4-5
    env:
      PLANNOTATOR_REMOTE: "1" # exposes the review URL on 127.0.0.1:19432 so you can open it from anywhere
```

Then grant the `plan` flag and a UI context to the planner node, and explicitly deny them on the implement loop — right in the workflow, so the posture ships with it:

```yaml
# .archon/workflows/plan-then-build.yaml
name: plan-then-build
provider: pi
interactive: true             # workflow-level: keeps the run foreground on the web UI so you can approve
nodes:
  - id: plan
    prompt: "Draft a plan for: $ARGUMENTS"
    pi:
      interactive: true        # bind the UI context — plannotator opens its review server
      extensionFlags:
        plan: true             # planning mode ON for this node only

  - id: implement
    depends_on: [plan]
    loop:
      prompt: "Implement the approved plan. Print DONE when finished."
      until: "DONE"
      max_iterations: 10
    pi:
      interactive: false       # no review server on the implement loop
      extensionFlags:
        plan: false            # planning mode OFF — code edits are allowed
```

When the `plan` node runs, plannotator prints a review URL and blocks until you click approve/deny in the browser. Archon's CLI/SSE batch buffer flushes that URL to you immediately so you never get stuck waiting on a node that silently wants input. The `implement` loop then runs headless with edits allowed.

If you can't edit the workflow (e.g. a bundled default), the same scoping is available install-side via the node map — same precedence, lower priority than the workflow's own `pi:` block:

```yaml
# .archon/config.yaml
assistants:
  pi:
    nodes:
      plan:
        interactive: true
        extensionFlags: { plan: true }
      implement:
        interactive: false
        extensionFlags: { plan: false }
```

### Model reference format

Pi models use a `<pi-provider-id>/<model-id>` format:

```yaml
assistants:
  pi:
    model: anthropic/claude-haiku-4-5       # via Anthropic
    # model: google/gemini-2.5-pro           # via Google
    # model: groq/llama-3.3-70b-versatile   # via Groq
    # model: openrouter/qwen/qwen3-coder    # via OpenRouter (nested slashes allowed)
```

### Usage in workflows

```yaml
name: my-workflow
provider: pi
model: anthropic/claude-haiku-4-5

nodes:
  - id: fast-node
    provider: pi
    model: groq/llama-3.3-70b-versatile   # per-node override — switches backends
    prompt: "..."
    effort: low
    allowed_tools: [read, grep]            # Pi's built-in tools: read, bash, edit, write, grep, find, ls

  - id: careful-node
    provider: pi
    model: anthropic/claude-opus-4-5
    prompt: "..."
    effort: high
    skills: [archon-dev]                   # Archon name refs work — see Pi capabilities below
```

### Pi capabilities

| Feature | Support | YAML field |
|---|---|---|
| Extensions (community + local) | ✅ (default on) | `enableExtensions: false` to disable; `interactive: false` to load without UI bridge; `extensionFlags: { <name>: true }` per extension. Scope per node with a `pi:` block (`pi: { interactive, enableExtensions, extensionFlags }`) — see [Scoping extension posture per node](#scoping-extension-posture-per-node) |
| Session resume | ✅ | automatic (Archon persists `sessionId`) |
| Tool restrictions | ✅ | `allowed_tools` / `denied_tools` (read, bash, edit, write, grep, find, ls) |
| Thinking level | ✅ | `effort:` is passed unchanged to Pi's SDK reasoning level; provider rejection surfaces |
| Skills | ✅ | `skills: [name]` (searches `.agents/skills`, `.claude/skills`, user-global) |
| Inline sub-agents | ❌ | `agents:` is Claude-only; ignored with a warning on Pi |
| System prompt override | ✅ | `systemPrompt:` |
| Codebase env vars (`envInjection`) | ✅ | `.archon/config.yaml` `env:` section |
| MCP servers | ❌ | Pi rejects MCP by design |
| In-process native tools | ✅ | none — Archon's `manage_run` tool is auto-injected in project-scoped chat via Pi `customTools` (distinct from MCP, which Pi rejects). Gated on the `nativeTools` provider capability. |
| Claude-SDK hooks | ❌ | Claude-specific format |
| Structured output | ✅ (best-effort) | `output_format:` — schema is appended to the prompt and JSON is parsed out of the assistant text. Handles bare JSON, ```json```-fenced, reasoning-model prose preambles like `Let me evaluate... {...}` (Minimax M2.x pattern), and structurally-corrupt JSON (trailing commas, single quotes, truncated tails) via repair. The parsed output is then **validated against the schema**; on a miss the executor re-asks (prompt + the schema errors) up to **3×**, and only then **fails** the node (it no longer degrades silently to a warning). Not SDK-enforced like Claude/Codex. |
| Cost limits (`maxBudgetUsd`) | ❌ | tracked in result chunk, not enforced |
| Fallback model | ❌ | not native in Pi |
| Sandbox | ❌ | not native in Pi |

Unsupported YAML fields trigger a visible warning from the dag-executor when the workflow runs, so you always know what was ignored.

### See also

- [Adding a Community Provider](../contributing/adding-a-community-provider/) — the contributor-facing guide for extending Archon with your own provider.
- [Pi documentation](https://pi.dev) — official Pi docs (extensions, model registry, settings).
- [Pi on GitHub](https://github.com/earendil-works/pi) — upstream project.

## GitHub Copilot (Community Provider)

**Use a GitHub Copilot subscription inside Archon workflows.** Drives the Copilot CLI via `@github/copilot-sdk`, supporting OpenAI, Anthropic via BYOK, Gemini, and the other models Copilot exposes — switch between them with the `model` field.

Copilot is registered as `builtIn: false` — like Pi, a bundled community provider rather than a core built-in.

### Install

For source installs (`bun run`), the SDK + its bundled CLI dependency come along with `bun install` — nothing extra to do.

For compiled Archon binaries, install the Copilot CLI yourself and point Archon at it:

```bash
npm install -g @github/copilot
```

Then tell Archon where the binary lives (the resolver searches these in order):

```ini
# .env
COPILOT_BIN_PATH=/absolute/path/to/copilot
```

```yaml
# .archon/config.yaml
assistants:
  copilot:
    copilotCliPath: /absolute/path/to/copilot
```

Or place the binary at `~/.archon/vendor/copilot/copilot` (POSIX) / `~/.archon/vendor/copilot/copilot.exe` (Windows) and the resolver picks it up automatically.

### Authenticate

By default, Copilot uses the credentials from your local `copilot login`. Generic `GH_TOKEN` / `GITHUB_TOKEN` env vars are **not** picked up automatically — classic GitHub PATs lack Copilot entitlement and would fail with a misleading SDK error. Auth precedence (highest to lowest):

1. **`COPILOT_GITHUB_TOKEN`** (env) — always wins when set; treated as explicit Copilot intent
2. **`useLoggedInUser: false`** in `.archon/config.yaml` — opts into env-token auth, including generic `GH_TOKEN` / `GITHUB_TOKEN`
3. **`copilot login` credentials** — the default

An active GitHub Copilot subscription is required for any of these to work.

### Copilot Configuration Options

You can configure Copilot's behavior in `.archon/config.yaml`:

```yaml
assistants:
  copilot:
    model: gpt-5-mini             # 'gpt-5', 'gpt-5-mini', 'claude-sonnet-4.5', 'auto', etc.
    modelReasoningEffort: medium  # Legacy provider default; passed through unchanged
    # configDir: /absolute/path/to/copilot-config
    # enableConfigDiscovery: false  # only enable for trusted repos — bypasses Archon's workflow MCP/skill validation
    # useLoggedInUser: false        # opt into env-token auth (GH_TOKEN / GITHUB_TOKEN); default uses `copilot login`
    # logLevel: error               # 'none' | 'error' | 'warning' | 'info' | 'debug' | 'all'
```

Copilot accepts OpenAI models (`gpt-5`, `gpt-5-mini`), Anthropic via BYOK (`claude-sonnet-4.5`), Gemini, and more. When no model is configured, Archon passes `model: 'auto'` and Copilot picks.

### Supported Archon Features

| Feature | Support | Notes |
|---|---|---|
| Session resume | ✅ | Returns `sessionId`; reused on resume |
| Reasoning control | ✅ | `effort:` → Copilot `reasoningEffort` unchanged; string `thinking:` keeps its legacy shorthand mapping |
| System prompt override | ✅ | `systemPrompt:` |
| Codebase env vars | ✅ | merged into the spawned Copilot CLI environment |
| Tool restrictions | ✅ | `allowed_tools` → `availableTools`, `denied_tools` → `excludedTools` |
| MCP servers | ✅ | `mcp: path/to/servers.json` → `SessionConfig.mcpServers` (env vars `$FOO` expanded; missing vars warned) |
| Skills | ✅ | `skills: [name]` resolved from `.agents/skills/` or `.claude/skills/` (project or home) → `SessionConfig.skillDirectories` |
| Structured output | ✅ | best-effort via prompt augmentation + repair; the parsed output is validated against the schema, the executor re-asks up to 3× on a miss, then **fails** the node (no longer a silent warning) |
| Sub-agents (`agents:`) | ✅ | `name`/`description`/`prompt`/`tools` → `SessionConfig.customAgents`; Claude-specific fields (`model`, `disallowedTools`, `skills`, `maxTurns`) warn per agent and are ignored |
| Fork-session retry | ⚠️ | Copilot SDK has no fork API — when Archon requests a fork (on retry), we create a fresh session and emit a system-chunk warning |
| Hooks | ❌ | Archon hooks ≠ Copilot's `SessionHooks` event vocabulary |
| Fallback model | ❌ | not wired |
| Cost control | ❌ | no cost-limit API |
| Sandbox | ❌ | Copilot permissions surface is separate from Archon's sandbox model |

### Set as Default (Optional)

```ini
DEFAULT_AI_ASSISTANT=copilot
```

### See also

- [Adding a Community Provider](../contributing/adding-a-community-provider/) — the contributor-facing guide for extending Archon with your own provider.
- [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) — upstream SDK.

## DeepSeek Harness (Community Provider)

**Drive DeepSeek models through the pinned DeepSeek Harness (DSH) runtime over ACP.**
The provider id is `deepseek`. It is registered as `builtIn: false` — a bundled community provider, not a core built-in.

DSH may authenticate through its own credential store, including subscription or token-plan routes. Archon also forwards a per-user vendor `deepseek` API key or ambient `DEEPSEEK_API_KEY` when present; it does not require that specific variable before DSH starts. `assistants.deepseek.baseUrl` overrides request and ambient `DEEPSEEK_BASE_URL`.

Supported config keys: `model`, `baseUrl`, `providerRoute`, `profile`, `permissionMode`, `effort`, and `nodeBin`.
`providerRoute` defaults to `deepseek-official`. `profile` is fixed to `acp` (other DSH profiles speak a different protocol). Permission defaults to `workspace-write`, and every DSH permission request is auto-cancelled. `danger-full-access` is explicit — it removes that safe permission posture.

A provider-qualified model reference such as `qwen-token-plan/deepseek-v4-flash` is split at the first slash and sent as the exact DSH model option pair `["qwen-token-plan", "deepseek-v4-flash"]`. An unqualified model is paired with `providerRoute`, which defaults to `deepseek-official`. There are no built-in tier defaults: model IDs vary by account and region. Use a model advertised by the installed DSH setup.

`maxTokens` is rejected (`deepseek_unsupported_config`) because pinned DSH ACP exposes only `model` and `reasoning_effort`.

Source and npm installs use the bundled, version-matched DSH package (`@deepseek-ai/dsh`). Standalone compiled Archon binaries fail with `deepseek_runtime_unavailable` — Node cannot execute DSH from Bun's embedded filesystem. Use a source or npm install instead.

The runtime requires a real Node executable, resolved in this order: `DEEPSEEK_NODE_BIN`, `assistants.deepseek.nodeBin`, Node-host `process.execPath`, then `PATH`.

Results omit token and cost usage in v1. Pinned DSH ACP reports context occupancy, not per-request billing tokens.

The Web config API exposes no DeepSeek fields (`SAFE_ASSISTANT_FIELDS` is unchanged). Set these values in `~/.archon/config.yaml` or `.archon/config.yaml`:

```yaml
assistants:
  deepseek:
    baseUrl: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    providerRoute: deepseek-official
    profile: acp
    permissionMode: workspace-write
    effort: high
```

### See also

- [Provider Capability Matrix](/reference/provider-capabilities/) — generated from the DeepSeek capability declaration.
- [Configuration Reference](/reference/configuration/) — `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_NODE_BIN`.

## Devin CLI (Community Provider)

**Drive the locally installed Devin CLI over ACP.** The provider id is `devin`, registered as `builtIn: false`.

Archon runs `devin --permission-mode yolo acp` as a child process in the conversation's cwd or the managed worktree and speaks the Agent Client Protocol to it. Every turn spawns a fresh child and reaps it when the turn ends, aborts, pauses, or fails.

### Shared login

All users of one Archon install share the machine's Devin login. Run `devin auth login` once on the Archon host; Archon never asks for, stores, or injects a per-user Devin key. The Settings → Agents card shows whether the server can resolve the CLI from `PATH` or `DEVIN_BIN_PATH` and whether the login file exists, without showing the account. The run path also honors `assistants.devin.binaryPath`. A run started after the login expires fails with `devin_not_logged_in` and the same `devin auth login` instruction.

### yolo mode

`yolo` is Devin's own tool-permission mode (an alias of `dangerous` / `bypass` in Devin's docs). Archon passes `--permission-mode yolo` to the child and, because ACP sessions start in Devin's `accept-edits` mode regardless of that flag, switches every session to `bypass` over ACP before the first prompt. It does not approve, skip, or answer any Archon approval gate or AskHuman question. Devin organization rules (Team Settings deny/ask rules) still apply in bypass mode; when Devin asks for permission anyway, Archon cancels the request and ends the turn with `devin_permission_blocked` naming the blocked action. If `bypass` is not offered for the session, the turn fails instead of running in a stricter mode silently. Devin's `--sandbox` mode is not used, and `assistants.devin.permissionMode` / `sandbox` are rejected.

### Models

Set `model` to an exact id from `devin models list` (for example `claude-opus-5-low`). Effort is part of the id, so the node `effort:` field warns and is ignored. Aliases such as `opus` are not accepted: the ACP model option rejects them, and the CLI flag that does accept them silently keeps the default on a typo, which Archon cannot detect. An unknown id fails the turn with Devin's own message listing the available models. Without a `model`, Devin's enterprise default applies and the result reports the resolved id.

### AskHuman and questions

When a workflow node runs on Devin, Archon advertises the ACP elicitation capability and Devin exposes its native `ask_user_question` tool. A question becomes an Archon AskHuman: the run pauses, the turn is cancelled, and after the answer or decline Archon reloads the same Devin session in a new child and sends one message carrying only the validated answer. Single- and multi-select questions are supported; free-text elicitations are not and fail the turn.

### Devin's own configuration

Devin loads its own rules (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.windsurf/rules`), skills (`~/.config/devin/skills`, `.claude/skills`, `.agents/skills`), hooks (`~/.claude/settings.json`), plugins, subagents, and MCP servers (`~/.config/devin/mcp_config.json`, project `.devin/mcp_config.json`, local `.devin/mcp_config.local.json`) on every session. Archon does not rewrite those files and does not translate its per-node `hooks`, `skills`, `agents`, or `mcp` fields; those warn as unsupported. Per-session MCP servers declared over ACP are spawned by Devin but not exposed to its model on CLI `3000.10.21`, so Archon does not attach any.

### Config keys

Supported `assistants.devin` keys: `model`, `binaryPath`, `agentType` (`summarizer` or `review`), and `refusalFallback` (ordered list of model ids tried when the upstream provider refuses a request). The Web config API exposes no Devin fields; set them in `~/.archon/config.yaml` or `.archon/config.yaml`:

```yaml
assistants:
  devin:
    model: claude-opus-5-low
    refusalFallback:
      - claude-sonnet-5-medium
```

### See also

- [Provider Capability Matrix](/reference/provider-capabilities/) — generated from the Devin capability declaration.
- [Configuration Reference](/reference/configuration/) — `DEVIN_BIN_PATH` and the `assistants.devin` keys.

## Per-user credentials and AI Settings

Everything above configures the **install-wide** assistant credentials (env vars, `claude /login`, etc.) — every run uses the same shared keys. On a **shared Archon box** where several people use the same server, each user can instead connect **their own** provider — by API key or subscription — so their runs and chats bill to them, not to the install's shared key. Devin is the exception: its login remains machine-shared and its Agents card is status-only.

### When you need this

- You run Archon for a team and want each person to bring their own provider key or Claude Pro/Max / Copilot subscription.
- You want a personal key isolated from the shared install key.

Solo users don't need any of this — the install-wide setup above is enough.

### Enabling it

The credential vault is available on every install — Archon auto-provisions a local key at
`~/.archon/credential-key` on first use. **No setup required for a solo install.**

If you're running a managed or multi-user deploy and want to control the encryption key yourself
(e.g. to rotate it, share it across containers, or keep it in a secrets manager), set
`TOKEN_ENCRYPTION_KEY` and the local key file is skipped entirely:

```ini
# .env — generate with: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=<64-char hex>
```

> **Rotating `TOKEN_ENCRYPTION_KEY`** (or deleting `~/.archon/credential-key`) invalidates all
> stored user credentials — everyone must reconnect. `archon doctor` will report a
> `mass_decrypt_failure` and include a re-connect hint if this happens.

### Connecting from the console

The console **AI Settings** page (Settings in the web UI) has four sections:

- **Model Tiers** — map the `small` / `medium` / `large` tiers to a provider + model (and optional effort). This writes the install's `tiers:` config and works on **any** install, even without `TOKEN_ENCRYPTION_KEY` (it's non-secret config). Pi tier models show a cost/reasoning/context hint from Pi's model catalog.
- **Model Aliases** — define `@custom` refs (e.g. `@fast`) usable in workflow `model:` fields, with the same scope toggle.
- **Agents** — one card per agent (Claude Code, Codex, Pi, OpenCode, Copilot, Devin) with the credentials it can spend nested inside, each card showing a readiness state (ready / needs credential). Connect a credential for *your* user inside the agent that uses it. Credentials are keyed by **vendor** (`anthropic`, `openai`, `github-copilot`, `openrouter`, …), and one credential serves every agent that consumes it (an `anthropic` key powers Claude Code and Pi's anthropic backend — both cards reflect it). Every vendor accepts an **API key**; **`anthropic`**, **`openai`**, and **`github-copilot`** additionally offer **subscription login** (an OAuth flow — for `openai`/ChatGPT it is an Archon-owned PKCE flow where you paste the redirect URL or code back, [#1924](https://github.com/coleam00/Archon/issues/1924)). Legacy ids (`claude`/`codex`/`copilot`) are accepted and normalized. The **Pi** card keeps its 30+ backends behind a searchable "Add backend…" picker (with model counts from Pi's catalog) and shows ambient chains (Amazon Bedrock, Google Vertex) as status-only rows; the **OpenCode** card loads its backend catalog on demand from the embedded runtime — its connections are install-wide, not per-user. The **Devin** card is status-only and reports the machine-shared `devin auth login`; it never offers a per-user connect control.
- **Defaults** — leads with a "Chat runs on [provider][model]" combo line in both scopes (the install line edits the default assistant + `assistants.<provider>.model`; the just-me line edits your personal default assistant + chat-model pin), with the per-provider model grid below as the advanced view.

### Per-user model preferences ("Just me")

When you're logged in (a web identity resolves), the **Model Tiers** and **Model Aliases** panels show a **"This install / Just me"** scope toggle, and **Defaults** gains a just-me "Chat runs on" combo (provider + model). The "Just me" scope stores your personal tiers/aliases/default assistant (and optional chat-model pin) in Archon's database and applies them as the **highest-precedence** layer — your overrides win over the install config for runs and chats *you* start, without changing anyone else's. This needs an identity but **no** `TOKEN_ENCRYPTION_KEY` (model names aren't secrets); on a solo install without web auth the toggle simply doesn't appear and everything behaves exactly as before.

If a chat asks for the `large` tier and only a different tier is configured, Archon uses the nearest preset and posts a one-line notice telling you which tier answered and where to set `large`.

### Connecting from the CLI

The same actions are available headless via [`archon ai`](/reference/cli/#ai):

```bash
# Per-user credentials (need TOKEN_ENCRYPTION_KEY)
echo "$MY_KEY" | archon ai key set openrouter   # API key for any vendor
archon ai login anthropic                        # subscription (anthropic, openai, or github-copilot)
archon ai list                                   # what's connected

# Model tiers + aliases + default (ungated config — solo-OK)
archon ai tier set large claude opus
archon ai alias set @fast claude haiku
archon ai default claude

# The same, but just for YOU (per-user prefs; identity from ARCHON_USER_ID/$USER)
archon ai tier set large claude opus --scope user
archon ai default codex --scope user

# Pin YOUR chat to a specific provider + model without touching the `large`
# tier that workflows use (provider + model are written together; omitting
# the model clears a previous pin)
archon ai default pi openrouter/minimax/minimax-m2 --scope user
```

**How the chat model is resolved.** The provider comes from your personal default (if set), else the conversation's recorded assistant, else the install default. The model then resolves as: your `default_model` pin (only when your default provider matches the effective provider) → the configured `large` tier (yours > repo > global) → the install's `assistants.<provider>.model` (only when no `large` tier is configured anywhere) → the built-in tier default. Workflow nodes are unaffected — `model: large` keeps meaning the tier.

The model-tier presets are the same ones you can hand-write in `~/.archon/config.yaml`; see [Configuration](/reference/configuration/) for the YAML format.

## Workflow usage and cost tracking

Archon records **workflow AI** usage only — every usage-bearing
`IAgentProvider.sendQuery()` pass in a workflow run (including failed attempts,
structured-output reasks, direct-loop iterations, resumes, and manual node
retries). Direct chat turns are **out of scope** for the ledger and Cost page.

### What providers report

Providers emit an additive `usageBreakdown` only from SDK/CLI-observed fields.
Archon never invents a missing model, token category, request count, or USD
value. Known zeros survive; absent fields stay absent (never rendered as zero).

| Provider | Authoritative usage notes |
| --- | --- |
| Claude | Per-model input/output/cache/USD from the Agent SDK; no per-model request count. Usage-bearing API failures still record accumulated usage. |
| Codex | Input/cached-input/output/reasoning on `turn.completed`; no observed model, request count, or USD from the turn event. |
| Grok | Aggregate tokens/USD plus per-model `modelCalls`. Multi-model totals are **not** apportioned — requests-only rows plus one unknown aggregate when needed. |
| Pi | One observation per assistant message in the invocation; cache/reasoning/cost; `responseModel` overrides requested model when present. |
| OpenCode | One observation per assistant message id (repeated updates replace); multi-agent rows are `subagent`. Reasoning is a subset of output (not double-counted). |
| Copilot | One observation per `assistant.usage` event; `cost` is a billing **multiplier**, never USD. Subagent kind only from non-empty `parentToolCallId`. |
| OMP | Primary stream usage plus fail-soft advisor/subagent transcript enrichment (see [OMP](#omp-cli-community-provider)). |
| Qoder CLI | No fabricated breakdown — omit when the CLI exposes nothing. |
| DeepSeek | Not reported in v1; pinned DSH ACP exposes context occupancy but not per-request billing tokens. |
| Devin | Input/output/reasoning/cached-read/cached-write tokens from the ACP prompt response for that turn; no cost — Devin bills in ACUs on its own account. |

### Scope, missingness, and coverage

- **Direct-run scope.** Each run owns only the usage it invoked. Child
  `workflow:` sub-runs record on the child run id; parents do not copy child
  rows into the new ledger (legacy parent cost totals remain a separate label).
- **No historical backfill.** Runs from older writers show
  `hasRecordedUsage: false` / “not recorded,” never `$0`.
  `historicalBackfill` is always `false`.
- **Coverage is event↔ledger integrity only** (`usageEventCount`,
  `ledgeredEventCount`, `unledgeredEventCount`). It is **not** a percentage of
  all historical provider API calls and cannot quantify pre-feature spend.
- A normal write commits the `node_usage_recorded` event and matching ledger
  rows atomically. If the ledger insert fails, Archon keeps one detectable
  event-only fallback (no estimates) and **does not** fail the workflow node.
  Reports surface that gap via `unledgeredEventCount` and a CLI coverage
  warning.
- Provider-reported USD and Archon estimates are always separate. There is no
  combined “effective total.” Operator pricing is [global-only](/reference/configuration/#pricing-global-only).

- Query surfaces: [`GET /api/usage`](/reference/api/#usage),
  [`archon usage`](/reference/cli/#usage) (`--since`/`--until`, half-open UTC),
  run detail `usage`, and the console **Cost** page.


## How Assistant Selection Works

- Assistant type is set per codebase via the `assistant` field in `.archon/config.yaml` or the `DEFAULT_AI_ASSISTANT` env var
- Once a conversation starts, the assistant type is locked for that conversation
- `DEFAULT_AI_ASSISTANT` (optional) is used only for new conversations without codebase context
- Workflows can override the assistant on a per-node basis with `provider` and `model` fields
- Configuration priority: workflow-level options > config file defaults > SDK defaults
