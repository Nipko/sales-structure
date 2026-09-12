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

# ── Read config from the production .env WITHOUT sourcing it ──
# The deploy writes unquoted values with shell-special chars, so `. .env` breaks
# the parser. Extract only the keys we need, literally.
ENV_FILE="${ENV_FILE:-/opt/parallext-engine/.env}"
env_get() {
  [ -f "${ENV_FILE}" ] || return 0
  grep -E "^${1}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2-
}

# Configuration
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-parallext}"
DB_NAME="${DATABASE_NAME:-parallext_engine}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/docker/volumes/parallext-media-data/_data}"
INVOICES_DIR="${INVOICES_DIR:-/var/lib/docker/volumes/parallext-fiscal-data/_data}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"
# pg_restore runs inside the postgres container (no host postgresql-client needed).
PG_CONTAINER="${PG_CONTAINER:-parallext-postgres}"
DB_PASSWORD="${DB_PASSWORD:-$(env_get DB_PASSWORD)}"

# Offsite (S3-compatible) — same vars as backup.sh
OFFSITE_BUCKET="${OFFSITE_BUCKET:-$(env_get OFFSITE_BUCKET)}"
OFFSITE_PATH="${OFFSITE_PATH:-$(env_get OFFSITE_PATH)}";           OFFSITE_PATH="${OFFSITE_PATH:-parallext}"
OFFSITE_PROVIDER="${OFFSITE_PROVIDER:-$(env_get OFFSITE_PROVIDER)}"; OFFSITE_PROVIDER="${OFFSITE_PROVIDER:-AWS}"
OFFSITE_REGION="${OFFSITE_REGION:-$(env_get OFFSITE_REGION)}";     OFFSITE_REGION="${OFFSITE_REGION:-us-east-1}"
OFFSITE_ENDPOINT="${OFFSITE_ENDPOINT:-$(env_get OFFSITE_ENDPOINT)}"
OFFSITE_ACCESS_KEY="${OFFSITE_ACCESS_KEY:-$(env_get OFFSITE_ACCESS_KEY)}"
OFFSITE_SECRET_KEY="${OFFSITE_SECRET_KEY:-$(env_get OFFSITE_SECRET_KEY)}"

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

# ── Extract archive, or accept a bare dump ──
#
# The pre-deploy safety net writes ONE custom-format dump
# (`/backup/pre-deploy/predeploy_*.dump`), not a nightly tarball. This script
# only accepted `.tar.gz`, so the backup taken specifically to be restored
# after a bad migration could not be restored by the restore script — the one
# moment somebody reaches for it is the one moment it refused.
#
# ── AND THE TWO ARCHIVES ARE NOT THE SAME SHAPE ─────────────────────────────
#
# A nightly tarball holds ONE DUMP PER SCHEMA: `public.dump` taken with
# `--schema=public`, one `tenant_*.dump` per active tenant, plus a whole-database
# `full_backup.dump`. The pre-deploy return point and the cut-over's return point
# are a single `pg_dump --format=custom` with NO `--schema` filter — the WHOLE
# database, every schema, in one archive.
#
# Calling the second one `public.dump` made the restore below apply
# `--schema=public` to it, which is what discarded every tenant schema it
# contained. So the mode is decided HERE, once, by what the archive actually is,
# and the restore follows it.
echo "[1] Reading ${ARCHIVE}..."
cd "${WORK_DIR}"
RESTORE_MODE=""
DB_ARCHIVE=""
case "${ARCHIVE}" in
  *.dump)
    # A single dump has no directory and no manifest. It keeps the name
    # `full_backup.dump` — the same name `backup.sh` gives the unfiltered dump
    # it writes nightly — because that is what it IS.
    cp "${ARCHIVE}" "${WORK_DIR}/full_backup.dump"
    cd "${WORK_DIR}"
    RESTORE_MODE="whole-database"
    DB_ARCHIVE="full_backup.dump"
    ;;
  *)
    tar -xzf "${ARCHIVE}"
    BACKUP_SUBDIR=$(ls -d */ | head -1)
    cd "${BACKUP_SUBDIR}"
    RESTORE_MODE="per-schema"
    ;;
esac

echo "  Contents:"
ls -lh
echo ""

