#!/usr/bin/env bash
#
# ═══ THE OCTOBER CUT-OVER, AS A COMMAND RATHER THAN A DOCUMENT ═══
#
# The runbook described eleven steps in a table. A table is not a procedure: the
# reviewer of that runbook reproduced three things a person following it would
# have done, in order, at three in the morning:
#
#   · Step 1 ran `docker compose up` — the restore rehearsal and the write
#     barrier were further down the page, so the services were replaced BEFORE
#     the return point existed;
#   · the rollback was not executable — the runbook said `pg_dumpall`, the deploy
#     writes `pg_dump --format=custom`, and `infra/backup/restore.sh` reads a
#     `.tar.gz`, so no single command could restore what was actually taken;
#   · nothing was resumable. A window that fails at step 7 and is retried from
#     step 1 takes the backup again, over a database that has already been half
#     migrated.
#
# This file is the same eleven steps with those three properties fixed, and the
# ORDER enforced rather than described:
#
#    1 inventory   read-only census of the live host, hashed and kept
#    2 rehearsal   dump → restore into a DISPOSABLE database → compare
#    3 barrier     global write barrier: ingress down AND the database read-only
#    4 drain       wait for in-flight work, refuse if anything is still active
#    5 backup      the return point, in the one format everything here reads
#    6 preflight   the agreed-terms gate, on the OLD schema
#    7 migrate     public schema, then every tenant schema
#    8 images      recreate the containers, pinned by DIGEST
#    9 health      the API answers, and the containers ARE the approved bytes
#   10 canary      the pilot tenants named in step 1
#   11 reopen      lift the barrier
#
# Every step records completion in a state directory, so re-running resumes at
# the first step that is not done. Nothing runs out of order: step N refuses
# unless 1…N-1 are recorded, which is what makes "no `compose up` before the
# restore is proven and the window is open" a property of the program instead of
# a sentence in a document.
#
# ── WHAT IT WILL NOT DO ───────────────────────────────────────────────────────
#
# It does not decide. The window, the pilot tenants, the approval and the
# manifest all arrive as arguments. It has no default host, no `latest`, and no
# way to reach a database whose name it was not given.
#
# Usage:
#   october-cutover.sh --manifest /abs/candidate-manifest.json --evidence /abs/dir [--only STEP]
#   october-cutover.sh --status   --evidence /abs/dir
#   october-cutover.sh --only rehearsal --evidence /abs/dir \
#       --rehearsal-url postgresql://user:pw@127.0.0.1:5432/oct_cutover_rehearsal
#
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# PINNED: cwd, project, paths. Nothing here is relative and nothing is guessed.
# ═══════════════════════════════════════════════════════════════════════════════
#
# `cd -` into the repository root derived from THIS FILE's location, not from
# wherever the operator happened to be standing. A cut-over run from `~` picks up
# a different `.env`, a different compose file and a different project name, and
# the three disagreements do not announce themselves.
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_PATH}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.prod.yml"
ENV_FILE="${REPO_ROOT}/.env"
# One project name, stated. Compose otherwise derives it from the directory,
# so the same stack answers to two names depending on where you stood.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-docker}"
export COMPOSE_PROJECT_NAME

PG_CONTAINER="${PG_CONTAINER:-parallext-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"
DB_USER="${DB_USER:-parallext}"
DB_NAME="${DB_NAME:-parallext_engine}"

# ── The one dump format ───────────────────────────────────────────────────────
#
# `pg_dump --format=custom`, read back by `pg_restore`. It is what
# `.github/workflows/deploy.yml` writes for its pre-migration return point and
# what `infra/backup/backup.sh` writes nightly, so the rollback of this window
# and the rollback of an ordinary deploy are the same file read the same way.
# The runbook used to say `pg_dumpall`, which nothing in this repository
# produces and `pg_restore` cannot read.
DUMP_FORMAT=custom
DUMP_SUFFIX=.dump

