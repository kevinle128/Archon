# Agent Node Room completion — todo

Plan: plans/260926-1521-agent-node-room-completion/plan.md

## Phases

- [x] A — 3.1, 3.2, 3.3, 10.1 merged (4e84d1c3); overflow regression fixed by me (a9354f7e)
- [x] A2 — loop execution dedupe + mockup header merged (f1795a8f); [hidden] vs flex fix (aed984b0)
- [ ] QA — independent visual QA of every mockup state (8 sub-states × prompt/loop × Console/Legacy) after B-UI
- [x] B — durable steering + Stop backend merged (b14a0b8a); check:schema-upgrades OK. Live Stop→idle→Send now not yet proven on a real run (B-UI/F1 must prove)
- [x] C1 — 4.2–4.4 merged (a281aaf3). Chat outcome plumbing fixed by me
- [x] F2 — 4.1, 8.4, 8.6 merged; Codex + DeepSeek interrupt=stream-abort proven live (DeepSeek via alibaba/deepseek-v4.1-flash)
- [ ] 10.4 — capability-driven interrupted tool status (Codex never ⚠) — agent story-10-4
- [x] D — 6.1–6.3 merged (453f4065) + post-merge field fix (4092b2e8). Open: non-Claude thinking delta folding (see phase-d-report) → F1/F2
- [x] E — 5.1, 5.2 merged (d25f185a). check:schema-upgrades OK on develop-2 after E merge; rerun after B and D merge
- [x] F1 merged: Claude deliveryAck=true (replay-user-messages), Claude softInjection=false (disproven incl. priority:'next'); shared soft-injection seam wired
- [ ] 8.7 OMP Stop via RPC mode — agent omp-rpc
- [ ] 8.5 Grok Stop / interject — agent grok-stop
- [ ] B-UI — type fix cherry-picked (be35cdb2, web tsc + tests green); remaining wiring by agent phase-b-ui-2

## Background processes started by this session

- mockup static server: PID 48474 port 8791
- isolated API server: PID 68792 port 3317 (ARCHON_HOME=scratchpad/archon-home)
- docker postgres: container archon-schema-check-c3af on 127.0.0.1:55432 (run check with PATH=/opt/homebrew/opt/libpq/bin:$PATH PGHOST=127.0.0.1 PGPORT=55432 PGUSER=pgcheck PGPASSWORD=pgcheck)
- web dev server: PID 63192 port 5187

## Review
