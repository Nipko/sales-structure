#!/bin/bash
# ============================================
# Parallext Engine — Production Backup Script
# Backs up: DB (public + tenant schemas) + media + fiscal invoices + Redis
# Optionally syncs offsite via rclone to any S3-compatible bucket
# (AWS S3 / Cloudflare R2 / Backblaze B2).
#
# Crontab (recommended):
#   0 2 * * * /opt/parallext-engine/infra/backup/backup.sh >> /var/log/parallext-backup.log 2>&1
#
# Offsite config is read from the production .env (regenerated on every deploy
# from GitHub Secrets), so it survives the VPS `git reset --hard`. See
# docs/backup-offsite-setup.md for the one-time bucket + secrets setup.
# ============================================

set -euo pipefail

# ── Load production env (offsite credentials, etc.) ──
# The deploy regenerates /opt/parallext-engine/.env from GitHub Secrets; sourcing
# it here means OFFSITE_* config is managed the same way as every other secret
# and never has to be hand-edited on the VPS (which a deploy would revert).
ENV_FILE="${ENV_FILE:-/opt/parallext-engine/.env}"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}" || echo "  WARN: could not source ${ENV_FILE}"
  set +a
fi

# ── Configuration ──
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-parallext}"
DB_NAME="${DATABASE_NAME:-parallext_engine}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/docker/volumes/parallext-media-data/_data}"
INVOICES_DIR="${INVOICES_DIR:-/var/lib/docker/volumes/parallext-fiscal-data/_data}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"

# ── Offsite (S3-compatible) ──
# Set these in GitHub Secrets → injected into .env by deploy.yml. Leave
# OFFSITE_BUCKET empty to disable offsite sync (local-only backups).
#   OFFSITE_BUCKET    e.g. "parallext-backups"
#   OFFSITE_PATH      prefix inside the bucket (default "parallext")
#   OFFSITE_PROVIDER  rclone S3 provider: AWS | Cloudflare | Other (Backblaze)
#   OFFSITE_REGION    e.g. "us-east-1" (AWS) or "auto" (R2)
#   OFFSITE_ENDPOINT  empty for AWS; the account endpoint for R2/B2
#   OFFSITE_ACCESS_KEY / OFFSITE_SECRET_KEY
OFFSITE_BUCKET="${OFFSITE_BUCKET:-}"
OFFSITE_PATH="${OFFSITE_PATH:-parallext}"
OFFSITE_PROVIDER="${OFFSITE_PROVIDER:-AWS}"
OFFSITE_REGION="${OFFSITE_REGION:-us-east-1}"
OFFSITE_ENDPOINT="${OFFSITE_ENDPOINT:-}"
OFFSITE_ACCESS_KEY="${OFFSITE_ACCESS_KEY:-}"
OFFSITE_SECRET_KEY="${OFFSITE_SECRET_KEY:-}"

# Retention
DAILY_KEEP=7
WEEKLY_KEEP=4
MONTHLY_KEEP=2

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)
BACKUP_PATH="${BACKUP_DIR}/daily/${TIMESTAMP}"

# Tracks whether the critical DB dumps succeeded. The success heartbeat and the
# offsite sync only run when this stays 1 — otherwise a failed dump would write a
# "green" heartbeat and ship an empty archive offsite (false sense of safety).
BACKUP_OK=1

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

# ── Integrity gate: the DB dumps are the non-negotiable part of a backup ──
if [ ! -s "${BACKUP_PATH}/public.dump" ]; then
  echo "  ERROR: public.dump is missing or empty"; BACKUP_OK=0
fi
if [ ! -s "${BACKUP_PATH}/full_backup.dump" ]; then
  echo "  ERROR: full_backup.dump is missing or empty"; BACKUP_OK=0
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

