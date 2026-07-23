#!/bin/bash
# ============================================
# Parallext Engine — Fresh Setup (from zero)
# Single source of truth: Prisma migrations create all public tables.
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
echo "===> [1/10] Ensuring PostgreSQL and Redis are running..."
$COMPOSE up -d postgres redis
for i in $(seq 1 15); do
    if $COMPOSE exec -T postgres pg_isready -U parallext > /dev/null 2>&1; then break; fi
    sleep 1
done
echo "  [OK]"

# ---- 2. Drop and recreate database ----
echo "===> [2/10] Recreating database..."
$PSQL -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'parallext_engine' AND pid <> pg_backend_pid();" > /dev/null 2>&1 || true
$PSQL -d postgres -c "DROP DATABASE IF EXISTS parallext_engine;" 2>/dev/null
$PSQL -d postgres -c "CREATE DATABASE parallext_engine OWNER parallext;" 2>/dev/null
echo "  [OK]"

# ---- 3. Create extensions (required before migrations) ----
echo "===> [3/10] Creating extensions..."
$DB -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
$DB -c "CREATE EXTENSION IF NOT EXISTS \"vector\";"
echo "  [OK]"

# ---- 4. Run Prisma migrations (creates ALL public schema tables) ----
echo "===> [4/10] Running Prisma migrations (public schema)..."
$COMPOSE run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
echo "  [OK]"

# ---- 5. Seed billing plans (idempotent upsert) ----
echo "===> [5/10] Seeding billing plans..."
$COMPOSE run --rm api node prisma/seed-billing-plans.js
echo "  [OK]"

# ---- 6. Seed admin user ----
echo "===> [6/10] Creating admin user..."
ADMIN_HASH=$($COMPOSE run --rm --no-deps api node -e "require('bcrypt').hash('Parallext2026!',12).then(h=>console.log(h))" 2>/dev/null | tail -1)
if [ -z "$ADMIN_HASH" ] || [[ ! "$ADMIN_HASH" == \$2* ]]; then
    echo "  [WARN] Could not generate hash via container, using fallback"
    ADMIN_HASH='$2b$12$68CDeb.iQAWEjSV3aJ2ddeoV6r00RFhBwngpByofvZ8hkzzMsiVZW'
fi
$DB -c "INSERT INTO users (id, email, password, first_name, last_name, role, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'admin@parallext.com', '$ADMIN_HASH', 'Admin', 'Parallext', 'super_admin', true, NOW(), NOW()) ON CONFLICT (email) DO UPDATE SET password = '$ADMIN_HASH';"
echo "  [OK] admin@parallext.com / Parallext2026!"

# ---- 7. Create tenant schemas (if any tenants exist from a backup restore) ----
echo "===> [7/10] Creating tenant schemas..."
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
    fi
else
    echo "  No tenants found — schemas will be created when tenants sign up"
fi
echo "  [OK]"

# ---- 8. Run tenant-level migrations (safety net for existing schemas) ----
echo "===> [8/10] Running tenant schema migrations..."
$COMPOSE run --rm api npm run migrate:tenants || echo "  [WARN] Tenant migrations had issues (may be empty)"
echo "  [OK]"

# ---- 9. Pull latest images and restart ----
echo "===> [9/10] Pulling images and restarting services..."
$COMPOSE pull api dashboard whatsapp worker 2>/dev/null || echo "  [WARN] Pull failed — using cached images"
$COMPOSE up -d api worker dashboard whatsapp
echo "  [OK]"

# ---- 10. Wait for API health ----
echo "===> [10/10] Waiting for API health..."
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
