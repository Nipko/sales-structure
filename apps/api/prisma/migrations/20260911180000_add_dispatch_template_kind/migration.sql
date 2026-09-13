-- El carril durable no sabía mandar una plantilla.
--
-- `item_kind` admitía `text`, `media`, `payment_link` y `flow`, que son las
-- cuatro formas que toma una RESPUESTA. Un recordatorio de turno, un aviso de
-- asistencia y un paso de goteo fuera de la ventana de 24 horas salen como
-- PLANTILLA APROBADA, que es una llamada distinta de la Graph API con nombre,
-- idioma y componentes.
--
-- Sin ese tipo, esos productores no tenían fila que escribir, así que iban
-- directo al adaptador: ningún registro, ningún lease, ningún recibo. Un
-- reinicio entre decidir y hacer el POST perdía el recordatorio o lo repetía, y
-- desde octubre cada repetición es un cargo.
--
-- ADITIVA: se AMPLÍA un CHECK. Ningún valor deja de ser válido y el binario
-- anterior sigue escribiendo los cuatro que conoce.

DO $dispatch_template$
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
                DROP CONSTRAINT IF EXISTS agent_dispatch_outbox_kind
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                ADD CONSTRAINT agent_dispatch_outbox_kind
                CHECK (item_kind IN ('text','media','payment_link','flow','template')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                VALIDATE CONSTRAINT agent_dispatch_outbox_kind
        $ddl$, target);
    END LOOP;
END
$dispatch_template$;
