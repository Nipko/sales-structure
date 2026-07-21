#!/bin/bash
# ============================================
# Parallext Engine — Backup Restore Script
# Restores DB (public + tenant schemas) + media + fiscal invoices + Redis
# from a backup archive. Can pull the archive from the offsite bucket first,
# which is the disaster-recovery path when the whole VPS is lost.
#
# Usage:
#   ./restore.sh /backup/daily/20260514_020000.tar.gz
#   ./restore.sh /backup/daily/20260514_020000.tar.gz --db-only
#   ./restore.sh /backup/daily/20260514_020000.tar.gz --dry-run
#   ./restore.sh --list-offsite                      # list archives in the bucket
#   ./restore.sh 20260514_020000.tar.gz              # auto-pulls from offsite if not local
# ============================================

set -euo pipefail

# ── Load production env (offsite credentials, dirs) ──
ENV_FILE="${ENV_FILE:-/opt/parallext-engine/.env}"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}" || echo "  WARN: could not source ${ENV_FILE}"
  set +a
fi

# Configuration
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-parallext}"
DB_NAME="${DATABASE_NAME:-parallext_engine}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/docker/volumes/parallext-media-data/_data}"
INVOICES_DIR="${INVOICES_DIR:-/var/lib/docker/volumes/parallext-fiscal-data/_data}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"

# Offsite (S3-compatible) — same vars as backup.sh
OFFSITE_BUCKET="${OFFSITE_BUCKET:-}"
OFFSITE_PATH="${OFFSITE_PATH:-parallext}"
OFFSITE_PROVIDER="${OFFSITE_PROVIDER:-AWS}"
OFFSITE_REGION="${OFFSITE_REGION:-us-east-1}"
OFFSITE_ENDPOINT="${OFFSITE_ENDPOINT:-}"
OFFSITE_ACCESS_KEY="${OFFSITE_ACCESS_KEY:-}"
OFFSITE_SECRET_KEY="${OFFSITE_SECRET_KEY:-}"

# Configure the rclone remote from env (no rclone.conf needed).
setup_offsite() {
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER="${OFFSITE_PROVIDER}"
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${OFFSITE_ACCESS_KEY}"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${OFFSITE_SECRET_KEY}"
  export RCLONE_CONFIG_OFFSITE_REGION="${OFFSITE_REGION}"
  [ -n "${OFFSITE_ENDPOINT}" ] && export RCLONE_CONFIG_OFFSITE_ENDPOINT="${OFFSITE_ENDPOINT}"
}

ARCHIVE="${1:-}"
FLAG="${2:-}"

# ── List offsite archives (disaster recovery discovery) ──
if [ "${ARCHIVE}" = "--list-offsite" ]; then
  if [ -z "${OFFSITE_BUCKET}" ]; then echo "ERROR: OFFSITE_BUCKET not configured."; exit 1; fi
  if ! command -v rclone &> /dev/null; then echo "ERROR: rclone not installed."; exit 1; fi
  setup_offsite
  echo "Offsite archives in offsite:${OFFSITE_BUCKET}/${OFFSITE_PATH}/daily/ :"
  rclone lsl "offsite:${OFFSITE_BUCKET}/${OFFSITE_PATH}/daily/" | sort -k4
  exit 0
fi

if [ -z "${ARCHIVE}" ]; then
  echo "Usage: $0 <backup-archive.tar.gz> [--db-only|--media-only|--dry-run]"
  echo "       $0 --list-offsite"
  echo ""
  echo "Available local backups:"
  ls -lh /backup/daily/*.tar.gz 2>/dev/null | tail -10
  echo ""
  ls -lh /backup/weekly/*.tar.gz 2>/dev/null | tail -5
  exit 1
fi

# ── Pull from offsite if the archive is not present locally ──
# Accepts either a full local path or a bare timestamp filename. If it is not on
# disk and an offsite bucket is configured, download it into /backup/daily first.
if [ ! -f "${ARCHIVE}" ]; then
  BASENAME=$(basename "${ARCHIVE}")
  if [ -n "${OFFSITE_BUCKET}" ] && command -v rclone &> /dev/null; then
    echo "Local archive not found — pulling ${BASENAME} from offsite..."
    setup_offsite
    mkdir -p "${BACKUP_DIR}/daily"
    if rclone copy "offsite:${OFFSITE_BUCKET}/${OFFSITE_PATH}/daily/${BASENAME}" "${BACKUP_DIR}/daily/" --log-level NOTICE 2>&1; then
      ARCHIVE="${BACKUP_DIR}/daily/${BASENAME}"
      echo "  OK — pulled to ${ARCHIVE}"
    else
      echo "ERROR: could not pull ${BASENAME} from offsite. Try: $0 --list-offsite"
      exit 1
    fi
  else
    echo "ERROR: File not found: ${ARCHIVE} (and no offsite bucket configured to pull it)."
    exit 1
  fi
fi

WORK_DIR=$(mktemp -d)
trap "rm -rf ${WORK_DIR}" EXIT

echo "========================================"
echo "Parallext Restore — $(date '+%Y-%m-%d %H:%M')"
echo "Archive: ${ARCHIVE}"
echo "========================================"

# ── Extract archive ──
echo "[1] Extracting archive..."
cd "${WORK_DIR}"
tar -xzf "${ARCHIVE}"
BACKUP_SUBDIR=$(ls -d */ | head -1)
cd "${BACKUP_SUBDIR}"

