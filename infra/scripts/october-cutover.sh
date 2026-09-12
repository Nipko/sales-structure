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
#    3 barrier     both doors shut: INGRESS down and the database read-only
#    4 drain       wait for in-flight work, refuse if anything is still active
#    5 backup      the return point, in the one format everything here reads
#    6 preflight   the agreed-terms gate, on the OLD schema
#    7 migrate     public schema, then every tenant schema
#    8 images      recreate the containers, pinned by DIGEST, BEHIND the closed door
#    9 health      the API answers, and the containers ARE the approved bytes
#   10 canary      the pilot tenants, verified by a person, ingress still closed
#   11 reopen      the ingress opens — and only here
#
# ── THE TWO DOORS, AND WHICH STEP EACH ONE OUTLIVES ───────────────────────────
#
# The barrier has two layers and they do NOT have the same lifetime. Saying they
# did is what made this file's own comments false:
#
#   · the WRITE barrier (`default_transaction_read_only` on the database) is off
#     for exactly two steps that cannot work without writes — 7, where the
#     migration runs, and 8 onward, where the containers boot (`widget.service`
#     issues `CREATE TABLE IF NOT EXISTS` from `onModuleInit`, so a stack booted
#     against a read-only database is a stack that logs a failure on every
#     start). Step 7 re-arms it the moment the migration ends, pass or fail, so
#     the only gap is the one a named step opened on purpose;
#   · the INGRESS barrier — `parallext-tunnel`, through which every public
#     request arrives, since every published port binds 127.0.0.1 and reaches
#     no further than this host — stays down from step 3 until step 11. That is
#     the layer that means "no tenant is being served", and it is the one that
#     has to outlive the canary.
#
# Before this was true, step 7 turned writes on and nothing turned them back,
# step 8 ran `up -d --force-recreate` with NO service list so the entire public
# surface came back with it, and step 10 — a step whose whole content is "a
# person looks at the pilot tenants" — marked itself done and let the loop walk
# straight into step 11. The window was fully live for every tenant from step 8,
# while step 11 called itself "writes come back last" and executed two no-ops.
#
# Every step records completion in a state directory, so re-running resumes at
# the first step that is not done. Nothing runs out of order: step N refuses
# unless 1…N-1 are recorded, which is what makes "no `compose up` before the
# restore is proven and the window is open" a property of the program instead of
# a sentence in a document. And the record is READ, not merely written: a resumed
# window whose host census or candidate commit has changed underneath it stops.
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
#   october-cutover.sh --only canary --evidence /abs/dir --manifest /abs/m.json \
#       --pilot-tenants <uuid>,<uuid> --canary-verified "quién miró qué, y qué vio"
#   october-cutover.sh ... --accept-changed-start "por qué el censo cambió y es seguro"
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
CANARY_VERIFIED=""
ACCEPT_CHANGED_START=""

log()   { printf '[cutover] %s\n' "$*"; }
fatal() { printf '[cutover] FATAL: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest)       MANIFEST="$2"; shift 2 ;;
    --evidence)       EVIDENCE="$2"; shift 2 ;;
    --only)           ONLY="$2"; shift 2 ;;
    --rehearsal-url)  REHEARSAL_URL="$2"; shift 2 ;;
    --pilot-tenants)  PILOT_TENANTS="$2"; shift 2 ;;
    # The canary is a person looking at the pilot tenants. This is where they say
    # so — and an empty note is the flag being absent, not a verification.
    --canary-verified)
      CANARY_VERIFIED="${2:-}"; shift 2
      [ -n "${CANARY_VERIFIED}" ] || fatal "--canary-verified needs a note saying who checked what; an empty attestation is not one"
      ;;
    # The documented override for a resumed window whose starting state moved.
    --accept-changed-start)
      ACCEPT_CHANGED_START="${2:-}"; shift 2
      [ -n "${ACCEPT_CHANGED_START}" ] || fatal "--accept-changed-start needs a reason; overriding a control without saying why is how the control stops existing"
      ;;
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

