# Handoff: Archon web UI redesign (Runs, Workflows, Chat, Builder, Settings, Login)

## Overview
A full redesign of the Archon web app (`packages/web`). The app is reorganised around a **Runs workspace** — a three-column screen (runs list → selected run's nodes → selected node's live stream) — that replaces the current Dashboard + WorkflowExecution pages. Workflows, Chat, Builder, Settings and Login are redesigned to the same shell, palette and column vocabulary. A global **project filter** in the top bar scopes every screen and persists across pages.

## About the design files
The `.dc.html` files in this bundle are **design references built in HTML** — interactive prototypes that show the intended look and behaviour. They are not production code. Recreate them in the existing `packages/web` environment (React + TypeScript, Tailwind via `index.css`, Radix-based `components/ui`, TanStack Query in `lib/query-client.ts`, SSE hooks) using its established patterns. Wire to the real API (`lib/api.ts`, `api.generated.d.ts`) and the existing SSE streams; the sample data in `archon-runs.js` / `archon-app.js` only illustrates shape and edge cases.

Open any `.dc.html` directly in a browser to interact with it (they need `support.js` and the `_ds/` folder beside them). Template markup sits between `<x-dc>` tags; behaviour lives in the `class Component` script at the bottom of each file — read `renderVals()` for the exact derived state and rules.

## Fidelity
**High-fidelity.** Colors, type, spacing, borders and interactions are final. Recreate pixel-accurately. Sample numbers (durations, costs, tokens) are placeholders.

## Route mapping (suggested)
| Prototype | Replaces / maps to |
|---|---|
| Archon Runs Workspace | `routes/DashboardPage.tsx` + `routes/WorkflowExecutionPage.tsx` (merge into `/runs`, `/runs/:runId`, `/runs/:runId/:nodeId`) |
| Archon Workflows | `routes/WorkflowsPage.tsx` |
| Archon Chat | `routes/ChatPage.tsx` |
| Archon Builder | `routes/WorkflowBuilderPage.tsx` |
| Archon Settings | `routes/SettingsPage.tsx` |
| Archon Login | `routes/LoginPage.tsx` |
Project filter → `contexts/ProjectContext.tsx` (persist selection; prototype uses `localStorage['archon.project']`, value `'all'` or a project full name).

---

## Global shell

