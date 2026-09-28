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
- [ ] QA6 fixes (tool ids unique per execution for all providers + turn-safe pairing, cancelled node terminal event, Legacy abandon queue visibility, pill metrics, immediate sending row) — agent qa6-fixes
- [ ] QA round 7 (final acceptance, Verdict: ACCEPT required)

## Background processes started by this session

- mockup static server: PID 48474 port 8791
- isolated API server: PID 68792 port 3317 (ARCHON_HOME=scratchpad/archon-home)
- docker postgres: container archon-schema-check-c3af on 127.0.0.1:55432 (run check with PATH=/opt/homebrew/opt/libpq/bin:$PATH PGHOST=127.0.0.1 PGPORT=55432 PGUSER=pgcheck PGPASSWORD=pgcheck)
- web dev server: PID 63192 port 5187

## Review
