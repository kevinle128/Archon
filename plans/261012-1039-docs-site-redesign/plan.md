---
status: done
branch: feat/web-runs-workspace-redesign
---

# Docs site (archon.diy, `packages/docs-web`) reskin to the redesign

## Outcome

Every page the docs site serves (`/`, `/docs/**` Starlight pages, `/workflows/`, `/workflows/<slug>/`,
`/roadmap/`, `/brand/`) uses the same visual language as the redesigned web app and the brand
guide on this branch (`src/content/docs/brand/index.md`).

## Source of truth

- Handoff tokens: `claude-design/design_handoff_archon_redesign/README.md` ("Design tokens").
- Dark = midnight palette from `packages/web/src/index.css` `.dark` block.
- Brand guide on this branch already documents both.

## Acceptance criteria

1. Navy top bar (`#1a2130`, text `#f1f4f9`, muted `#9aa5b8`, line `#2c364a`, 3px `#7aa2ff` active underline) on every page, with the pixel "A" logo + "Archon" (Archivo 800 16px).
2. Archivo for all text (800 headings), mono `ui-monospace, Menlo, monospace`, tabular numerals.
3. Light page `#f5f7fa`, surface `#eaeef3`, text `#1a2130`/`#5a6478`/`#98a1b2`, lines `#e2e6ed`/`#c9d0db`, accent `#2563eb`. Code blocks `#1a2130`/`#e6e9f0`.
4. Radius 0, no shadows, no gradients, no glow, no emoji in navigation.
5. Light is the default, dark follows system or the toggle, and dark uses the midnight palette. The forced-dark first-visit script is removed.
6. Section labels 11px uppercase 0.08em; 2px major rules, 1px row rules; selected nav row = 3px accent left bar + selection bg.
7. Existing content, links, search, marketplace filter, and copy behaviour are unchanged.
8. `bun run --filter @archon/docs-web build` passes; screenshots of each page in light and dark checked.

## Non-goals

- No copy rewrite on the landing page; restyle only.
- No change to the docs content beyond what the brand already says.

## Steps

- [x] Shared token sheet `src/styles/site.css` + `PixelLogo.astro` + `SiteHeader.astro` for custom pages
- [x] Starlight theme: `custom.css` tokens, header, sidebar, code, cards; SVG logo; remove forced dark
- [x] Landing page restyle
- [x] Marketplace index + detail restyle
- [x] Roadmap restyle
- [x] Build + screenshots light/dark + commit

## Results

- Production build: 86 pages, no errors. Prettier check passes.
- Screenshots in light and dark at 1280px and 400px for `/`, `/docs/`, a guide, an aside page, `/workflows/`, `/workflows/archon-piv-loop/`, `/roadmap/`, and the search dialog. No page scrolls sideways at 400px.
- Marketplace search and category tabs checked in Playwright: "All" plus one tab per category, one tab active at a time, and search combines with the active tab.
- The landing hero has an example run panel, marked `role="img"` with the label "Example run".
- Marketplace tags are neutral chips. The per-category hex colors in `marketplace.ts` are no longer shown.