# ── The steps, in the only order they are allowed to happen in ────────────────
STEPS=(inventory rehearsal barrier drain backup preflight migrate images health canary reopen)

MANIFEST=""
EVIDENCE=""
ONLY=""
STATUS_ONLY=0
REHEARSAL_URL="${CUTOVER_REHEARSAL_URL:-}"
PILOT_TENANTS="${CUTOVER_PILOT_TENANTS:-}"

log()   { printf '[cutover] %s\n' "$*"; }
fatal() { printf '[cutover] FATAL: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest)       MANIFEST="$2"; shift 2 ;;
    --evidence)       EVIDENCE="$2"; shift 2 ;;
    --only)           ONLY="$2"; shift 2 ;;
    --rehearsal-url)  REHEARSAL_URL="$2"; shift 2 ;;
    --pilot-tenants)  PILOT_TENANTS="$2"; shift 2 ;;
    --status)         STATUS_ONLY=1; shift ;;
    *) fatal "unknown argument '$1'" ;;
  esac
done

[ -n "${EVIDENCE}" ] || fatal "--evidence <absolute dir> is required; a window with no evidence directory leaves nothing to read afterwards"
case "${EVIDENCE}" in /*) ;; *) fatal "--evidence must be an ABSOLUTE path (got '${EVIDENCE}')" ;; esac

# The directory the inventory writes into. `vps-inventory.cjs` calls
# `writeFileSync` and does not create its parent, so an unmounted or missing
# `/evidence` made the census fail after it had already run — which is how a
# cut-over ends up with no record of what it started from.
STATE_DIR="${EVIDENCE}/state"
mkdir -p "${STATE_DIR}"

# ── The host tools this needs, checked BEFORE the window, not during it ───────
#
# `postgresql-client` is deliberately NOT in this list: every PostgreSQL client
# runs inside the container. `node` is, because the manifest consumer is a Node
# script and reimplementing its checks in shell is how the two drift apart. If
# the host has no Node, install one before the window rather than discovering it
# with the write barrier down.
NODE="${NODE:-node}"
require_host_tools() {
  local missing="" tool
  for tool in docker sha256sum diff; do
    command -v "${tool}" > /dev/null 2>&1 || missing="${missing} ${tool}"
  done
  command -v "${NODE}" > /dev/null 2>&1 || missing="${missing} ${NODE}(set NODE=/path/to/node)"
  [ -z "${missing}" ] || fatal "this host is missing:${missing}. Install them before the window opens."
}

state_file() { printf '%s/%s.done' "${STATE_DIR}" "$1"; }
is_done()    { [ -f "$(state_file "$1")" ]; }
mark_done()  {
  # The record carries WHAT was done and against which inventory, so a resumed
  # window cannot silently continue against a different starting state.
  printf 'step=%s\ncompletedAt=%s\ninventorySha256=%s\ngitSha=%s\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(inventory_hash)" "${GIT_SHA:-unset}" \
    > "$(state_file "$1")"
  log "step '$1' recorded done"
}

inventory_hash() {
  if [ -f "${EVIDENCE}/inventory.json" ]; then
    sha256sum "${EVIDENCE}/inventory.json" | cut -d' ' -f1
  else
    printf 'none'
  fi
}

# ── Ordering is a property of the program, not a paragraph ────────────────────
require_prior_steps() {
  local target="$1" step
  for step in "${STEPS[@]}"; do
    [ "$step" = "$target" ] && return 0
    if ! is_done "$step"; then
      fatal "'${target}' cannot run: '${step}' has not completed. The order is not advisory — it is what keeps the return point older than the change."
    fi
  done
  fatal "unknown step '${target}'"
}

status() {
  printf 'cut-over state in %s\n' "${EVIDENCE}"
  local step
  for step in "${STEPS[@]}"; do
    if is_done "$step"; then
      printf '  [done]    %-10s %s\n' "$step" "$(sed -n 's/^completedAt=//p' "$(state_file "$step")")"
    else
      printf '  [pending] %s\n' "$step"
    fi
  done
  printf 'inventory sha256: %s\n' "$(inventory_hash)"
}

if [ "${STATUS_ONLY}" = "1" ]; then status; exit 0; fi

require_host_tools

# ═══════════════════════════════════════════════════════════════════════════════
# WHAT THE CANDIDATE IS: five digests, one commit, read from the manifest
# ═══════════════════════════════════════════════════════════════════════════════
#
# Read here rather than inside the step that starts containers, so a manifest
# that cannot pin stops the run before the barrier goes down rather than after.
GIT_SHA=""
if [ -n "${MANIFEST}" ]; then
  case "${MANIFEST}" in /*) ;; *) fatal "--manifest must be an ABSOLUTE path" ;; esac
  [ -f "${MANIFEST}" ] || fatal "no manifest at ${MANIFEST}"
  GIT_SHA="$("${NODE}" -e 'const m=require(process.argv[1]);process.stdout.write(String(m.sha||""))' "${MANIFEST}")"
  printf '%s' "${GIT_SHA}" | grep -Eq '^[0-9a-f]{40}$' \
    || fatal "the manifest names no full commit sha"
  # The consumer refuses a manifest whose verification did not conclude
  # `success`, whose service names the wrong repository, or whose digests are
  # incomplete. Running it now means the window never opens for a candidate
  # nothing vouched for.
  "${NODE}" "${REPO_ROOT}/infra/scripts/apply-candidate-manifest.cjs" \
    --manifest "${MANIFEST}" \
    --out "${EVIDENCE}/docker-compose.candidate.yml" \
    || fatal "the manifest cannot pin five digests; nothing below may run"
  export GIT_SHA
  export IMAGE_TAG="candidate-${GIT_SHA}"
fi

DC=(docker compose --project-name "${COMPOSE_PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
DC_PINNED=("${DC[@]}" -f "${EVIDENCE}/docker-compose.candidate.yml")

# ── Every PostgreSQL client runs INSIDE the postgres container ────────────────
#
# Not a preference: the host has no `postgresql-client`, and installing one would
# introduce a client whose version can differ from the server's. This is the same
# decision `infra/backup/backup.sh` already made, and the reason the nightly
# backup once produced 0-byte dumps that looked complete — `pg_dump` was being
# called on the host, where it did not exist.
pg_in_container() {
  docker exec -i -e PGPASSWORD="${DB_PASSWORD:-}" "${PG_CONTAINER}" "$@"
}

psql_admin() {
  pg_in_container psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 "$@"
}

# ═══════════════════════════════════════════════════════════════════════════════
# 1. INVENTORY — read-only, persistent, hashed
# ═══════════════════════════════════════════════════════════════════════════════
step_inventory() {
  require_prior_steps inventory
  log "inventory: reading the live host (read-only)"
  mkdir -p "${EVIDENCE}"
  # `run --rm` starts ONE container and removes it. It is not `up`: nothing that
  # is serving traffic is replaced, which is the whole reason this may run before
  # the window.
  "${DC[@]}" run --rm -v "${EVIDENCE}:/evidence" api \
    node scripts/vps-inventory.cjs --json /evidence/inventory.json \
    | tee "${EVIDENCE}/inventory.log"
  [ -s "${EVIDENCE}/inventory.json" ] || fatal "the inventory wrote nothing; there is no starting state to compare against"
  # Hashed and kept. Every later step records the hash it ran against, so a
  # window resumed a day later against a changed host is visible rather than
  # assumed away.
  inventory_hash > "${EVIDENCE}/inventory.sha256"
  log "inventory sha256 $(cat "${EVIDENCE}/inventory.sha256")"
  local unknown
  unknown="$("${NODE}" -e 'const i=require(process.argv[1]);process.stdout.write(String((i.unknown_probes||[]).length))' \
    "${EVIDENCE}/inventory.json")"
  [ "${unknown}" = "0" ] || fatal "the inventory could not read ${unknown} probe(s). Not zero is not zero: find out why before choosing a window."
  mark_done inventory
}

# ═══════════════════════════════════════════════════════════════════════════════
# 2. REHEARSAL — dump, restore into a disposable database, COMPARE
# ═══════════════════════════════════════════════════════════════════════════════
#
# Before the VPS is touched. Every failure here is FATAL, which is the whole
# difference from `infra/backup/restore.sh`: that script reports a failed
# `pg_restore` as `WARN: some restore warnings (usually safe)` and continues, so
# a restore that silently restored nothing looks exactly like one that worked.
# A return point nobody has read back is not a return point.
step_rehearsal() {
  require_prior_steps rehearsal
  [ -n "${REHEARSAL_URL}" ] || fatal "--rehearsal-url is required: the restore has to land somewhere DISPOSABLE, and this script will not invent a destination"

  local target
  target="$(printf '%s' "${REHEARSAL_URL}" | sed 's#.*/##; s#?.*##')"
  case "${target}" in
    *_eval_isolation|*rehearsal*) ;;
    *) fatal "'${target}' does not SAY it is disposable. Not 'not production' — say it: a neutral name is one somebody eventually reads as something else." ;;
  esac
  [ "${target}" != "${DB_NAME}" ] || fatal "the rehearsal target is the operational database"

  local dump="${EVIDENCE}/rehearsal${DUMP_SUFFIX}"
  log "rehearsal: taking a ${DUMP_FORMAT}-format dump of ${DB_NAME}"
  pg_in_container pg_dump -U "${DB_USER}" -d "${DB_NAME}" --format="${DUMP_FORMAT}" < /dev/null > "${dump}" \
    || fatal "the dump failed; there is nothing to rehearse restoring"
  [ -s "${dump}" ] || fatal "the dump is empty"

  # ── The target is EMPTIED first, and proven empty ───────────────────────────
  #
  # Reproduced while writing this: a rehearsal that restored only `public` into a
  # target still holding the previous run's tenant schemas compared clean and
  # reported "8 tables match, row for row". The comparison was fine; the
  # experiment was not. A restore that restores nothing is indistinguishable from
  # one that works when the destination already contains the answer — which is
  # precisely the rollback that would be attempted on a real return point.
  log "rehearsal: emptying ${target} before restoring into it"
  pg_in_container psql "${REHEARSAL_URL}" -v ON_ERROR_STOP=1 < /dev/null -c "
    DO \$\$ DECLARE s text; BEGIN
      FOR s IN SELECT nspname FROM pg_namespace
                WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                  AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%'
      LOOP EXECUTE format('DROP SCHEMA %I CASCADE', s); END LOOP;
      EXECUTE 'CREATE SCHEMA public';
    END \$\$;" \
    || fatal "could not empty the rehearsal target; a restore into a non-empty database proves nothing"
  local before
  before="$(pg_in_container psql "${REHEARSAL_URL}" -Atc "
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')" \
    < /dev/null | tr -d '[:space:]')"
  [ "${before}" = "0" ] || fatal "the rehearsal target still holds ${before} table(s) after being emptied"

  log "rehearsal: restoring into ${target}"
  # `--exit-on-error`. Without it `pg_restore` prints errors, returns 0 for some
  # of them and leaves a partial database that answers queries — which is what
  # `infra/backup/restore.sh` reports as "warnings (usually safe)".
  #
  # The URL is resolved from INSIDE the postgres container, because that is where
  # the client lives.
  pg_in_container pg_restore --dbname="${REHEARSAL_URL}" --clean --if-exists --no-owner \
    --no-privileges --exit-on-error < "${dump}" \
    || fatal "the restore failed. This is fatal on purpose: a rehearsal that warns and continues is how a window discovers during the window that its return point does not restore."

  log "rehearsal: comparing schemas and row counts"
  compare_schemas_and_counts "${REHEARSAL_URL}" || fatal "the restored copy does not match the source"
  mark_done rehearsal
}

