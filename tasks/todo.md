# Agent Node Room completion — todo

Plan: plans/260926-1521-agent-node-room-completion/plan.md

## Phases

- [x] A — 3.1, 3.2, 3.3, 10.1 merged (4e84d1c3); overflow regression fixed by me (a9354f7e)
- [x] A2 — loop execution dedupe + mockup header merged (f1795a8f); [hidden] vs flex fix (aed984b0)
- [x] QA report committed (f34387f4): 2 major, 6 minor, 2 cosmetic
- [x] VQ fixes merged (VQ-1..VQ-9)
- [x] B — durable steering + Stop backend merged (b14a0b8a); check:schema-upgrades OK. Live Stop→idle→Send now not yet proven on a real run (B-UI/F1 must prove)
- [x] C1 — 4.2–4.4 merged (a281aaf3). Chat outcome plumbing fixed by me
- [x] F2 — 4.1, 8.4, 8.6 merged; Codex + DeepSeek interrupt=stream-abort proven live (DeepSeek via alibaba/deepseek-v4.1-flash)
- [x] 10.4 merged; validate green on develop-2
- [x] D — 6.1–6.3 merged (453f4065) + post-merge field fix (4092b2e8). Open: non-Claude thinking delta folding (see phase-d-report) → F1/F2
- [x] E — 5.1, 5.2 merged (d25f185a). check:schema-upgrades OK on develop-2 after E merge; rerun after B and D merge
- [x] F1 merged: Claude deliveryAck=true (replay-user-messages), Claude softInjection=false (disproven incl. priority:'next'); shared soft-injection seam wired
- [x] 8.7 OMP RPC-mode Stop merged (1263b93f); live 3/3 on grok-4.5 + gpt-5.6-sol; validate green
- [x] 8.5 Grok ACP transport merged; Stop verified live. Interject = follow-up semantics (softInjection false)
- [x] Per-turn interruptibility signal merged (turn_not_interruptible chunk)
- [x] B-UI merged (7e30d6e7): draft/auto-send/per-item Send now/recovery wired in both shells
- [x] B-UI follow-ups merged (Legacy focus anchor, queue-convergence e2e on draft API)
- [x] agent-interrupt-redirect e2e 11/11 merged. Note: agent-withdraw-guidance.spec.ts ~566 may be stale (422 vs recovery) — check in final gate
- [x] e2e gate merged: 150 pass / 1 flaky / 4 skipped (baseline 98/53)
- [x] e2e residual merged: scroller min-height floor, strict todo assertion restored, withdraw drain deterministic (40/40)
- [x] e2e UI suite 153 pass / 0 fail / 4 skipped (merged)

