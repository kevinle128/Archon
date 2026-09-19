---
title: Provider Capability Matrix
description: Canonical per-provider capability matrix, generated from each provider capabilities.ts.
category: reference
area: clients
audience: [user, developer]
status: current
sidebar:
  order: 10
---

<!-- AUTO-GENERATED — DO NOT EDIT. Regenerate with: bun run generate:capability-matrix -->

:::note
This page is **auto-generated** from each provider's `capabilities.ts` (the same
constants the workflow engine reads to warn when a node uses a feature its
provider ignores). Do not edit it by hand — run `bun run generate:capability-matrix`.
A capability change fails `bun run validate` until this page is regenerated.
:::

Each column is a registered provider id (the value you set as `provider:` in a
workflow or `.archon/config.yaml`). A ✅ means Archon translates the corresponding
per-node YAML field for that provider; a ❌ means the field is accepted but ignored
(the dag-executor emits a visible warning when the run reaches such a node).

## Providers

- `claude` — Claude (Anthropic)
- `codex` — Codex (OpenAI)
- `grok` — Grok (xAI)
- `opencode` — OpenCode (community) *(community provider)*
- `pi` — Pi (community) *(community provider)*
- `copilot` — Copilot (GitHub) *(community provider)*
- `qodercli` — Qoder CLI *(community provider)*
- `omp` — OMP CLI *(community provider)*
- `deepseek` — DeepSeek Harness (community) *(community provider)*
- `devin` — Devin CLI (community) *(community provider)*

## Capabilities

| Capability | `claude` | `codex` | `grok` | `opencode` | `pi` | `copilot` | `qodercli` | `omp` | `deepseek` | `devin` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Session resume | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅⁵ |
| MCP servers (`mcp:`) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅³ | ❌ |
| Hooks (`hooks:`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Skills (`skills:`) | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Inline sub-agents (`agents:`) | ✅ | ❌ | ✅ | ✅² | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Tool restrictions (`allowed_tools`/`denied_tools`) | ✅ | ❌ | ✅¹ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Structured output (`output_format`) | **enforced** | **enforced** | **enforced** | **enforced** | best-effort | best-effort | best-effort | best-effort | best-effort | best-effort |
| Env injection (`env:`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cost control (`maxBudgetUsd`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Effort control (`effort`) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Thinking control (`thinking`) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Fallback model (`fallbackModel`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sandbox (`sandbox`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Setting sources (`settingSources`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| In-process native tools | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Container exec (folder-project container backend) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AskHuman mid-turn questions | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅⁴ |
| Turn interrupt (operator Stop) | **native** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## Caveats

- ¹ `grok` — Tool restrictions (`allowed_tools`/`denied_tools`) — Uses Grok native tool ids. An empty `allowed_tools: []` fails fast because the CLI interprets an empty allowlist as unset (full access).
- ² `opencode` — Inline sub-agents (`agents:`) — Config-file-based agent selection (named agents from `opencode.json`) with per-call model/tools overrides — not inline sub-agent definitions.
- ³ `deepseek` — MCP servers (`mcp:`) — Pinned DeepSeek Harness ACP supports stdio and Streamable HTTP MCP servers; SSE declarations fail fast instead of being ignored.
- ⁴ `devin` — AskHuman mid-turn questions — Delivered through ACP elicitation of Devin's native ask_user_question tool; single- and multi-select questions only. Devin pauses by cancelling the turn and re-enters via session/load.
- ⁵ `devin` — Session resume — ACP session/load in a fresh devin process; a stored id that no longer exists fails the turn instead of starting a new session.

## Legend

- **✅ / ❌** — the per-node field is wired for this provider, or accepted-but-ignored.
- **✅¹ (superscript)** — supported, but with semantics that differ from the headline
  meaning of the axis — see [Caveats](#caveats).
- **Structured output** — `enforced` (the SDK/backend grammar-constrains decoding),
  `best-effort` (schema appended to the prompt, then validated + re-asked up to 3×),
  or ❌ (unsupported). See [AI Assistants → Structured output guarantees](/getting-started/ai-assistants/#structured-output-guarantees).
- **In-process native tools** — the provider can register Archon `NativeTool`s for a
  turn (gates auto-injection of Archon's `manage_run` tool into project-scoped chat).
- **Turn interrupt** — `native` (the provider can end only the current turn
  in-process, keeping the session resumable on the same id — e.g. Claude
  `Query.interrupt()`), `stream-abort` (the turn ends by aborting the provider's
  stream), or ❌ (no turn interrupt; operator guidance queues for the next turn).

For per-provider field-level notes (YAML syntax, caveats), see the
[AI Assistants guide](/getting-started/ai-assistants/).
