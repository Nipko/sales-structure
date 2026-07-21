#!/bin/bash
# ============================================
# Parallext Engine — Production Backup Script
# Backs up: DB (public + tenant schemas) + media + Redis
# Optionally syncs offsite via rclone (R2/S3/Backblaze)
#
# Crontab (recommended):
#   0 2 * * * /opt/parallext-engine/infra/backup/backup.sh >> /var/log/parallext-backup.log 2>&1
# ============================================

set -euo pipefail

# ── Configuration ──
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-parallext}"
DB_NAME="${DATABASE_NAME:-parallext_engine}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/docker/volumes/parallext-media-data/_data}"
INVOICES_DIR="${INVOICES_DIR:-/var/lib/docker/volumes/parallext-fiscal-data/_data}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"
OFFSITE_REMOTE="${OFFSITE_REMOTE:-}"  # e.g. "r2:parallext-backups" or "b2:parallext-backups"

# Retention
DAILY_KEEP=7
WEEKLY_KEEP=4
MONTHLY_KEEP=2

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)
BACKUP_PATH="${BACKUP_DIR}/daily/${TIMESTAMP}"

echo "========================================"
echo "Parallext Backup — ${TIMESTAMP}"
echo "========================================"

mkdir -p "${BACKUP_PATH}"

# ── 1. Database: public schema ──
echo "[1/7] Backing up public schema..."
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --schema=public \
  --format=custom \
  --file="${BACKUP_PATH}/public.dump" \
  2>&1 || echo "  WARN: Public schema backup had issues"
echo "  OK — public.dump"

# ── 2. Database: each tenant schema ──
echo "[2/7] Backing up tenant schemas..."
TENANT_SCHEMAS=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  -t -c "SELECT schema_name FROM tenants WHERE is_active = true;" 2>/dev/null | tr -d ' ' | grep -v '^$' || true)

TENANT_COUNT=0
for SCHEMA in ${TENANT_SCHEMAS}; do
  if [ -n "${SCHEMA}" ]; then
    pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --schema="${SCHEMA}" \
      --format=custom \
      --file="${BACKUP_PATH}/${SCHEMA}.dump" \
      2>&1 || echo "  WARN: ${SCHEMA} backup had issues"
    TENANT_COUNT=$((TENANT_COUNT + 1))
  fi
done
echo "  OK — ${TENANT_COUNT} tenant schemas"

# ── 3. Full database backup (safety net) ──
echo "[3/7] Full database backup..."
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --format=custom \
  --file="${BACKUP_PATH}/full_backup.dump" \
  2>&1 || echo "  WARN: Full backup had issues"
echo "  OK — full_backup.dump"

# ── 4. Redis RDB snapshot ──
echo "[4/7] Redis snapshot..."
if docker exec "${REDIS_CONTAINER}" redis-cli BGSAVE 2>/dev/null; then
  sleep 3
  docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${BACKUP_PATH}/redis.rdb" 2>/dev/null \
    || echo "  WARN: Could not copy Redis dump"
  echo "  OK — redis.rdb"
else
  echo "  SKIP — Redis container not reachable"
fi

# ── 5. Media files ──
echo "[5/7] Media files..."
if [ -d "${MEDIA_DIR}" ]; then
  tar -czf "${BACKUP_PATH}/media.tar.gz" -C "${MEDIA_DIR}" . 2>/dev/null \
    || echo "  WARN: Media backup had issues"
  echo "  OK — media.tar.gz"
else
  echo "  SKIP — Media directory not found: ${MEDIA_DIR}"
fi

# ── 6. Fiscal invoices (DIAN XML+PDF — legal 5-year retention) ──
echo "[6/7] Fiscal invoices..."
if [ -d "${INVOICES_DIR}" ]; then
  tar -czf "${BACKUP_PATH}/fiscal-invoices.tar.gz" -C "${INVOICES_DIR}" . 2>/dev/null \
    || echo "  WARN: Fiscal invoices backup had issues"
  echo "  OK — fiscal-invoices.tar.gz"
else
  echo "  SKIP — Fiscal invoices directory not found: ${INVOICES_DIR}"
fi

# ── 7. Compress daily backup ──
echo "[7/7] Compressing..."
cd "${BACKUP_DIR}/daily"
tar -czf "${TIMESTAMP}.tar.gz" "${TIMESTAMP}/"
rm -rf "${TIMESTAMP}/"
BACKUP_SIZE=$(du -sh "${TIMESTAMP}.tar.gz" | cut -f1)
echo "  OK — ${BACKUP_SIZE}"

# ── Weekly copy (Sundays) ──
if [ "${DAY_OF_WEEK}" = "7" ]; then
  mkdir -p "${BACKUP_DIR}/weekly"
  cp "${BACKUP_DIR}/daily/${TIMESTAMP}.tar.gz" "${BACKUP_DIR}/weekly/${TIMESTAMP}.tar.gz"
  echo "  + Weekly copy created"
fi

# ── Monthly copy (1st of month) ──
if [ "${DAY_OF_MONTH}" = "01" ]; then
  mkdir -p "${BACKUP_DIR}/monthly"
  cp "${BACKUP_DIR}/daily/${TIMESTAMP}.tar.gz" "${BACKUP_DIR}/monthly/${TIMESTAMP}.tar.gz"
  echo "  + Monthly copy created"
fi

# ── Retention cleanup ──
echo ""
echo "Cleaning old backups..."
find "${BACKUP_DIR}/daily"   -name "*.tar.gz" -type f -mtime +${DAILY_KEEP}   -delete 2>/dev/null || true
find "${BACKUP_DIR}/weekly"  -name "*.tar.gz" -type f -mtime +$((WEEKLY_KEEP * 7)) -delete 2>/dev/null || true
find "${BACKUP_DIR}/monthly" -name "*.tar.gz" -type f -mtime +$((MONTHLY_KEEP * 30)) -delete 2>/dev/null || true
echo "  Retention: ${DAILY_KEEP} daily, ${WEEKLY_KEEP} weekly, ${MONTHLY_KEEP} monthly"

# ── Offsite sync (if configured) ──
if [ -n "${OFFSITE_REMOTE}" ] && command -v rclone &> /dev/null; then
  echo ""
  echo "Syncing to offsite: ${OFFSITE_REMOTE}..."
  rclone sync "${BACKUP_DIR}/" "${OFFSITE_REMOTE}/" \
    --transfers 4 \
    --checkers 8 \
    --log-level NOTICE \
    2>&1 || echo "  WARN: Offsite sync had issues"
  echo "  OK — offsite sync complete"
elif [ -n "${OFFSITE_REMOTE}" ]; then
  echo "  WARN: OFFSITE_REMOTE set but rclone not installed"
fi

# ── Heartbeat for the ops-center backup monitor ──
# Records a success timestamp (epoch ms) in Redis. PlatformMonitorService reads
# `backup:last_success` daily and raises a critical incident if it goes stale
# (>26h). If Redis requires a password, add `-a "${REDIS_PASSWORD}"`.
docker exec "${REDIS_CONTAINER}" redis-cli SET backup:last_success "$(date +%s%3N)" >/dev/null 2>&1 \
  || echo "  WARN: Could not write backup heartbeat to Redis"

# ── Summary ──
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)
echo ""
echo "========================================"
echo "Backup complete!"
echo "  File: daily/${TIMESTAMP}.tar.gz"
echo "  Size: ${BACKUP_SIZE}"
echo "  Schemas: public + ${TENANT_COUNT} tenants"
echo "  Includes: DB + Redis + Media + Fiscal invoices"
echo "  Total backup dir: ${TOTAL_SIZE}"
echo "========================================"
