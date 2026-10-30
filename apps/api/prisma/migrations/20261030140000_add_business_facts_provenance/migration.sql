-- Valores del negocio con procedencia y columnas de procedencia en catálogos y textos, para los tenants que ya
-- existen (C0 §2.1 y §2.2, rebanada R3).
--
-- `requirement_values`: una fila por requisito de la especificación y alcance; solo la escribe BusinessFactsService,
-- que valida contra @parallext/business-spec, sube `version` y deja cada escritura (con su actor) en
-- `requirement_value_versions`, que es append-only.
--
-- Columnas de procedencia (`content_status`, `origin`, `confirmed_by`, `confirmed_at`, `source_ref`, y en las tablas
-- con precio `price_type` y `price_status`) en los catálogos de los objetos y en los textos. services y
-- membership_plans ya tienen `price_status` (confirmed|example|quote, lo escriben sus pantallas): reciben solo
-- `price_type`; separar `quote` de `price_status` es el paso «contract», cuando el runtime lea `price_type`.
--
-- `tenant-schema.sql` crea lo mismo en cada tenant nuevo (bloques BUSINESS FACTS y PROVENANCE COLUMNS) y
-- `business-facts-schema.spec.ts` exige que las definiciones coincidan, también con PROVENANCE_TABLES del paquete.
--
-- ADITIVA (expand): dos tablas, un índice y columnas nuevas nullable, ni una fila escrita. `content_status` nace
-- 'confirmed' por default de columna y no prueba nada: la lectura exige `origin` y la estampa
-- `source_ref.row_updated_at`, y sin ellas decide con las reglas L1–L7 como hasta hoy. El binario anterior no conoce
-- nada de esto y el nuevo tolera que falte (el lector pregunta qué columnas existen), así que el orden
-- migración → contenedores es seguro en los dos sentidos. La procedencia de las filas existentes la escribe
-- `apps/api/scripts/readiness/backfill-provenance.cjs`, aparte y con --dry-run primero.

DO $business_facts$
DECLARE
    tenant_record RECORD;
    target TEXT;
    tbl TEXT;
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
            CREATE TABLE IF NOT EXISTS %s."requirement_values" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                requirement_id TEXT NOT NULL,
                scope_key TEXT NOT NULL DEFAULT '',
                value JSONB,
                status TEXT NOT NULL,
                origin TEXT NOT NULL,
                confirmed_by UUID,
                confirmed_at TIMESTAMPTZ,
                source_ref JSONB,
                valid_until TIMESTAMPTZ,
                spec_version TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT requirement_values_status CHECK (status IN ('confirmed','example','seeded')),
                CONSTRAINT requirement_values_origin CHECK (origin IN ('owner_form','copilot','import','integration','country_pack','default_accepted','pending_answer','onboarding','platform_seed','legacy','legacy_inferred')),
                CONSTRAINT requirement_values_key UNIQUE (requirement_id, scope_key)
            )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."requirement_value_versions" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                value_id UUID NOT NULL,
                requirement_id TEXT NOT NULL,
                scope_key TEXT NOT NULL,
                value JSONB,
                status TEXT NOT NULL,
                origin TEXT NOT NULL,
                confirmed_by UUID,
                confirmed_at TIMESTAMPTZ,
                source_ref JSONB,
                valid_until TIMESTAMPTZ,
                spec_version TEXT NOT NULL,
                version INTEGER NOT NULL,
                actor JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                CONSTRAINT requirement_value_versions_key UNIQUE (value_id, version)
            )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_requirement_value_versions_requirement
                ON %s."requirement_value_versions" (requirement_id, scope_key, created_at DESC)
        $ddl$, target);

        -- Columnas de procedencia. Una tabla que este tenant aún no tiene la crea tenant-schema.sql ya con ellas.
        FOREACH tbl IN ARRAY ARRAY['services','menu_items','products','tour_packages','properties','real_estate_listings','courses','membership_plans','insurance_plans','vehicles','faqs','knowledge_documents']
        LOOP
            CONTINUE WHEN to_regclass(format('%s.%I', target, tbl)) IS NULL;
            EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "content_status" TEXT DEFAULT 'confirmed' CHECK ("content_status" IN ('confirmed','example','seeded')) $ddl$, target, tbl);
            EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "origin" TEXT $ddl$, target, tbl);
            EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "confirmed_by" UUID $ddl$, target, tbl);
            EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ $ddl$, target, tbl);
            EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "source_ref" JSONB $ddl$, target, tbl);
            IF tbl NOT IN ('faqs','knowledge_documents') THEN
                EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "price_type" TEXT CHECK ("price_type" IN ('fijo','desde','a_cotizar','gratis')) $ddl$, target, tbl);
            END IF;
            IF tbl NOT IN ('faqs','knowledge_documents','services','membership_plans') THEN
                EXECUTE format($ddl$ ALTER TABLE %s.%I ADD COLUMN IF NOT EXISTS "price_status" TEXT CHECK ("price_status" IN ('confirmed','example')) $ddl$, target, tbl);
            END IF;
        END LOOP;
    END LOOP;
END
$business_facts$;
