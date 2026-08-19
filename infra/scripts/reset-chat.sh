#!/bin/bash
# ============================================
# Parallext Engine — Dejar un chat en CERO para poder probar
#
# Usage:
#   infra/scripts/reset-chat.sh <tenant-uuid> --phone 573208010737 [--keep-bookings] [--yes]
#   infra/scripts/reset-chat.sh <tenant-uuid> --contact <contact-uuid> [...]
#   infra/scripts/reset-chat.sh <tenant-uuid> --conversation <conversation-uuid> [...]
#
# POR QUÉ EXISTE
#   Borrar la conversación desde la bandeja NO deja el chat en cero: elimina
#   mensajes, notas y la fila de la conversación, y deja vivo todo lo demás.
#   Lo que sobrevive es justo lo que contamina una prueba:
#
#     · booking:{conv} / procedure:{conv}  → el motor retoma un flujo a medias
#     · tool_execution_ledger              → una confirmación pendiente vieja
#                                            puede ejecutarse con tu próximo "sí"
#     · llm:affinity:{conv}:{task}         → el turno sale con el modelo pegado
#     · handoff:{tenant}:{conv}            → el agente sigue mudo
#     · buf:conv:{tenant}:{canal}:{contacto} → una ráfaga a medio juntar
#     · turn:done / turn:reply por pmid    → un reintento reusa la respuesta vieja
#     · memoria del cliente, lead, oportunidad
#
#   Y desde ago-2026 hay una razón más: una conversación NUEVA hereda la cola de
#   la anterior del mismo contacto (`carriedContext`, últimos mensajes, 30 días).
#   Eso es deseable en producción y veneno para una prueba: por eso este script
#   borra TODAS las conversaciones del contacto, no sólo la última.
#
# QUÉ NO BORRA
#   El contacto en sí (para conservar su identidad de canal) y, salvo que se
#   pida lo contrario, tampoco las reservas/citas ya creadas: son datos reales
#   del negocio. Con --purge-bookings se cancelan las de prueba.
# ============================================
set -e

TID=""
PHONE=""
CONTACT_ID=""
CONVERSATION_ID=""
PURGE_BOOKINGS="no"
ASSUME_YES="no"

while [ $# -gt 0 ]; do
    case "$1" in
        --phone) PHONE="$2"; shift 2 ;;
        --contact) CONTACT_ID="$2"; shift 2 ;;
        --conversation) CONVERSATION_ID="$2"; shift 2 ;;
        --purge-bookings) PURGE_BOOKINGS="yes"; shift ;;
        --yes|-y) ASSUME_YES="yes"; shift ;;
        --help|-h)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *)
            if [ -z "$TID" ]; then TID="$1"; fi
            shift ;;
    esac
done

if [ -z "$TID" ] || { [ -z "$PHONE" ] && [ -z "$CONTACT_ID" ] && [ -z "$CONVERSATION_ID" ]; }; then
    echo "Usage: $0 <tenant-uuid> (--phone <numero> | --contact <uuid> | --conversation <uuid>) [--purge-bookings] [--yes]"
    echo "Ejemplo: $0 3e8ad32e-a16b-42e6-9634-b8e8cc29292d --phone 573208010737"
    exit 1
fi

DB_CONTAINER="${DB_CONTAINER:-parallext-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-parallext-redis}"
DB_USER="${DB_USER:-parallext}"
DB_NAME="${DB_NAME:-parallext_engine}"

psql_q() {
    docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c "$1"
}
psql_run() {
    docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -q -c "$1"
}
redis_del() {
    [ -n "$1" ] && docker exec "${REDIS_CONTAINER}" redis-cli DEL "$1" > /dev/null 2>&1 || true
}
redis_del_pattern() {
    docker exec "${REDIS_CONTAINER}" redis-cli --scan --pattern "$1" 2>/dev/null | \
        while read -r k; do [ -n "$k" ] && docker exec "${REDIS_CONTAINER}" redis-cli DEL "$k" > /dev/null; done
}

# ─── Resolver el schema del tenant ───────────────────────────────────
SCHEMA=$(psql_q "SELECT schema_name FROM tenants WHERE id = '${TID}'::uuid")
if [ -z "$SCHEMA" ]; then
    echo "✗ Tenant ${TID} no existe."
    exit 1
