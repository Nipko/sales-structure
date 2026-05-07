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
