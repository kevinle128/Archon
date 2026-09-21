# Grok interrupt/resume spike evidence (round 2)

- **Overall**: **BLOCKED**
- **Date**: 2026-09-20
- **Issue**: #186
- **CLI version (exact)**: `grok 1.0.34 (3736acbc8658) [stable]`
- **Current stable check**: local --version reports grok 1.0.34 (3736acbc8658) [stable]; treated as current installed stable for this host (changelog not fetched to avoid network coupling in the runner)
- **Binary basename**: `grok`
- **Host**: `darwin/arm64` / `arm64` (native)
- **Bun**: `1.3.14`
- **Chosen M**: `first-stdout-event`
- **Resumed-turn policy**: resumed turns must wait for M (Stop may be requested earlier; signal deferred to M); full request-to-settlement stays under 1000 ms
- **Tree primitives**: POSIX `detached process group (child.pid group) via process.kill(-pid, SIGTERM|SIGKILL)`; Windows `taskkill /PID <pid> /T [/F on escalation] (recorded; proven only on native Windows)`
- **Grace**: interrupt 800 ms / cancel 5000 ms

## Validated build note

Validated build observed this run: grok 1.0.34 (3736acbc8658) [stable]. This is evidence of compatibility, not a minimum supported version.

## Command shape

```text
grok --version
grok --single <nonce-prompt> --verbatim --cwd <temp-git-repo> \
  --output-format streaming-json --permission-mode bypassPermissions \
  --disallowed-tools <node denied_tools> [--tools <allowed_tools>] \
  --no-auto-update \
  [--session-id <uuid>] [--resume <uuid> [--fork-session --session-id <uuid>]]
# owned-tree: detached POSIX process group; Windows taskkill /T tree primitive
# env: GROK_DISABLE_AUTOUPDATER=1
# NOT used for contract evidence: --sandbox workspace
grok sessions delete <uuid>  # disposable cwd only; runner-created UUIDs only
```

## Deliberate diagnostic differences vs production argv

- --no-auto-update flag and GROK_DISABLE_AUTOUPDATER=1 for reproducibility
- --session-id / fork --session-id appended after buildGrokArgs() for identity tests (Phase-2 production seam)
- --sandbox workspace intentionally omitted (changed Linux startup in round one)

## Scenario table

| ID  | Mode       | Trigger            | Passed | Exit | Settlement ms | SIGKILL | Session equal | Markers (cur/inh/fork/src) | Descendants alive |
| --- | ---------- | ------------------ | ------ | ---- | ------------- | ------- | ------------- | -------------------------- | ----------------- |
| B0  | legacy     | —                  | true   | 0    | null          | false   | true          | true/null/null/null        | null              |
| B1  | legacy     | spawn              | false  | 143  | 20            | false   | false         | false/null/null/null       | false             |
| B2  | owned-tree | first-stdout-event | true   | 143  | 304           | false   | false         | true/null/null/null        | false             |
| B3  | owned-tree | first-stdout-event | true   | 143  | 331           | false   | false         | true/true/null/null        | false             |
| B4  | owned-tree | first-stdout-event | true   | 143  | 302           | false   | false         | true/true/true/true        | false             |
| B5  | owned-tree | first-stdout-event | true   | 143  | 261           | false   | false         | true/null/null/null        | false             |
| B6  | legacy     | pid-file           | true   | 143  | 11322         | false   | false         | true/null/null/null        | true              |
| B7  | owned-tree | pid-file           | false  | 143  | 9951          | false   | false         | true/null/null/null        | true              |
| B8  | legacy     | —                  | true   | 0    | null          | false   | true          | null/null/null/null        | null              |
| B9  | owned-tree | pid-file           | false  | 143  | 14045         | false   | false         | null/null/null/null        | true              |
| W1  | legacy     | —                  | false  | null | null          | false   | null          | null/null/null/null        | null              |

### Event types (no payloads)

- **B0**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, end
  - notes: firstEventType=available_commands
- **B1**: (none)
  - notes: negative-control resumeMarker=false settlementMs=20
- **B2**: available_commands, available_commands
  - notes: probe:first-stdout-event/text-only=pass settle=304 | probe:first-stdout-event/reasoning-first=pass settle=322 | probe:first-stdout-event/tool-first=pass settle=293
