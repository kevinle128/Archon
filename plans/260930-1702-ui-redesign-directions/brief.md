# Archon web UI redesign: 4 reference directions (brief)

Status: mockups only. No production code changes.

## Outcome

Four self-contained HTML mockups that the owner compares side by side to choose a direction for a full overhaul of the Archon web UI. Each mockup shows the same app shell and the same three screens, so the comparison is fair.

## Skill scope note

The `design-taste-frontend` skill targets landing pages. Section 13 puts dashboards and dense product UI out of scope. We use only its applicable rules: the AI-tell bans (9.A-9.G, zero em-dashes and en-dashes in visible text), the typography, color, and shape locks (4.1, 4.2, 4.4), UI states (4.5), the redesign protocol (11), motion must be motivated (5), reduced motion (6.B), and dark mode (8). Landing-page rules (hero stack, logo walls, stock photography) do not apply.

## Redesign read (Section 11)

- Mode: overhaul. The visual language and layout model change. Content and information architecture stay.
- Audience: technical operators who run governed agent workflows (coding today, business operations next). They watch runs, answer human-in-the-loop questions, approve gates, and read logs.
- Current dials (approx): VARIANCE 3, MOTION 2, DENSITY 7.

## Revision 2026-09-30: full visual overhaul (owner decision)

