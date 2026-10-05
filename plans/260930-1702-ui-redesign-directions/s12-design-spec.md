# Archon redesign: locked identity (S12 Swiss Pixel Border)

Status: locked by the owner on 2026-09-30. Source board: `pixel-styles-board.html` (item S12).

## Decision trail

- Logo: L4 Pixel (from `logo-color-board-v2.html`).
- Style: S8 Swiss Pixel with full borders, named S12 Swiss Pixel Border.
- Rejected on the way: the first safe boards (too plain), S11 Grid Mono, the W1 to W8 "wow" round (too much animation). Keep the result flat and calm.

## Logo

A 7x7 pixel "A", rows top to bottom (`#` filled):

```
..###..
.##.##.
##...##
#######
##...##
##...##
##...##
```

- Pixels are ink `#111111`. One runner pixel in accent blue `#1F2BFF` sits on the crossbar (row 3) and steps across columns 2, 3, 4 only while a run is active. It is static otherwise.
- Render with `shape-rendering: crispEdges`. Favicon at 16px and nav mark at 24 to 28px must stay crisp.
- Wordmark: "ARCHON", Schibsted Grotesk 900, uppercase, letter-spacing -0.04em.

## Color tokens

| Token         | Value     | Use                                                                                   |
| ------------- | --------- | ------------------------------------------------------------------------------------- |
| `--bg`        | `#F2F2EF` | Page and panel background (flat, no texture)                                          |
| `--row`       | `#E6E6E1` | Rows, chips, progress track, input hover                                              |
| `--ink`       | `#111111` | Text, all borders, logo pixels                                                        |
| `--text-2`    | `#3A3A36` | Secondary text                                                                        |
| `--text-3`    | `#5A5A54` | Tertiary text, pending state                                                          |
| `--accent`    | `#1F2BFF` | The only accent: primary buttons, active nav, focus ring, waiting state, runner pixel |
| `--on-accent` | `#FFFFFF` | Text on accent                                                                        |
| `--ok`        | `#0B6E3A` | Done                                                                                  |
| `--warn`      | `#8A5200` | Warning                                                                               |
| `--err`       | `#D0021B` | Failed                                                                                |

All text pairs pass WCAG AA (lowest measured pair 5.1:1). A dark theme is not part of the lock; derive it later only if the owner asks.

## Type

- UI and headings: Schibsted Grotesk (400, 600, 800, 900).
- Code, ids, durations, node kinds, logs: JetBrains Mono (400, 600).
- Headings are big and bold, body stays 14 to 15px. Node kinds and statuses are uppercase mono labels.

## Shape and structure

- Corner radius 0 everywhere.
- Borders: 2px ink on the app frame, the top navigation bottom edge, and every panel. List rows (nodes, runs, workflows) get a 1px ink inset border. The focused or waiting row gets a 2px accent border.
- No drop shadows, no gradients, no background texture.
- Primary button: accent fill, white text, square. Secondary button: transparent with 1px ink border.
- Active navigation item: accent fill with white text.

## Motion

Only state changes move: the runner pixel while a run is active, the progress bar filling, a row changing status. No decorative animation. Everything is static under `prefers-reduced-motion: reduce`.