- **B3**: available_commands, available_commands
  - notes: firstEventType=available_commands | deferredSettlementMs=331 immediateAtMSettlementMs=271
- **B4**: available_commands, available_commands
  - notes: firstEventType=available_commands
- **B5**: available_commands, available_commands
  - notes: firstEventType=available_commands | firstEventType=available_commands | firstEventType=available_commands
- **B6**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, tool_call, tool_call_update, tool_call_update
  - notes: firstEventType=available_commands | legacy-child-alive=true (comparison only)
- **B7**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, tool_call, tool_call_update, tool_call_update
  - notes: firstEventType=available_commands | B7 childAlive=true marker=true settlement=9951
- **B8**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, end
  - notes: firstEventType=available_commands | natural-end-wins-without-kill
- **B9**: available_commands, available_commands, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, tool_call, tool_call_update, tool_call, tool_call_update, tool_call_update, tool_call_update, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, thought, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, available_commands, usage, tool_call, tool_call_update, tool_call_update
  - notes: firstEventType=available_commands | B9 childAlive=true signalToExitMs=35
- **W1**: (none)
  - notes: host-unavailable-pending-operator-evidence

## Latency summary (request→settlement)

| Turn kind | n   | min ms | median ms | max ms | all <1000 | failures |
| --------- | --- | ------ | --------- | ------ | --------- | -------- |
| new       | 10  | 293    | 311       | 318    | true      | 0        |
| resumed   | 10  | 268    | 277       | 289    | true      | 0        |
| forked    | 10  | 298    | 307       | 325    | true      | 0        |

## Release gates

| ID         | Gate                                                             | Status      | Evidence                                                                                                                            |
| ---------- | ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| B0         | New assigned session completes naturally                         | **PASS**    | exit=0 sessionEqual=true marker=true                                                                                                |
| B2         | Earliest safe boundary M with current-prompt retention           | **PASS**    | M=first-stdout-event b2passed=true                                                                                                  |
| B3         | Resumed turn Stop retains inherited+current markers under 1000ms | **PASS**    | markers=true settlement=331                                                                                                         |
| B4         | Forked turn Stop retains source+fork markers; source unchanged   | **PASS**    | forkMarkers=true sourceOk=true settlement=302                                                                                       |
| B5         | Repeated Stop retains all markers on one session                 | **PASS**    | markers=true                                                                                                                        |
| B7         | Owned-tree mid-tool Stop reaps exact descendants                 | **BLOCKED** | descendantsAlive=true marker=true                                                                                                   |
| B8         | Natural completion wins Stop race without kill                   | **PASS**    | exit=0 escalation=none                                                                                                              |
| B9         | Node-Cancel tree termination reaps descendants                   | **BLOCKED** | descendantsAlive=true signalToExitMs=35                                                                                             |
| LAT        | ≥10 new+resumed+forked samples all request-to-settlement <1000ms | **PASS**    | new:n=10 min=293 med=311 max=318 ok=true; resumed:n=10 min=268 med=277 max=289 ok=true; forked:n=10 min=298 med=307 max=325 ok=true |
| HOST-MAC   | Native macOS B0–B9 evidence                                      | **BLOCKED** | native=true M=first-stdout-event                                                                                                    |
| HOST-LINUX | Native Linux B0–B9 evidence                                      | **BLOCKED** | host-unavailable-pending-operator-evidence                                                                                          |
| W1         | Native Windows B0–B9 via real .exe/.cmd launch path              | **BLOCKED** | host-unavailable-pending-operator-evidence                                                                                          |

## Cleanup

- sessions deleted: 53 (UUIDs omitted when delete succeeded)
- sessions delete failed: 0
- temp dir removed: true

## Verdict

- Chosen M on this host: first-stdout-event.
- Native Linux evidence unavailable in this environment — HOST-LINUX BLOCKED.
- Native Windows evidence unavailable in this environment — W1 BLOCKED.
- Do not flip GROK_CAPABILITIES.interrupt until B0–B9 pass on native macOS+Linux and W1 on native Windows.
- One successful build is a validated build, not a minimum-version floor — no doctor rejection from this phase.

## Sanitization

No credentials, prompts, markers, model text, session contents, home paths, raw stderr, or env values. Session UUIDs listed only on delete failure. Descendant fingerprints use pid+start-time only.
