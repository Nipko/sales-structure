-- Ledger de las creaciones de contenido que Parallly Assist propone y una
-- persona aprueba (una FAQ, un texto legal, un curso, un servicio de agenda).
--
-- Va acá y no en `agent_config_proposals`: esa tabla tiene
-- `agent_id UUID NOT NULL REFERENCES agent_personas(id)`, y ninguno de estos
-- objetos pertenece a un agente. Relajar esa columna habría debilitado la
-- verificación de integridad del ledger de configuración para hacerle lugar a
-- filas que nunca lee.
--
-- Las tres ubicaciones de paridad quedan sincronizadas: la definición canónica
-- (`prisma/tenant-schema.sql`, que sólo corre para un tenant nuevo), el
-- bootstrap perezoso (`ensureContentProposalSchema`, que repara desde esa misma
-- definición) y esta migración, que es lo único que alcanza a un tenant
-- existente antes de su primer request.
--
-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX con IF NOT EXISTS y sin
-- escribir ninguna fila. El código viejo ignora la tabla nueva durante el
-- rolling restart, que es lo que exige expand-contract.
--
-- SQL dinámico porque la tabla vive en el schema de cada tenant.
DO $agent_content_proposals$
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
            CREATE TABLE IF NOT EXISTS %s."agent_content_proposals" (
                "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                "operation" TEXT NOT NULL,
                "requested_by" UUID NOT NULL,
                "request_key" VARCHAR(80) NOT NULL,
                "digest" VARCHAR(64) NOT NULL,
                "input" JSONB NOT NULL,
                "status" VARCHAR(20) NOT NULL DEFAULT 'proposed'
                    CHECK ("status" IN ('proposed', 'applied', 'expired')),
                "expires_at" TIMESTAMPTZ NOT NULL,
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "applied_at" TIMESTAMPTZ,
                "applied_by" UUID,
                "created_object_id" UUID,
                UNIQUE ("requested_by", "request_key"))
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS "idx_agent_content_proposals_status"
                ON %s."agent_content_proposals" ("status", "expires_at")
        $ddl$, target);
    END LOOP;
END
$agent_content_proposals$;
