#!/bin/bash
# ============================================
# Parallext Engine — Delete a tenant completely
# Usage:
#   infra/scripts/delete-tenant.sh <tenant-uuid> [--api-token <jwt>]
#
# Modes:
#   PREFERRED — calls DELETE /offboarding/:id/purge on the running API
#   (super_admin token). The endpoint detaches providers (Meta WABA,
#   Telegram webhook, Twilio webhooks), drops the schema, wipes
#   /data/media/{tenantId}, revokes refresh tokens, and clears Redis.
#   Set the token via --api-token or PARALLLY_SUPER_ADMIN_TOKEN env var.
#
#   FALLBACK — if no token is provided OR the API is unreachable, the
#   script runs delete-tenant.sql directly against Postgres + Redis +
#   filesystem (defense-in-depth, but skips provider unsubscribe so
#   Meta might keep firing webhooks until manually cleaned up there).
# ============================================
set -e

TID=""
API_TOKEN="${PARALLLY_SUPER_ADMIN_TOKEN:-}"
while [ $# -gt 0 ]; do
    case "$1" in
        --api-token) API_TOKEN="$2"; shift 2 ;;
        --help|-h)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *)
            if [ -z "$TID" ]; then TID="$1"; fi
            shift ;;
    esac
done

if [ -z "$TID" ]; then
    echo "Usage: $0 <tenant-uuid> [--api-token <jwt>]"
    echo "Example: $0 0994a0ac-037b-4c41-bdb1-e8bb7fb2a756"
    exit 1
fi

DB_CONTAINER="${DB_CONTAINER:-parallext-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"
API_CONTAINER="${API_CONTAINER:-parallext-api}"
DB_USER="${DB_USER:-parallext}"
DB_NAME="${DB_NAME:-parallext_engine}"
API_BASE="${API_BASE:-https://api.parallly-chat.cloud/api/v1}"
MEDIA_PATH="${MEDIA_PATH:-/data/media}"
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
echo "  • Archivos en ${MEDIA_PATH}/${TID}/ (logos, fotos, adjuntos)"
if [ -n "$API_TOKEN" ]; then
    echo "  • Desuscripción de Meta / Telegram / Twilio (via API endpoint)"
fi
echo ""
read -p "¿Continuar? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelado."
    exit 0
fi

# ─── PREFERRED PATH: API endpoint ─────────────────────────────────
# If a super_admin token was provided, hit the API. The endpoint runs
# the full purge in the right order (providers, queues, public rows,
# DROP SCHEMA, media files, Redis). Falls back to SQL if it fails.
if [ -n "$API_TOKEN" ]; then
    echo ""
    echo "→ Intentando vía API endpoint (recomendado)..."
    API_RESPONSE=$(curl -sS -w "\n%{http_code}" -X DELETE \
        "${API_BASE}/offboarding/${TID}/purge" \
        -H "Authorization: Bearer ${API_TOKEN}" 2>&1 || echo "ERROR")
    HTTP_CODE=$(echo "$API_RESPONSE" | tail -n1)
    BODY=$(echo "$API_RESPONSE" | head -n -1)

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo ""
        echo "✓ Purge completado vía API:"
        echo "$BODY" | head -c 2000
        echo ""
        echo "═══════════════════════════════════════════════════"
        echo "  Tenant ${TID} eliminado por completo"
        echo "═══════════════════════════════════════════════════"
        exit 0
    fi
    echo "✗ API respondió HTTP ${HTTP_CODE}. Cayendo a SQL raw como fallback..."
    echo "  Response: ${BODY:0:300}"
    echo ""
fi

# ─── FALLBACK PATH: direct SQL + Redis + filesystem ───────────────

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
echo "→ Borrando archivos del tenant (logos, fotos, adjuntos)..."
# The api container has the media volume mounted at MEDIA_PATH.
# Use it to remove the tenant directory recursively. -force keeps going
# even if there's nothing to delete.
TENANT_DIR_SAFE=$(echo "$TID" | tr -dc 'a-zA-Z0-9_-')
if [ "$TENANT_DIR_SAFE" = "$TID" ]; then
    REMOVED=$(docker exec "${API_CONTAINER}" sh -c "
        if [ -d '${MEDIA_PATH}/${TID}' ]; then
            COUNT=\$(find '${MEDIA_PATH}/${TID}' -type f 2>/dev/null | wc -l)
            rm -rf '${MEDIA_PATH}/${TID}'
            echo \"\$COUNT\"
        else
            echo '0'
        fi
    " 2>/dev/null || echo "0")
    echo "   ${REMOVED} archivo(s) borrado(s) de ${MEDIA_PATH}/${TID}/"
else
    echo "   ✗ tenantId con caracteres no permitidos — saltando wipe de archivos"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Tenant ${TID} eliminado por completo"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Verificación rápida:"
docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
    "SELECT id, name, schema_name FROM tenants WHERE id = '${TID}';"
echo "(expected: 0 rows)"
