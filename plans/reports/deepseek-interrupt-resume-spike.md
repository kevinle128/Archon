# DeepSeek interrupt → close → resume spike

**Story:** US-001 / Issue #187 / Agent Node Room 2.7  
**Date:** 2026-09-20  
**Pins:** `@deepseek-ai/dsh@0.1.2-rc.1`, `@agentclientprotocol/sdk@1.4.0`

## Operator command

```bash
cd packages/providers
DEEPSEEK_LIVE_TEST=1 \
DEEPSEEK_API_KEY=… \
DEEPSEEK_BASE_URL=… \
DEEPSEEK_LIVE_MODEL=… \
bun run spike:interrupt:deepseek
```

Script: `packages/providers/src/community/deepseek/interrupt-resume-spike.ts`  
Package script: `spike:interrupt:deepseek` (not exported, not wired into CI)

## Dependency pin check

Installed versions match package pins when the script runs under `DEEPSEEK_LIVE_TEST=1` (fails non-zero on mismatch).

| Package                    | Pin          | Observed this run |
| -------------------------- | ------------ | ----------------- |
| `@deepseek-ai/dsh`         | `0.1.2-rc.1` | `0.1.2-rc.1`      |
| `@agentclientprotocol/sdk` | `1.4.0`      | `1.4.0`           |

## Sanitized JSON (this environment)

Live credentials (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_LIVE_MODEL`) were **not** available in the implementing agent environment. The spike correctly refused to start a live turn and emitted:

```json
{
  "schemaVersion": 1,
  "dshVersion": "0.1.2-rc.1",
  "acpSdkVersion": "1.4.0",
  "interrupt": null,
  "resume": null,
  "outcome": "Block",
  "failureCategory": "missing-env",
  "toolMappingDecision": "incomplete",
  "notes": [
    "Requires DEEPSEEK_LIVE_TEST=1, DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_LIVE_MODEL."
  ]
}
```

No prompt text, model output, credentials, base URLs, env contents, session ids, or raw tool payloads were logged.

## Outcome

**Block** — live pinned-runtime gate could not run without operator credentials.

Proceed criteria (for a future operator re-run) remain:

- `interruptAckMs < 1000`
- abort result carries session id with exact triple `{ stopReason:'aborted', isError:true, errorSubtype:'deepseek_aborted' }` (no `terminalReason`)
- `session/close` completes
- resume reports `resumed === true`
- non-error continuation on the same session id

## Tool-mapping decision

**incomplete / deferred** — no live in-flight tool status was observed.

Unit-level behavior already covered:

- Open tools at interrupt are settled by the executor as `interrupted` (Story 2.3 path).
- Conditional bridge mapping (`failed` → `interrupted` only for first cause `operator-interrupt`) is **not** applied in this story.
- Explicitly recorded as **unnecessary until live evidence shows a cancelled in-flight tool arriving as ACP `status:'failed'` before the abort result**.

`DEEPSEEK_CAPABILITIES.interrupt` remains `false` in this phase (capability flip is US-002 after a Proceed spike).

## Unit gate (this story)

```bash
cd packages/providers
bun test src/community/deepseek/acp-client.test.ts \
         src/community/deepseek/provider.test.ts \
         src/community/deepseek/event-bridge.test.ts
bun run type-check
```

Result: **71 pass / 0 fail**, type-check clean.
