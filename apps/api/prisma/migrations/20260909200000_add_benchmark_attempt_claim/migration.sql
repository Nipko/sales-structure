-- Las columnas de reserva de un intento de benchmark.
--
-- Enteramente ADITIVA: ADD COLUMN IF NOT EXISTS sobre columnas nulables o
-- con default, y ni una fila escrita. El código viejo las ignora durante el
-- rolling restart, que es lo que exige expand-contract.
--
-- Las filas que ya existen quedan en `recorded`, que es exactamente lo que
-- son: intentos ya contestados. Ninguna se reinterpreta.
DO $benchmark_attempt_claim$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        -- Un schema nombrado en `tenants` que ya no existe no detiene al resto.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        -- Un tenant sin la tabla tampoco: la creará su propio bootstrap.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                    WHERE table_schema = tenant_record."schema_name"
                      AND table_name = 'benchmark_attempts') THEN
            EXECUTE format($ddl$
                ALTER TABLE %s."benchmark_attempts"
                        ADD COLUMN IF NOT EXISTS run_id UUID,
                        ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'recorded',
                        ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ
            $ddl$, target);
        END IF;
    END LOOP;
END
$benchmark_attempt_claim$;
