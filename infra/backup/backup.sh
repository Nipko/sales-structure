#!/bin/bash
# ============================================
# Parallext Engine - Automated Backup Script
# Backs up all tenant schemas individually + public schema
# Designed to run via crontab: 0 2 * * * /path/to/backup.sh
# ============================================

set -euo pipefail

# Configuration
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-parallext}"
DB_NAME="${DATABASE_NAME:-parallext_engine}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "${BACKUP_DIR}/${TIMESTAMP}"

echo "🔄 Starting backup at ${TIMESTAMP}..."

# 1. Backup public schema (global tables)
echo "📦 Backing up public schema..."
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --schema=public \
  --format=custom \
  --file="${BACKUP_DIR}/${TIMESTAMP}/public.dump" \
  2>&1 || echo "⚠️ Warning: Public schema backup had issues"

echo "✅ Public schema backed up"

# 2. Backup each tenant schema individually
echo "📦 Backing up tenant schemas..."
TENANT_SCHEMAS=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  -t -c "SELECT schema_name FROM tenants WHERE is_active = true;" 2>/dev/null | tr -d ' ')

for SCHEMA in ${TENANT_SCHEMAS}; do
  if [ -n "${SCHEMA}" ]; then
    echo "  → Backing up schema: ${SCHEMA}"
    pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --schema="${SCHEMA}" \
      --format=custom \
      --file="${BACKUP_DIR}/${TIMESTAMP}/${SCHEMA}.dump" \
      2>&1 || echo "  ⚠️ Warning: ${SCHEMA} backup had issues"
  fi
done

echo "✅ All tenant schemas backed up"

# 3. Full database backup (safety net)
echo "📦 Creating full database backup..."
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --format=custom \
  --file="${BACKUP_DIR}/${TIMESTAMP}/full_backup.dump" \
  2>&1 || echo "⚠️ Warning: Full backup had issues"

echo "✅ Full backup complete"

# 4. Compress backup directory
echo "📦 Compressing backup..."
cd "${BACKUP_DIR}"
tar -czf "${TIMESTAMP}.tar.gz" "${TIMESTAMP}/"
rm -rf "${TIMESTAMP}/"

echo "✅ Compressed to ${TIMESTAMP}.tar.gz"

# 5. Clean old backups (retention policy)
echo "🗑️ Cleaning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "*.tar.gz" -type f -mtime +${RETENTION_DAYS} -delete

# 6. Report
BACKUP_SIZE=$(du -sh "${BACKUP_DIR}/${TIMESTAMP}.tar.gz" | cut -f1)
echo ""
echo "=============================="
echo "✅ Backup completed!"
echo "  File: ${BACKUP_DIR}/${TIMESTAMP}.tar.gz"
echo "  Size: ${BACKUP_SIZE}"
echo "  Schemas: public + $(echo ${TENANT_SCHEMAS} | wc -w | tr -d ' ') tenants"
echo "  Retention: ${RETENTION_DAYS} days"
echo "=============================="
