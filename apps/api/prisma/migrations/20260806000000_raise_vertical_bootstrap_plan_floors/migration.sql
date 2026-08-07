-- Canonical vertical defaults are system structure, but they still count toward
-- the same quotas enforced by CRUD endpoints. The largest canonical pipeline
-- has 7 stages and the largest appointment catalog has 4 services; keeping the
-- old 3/1 and 5/2 limits made a brand-new tenant exceed its own plan on day one.
--
-- State for the resumable bootstrap is intentionally stored in
-- public.tenants.settings.verticalProvisioning, so no tenant-schema migration
-- is required for provisioning metadata.
UPDATE "billing_plans"
SET "features" = jsonb_set(
    jsonb_set(COALESCE("features", '{}'::jsonb), '{pipelineStages}', '7'::jsonb, true),
    '{appointmentsServices}', '4'::jsonb, true
)
WHERE "slug" IN ('emprendedor', 'starter');
