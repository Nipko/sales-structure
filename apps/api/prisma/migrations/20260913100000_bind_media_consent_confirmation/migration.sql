-- Bind every deterministic media-consent grant to the exact inbound provider
-- message that expressed it. This is additive: historical consent stays valid
-- under its existing evidence, and no source message is fabricated.

DO $bind_media_consent_confirmation$
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

        IF to_regclass(target || '.consent_records') IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %s."consent_records"'
                || ' ADD COLUMN IF NOT EXISTS "confirmation_message_id" VARCHAR(512)',
                target);
        END IF;
        IF to_regclass(target || '.media_ai_consent_challenges') IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %s."media_ai_consent_challenges"'
                || ' ADD COLUMN IF NOT EXISTS "confirmation_message_id" VARCHAR(512)',
                target);
        END IF;
    END LOOP;
END
$bind_media_consent_confirmation$;
