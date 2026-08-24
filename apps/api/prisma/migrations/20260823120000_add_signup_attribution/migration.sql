-- Signup occurs before a tenant exists. Keep that acquisition event on the
-- principal user so the first funnel transition measures real abandonment.
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "is_self_serve_signup" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "signup_source" TEXT,
  ADD COLUMN IF NOT EXISTS "signup_attribution" JSONB;

CREATE INDEX IF NOT EXISTS "idx_users_self_serve_signup_created"
  ON "public"."users" ("is_self_serve_signup", "created_at" DESC);

-- Recover historical self-serve principals only when the tenant already has
-- an explicit acquisition source. NULL is unknowable legacy data: proximity
-- in time is not enough to distinguish self-service from an admin-provisioned
-- tenant and must not manufacture funnel conversions.
WITH principals AS (
  SELECT
    u."id",
    t."signup_source",
    ROW_NUMBER() OVER (PARTITION BY t."id" ORDER BY u."created_at", u."id") AS rn
  FROM "public"."users" u
  JOIN "public"."tenants" t ON t."id" = u."tenant_id"
  WHERE u."role" = 'tenant_admin'
    AND t."signup_source" IS NOT NULL
    AND t."signup_source" <> 'super_admin'
    AND ABS(EXTRACT(EPOCH FROM (u."created_at" - t."created_at"))) <= 600
)
UPDATE "public"."users" u
SET
  "is_self_serve_signup" = TRUE,
  "signup_source" = COALESCE(p."signup_source", 'legacy_unknown')
FROM principals p
WHERE u."id" = p."id" AND p.rn = 1;