if [ "${FLAG}" = "--dry-run" ]; then
  echo "DRY RUN — listing contents only, no changes made."
  echo "Restore mode: ${RESTORE_MODE}"
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
#
# ═══ A FAILED RESTORE IS FATAL, AND "OK" MEANS IT WORKED ═══
#
# Both restores used to end in `|| echo "WARN: ... (usually safe)"`, and the
# script then printed "OK — all schemas restored" unconditionally. So a restore
# that restored NOTHING — wrong container, wrong credentials, a truncated dump,
# a schema that does not exist — printed OK and exited 0.
#
# That is the worst possible failure mode for this particular script, because
# the only two moments anybody runs it are a disaster and a drill. In the
# disaster it says the data is back when it is not. In the drill it certifies a
# restore path that does not work, which is how the drill comes to be the thing
# that hides the problem.
#
# `--exit-on-error` as well: without it `pg_restore` continues past a failed
# statement and exits 0, so even a checked exit code would have said yes.
#
# ═══ AND A RESTORE THAT SKIPPED THE TENANT SCHEMAS DID NOT WORK ═══
#
# The other half of the same lie, reproduced with a stubbed `pg_restore`: a bare
# `*.dump` — the pre-migration return point `.github/workflows/deploy.yml` takes
# over the WHOLE database, and the one `infra/scripts/october-cutover.sh` takes
# in `step_backup` — was copied to `public.dump` and then restored with
# `--schema=public`. `pg_restore` obediently threw away every `tenant_*` object
# the archive contained. The tenant loop below then globbed `tenant_*.dump`,
# matched nothing, never executed, and left RESTORE_FAILURES at 0, so the script
# printed
#
#     OK — public schema
#     OK — all schemas restored
#     Restore complete!            (exit 0)
#
# having restored `public` and DISCARDED every conversation, message, spend row
# and outbox entry in the archive. Rolling back a bad migration that way resets
# `tenants`, `billing_subscriptions`, `billing_payments` and `audit_logs` to the
# return point while leaving every tenant schema at its post-migration state —
# two halves of one database at two different points in time — and certifies it
# as complete.
#
# Two changes, because either one alone still lies:
#
#   · the archive is restored ACCORDING TO WHAT IT IS. A whole-database dump gets
#     no `--schema` filter, because it already contains every schema; only the
#     per-schema dumps inside a nightly tarball get one.
#   · what the archive CONTAINS is read back out of its own table of contents and
#     checked against the schemas that exist afterwards. Checking exit codes
#     could never have caught the original defect, because it was not an error: a
#     filter that excludes everything exits 0 having done nothing. Only a
#     positive statement about what is now there can.

# Every schema named anywhere in a custom-format archive's table of contents.
#
# `pg_restore --list` prints one TOC entry per line:
#     <dumpId>; <tableoid> <oid> <desc> <schema> <name> <owner>
# ── ONLY THE LINE WHOSE SHAPE IS UNAMBIGUOUS ─────────────────────────────────
#
# A TOC line is `<id>; <tableoid> <oid> <desc> <schema> <name> <owner>`, and
# `desc` is NOT one word: `TABLE DATA`, `SEQUENCE SET`, `FK CONSTRAINT`,
# `MATERIALIZED VIEW DATA`, `DEFAULT ACL`, `TEXT SEARCH DICTIONARY` are all real.
# Reading a fixed field number therefore reads the wrong column, and the first
# version of this function did: against an ordinary archive it extracted `DATA`,
# `SET` and `CONSTRAINT` as if they were schema names, then reported a perfectly
# correct restore as FAILED because the database had no schema called `DATA`.
# That is worse than the defect it replaced — it blocks the rollback it exists
# to protect.
#
# So nothing here parses a variable-length field. `SCHEMA - <name> <owner>` is
# the one TOC line with a fixed shape, pg_dump writes one per schema it creates,
# and those are exactly the schemas a restore has to bring back.
schemas_in_archive() {
  docker exec -i "${PG_CONTAINER}" pg_restore --list < "$1" \
    | tr -d '\r' \
    | sed -E 's/^[0-9]+; [0-9]+ [0-9]+ //' \
    | awk '$1 == "SCHEMA" && $2 == "-" { print $3 }' \
    | sort -u
}

# How many TOC entries the archive has at all, so "creates no schema" can be
# told from "is empty". A dump taken with `--schema=public` creates nothing —
# public already exists — and must not be read as an archive of nothing.
archive_entry_count() {
  docker exec -i "${PG_CONTAINER}" pg_restore --list < "$1" \
    | tr -d '\r' | grep -cE '^[0-9]+; [0-9]+ [0-9]+ ' || true
}

# Every non-system schema that exists in the live database right now.
schemas_in_database() {
  docker exec -i -e PGPASSWORD="${DB_PASSWORD:-}" "${PG_CONTAINER}" \
    psql -U "${DB_USER}" -d "${DB_NAME}" -Atc \
    "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'" \
    < /dev/null | tr -d '\r' | sed '/^$/d' | sort -u
}

# The archive says what should be there; the database says what is. Anything the
# archive names and the database does not have means the restore did not restore
# it — whatever `pg_restore` exited with.
verify_schemas_restored() {
  local archive="$1" archive_schemas live_schemas missing="" schema
  if ! archive_schemas="$(schemas_in_archive "${archive}")"; then
    echo "  FAILED — could not read the table of contents of ${archive}; what was restored cannot be verified"
    return 1
  fi
  if [ -z "${archive_schemas}" ]; then
    # No CREATE SCHEMA entry. Either the archive is empty — nothing was
    # captured, which is a failure worth shouting about — or it is a
    # `--schema=public` dump, which creates no schema because public already
    # exists. The entry count is what tells those two apart.
    local entries
    entries="$(archive_entry_count "${archive}")"
    if [ "${entries:-0}" -le 0 ]; then
      echo "  FAILED — ${archive} has no table of contents at all; there was nothing in it to restore"
      return 1
    fi
    archive_schemas="public"
  fi
  if ! live_schemas="$(schemas_in_database)"; then
    echo "  FAILED — could not list the schemas in ${DB_NAME}; what was restored cannot be verified"
    return 1
  fi
  for schema in ${archive_schemas}; do
    printf '%s\n' "${live_schemas}" | grep -qxF "${schema}" || missing="${missing} ${schema}"
  done
  if [ -n "${missing}" ]; then
    echo "  FAILED — ${archive} contains schema(s) that are NOT in the database after the restore:${missing}"
    return 1
  fi
  echo "  Verified — every schema in ${archive} exists: $(printf '%s' "${archive_schemas}" | tr '\n' ' ')"
  return 0
}