echo "  Contents:"
ls -lh
echo ""

if [ "${FLAG}" = "--dry-run" ]; then
  echo "DRY RUN — listing contents only, no changes made."
  echo ""
  echo "Database dumps:"
  ls -lh *.dump 2>/dev/null || echo "  (none)"
  echo ""
  echo "Media archive:"
  ls -lh media.tar.gz 2>/dev/null || echo "  (none)"
  echo ""
  echo "Fiscal invoices archive:"
  ls -lh fiscal-invoices.tar.gz 2>/dev/null || echo "  (none)"
  echo ""
  echo "Redis snapshot:"
  ls -lh redis.rdb 2>/dev/null || echo "  (none)"
  exit 0
fi

# ── Restore database ──
if [ "${FLAG}" != "--media-only" ]; then
  echo "[2] Restoring database..."

  # Public schema
  if [ -f "public.dump" ]; then
    echo "  Restoring public schema..."
    pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --schema=public \
      --clean --if-exists \
      --no-owner --no-privileges \
      "public.dump" 2>&1 || echo "  WARN: Some public schema restore warnings (usually safe)"
    echo "  OK — public schema"
  fi

  # Tenant schemas
  for DUMP in tenant_*.dump; do
    if [ -f "${DUMP}" ]; then
      SCHEMA="${DUMP%.dump}"
      echo "  Restoring ${SCHEMA}..."
      pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
        --schema="${SCHEMA}" \
        --clean --if-exists \
        --no-owner --no-privileges \
        "${DUMP}" 2>&1 || echo "  WARN: ${SCHEMA} restore warnings"
    fi
  done
  echo "  OK — all schemas restored"
fi

# ── Restore media ──
if [ "${FLAG}" != "--db-only" ] && [ -f "media.tar.gz" ]; then
  echo "[3] Restoring media..."
  mkdir -p "${MEDIA_DIR}"
  tar -xzf "media.tar.gz" -C "${MEDIA_DIR}/"
  echo "  OK — media restored to ${MEDIA_DIR}"
fi

# ── Restore fiscal invoices (legal 5-year retention) ──
if [ "${FLAG}" != "--db-only" ] && [ -f "fiscal-invoices.tar.gz" ]; then
  echo "[4] Restoring fiscal invoices..."
  mkdir -p "${INVOICES_DIR}"
  tar -xzf "fiscal-invoices.tar.gz" -C "${INVOICES_DIR}/"
  echo "  OK — fiscal invoices restored to ${INVOICES_DIR}"
fi

# ── Restore Redis ──
if [ "${FLAG}" != "--db-only" ] && [ "${FLAG}" != "--media-only" ] && [ -f "redis.rdb" ]; then
  echo "[5] Restoring Redis..."
  echo "  NOTE: Stop Redis before restoring, then copy dump.rdb and restart."
  echo "  Commands:"
  echo "    docker stop ${REDIS_CONTAINER}"
  echo "    docker cp redis.rdb ${REDIS_CONTAINER}:/data/dump.rdb"
  echo "    docker start ${REDIS_CONTAINER}"
  echo "  (Redis restore is manual to avoid data loss — skipping automatic restore)"
fi

echo ""
echo "========================================"
echo "Restore complete!"
echo "  Restart services: docker compose -f infra/docker/docker-compose.prod.yml restart"
echo "========================================"
