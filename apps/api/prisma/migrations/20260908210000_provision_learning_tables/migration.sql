-- Las cuatro tablas de aprendizaje sólo existían en dos de los tres lugares que
-- exige la paridad de DDL: la constante de bootstrap perezoso (`LEARNING_SCHEMA`)
-- y `tenant-schema.sql`, que únicamente corre para un tenant nuevo. No había
-- migración, así que un tenant existente recibía las tablas recién en el primer
-- request que las usara.
--
-- Eso no era sólo una demora. `retired_by` y `retired_at` se agregaron a
-- `learning_releases` para que un rollback registre quién lo hizo, y
-- `LearningService.rollback` no llama a `ensureTables`: en un tenant cuya tabla
-- ya existía, el `CREATE TABLE IF NOT EXISTS` no agrega nada y el UPDATE del
-- rollback fallaba con 42703. La retractación —la operación que más importa que
-- funcione— era la que se rompía.
--
-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX / ADD COLUMN, todos con
-- IF NOT EXISTS y sin escribir ninguna fila. El código viejo ignora las columnas
-- nuevas durante el rolling restart, que es lo que exige expand-contract.
--
-- SQL dinámico porque las tablas viven en el schema de cada tenant.
DO $learning_tables$
DECLARE
    tenant_record RECORD;
    target TEXT;
    has_vector BOOLEAN;
BEGIN
    -- `learning_examples.embedding` es `vector(1536)`. Si la extensión no está
    -- disponible, crear la tabla abortaría la migración entera y con ella el
    -- deploy; el bootstrap perezoso sigue siendo el camino para ese tenant.
    has_vector := EXISTS (SELECT 1 FROM "pg_type" WHERE "typname" = 'vector');

    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        -- Un schema nombrado en `tenants` que ya no existe no detiene al resto.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );

        IF has_vector THEN
            -- ── Conversaciones importadas como material ──────────────────────
            EXECUTE format($ddl$
                CREATE TABLE IF NOT EXISTS %s."learning_sources" (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    agent_id UUID NOT NULL,
                    source_kind VARCHAR(16) NOT NULL CHECK (source_kind IN ('inbox','file')),
                    source_key CHAR(64) NOT NULL,
                    group_key CHAR(64) NOT NULL,
                    source_contact_id UUID,
                    source_conversation_id UUID,
                    split VARCHAR(12) NOT NULL CHECK (split IN ('train','holdout')),
                    channel VARCHAR(40) NOT NULL,
                    language VARCHAR(2) NOT NULL,
                    transcript JSONB NOT NULL,
                    content_hash CHAR(64) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
                    created_by VARCHAR(100) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (agent_id, source_kind, source_key))
            $ddl$, target);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS idx_learning_sources_group ON %s."learning_sources"(group_key, split)', target);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS idx_learning_sources_contact ON %s."learning_sources"(source_contact_id)', target);

            -- ── Ejemplos derivados y su análisis ─────────────────────────────
            EXECUTE format($ddl$
                CREATE TABLE IF NOT EXISTS %s."learning_examples" (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    source_id UUID NOT NULL REFERENCES %s."learning_sources"(id) ON DELETE CASCADE,
                    agent_id UUID NOT NULL,
                    kind VARCHAR(24) NOT NULL DEFAULT 'brand_style'
                        CHECK (kind IN ('brand_style','operational_pattern','business_fact','customer_memory','regression')),
                    intent VARCHAR(40) NOT NULL,
                    episode JSONB NOT NULL,
                    content_hash CHAR(64) NOT NULL,
                    response_pattern TEXT,
                    rationale TEXT,
                    facts_required JSONB NOT NULL DEFAULT '[]'::jsonb,
                    analysis JSONB,
                    embedding vector(1536),
                    evidence_refs UUID[] NOT NULL DEFAULT '{}'::uuid[],
                    dedup_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (dedup_status IN ('pending','clear','conflict')),
                    status VARCHAR(16) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','analyzing','analyzed','failed','flagged','approved','rejected','retired')),
                    revision INTEGER NOT NULL DEFAULT 1,
                    reviewed_by VARCHAR(100),
                    reviewed_at TIMESTAMPTZ,
                    review_note TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(source_id, content_hash))
            $ddl$, target, target);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS idx_learning_examples_agent ON %s."learning_examples"(agent_id, status, intent)', target);

            -- ── Cada decisión de revisión, con la versión que revisó ─────────
            EXECUTE format($ddl$
                CREATE TABLE IF NOT EXISTS %s."learning_reviews" (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    example_id UUID NOT NULL REFERENCES %s."learning_examples"(id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL,
                    decision VARCHAR(16) NOT NULL,
                    snapshot JSONB NOT NULL,
                    reviewer_id VARCHAR(100) NOT NULL,
                    note TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())
            $ddl$, target, target);

            -- ── Lo publicado, su evaluación y su linaje ──────────────────────
            EXECUTE format($ddl$
                CREATE TABLE IF NOT EXISTS %s."learning_releases" (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    agent_id UUID NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','published','retired')),
                    example_ids UUID[] NOT NULL,
                    snapshot JSONB NOT NULL,
                    snapshot_hash CHAR(64) NOT NULL,
                    baseline_release_id UUID,
                    traffic_percent INTEGER NOT NULL DEFAULT 100 CHECK (traffic_percent BETWEEN 0 AND 100),
                    evaluation_status VARCHAR(16) NOT NULL DEFAULT 'pending'
                        CHECK (evaluation_status IN ('pending','running','passed','failed')),
                    evaluation JSONB,
                    created_by VARCHAR(100) NOT NULL,
                    published_by VARCHAR(100),
                    published_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())
            $ddl$, target);
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS idx_learning_releases_active ON %s."learning_releases"(agent_id, status, created_at DESC)', target);
        END IF;

        -- ── Ensanchamientos ──────────────────────────────────────────────────
        -- Van fuera del CREATE y con su propio IF EXISTS: en un tenant cuyas
        -- tablas ya existen el CREATE no agrega nada, y es exactamente ese
        -- tenant el que necesita las columnas.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
            WHERE "table_schema" = tenant_record."schema_name" AND "table_name" = 'learning_sources') THEN
            EXECUTE format(
                'ALTER TABLE %s."learning_sources" ADD COLUMN IF NOT EXISTS source_evidence JSONB', target);
        END IF;

        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
            WHERE "table_schema" = tenant_record."schema_name" AND "table_name" = 'learning_releases') THEN
            EXECUTE format(
                'ALTER TABLE %s."learning_releases" ADD COLUMN IF NOT EXISTS evaluation_namespaces JSONB', target);
            -- Sin estas dos el rollback falla con 42703 en todo tenant que ya
            -- hubiera usado aprendizaje antes de este deploy.
            EXECUTE format(
                'ALTER TABLE %s."learning_releases" ADD COLUMN IF NOT EXISTS retired_by VARCHAR(100)', target);
            EXECUTE format(
                'ALTER TABLE %s."learning_releases" ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ', target);
        END IF;
    END LOOP;
END
$learning_tables$;
