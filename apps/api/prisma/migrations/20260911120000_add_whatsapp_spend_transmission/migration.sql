-- Separar "tengo presupuesto" de "tengo derecho a hacer el POST".
--
-- La reserva y la transmisión eran una sola cosa, y no lo son. Una reserva
-- `held` dice que el dinero está apartado; NO dice quién de los que la
-- encontraron puede mandar el mensaje. Con el lock de efecto ya en su sitio,
-- dos autorizaciones concurrentes producen una sola reserva —la perdedora
-- adopta— y las dos quedaban autorizadas a transmitir, porque `mayTransmit`
-- sólo miraba `state = 'held'`. Un efecto, una reserva, dos POST.
--
-- Estas tres columnas son ese derecho, y es exclusivo:
--
--   · `transmit_token`      quién lo tiene. Nadie más puede escribir el
--                           resultado: registrar un desenlace exige el token,
--                           así que un worker lento no puede pisar el resultado
--                           de un intento posterior.
--   · `transmit_state`      en qué punto del POST está. Y es lo que permite
--                           distinguir las dos caídas que importan.
--   · `transmit_expires_at` hasta cuándo. Un worker muerto no bloquea el efecto
--                           para siempre.
--
-- ── POR QUÉ `claimed` E `in_flight` SON DOS ESTADOS Y NO UNO ────────────────
--
-- Porque una caída ANTES del POST y una caída DESPUÉS del POST piden respuestas
-- opuestas, y sin esta distinción hay que elegir una y equivocarse en la otra:
--
--   · caída en `claimed` — el worker tomó el derecho y murió antes de tocar la
--     red. Está PROBADO que no salió nada, así que el derecho vuelve a `idle` y
--     otro worker manda el mensaje. Una sola vez.
--   · caída en `in_flight` — el worker ya había empezado la petición. Nadie
--     sabe si Meta la procesó. Reintentar a ciegas es exactamente el duplicado
--     que todo este mecanismo existe para evitar, así que el efecto pasa a
--     `indeterminate` y entra a reconciliación.
--
-- El paso `claimed -> in_flight` se escribe ANTES del fetch y no después. Al
-- revés no distinguiría nada: todo lo que se escribe después del POST ya
-- presupone que el POST ocurrió.
--
-- ADITIVA: `ADD COLUMN IF NOT EXISTS` nullable o con DEFAULT, CHECK `NOT VALID`
-- + `VALIDATE`, e índice parcial. El binario anterior sigue escribiendo estas
-- filas sin conocer ninguna de las tres, y por eso `transmit_state` lleva
-- DEFAULT: sus INSERT tienen que seguir siendo válidos durante el despliegue.

DO $spend_transmission$
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
        CONTINUE WHEN to_regclass(target || '.whatsapp_spend_reservations') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD COLUMN IF NOT EXISTS transmit_token UUID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD COLUMN IF NOT EXISTS transmit_state TEXT NOT NULL DEFAULT 'idle'
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD COLUMN IF NOT EXISTS transmit_expires_at TIMESTAMPTZ
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_reservations_transmit
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD CONSTRAINT whatsapp_spend_reservations_transmit
                CHECK (transmit_state IN ('idle','claimed','in_flight','resolved')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                VALIDATE CONSTRAINT whatsapp_spend_reservations_transmit
        $ddl$, target);

        -- Un derecho tomado tiene dueño y vencimiento; uno inactivo no tiene
        -- ninguno de los dos. La regla existe para que un barrido por
        -- vencimiento no encuentre filas sin token que no puede resolver.
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_reservations_transmit_lease
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD CONSTRAINT whatsapp_spend_reservations_transmit_lease
                CHECK (
                    (transmit_state IN ('claimed','in_flight'))
                        = (transmit_token IS NOT NULL AND transmit_expires_at IS NOT NULL)
                ) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                VALIDATE CONSTRAINT whatsapp_spend_reservations_transmit_lease
        $ddl$, target);

        -- El barredor busca derechos vencidos, que son pocos; el índice parcial
        -- evita leer la tabla entera para encontrarlos.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_transmit_lease
                ON %s."whatsapp_spend_reservations" (transmit_expires_at)
                WHERE transmit_state IN ('claimed','in_flight')
        $ddl$, target);
    END LOOP;
END
$spend_transmission$;
