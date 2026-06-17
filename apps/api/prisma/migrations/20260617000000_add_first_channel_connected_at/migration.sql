-- TTFV (time-to-first-value): timestamp of the tenant's FIRST channel connection.
-- Nullable so existing rows don't need a backfill — the onboarding funnel treats
-- NULL as 'no channel connected yet'. Set idempotently on first channel connect
-- (WHERE first_channel_connected_at IS NULL), so it survives later disconnects.
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "first_channel_connected_at" TIMESTAMPTZ;
