-- Remote Coding Agent - Combined Schema
-- Version: Combined (final state after migrations 001-020)
-- Description: Complete database schema (idempotent - safe to run multiple times)
--
-- Layout (load-bearing, not cosmetic — see the final section for why):
--   * CREATE TABLE and ALTER TABLE ... ADD COLUMN come first, in feature order.
--   * Everything that NAMES A COLUMN — every CREATE INDEX, every
--     COMMENT ON COLUMN — goes in the final "Indexes and column comments"
--     section, below every ADD COLUMN.
--
-- 24 Application Tables (+ the 4 remote_agent_auth_* Better Auth tables, listed inline below):
--   1. remote_agent_codebases
--   2. remote_agent_codebase_env_vars
--   3. remote_agent_users
--   4. remote_agent_user_identities
--   5. remote_agent_conversations
--   6. remote_agent_sessions
--   7. remote_agent_isolation_environments
--   8. remote_agent_workflow_runs
--   9. remote_agent_workflow_events
--  10. remote_agent_workflow_node_checkpoints
--  11. remote_agent_workflow_node_sessions
--  12. remote_agent_messages
--  13. remote_agent_user_github_tokens
--  14. remote_agent_user_provider_keys
--  15. remote_agent_user_ai_prefs
--  16. remote_agent_schema_version
--  17. remote_agent_workflow_provider_bindings
--  18. remote_agent_workflow_event_outbox
--  19. remote_agent_workflow_event_delivery_attempts
--  20. remote_agent_usage_ledger
--  21. remote_agent_workflow_envs
--  22. remote_agent_workflow_node_messages
--  23. remote_agent_pending_interactions
--  24. remote_agent_workflow_node_execution_evidence
--  25-28. remote_agent_auth_user / session / account / verification (PostgreSQL-only)
--
-- Dropped tables (via migrations):
--   - remote_agent_command_templates (017)
--
-- Dropped columns (via migrations):
--   - conversations.worktree_path (007)
--   - conversations.isolation_env_id_legacy (007)
--   - conversations.isolation_provider (007)

-- ============================================================================
-- Table 1: Codebases
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_codebases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  repository_url VARCHAR(500),
  default_cwd VARCHAR(500) NOT NULL,
  default_branch VARCHAR(255),
  ai_assistant_type VARCHAR(20) DEFAULT 'claude',
  kind VARCHAR(10) NOT NULL DEFAULT 'repo' CHECK (kind IN ('repo', 'folder')),
  allow_env_keys BOOLEAN NOT NULL DEFAULT FALSE,
  commands JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE remote_agent_codebases IS
  'Repository metadata: name, URL, working directory, default branch, AI assistant type, and command paths (JSONB)';

-- ============================================================================
-- Table 1b: Codebase Env Vars
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_codebase_env_vars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(codebase_id, key)
);

COMMENT ON TABLE remote_agent_codebase_env_vars IS
  'Per-project env vars merged into Options.env on Claude SDK calls. Managed via Web UI or config.';

-- ============================================================================
-- Table 1c: Users (Archon identity, platform-agnostic)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255),
  email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE remote_agent_users IS
  'Archon-internal user identity. Created on first sight by any adapter; populated via per-platform user-info lookups.';

-- ============================================================================
-- Table 1d: User Identities (per-platform mapping → users.id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL,
  platform_user_id VARCHAR(255) NOT NULL,
  platform_display_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(platform, platform_user_id)
);

COMMENT ON TABLE remote_agent_user_identities IS
  'Maps platform-native user IDs (Slack U-ids, Telegram chat ids, GitHub logins, Discord snowflakes) to Archon user UUIDs.';

-- ============================================================================
-- Table 2: Conversations
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_type VARCHAR(20) NOT NULL,
  platform_conversation_id VARCHAR(255) NOT NULL,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  cwd VARCHAR(500),
  ai_assistant_type VARCHAR(20) DEFAULT 'claude',
  isolation_env_id UUID,  -- FK added after isolation_environments table exists
  title VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(platform_type, platform_conversation_id)
);

-- ============================================================================
-- Table 3: Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  ai_assistant_type VARCHAR(20) NOT NULL,
  assistant_session_id VARCHAR(255),
  active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  parent_session_id UUID REFERENCES remote_agent_sessions(id),
  transition_reason TEXT,
  ended_reason TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

-- ============================================================================
-- Table 4: Isolation Environments
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_isolation_environments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase_id           UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,

  -- Workflow identification (what work this is for)
  workflow_type         TEXT NOT NULL,        -- 'issue', 'pr', 'review', 'thread', 'task'
  workflow_id           TEXT NOT NULL,        -- '42', 'pr-99', 'thread-abc123'

  -- Implementation details
  provider              TEXT NOT NULL DEFAULT 'worktree',
  working_path          TEXT NOT NULL,        -- Actual filesystem path
  branch_name           TEXT NOT NULL,        -- Git branch name

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'active',  -- 'active', 'destroyed'
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by_platform   TEXT,                 -- 'github', 'slack', etc.

  -- Cross-reference metadata (for linking)
  metadata              JSONB DEFAULT '{}'
);

-- Add FK from conversations to isolation_environments (deferred to avoid circular dependency)
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS isolation_env_id UUID
    REFERENCES remote_agent_isolation_environments(id) ON DELETE SET NULL;

COMMENT ON TABLE remote_agent_isolation_environments IS
  'Work-centric isolated environments with independent lifecycle';

