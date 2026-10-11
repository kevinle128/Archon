---
title: Web UI
description: Built-in web interface for interacting with Archon -- no tokens or external services required.
category: adapters
area: adapters
audience: [user]
status: current
sidebar:
  order: 1
---

The Web UI is the built-in interface for interacting with Archon. It requires no tokens, API keys, or external services -- just start the server and open your browser.

## Prerequisites

- Archon installed and dependencies resolved (`bun install`)
- An Anthropic API key or Claude Code authentication (see [AI Assistants](/getting-started/ai-assistants/))

## Starting the Web UI

**Development (recommended):**

```bash
# Start both backend + frontend with hot reload
bun run dev
# Web UI: http://localhost:5173
# API server: http://localhost:3090
```

You can also start each piece individually:

```bash
# Backend API server only (port 3090)
bun run dev:server

# Frontend dev server only (port 5173, requires backend running)
bun run dev:web
```

**Production:**

```bash
bun run build    # Build the frontend into static files
bun run start    # Server serves both API and Web UI on port 3090
```

In production mode, the backend serves the compiled frontend at the same port (3090), so there is no separate frontend URL.

**Remote / homelab access:**

The backend binds to `0.0.0.0` by default. The Vite dev server only listens on `localhost`. To expose the frontend on your network:

```bash
bun run dev:web -- --host 0.0.0.0
```

Then start the backend separately with `bun run dev:server`. The Web UI will be reachable at `http://<server-ip>:5173`. Make sure your firewall allows ports 5173 and 3090.

## UI Layout

The Web UI is a single-page application. It has a light theme and a dark theme. Light is the default, dark follows the system setting, and the theme control in the top bar cycles light, dark, and system. The choice persists in the browser.

### Top bar

A navy bar at the top of every screen holds:

- **Navigation** -- Runs, Workflows, Chat, Builder, and Settings. The Archon pixel logo shows a moving accent pixel while a workflow is running.
- **Project filter** -- Scopes runs, workflows, and new conversations to one registered codebase, or shows all projects. The selection persists across reloads.
- **Needs you** -- Counts runs that wait for a human answer or approval, such as an approval gate or an `AskHuman` question. Click it to open the Runs list filtered to those runs.
- **Theme** -- Cycles light, dark, and system.

Keyboard shortcuts: `/` focuses the list filter on the current screen, and `Escape` leaves it.

### Runs

The Runs workspace at `/runs` is the default screen (`/` and the old `/dashboard` route redirect here). It has two columns:

