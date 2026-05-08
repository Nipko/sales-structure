-- Pending plan change: stores the next-period plan target when a tenant
-- downgrades. Applied automatically by the daily billing cron when
-- pending_plan_change_at <= now().

ALTER TABLE "billing_subscriptions"
    ADD COLUMN IF NOT EXISTS "pending_plan_id" TEXT,
    ADD COLUMN IF NOT EXISTS "pending_plan_change_at" TIMESTAMP(3);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'billing_subscriptions_pending_plan_id_fkey'
    ) THEN
        ALTER TABLE "billing_subscriptions"
            ADD CONSTRAINT "billing_subscriptions_pending_plan_id_fkey"
            FOREIGN KEY ("pending_plan_id") REFERENCES "billing_plans"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "billing_subscriptions_pending_plan_change_at_idx"
    ON "billing_subscriptions"("pending_plan_change_at")
    WHERE "pending_plan_change_at" IS NOT NULL;