fi

# ─── Resolver el contacto ────────────────────────────────────────────
# Se acepta teléfono (lo cómodo para probar por WhatsApp), id de contacto o id
# de conversación; todo se normaliza a "un contacto" porque el estado que
# ensucia una prueba está repartido entre sus conversaciones.
if [ -n "$CONVERSATION_ID" ] && [ -z "$CONTACT_ID" ]; then
    CONTACT_ID=$(psql_q "SELECT contact_id FROM \"${SCHEMA}\".conversations WHERE id = '${CONVERSATION_ID}'::uuid")
fi
if [ -z "$CONTACT_ID" ] && [ -n "$PHONE" ]; then
    CONTACT_ID=$(psql_q "SELECT id FROM \"${SCHEMA}\".contacts WHERE external_id = '${PHONE}' OR phone = '${PHONE}' LIMIT 1")
fi
if [ -z "$CONTACT_ID" ]; then
    echo "✗ No se encontró el contacto en ${SCHEMA}."
    exit 1
fi

CONTACT_NAME=$(psql_q "SELECT COALESCE(name, external_id) FROM \"${SCHEMA}\".contacts WHERE id = '${CONTACT_ID}'::uuid")
CONV_IDS=$(psql_q "SELECT id FROM \"${SCHEMA}\".conversations WHERE contact_id = '${CONTACT_ID}'::uuid")
CONV_COUNT=$(echo "$CONV_IDS" | grep -c . || true)
MSG_COUNT=$(psql_q "SELECT COUNT(*) FROM \"${SCHEMA}\".messages m JOIN \"${SCHEMA}\".conversations c ON c.id = m.conversation_id WHERE c.contact_id = '${CONTACT_ID}'::uuid")

echo "═══════════════════════════════════════════════════"
echo "  Reset de chat — ${CONTACT_NAME}"
echo "═══════════════════════════════════════════════════"
echo "  tenant       : ${TID}"
echo "  schema       : ${SCHEMA}"
echo "  contacto     : ${CONTACT_ID}"
echo "  conversaciones: ${CONV_COUNT}   mensajes: ${MSG_COUNT}"
echo ""
echo "Se borrará:"
echo "  • Mensajes, notas internas y TODAS las conversaciones del contacto"
echo "  • Confirmaciones pendientes y ejecuciones (tool_execution_ledger)"
echo "  • Estado en Redis: booking, procedure, handoff, afinidad de modelo,"
echo "    ráfaga a medio juntar, marcadores de turno y respuestas cacheadas"
echo "  • Memoria del cliente, lead y oportunidad"
if [ "$PURGE_BOOKINGS" = "yes" ]; then
    echo "  • ⚠ Reservas y citas del contacto (BORRADO REAL, no cancelación)"
else
    echo ""
    echo "NO se borrará: el contacto, ni sus reservas/citas ya creadas."
    echo "  (usa --purge-bookings si son de prueba y querés eliminarlas)"
fi
echo ""

if [ "$ASSUME_YES" != "yes" ]; then
    read -p "¿Continuar? (yes/no): " CONFIRM
    [ "$CONFIRM" = "yes" ] || { echo "Cancelado."; exit 0; }
fi

# ─── Redis: por conversación ─────────────────────────────────────────
echo "→ Limpiando Redis…"
for CID in $CONV_IDS; do
    [ -z "$CID" ] && continue
    redis_del "booking:${CID}"
    redis_del "procedure:${CID}"
    redis_del "handoff:${TID}:${CID}"
    redis_del "lock:conv:${CID}"
    redis_del "llm:affinity:${CID}"
    redis_del "llm:affinity:${CID}:conversation"
    redis_del "llm:affinity:${CID}:tool_calling"
done

