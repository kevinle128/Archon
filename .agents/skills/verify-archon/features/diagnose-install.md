# Diagnose the install

Diagnose the install lets a user confirm Archon can see a database, a writable home, bundled defaults, and (when a server is up) a live HTTP health payload before they trust any other feature.

## Sub-features

- `doctor-cli` prints the setup checklist from the same process a user runs.
- `doctor-health` returns `GET /api/health` with `status: "ok"` from the launched server.
- `doctor-instance` confirms the listener is this run's PID, port, and isolated `ARCHON_HOME`.
- `doctor-provider-gaps` records skipped or failed AI-binary checks without treating them as instance death on an offline VM.

## How to get to it (user POV)

- Run `archon doctor` or `archon doctor --full` in a terminal (from source: `bun run cli doctor`).
- Open the web console; Settings and run-card IDE affordances fetch `GET /api/health`. Session boot uses `GET /api/auth/status`, not health.
- `curl` `http://127.0.0.1:<port>/api/health` (default product port 3090; verification default 13090).

## Driving it with verify-archon

Preconditions:

- Local target: `verify-archon launch` has reached ready, or Mini remote URL is reachable.
- `verify-archon doctor` has not yet been treated as green for this session.

- **Instance doctor.** Ask whether this process is worth driving. Run `verify-archon doctor --json`. Exit code `0`, `ok` is true, some `checks[]` entry has `name` `"health"` and `status` `"pass"`, and `baseUrl` matches the launched port (or the Mini URL). The helper does not emit a top-level `health` object.
- **CLI checklist.** Run the user command. Run `verify-archon cli -- doctor`. Transcript records each `✓` / `○` / `✗` line. Database, workspace writable, and bundled defaults must pass. Claude/Codex/Grok/gh may fail or skip on a cloud VM.
- **HTTP health.** Fetch the public health route. Run `verify-archon http /api/health`. Status `200`, body `status` is `"ok"`, `adapter` is `"web"`, `is_docker` is `false` on this host-native bun server.
- **Proof.** Keep both payloads. The evidence dir contains `doctor.cli.txt` and `health.http.json`. A second `verify-archon http /api/health` still returns `"ok"` after the CLI doctor.

## Gotchas

- `archon serve` from source exits with "compiled binaries only" and tells the user to run `bun run dev`. API-only verification still launches `bun run dev:server` (or `bun packages/server/src/index.ts`).
- `/api/health` stays reachable even when the optional Better Auth API gate is on. A 401 on `/api/workflows` is not a failed health check.
- Empty `DATABASE_URL` selects SQLite at `$ARCHON_HOME/archon.db`. A leftover Mini `DATABASE_URL` in the process environment would aim the local server at Postgres — the helper forces an empty `DATABASE_URL` for the local target.
- Do not treat a missing Claude binary as proof the server is down. Re-run instance doctor after any failed drive.
