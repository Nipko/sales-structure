-- El carril durable no sabía mandar un menú ni una ubicación.
--
-- `item_kind` admitía `text`, `media`, `payment_link`, `flow` y `template`.
-- Faltan dos formas que el motor YA manda todos los días por el carril REST:
--
--   · `interactive` — los botones de respuesta rápida y las listas con las que
--     el agente pregunta "¿qué servicio?" o "¿qué horario?". Es una llamada
--     distinta de la Graph API (`type: interactive`), no un texto con opciones;
--   · `location` — la dirección del local como PIN en el mapa, que es lo que
--     un cliente abre en su app de mapas. Como texto no es lo mismo: hay que
--     copiarlo y pegarlo, y la mitad de la gente no lo hace.
--
-- Sin esos dos tipos no se podían migrar los endpoints REST que los mandan, y
-- mientras sigan fuera del outbox cada uno de ellos sale sin fila, sin lease y
-- sin recibo: un reinicio entre decidir y hacer el POST lo pierde o lo repite,
-- y desde octubre cada repetición es un cargo.
--
-- ADITIVA: se AMPLÍA un CHECK. Ningún valor deja de ser válido y el binario
-- anterior sigue escribiendo los cinco que conoce.

DO $dispatch_interactive$
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
                CHECK (item_kind IN ('text','media','payment_link','flow','template',
                                     'interactive','location')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_dispatch_outbox"
                VALIDATE CONSTRAINT agent_dispatch_outbox_kind
        $ddl$, target);
    END LOOP;
END
$dispatch_interactive$;
