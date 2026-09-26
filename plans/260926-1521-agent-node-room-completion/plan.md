# Agent Node Room — complete the approved mockup contract

Status: in progress
Branch: `develop-2` (local commit per story after `bun run validate`; no push)

## Outcome

Console (520 px) and Legacy (460 px) Node Rooms match the approved mockups in
`claude-design/design_handoff_node_room_transcript_steering/`, and every behavior the
mockups and `_bmad-output/specs/spec-agent-node-room/` define works end to end.

## Scope decisions (user-confirmed 2026-09-26)

- In scope: Epic 3, 4, 5, 6, 7, 8 (8.1–8.8), 10.
- Out of scope: Epic 9 (Qoder CLI, Pi, GitHub Copilot, OpenCode).
- Providers are in scope even though the mockup does not draw them (provider is node config).
  Claude, Codex, Grok, DeepSeek and OMP are logged in with subscriptions: verify on real binaries.
- Advisor notification (6.3) = Claude SDK server-side advisor tool (`advisorModel`) output.
- Soft injection / delivery ack per provider: ship what the adapter can prove; unproven stays false (8.8).

## Already done (verified in code, do not rebuild)

- Steering routes send/interrupt/keepalive/withdraw/queue-read registered (`packages/server/src/routes/api.ts:5397-5771`).
- Operator rows (`origin='operator'`), finished-iteration read-only dock, never-sent reconciliation,
  30-min idle timer, todo strip, Raw toggle, inline diffs (Epic 1–2 commits).

## Design decisions

- New transcript sources (thinking, prompt, advisor) reuse `kind: 'text'` rows with an additive
  `metadata.origin` value. The table has `CHECK (kind IN ('text','tool','status'))` in both
  dialects (`migrations/000_combined.sql:750`, `sqlite.ts:1109`); a new kind would need a SQLite
  table rebuild, which the additive-only rule forbids. This mirrors the operator-row precedent.

## Phases

| Phase                           | Stories                       | Status |
| ------------------------------- | ----------------------------- | ------ |
| A — Room anatomy and a11y       | 3.1, 3.2, 3.3, 10.1           | todo   |
| B — Durable steering + Stop     | 7.1–7.5, 8.1, 8.2, 10.2, 10.3 | todo   |
| C — Readable tools everywhere   | 4.1–4.4, 10.4                 | todo   |
| D — Agent context rows          | 6.1–6.3                       | todo   |
| E — Files changed + attribution | 5.1, 5.2                      | todo   |
| F — Providers on real binaries  | 8.3–8.8                       | todo   |

## Acceptance

- Epic acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
- Visual check against each mockup state (8 sub-states × node kinds) at 520 / 460 px.
- `bun run validate` green per story.

## Evidence

Scout reports (partly inaccurate — verify every claim): `plans/reports/scout-260926-1516-*.md`.
