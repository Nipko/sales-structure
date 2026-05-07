-- Onboarding funnel tracking on the public.tenants table.
-- Columns are nullable so existing rows don't need a backfill — the
-- onboarding-funnel page treats NULL as 'not yet reached this stage'.
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" TIMESTAMPTZ;
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "first_message_at" TIMESTAMPTZ;
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "signup_source" TEXT;

-- Index used by the funnel aggregator's WHERE created_at >= ... filter
CREATE INDEX IF NOT EXISTS "idx_tenants_signup" ON "public"."tenants" ("created_at" DESC);
