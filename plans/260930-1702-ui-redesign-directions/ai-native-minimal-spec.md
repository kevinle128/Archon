# Archon redesign: AI-Native UI + Minimalism (spec)

Status: owner decision on 2026-09-30, replacing S12 Swiss Pixel Border for the screens. Source: the `ui-ux-pro-max` skill (styles "AI-Native UI" and "Minimalism & Swiss Style", design-system query "AI agent workflow automation developer tool SaaS dashboard minimal AI-native").

## Kept from earlier rounds

- Logo: L4 Pixel, the 7x7 pixel "A" (rows `..###..`, `.##.##.`, `##...##`, `#######`, `##...##`, `##...##`, `##...##`). Pixels in the text color; one runner pixel in the accent on the crossbar, stepping across columns 2 to 4 only while a run is active. Wordmark "Archon" in the UI font, weight 600.
- Information architecture and real data from `s12-screens.html` (Chat, Dashboard, Workflows, Run detail, Builder, Settings incl. the former console features).

## Style rules

AI-Native UI:

- Minimal chrome. The conversation and the agent are the center of the product.
- Agent output streams in; a 3-dot typing indicator shows only while an agent is actually working.
- Supporting information (run progress, tool calls, the human question, artifacts) appears as context cards: surface background, 1px border, 3px accent left border when it needs attention.
- The input bar is always visible, sticky at the bottom of conversational views.
- User messages align right in a tinted bubble; agent messages align left without a bubble (plain text on the page).

Minimalism:

- Neutral monochrome palette plus a single accent. No gradients, no shadows (a subtle 1px border separates surfaces), no background texture.
- Generous whitespace on an 8px spacing scale; hierarchy through size and weight, not color.
- Hover and state transitions 150 to 250ms. One primary action per screen.

## Tokens

| Token                                    | Light     | Dark      |
| ---------------------------------------- | --------- | --------- |
| `--bg`                                   | `#FFFFFF` | `#0B0B0F` |
| `--surface`                              | `#F7F7F8` | `#141418` |
| `--surface-2`                            | `#EFEFF1` | `#1C1C22` |
| `--border`                               | `#E4E4E7` | `#2A2A31` |
| `--text`                                 | `#18181B` | `#F4F4F5` |
| `--text-2`                               | `#52525B` | `#A1A1AA` |
| `--text-3`                               | `#71717A` | `#8B8B94` |
| `--accent` (AI accent)                   | `#4F46E5` | `#818CF8` |
| `--on-accent`                            | `#FFFFFF` | `#0B0B0F` |
| `--accent-soft` (user bubble, selection) | `#EEF0FF` | `#1E1B3A` |
| `--ok`                                   | `#166534` | `#4ADE80` |
| `--warn`                                 | `#B45309` | `#FBBF24` |
| `--err`                                  | `#DC2626` | `#F87171` |

The accent is indigo, the skill's AI accent family, darkened from `#6366F1` to `#4F46E5` so small text on white passes WCAG AA. Light is the default; dark follows `prefers-color-scheme` with a manual toggle.

## Type

- UI: Fira Sans (400, 500, 600). Code, ids, node kinds, durations, logs: Fira Code (400, 500).
- Scale 12 / 14 / 16 / 20 / 28. Body 14 to 16px, line-height 1.5 or more.

## Shape

- Radius: 12px for cards and panels, 10px for inputs and buttons, full pill for status chips and the user bubble tail-free shape uses 16px.
- Icons: Lucide-style 1.5px stroke SVG, one family. No emoji.

## Motion

Only meaningful motion: streaming text, the typing indicator, the logo runner while a run is active, progress fill, 150 to 250ms hover and expand transitions. Everything static under `prefers-reduced-motion: reduce`.
