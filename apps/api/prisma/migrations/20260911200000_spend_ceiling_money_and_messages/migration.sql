-- Un techo podía ser de dinero O de mensajes, nunca los dos.
--
-- `cap_kind` admitía `money`, `deliveries` u `observe`, y dos CHECK exclusivos
-- garantizaban que sólo una de las dos columnas estuviera presente. El
-- predicado de presión hacía lo mismo: `money` mira el dinero, cualquier otra
-- cosa mira las entregas.
--
-- Eso deja sin proteger exactamente lo que hay que proteger desde octubre. Las
-- 1.000 entregas de servicio gratuitas por número y mes son una cuota de
-- MENSAJES que no cuesta dinero: un techo de dinero no la limita en absoluto.
-- Un tenant puede quemar la franquicia entera sin gastar un centavo, y a partir
-- de ahí cada mensaje se cobra — que es el momento en que el techo de dinero
-- empieza a servir, ya tarde.
--
-- `both` permite las dos columnas a la vez, y la presión es la PEOR de las dos:
-- el que se llene primero manda.
--
-- ADITIVA: se AMPLÍAN tres CHECK. Ninguna fila existente deja de ser válida
-- —`money`, `deliveries` y `observe` siguen significando lo mismo— y el binario
-- anterior sigue escribiendo los tres que conoce.

DO $spend_ceiling_both$
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
        CONTINUE WHEN to_regclass(target || '.whatsapp_spend_counters') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_counters_cap_kind,
                DROP CONSTRAINT IF EXISTS whatsapp_spend_counters_money,
                DROP CONSTRAINT IF EXISTS whatsapp_spend_counters_deliveries,
                DROP CONSTRAINT IF EXISTS whatsapp_spend_counters_currency
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                ADD CONSTRAINT whatsapp_spend_counters_cap_kind CHECK (cap_kind IN
                    ('money','deliveries','observe','both')) NOT VALID,
                ADD CONSTRAINT whatsapp_spend_counters_money
                    CHECK ((cap_kind IN ('money','both')) = (cap_minor IS NOT NULL)) NOT VALID,
                ADD CONSTRAINT whatsapp_spend_counters_deliveries
                    CHECK ((cap_kind IN ('deliveries','both')) = (cap_deliveries IS NOT NULL)) NOT VALID,
                ADD CONSTRAINT whatsapp_spend_counters_currency
                    CHECK (cap_kind NOT IN ('money','both') OR currency IS NOT NULL) NOT VALID
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                VALIDATE CONSTRAINT whatsapp_spend_counters_cap_kind
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                VALIDATE CONSTRAINT whatsapp_spend_counters_money
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                VALIDATE CONSTRAINT whatsapp_spend_counters_deliveries
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                VALIDATE CONSTRAINT whatsapp_spend_counters_currency
        $ddl$, target);
    END LOOP;
END
$spend_ceiling_both$;