# ── Offsite sync (S3-compatible via rclone) ──
# Only runs when a bucket is configured AND the DB dumps were valid, so we never
# ship an empty/partial archive. rclone is configured entirely via environment
# variables (no rclone.conf needed) so the remote is reproducible from .env.
OFFSITE_OK=0
if [ -n "${OFFSITE_BUCKET}" ] && [ "${BACKUP_OK}" = "1" ]; then
  if command -v rclone &> /dev/null; then
    echo ""
    echo "Syncing offsite → ${OFFSITE_PROVIDER}:${OFFSITE_BUCKET}/${OFFSITE_PATH}/ ..."
    export RCLONE_CONFIG_OFFSITE_TYPE=s3
    export RCLONE_CONFIG_OFFSITE_PROVIDER="${OFFSITE_PROVIDER}"
    export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${OFFSITE_ACCESS_KEY}"
    export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${OFFSITE_SECRET_KEY}"
    export RCLONE_CONFIG_OFFSITE_REGION="${OFFSITE_REGION}"
    [ -n "${OFFSITE_ENDPOINT}" ] && export RCLONE_CONFIG_OFFSITE_ENDPOINT="${OFFSITE_ENDPOINT}"
    # Mirror the local retention layout to the bucket. --immutable would block
    # accidental overwrites of same-name files; we rely on unique timestamps.
    if rclone sync "${BACKUP_DIR}/" "offsite:${OFFSITE_BUCKET}/${OFFSITE_PATH}/" \
        --transfers 4 --checkers 8 --log-level NOTICE 2>&1; then
      OFFSITE_OK=1
      echo "  OK — offsite sync complete"
    else
      echo "  ERROR: offsite sync failed — local backup is intact, offsite is stale"
    fi
  else
    echo "  WARN: OFFSITE_BUCKET set but rclone not installed (curl https://rclone.org/install.sh | sudo bash)"
  fi
elif [ -n "${OFFSITE_BUCKET}" ] && [ "${BACKUP_OK}" != "1" ]; then
  echo "  SKIP offsite — DB dump was incomplete, not shipping a bad archive"
fi

# ── Heartbeat for the ops-center backup monitor ──
# Records a success timestamp (epoch ms) in Redis ONLY when the DB dumps are
# valid. PlatformMonitorService reads `backup:last_success` daily and raises a
# critical incident if it goes stale (>26h). Writing it on a failed backup would
# hide the failure. If Redis requires a password, add `-a "${REDIS_PASSWORD}"`.
if [ "${BACKUP_OK}" = "1" ]; then
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    docker exec "${REDIS_CONTAINER}" redis-cli -a "${REDIS_PASSWORD}" SET backup:last_success "$(date +%s%3N)" >/dev/null 2>&1 \
      || echo "  WARN: Could not write backup heartbeat to Redis"
  else
    docker exec "${REDIS_CONTAINER}" redis-cli SET backup:last_success "$(date +%s%3N)" >/dev/null 2>&1 \
      || echo "  WARN: Could not write backup heartbeat to Redis"
  fi
else
  echo "  SKIP heartbeat — backup incomplete, leaving backup:last_success stale so the monitor alerts"
fi

# ── Summary ──
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)
echo ""
echo "========================================"
echo "Backup complete!"
echo "  File: daily/${TIMESTAMP}.tar.gz"
echo "  Size: ${BACKUP_SIZE}"
echo "  Schemas: public + ${TENANT_COUNT} tenants"
echo "  Includes: DB + Redis + Media + Fiscal invoices"
echo "  Integrity: $([ "${BACKUP_OK}" = "1" ] && echo OK || echo FAILED)"
if [ -n "${OFFSITE_BUCKET}" ]; then
  echo "  Offsite: $([ "${OFFSITE_OK}" = "1" ] && echo "synced → ${OFFSITE_BUCKET}" || echo "NOT synced")"
fi
echo "  Total backup dir: ${TOTAL_SIZE}"
echo "========================================"

# Non-zero exit on integrity failure so cron/logs surface it.
[ "${BACKUP_OK}" = "1" ] || exit 1
