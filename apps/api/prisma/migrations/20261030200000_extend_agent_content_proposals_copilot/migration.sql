-- Copiloto de onboarding (C0 §1.3 y §2.8, rebanada R6, ADR 0012).
--
-- `<tenant>.agent_content_proposals` (el ledger de propuestas de Assist) gana lo que necesita una propuesta del copiloto:
-- el requisito al que apunta (`requirement_id`), qué toca (`target_ref`: '' = el valor global del requisito,
-- `faqs:<id>`, `knowledge_documents:<id>`…), las citas verificadas (`evidence`), la ejecución que la produjo
-- (`extraction_run_id`) y quién la decidió (`decided_by`, `decided_at`, `decision_note`). El CHECK de `status` se
-- amplía con `rejected` y `superseded`. La caducidad de 30 días de las propuestas de extracción va en `expires_at`.
--
-- `<tenant>.requirement_values` gana el invariante de C0 §1.3.4: no hay valor `origin=copilot` sin un `confirmed_by`
-- humano y confirmado. NOT VALID: vale para toda escritura nueva sin reescanear (y hoy no hay ninguna fila copilot).
--
-- ADITIVA (expand): columnas nuevas, un CHECK más ancho y un CHECK nuevo; ni una fila escrita ni una columna borrada.
-- `tenant-schema.sql` aplica lo mismo en cada tenant nuevo (y `ensureContentProposalSchema` lo repara en caliente desde
-- ahí); `copilot-proposals-schema.spec.ts` exige que las dos definiciones coincidan. El binario anterior ignora las
-- columnas nuevas y nunca escribe los estados nuevos, así que el orden migración → contenedores es seguro.
DO $copilot_proposals$
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

        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                   WHERE "table_schema" = tenant_record."schema_name" AND "table_name" = 'agent_content_proposals') THEN
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "requirement_id" TEXT $ddl$, target);
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "target_ref" TEXT $ddl$, target);
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "evidence" JSONB $ddl$, target);
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "extraction_run_id" UUID $ddl$, target);
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "decided_by" UUID $ddl$, target);
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMPTZ $ddl$, target);
            EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD COLUMN IF NOT EXISTS "decision_note" TEXT $ddl$, target);
            IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                           WHERE n.nspname = tenant_record."schema_name" AND c.conname = 'agent_content_proposals_status_r6') THEN
                EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" DROP CONSTRAINT IF EXISTS "agent_content_proposals_status_check" $ddl$, target);
                EXECUTE format($ddl$ ALTER TABLE %s."agent_content_proposals" ADD CONSTRAINT "agent_content_proposals_status_r6" CHECK ("status" IN ('proposed','applied','expired','rejected','superseded')) $ddl$, target);
            END IF;
            EXECUTE format($ddl$ CREATE INDEX IF NOT EXISTS "idx_agent_content_proposals_requirement" ON %s."agent_content_proposals" ("requirement_id", "target_ref", "status") $ddl$, target);
        END IF;

        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                   WHERE "table_schema" = tenant_record."schema_name" AND "table_name" = 'requirement_values')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                           WHERE n.nspname = tenant_record."schema_name" AND c.conname = 'requirement_values_copilot_confirmed') THEN
            EXECUTE format($ddl$ ALTER TABLE %s."requirement_values" ADD CONSTRAINT "requirement_values_copilot_confirmed" CHECK ("origin" <> 'copilot' OR ("status" = 'confirmed' AND "confirmed_by" IS NOT NULL)) NOT VALID $ddl$, target);
        END IF;
    END LOOP;
END
$copilot_proposals$;