# Marcadores por mensaje de proveedor: `turn:done` evita responder dos veces al
# mismo wamid y `turn:reply` guarda la respuesta ya redactada. Si sobreviven, un
# mensaje repetido en la prueba se contesta con la respuesta anterior.
redis_del_pattern "turn:done:${TID}:*"
redis_del_pattern "turn:reply:${TID}:*"
# Ráfaga a medio juntar (clave por tenant+canal+contacto, sin conversación).
redis_del_pattern "buf:conv:${TID}:*"
# Caches del tenant que hacen que el agente arranque con datos viejos.
redis_del "booking:services:${TID}"
redis_del "vertical:${TID}"
redis_del "bizgoals:${TID}"

# ─── Postgres ────────────────────────────────────────────────────────
echo "→ Limpiando Postgres…"

# El ledger primero: es lo que puede ejecutar una operación vieja con el
# próximo "sí" del cliente.
psql_run "DELETE FROM \"${SCHEMA}\".tool_execution_ledger WHERE contact_id = '${CONTACT_ID}'::uuid" 2>/dev/null || true
psql_run "DELETE FROM \"${SCHEMA}\".internal_notes WHERE conversation_id IN (SELECT id FROM \"${SCHEMA}\".conversations WHERE contact_id = '${CONTACT_ID}'::uuid)" 2>/dev/null || true
psql_run "DELETE FROM \"${SCHEMA}\".messages WHERE conversation_id IN (SELECT id FROM \"${SCHEMA}\".conversations WHERE contact_id = '${CONTACT_ID}'::uuid)"

if [ "$PURGE_BOOKINGS" = "yes" ]; then
    echo "→ Borrando reservas y citas del contacto…"
    for T in property_bookings tour_bookings appointments; do
        psql_run "DELETE FROM \"${SCHEMA}\".${T} WHERE contact_id = '${CONTACT_ID}'::uuid" 2>/dev/null || true
    done
fi

# Oportunidades antes que la conversación: la FK es ON DELETE RESTRICT, así que
# una reserva conservada mantiene viva su oportunidad y el DELETE fallaría.
psql_run "DELETE FROM \"${SCHEMA}\".opportunities WHERE conversation_id IN (SELECT id FROM \"${SCHEMA}\".conversations WHERE contact_id = '${CONTACT_ID}'::uuid) AND NOT EXISTS (SELECT 1 FROM \"${SCHEMA}\".property_bookings b WHERE b.opportunity_id = opportunities.id)" 2>/dev/null || true
psql_run "DELETE FROM \"${SCHEMA}\".conversations WHERE contact_id = '${CONTACT_ID}'::uuid"

# Memoria de largo plazo: sin esto el agente "te conoce" en el primer mensaje de
# la prueba. Son TRES tablas distintas, no una:
#   conversation_memory     → resumen por conversación (contact_id)
#   customer_memories       → facts + summary del contacto (contact_id)
#   customer_memory_facts   → hechos vectorizados, con dueño polimórfico
#                             (owner_kind 'contact' = este contacto, 'profile' =
#                             el perfil unificado cross-canal al que pertenece)
psql_run "DELETE FROM \"${SCHEMA}\".conversation_memory WHERE contact_id = '${CONTACT_ID}'::uuid" 2>/dev/null || true
psql_run "DELETE FROM \"${SCHEMA}\".customer_memories WHERE contact_id = '${CONTACT_ID}'::uuid" 2>/dev/null || true
psql_run "DELETE FROM \"${SCHEMA}\".customer_memory_facts
           WHERE (owner_kind = 'contact' AND owner_id = '${CONTACT_ID}'::uuid)
              OR (owner_kind = 'profile'  AND owner_id IN (
                    SELECT customer_profile_id FROM \"${SCHEMA}\".contact_identities
                     WHERE contact_id = '${CONTACT_ID}'::uuid))" 2>/dev/null || true
psql_run "DELETE FROM \"${SCHEMA}\".leads WHERE contact_id = '${CONTACT_ID}'::uuid AND NOT EXISTS (SELECT 1 FROM \"${SCHEMA}\".opportunities o WHERE o.lead_id = leads.id)" 2>/dev/null || true

REMAINING=$(psql_q "SELECT COUNT(*) FROM \"${SCHEMA}\".conversations WHERE contact_id = '${CONTACT_ID}'::uuid")
echo ""
echo "✓ Listo. Conversaciones restantes del contacto: ${REMAINING}"
echo "  Escribile al número y el agente arranca sin memoria previa."
