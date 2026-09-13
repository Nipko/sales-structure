-- El carril durable sólo sabía contestar; no sabía iniciar.
--
-- `agent_dispatch_outbox` existe para que UNA aceptación del proveedor sea
-- exactamente UN efecto que el cliente recibió: fila comprometida antes del
-- POST, lease, dueño único del intento, recibo atado al mensaje. Todo eso
-- estaba modelado alrededor de responder a un mensaje entrante —
-- `inbound_message_id NOT NULL`, `UNIQUE (inbound_message_id, item_index)` — y
-- un recordatorio, un goteo o una campaña no responden a nada.
--
-- Por eso veinticinco productores quedaron fuera: no les faltaba disciplina,
-- les faltaba una fila que pudieran escribir. Salían por BullMQ (Redis es el
-- único registro) o directo al adaptador (ningún registro), así que un reinicio
-- entre la decisión y el POST pierde el efecto o lo repite.
--
-- ── LO QUE CAMBIA, QUE ES UNA PALABRA ───────────────────────────────────────
--
-- `inbound_message_id` deja de significar "el mensaje entrante" y pasa a
-- significar EL ORIGEN: la cosa durable que causó este lote. Para una respuesta
-- sigue siendo el mensaje entrante, literalmente la misma fila. Para un efecto
-- proactivo es un UUID DERIVADO de la identidad durable del productor — el id
-- del recordatorio, el paso del goteo, el destinatario de la campaña — así que
-- dos intentos del mismo efecto producen el mismo origen y la unicidad
-- existente hace exactamente lo correcto sin una línea nueva de lógica.
--
-- `origin_kind` dice cuál de los dos es. Sin esa columna, un lector no puede
-- saber si `inbound_message_id` apunta a `messages` o a un derivado, y una
-- comprobación de integridad futura elegiría mal.
--
-- El nombre de la columna es ahora impreciso. Renombrarla es un DROP y un ADD
-- en dos deploys distintos (expand-contract), y no es lo que hace falta para
-- que veinticinco productores dejen de perder mensajes. Queda anotado acá.
--
-- ADITIVA: una columna con DEFAULT y un CHECK NOT VALID + VALIDATE. El binario
-- anterior no la conoce, sus INSERT siguen siendo válidos y sus filas quedan
-- correctamente marcadas como respuestas.

DO $dispatch_origin$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        CONTINUE WHEN to_regclass(target || '.agent_dispatch_outbox') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                ADD COLUMN IF NOT EXISTS origin_kind TEXT NOT NULL DEFAULT 'inbound_reply'
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                DROP CONSTRAINT IF EXISTS agent_dispatch_outbox_origin
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                ADD CONSTRAINT agent_dispatch_outbox_origin
                CHECK (origin_kind IN ('inbound_reply','proactive')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                VALIDATE CONSTRAINT agent_dispatch_outbox_origin
        $ddl$, target);

        -- Un efecto proactivo no tiene conversación del cliente ni mensaje
        -- entrante que mirar, así que el barrido que los busca necesita su
        -- propio índice. Parcial: son pocas filas frente al total.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_proactive
                ON %s."agent_dispatch_outbox" (state, available_at)
                WHERE origin_kind = 'proactive'
        $ddl$, target);
    END LOOP;
END
$dispatch_origin$;