-- ============================================================================
-- Table 5: Workflow Runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name VARCHAR(255) NOT NULL,
  conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  codebase_id UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  current_step_index INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, cancelled, paused
  user_message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  parent_conversation_id UUID REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
  parent_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  working_path TEXT,
  output_root TEXT
);

COMMENT ON TABLE remote_agent_workflow_runs IS
  'Tracks workflow execution state for resumption and observability';

-- ============================================================================
-- Table 6: Workflow Events
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  event_order BIGINT,
  event_type VARCHAR(50) NOT NULL,
  step_index INTEGER,
  step_name VARCHAR(255),
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE remote_agent_workflow_events IS
  'Lean UI-relevant workflow events for observability (step transitions, artifacts, errors)';

-- ============================================================================
-- Workflow node checkpoints (manual failed-node retry setup)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_checkpoints (
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  retry_epoch INTEGER NOT NULL CHECK (retry_epoch >= 0),
  checkpoint_ref TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  created_commit BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_from_node_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (workflow_run_id, node_id, retry_epoch)
);

COMMENT ON TABLE remote_agent_workflow_node_checkpoints IS
  'Per-node git checkpoints used to restore tracked checkout state before manual DAG node retry.';

-- ============================================================================
-- Workflow node sessions (persist_session opt-in across re-runs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_sessions (
  workflow_name VARCHAR(255) NOT NULL,
  node_id VARCHAR(255) NOT NULL,
  scope_key TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_session_id TEXT NOT NULL,
  last_run_id UUID REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (workflow_name, node_id, scope_key, provider)
);

COMMENT ON TABLE remote_agent_workflow_node_sessions IS
  'Per-node provider session IDs persisted across workflow re-runs. Keyed by (workflow, node, scope, provider). Scope is typically conversation UUID. No cascade on conversation delete (soft delete + never-reused UUID = harmless orphans); a future hard-delete path must delete by scope_key.';

-- ============================================================================
-- Table 7: Messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Cleanup: Drop legacy objects from older schemas
-- ============================================================================

-- Drop command_templates table (replaced by file-based commands in .archon/commands)
DROP TABLE IF EXISTS remote_agent_command_templates;
DROP INDEX IF EXISTS idx_remote_agent_command_templates_name;

-- Drop legacy columns from conversations (if upgrading from older schema)
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS worktree_path;
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS isolation_env_id_legacy;
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS isolation_provider;
DROP INDEX IF EXISTS idx_conversations_isolation;

-- Drop legacy constraint from isolation_environments (if upgrading from older schema)
ALTER TABLE remote_agent_isolation_environments
  DROP CONSTRAINT IF EXISTS unique_workflow;

-- ============================================================================
-- Idempotent ALTER statements for upgrading existing databases
-- (These are no-ops on fresh installs since columns exist in CREATE TABLE above)
-- ============================================================================

-- From migration 006: isolation_env_id + last_activity_at on conversations
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS isolation_env_id UUID
    REFERENCES remote_agent_isolation_environments(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- From migration 009: last_activity_at on workflow_runs
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- From migration 010: parent_session_id + transition_reason on sessions
ALTER TABLE remote_agent_sessions
  ADD COLUMN IF NOT EXISTS parent_session_id UUID REFERENCES remote_agent_sessions(id);
ALTER TABLE remote_agent_sessions
  ADD COLUMN IF NOT EXISTS transition_reason TEXT;

-- From migration 013: title + deleted_at on conversations
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- From migration 015: parent_conversation_id + hidden
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_conversation_id UUID
    REFERENCES remote_agent_conversations(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;

-- From migration 016: ended_reason on sessions
ALTER TABLE remote_agent_sessions
  ADD COLUMN IF NOT EXISTS ended_reason TEXT;

-- From migration 021: allow_env_keys on codebases
ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS allow_env_keys BOOLEAN NOT NULL DEFAULT FALSE;

-- From migration 023: detected default branch on codebases
ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS default_branch VARCHAR(255);

-- From migration 024: project kind discriminator ('repo' | 'folder').
-- Folder projects are non-git workspaces (multi-repo roots or plain ops folders)
-- that run in place with named artifact/log storage under _folder/<slug>/.
ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'repo';

-- User identity foreign keys (nullable on the four primary tables).
-- All FKs use ON DELETE SET NULL so future user deletion never cascades destructively.
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_messages
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;
ALTER TABLE remote_agent_isolation_environments
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID
    REFERENCES remote_agent_users(id) ON DELETE SET NULL;

-- Run-tree parent (#2121 Phase 2): a `workflow:` sub-run links back to the run
-- that spawned it. Self-referential FK, ON DELETE SET NULL so deleting a parent
-- orphans children rather than cascade-deleting their audit trail. First
-- self-referential FK on this table — declared identically on SQLite (sqlite.ts).
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS parent_run_id UUID
    REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL;

-- Durable output root (#2200): the resolved `~/.archon/workspaces/<project>/`
-- directory this run's artifacts, logs, and state live under, written once at
-- run start. Readers prefer it and only re-derive from codebase identity when
-- it is NULL (pre-existing rows), so historical artifacts stay addressable
-- across a codebase rename (#1192). Declared identically on SQLite (sqlite.ts).
ALTER TABLE remote_agent_workflow_runs
  ADD COLUMN IF NOT EXISTS output_root TEXT;

-- From PR-C: per-user GitHub user-to-server tokens (device flow), encrypted at rest.
-- One row per Archon user; cascades on user deletion. github_user_id is the
-- numeric anchor for the commit no-reply email (survives username changes).
CREATE TABLE IF NOT EXISTS remote_agent_user_github_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  github_user_id BIGINT NOT NULL,
  github_login VARCHAR(255) NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMP WITH TIME ZONE,
  refresh_token_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Phase 2: per-user AI-provider credentials (BYO API key + subscription login),
-- encrypted at rest with the existing token-crypto key. One row per
-- (user_id, provider); cascades on user deletion. Exactly one of
-- api_key_encrypted / oauth_creds_encrypted is populated per row; `kind`
-- records which. Gated on TOKEN_ENCRYPTION_KEY at the application layer.
CREATE TABLE IF NOT EXISTS remote_agent_user_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  api_key_encrypted TEXT,
  oauth_creds_encrypted TEXT,
  label VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- #1955: credential rows are vendor-keyed (claude→anthropic, codex→openai,
-- copilot→github-copilot) so one credential can serve every agent that
-- consumes the vendor. Idempotent data fix: where both a legacy and a vendor
-- row exist for the same user, the vendor row wins (rare — requires having
-- connected both ids pre-rename); then legacy rows are renamed in place.
-- Tested on SQLite (adapters/sqlite.test.ts covers rename, conflict, and
-- idempotency); the Postgres DML below is the same statements but is NOT
-- covered by an automated test — verified manually on the multi-user smoke.
-- Survivable either way: reads normalize legacy ids (normalizeCredentialVendor).
DELETE FROM remote_agent_user_provider_keys
WHERE provider IN ('claude', 'codex', 'copilot')
  AND EXISTS (
    SELECT 1 FROM remote_agent_user_provider_keys v
    WHERE v.user_id = remote_agent_user_provider_keys.user_id
      AND v.provider = CASE remote_agent_user_provider_keys.provider
        WHEN 'claude' THEN 'anthropic'
        WHEN 'codex' THEN 'openai'
        WHEN 'copilot' THEN 'github-copilot'
      END
  );
UPDATE remote_agent_user_provider_keys SET provider = 'anthropic' WHERE provider = 'claude';
UPDATE remote_agent_user_provider_keys SET provider = 'openai' WHERE provider = 'codex';
UPDATE remote_agent_user_provider_keys SET provider = 'github-copilot' WHERE provider = 'copilot';

-- Phase 3: per-user AI preferences (model tiers, @custom aliases, default
-- assistant). NON-encrypted — model names are not secrets (mirrors
-- codebase_env_vars, not the provider-key store). One row per user; cascades
-- on user deletion. `tiers` / `aliases` are JSON-as-TEXT (parsed in the
-- store layer so SQLite and Postgres behave identically).
CREATE TABLE IF NOT EXISTS remote_agent_user_ai_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
  tiers TEXT,
  aliases TEXT,
  default_provider VARCHAR(64),
  default_model VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- #1998: per-user default CHAT model, written atomically with
-- default_provider (a model pin is only meaningful for the provider it was
-- set with). Idempotent upgrade for installs that created the table before
-- this column existed.
ALTER TABLE remote_agent_user_ai_prefs
  ADD COLUMN IF NOT EXISTS default_model VARCHAR(255);

-- ============================================================================
-- Web auth (opt-in): role on the canonical user + Better Auth tables
-- ============================================================================
--
-- `role` is the durable identity seam: everyone defaults to 'admin' for now;
-- 'member' is reserved for future per-resource scoping. Visibility stays open.
ALTER TABLE remote_agent_users
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'admin';

-- Lifecycle ordering (#2359 follow-up): timestamps can tie, especially on
-- SQLite (one-second precision), so a database-assigned order breaks the tie and
-- preserves event chronology. `id` cannot serve this role — it is a random UUID,
-- not monotonic.
--
-- Deliberately a plain column plus a sequence DEFAULT, NOT `GENERATED ... AS
-- IDENTITY`. Adding an identity column REWRITES the whole table under ACCESS
-- EXCLUSIVE (verified on postgres:18: relfilenode changes), and this is the
-- largest table in the schema while the schema auto-applies on startup — that is
-- a boot-time stall proportional to event history. ADD COLUMN with no default is
-- metadata-only, and SET DEFAULT afterwards applies to future inserts only.
--
-- It also keeps both databases honest: existing rows stay NULL on Postgres AND
-- SQLite, so the COALESCE(event_order, 0) fallback in read queries behaves
-- identically. An identity column would have back-filled Postgres rows (1, 2,
-- 3...) while SQLite left them NULL.
ALTER TABLE remote_agent_workflow_events
  ADD COLUMN IF NOT EXISTS event_order BIGINT;
CREATE SEQUENCE IF NOT EXISTS remote_agent_workflow_events_event_order_seq
  OWNED BY remote_agent_workflow_events.event_order;
ALTER TABLE remote_agent_workflow_events
  ALTER COLUMN event_order SET DEFAULT nextval('remote_agent_workflow_events_event_order_seq');

-- ============================================================================
-- Schema vintage (#2316)
-- ============================================================================
--
-- Which Archon build created this database, and which last applied schema to it.
-- Diagnostic only — nothing gates, refuses, or warns on these values. Single row
-- (id = 1); the row's VALUES are written by the adapters from APP_VERSION
-- (packages/core/src/db/schema-version.ts) so the version string has exactly one
-- source of truth. created_app_version is NULL for databases that predate this
-- table and is never back-filled with a guess.
CREATE TABLE IF NOT EXISTS remote_agent_schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_app_version VARCHAR(64),
  app_version VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE remote_agent_schema_version IS
  'Diagnostic schema vintage: the Archon build that created this database and the one that last applied schema to it.';

-- Better Auth tables (PostgreSQL only). Generated by `@better-auth/cli generate`
-- against packages/server/src/auth/instance.ts (modelName-renamed to the
-- `remote_agent_auth_*` prefix), then made idempotent with IF NOT EXISTS so the
-- bundled-schema auto-apply on startup converges. Better Auth owns these tables
-- and the column shape (text ids, camelCase columns) — Archon never queries them
-- directly; a session is mapped to the canonical remote_agent_users row via
-- user_identities('web', <betterAuthUserId>). Always created on Postgres (the
-- IF NOT EXISTS apply runs on every boot); populated only when web auth is
-- enabled (BETTER_AUTH_SECRET + DATABASE_URL), harmless empty tables otherwise.
CREATE TABLE IF NOT EXISTS remote_agent_auth_user (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_agent_auth_session (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES remote_agent_auth_user ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS remote_agent_auth_account (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES remote_agent_auth_user ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_agent_auth_verification (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- Table 11: Workflow Provider Bindings
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_provider_bindings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,
  name            TEXT NOT NULL,
  codebase_id     UUID NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
  event_route     TEXT NOT NULL,
  event_types     TEXT NOT NULL DEFAULT '[]',
  signing_secret  TEXT,
  transform        TEXT,
  delivery_headers TEXT NOT NULL DEFAULT '{}',
  state           TEXT NOT NULL DEFAULT 'active',
  binding_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (provider, name)
);

COMMENT ON TABLE remote_agent_workflow_provider_bindings IS
  'Provider-neutral reverse event bindings for external controllers';

-- Story 3.5: existing provider-binding tables predate the private signing secret.
ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS signing_secret TEXT;

ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS event_types TEXT NOT NULL DEFAULT '[]';

ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS transform TEXT;

ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS delivery_headers TEXT NOT NULL DEFAULT '{}';

-- ============================================================================
-- Table 12: Workflow Event Outbox
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_event_outbox (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             TEXT UNIQUE NOT NULL,
  idempotency_key      TEXT NOT NULL,
  event_type           TEXT NOT NULL,
  provider             TEXT NOT NULL DEFAULT 'archon',
  workflow_run_id      UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  codebase_id          UUID REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
  binding_id           UUID REFERENCES remote_agent_workflow_provider_bindings(id) ON DELETE SET NULL,
  event_route          TEXT,
  event_body           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  not_routable_reason  TEXT,
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at      TIMESTAMP WITH TIME ZONE,
  next_attempt_at      TIMESTAMP WITH TIME ZONE,
  last_error           TEXT,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE remote_agent_workflow_event_outbox IS
  'Durable non-blocking outbox for external Archon workflow events';

-- ============================================================================
-- Table 13: Workflow Event Delivery Attempts
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_event_delivery_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id   UUID NOT NULL REFERENCES remote_agent_workflow_event_outbox(id) ON DELETE CASCADE,
  attempt_number    INTEGER NOT NULL,
  request_url       TEXT NOT NULL,
  request_method    TEXT NOT NULL DEFAULT 'POST',
  request_headers   TEXT NOT NULL,
  request_body      TEXT NOT NULL,
  response_status   INTEGER,
  response_headers  TEXT,
  response_body     TEXT,
  transport_error   TEXT,
  started_at        TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at      TIMESTAMP WITH TIME ZONE,
  duration_ms       INTEGER,
  outcome           TEXT NOT NULL DEFAULT 'pending'
);

COMMENT ON TABLE remote_agent_workflow_event_delivery_attempts IS
  'Append-only HTTP delivery attempt history for external workflow events';

-- ============================================================================
-- Table 20: Usage Ledger (normalized child of node_usage_recorded events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_event_id UUID NOT NULL REFERENCES remote_agent_workflow_events(id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL CHECK (entry_index >= 0),
  agent_provider TEXT NOT NULL CHECK (agent_provider <> ''),
  provider TEXT NOT NULL CHECK (provider <> ''),
  model TEXT,
  model_source TEXT NOT NULL CHECK (model_source IN ('reported', 'requested', 'unknown')),
  kind TEXT CHECK (kind IS NULL OR kind IN ('advisor', 'subagent')),
  tokens_input BIGINT CHECK (tokens_input IS NULL OR tokens_input >= 0),
  tokens_output BIGINT CHECK (tokens_output IS NULL OR tokens_output >= 0),
  tokens_reasoning BIGINT CHECK (tokens_reasoning IS NULL OR tokens_reasoning >= 0),
  tokens_cache_read BIGINT CHECK (tokens_cache_read IS NULL OR tokens_cache_read >= 0),
  tokens_cache_write BIGINT CHECK (tokens_cache_write IS NULL OR tokens_cache_write >= 0),
  requests BIGINT CHECK (requests IS NULL OR requests > 0),
  cost_usd DOUBLE PRECISION CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_estimated_usd DOUBLE PRECISION CHECK (cost_estimated_usd IS NULL OR cost_estimated_usd >= 0),
  pricing_source TEXT CHECK (pricing_source IS NULL OR pricing_source IN ('config', 'catalog')),
  UNIQUE (workflow_event_id, entry_index),
  -- At least one token, request, reported-cost, or estimated-cost measure.
  CHECK (
    tokens_input IS NOT NULL
    OR tokens_output IS NOT NULL
    OR tokens_reasoning IS NOT NULL
    OR tokens_cache_read IS NOT NULL
    OR tokens_cache_write IS NOT NULL
    OR requests IS NOT NULL
    OR cost_usd IS NOT NULL
    OR cost_estimated_usd IS NOT NULL
  ),
  -- Provider-reported and estimated USD never coexist on one row.
  CHECK (NOT (cost_usd IS NOT NULL AND cost_estimated_usd IS NOT NULL)),
  -- pricing_source is present exactly when an estimate is present.
  CHECK (
    (cost_estimated_usd IS NULL AND pricing_source IS NULL)
    OR (cost_estimated_usd IS NOT NULL AND pricing_source IS NOT NULL)
  ),
  -- model is null only for unknown source; reported/requested require a model.
  CHECK (
    (model_source = 'unknown' AND model IS NULL)
    OR (model_source IN ('reported', 'requested') AND model IS NOT NULL AND model <> '')
  ),
  -- Reasoning tokens are an output subset when both are present.
  CHECK (
    tokens_reasoning IS NULL
    OR tokens_output IS NULL
    OR tokens_reasoning <= tokens_output
  )
);

COMMENT ON TABLE remote_agent_usage_ledger IS
  'Normalized usage observations owned by node_usage_recorded workflow events; one row per validated usage entry.';

-- ============================================================================
-- Table 21: Workflow ENVs (named install-wide overlays)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_envs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  patches JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_workflow_envs_workflow_name_name UNIQUE (workflow_name, name)
);

COMMENT ON TABLE remote_agent_workflow_envs IS
  'Named install-wide workflow ENV overlays; identity is (workflow_name, name); patches are plaintext JSON.';

-- ============================================================================
-- Table 22: Workflow node messages (per-node transcript)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
  payload JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_node_messages_run_node_seq
    UNIQUE (workflow_run_id, node_id, seq)
);

COMMENT ON TABLE remote_agent_workflow_node_messages IS
  'Immutable sequenced per-node transcript rows (text/tool/status); cascade-deletes with the run.';

-- ============================================================================
-- Table 23: Pending interactions (AskHuman / permission pauses)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_pending_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  tool_use_id VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('ask', 'permission')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'answered', 'purged')),
  envelope JSONB NOT NULL,
  answer JSONB,
  provider_session_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255),
  execution_scope JSONB,
  CONSTRAINT uq_pending_interactions_run_tool_use
    UNIQUE (workflow_run_id, tool_use_id)
);

COMMENT ON TABLE remote_agent_pending_interactions IS
  'Structured pending AskHuman and permission interactions; unique per (workflow_run_id, tool_use_id); cascade-deletes with the run.';

-- ============================================================================
-- Table 24: Steering drafts (per-author composer draft, per node)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_steering_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  operator_user_id VARCHAR(255) NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_steering_drafts_run_node_operator
    UNIQUE (workflow_run_id, node_id, operator_user_id)
);

COMMENT ON TABLE remote_agent_steering_drafts IS
  'Server-persisted composer draft, one row per (run, node, operator); cascade-deletes with the run.';

-- ============================================================================
-- Table 25: Steering queue entries (durable node-scoped guidance queue)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_steering_queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  operator_user_id VARCHAR(255) NOT NULL DEFAULT '',
  fifo_position INTEGER NOT NULL CHECK (fifo_position >= 1),
  state VARCHAR(32) NOT NULL DEFAULT 'queued',
  last_error TEXT,
  dispatch_failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_kind VARCHAR(16),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_steering_queue_run_node_message
    UNIQUE (workflow_run_id, node_id, message_id),
  CONSTRAINT uq_steering_queue_run_node_position
    UNIQUE (workflow_run_id, node_id, fifo_position)
);

COMMENT ON TABLE remote_agent_steering_queue_entries IS
  'Durable FIFO guidance queue per node; message_id is the caller-stamped idempotency and delivery-correlation key. State is validated in application code, not a CHECK constraint, because the state set is open-ended (queued, awaiting_send_now, dispatching, sent, delivered, delivery_unknown, withdrawn, never_sent, and future additions); cascade-deletes with the run. A retryable automatic-dispatch failure (the session is still usable) reverts the entry to `queued` at its existing fifo_position — already the front among claimable entries, since it was claimed first — rather than a distinct terminal `failed` state, so the entry stays re-claimable; `last_error`/`dispatch_failure_count` carry the durable evidence.';

-- ============================================================================
-- Table 26: Steering node settings (durable per-node auto-send + provider)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_agent_steering_node_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id VARCHAR(255),
  provider_id VARCHAR(64),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_steering_node_settings_run_node
    UNIQUE (workflow_run_id, node_id)
);

COMMENT ON TABLE remote_agent_steering_node_settings IS
  'Durable per-node steering settings shared by every permitted observer: auto-send toggle and the provider id stamped by the executor at registration, so capability data survives a restart with no live handle; cascade-deletes with the run.';

ALTER TABLE remote_agent_workflow_node_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE remote_agent_pending_interactions
  ADD COLUMN IF NOT EXISTS execution_scope JSONB;

ALTER TABLE remote_agent_steering_queue_entries
  ADD COLUMN IF NOT EXISTS dispatch_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE remote_agent_steering_queue_entries
  ADD COLUMN IF NOT EXISTS last_failure_kind VARCHAR(16);

-- ============================================================================
-- Table 24: Workflow node execution evidence (git attribution)
-- ============================================================================

-- One row per node execution attempt (a node can execute more than once
-- within a run: a loop body, a reactivated route target, a retried node).
-- `start_*` is recorded before the execution begins; `end_*` is filled in
-- after it finishes and stays NULL when the execution never reached that
-- point (still running, or the end snapshot could not be captured) — a NULL
-- end column means this execution has no proven end state.
CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_execution_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  retry_epoch INTEGER NOT NULL DEFAULT 0,
  start_checkpoint_ref TEXT NOT NULL,
  start_commit_sha TEXT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  end_checkpoint_ref TEXT,
  end_commit_sha TEXT,
  ended_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE remote_agent_workflow_node_execution_evidence IS
  'Git snapshots bracketing one node execution, read by the server to compute which repository paths that execution changed. Cascade-deletes with the run.';

-- ============================================================================
-- Indexes and column comments
-- ============================================================================
--
-- Every statement that names a COLUMN lives here, below every ADD COLUMN above.
-- This placement is structural, not stylistic.
--
-- `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already has the
-- table, so a column declared only in a CREATE TABLE body does not exist while
-- that block runs on an upgrade — it appears later, when the additive ALTER
-- TABLE block runs. An index or COMMENT ON COLUMN written next to its
-- CREATE TABLE therefore succeeds on a fresh install and fails on an upgrade
-- with `ERROR 42703: column ... does not exist`. Because initSchema() applies
-- this file as one transaction and re-throws at fatal, that single statement
-- rolls back the entire apply and crash-loops every boot (#2508, #2443).
--
-- Keeping these statements below the additive block makes that failure
-- unrepresentable instead of something each author has to remember. Add new
-- indexes and column comments HERE, never beside the table body — and add new
-- `ALTER TABLE ... ADD COLUMN` statements ABOVE this section, not after it, so
-- this section stays last. (Both mistakes fail migration-statement-order.test.ts
-- rather than reaching a user's upgrade.)
--
-- Guarded by packages/core/src/db/migration-statement-order.test.ts and
-- exercised against real PostgreSQL upgrades by scripts/check-schema-upgrades.ts.

-- Codebase env vars
CREATE INDEX IF NOT EXISTS idx_codebase_env_vars_codebase_id
  ON remote_agent_codebase_env_vars(codebase_id);

-- User identities
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
  ON remote_agent_user_identities(user_id);

-- Conversations
CREATE INDEX IF NOT EXISTS idx_remote_agent_conversations_codebase
  ON remote_agent_conversations(codebase_id);
CREATE INDEX IF NOT EXISTS idx_conversations_hidden
  ON remote_agent_conversations(hidden);
CREATE INDEX IF NOT EXISTS idx_conversations_codebase
  ON remote_agent_conversations(codebase_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_isolation_env_id
  ON remote_agent_conversations(isolation_env_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON remote_agent_conversations(user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN remote_agent_conversations.isolation_env_id IS
  'UUID reference to isolation_environments table (the only isolation reference)';

-- Sessions
CREATE INDEX IF NOT EXISTS idx_remote_agent_sessions_conversation
  ON remote_agent_sessions(conversation_id, active);
CREATE INDEX IF NOT EXISTS idx_remote_agent_sessions_codebase
  ON remote_agent_sessions(codebase_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent
  ON remote_agent_sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_conversation_started
  ON remote_agent_sessions(conversation_id, started_at DESC);

COMMENT ON COLUMN remote_agent_sessions.parent_session_id IS
  'Links to the previous session in this conversation (for audit trail)';
COMMENT ON COLUMN remote_agent_sessions.transition_reason IS
  'Why this session was created: plan-to-execute, isolation-changed, reset-requested, etc.';
COMMENT ON COLUMN remote_agent_sessions.ended_reason IS
  'Why this session was deactivated: reset-requested, cwd-changed, conversation-closed, etc.';

-- Isolation environments
-- Partial unique index: only active environments need uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_workflow
  ON remote_agent_isolation_environments (codebase_id, workflow_type, workflow_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_isolation_env_codebase
  ON remote_agent_isolation_environments(codebase_id);
CREATE INDEX IF NOT EXISTS idx_isolation_env_status
  ON remote_agent_isolation_environments(status);
CREATE INDEX IF NOT EXISTS idx_isolation_env_workflow
  ON remote_agent_isolation_environments(workflow_type, workflow_id);

COMMENT ON COLUMN remote_agent_isolation_environments.workflow_type IS
  'Type of work: issue, pr, review, thread, task';
COMMENT ON COLUMN remote_agent_isolation_environments.workflow_id IS
  'Identifier for the work (issue number, PR number, thread hash, etc.)';

-- Workflow runs
CREATE INDEX IF NOT EXISTS idx_workflow_runs_conversation
  ON remote_agent_workflow_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON remote_agent_workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_conv
  ON remote_agent_workflow_runs(parent_conversation_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id
  ON remote_agent_workflow_runs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_run
  ON remote_agent_workflow_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
-- Partial index for efficient staleness queries on running workflows
CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity
  ON remote_agent_workflow_runs(last_activity_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_workflow_runs_codebase_id
  ON remote_agent_workflow_runs(codebase_id);


-- Workflow events
CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id
  ON remote_agent_workflow_events(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type
  ON remote_agent_workflow_events(event_type);
-- Global created_at index for the dashboard event poller's cross-run tail
-- (WHERE created_at >= $1 ORDER BY created_at ASC).
CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at
  ON remote_agent_workflow_events(created_at);
-- Tie-breaker order within a run; NULL for rows written before event_order
-- existed, which the partial predicate keeps out of the unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_events_run_order
  ON remote_agent_workflow_events(workflow_run_id, event_order)
  WHERE event_order IS NOT NULL;
-- Partial created_at index for usage-event reporting joins
CREATE INDEX IF NOT EXISTS idx_workflow_events_usage_created_at
  ON remote_agent_workflow_events(created_at)
  WHERE event_type = 'node_usage_recorded';


-- Workflow node sessions
CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_scope
  ON remote_agent_workflow_node_sessions(scope_key);
CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_workflow
  ON remote_agent_workflow_node_sessions(workflow_name);

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON remote_agent_messages(conversation_id, created_at ASC);

-- Workflow node checkpoints
CREATE INDEX IF NOT EXISTS idx_workflow_node_checkpoints_run
  ON remote_agent_workflow_node_checkpoints(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_checkpoints_run_node_epoch
  ON remote_agent_workflow_node_checkpoints(workflow_run_id, node_id, retry_epoch DESC);

-- Workflow node execution evidence
CREATE INDEX IF NOT EXISTS idx_node_execution_evidence_run
  ON remote_agent_workflow_node_execution_evidence(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_node_execution_evidence_run_node_epoch
  ON remote_agent_workflow_node_execution_evidence(workflow_run_id, node_id, retry_epoch DESC);

-- Workflow provider bindings
CREATE INDEX IF NOT EXISTS idx_provider_bindings_codebase
  ON remote_agent_workflow_provider_bindings(codebase_id);
CREATE INDEX IF NOT EXISTS idx_provider_bindings_provider_name
  ON remote_agent_workflow_provider_bindings(provider, name);

COMMENT ON COLUMN remote_agent_workflow_provider_bindings.provider IS
  'Controller-declared provider identity (e.g. archon)';
COMMENT ON COLUMN remote_agent_workflow_provider_bindings.name IS
  'Binding name (e.g. workflow-engine-primary)';
COMMENT ON COLUMN remote_agent_workflow_provider_bindings.state IS
  'Lifecycle state: active, disabled, rotated';
COMMENT ON COLUMN remote_agent_workflow_provider_bindings.binding_version IS
  'Monotonic version counter, incremented on rotate';
COMMENT ON COLUMN remote_agent_workflow_provider_bindings.signing_secret IS
  'Private HMAC signing secret for outbound workflow events; excluded from projections';

-- Workflow event outbox
CREATE INDEX IF NOT EXISTS idx_workflow_event_outbox_due
  ON remote_agent_workflow_event_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_workflow_event_outbox_run
  ON remote_agent_workflow_event_outbox(workflow_run_id);

COMMENT ON COLUMN remote_agent_workflow_event_outbox.event_body IS
  'Exact serialized JSON body reused byte-for-byte across delivery attempts';

-- Workflow event delivery attempts
CREATE INDEX IF NOT EXISTS idx_workflow_event_delivery_attempts_outbox
  ON remote_agent_workflow_event_delivery_attempts(outbox_event_id);

-- Usage ledger
CREATE INDEX IF NOT EXISTS idx_usage_ledger_agent_provider
  ON remote_agent_usage_ledger(agent_provider);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_provider_model
  ON remote_agent_usage_ledger(provider, model);

COMMENT ON COLUMN remote_agent_usage_ledger.workflow_event_id IS
  'Owning node_usage_recorded workflow event; cascade-deletes with the event.';
COMMENT ON COLUMN remote_agent_usage_ledger.entry_index IS
  'Zero-based position of this observation inside the event usage_breakdown array.';
COMMENT ON COLUMN remote_agent_usage_ledger.agent_provider IS
  'Archon agent provider id that produced the observation (claude/codex/pi/...).';
COMMENT ON COLUMN remote_agent_usage_ledger.provider IS
  'Upstream model-vendor id from the usage entry (anthropic/openai/...).';
COMMENT ON COLUMN remote_agent_usage_ledger.model_source IS
  'reported / requested / unknown — agrees with model nullability.';
COMMENT ON COLUMN remote_agent_usage_ledger.cost_usd IS
  'Provider-reported billed USD when present; mutually exclusive with cost_estimated_usd.';
COMMENT ON COLUMN remote_agent_usage_ledger.cost_estimated_usd IS
  'Point-in-time estimate USD; present only with pricing_source.';
COMMENT ON COLUMN remote_agent_usage_ledger.pricing_source IS
  'config or catalog — set exactly when cost_estimated_usd is present.';

-- Workflow ENVs
CREATE INDEX IF NOT EXISTS idx_workflow_envs_workflow_name
  ON remote_agent_workflow_envs(workflow_name);

COMMENT ON COLUMN remote_agent_workflow_envs.workflow_name IS
  'Canonical workflow name this ENV overlays; part of UNIQUE(workflow_name, name).';
COMMENT ON COLUMN remote_agent_workflow_envs.name IS
  'Case-sensitive ENV name (1–64, [A-Za-z0-9][A-Za-z0-9._-]*); part of UNIQUE(workflow_name, name).';
COMMENT ON COLUMN remote_agent_workflow_envs.patches IS
  'Whole-document node patch map (provider/model/effort/thinking/prompt/bash); empty {} allowed; plaintext install-visible data, not secrets.';
COMMENT ON COLUMN remote_agent_workflow_envs.created_by_user_id IS
  'Provenance only (first creator); ON DELETE SET NULL; not an access-control boundary.';

-- Workflow node messages
COMMENT ON COLUMN remote_agent_workflow_node_messages.workflow_run_id IS
  'Owning workflow run; cascade-deletes with the run.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.node_id IS
  'Executor stepName, including the loop-group prefix when present.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.seq IS
  'Positive per-node sequence; UNIQUE(workflow_run_id, node_id, seq) is the lookup/order index.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.kind IS
  'text, tool, or status.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.payload IS
  'Discriminated JSON payload matching kind.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.metadata IS
  'Nullable execution/stream metadata; absent on rows from older writers.';

-- Pending interactions
COMMENT ON COLUMN remote_agent_pending_interactions.workflow_run_id IS
  'Owning workflow run; cascade-deletes with the run.';
COMMENT ON COLUMN remote_agent_pending_interactions.node_id IS
  'Executor stepName of the asking node.';
COMMENT ON COLUMN remote_agent_pending_interactions.tool_use_id IS
  'Provider tool-use id; unique per run and used as the Ask request_id.';
COMMENT ON COLUMN remote_agent_pending_interactions.kind IS
  'ask or permission.';
COMMENT ON COLUMN remote_agent_pending_interactions.status IS
  'pending, answered, or purged.';
COMMENT ON COLUMN remote_agent_pending_interactions.envelope IS
  'Structured question envelope persisted at Ask time.';
COMMENT ON COLUMN remote_agent_pending_interactions.answer IS
  'Structured answer payload; NULL until answered.';
COMMENT ON COLUMN remote_agent_pending_interactions.provider_session_id IS
  'Provider session id captured at Ask time for later resume.';
COMMENT ON COLUMN remote_agent_pending_interactions.created_at IS
  'When the pending interaction was inserted.';
COMMENT ON COLUMN remote_agent_pending_interactions.resolved_at IS
  'When the interaction was answered or purged; NULL while pending.';
COMMENT ON COLUMN remote_agent_pending_interactions.resolved_by IS
  'Identity of the resolver; NULL while pending.';
COMMENT ON COLUMN remote_agent_pending_interactions.execution_scope IS
  'Nullable occurrence/attempt identity captured at Ask pause; absent on older rows.';

-- Steering drafts
CREATE INDEX IF NOT EXISTS idx_steering_drafts_run_node
  ON remote_agent_steering_drafts(workflow_run_id, node_id);

COMMENT ON COLUMN remote_agent_steering_drafts.operator_user_id IS
  'Draft author; empty string sentinel means an identity-less (solo, no web auth) caller.';
COMMENT ON COLUMN remote_agent_steering_drafts.message IS
  'Verbatim composer text; never transformed.';
COMMENT ON COLUMN remote_agent_steering_drafts.updated_at IS
  'Set on every write; the client reads this as the last-saved timestamp.';

-- Steering queue entries
CREATE INDEX IF NOT EXISTS idx_steering_queue_run_node_position
  ON remote_agent_steering_queue_entries(workflow_run_id, node_id, fifo_position);
CREATE INDEX IF NOT EXISTS idx_steering_queue_state
  ON remote_agent_steering_queue_entries(state);

COMMENT ON COLUMN remote_agent_steering_queue_entries.message_id IS
  'Caller-stamped correlation key; UNIQUE(workflow_run_id, node_id, message_id) makes a repeated send idempotent.';
COMMENT ON COLUMN remote_agent_steering_queue_entries.operator_user_id IS
  'Queued-message author; empty string sentinel means an identity-less (solo, no web auth) caller.';
COMMENT ON COLUMN remote_agent_steering_queue_entries.fifo_position IS
  'Server-assigned order, unique per (workflow_run_id, node_id); assigned as MAX(fifo_position)+1 inside a transaction.';
COMMENT ON COLUMN remote_agent_steering_queue_entries.state IS
  'Delivery state; validated in application code against the open steering state set.';
COMMENT ON COLUMN remote_agent_steering_queue_entries.last_error IS
  'Failure evidence for a returned-to-queue or never_sent entry; NULL otherwise.';
COMMENT ON COLUMN remote_agent_steering_queue_entries.dispatch_failure_count IS
  'Count of retryable automatic-dispatch failures this entry has been reverted from; 0 until the first one. Never resets, and never caps a retry — each operator Send now simply tries again.';
COMMENT ON COLUMN remote_agent_steering_queue_entries.last_failure_kind IS
  'Which attempt kind the most recent revert-to-queued came from: automatic (auto-send claim) or send_now (operator-triggered retry); NULL until the first failure. Paired with last_error so the dock names the attempt that actually failed.';

-- Steering node settings
COMMENT ON COLUMN remote_agent_steering_node_settings.auto_send_enabled IS
  'Durable per-node auto-send toggle; shared by every permitted observer of the node.';
COMMENT ON COLUMN remote_agent_steering_node_settings.updated_by_user_id IS
  'Attribution only for the last write; not a scoping key.';
COMMENT ON COLUMN remote_agent_steering_node_settings.provider_id IS
  'Resolved provider id stamped by the executor at steering registration; lets the queue read report capability data with no live handle.';