### Top bar (all screens except Login)
- Height **48px**, background **#1a2130**, text **#f1f4f9**. Flex row, items stretch.
- **Brand** (left): 20×20 pixel mark (SVG in files) + "Archon", Archivo 800 16px; padding 0 16px; links to Runs.
- **Nav**: Runs · Workflows · Chat · Builder · Settings. Each item: padding 0 16px, 14px/600, color **#9aa5b8**, hover **#f1f4f9**. Active: color #f1f4f9 + **3px bottom border #7aa2ff**. Horizontal overflow scrolls, scrollbar hidden.
- **Project filter**: label "Project" (12px, #9aa5b8) + native select, height 30px, border 1px **#2c364a**, radius 0, bg #1a2130, text #f1f4f9 13px/600, max-width 240px. Options: "All projects (N)", then each project "owner/repo (N)" where N = run count. Separated from nav by 1px #2c364a left border.
- **Needs you** (right): background **#d97706** (when count > 0, else transparent + muted text), text #fff 13px/600, count in Archivo 800 20px. Click → Runs, filter "Needs you", select first paused run.

### Column vocabulary (shared by Runs, Workflows, Chat, Builder)
- Body is a CSS grid filling remaining height; each column scrolls independently (`min-height: 0; overflow: auto`).
- **Left list column**: `minmax(240px, 300px)` (Builder 220–260px). Right border **2px #c9d0db**.
  - Header: title Archivo 800 20px + right-aligned muted count 12px; filter input (32px tall, 13px); underline tabs (12px/600, active text #1a2130 + 2px bottom #2563eb, inactive #5a6478, row has 1px #e2e6ed bottom border).
  - List rows: padding 12px 16px, bottom border 1px #e2e6ed, **left border 3px** (#2563eb when selected, transparent otherwise), selected bg **#e4ecfb**, hover bg #e4ecfb.
- **Middle column**: `minmax(0, 1fr)`, right border 1px #e2e6ed. Header block padding 16px 24px, bottom border 1px #e2e6ed: small context line 12px #5a6478 → title Archivo 800 24px/1.15 → optional status chip → label/value grid (`64px 1fr`, 12px, labels #5a6478, values 600) → secondary buttons.
- **Right column**: `minmax(300px, 380px)` (Runs: `minmax(0, 1.4fr)`), background #f5f7fa.
- Section labels: 11px, letter-spacing 0.08em, uppercase, #5a6478.
- **Step/layer lists** (Runs nodes, Workflows nodes): grid `28px 1fr`; step number 11px #98a1b2 ("01", "02"…); 1px top rule per step. Parallel steps (>1 node) get a **2px #e2e6ed left bracket** + 12px indent and a "Parallel · N" label 11px #98a1b2. Node row: 3px left bar + selected bg like list rows.

### Status language
| State | Glyph | Label | Color |
|---|---|---|---|
| running | ▶ | Running | #2563eb |
| paused / awaiting | ! | Awaiting you | #d97706 (chip: filled #d97706, text #fff) |
| done / completed | ✓ | Done / Completed | #16a34a |
| failed | ✕ | Failed | #dc2626 |
| pending | ○ | Pending | #98a1b2 |
| skipped / cancelled | – | Skipped / Cancelled | #98a1b2 |
Progress strips: one 4px-tall segment per node, 2px gaps, colored by node state (pending #d3d9e3).

---

## Screens

### 1. Runs workspace (`Archon Runs Workspace.dc.html`)
**Purpose:** monitor and steer running workflows. Columns: `minmax(240px,300px) | minmax(260px,0.85fr) | minmax(0,1.4fr)`.
- **Runs list**: tabs Active (running+paused) / Needs you (paused) / Finished (completed+failed) / All, each with count scoped to the project filter. Search matches name, note, workflow, project, id. Row: project line (11px; owner/ muted 400, repo #1a2130 700, ellipsis) → glyph + **name** 14px/700 + "· note" muted + time right (running: live elapsed "6m 02s"; paused: "since 10:04") → progress strip → workflow (12px muted, ellipsis) + status label. Live count "N running" top-right.
- Changing project: if the selected run is outside the project, select that project's first run.
- **Run column**: header (project · id; name 24px + status chip; Workflow/Elapsed/Input grid; actions — running/paused: "Cancel run", "Open worktree"; failed: "Retry from failed node", "Open worktree"; completed: "Open artifacts", "Run again"). "Nodes" label + "X of Y done". Node rows: glyph, id 14px/600 (pending/skipped muted), right-side duration (running: live timer; awaiting: "waiting …"), second line kind code (CMD/PRM/SH/LOOP/GATE) + "· iteration n of max", "· N attempts", "· conditional". Footer note "Durations, costs and tokens are sample values." (prototype only — drop).
- **Node column**: kind · model line; node id Archivo 800 20px + status + duration; action (failed/done: "Retry node", running: "Open in IDE"). Tabs (13px/600, 3px active underline): **Live stream** (or "Transcript" when not running) · **History · N** · **Output** · **Raw**.
  - Optional **Todo strip** under tabs (surface #eaeef3, 12px, "Todo 3/5", items ✓ struck-through muted / ○ open, horizontal scroll).
  - **Stream** rows: grid `64px 1fr`, 10px vertical padding, 1px bottom rule; time 11px #98a1b2. Item types:
    - agent text 14.5px/1.6, typing cursor (8px block, blink 1s steps) while streaming;
    - sys 12px/700 uppercase muted;
    - thinking: italic 13px muted toggle "▸ …", expanded body with 2px left rule;
    - tool call: bordered row (1px #e2e6ed, bg #eaeef3) `12px auto 1fr auto` — caret, tool name 800, mono target ellipsis, meta (errors #dc2626 700, auto-expanded); expanded body in code block bg #1a2130 text #e6e9f0 12px mono;
    - operator message: 3px #1a2130 left rule, "YOU · QUEUED FOR NEXT TURN / ANSWERED" 11px uppercase, text 600; queued items have "Withdraw" link;
    - **AskHuman**: 2px #d97706 border; header filled #d97706, white "THE AGENT IS ASKING YOU" + question Archivo 800 19px; options rows letter A/B/C + label, selected bg #e4ecfb; footer: note input + primary button "Pick an option" (disabled) → "Answer A →". Answering resumes the node (status → running, run leaves Needs you).
  - Auto-follow: stream scrolls to bottom on update unless the user scrolled up >40px from bottom.
  - **History**: for loop nodes, iterations newest first (glyph, "Iteration n", summary, duration); clicking a finished iteration shows its read-only transcript with a dark banner "Viewing iteration n of max · finished, read only" + "Back to current". Non-loop: single "Attempt 1".
  - **Output**: node output text 16px, max 60ch. **Raw**: JSON payload in code block.
  - **Guidance dock** (only when node running and viewing current): 2px #c9d0db top border; single-line textarea "Guide the agent…" + primary "Queue ↵" + secondary "Interrupt". Enter queues, Shift+Enter newline. Otherwise a muted line explains why (awaiting → "Answer the question above to resume this node.", past iteration → read only, else "Guidance is available while the agent is running.").

### 2. Workflows (`Archon Workflows.dc.html`)
Columns `minmax(240px,300px) | 1fr | minmax(300px,380px)`.
- **List**: title + total; search (name + description); category tabs All / Code Review / Development / Automation with counts. Row: name 14px/700, description 12px muted (2-line clamp), meta "N nodes · N runs" + source tag "Project" (#2563eb) or "Bundled" (#98a1b2).
- **Detail**: "{category} · {file path}" (`.archon/workflows/x.yaml` for project, `defaults/x.yaml` for bundled); name 24px; description 14px/1.55 max 64ch; grid Nodes (e.g. "3 CMD · 1 SH · 2 PRM") / Input / Runs. Buttons "Open in Builder", "Duplicate to project" (→ "Copied to .archon/workflows"). Node steps as in shell; clicking a node toggles an inline detail (Kind + description, Depends on = previous step's nodes or "Nothing, runs first").
- **Start a run** (right, 2px #c9d0db bottom border): Project select (defaults to filter project or first), input textarea labelled by the workflow's input type (placeholder e.g. `https://github.com/owner/repo/issues/…`), Isolation 2-option segmented control (selected bg #1a2130 text #fff; options left-aligned) "Worktree" / "In place" with explanatory line, error "Add the {input} first." (#dc2626 600) when empty, primary "Start run →". On success: card with 2px #2563eb border, bg #e4ecfb, "▶ RUNNING", "{id} · {workflow}", project · branch, link "Follow in Runs →".
- **Recent runs**: runs of this workflow, scoped to project filter, each linking to Runs.

### 3. Chat (`Archon Chat.dc.html`)
Columns `minmax(240px,300px) | 1fr | minmax(280px,340px)`.
- **Conversations**: "Chat" + secondary "New chat" (creates "New conversation" in the current project); search by title; list filtered by project. Row: project line, title 14px/700 + time, optional "▶ 1 run active" (#2563eb 11px/700).
- **Thread**: header project + title Archivo 800 22px. Messages grid `64px 1fr`: who ("You" #1a2130 / "Archon" #2563eb, 12px/800) + time; text 14.5px/1.6, user text 600, pre-wrap. Empty state: "Ask about {repo}, or start a workflow." + explanation. **Run card** inline (white, 1px #c9d0db, max 520px): id, workflow, status, progress strip, "N of M nodes", "Open in Runs →". "Archon is replying…" italic while waiting.
- **Composer** (2px top border): suggestion chips (mono 12px, 1px #c9d0db) that prefill input; 2-row textarea + primary "Send ↵". Enter sends.
- Slash commands: `/run <workflow> <input>` starts a run and replies with a run card; `/status` lists project runs; `/workflows` lists workflows; `/cancel <run>`.
- **Context panel**: Project / Branch / Path; "Runs from this chat" (live progress strips); "Commands" list (click to prefill).

### 4. Builder (`Archon Builder.dc.html`)
Columns `minmax(220px,260px) | 1fr | minmax(300px,380px)`.
- **Left**: "Start from" select (Blank or any workflow → loads it as `{name}-copy`). "Add node" palette — Command, Prompt, Bash, Loop, Approval with code, description and "+" (#2563eb). Hint "Adds to the step after {selected}." New node goes to selected node's step + 1 (parallel if step exists).
- **Toolbar**: workflow name input (Archivo 800 20px; spaces → hyphens), stats "N nodes · N steps · N errors" (red when errors), "Validate", primary "Save" / "Saved". Notice bar under toolbar: info (bg #e4ecfb, #2563eb), error (bg #fdecea, #dc2626), saved (bg #e7f6ec, #16a34a).
- **Canvas**: horizontal row of step columns, 220px each, 2px #1a2130 top rule, bg #eaeef3 (empty step bg #fdecea), "STEP 01" + "Parallel · N"; "→" gutters 36px between steps. Node cards: white, 1px #c9d0db (selected 2px #2563eb + bg #e4ecfb), code + tier, id 13px/700, "conditional" in #d97706 when `when` set.
- **Inspector / YAML tabs**. Inspector: kind; ID (mono, editable); Step with ← / → (move between steps); Depends on (derived: all nodes in previous step); Model tier segmented small/medium/large (hidden for Bash/Approval) + "Resolves to {model}"; body textarea (Command file / Prompt / Script / Loop settings / Message to the approver); "Run only when" condition; "Delete node" (red outline). YAML tab: generated YAML in code block, path `.archon/workflows/{name}.yaml`.
- Validation: duplicate ids, empty steps, missing id. Save blocked with errors. Existing hooks `useBuilderValidation`, `useBuilderUndo`, `useBuilderKeyboard` and `lib/workflow-yaml.ts`, `lib/dag-layout.ts` should back this.

### 5. Settings (`Archon Settings.dc.html`)
Columns `minmax(200px,240px) | 1fr`; content max-width 880px, padding 24px 32px 32px. Left nav rows (14px/600, 3px left bar + #e4ecfb when active) with right hints (e.g. "2 not set" in #d97706). Footer: account email + "Sign out" → Login. Each section: title Archivo 800 28px, description 14px muted, **2px #1a2130 rule**.
- **Providers**: grid `1.2fr 88px 1.2fr 112px 120px` — name, auth type, value (mono; muted when unset), status (✓ Connected #16a34a / ○ Not set), action (Replace key / Add key / Sign in / Sign out). Editing reveals input + primary Save/Sign in + Cancel; keys masked `sk-ant-••••4f2a`.
- **Model tiers**: Small/Medium/Large (Archivo 800 18px), use description, model select (mono).
- **Aliases**: `@name → model` rows with Remove; add row (name, model select, "Add alias"; auto-prefix @).
- **Projects**: name + path (mono), kind, branch ("no git" for folders), run count, Remove; current filter project highlighted; add by path or GitHub URL.
- **GitHub**: square toggle (52×28, 2px #1a2130 border, on = #2563eb track, white knob); when on: account, repositories, webhook, trigger chips (Issue labeled archon / PR opened / @archon mention).
- **Usage**: period tabs 7 days / 30 days / All time; table Provider / Runs / Tokens / Cost (numbers right-aligned).
- **System**: version, data directory, database, worktrees; "Check for updates" (→ "Checking…" → "Up to date · 0.9.4"), "Prune finished worktrees".

### 6. Login (`Archon Login.dc.html`)
Two columns (`repeat(auto-fit, minmax(min(100%,380px),1fr))`, stacks on narrow). Left: #1a2130 panel, padding 32px, brand 28px mark + "Archon" 22px, statement "Run coding agents as workflows you can watch." Archivo 800 44px/1.05 max 18ch, 6-segment progress strip as motif. Right: form max 380px — title 28px, subtitle, 2px rule, Email, Password, error line, primary "Sign in →" (44px), text toggle "No account yet? Sign up" / "Already have an account? Sign in". Sign-up copy: "Create your account" / "Signup is invite-only. Use an allowlisted email." Validation: email format; sign-up password ≥ 8 chars; password required. Success → Runs.

---

## Interactions & behaviour (summary)
- All list selections are single-select with 3px left bar + #e4ecfb background; hovers use the same bg.
- No animations except the streaming caret blink (1s steps) and live timers; respect `prefers-reduced-motion`.
- Focus: `:focus-visible` 2px outline in accent, offset 2px (from DS stylesheet).
- Buttons: labels flush-left when wider than content (`justify-content: space-between` with trailing → / ↵).
- Zero border radius everywhere.

## State (per screen)
- Global: `project` ('all' | projectName), persisted.
- Runs: `filter`, `query`, `runId`, `nodeIdByRun`, `tab`, `iteration`, expanded item ids, `follow`, guidance draft, queued guidance per run:node, AskHuman `choice` + `note`.
- Workflows: `category`, `query`, `workflow`, `node`, run form (`project`, `input`, `isolation`), started runs.
- Chat: `conversation`, `query`, composer draft, pending reply.
- Builder: `name`, `nodes[{id, kind, step, tier, body, when}]`, `selected`, `tab`, notice, dirty/saved.
- Settings: `section`, editing provider + draft; tiers, aliases, projects, GitHub toggles, usage period.
- Login: `mode`, `email`, `password`, `error`, `submitting`.

## Design tokens
Colors (Navy header / "slate-d"):
- Header bg `#1a2130`, header text `#f1f4f9`, header muted `#9aa5b8`, header lines `#2c364a`, header active underline `#7aa2ff`
- Background `#f5f7fa`, surface `#eaeef3`, white inputs/cards `#ffffff`
- Text `#1a2130`, muted `#5a6478`, faint `#98a1b2`
- Line `#e2e6ed`, strong line `#c9d0db`, selection `#e4ecfb`
- Accent / running `#2563eb` (hover `#1d4ed8`), waiting `#d97706`, done `#16a34a`, failed `#dc2626`, pending segment `#d3d9e3`
- Code block bg `#1a2130`, code text `#e6e9f0`; error tint `#fdecea`; success tint `#e7f6ec`
Typography: **Archivo** for everything (headings 800). Sizes used: 44 / 28 / 24 / 22 / 20 / 19 / 18 / 16 / 15 / 14.5 / 14 / 13 / 12 / 11 / 10px. Mono: `ui-monospace, Menlo, monospace` 12–14px. Tabular numerals on all screens.
Spacing (DS): 4 / 8 / 12 / 16 / 24 / 32px (`--space-1,2,3,4,6,8`).
Radius: 0 everywhere. Shadows: none. Rules: 2px for major column/section dividers, 1px for rows.

## Assets
- Brand mark: inline pixel SVG in each file (repo also has `assets/logo.svg` — use the repo logo).
- Icons: glyph characters (▶ ! ✓ ✕ ○ – → ↵ ▸ ▾). The DS recommends Lucide if you replace glyphs with icons.
- No images.

## Files
- `Archon Runs Workspace.dc.html`, `Archon Workflows.dc.html`, `Archon Chat.dc.html`, `Archon Builder.dc.html`, `Archon Settings.dc.html`, `Archon Login.dc.html` — the screens.
- `archon-runs.js` — sample runs/nodes/stream events (shape reference for the Runs workspace).
- `archon-app.js` — sample workflows (nodes as `[id, kind, step]`), conversations, settings, plus shared helpers (status map, project persistence).
- `_ds/modernist-…/styles.css` — base stylesheet (Archivo, spacing tokens, `.btn`, `.input`); its red accent is overridden to the blue palette above.
- `support.js` — prototype runtime only; not needed for implementation.