The owner asked to redesign everything: colors, fonts, and layout. The brand section below is now reference only, not a constraint. Each direction owns its own palette and type pairing (assigned below) so the four options differ visually as well as structurally. The logo is also redesigned (owner decision, same day): drop the shield. Each direction draws its own new Archon mark as a simple geometric inline SVG (explicitly requested, so the skill's hand-rolled-logo rule allows it) plus an "Archon" wordmark set in the direction's type. The mark must read at 16px (favicon) and 32px (nav), work in one color, and be shown once at large size (about 160px) with its 16px and 32px versions in the Direction notes panel. Status colors (running, awaiting, done, failed) and node-kind colors are redefined inside each direction's palette and must pass WCAG AA. The chosen direction will require an update of the token source (`packages/web/src/index.css`) and the brand guide, per AGENTS.md.

| Direction          | Fonts (Google Fonts)                                              | Palette                                                                                                   |
| ------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 01 Control Room    | IBM Plex Sans + IBM Plex Mono                                     | dark graphite `#111317` / `#171A1F`, text `#E6E8EB`, single accent teal `#2DD4BF`                         |
| 02 Operations Desk | Figtree + JetBrains Mono                                          | light `#F6F7F9`, ink `#15171C`, single accent cobalt `#2B59E6`; derived dark mode                         |
| 03 Canvas          | Bricolage Grotesque (headings) + Onest (UI) + Martian Mono        | ink navy `#0C1020` / `#141A2E`, text `#E9ECF5`, single accent coral `#FF6A4D`                             |
| 04 Industrial      | Archivo (use its width axis for condensed labels) + Fragment Mono | near-black `#0E0E0D`, bone text `#E8E6DF`, single accent acid lime `#C8FF2E` reserved for "needs a human" |

## Brand constraints (superseded by the revision above; reference only)

- Fonts: Geist (UI) and Geist Mono (ids, code, logs, numbers). Load from Google Fonts in the mockup: `https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap`.
- Brand gradient: `#ED10EC` -> `#8E40C8` -> `#06CE94`. Use it with intent and sparingly (logo mark, one signature element). Never as a background wash, never as gradient text on large headings.
- Dark surface: `#0F1115`. Existing app tokens (oklch), usable as-is:
  - background `oklch(0.14 0.005 260)`, surface `oklch(0.18 0.008 260)`, surface-elevated `oklch(0.22 0.01 260)`, surface-inset `oklch(0.12 0.005 260)`, border `oklch(0.28 0.01 260)`
  - text-primary `oklch(0.93 0.005 260)`, text-secondary `oklch(0.65 0.01 260)`, text-tertiary `oklch(0.45 0.01 260)`
  - primary/accent `oklch(0.65 0.18 250)`
  - success `oklch(0.65 0.17 155)`, warning `oklch(0.75 0.15 75)`, error `oklch(0.6 0.2 25)`
  - node kinds: command `oklch(0.62 0.18 250)`, prompt `oklch(0.58 0.19 290)`, bash `oklch(0.75 0.15 75)`, loop `oklch(0.62 0.18 170)`, approval `oklch(0.72 0.17 40)`
- A light theme may derive from the same hues. Do not invent unrelated palettes. The four directions differ in layout model, information architecture, density, and interaction model, not in brand.

## Information architecture to preserve

Top-level destinations: Chat, Dashboard (all runs across projects), Workflows (library), Builder (visual workflow editor), Run detail, Settings. Settings must also have a home for features that previously lived only in the removed console: AI provider keys and subscription logins, GitHub connect, model tiers (small/medium/large), model aliases (`@name`), and cost/usage.

## What each mockup must contain

One HTML file, fully self-contained (inline CSS and JS; icons from Phosphor via `https://unpkg.com/@phosphor-icons/web@2.1.1` script is allowed; no other external deps). Default width target 1440px; must not break at 1024px.

1. App shell: the navigation model of the direction, a project switcher (projects: `kevinle128/Archon`, `kevinle128/billing-service`, and folder project `ops/finance-close`), and a way to reach every destination above.
2. Screen A, Workflows library: real workflows below, filterable (All, Code Review, Automation, Development), search, a "New workflow" action, and one open detail state (description, node list with kinds, Run action).
3. Screen B, Run detail for `ak-feature` (paused, awaiting input): the DAG (nodes below), the selected node's room (agent messages, one tool call, one pending AskHuman question with answer input), and tabs or equivalent for Logs, Chat, Source Control, Files changed, Terminal.
4. Screen C, Chat: a project-scoped conversation where the user asks to run a workflow, the assistant starts `archon-issue-review-full` for issue #266, and a live run progress card appears inline.
5. A small, clearly styled screen switcher so the viewer can flip between A, B, and C (and dark/light if the direction has both).
6. A short "Direction notes" panel (toggle) inside the page: design read one-liner, the three dial values, how Dashboard, Builder, and Settings fit the shell (one paragraph), and trade-offs (2-4 bullets).

## Real content

Workflows (name, kind of nodes):

- `archon-issue-review-full`: full fix and review pipeline for a GitHub issue. Nodes: investigate (command), implement (command), review**verify-pr-base (bash), review**code-review (prompt), review**error-handling (prompt), review**test-coverage (prompt)
- `archon-comprehensive-pr-review`: comprehensive PR review with automatic fixes. 9 command nodes (scope, sync, code-review, error-handling, test-coverage, comment-quality, docs-impact, synthesize, implement-fixes)
- `archon-ralph-dag-project-aware`: Ralph loop with project-aware validation. detect-input, generate-prd (prompt), ready-prd, validate-prd (bash), implement (loop), report (prompt)
- `archon-architect`: architectural sweep and complexity reduction. scan-metrics (bash), analyze, plan, simplify (prompt), validate (bash), create-pr (prompt)
- `archon-interactive-prd`: guided PRD. initiate (prompt), foundation-gate (approval), research (prompt), deepdive-gate (approval), technical (prompt), scope-gate (approval), generate (prompt)
- `archon-resolve-conflicts`: resolve (command)
- `archon-adversarial-dev`: plan (prompt), init-workspace (bash), adversarial-sprint (loop), report (prompt)
- `archon-plan-to-pr`: plan-setup, confirm-plan, implement-tasks, validate, finalize-pr (command)
- `archon-smart-pr-review`, `archon-feature-development`, `archon-workflow-builder`, `speckit-ralph-native-feature`, `bmad-readiness-correct-course-loop`

Run `ak-feature` (status paused, awaiting input, started 2026-09-30 09:51, input: `https://github.com/kevinle128/Archon/issues/266`). Nodes in order: setup (bash, done 6.7s), plan (prompt, waiting on you: AskHuman), verify-and-fix-plan (prompt), build-ralph-prd (prompt), ralph-native-preflight (bash), ralph-loop-run (loop, condition `$plan.output.plan_path != '' && $build-ralph-prd.output.prd_dir != ''`), codex-final-fix (prompt), create-pull-request (command).

Other runs for Dashboard references: `ak-feature` paused (2026-09-26), `ak-feature` failed (2026-09-26), `ak-feature` cancelled on issue #192.

Durations, costs, and token counts shown in the mockup are sample values; label them as sample in a single footnote.

## Bans (from the skill, enforced)

No em-dash or en-dash in visible text. No decorative status dots (a dot only for real run state). No neon glows. No div-built fake screenshots inside the mockup (the mockup itself is the UI, that is fine). No generic names (no Acme, no Jane Doe). No filler verbs (elevate, seamless, unleash). No section-number eyebrows. At most a few uppercase micro-labels. One corner-radius system per direction, documented in the notes. Every animation must communicate state (running node, streaming text, panel transition) and must stop under `prefers-reduced-motion`.
