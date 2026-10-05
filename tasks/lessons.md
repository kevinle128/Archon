# Lessons

- When a workflow author supplies a provider-specific model reference as one string, preserve that exact string in workflow YAML. Do not reinterpret or split it into provider-internal routing fields unless the user explicitly requests that transformation. Let the selected provider own model-reference handling; use the E2E result to expose any provider contract defect.
- Do not infer that a missing provider API-key environment variable means the upstream harness is unauthenticated. Check subscription/OAuth/token-plan login state first. A provider adapter must not reject before launching an upstream harness that owns a valid ambient login flow.
- Before hard-coding an E2E model reference, confirm the exact requested model variant. If the user corrects it, rename the workflow and file too so test identity cannot drift from the model under test.

## 2026-09-26 — Scope is not limited to what a mockup draws

- Mistake: read "some features are not in the mockup, e.g. providers" as "providers are out of scope".
- Rule: a feature the mockup does not draw can still be in scope when it is configured elsewhere (for example, the provider is set in the node config). Before cutting scope from a user remark, confirm the direction ("do you mean skip X, or also build X?").

## 2026-09-26 — Verify merged UI in a real browser, not only the agent's screenshots

- Mistake: Phase A's own screenshots looked right, but after merge the run log column overflowed to ~6600px (flex child without `min-w-0`) and hid the fixed-width room.
- Rule: after each UI merge, open the real app at a common width and measure `scrollWidth` vs `innerWidth`; a "deep link does not open" report can be an off-screen layout bug.

## 2026-09-29 — Stop processes only by exact PID or port you own

- Mistake: a delegate matched `pgrep -f "bun --watch src/index.ts"` to stop its own scratch server and killed the user's own dev server (port 3090/5173, another worktree, real ~/.archon).
- Rule: never select processes by command-line pattern. Record the PID when starting a process, or resolve it with `lsof -tiTCP:<own port> -sTCP:LISTEN`, and stop only that PID. Put this rule in every delegate brief that starts servers.

## Isolated web servers need both API port variables (2026-09-30)

- Pattern: briefs started Vite with `PORT=<api>` only. Vite's proxy used it, but Console opens its live streams directly on `VITE_API_PORT`, whose default is 3090, the user's server. Round 14 found Console streams reaching 3090 for about 15 minutes.
- Rule: every isolated web server is started with `PORT=<api> VITE_API_PORT=<api>`. Before measuring anything, confirm in the browser network log that Console's streams go to that API port.

## A feature the mockup shows by default must never be dropped silently as "accepted drift" (2026-09-30)

- Pattern: the mockup's default state (`softInject: true`, "claude · soft-inject") shows a per-item `Send now` while the agent is generating. The readiness report kept it in scope (M008). A provider spike then set `softInjection: false` everywhere. From round 2 on, QA only checked that the button was absent, and the coordinator listed it as accepted drift. The goal was then reported as "all mockup features done", but the user never approved that drift.
- Rule: when a capability spike removes a behavior that the mockup shows, stop and ask the user before accepting the gap. Report it as a missing feature, never as accepted drift, and never claim "đủ tính năng" while a mockup behavior has no working implementation.

## "Redesign everything" means push the range, not four safe variants (2026-09-30)

- Pattern: the owner asked for a full redesign (colors, fonts, logo). The first logo and palette board offered four restrained, enterprise-safe options (geometric monograms, one muted accent each). The owner rejected it as "not special enough" and asked for a young, dynamic, creative style.
- Rule: when the owner opens the whole visual identity, the first option set must span a wide range, including at least two bold options (mascot or character mark, multi-color signature, texture, motion). Ask for the vibe words before building if the brief gives none; do not default to the dashboard-safe aesthetic.

## "Wow" for a product UI means a strong identity on a usable screen, not a theatre piece (2026-09-30)

- Pattern: after "not special enough", the owner asked for something that makes them say wow. The next round swung to eight theatrical pages (particle fields, RPG maps, isometric cities, collage) and the owner said it went too far. Two corrections in a row, in opposite directions.
- Rule: when the owner rejects one extreme, the next round steps one notch, not to the other extreme. For a daily-use tool, keep the creative energy in identity (logo, color, type, one signature texture or motion) and keep the working screens clean and scannable. Show a middle option next to any bold one so the owner can point at the level they want.

## Inventory every feature of code you propose to delete, from the code, before asking for approval (2026-09-30)

- Pattern: before asking the owner to approve deleting the console UI, I listed its "console-only features" from a grep for settings-style endpoints (provider keys, GitHub, tiers, aliases, cost). The cleanup phase later found more console-only features: the workflow ENV overlay manager and picker, the run cost strip and per-node usage breakdown, and the console-scoped HITL e2e specs. The owner approved the deletion on an incomplete list.
- Rule: before proposing to remove a UI surface, inventory it from its routes and components (every route, every panel, every API call it makes), compare against the replacement, and list each gap in the approval question. Grepping for the features you already expect is not an inventory.

## Verify a delegate's "feature is missing" claim in the code before telling the owner (2026-09-30)

- Pattern: an e2e agent deleted the console Reply tests and called Reply a lost feature. I repeated that to the owner as a missing feature. Reading the code later showed the run page's Chat tab already sends replies to the parent conversation; only the test coverage was gone.
- Rule: before reporting a feature as missing or lost, find where it lived, grep the replacement for the same API call or user-visible text, and state what is actually gone (the behavior, or only its tests).
