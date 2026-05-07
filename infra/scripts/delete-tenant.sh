#!/bin/bash
# ============================================
# Parallext Engine — Delete a tenant completely
# Usage:
#   infra/scripts/delete-tenant.sh <tenant-uuid>
#
# What it does:
#   1. Runs delete-tenant.sql with the UUID injected
#   2. Flushes Redis cache for that tenant
#   3. Logs row counts per public-schema table
# ============================================
set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <tenant-uuid>"
    echo "Example: $0 0994a0ac-037b-4c41-bdb1-e8bb7fb2a756"
    exit 1
fi

TID="$1"
DB_CONTAINER="${DB_CONTAINER:-parallext-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"
DB_USER="${DB_USER:-parallext}"
DB_NAME="${DB_NAME:-parallext_engine}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════════════════"
echo "  Eliminar tenant: $TID"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Esto eliminará:"
echo "  • Filas de billing_*, audit_logs, channel_accounts, users, etc."
echo "  • El schema completo del tenant (con TODAS sus tablas)"
echo "  • La fila en la tabla tenants"
echo "  • El cache de Redis del tenant"
echo ""
read -p "¿Continuar? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelado."
    exit 0
fi

echo ""
echo "→ Capturando user_ids del tenant (para limpiar sus refresh tokens en Redis)..."
USER_IDS=$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c \
    "SELECT id FROM users WHERE tenant_id = '${TID}'" 2>/dev/null | tr -d ' ' || true)
USER_COUNT=$(echo "$USER_IDS" | grep -c . || true)
echo "   ${USER_COUNT} usuario(s) asociados al tenant."

echo ""
echo "→ Ejecutando script SQL..."
# Replace the placeholder UUID at runtime by piping a SET command first.
# Easiest: sed-substitute and stream into psql.
sed "s|0994a0ac-037b-4c41-bdb1-e8bb7fb2a756|${TID}|g" "${SCRIPT_DIR}/delete-tenant.sql" | \
    docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1

echo ""
echo "→ Limpiando Redis cache del tenant..."
# Delete tenant:<id>:* and vertical:<id> keys.
docker exec "${REDIS_CONTAINER}" redis-cli --scan --pattern "tenant:${TID}:*" 2>/dev/null | \
    while read -r k; do
        [ -n "$k" ] && docker exec "${REDIS_CONTAINER}" redis-cli DEL "$k" > /dev/null
    done
docker exec "${REDIS_CONTAINER}" redis-cli DEL "vertical:${TID}" > /dev/null 2>&1 || true
docker exec "${REDIS_CONTAINER}" redis-cli DEL "tenant_plan:${TID}" > /dev/null 2>&1 || true

# Refresh tokens: refresh:<userId>:<tokenId>. Delete every active session
# for the users that belonged to this tenant.
if [ -n "$USER_IDS" ]; then
    REVOKED=0
    while IFS= read -r uid; do
        [ -z "$uid" ] && continue
        # SCAN finds all token entries for this user across all sessions
        docker exec "${REDIS_CONTAINER}" redis-cli --scan --pattern "refresh:${uid}:*" 2>/dev/null | \
            while read -r k; do
                [ -n "$k" ] && docker exec "${REDIS_CONTAINER}" redis-cli DEL "$k" > /dev/null
            done
    done <<< "$USER_IDS"
    echo "   Refresh tokens de ${USER_COUNT} usuario(s) revocados."
fi
echo "   Cache limpiado."

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Tenant ${TID} eliminado por completo"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Verificación rápida:"
docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
    "SELECT id, name, schema_name FROM tenants WHERE id = '${TID}';"
echo "(expected: 0 rows)"
