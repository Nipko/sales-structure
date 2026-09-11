-- Aceptado no es entregado, y una cota no es un cargo.
--
-- El POST a Meta contesta con un `wamid` y nada más. Eso es una ACEPTACIÓN:
-- Meta tiene el mensaje y va a intentar entregarlo. Desde el 1-oct-2026 el
-- cobro cae en la ENTREGA, así que el `wamid` no dice cuánto se gastó ni
-- siquiera si se gastó.
--
-- Los tres sumideros lo registraban como `delivered_unpriced`, que dejaba la
-- fila en `pending_reconciliation` con `remote_state='delivered'`. A las 72
-- horas el reconciliador la liquidaba al monto reservado. Es decir: un mensaje
-- que Meta aceptó y NUNCA entregó terminaba en el libro como gasto liquidado,
-- con la evidencia diciendo "reconciled_at_reserved_amount" — un nombre que
-- suena a factura y significa "nadie miró".
--
-- ── LOS DOS ESTADOS QUE FALTABAN ────────────────────────────────────────────
--
--   · `accepted`   Meta tomó el mensaje. No sabemos si llegó. La exposición
--                  sigue retenida — el dinero podría gastarse — pero no es un
--                  cargo y no puede convertirse en uno por envejecer.
--   · `estimated`  Llegó, y nadie pudo decir cuánto costó. La cota superior se
--                  conserva como ESTIMACIÓN. Es lo más honesto que se puede
--                  afirmar sin una factura, y se llama por su nombre.
--
-- Un `settled` a partir de ahora significa una sola cosa: hay una autoridad que
-- dijo el monto. Meta con `billable:false`, el precio publicado sobre una
-- entrega confirmada, o una factura importada. El tiempo no es una autoridad.
--
-- ── POR QUÉ NO ALCANZABA CON RENOMBRAR ──────────────────────────────────────
--
-- Porque `pending_reconciliation` tenía dos significados encima —"llegó sin
-- precio" y "quizá llegó"— y el reconciliador no podía distinguirlos. Con
-- `accepted` separado, cada estado contesta una sola pregunta y el barrido
-- puede hacer lo contrario en cada caso sin adivinar.
--
-- ADITIVA: sólo se AMPLÍA un CHECK (ningún valor deja de ser válido) y se
-- amplían dos índices parciales. El binario anterior sigue escribiendo
-- `held`/`pending_reconciliation` y sus filas siguen siendo legales.

DO $accepted_estimated$
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
                DROP CONSTRAINT IF EXISTS whatsapp_spend_reservations_state
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD CONSTRAINT whatsapp_spend_reservations_state CHECK (state IN
                    ('held','accepted','settled','released',
                     'pending_reconciliation','estimated','indeterminate')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                VALIDATE CONSTRAINT whatsapp_spend_reservations_state
        $ddl$, target);

        -- Una fila `estimated` conserva una cota, no un cargo: `charged_minor`
        -- sigue siendo NULL, que es lo que el CHECK de `charged` ya exige. Se
        -- deja explícito acá para que quede dicho dónde vive la diferencia.
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_reservations_estimate
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD CONSTRAINT whatsapp_spend_reservations_estimate
                CHECK (state <> 'estimated' OR charged_minor IS NULL) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                VALIDATE CONSTRAINT whatsapp_spend_reservations_estimate
        $ddl$, target);

        -- Los índices parciales tienen que ver los estados nuevos, o el barrido
        -- deja de encontrar exactamente las filas que ahora importan.
        EXECUTE format($ddl$
            DROP INDEX IF EXISTS %s.idx_whatsapp_spend_open
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_open
                ON %s."whatsapp_spend_reservations" (lease_expires_at)
                WHERE state IN ('held','accepted','pending_reconciliation',
                                'estimated','indeterminate')
        $ddl$, target);
        EXECUTE format($ddl$
            DROP INDEX IF EXISTS %s.idx_whatsapp_spend_recent_identical
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_recent_identical
                ON %s."whatsapp_spend_reservations"
                (channel_account_id, recipient_ref, content_digest, created_at DESC)
                WHERE content_digest IS NOT NULL
                  AND state IN ('held','accepted','settled',
                                'pending_reconciliation','estimated','indeterminate')
        $ddl$, target);

        -- Y el índice del reconciliador, que ahora busca por estado y no por
        -- vencimiento de lease: `accepted` viejo y `pending_reconciliation`
        -- viejo son dos preguntas distintas, y ambas se hacen por `updated_at`.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_unresolved
                ON %s."whatsapp_spend_reservations" (state, updated_at)
                WHERE state IN ('accepted','pending_reconciliation',
                                'estimated','indeterminate')
        $ddl$, target);
    END LOOP;
END
$accepted_estimated$;