- [x] QA round 2 report (visual-qa-2): 1 blocker, 2 major, 7 minor, 2 cosmetic; round-1 fixes hold
- [x] QA2 engine fixes merged (steered turns keep attempt identity, rejected retry side effects, blank Send now drains queue, blocked Claude tool ◐, Files changed after retry) — agent qa2-engine
- [x] QA2 web fixes merged (delivered state, run N of M, loop max caption, actor name, Codex body bar, wrapper in body, TaskCreate/TaskUpdate todos, header cosmetics, placeholder) — agent qa2-web
- [x] QA round 3 report: all prior findings fixed; 2 major + 5 minor new
- [x] QA3 fixes merged (6f1b352b); e2e 153/0/4; real Claude+Grok evidence
- [x] QA round 4: REJECT (2 major, 3 minor, 4 cosmetic); all 28 earlier findings hold
- [x] QA4 fixes merged; e2e 153/0/4. Executor mid-tool cancel latency left as follow-up (queue now stays visible)
- [x] QA round 5: REJECT (1 major, 1 minor, 2 cosmetic); all VQ4 fixes hold
- [x] QA5 fixes merged; e2e 154/0/4; cross-shell recovery 0.8–1.3 s (Claude, Codex live)
- [x] Cancel detection during silent tool merged: Abandon → node_failed 84s → 1.3s (Claude live); e2e 153/0/4
- [x] QA round 6: REJECT (1 major, 2 minor, 2 cosmetic); all VQ5 fixes hold; abandon 0.15–2.7 s
- [x] QA6 fixes merged; e2e 154/0/4; pill border colors tokenized + brand guide
- [x] QA round 7: REJECT (0 major, 3 minor, 1 cosmetic); all VQ6 fixes hold
- [x] QA7 fixes merged; e2e 154/0/4; validate green
- [x] QA round 8: REJECT (2 major incl. raised VQ8-2, 2 minor, 1 cosmetic); all VQ7 fixes hold except s8 focus
- [x] QA8 fixes merged (loop steering stamp, follow-live, focus, optimistic send, ACP child reap); validate green; e2e 158/0/4. DeepSeek reap not yet live-verified → QA9
- [x] QA round 9: REJECT (0 major, 2 minor, 1 cosmetic); all VQ8 fixes hold; child reap verified on all providers incl. DeepSeek
- [x] QA9 fixes merged (Codex descendant reap, recovered-node abandon terminal state + SSE routing, band frame); validate green; e2e 158/0/4
- [x] QA round 10: REJECT (0 major, 3 minor); all VQ9 fixes hold except the two partial paths
- [x] QA10 fixes + 7.5 failed auto-dispatch merged; validate, check:schema-upgrades, e2e 158/0/4 green on develop-2
- [x] QA round 11: REJECT (0 major, 2 minor, 1 cosmetic); all VQ10 fixes hold; 7.5 verified live
- [x] QA11 fixes (Legacy false recovery on node end, observer never-sent frame, retry copy) — merged; e2e 158/0/4
- [x] QA round 12: REJECT (3 minor, 1 cosmetic); all VQ11 fixes hold; provider matrix pass
- [x] QA12 fixes (abandon band gap, stale Running pill, loop-boundary focus, Legacy post-Send-now dock) — merged; e2e 158/0/4
- [x] QA round 13: REJECT (1 minor: room replaced by run error page during outage; 2 cosmetic); all VQ12 fixes hold; provider matrix pass
- [x] QA13 fixes (keep room through outage, first-load dock settling, Legacy terminal-edge dock refresh) — merged; e2e 158/0/4
- [x] QA round 14: REJECT (1 minor: single-slot dashboard stream evicts subscribers; 1 cosmetic); all VQ13 fixes hold; provider matrix pass
- [x] QA14 fixes (dashboard stream fan-out, survivor-tab dock gate) — merged; e2e 158/0/4
- [x] QA round 15: **ACCEPT** (0 major, 0 minor, 1 cosmetic accepted); provider matrix pass on all six providers
- [ ] Per-item `Send now` while generating (mockup default state). Missing because the Claude spike used `maxTurns: 1`; the corrected spike is verified 3/3. Owner: agent soft-inject
- [ ] QA round 16 on per-item Send now + regression (Verdict: ACCEPT required)

## Background processes started by this session

- mockup static server: PID 48474 port 8791
- isolated API server: PID 68792 port 3317 (ARCHON_HOME=scratchpad/archon-home)
- docker postgres: container archon-schema-check-c3af on 127.0.0.1:55432 (run check with PATH=/opt/homebrew/opt/libpq/bin:$PATH PGHOST=127.0.0.1 PGPORT=55432 PGUSER=pgcheck PGPASSWORD=pgcheck)
- web dev server: PID 84922 port 5187 (PORT=3317 VITE_API_PORT=3317)

## Review

- Final state: develop-2 has every phase and every QA-fix round merged. `bun run validate` is green, `check:schema-upgrades` passes, and the last full e2e run was 158 pass, 0 fail, 4 skip. Visual QA round 15 returned ACCEPT.
- Background processes: the mockup server on 8791 is stopped. The user's server on 3090 was restarted by this session as a background task, so it stops when the session ends.