# The comparison the rehearsal exists for. Names of schemas, and the number of
# rows in every table of each, on both sides. Anything else — "it restored
# without an error" — is a statement about a command's exit code.
compare_schemas_and_counts() {
  local url="$1"
  local source_file="${EVIDENCE}/rehearsal-source.txt"
  local restored_file="${EVIDENCE}/rehearsal-restored.txt"
  # Schema name, table name and the ACTUAL row count of every ordinary table.
  # `query_to_xml` is the only way to count rows of a dynamically named table in
  # one statement, which is what keeps this a single comparable list rather than
  # a loop whose failures are easy to miss.
  local census_sql="
    SELECT n.nspname || '.' || c.relname || '=' ||
           (xpath('/row/c/text()',
             query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                          false, true, '')))[1]::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
     ORDER BY 1"

  pg_in_container psql -U "${DB_USER}" -d "${DB_NAME}" -Atc "${census_sql}" < /dev/null > "${source_file}" \
    || fatal "could not census the source database"
  pg_in_container psql "${url}" -Atc "${census_sql}" < /dev/null > "${restored_file}" \
    || fatal "could not census the restored database"

  if ! diff -u "${source_file}" "${restored_file}" > "${EVIDENCE}/rehearsal-diff.txt"; then
    log "the restored copy differs from the source:"
    head -40 "${EVIDENCE}/rehearsal-diff.txt" >&2
    return 1
  fi
  log "rehearsal: $(wc -l < "${source_file}") tables match, row for row"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# 3. BARRIER — global, because the schemas are shared by every tenant
