-- Tenant-owned customer payment links are a separate commercial capability
-- from ecommerce. Existing billing plan rows are authoritative, so backfill
-- only a missing key and preserve every explicit super-admin decision.
UPDATE "public"."billing_plans"
SET "features" = jsonb_set(
    COALESCE("features", '{}'::jsonb),
    '{customerPayments}',
    CASE
        WHEN "slug" IN ('pro', 'enterprise', 'custom') THEN 'true'::jsonb
        ELSE 'false'::jsonb
    END,
    true
)
WHERE "slug" IN ('emprendedor', 'starter', 'pro', 'enterprise', 'custom')
  AND NOT (COALESCE("features", '{}'::jsonb) ? 'customerPayments');
