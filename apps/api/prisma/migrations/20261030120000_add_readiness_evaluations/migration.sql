-- El historial de la preparación del negocio, para los tenants que ya existen (C0 §2.7, rebanada R2).
--
-- `ReadinessService` evalúa la foto del tenant con el motor de @parallext/business-spec y guarda aquí una fila
-- SOLO cuando el resultado cambió (`result_hash`, que no depende de la hora de la lectura): cada fila es un
-- cambio real del veredicto o de los huecos, y el historial queda pequeño. La última evaluación vive además en
-- Redis (`readiness:{tenant}:{spec_version}`); esta tabla es la memoria, no la caché.
--
-- `tenant-schema.sql` crea la misma tabla en cada tenant nuevo (bloque READINESS EVALUATIONS) y
-- `readiness-evaluations-schema.spec.ts` exige que las dos definiciones coincidan.
--
-- ADITIVA: una tabla y un índice nuevos, ni una fila escrita. El binario anterior no la conoce, y el nuevo
-- tolera que falte (muestra la preparación sin historial), así que el orden migración → contenedores es
-- seguro en los dos sentidos.

DO $readiness_evaluations$
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

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."readiness_evaluations" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                spec_version TEXT NOT NULL,
                snapshot_hash TEXT NOT NULL,
                result_hash TEXT NOT NULL,
                verdict TEXT NOT NULL,
                counts JSONB NOT NULL DEFAULT '{}'::jsonb,
                result JSONB NOT NULL,
                "trigger" TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                CONSTRAINT readiness_evaluations_verdict CHECK (verdict IN ('no_listo','limitado','listo'))
            )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_readiness_evaluations_created
                ON %s."readiness_evaluations" (created_at DESC)
        $ddl$, target);
    END LOOP;
END
$readiness_evaluations$;