# ═══════════════════════════════════════════════════════════════════════════════
#
# Pausing the worker and the crons was never a barrier: the API, the WhatsApp
# service and anything reaching the host through Cloudflare keep writing, and a
# row in the old shape can be born in the gap between the preflight's photograph
# and the migration. Two layers, because either alone leaks:
#
#   · ingress stopped, so nothing new arrives;
#   · the DATABASE set read-only and existing backends terminated, so anything
#     that survived — a host cron, a stray psql, a container that restarted —
#     cannot write either.
step_barrier() {
  require_prior_steps barrier
  log "barrier: stopping every writer"
  "${DC[@]}" stop worker api whatsapp dashboard landing \
    || fatal "could not stop the writers; the barrier is not down"

  log "barrier: making the database refuse writes"
  psql_admin -c "ALTER DATABASE \"${DB_NAME}\" SET default_transaction_read_only = on" \
    || fatal "could not set the database read-only"
  # New sessions inherit the setting; existing ones do not, so they have to go.
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()" > /dev/null \
    || fatal "could not terminate the sessions that were already open"
  mark_done barrier
}

# ═══════════════════════════════════════════════════════════════════════════════
# 4. DRAIN — nothing may be mid-flight when the schema changes underneath it
# ═══════════════════════════════════════════════════════════════════════════════
step_drain() {
  require_prior_steps drain
  log "drain: waiting for in-flight work to finish"
  local waited=0 active
  while [ "${waited}" -lt 180 ]; do
    active="$(docker exec "${REDIS_CONTAINER}" sh -c \
      'redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} --no-auth-warning keys "bull:*:active" 2>/dev/null | wc -l' \
      | tr -d '[:space:]')"
    [ "${active:-0}" = "0" ] && break
    log "  ${active} queue(s) still active, waiting"
    sleep 5
    waited=$((waited + 5))
  done
  [ "${active:-0}" = "0" ] || fatal "jobs are still active after ${waited}s. A schema change under a running effect is how one message gets sent twice and another not at all."
  mark_done drain
}

