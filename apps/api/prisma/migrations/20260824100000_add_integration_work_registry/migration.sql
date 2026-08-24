-- Provider-neutral integration workers used to probe every active tenant
-- schema every minute. This durable public index is updated in the same
-- transaction as each outbox/inbox insert, so workers visit only schemas that
-- can contain integration work.
CREATE TABLE IF NOT EXISTS "public"."integration_work_tenants" (
    "tenant_id" UUID PRIMARY KEY
        REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
    "schema_name" VARCHAR(63) NOT NULL,
    "outbox_seen_at" TIMESTAMPTZ,
    "webhook_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_integration_work_tenants_outbox"
    ON "public"."integration_work_tenants" ("outbox_seen_at");
CREATE INDEX IF NOT EXISTS "idx_integration_work_tenants_webhook"
    ON "public"."integration_work_tenants" ("webhook_seen_at");

-- One-time recovery for rows created before the registry existed. Dynamic SQL
-- is required because each outbox/inbox lives in its tenant schema. This is the
-- only O(tenants) pass; steady-state workers use the registry above.
DO $integration_work_backfill$
DECLARE
    tenant_record RECORD;
    has_outbox BOOLEAN;
    has_webhook BOOLEAN;
BEGIN
    FOR tenant_record IN
        SELECT "id", "schema_name" FROM "public"."tenants"
    LOOP
        has_outbox := FALSE;
        has_webhook := FALSE;

        IF to_regclass(format('%I.%I', tenant_record."schema_name", 'integration_outbox')) IS NOT NULL THEN
            EXECUTE format(
                'SELECT EXISTS (SELECT 1 FROM %I.integration_outbox LIMIT 1)',
                tenant_record."schema_name"
            ) INTO has_outbox;
        END IF;

        IF to_regclass(format('%I.%I', tenant_record."schema_name", 'integration_webhook_inbox')) IS NOT NULL THEN
            EXECUTE format(
                'SELECT EXISTS (SELECT 1 FROM %I.integration_webhook_inbox LIMIT 1)',
                tenant_record."schema_name"
            ) INTO has_webhook;
        END IF;

        IF has_outbox OR has_webhook THEN
            INSERT INTO "public"."integration_work_tenants" (
                "tenant_id", "schema_name", "outbox_seen_at", "webhook_seen_at"
            ) VALUES (
                tenant_record."id",
                tenant_record."schema_name",
                CASE WHEN has_outbox THEN NOW() ELSE NULL END,
                CASE WHEN has_webhook THEN NOW() ELSE NULL END
            )
            ON CONFLICT ("tenant_id") DO UPDATE SET
                "schema_name" = EXCLUDED."schema_name",
                "outbox_seen_at" = COALESCE(
                    "integration_work_tenants"."outbox_seen_at",
                    EXCLUDED."outbox_seen_at"
                ),
                "webhook_seen_at" = COALESCE(
                    "integration_work_tenants"."webhook_seen_at",
                    EXCLUDED."webhook_seen_at"
                ),
                "updated_at" = NOW();
        END IF;
    END LOOP;
END;
$integration_work_backfill$;
