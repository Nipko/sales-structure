-- Control de salida del agente (C0 §1.2 y §5 R4, ADR 0010).
--
-- 1. `public.tenants`: si la IA atiende a clientes reales (`go_live_state`), cuándo, quién, con qué versión de la
--    especificación y qué intenciones «limitadas» reconoció el dueño (`go_live_ack`). Todos los tenants arrancan en
--    `off`: mientras el control está en modo sombra no cambia nada; antes de encenderlo, cada tenant que deba atender
--    se publica desde el panel (ver docs/domain/business-readiness-runtime.md, «Control de salida»).
-- 2. `<tenant>.go_live_decisions`: la decisión de cada mensaje entrante de un canal real, para el informe de los 7
--    días de sombra. `tenant-schema.sql` crea la misma tabla en cada tenant nuevo (bloque GO LIVE DECISIONS) y
--    `go-live-schema.spec.ts` exige que las dos definiciones coincidan.
--
-- ADITIVA: columnas con default y una tabla nueva, ni una fila de negocio escrita. El binario anterior no las conoce,
-- y el nuevo tolera que falten (la decisión se calcula y se registra en el log), así que el orden migración →
-- contenedores es seguro en los dos sentidos.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "go_live_state" VARCHAR(8) NOT NULL DEFAULT 'off';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "go_live_at" TIMESTAMPTZ;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "go_live_by" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "go_live_spec_version" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "go_live_ack" JSONB;
DO $go_live_state_check$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_go_live_state_check') THEN
        ALTER TABLE "tenants" ADD CONSTRAINT "tenants_go_live_state_check" CHECK ("go_live_state" IN ('off','on'));
    END IF;
END
$go_live_state_check$;

DO $go_live_decisions$
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
            CREATE TABLE IF NOT EXISTS %s."go_live_decisions" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                channel_type TEXT NOT NULL,
                conversation_id UUID,
                mode TEXT NOT NULL,
                serve BOOLEAN NOT NULL,
                reason TEXT NOT NULL,
                go_live_state TEXT NOT NULL,
                verdict TEXT,
                spec_version TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                CONSTRAINT go_live_decisions_mode CHECK (mode IN ('shadow','enforce'))
            )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_go_live_decisions_created
                ON %s."go_live_decisions" (created_at DESC)
        $ddl$, target);
    END LOOP;
END
$go_live_decisions$;