- **Runs list** -- Filter tabs (Active, Needs you, Finished, All) with counts, a text filter, a date range, and a **Start run** button. Runs are grouped by state; each row shows the workflow, its status, elapsed time, and a progress strip with one segment per node.
- **Run view** -- The selected run. See [Execution Detail Page](#execution-detail-page).

### Chat

The Chat screen at `/chat` has three columns: the conversations of the selected project, the thread, and a context panel with the project, its branch and path, the runs started from this chat, and quick commands (the panel is hidden on narrow screens). Your messages and agent messages are rows with a role label. Tool calls, workflow progress, and questions for you appear as cards. The composer stays at the bottom of the thread.

### Workflows

The `/workflows` page lists the workflows available to the selected project, grouped by category. Selecting a workflow shows its description, file path, nodes, input, and steps, with actions to edit it in the builder or duplicate a bundled workflow into the project. The right column starts a run: it takes the run message, shows the isolation policy and the recent runs of the workflow, and the started run appears as a card that links to the Runs workspace. See [Workflow Builder](#workflow-builder).

### Settings

The `/settings` page configures the install without editing YAML files. A section list on the left selects one section at a time (the URL keeps it as `?section=`). The sections are:

- **Projects** -- Register and manage codebases.
- **Assistant defaults** -- The default assistant and the default model for each provider.
- **AI providers** -- Connect provider API keys or subscription logins for the current user.
- **GitHub** -- Connect the current user's GitHub identity.
- **Model tiers** -- Set the `small`, `medium`, and `large` model presets.
- **Aliases** -- Define `@custom` model aliases.
- **Usage and cost** -- Token usage and estimated cost for workflow runs.
- **System** -- Install and database status.

## Chat Interface

### Creating Conversations

Click **New chat** in the conversations column, or start a workflow from the Workflows screen or the Runs workspace. Each conversation gets a unique ID and persists across page refreshes.

If a project is selected in the top bar, new conversations are automatically scoped to that codebase.

### Sending Messages

Type in the message input at the bottom and press Enter (or click Send). Messages can be:

- **Natural language** -- The AI assistant responds conversationally, using tools to explore and modify code
- **Slash commands** -- `/status`, `/workflow list`, `/help`, etc. These are handled deterministically without AI
- **Workflow triggers** -- Messages like "fix issue #42" or "review this PR" are routed to the appropriate workflow automatically

### AI Responses and Tool Calls

AI responses stream in real-time. When the assistant uses tools (reading files, running commands, editing code), each tool call appears as a collapsible card showing:

- The tool name and input arguments
- The tool's output or result
- Expandable/collapsible to keep the chat readable

A **lock indicator** appears while the agent is actively working, so you know when it is safe to send another message.

### Connection Status

A status indicator in the UI shows whether the SSE connection to the backend is active. If you see "disconnected", check that the backend is running and refresh the page.

## Workflow Execution

### Running Workflows

There are three ways to run a workflow from the Web UI:

1. **Start a run** -- From the Workflows screen, or **Start run** in the Runs workspace: select a workflow, type a message, and start it
2. **Chat message** -- Describe what you want and the router picks the right workflow (e.g., "review PR #123")
3. **Slash command** -- `/workflow run <name> <message>` for explicit invocation

### Foreground vs Background Execution

By default, workflows run in the background -- the conversation shows a progress card while the workflow executes in a separate worker conversation. You can continue chatting or start other workflows.

Workflows with `interactive: true` in their YAML definition run in the foreground. This is required for workflows that have approval gates or interactive loop nodes, since those need you to approve/reject steps in real time.

### Workflow Progress Cards

While a workflow runs, a progress card appears in the conversation showing:

- Current status (running, completed, failed, paused, awaiting input)
- Which DAG node is currently executing
- Per-node status indicators
- Elapsed time

For paused workflows (approval gates), the progress card shows **Approve** and **Reject** buttons so you can control the workflow directly from the chat.

A run that reaches **awaiting input** means a Claude or Pi agent node posed a structured mid-turn question via the `AskHuman` tool. This is distinct from an approval gate: the question is asked by the agent, not declared in the workflow YAML. Open the node's transcript in the execution detail page to see and answer the Ask card.

### Workflow Result Card

When a workflow reaches a terminal state (completed, failed, or cancelled), the progress card is replaced by a result card in the conversation. The result card shows:

- **Status icon** -- Visual indicator for completed, failed, or cancelled
- **Header** -- "Workflow complete", "Workflow failed", or "Workflow cancelled" depending on outcome
- **Node count** -- How many nodes completed out of the total nodes that reached a terminal state (e.g., `3/4 nodes`)
- **Duration** -- Total elapsed time for the run
- **Artifacts** -- Any files or outputs produced by the workflow, with direct links

Click the arrow button in the result card header to open the run in the Runs workspace.

### Execution Detail Page

Click a run (in the Runs list, or from a progress card) to open it. The run view is at `/runs/:runId`, and a node room is at `/runs/:runId/:nodeId`. Old `/workflows/runs/:runId` links, including `?node=`, redirect to these routes. The view has two columns:

- **Run column** -- The run header (workflow, status, project, elapsed time, and actions), then the nodes grouped into numbered steps with a **List** / **Graph** switch. Click a node to open its room.
- **Node column** -- The selected node's room, or a run tab:
  - **Node room** -- A running agent node streams its transcript live; a completed node replays the same transcript. The **History** tab lists earlier attempts of the node.
  - **Ask cards** -- when a Claude or Pi agent node poses a mid-turn structured question (via `AskHuman`), the card appears inline in that node's room. The run shows an "awaiting input" status until an operator answers or declines. Anyone on the install can submit; there is no starter-only lock.
  - **Run tabs** -- Changes, Files, Terminal, Artifacts, Logs, and an optional Chat tab.

Route-loop decisions show the selected target and redacted condition metadata. Run actions resume, retry eligible DAG nodes, cancel, abandon, delete, or run the workflow again.

On a narrow window the two columns stack: the node room replaces the run column and a **Back** control returns to it.

**Terminal.** The Terminal tab opens a real interactive shell in the run's host worktree, in-place folder, or live managed container.
It is available for any run status while that server-resolved target still exists.
The browser never chooses a path or container: the server resolves the target from the run's checkout and isolation records.

Leaving the tab keeps the in-memory shell for two minutes so a reload can resume the same session.
**Close terminal** destroys the shell immediately.
No terminal input, output, or command history is saved.

The host shell is not a filesystem sandbox.
It has the Archon service account's operating-system permissions and can change directories, read files the account can read, and run whatever the account can execute.

## Workflow Builder

The Workflow Builder at `/workflows/builder` edits workflow YAML files. Features include:

- **Start from** -- Open an existing workflow or start a blank one
- **Steps view** -- Nodes laid out as numbered steps from their `depends_on` edges. Move a node to the step before or after it from the inspector
- **Graph view** -- The DAG canvas. Drag nodes and connect them to set `depends_on`
- **Node palette** -- Add command, prompt, bash, and route-loop nodes. Additional node types (`script`, `loop`, `approval`, `cancel`) are editable in the YAML tab
- **Inspector** -- Click a node to configure its command or prompt, model tier, dependencies, and, under **Advanced**, execution, tools, hooks, and MCP servers
- **YAML tab** -- The workflow as YAML, editable in place
- **Route-loop authoring** -- Configure one source input plus `positive`, `negative`, and `exhausted` route targets for bounded review loops
- **Validation notices** -- Validation feedback as you build
- **Undo/redo** -- Full undo/redo stack with keyboard shortcuts
- **Delete node** -- Remove a selected node with `Delete` or `Backspace`, or the **Delete node** button in the inspector
- **Save** -- Saves the workflow YAML to your project's `.archon/workflows/` directory

You can also browse existing workflows on the `/workflows` page and open any of them in the builder to edit.

## SSE Streaming

The Web UI uses Server-Sent Events (SSE) for real-time communication with the backend. When you open a conversation, the frontend opens a persistent connection to `/api/stream/:conversationId`.

Events streamed over SSE include:

| Event Type | Description |
|------------|-------------|
| `text` | AI response text (batched for performance) |
| `tool_call` | Tool invocation with arguments |
| `tool_result` | Tool execution result |
| `workflow_step` | Workflow node status change |
| `workflow_status` | Overall workflow run status update |
| `workflow_dispatch` | Workflow started for this conversation |
| `dag_node` | DAG node progress update. Route-loop decisions arrive as completed `dag_node` events with `routeDecision` metadata. |
| `workflow_artifact` | Artifact produced by a workflow |
| `conversation_lock` | Lock/unlock indicator |
| `session_info` | Session metadata |
| `error` | Error message |
| `heartbeat` | Keep-alive signal |

A separate dashboard SSE stream at `/api/stream/__dashboard__` multiplexes workflow events across all conversations, powering the live updates in the Runs workspace and the top bar.

This stream also covers runs started **out of process** — the `archon` CLI, especially `archon workflow run --detach`. Those runs write their events to the database but never reach the server's in-process emitter, so a server-side poller tails the `workflow_events` table and replays them to `__dashboard__`. On PostgreSQL a `LISTEN/NOTIFY` trigger pushes them in real time; on SQLite the poller picks them up within its poll interval.

## Projects and Codebases

### Registering a Project

From the Web UI, you can register codebases in three ways:

1. **Add Project input** -- Go to **Settings → Projects** and enter a GitHub URL or local path. Inputs starting with `https://`, `ssh://`, `git@`, or `git://` are treated as remote URLs (cloned); everything else is treated as a local path (registered in place).
2. **Clone from URL via chat** -- Use the `/clone <url>` command in chat, or use the API to POST to `/api/codebases` with a `url` field
3. **Register a local path via API** -- POST to `/api/codebases` with a `path` field pointing to an existing git repository

Registered codebases appear in the project filter in the top bar.

### Switching Projects

Select a project in the top bar's project filter to scope your conversations and workflows to that codebase. The selected project determines:

- Which `.archon/commands/` and `.archon/workflows/` are loaded
- The working directory for AI tool execution
- Which worktrees and isolation environments are shown

### Removing a Project

Click **Remove** next to the project in **Settings → Projects**, or use the API to DELETE `/api/codebases/:id`. This removes the registration but does not delete the cloned files.

## Further Reading

- [Getting Started](/getting-started/overview/) -- Full setup guide
- [Configuration](/getting-started/configuration/) -- Customize Archon for your project
- [Authoring Workflows](/guides/authoring-workflows/) -- Create custom workflows
- [API Reference](/reference/api/) -- Full REST API documentation