# ═══ THE RECORD IS READ, NOT MERELY WRITTEN ═══════════════════════════════════
#
# `mark_done` has always stamped every state file with the inventory hash and the
# candidate commit, under the comment "so a resumed window cannot silently
# continue against a different starting state". Nothing ever compared them:
# `grep inventorySha256` found the printf that writes it, the `--status` line
# that displays it, and nothing else. Both fields were decoration, and the
# sentence above them was false — a window resumed a day later, against a host
# whose census had changed or against a DIFFERENT candidate, walked straight past
# the record that said so. Hard-coding either value to 0 would have changed
# nothing, which is the test for whether a value is being read.
recorded_field() {
  [ -f "$(state_file "$1")" ] || return 0
  sed -n "s/^$2=//p" "$(state_file "$1")" | tr -d '\r' | tail -1
}

# ── WHAT THIS CAN SEE, AND WHAT IT CANNOT ─────────────────────────────
#
# It compares the inventory hash and candidate commit RECORDED by a completed
# step against the ones this run has. That catches a resumed window pointed at
# another window's evidence directory, an evidence directory whose census was
# re-taken under it, and a resume carrying a different candidate commit.
#
# It does NOT re-take the census. A host that changed while nobody re-ran step 1
# hashes the same file and passes here — so this is a check on the RECORD, not
# on the world, and the step that reads the world is step 1. Saying so is the
# point: the field it replaced was written and never read, and a check that
# overstates its reach is the same failure with better manners.
require_same_starting_state() {
  local step="$1" recorded_inventory recorded_sha current_inventory problems=""
  recorded_inventory="$(recorded_field "${step}" inventorySha256)"
  recorded_sha="$(recorded_field "${step}" gitSha)"
  current_inventory="$(inventory_hash)"

  if [ -n "${recorded_inventory}" ] && [ "${recorded_inventory}" != "${current_inventory}" ]; then
    problems="${problems}
  · '${step}' ran against inventory ${recorded_inventory}; the evidence directory now reads ${current_inventory}"
  fi
  # `unset` is what a run given no --manifest records. Only two CONCRETE commits
  # that disagree mean a different candidate; a missing one is a missing
  # manifest, which every step that needs one already refuses on its own.
  if printf '%s' "${recorded_sha}" | grep -Eq '^[0-9a-f]{40}$' \
     && printf '%s' "${GIT_SHA:-}" | grep -Eq '^[0-9a-f]{40}$' \
     && [ "${recorded_sha}" != "${GIT_SHA}" ]; then
    problems="${problems}
  · '${step}' ran against candidate ${recorded_sha}; this run carries ${GIT_SHA}"
  fi

  [ -n "${problems}" ] || return 0

  if [ -n "${ACCEPT_CHANGED_START}" ]; then
    log "continuing against a CHANGED starting state, on the record:${problems}"
    printf '%s  accepted: %s%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${ACCEPT_CHANGED_START}" "${problems}" \
      >> "${EVIDENCE}/changed-start-accepted.txt"
    return 0
  fi
  fatal "this window did not start where it is being resumed:${problems}
  Half a cut-over applied to a host nobody re-inspected, or to a candidate nobody
  approved, is the failure these two fields were written down to prevent. Run the
  inventory again into a NEW evidence directory, or — if the change is understood
  and intended — repeat the command with --accept-changed-start '<why it is safe>'."
}

# ── Ordering is a property of the program, not a paragraph ────────────────────
require_prior_steps() {
  local target="$1" step
  for step in "${STEPS[@]}"; do
    [ "$step" = "$target" ] && return 0
    if ! is_done "$step"; then
      fatal "'${target}' cannot run: '${step}' has not completed. The order is not advisory — it is what keeps the return point older than the change."
    fi
    # Done is not enough: done AGAINST WHAT.
    require_same_starting_state "$step"
  done
  fatal "unknown step '${target}'"
}

