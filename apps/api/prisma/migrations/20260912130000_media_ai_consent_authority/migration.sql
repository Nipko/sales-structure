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

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."media_ai_consent_challenges" (
                "request_id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                "contact_id" UUID NOT NULL,
                "conversation_id" UUID NOT NULL,
                "channel" VARCHAR(50) NOT NULL,
                "purposes" TEXT[] NOT NULL,
                "policy_id" UUID NOT NULL,
                "policy_title" VARCHAR(500) NOT NULL,
                "policy_version" INTEGER NOT NULL,
                "legal_text_hash" VARCHAR(64) NOT NULL,
                "issued_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "expires_at" TIMESTAMPTZ NOT NULL,
                "resolved_at" TIMESTAMPTZ,
                "resolution" VARCHAR(20),
                CONSTRAINT "media_ai_consent_challenges_resolution" CHECK (
                    ("resolved_at" IS NULL AND "resolution" IS NULL)
                    OR ("resolved_at" IS NOT NULL AND "resolution" IN
                        ('granted','declined','expired','superseded'))
                )
            )
        $ddl$, target);
        EXECUTE format(
            'CREATE UNIQUE INDEX IF NOT EXISTS "uidx_media_ai_consent_challenge_pending"'
            || ' ON %s."media_ai_consent_challenges" ("conversation_id")'
            || ' WHERE "resolved_at" IS NULL',
            target);
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS "idx_media_ai_consent_challenge_contact"'
            || ' ON %s."media_ai_consent_challenges" ("contact_id", "issued_at" DESC)',
            target);
    END LOOP;
END
$media_ai_consent_authority$;