# ═══════════════════════════════════════════════════════════════════════════════
# 5. BACKUP — the return point, in the format step 2 proved restorable
# ═══════════════════════════════════════════════════════════════════════════════
step_backup() {
  require_prior_steps backup
  local dump="${EVIDENCE}/return-point${DUMP_SUFFIX}"
  log "backup: taking the return point"
  pg_in_container pg_dump -U "${DB_USER}" -d "${DB_NAME}" --format="${DUMP_FORMAT}" < /dev/null > "${dump}" \
    || fatal "the return-point dump FAILED. No migration runs without one; this is the same refusal deploy.yml makes."
  [ -s "${dump}" ] || fatal "the return-point dump is empty"
  # Listed, not merely written. `pg_restore --list` parses the archive, so a
  # truncated or half-streamed file is caught now rather than during a rollback.
  pg_in_container pg_restore --list < "${dump}" > "${EVIDENCE}/return-point.toc" \
    || fatal "the return point is not a readable ${DUMP_FORMAT}-format archive"
  sha256sum "${dump}" > "${dump}.sha256"
  log "backup: $(wc -l < "${EVIDENCE}/return-point.toc") archive entries, sha256 $(cut -d' ' -f1 < "${dump}.sha256")"
  mark_done backup
}

# ═══════════════════════════════════════════════════════════════════════════════
# 6. PREFLIGHT — on the OLD schema, before the change it protects
# ═══════════════════════════════════════════════════════════════════════════════
step_preflight() {
  require_prior_steps preflight
  log "preflight: rows this release would stop being able to charge"
  local out rc=0
  out="$("${DC_PINNED[@]}" run --rm api node scripts/preflight-agreed-terms.cjs 2>&1)" || rc=$?
  printf '%s\n' "${out}" | tee "${EVIDENCE}/preflight.log"
  [ "${rc}" -eq 0 ] || fatal "the agreed-terms preflight exited ${rc}. Nothing was migrated. Resolve each row with a human decision before retrying."
  printf '%s\n' "${out}" | grep -q 'AGREED_TERMS_PREFLIGHT .*blocks=0' \
    || fatal "the preflight did not report a clean summary line; refusing to migrate on an answer nobody can read"
  mark_done preflight
}