if [ "${FLAG}" != "--media-only" ]; then
  echo "[2] Restoring database..."
  RESTORE_FAILURES=0

  if [ "${RESTORE_MODE}" = "whole-database" ]; then
    # ONE archive holding every schema, so NO `--schema` filter. Applying one
    # here is precisely the defect this branch exists in order not to have.
    echo "  Restoring the whole database from ${DB_ARCHIVE} (all schemas)..."
    if docker exec -i -e PGPASSWORD="${DB_PASSWORD:-}" "${PG_CONTAINER}" \
      pg_restore -U "${DB_USER}" -d "${DB_NAME}" --exit-on-error \
      --clean --if-exists --no-owner --no-privileges \
      < "${DB_ARCHIVE}" 2>&1; then
      echo "  OK — whole-database archive applied"
    else
      echo "  FAILED — the whole-database restore did not complete"
      RESTORE_FAILURES=$((RESTORE_FAILURES + 1))
    fi
    verify_schemas_restored "${DB_ARCHIVE}" || RESTORE_FAILURES=$((RESTORE_FAILURES + 1))
  else
    # Per-schema mode: one dump per schema, each restored with its own filter.
    # `public.dump` here really IS public-only (`backup.sh` takes it with
    # `--schema=public`), so the filter matches the archive.

    # Public schema
    if [ -f "public.dump" ]; then
      echo "  Restoring public schema..."
      if docker exec -i -e PGPASSWORD="${DB_PASSWORD:-}" "${PG_CONTAINER}" \
        pg_restore -U "${DB_USER}" -d "${DB_NAME}" --exit-on-error \
        --schema=public --clean --if-exists --no-owner --no-privileges \
        < "public.dump" 2>&1; then
        echo "  OK — public schema"
      else
        echo "  FAILED — public schema did not restore"
        RESTORE_FAILURES=$((RESTORE_FAILURES + 1))
      fi
    fi

    # Tenant schemas
    for DUMP in tenant_*.dump; do
      if [ -f "${DUMP}" ]; then
        SCHEMA="${DUMP%.dump}"
        echo "  Restoring ${SCHEMA}..."
        if docker exec -i -e PGPASSWORD="${DB_PASSWORD:-}" "${PG_CONTAINER}" \
          pg_restore -U "${DB_USER}" -d "${DB_NAME}" --exit-on-error \
          --schema="${SCHEMA}" --clean --if-exists --no-owner --no-privileges \
          < "${DUMP}" 2>&1; then
          echo "  OK — ${SCHEMA}"
        else
          echo "  FAILED — ${SCHEMA} did not restore"
          RESTORE_FAILURES=$((RESTORE_FAILURES + 1))
        fi
      fi
    done

    # `backup.sh` writes `full_backup.dump` alongside the per-schema ones, so the
    # tarball carries its OWN statement of what that night's backup captured. It
    # is the authority here: a tarball whose per-schema tenant dump silently
    # failed — `backup.sh` only WARNs on that — restores `public` and nothing
    # else, and the glob below it matches nothing, which without this check is
    # once again a green "all schemas restored".
    #
    # It also catches the case `docs/backup-restore-runbook.md` already writes
    # down and nothing enforced: a tenant that was `is_active = false` when the
    # backup ran gets NO per-schema dump, so restoring a tarball the per-schema
    # way into an empty database leaves that tenant's data behind — present in
    # the archive, absent from the restore, and previously reported as complete.
    if [ -f "full_backup.dump" ]; then
      if ! verify_schemas_restored "full_backup.dump"; then
        echo "  This backup captured a schema the per-schema restore did not bring back."
        echo "  A tenant that was is_active=false when the backup ran has no tenant_*.dump:"
        echo "  its data lives ONLY inside full_backup.dump. Restore that archive whole:"
        echo "    $0 <extracted-dir>/full_backup.dump --db-only"
        RESTORE_FAILURES=$((RESTORE_FAILURES + 1))
      fi
    elif [ -f "public.dump" ]; then
      verify_schemas_restored "public.dump" || RESTORE_FAILURES=$((RESTORE_FAILURES + 1))
    fi
  fi

  if [ "${RESTORE_FAILURES}" -gt 0 ]; then
    echo ""
    echo "ERROR: ${RESTORE_FAILURES} schema(s) did not restore. NOTHING further will run."
    echo "  The database is now in a PARTIAL state: some schemas may have been"
    echo "  dropped by --clean and not recreated. Do not start the application"
    echo "  against it. Investigate, then re-run this script."
    exit 1
  fi
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
