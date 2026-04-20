#!/bin/bash
# ============================================
# Parallext Engine — Fresh Setup (from zero)
# Runs directly via psql, no Docker image dependencies
# Usage: cd /opt/parallext-engine && bash infra/scripts/setup-fresh.sh
# ============================================
set -e

COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
PSQL="$COMPOSE exec -T postgres psql -U parallext"
DB="$PSQL -d parallext_engine"

echo ""
echo "=========================================="
echo "  PARALLEXT ENGINE — FRESH DATABASE SETUP"
echo "=========================================="
echo ""

# ---- 1. Ensure postgres + redis are running ----
echo "===> [1/9] Ensuring PostgreSQL and Redis are running..."
$COMPOSE up -d postgres redis
for i in $(seq 1 15); do
    if $COMPOSE exec -T postgres pg_isready -U parallext > /dev/null 2>&1; then break; fi
    sleep 1
done
echo "  [OK]"

# ---- 2. Drop and recreate database ----
echo "===> [2/9] Recreating database..."
$PSQL -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'parallext_engine' AND pid <> pg_backend_pid();" > /dev/null 2>&1 || true
$PSQL -d postgres -c "DROP DATABASE IF EXISTS parallext_engine;" 2>/dev/null
$PSQL -d postgres -c "CREATE DATABASE parallext_engine OWNER parallext;" 2>/dev/null
echo "  [OK]"

# ---- 3. Create extensions ----
echo "===> [3/9] Creating extensions..."
$DB -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
$DB -c "CREATE EXTENSION IF NOT EXISTS \"vector\";"
echo "  [OK]"

# ---- 4. Create ALL public schema tables ----
echo "===> [4/9] Creating public schema tables..."
$DB <<'EOSQL'

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

-- Generated column so raw SQL queries can use u.name
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT
    GENERATED ALWAYS AS (TRIM(first_name || ' ' || last_name)) STORED;

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

CREATE TABLE IF NOT EXISTS whatsapp_onboardings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    config_id TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'new',
    status TEXT NOT NULL DEFAULT 'CREATED',
    is_coexistence BOOLEAN NOT NULL DEFAULT false,
    coexistence_acknowledged BOOLEAN NOT NULL DEFAULT false,
    meta_business_id TEXT, waba_id TEXT, phone_number_id TEXT,
    display_phone_number TEXT, verified_name TEXT,
    exchange_payload JSONB,
    error_code TEXT, error_message TEXT,
    started_by_user_id TEXT,
    code_received_at TIMESTAMPTZ, exchange_completed_at TIMESTAMPTZ,
    assets_synced_at TIMESTAMPTZ, webhook_validated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wo_tenant_idx ON whatsapp_onboardings(tenant_id);
CREATE INDEX IF NOT EXISTS wo_status_idx ON whatsapp_onboardings(status);

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
CREATE INDEX IF NOT EXISTS wc_tenant_type_idx ON whatsapp_credentials(tenant_id, credential_type);

CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    is_secret BOOLEAN DEFAULT false,
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prisma migration tracking
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
    (gen_random_uuid(), 'setup_script', '20260301000000_init', NOW(), 1),
    (gen_random_uuid(), 'setup_script', '20260317000000_add_tenant_is_active', NOW(), 1)
ON CONFLICT DO NOTHING;

EOSQL
echo "  [OK]"

# ---- 5. Seed admin user ----
echo "===> [5/9] Creating admin user..."
# Generate bcrypt hash inside the API container (guarantees correct hash)
ADMIN_HASH=$($COMPOSE run --rm --no-deps api node -e "require('bcrypt').hash('Parallext2026!',12).then(h=>console.log(h))" 2>/dev/null | tail -1)
if [ -z "$ADMIN_HASH" ] || [[ ! "$ADMIN_HASH" == \$2* ]]; then
    echo "  [WARN] Could not generate hash via container, using fallback"
    ADMIN_HASH='$2b$12$68CDeb.iQAWEjSV3aJ2ddeoV6r00RFhBwngpByofvZ8hkzzMsiVZW'
fi
$DB -c "INSERT INTO users (id, email, password, first_name, last_name, role, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'admin@parallext.com', '$ADMIN_HASH', 'Admin', 'Parallext', 'super_admin', true, NOW(), NOW()) ON CONFLICT (email) DO UPDATE SET password = '$ADMIN_HASH';"
echo "  [OK] admin@parallext.com / Parallext2026!"

# ---- 6. Recreate ALL existing tenant schemas ----
echo "===> [6/9] Creating tenant schemas..."
TENANT_SCHEMAS=$($DB -t -c "SELECT schema_name FROM tenants WHERE is_active = true;" 2>/dev/null | tr -d ' ' | grep -v '^$')

if [ -n "$TENANT_SCHEMAS" ]; then
    TENANT_SQL_FILE="apps/api/prisma/tenant-schema.sql"
    if [ ! -f "$TENANT_SQL_FILE" ]; then
        echo "  [WARN] tenant-schema.sql not found at $TENANT_SQL_FILE"
    else
        for schema in $TENANT_SCHEMAS; do
            echo "  Creating schema: $schema"
            sed "s/{{SCHEMA_NAME}}/$schema/g" "$TENANT_SQL_FILE" | \
                $DB 2>/dev/null || echo "    [WARN] Some statements failed for $schema (may already exist)"
            echo "    [OK] $schema"
        done
        echo "  ✓ Applied tenant-schema.sql (includes agent_personas, agent_templates, calendar_integrations)"
    fi
else
    echo "  No tenants found — schemas will be created when tenants sign up"
fi
echo "  [OK]"

# ---- 7. Run additional SQL migrations (tenant-level) ----
echo "===> [7/9] Running additional migrations on tenant schemas..."
MIGRATION_FILES=$(ls apps/api/prisma/migrations/*.sql 2>/dev/null | sort)
if [ -n "$MIGRATION_FILES" ] && [ -n "$TENANT_SCHEMAS" ]; then
    for schema in $TENANT_SCHEMAS; do
        for mig in $MIGRATION_FILES; do
            sed "s/{{SCHEMA_NAME}}/$schema/g" "$mig" | \
                $DB 2>/dev/null || true
        done
        echo "  [OK] Migrations applied to $schema"
    done
else
    echo "  No additional migrations to run"
fi
echo "  [OK]"

# ---- 8. Pull latest images and restart ----
echo "===> [8/9] Pulling images and restarting services..."
$COMPOSE pull api dashboard whatsapp worker 2>/dev/null || echo "  [WARN] Pull failed — using cached images"
$COMPOSE up -d api worker dashboard whatsapp
echo "  [OK]"

# ---- 9. Wait for API health ----
echo "===> [9/9] Waiting for API health..."
for i in $(seq 1 60); do
    if $COMPOSE exec -T api curl -sf http://localhost:3000/api/v1/health > /dev/null 2>&1; then
        echo "  [OK] API healthy after ${i}s"
        break
    fi
    [ $i -eq 60 ] && echo "  [WARN] API not healthy after 60s — check: docker logs parallext-api --tail 20"
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
