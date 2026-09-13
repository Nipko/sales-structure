-- Media AI had a fail-closed policy but no server-side authority capable of
-- satisfying it. These additive columns bind a consent to the stable contact,
-- give it an expiry/revocation lifecycle and make the deterministic challenge
-- idempotent. Historical generic form consents remain historical evidence; no
-- row is backfilled or reinterpreted as permission to use AI.

DO $media_ai_consent_authority$
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
        CONTINUE WHEN to_regclass(target || '.consent_records') IS NULL;

        EXECUTE format(
            'ALTER TABLE %s."consent_records"'
            || ' ADD COLUMN IF NOT EXISTS "contact_id" UUID,'
            || ' ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,'
            || ' ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMPTZ,'
            || ' ADD COLUMN IF NOT EXISTS "consent_request_id" UUID',
            target);
        EXECUTE format(
            'CREATE UNIQUE INDEX IF NOT EXISTS "uidx_consent_request"'
            || ' ON %s."consent_records" ("consent_request_id")'
            || ' WHERE "consent_request_id" IS NOT NULL',
            target);
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS "idx_consent_contact_scope_active"'
            || ' ON %s."consent_records" ("contact_id", "consent_scope", "created_at" DESC)'
            || ' WHERE "revoked_at" IS NULL',
            target);
    END LOOP;
END
$media_ai_consent_authority$;
