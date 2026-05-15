#!/bin/bash
# ============================================
# Parallext Engine — Backup Restore Script
# Restores DB (public + tenant schemas) + media + Redis from a backup archive.
#
# Usage:
#   ./restore.sh /backup/daily/20260514_020000.tar.gz
#   ./restore.sh /backup/daily/20260514_020000.tar.gz --db-only
#   ./restore.sh /backup/daily/20260514_020000.tar.gz --dry-run
# ============================================

set -euo pipefail

ARCHIVE="${1:-}"
FLAG="${2:-}"

if [ -z "${ARCHIVE}" ]; then
  echo "Usage: $0 <backup-archive.tar.gz> [--db-only|--media-only|--dry-run]"
  echo ""
  echo "Available backups:"
  ls -lh /backup/daily/*.tar.gz 2>/dev/null | tail -10
  echo ""
  ls -lh /backup/weekly/*.tar.gz 2>/dev/null | tail -5
  exit 1
fi

if [ ! -f "${ARCHIVE}" ]; then
  echo "ERROR: File not found: ${ARCHIVE}"
  exit 1
fi

# Configuration
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-parallext}"
DB_NAME="${DATABASE_NAME:-parallext_engine}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/docker/volumes/parallext-media-data/_data}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"

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
BACKUP_DIR=$(ls -d */ | head -1)
cd "${BACKUP_DIR}"

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

# ── Restore Redis ──
if [ "${FLAG}" != "--db-only" ] && [ "${FLAG}" != "--media-only" ] && [ -f "redis.rdb" ]; then
  echo "[4] Restoring Redis..."
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
