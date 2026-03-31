#!/bin/bash
# ============================================
# Parallext Engine — Full Database Reset
# WARNING: This drops ALL data and recreates from scratch
# ============================================
set -e

echo "=== PARALLEXT DATABASE RESET ==="
echo "WARNING: This will DROP all data. Press Ctrl+C to cancel."
echo "Waiting 5 seconds..."
sleep 5

COMPOSE_FILE="infra/docker/docker-compose.prod.yml"
DB_CONTAINER="parallext-postgres"
DB_USER="parallext"
DB_NAME="parallext_engine"

echo ""
echo "===> Step 1: Stop API and Worker..."
docker compose -f $COMPOSE_FILE stop api worker 2>/dev/null || true

echo ""
echo "===> Step 2: Drop and recreate database..."
docker exec $DB_CONTAINER psql -U $DB_USER -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
"
docker exec $DB_CONTAINER psql -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec $DB_CONTAINER psql -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS \"vector\";"

echo ""
echo "===> Step 3: Run Prisma migrations (public schema)..."
docker compose -f $COMPOSE_FILE run --rm api npx prisma migrate deploy

echo ""
echo "===> Step 4: Create platform_settings table..."
docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
  CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    is_secret BOOLEAN DEFAULT false,
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
"

echo ""
echo "===> Step 5: Seed admin user..."
docker compose -f $COMPOSE_FILE run --rm api npm run db:seed 2>/dev/null || echo "  [WARN] Seed script failed — may need manual seeding"

echo ""
echo "===> Step 6: Run tenant migrations..."
docker compose -f $COMPOSE_FILE run --rm api npm run migrate:tenants 2>/dev/null || echo "  [WARN] No tenants to migrate yet"

echo ""
echo "===> Step 7: Restart services..."
docker compose -f $COMPOSE_FILE up -d api worker dashboard whatsapp

echo ""
echo "===> Step 8: Wait for API health..."
for i in $(seq 1 30); do
  if docker exec parallext-api node -e "
    const http = require('http');
    http.get('http://localhost:3000/api/v1/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))
    .on('error', () => process.exit(1));
  " 2>/dev/null; then
    echo "  [OK] API healthy after ${i}s"
    break
  fi
  sleep 1
done

echo ""
echo "=== DATABASE RESET COMPLETE ==="
echo "You can now:"
echo "  1. Login at https://admin.parallly-chat.cloud"
echo "  2. Create a tenant via signup"
echo "  3. Connect WhatsApp in Channels"
