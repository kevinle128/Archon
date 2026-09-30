# Archon "wow" style round: shared brief

Status: design exploration. No production code changes.

## Context

The owner locked the logo (L4 Pixel, a 7x7 pixel "A") but rejected every visual style so far as not creative enough. They asked for eight new, much more creative styles that make them feel "wow". Tone: young, dynamic, creative. Restrained enterprise dashboards are explicitly NOT wanted.

Each style is ONE self-contained HTML page that fills the viewport (use `min-height: 100dvh`, design for 1440x900, must still work at 1280x800 and must not break at 1024 wide). A showroom page will load all eight in iframes and switch between them, so each page must look complete on its own without scrolling for the main composition (scrolling for extra content is fine).

## The locked logo (must appear, reinterpreted in your style's material)

A 7x7 pixel grid, `#` = filled, `.` = empty, rows top to bottom:

```
..###..
.##.##.
##...##
#######
##...##
##...##
##...##
```

Row index 3 is the crossbar. A single "runner" pixel moves along the crossbar cells (columns 2, 3, 4) in steps, like an agent working. Keep the grid geometry exact; reinterpret the MATERIAL (chrome, voxel, blueprint lines, paper, glass, particles, and so on). The wordmark text is "Archon" or "ARCHON", set in your style's display font.

## Required content (English UI copy, like the real product)

1. The logo large, with the wordmark, as the hero moment of the page.
2. A navigation for: Chat, Runs, Workflows, Builder, Settings (Workflows active). Form may be unconventional (dock, HUD, tabs, stickers) as long as it is readable and clickable.
3. A live run of workflow `ak-feature` for input `kevinle128/Archon issue #266`, nodes in order: `setup` (bash), `plan` (prompt), `verify-and-fix-plan` (prompt), `build-ralph-prd` (prompt), `ralph-loop-run` (loop), `create-pull-request` (command).
4. A JS simulation loop (restart after it ends, about 12 to 18 seconds per cycle): `setup` runs then completes (show a duration like 6.7s, labeled as sample in a tiny footnote), `plan` runs, streams an agent message by typing it out ("Reading issue #266 and the repo layout. Two options for the data model, I need one decision from you."), shows one tool call (for example `Read packages/web/src/App.tsx`), then pauses as WAITING with a human question: "Should the plan include a data migration?" with an input and a "Send answer" button. Clicking Send (or after a few seconds automatically) continues: remaining nodes run and complete, then the loop restarts.
5. A way to show node kinds (bash, prompt, loop, command) distinctly within your palette.

## Quality bar

- This must feel like a finished, art-directed piece, not a themed template. Commit fully to the concept.
- Motion must carry meaning (running node, streaming text, waiting state, transitions), and ALL motion must stop or become instant under `prefers-reduced-motion: reduce`.
- Text contrast: body text and labels at least 4.5:1 against what is directly behind them. Decorative art may be anything.
- No em-dash or en-dash characters anywhere. No lorem ipsum, no "Acme", no fake brands. No emoji.
- External resources: only Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) and, if truly needed, a library from `https://unpkg.com` or `https://cdnjs.cloudflare.com` pinned to an exact version. Prefer plain CSS, SVG, and canvas.
- Performance: one requestAnimationFrame loop at most, canvases sized to the viewport with devicePixelRatio capped at 2, pause animation when `document.hidden`.
- Put a small fixed caption in a corner: style number and name (for example "W3 Blueprint"), in your style's type.
