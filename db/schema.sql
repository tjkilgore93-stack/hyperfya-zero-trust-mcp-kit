-- Zero-trust schema: app role + row-level security.
-- Tables are owned by the postgres superuser; mcp_app only gets the
-- grants below and cannot disable RLS or read other tenants' rows.

-- Tenants and their API tokens (SHA-256 hashes only).
CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  api_token_hash  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Example tenant-owned data. Replace with your own tables; copy the
-- tenant_id column + policy pattern onto each one.
CREATE TABLE IF NOT EXISTS notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_tenant_created_idx ON notes (tenant_id, created_at DESC);

-- The application role needs to read token hashes to authenticate, and the
-- issue-token script inserts tenants. No UPDATE/DELETE: a compromised app
-- role cannot rewrite auth.
GRANT SELECT (id, name, api_token_hash) ON tenants TO mcp_app;
GRANT INSERT (name, api_token_hash) ON tenants TO mcp_app;

-- Everything else on notes: all four statements, all tenant-filtered by RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO mcp_app;

-- Row-level security. current_setting('app.tenant_id') throws if unset,
-- so a query outside withTenant() fails instead of leaking: fail closed.
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY; -- applies to table owner too

DROP POLICY IF EXISTS tenant_isolation ON notes;
CREATE POLICY tenant_isolation ON notes
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