# ═══════════════════════════════════════════════════════════════════════════════
# 7. MIGRATE — public, then every tenant schema
# ═══════════════════════════════════════════════════════════════════════════════
step_migrate() {
  require_prior_steps migrate
  # The one place writes are allowed again, and only for the migration. The
  # ingress is still stopped, so the only thing that can write is this.
  log "migrate: lifting the read-only flag for the migration only"
  psql_admin -c "ALTER DATABASE \"${DB_NAME}\" SET default_transaction_read_only = off" \
    || fatal "could not lift the read-only flag"

  log "migrate: public schema"
  "${DC_PINNED[@]}" run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma \
    || fatal "prisma migrate deploy FAILED. The containers were not recreated; restore the return point if the schema is half applied."

  log "migrate: tenant schemas"
  local out rc=0
  out="$("${DC_PINNED[@]}" run --rm api npm run migrate:tenants 2>&1)" || rc=$?
  printf '%s\n' "${out}" | tr -d '\r' | tee "${EVIDENCE}/migrate-tenants.log"
  [ "${rc}" -eq 0 ] || fatal "the tenant migration exited ${rc}"
  local summary skipped warnings
  summary="$(printf '%s\n' "${out}" | tr -d '\r' | grep -o 'MIGRATE_TENANTS_SUMMARY .*' | tail -1 || true)"
  [ -n "${summary}" ] || fatal "the tenant migration emitted no verifiable summary"
  skipped="$(printf '%s\n' "${summary}" | sed -n 's/.*skipped=\([0-9]*\).*/\1/p')"
  warnings="$(printf '%s\n' "${summary}" | sed -n 's/.*warnings=\([0-9]*\).*/\1/p')"
  [ "${skipped:-0}" = "0" ] && [ "${warnings:-0}" = "0" ] \
    || fatal "the tenant migration is incomplete — ${summary}"
  mark_done migrate
}

