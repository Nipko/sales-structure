-- AlterTable: tenants — add billing denormalized fields
ALTER TABLE "public"."tenants"
    ADD COLUMN IF NOT EXISTS "billing_email" TEXT,
    ADD COLUMN IF NOT EXISTS "billing_country" TEXT,
    ADD COLUMN IF NOT EXISTS "subscription_status" TEXT,
    ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "current_period_end" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "payment_provider" TEXT,
    ADD COLUMN IF NOT EXISTS "payment_provider_customer_id" TEXT;

-- CreateTable: billing_plans
CREATE TABLE IF NOT EXISTS "public"."billing_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_usd_cents" INTEGER NOT NULL,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "requires_card_for_trial" BOOLEAN NOT NULL DEFAULT false,
    "max_agents" INTEGER NOT NULL,
    "max_ai_messages" INTEGER NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "mp_plan_id" TEXT,
    "stripe_plan_id" TEXT,
    "price_local_overrides" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_slug_key" ON "public"."billing_plans"("slug");

-- CreateTable: billing_subscriptions
CREATE TABLE IF NOT EXISTS "public"."billing_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subscription_id" TEXT,
    "provider_customer_id" TEXT,
    "trial_started_at" TIMESTAMPTZ,
    "trial_ends_at" TIMESTAMPTZ,
    "current_period_start" TIMESTAMPTZ,
    "current_period_end" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_tenant_id_key" ON "public"."billing_subscriptions"("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_provider_subscription_id_key" ON "public"."billing_subscriptions"("provider_subscription_id");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_status_idx" ON "public"."billing_subscriptions"("status");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_trial_ends_at_idx" ON "public"."billing_subscriptions"("trial_ends_at");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_current_period_end_idx" ON "public"."billing_subscriptions"("current_period_end");

ALTER TABLE "public"."billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: billing_events
-- Append-only log + idempotency store: (provider, provider_event_id) is unique
-- so a webhook redelivery gets skipped on the second processing attempt.
CREATE TABLE IF NOT EXISTS "public"."billing_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "subscription_id" UUID,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_provider_provider_event_id_key" ON "public"."billing_events"("provider", "provider_event_id");
CREATE INDEX IF NOT EXISTS "billing_events_tenant_id_processed_at_idx" ON "public"."billing_events"("tenant_id", "processed_at");
CREATE INDEX IF NOT EXISTS "billing_events_event_type_idx" ON "public"."billing_events"("event_type");

ALTER TABLE "public"."billing_events" ADD CONSTRAINT "billing_events_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: billing_payments
CREATE TABLE IF NOT EXISTS "public"."billing_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "paid_at" TIMESTAMPTZ,
    "failure_reason" TEXT,
    "invoice_number" TEXT,
    "invoice_pdf_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_payments_provider_payment_id_key" ON "public"."billing_payments"("provider_payment_id");
CREATE INDEX IF NOT EXISTS "billing_payments_tenant_id_created_at_idx" ON "public"."billing_payments"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "billing_payments_status_idx" ON "public"."billing_payments"("status");

ALTER TABLE "public"."billing_payments" ADD CONSTRAINT "billing_payments_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