# Remove console, restore root routes, 4 redesign directions (2026-09-30)

- [x] Remove `/console` route + TopNav "Try the new console UI" CTA; `/` redirects to `/chat`
- [x] Classic UI back at root: `/chat`, `/dashboard`, `/workflows`, `/workflows/builder`, `/workflows/runs/:runId`, `/settings` (no `/legacy`)
- [x] Strip `/legacy` prefix from 24 web files + tests; update `docs-web/adapters/web.md`
- [x] Verify: web tests 0 fail, type-check, eslint, prettier; browser check of `/`, `/workflows`, nav hrefs
- [x] Step 1a: logo locked by owner = L4 Pixel (from `logo-color-board-v2.html`)
- [x] Step 1b (REVERSED by owner, "not wow enough"): style = S11 Grid Mono (owner, 2026-09-30): S4 Grid Brutal structure and fonts (grid paper, 3px ink borders, Archivo Black + Space Mono), no drop shadows, S8 colors (#F2F2EF, #111111, Klein blue #1F2BFF). See `pixel-styles-board.html#S11`
- [x] Step 1c: wow round built: 8 art-directed styles W1-W8 + showroom `wow/index.html`; each verified in headless Chromium (no JS errors, no overflow, waiting-state screenshots); W5 logo contrast and showroom font/dissolve fixes applied
- [x] Step 1d: owner found W1-W8 too much ("làm hơi quá", no heavy animation) and asked to go back to the S1-S8 pixel board; board restored to 8 styles (S9-S11 only with #all). W files kept untouched
- [x] Step 1e: owner picked L4 Pixel + S8 Swiss Pixel with borders, built as S12 Swiss Pixel Border (2px ink borders on frame, nav, panels, node rows; flat, no grid, no shadow); AA verified
- [x] Step 1f: S12 Swiss Pixel Border locked by owner; spec in `plans/260930-1702-ui-redesign-directions/s12-design-spec.md`
- [x] Step 2: full-screen S12 mockup built in `s12-screens.html` (6 screens, real API data, verified in headless Chromium: no errors, no overflow); private local paths and another org's repo name replaced with sample values
- [x] Step 2b: owner rejected S12 screens; switched to ui-ux-pro-max "AI-Native UI + Minimalism" (spec `ai-native-minimal-spec.md`, logo L4 Pixel kept)
- [x] Step 2c: AI-native minimal mockup `ai-native-screens.html` built; verified light + dark in headless Chromium (no errors, no dashes, no private paths)
- [x] Step 2d: owner approved the AI-native screens ("code cho tôi phiên bản này")
- [x] Step 3: plan approved by owner (all 8 phases)
- [x] Phase 1-2 foundation + sidebar shell committed (ca44f10e); route cleanup (307768b0); plans (f21d1daf)
- [x] Phases 3-7 committed: builder 57d55bd7, dashboard+workflows 52d9433c, chat 90a83b88, run detail 4555d1b6, settings+console port 29ce10b8; web tests all green
- [x] Phase 8 committed (6d6dc184 core reviewUrl fix, 904546c5 console removal + polish, e27bd941 docs, cdd79711 e2e routes); bun run validate EXIT 0
- [ ] Gap: console-only features not yet in the new UI: workflow ENV overlay manager + picker, run cost strip + per-node usage breakdown; 21 HITL e2e specs still target console markup (owner decision pending)
- [ ] Docs-site binaries still show the old shield logo (packages/docs-web/src/assets/logo.png, public/favicon.png)
- [ ] Step 3: after owner approves screens, plan the implementation in packages/web (tokens in index.css, brand guide update per AGENTS.md)
- [ ] Decision for user: delete `packages/web/src/experiments/console/` (308 files) in follow-up; move `install-happy-dom` test helper to `src/test/` first
- [ ] Decision for user: console-only features now have no UI (provider keys, GitHub connect, model tiers/aliases, per-user AI prefs, cost page); port into classic Settings/Dashboard or into the redesign