# ═══════════════════════════════════════════════════════════════════════════════
# 8. IMAGES — the ONLY `compose up` in this file, and it is pinned by digest
# ═══════════════════════════════════════════════════════════════════════════════
#
# `require_prior_steps` is what makes the runbook's old order impossible: this
# cannot run until the rehearsal proved the restore, the barrier is down, the
# drain is clean, the return point exists and reads back, the preflight is clean
# and the migrations are complete.
step_images() {
  require_prior_steps images
  [ -n "${GIT_SHA}" ] || fatal "--manifest is required to recreate containers: a tag is mutable and a digest is not"
  log "images: recreating the stack pinned to ${GIT_SHA}"
  "${DC_PINNED[@]}" up -d --force-recreate \
    || fatal "the stack did not come up"
  mark_done images
}

# ═══════════════════════════════════════════════════════════════════════════════
# 9. HEALTH — it answers, AND it is the bytes that were approved
# ═══════════════════════════════════════════════════════════════════════════════
step_health() {
  require_prior_steps health
  log "health: waiting for the API"
  local waited=0
  until docker exec parallext-api node -e \
      "require('http').get('http://localhost:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" \
      2>/dev/null; do
    waited=$((waited + 5))
    [ "${waited}" -lt 180 ] || fatal "the API did not answer within 180s"
    sleep 5
  done
  log "health: and the containers ARE the approved candidate"
  "${NODE}" "${REPO_ROOT}/infra/scripts/apply-candidate-manifest.cjs" \
    --manifest "${MANIFEST}" --verify --project "${COMPOSE_PROJECT_NAME}" \
    || fatal "what is answering requests is not the candidate that was approved"
  mark_done health
}

# ═══════════════════════════════════════════════════════════════════════════════
# 10. CANARY — the tenants named in step 1, by id
# ═══════════════════════════════════════════════════════════════════════════════
step_canary() {
  require_prior_steps canary
  [ -n "${PILOT_TENANTS}" ] || fatal "--pilot-tenants is required: an empty list is read as EVERY tenant, which looks exactly like a careful rollout from the outside"
  log "canary: ${PILOT_TENANTS}"
  printf '%s\n' "${PILOT_TENANTS}" > "${EVIDENCE}/canary-tenants.txt"
  # Deliberately not automated further. Delivery, duplicates, retained exposure
  # and funding errors are read by a person against the runbook's checklist; a
  # script that declared them fine would be the most expensive kind of green.
  log "canary: verify delivery, duplicates, retainedExposure and funding errors against the runbook, then re-run with --only reopen"
  mark_done canary
}

# ═══════════════════════════════════════════════════════════════════════════════
# 11. REOPEN — writes come back last
# ═══════════════════════════════════════════════════════════════════════════════
step_reopen() {
  require_prior_steps reopen
  log "reopen: lifting the write barrier"
  psql_admin -c "ALTER DATABASE \"${DB_NAME}\" RESET default_transaction_read_only" \
    || fatal "could not lift the read-only flag"
  "${DC_PINNED[@]}" up -d worker api whatsapp dashboard landing \
    || fatal "the writers did not come back up"
  mark_done reopen
  log "the window is closed. State: ${STATE_DIR}"
}

run_step() {
  case "$1" in
    inventory) step_inventory ;;
    rehearsal) step_rehearsal ;;
    barrier)   step_barrier ;;
    drain)     step_drain ;;
    backup)    step_backup ;;
    preflight) step_preflight ;;
    migrate)   step_migrate ;;
    images)    step_images ;;
    health)    step_health ;;
    canary)    step_canary ;;
    reopen)    step_reopen ;;
    *) fatal "unknown step '$1'" ;;
  esac
}

cd "${REPO_ROOT}"

if [ -n "${ONLY}" ]; then
  run_step "${ONLY}"
  exit 0
fi

# Resume: the first step that is not recorded done.
for step in "${STEPS[@]}"; do
  if is_done "${step}"; then
    log "step '${step}' already done, skipping"
    continue
  fi
  run_step "${step}"
done
status
