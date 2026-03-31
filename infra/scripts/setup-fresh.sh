#!/bin/bash
# ============================================
# Parallext Engine — Fresh Setup (from zero)
# Runs directly via psql, no Docker image dependencies
# ============================================
set -e

COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
DB="docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres psql -U parallext -d parallext_engine"

echo ""
echo "=========================================="
echo "  PARALLEXT ENGINE — FRESH DATABASE SETUP"
echo "=========================================="
echo ""

# ---- 1. Ensure postgres is running ----
echo "===> [1/8] Ensuring PostgreSQL is running..."
$COMPOSE up -d postgres redis
sleep 3
echo "  [OK]"

# ---- 2. Drop and recreate database ----
echo "===> [2/8] Recreating database..."
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -U parallext -d postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'parallext_engine' AND pid <> pg_backend_pid();
  " > /dev/null 2>&1 || true

docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -U parallext -d postgres -c "DROP DATABASE IF EXISTS parallext_engine;" 2>/dev/null

docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -U parallext -d postgres -c "CREATE DATABASE parallext_engine OWNER parallext;" 2>/dev/null

echo "  [OK] Database recreated"

# ---- 3. Create extensions ----
echo "===> [3/8] Creating extensions..."
$DB <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
SQL
echo "  [OK]"

# ---- 4. Create public schema tables ----
echo "===> [4/8] Creating public schema tables..."
$DB <<'SQL'

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    industry TEXT NOT NULL DEFAULT 'general',
    language TEXT NOT NULL DEFAULT 'es-CO',
    schema_name TEXT UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    plan TEXT NOT NULL DEFAULT 'starter',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'tenant_agent',
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users(tenant_id);

-- Channel Accounts (webhook routing: phoneNumberId -> tenantId)
CREATE TABLE IF NOT EXISTS channel_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    account_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT,
    webhook_secret TEXT,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(channel_type, account_id)
);
CREATE INDEX IF NOT EXISTS channel_accounts_tenant_id_idx ON channel_accounts(tenant_id);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    tenant_id TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}',
    ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at);

-- WhatsApp Onboardings
CREATE TABLE IF NOT EXISTS whatsapp_onboardings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    config_id TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'new',
    status TEXT NOT NULL DEFAULT 'CREATED',
    is_coexistence BOOLEAN NOT NULL DEFAULT false,
    coexistence_acknowledged BOOLEAN NOT NULL DEFAULT false,
    meta_business_id TEXT,
    waba_id TEXT,
    phone_number_id TEXT,
    display_phone_number TEXT,
    verified_name TEXT,
    exchange_payload JSONB,
    error_code TEXT,
    error_message TEXT,
    started_by_user_id TEXT,
    code_received_at TIMESTAMPTZ,
    exchange_completed_at TIMESTAMPTZ,
    assets_synced_at TIMESTAMPTZ,
    webhook_validated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS whatsapp_onboardings_tenant_idx ON whatsapp_onboardings(tenant_id);
CREATE INDEX IF NOT EXISTS whatsapp_onboardings_status_idx ON whatsapp_onboardings(status);

-- WhatsApp Credentials (encrypted tokens)
CREATE TABLE IF NOT EXISTS whatsapp_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    credential_type TEXT NOT NULL DEFAULT 'system_user_token',
    encrypted_value TEXT NOT NULL DEFAULT '',
    rotation_state TEXT NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS whatsapp_creds_tenant_type_idx ON whatsapp_credentials(tenant_id, credential_type);

-- Platform Settings
CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    is_secret BOOLEAN DEFAULT false,
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

SQL
echo "  [OK] All public tables created"

# ---- 5. Mark Prisma migrations as applied (so prisma migrate deploy doesn't re-run them) ----
echo "===> [5/8] Marking Prisma migrations as applied..."
$DB <<'SQL'
CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id VARCHAR(36) PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INT NOT NULL DEFAULT 0
);

INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
VALUES
    (gen_random_uuid(), 'manual_setup', '20260301000000_init', NOW(), 1),
    (gen_random_uuid(), 'manual_setup', '20260317000000_add_tenant_is_active', NOW(), 1)
ON CONFLICT DO NOTHING;
SQL
echo "  [OK]"

# ---- 6. Seed admin user ----
echo "===> [6/8] Creating admin user..."
# bcrypt hash of "Parallext2026!" with 12 rounds
ADMIN_HASH='$2b$12$LJ3m4ys3GzWbGxCkPJ8cFOQq6VHfNkR9Ig0YCFMgL2vKzCEJWxWCy'
$DB <<SQL
INSERT INTO users (id, email, password, first_name, last_name, role, is_active, created_at, updated_at)
VALUES (gen_random_uuid(), 'admin@parallext.com', '$ADMIN_HASH', 'Admin', 'Parallext', 'super_admin', true, NOW(), NOW())
ON CONFLICT (email) DO NOTHING;
SQL
echo "  [OK] admin@parallext.com / Parallext2026!"

# ---- 7. Pull latest images and restart ----
echo "===> [7/8] Pulling images and restarting services..."
$COMPOSE pull api dashboard whatsapp worker 2>/dev/null || echo "  [WARN] Pull failed — using cached images"
$COMPOSE up -d api worker dashboard whatsapp
echo "  [OK]"

# ---- 8. Wait for API health ----
echo "===> [8/8] Waiting for API to be healthy..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:3000/api/v1/health > /dev/null 2>&1; then
        echo "  [OK] API healthy after ${i}s"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "  [WARN] API not healthy after 60s — check: docker logs parallext-api --tail 20"
    fi
    sleep 1
done

echo ""
echo "=========================================="
echo "  SETUP COMPLETE"
echo "=========================================="
echo ""
echo "  Dashboard: https://admin.parallly-chat.cloud"
echo "  API:       https://api.parallly-chat.cloud"
echo "  Login:     admin@parallext.com / Parallext2026!"
echo ""
echo "  Next steps:"
echo "    1. Login to dashboard"
echo "    2. Create a tenant (signup)"
echo "    3. Go to Channels > WhatsApp > Connect"
echo ""