status() {
  printf 'cut-over state in %s\n' "${EVIDENCE}"
  local step current_inventory recorded_inventory drift
  current_inventory="$(inventory_hash)"
  for step in "${STEPS[@]}"; do
    if is_done "$step"; then
      recorded_inventory="$(recorded_field "$step" inventorySha256)"
      drift=""
      [ -n "${recorded_inventory}" ] && [ "${recorded_inventory}" != "${current_inventory}" ] \
        && drift="  <-- ran against inventory ${recorded_inventory}"
      printf '  [done]    %-10s %s%s\n' "$step" \
        "$(sed -n 's/^completedAt=//p' "$(state_file "$step")" | tr -d '\r')" "${drift}"
    else
      printf '  [pending] %s\n' "$step"
    fi
  done
  printf 'inventory sha256: %s\n' "${current_inventory}"
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
#
# `parallext-tunnel` goes first and by name. It is not one writer among five:
# every `ports:` entry in `docker-compose.prod.yml` binds to `127.0.0.1` —
# postgres, dozzle, uptime-kuma, grafana and loki are published to the HOST and
# to nothing else — so no request from outside reaches this stack except through
# the Cloudflare tunnel. (An earlier version of this comment said no service
# published a port at all, which is simply false; the conclusion survives the
# correction, and a justification nobody can check is how a wrong one lives.)
# Stopping the five app containers while leaving the tunnel up closes nothing the
# moment step 8 brings them back — which is exactly what used to happen.
#
# The loopback ports are not a hole in the WRITE barrier either: it is set on the
# DATABASE, so a psql session opened on the host through 127.0.0.1:5432 is
# refused the same as a container's.
step_barrier() {
  require_prior_steps barrier
  log "barrier: closing the ingress (parallext-tunnel: the only way in)"
  "${DC[@]}" stop tunnel \
    || fatal "could not stop the tunnel; the ingress is still open and nothing below may run"

  log "barrier: stopping every writer"
  "${DC[@]}" stop worker api whatsapp dashboard landing \
    || fatal "could not stop the writers; the barrier is not down"

  log "barrier: making the database refuse writes"
  set_write_barrier on
  # New sessions inherit the setting; existing ones do not, so they have to go.
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()" > /dev/null \
    || fatal "could not terminate the sessions that were already open"
  mark_done barrier
}

# ── The write barrier, set and then READ BACK ─────────────────────────────────
#
# `ALTER DATABASE … SET` returning 0 says a statement was accepted, not that the
# next session will refuse to write. Every session `psql_admin` opens is a NEW
# one, so `SHOW` in it reports what the database now hands out — which is the
# thing the barrier is a claim about. `RESET` is spelled out as its own case
# because it is not "set to off": it removes the per-database override and lets
# the server default decide, and the two are only the same when the server
# default is off, which this then proves rather than assumes.
set_write_barrier() {
  local want="$1" statement observed
  case "${want}" in
    on)    statement="SET default_transaction_read_only = on" ;;
    off)   statement="SET default_transaction_read_only = off" ;;
    reset) statement="RESET default_transaction_read_only"; want=off ;;
    *) fatal "set_write_barrier: unknown state '$1'" ;;
  esac
  psql_admin -c "ALTER DATABASE \"${DB_NAME}\" ${statement}" > /dev/null \
    || fatal "could not ${statement} on ${DB_NAME}"
  observed="$(psql_admin -Atc "SHOW default_transaction_read_only" < /dev/null | tr -d '[:space:]')" \
    || fatal "could not read the write barrier back off ${DB_NAME}; its state is unknown, which is not a state to continue from"
  [ "${observed}" = "${want}" ] \
    || fatal "the write barrier did not take: asked for '${want}', a new session reports '${observed}'"
  log "write barrier: new sessions are read_only=${observed}"
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
#
# Writes are allowed here and NOWHERE ELSE in this step's lifetime: the flag goes
# off at the top and back on at the bottom, on the success path and on every
# failure path. It used to go off here and never come back, so "the read-only
# flag, for the migration only" described the first line of the step and nothing
# after it — the database stayed writable for the rest of the window, including
# the stretch where a person was eyeballing the canary.
step_migrate() {
  require_prior_steps migrate
  # The ingress is still stopped, so with the flag off the only thing on this
  # host that can write is the migration itself.
  log "migrate: lifting the write barrier FOR THE MIGRATION, and re-arming it after"
  set_write_barrier off

  local rc=0 out summary skipped warnings

  log "migrate: public schema"
  "${DC_PINNED[@]}" run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma || rc=$?
  if [ "${rc}" -ne 0 ]; then
    set_write_barrier on
    fatal "prisma migrate deploy FAILED. The containers were not recreated, the write barrier is back on; restore the return point if the schema is half applied."
  fi

  log "migrate: tenant schemas"
  out="$("${DC_PINNED[@]}" run --rm api npm run migrate:tenants 2>&1)" || rc=$?
  printf '%s\n' "${out}" | tr -d '\r' | tee "${EVIDENCE}/migrate-tenants.log"
  summary="$(printf '%s\n' "${out}" | tr -d '\r' | grep -o 'MIGRATE_TENANTS_SUMMARY .*' | tail -1 || true)"
  skipped="$(printf '%s\n' "${summary}" | sed -n 's/.*skipped=\([0-9]*\).*/\1/p')"
  warnings="$(printf '%s\n' "${summary}" | sed -n 's/.*warnings=\([0-9]*\).*/\1/p')"

  # Re-armed BEFORE any of the three refusals below, so that a migration that
  # ends badly ends with the database refusing writes rather than open.
  set_write_barrier on

  [ "${rc}" -eq 0 ] || fatal "the tenant migration exited ${rc}"
  [ -n "${summary}" ] || fatal "the tenant migration emitted no verifiable summary"
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
#
# ── THE SERVICES ARE NAMED, AND `tunnel` IS NOT AMONG THEM ────────────────────
#
# `up -d --force-recreate` with no service list did two things nobody asked for:
# it brought the INGRESS back — so the window was serving every tenant from here
# on, three steps before the step called "reopen" — and it put `postgres`,
# `pgbouncer` and `redis` in scope of `--force-recreate`, which means the window
# would have recreated the database container it is in the middle of migrating.
#
# `--no-deps` keeps the blast radius to exactly the five named services.
# Dependencies are already running: the barrier only stopped these five and the
# tunnel, and everything below them has been up since before the window opened.
step_images() {
  require_prior_steps images
  [ -n "${GIT_SHA}" ] || fatal "--manifest is required to recreate containers: a tag is mutable and a digest is not"
  # A stack cannot boot against a read-only database — `widget.service`
  # `onModuleInit` runs `CREATE TABLE IF NOT EXISTS` — so the write barrier comes
  # off here, deliberately and by name. The INGRESS barrier does not: nothing
  # outside this host can reach what is about to start.
  log "images: lifting the write barrier so the containers can boot (the ingress stays CLOSED)"
  set_write_barrier off
  log "images: recreating the stack pinned to ${GIT_SHA}, behind the closed ingress"
  # Symmetry with step 7, and for the same reason: the header promises that
  # "the only gap is the one a named step opened on purpose". A stack that
  # failed to come up leaves this step's gap open behind it, so the barrier is
  # re-armed before the refusal — the window ends with the database refusing
  # writes whichever way this goes.
  if ! "${DC_PINNED[@]}" up -d --no-deps --force-recreate worker api whatsapp dashboard landing; then
      set_write_barrier on || true
      fatal "the stack did not come up; the write barrier was re-armed"
  fi
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
# 10. CANARY — the tenants named in step 1, by id, and a person who says so
# ═══════════════════════════════════════════════════════════════════════════════
#
# ── WHAT THIS STEP USED TO BE ─────────────────────────────────────────────────
#
# It logged "verify … then re-run with --only reopen" and called `mark_done`
# immediately. `mark_done` is what the resume loop reads, so the loop did not
# stop: it went on to step 11 in the same breath and opened the window. The
# sentence asked for a person and the program did not wait for one.
#
# And the refusal above it claimed a semantic nothing implements — "an empty list
# is read as EVERY tenant" — when `PILOT_TENANTS` was only ever written to a file
# and read by nobody. A restriction described but not enforced is worse than an
# absent one: it is believed.
#
# Now the list is load-bearing (each id must be a UUID that names a real tenant,
# AND must match the pilot the platform is actually configured for) and the step
# is a gate: it stops with the public ingress STILL CLOSED, and is recorded only
# when a person comes back and says what they checked.
#
# WHAT THIS STEP DOES NOT DO, because it said otherwise and was believed: it
# does not OPEN anything. The pilot is opened by the `dispatch.normalOutbox` row
# in `platform_settings`, written through `DispatchRolloutService`, and this
# script never wrote it. `--pilot-tenants` was validated, echoed into a file and
# read by nothing else.
#
# Nor is the canary INTERVAL scoped to those tenants. Step 8 brings worker, api,
# whatsapp, dashboard and landing back up with no queue pause anywhere in this
# script, so from step 8 until step 11 outbound processing is live for EVERY
# tenant. What the pilot list scopes is the durable dispatch lane, not the
# platform. The operator attesting "6 entregas, 0 duplicados" is reading a
# platform-wide outbound surface, and on a programme whose whole subject is
# per-message money that difference is the attestation.
#
# So the list is now CROSS-CHECKED against the row that really decides, and a
# disagreement is a refusal. That is the one cheap thing that makes the sentence
# true rather than merely careful.
step_canary() {
  require_prior_steps canary
  [ -n "${PILOT_TENANTS}" ] \
    || fatal "--pilot-tenants is required: a pilot whose scope is not written down is one nobody can say afterwards was a pilot at all"

  # Each id is checked for shape and then for existence. A typo'd tenant id
  # produced a canary that verified nothing and a file that said it had.
  local id missing="" present
  for id in $(printf '%s' "${PILOT_TENANTS}" | tr ',' ' '); do
    printf '%s' "${id}" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
      || fatal "'${id}' is not a tenant id. The pilot is named by id, not by slug or by hand-wave."
    present="$(psql_admin -Atc "SELECT count(*) FROM public.tenants WHERE id = '${id}'::uuid" < /dev/null | tr -d '[:space:]')" \
      || fatal "could not look up tenant ${id}"
    [ "${present}" = "1" ] || missing="${missing} ${id}"
  done
  [ -z "${missing}" ] || fatal "these pilot ids name no tenant:${missing}"

  # ── AND THE LIST HAS TO BE THE ONE THE PLATFORM IS ACTUALLY USING ─────────
  #
  # `dispatch.normalOutbox` is what opens the durable lane. An empty tenant list
  # in that row means EVERY tenant — `DispatchPilotScope` says so in as many
  # words — so a "pilot" whose row names nobody is the full rollout, silently.
  # Reading the row here is what stops this step from attesting to a scope that
  # exists only in an argument.
  local rollout enabled row_tenants id_missing=""
  rollout="$(psql_admin -Atc \
    "SELECT value FROM public.platform_settings WHERE key = 'dispatch.normalOutbox'" \
    < /dev/null | tr -d '\r')" \
    || fatal "could not read dispatch.normalOutbox; the pilot scope cannot be confirmed"

  if [ -z "${rollout}" ]; then
    fatal "dispatch.normalOutbox is not set, so no pilot is open. This step attests to a scope that does not exist."
  fi
  enabled="$(printf '%s' "${rollout}" | grep -o '"enabled"[[:space:]]*:[[:space:]]*true' || true)"
  [ -n "${enabled}" ] \
    || fatal "dispatch.normalOutbox is present but not enabled. Nothing is open for anyone, pilot or otherwise."

  row_tenants="$(printf '%s' "${rollout}" \
    | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}' | sort -u || true)"
  if [ -z "${row_tenants}" ]; then
    fatal "dispatch.normalOutbox names NO tenants, which that row reads as EVERY tenant. That is the full rollout, not a pilot."
  fi
  for id in $(printf '%s' "${PILOT_TENANTS}" | tr ',' ' '); do
    printf '%s\n' "${row_tenants}" | grep -qxF "${id}" || id_missing="${id_missing} ${id}"
  done
  [ -z "${id_missing}" ] \
    || fatal "these ids are not in dispatch.normalOutbox, so the lane is not open for them:${id_missing}"

  printf '%s\n' "${PILOT_TENANTS}" > "${EVIDENCE}/canary-tenants.txt"
  printf '%s\n' "${row_tenants}" > "${EVIDENCE}/canary-rollout-scope.txt"

  # Deliberately not automated further. Delivery, duplicates, retained exposure
  # and funding errors are read by a person against the runbook's checklist; a
  # script that declared them fine would be the most expensive kind of green.
  if [ -z "${CANARY_VERIFIED}" ]; then
    log "canary: the DURABLE LANE is open for ${PILOT_TENANTS} (confirmed against dispatch.normalOutbox) and the public ingress is STILL CLOSED"
    log "canary: NOTE — outbound processing itself is live for every tenant from step 8; the pilot list scopes the durable lane, not the platform"
    log "canary: verify delivery, duplicates, retainedExposure and funding errors against the runbook"
    log "canary: then record it, and only then does step 11 become reachable:"
    log "canary:   $0 --only canary --evidence ${EVIDENCE} --manifest ${MANIFEST:-<manifest>} \\"
    log "canary:     --pilot-tenants ${PILOT_TENANTS} --canary-verified '<who looked, at what, and what they saw>'"
    fatal "the canary is not recorded until a person says they checked it. Nothing below this line runs and the ingress stays shut."
  fi

  printf 'verifiedAt=%s\ntenants=%s\nnote=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PILOT_TENANTS}" "${CANARY_VERIFIED}" \
    > "${EVIDENCE}/canary-verified.txt"
  log "canary: recorded — ${CANARY_VERIFIED}"
  mark_done canary
}

# ═══════════════════════════════════════════════════════════════════════════════
# 11. REOPEN — the ingress comes back, and it comes back LAST
# ═══════════════════════════════════════════════════════════════════════════════
#
# This step used to be two no-ops wearing the title of the most consequential
# moment in the window: it `RESET` a flag step 7 had already turned off and
# brought up services step 8 had already started. Nothing about the system
# changed when it ran, which is why nobody noticed that everything it claimed to
# do had happened three steps earlier.
#
# What actually changes here is the ingress: `parallext-tunnel` starts, and the
# first request from a real customer can arrive. It goes last, after the services
# behind it are confirmed up, because a tunnel pointing at a container that is
# not there is a 502 for every tenant at once.
step_reopen() {
  require_prior_steps reopen
  # Idempotent, and meaningful precisely when it is not: the flag is off from
  # step 8, but a window that reached here by another route (a step retried by
  # hand, an aborted run resumed) may still have it on. RESET removes the
  # per-database override rather than writing `off` over it, and `set_write_barrier`
  # reads back what a NEW session is actually given.
  log "reopen: making sure the database accepts writes"
  set_write_barrier reset

  log "reopen: the services behind the door"
  "${DC_PINNED[@]}" up -d --no-deps worker api whatsapp dashboard landing \
    || fatal "the writers did not come back up; the ingress stays closed"

  log "reopen: OPENING THE INGRESS — parallext-tunnel"
  "${DC[@]}" up -d --no-deps tunnel \
    || fatal "the tunnel did not come back up: the stack is healthy but unreachable. Fix the tunnel; do NOT leave the window in this state."
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
