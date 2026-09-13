-- Billing notifications may target the tenant's explicit billing address,
-- which is deliberately independent from a dashboard user account.
ALTER TABLE "platform_notification_outbox"
    ADD COLUMN IF NOT EXISTS "tenant_id" UUID,
    ADD COLUMN IF NOT EXISTS "recipient_email" TEXT;

ALTER TABLE "platform_notification_outbox"
    ALTER COLUMN "recipient_user_id" DROP NOT NULL;

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_kind_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_kind_check"
    CHECK ("kind" IN ('feature_request.status_changed','billing.lifecycle_email'));

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_recipient_identity_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_recipient_identity_check" CHECK (
        ("recipient_user_id" IS NOT NULL AND "recipient_email" IS NULL)
        OR ("recipient_user_id" IS NULL AND "recipient_email" IS NOT NULL AND "tenant_id" IS NOT NULL)
    );

DO $$ BEGIN
    ALTER TABLE "platform_notification_outbox"
        ADD CONSTRAINT "platform_notification_outbox_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_platform_notification_tenant"
    ON "platform_notification_outbox" ("tenant_id", "created_at" DESC)
    WHERE "tenant_id" IS NOT NULL;

-- Null means a newly committed billing event still needs an outbox intent.
-- Mark existing history before enabling recovery so deployment never replays
-- months of old lifecycle mail.
ALTER TABLE IF EXISTS "billing_events"
    ADD COLUMN IF NOT EXISTS "notification_outbox_created_at" TIMESTAMPTZ;
DO $$ BEGIN
    IF to_regclass('public.billing_events') IS NOT NULL THEN
        UPDATE "billing_events"
        SET "notification_outbox_created_at" = NOW()
        WHERE "notification_outbox_created_at" IS NULL;
        CREATE INDEX IF NOT EXISTS "idx_billing_events_notification_pending"
            ON "billing_events" ("processed_at", "id")
            WHERE "notification_outbox_created_at" IS NULL;
    END IF;
END $$;
