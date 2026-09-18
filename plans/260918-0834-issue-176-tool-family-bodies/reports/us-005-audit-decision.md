# US-005 Audit Decision + Evidence — Read-only generic-fallback audit CLI

**Date:** 2026-09-18
**Artifacts:** `scripts/audit-generic-fallback.ts`, `scripts/audit-generic-fallback.test.ts`
**Authority note:** Phase 3 listed the audit contract as blocked pending human
ratification of corpus, denominator, dialects, access method, record
path/freshness, aggregate privacy, and the PostgreSQL client policy. The PRD's
headless coordination-gate clause resolves that for this workflow: adopt the
plan's recommended decisions when no owner-ratified alternative exists. The
repository contained no such alternative, so the recommended set was adopted
whole and is recorded here.

## Denominator — adopted `logical-tool-cards-v1`

The metric counts **one logical UI tool card per invocation**: rows are grouped
by `(workflow_run_id, node_id)`, ordered by `seq` (id tiebreak), projected
through `projectToolTranscript()`, and each projected `tool-card` is counted
exactly once. Consequences, verified by test:

- modern call/result pairs count once (not twice as raw storage rows);
- pending call-only cards count;
- legacy result-only cards count (result detected via `payload.output !==
undefined`, represented in-process by an inert `Symbol` sentinel — output
  bodies are never selected);
- text/status rows never enter the denominator (SQL filters `kind='tool'`);
- the same tool-use id in a different node or run never cross-pairs.

The raw-row alternative is not implemented — the AC requires a single metric.
`test-plan.md` records the adoption; the field is stamped into every record as
`denominator: "logical-tool-cards-v1"`.

## Access contract

- **No implicit target.** SQLite takes `--sqlite <path>`; PostgreSQL takes
  `--postgres-env <VAR>` (the _name_ of an env var holding the URL, so
  credentials never appear on the command line). `~/.archon` and `DATABASE_URL`
  are never consulted — verified by a subprocess test that sets both and still
  exits 2 with "no corpus specified".
- **SQLite:** `new Database(path, { readonly: true })` + `PRAGMA query_only =
ON`, wrapped in one deferred transaction for a consistent snapshot. No
  `@archon/core` adapter — `SqliteAdapter`'s constructor enables WAL and applies
  schema, i.e. it writes. Known edge, documented in the CLI banner and the
  error: a _cleanly checkpointed_ WAL database has no `-shm`/`-wal` for a
  read-only handle to attach to, so open fails with actionable guidance rather
  than falling back to a write-capable handle or `immutable=1` (which can
  silently ignore WAL sidecars).
- **PostgreSQL:** direct `Bun.sql` client inside `sql.begin` +
  `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`. Never
  `PostgresAdapter` (schema-applying constructor), never the transitive `pg`
  package. Verified live against a real Postgres container: the audit runs, and
  an INSERT inside the same transaction is rejected by the server.

## Projection — output bodies never leave the database

The SELECT projects only: `id`, `workflow_run_id`, `node_id`, `seq`,
`payload.id`, `payload.name`, `payload.input` (always rendered as JSON text —
SQLite via a `json_type` CASE that re-wraps scalars, PG via `(payload ->
'input')::text`), an output-key-present boolean (`json_type(...) IS NOT NULL` /
`jsonb_exists`), and `metadata.tool_phase` / `execution.occurrence_id` /
`execution.attempt_id`. The `output` column value is never selected. An 8 MB
output body test proves the record stays ~1 KB and contains no output content.

## Snapshot, paging, and memory

Rows stream in keyset order `(workflow_run_id, node_id, seq, id)` inside one
snapshot transaction — a call/result pair split across a page boundary still
pairs once (tested at `pageSize: 1`). Memory holds only the current node group
plus aggregates; monotonic group-order validation does not retain prior group
keys. `MAX_NODE_TOOL_ROWS = 10_000` fails closed with the row
identity when a node exceeds it (a transcript that size needs inspection, not a
silent count). A 2 000-row/200-group fixture at `pageSize: 13` verifies the
streaming path end-to-end.

## Fail-closed validation

- Unparseable stored JSON is caught by a pre-scan that reports only row
  identity (`id`, run, node, seq) — never payload text — capped at 10 rows.
- Per-row shape validation (`toPairableMessage`) rejects non-string
  `payload.id`/`name`, non-positive `seq`, `tool_phase` outside `call|result`,
  and unparseable input JSON — each error carries identity, not contents.
- Rows arriving out of group order (a broken page stream) abort the audit.

## Threshold and exits

Integer compare only: `genericCards * 100 >= logicalCards * 2` — exactly 2%
fails, below passes. A zero-card corpus fails closed (a vacuous measurement
cannot prove the gate). Exit codes: **0** pass · **1** policy failure
(threshold breach, or any record-check failure) · **2** invocation error ·
**3** data/access failure.

## Record schema and check mode

`{schemaVersion:1, generatedAt, source, dialect, denominator,
auditSourceSha256, logicalCards, genericCards, fraction, genericNames?}`.
`auditSourceSha256` covers `tool-presentation.ts`, `tool-output.ts`, and
`pair-tool-transcript.ts` — the classification + pairing semantics the number
depends on — so editing those files invalidates old records.

`--check` reads only the record plus those three sources — never a database —
and validates: schema version, denominator tag, non-secret `source`, dialect,
freshness (≤90 days, ≤10 min future skew), source-hash match, nonzero
denominator, `genericCards ≤ logicalCards`, `fraction ===
genericCards/logicalCards` recomputed exactly, `genericNames` shape, then the
threshold. Every check failure is exit 1 (the release cannot prove the bound).

`--record` requires `--source <id>` (a bounded identifier-safe non-secret
corpus identity — paths and URLs are rejected), refuses to target the SQLite
corpus itself, and writes via same-directory temp file + atomic rename with
failure cleanup; no `.tmp` litter survives.

## Aggregate privacy decision

`--include-generic-names` records `{name, cards}` aggregates, count-descending
then name-ascending, capped at 25 entries — but only for bounded ASCII
identifier tokens. Whitespace, slashes, controls, and other path/command
punctuation are counted but never recorded. The checker re-enforces that
privacy rule, order, uniqueness, cap, count consistency, and the record's exact
field allowlist so a hand-edited record cannot smuggle payload or path data.

## Test evidence

`bun test ./scripts/audit-generic-fallback.test.ts` — 45 tests (43 SQLite/CLI,
2 PostgreSQL gated on `ARCHON_AUDIT_TEST_PG_URL` which creates and drops an
isolated database): pairing/denominator semantics, page-boundary pairing,
cross-group isolation, exactly/below/above 2%, print-only default, atomic
record, recomputable record, import-with-no-I/O child process, byte-identical
read-only fixture, no journal/WAL/SHM litter, write rejection, every record
failure mode, malformed-row identity-without-payload, 8 MB output projection,
bounded memory, node ceiling, and no-fallback access failure.
