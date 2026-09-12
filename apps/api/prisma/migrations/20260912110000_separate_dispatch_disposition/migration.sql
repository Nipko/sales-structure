-- La identidad idempotente de un efecto y su tratamiento economico son dos
-- hechos distintos. Una confirmacion de pago, por ejemplo, se identifica por
-- la operacion de pago pero responde a un mensaje del cliente. Si ambos hechos
-- comparten `inbound_message_id`, colisiona con la respuesta previa del agente;
-- si se marca proactiva para evitar la colision, un soft stop de campanas puede
-- retener la confirmacion de un pago ya acreditado.
--
-- Las columnas quedan NULLables a proposito. Un binario anterior puede seguir
-- escribiendo durante el despliegue sin conocerlas; el lector nuevo deriva el
-- valor legado de `origin_kind`. El binario nuevo siempre las escribe.

DO $dispatch_disposition$
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
                ADD COLUMN IF NOT EXISTS reply_to_message_id UUID,
                ADD COLUMN IF NOT EXISTS disposition TEXT
        $ddl$, target);

        -- Existing rows are made explicit. Rows written later by an older
        -- binary may still be NULL and are read through the same fallback.
        EXECUTE format($ddl$
            UPDATE %s."agent_dispatch_outbox"
               SET disposition = CASE WHEN origin_kind = 'proactive'
                                      THEN 'proactive' ELSE 'reactive' END,
                   reply_to_message_id = CASE WHEN origin_kind = 'inbound_reply'
                                              THEN inbound_message_id ELSE NULL END
             WHERE disposition IS NULL OR
                   (reply_to_message_id IS NULL AND origin_kind = 'inbound_reply')
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                DROP CONSTRAINT IF EXISTS agent_dispatch_outbox_disposition
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                ADD CONSTRAINT agent_dispatch_outbox_disposition
                CHECK (disposition IS NULL OR disposition IN ('reactive','proactive')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                VALIDATE CONSTRAINT agent_dispatch_outbox_disposition
        $ddl$, target);
    END LOOP;
END
$dispatch_disposition$;
