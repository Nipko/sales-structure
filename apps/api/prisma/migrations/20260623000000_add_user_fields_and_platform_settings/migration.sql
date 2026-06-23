-- Canonicalizes public-schema objects that were previously patched via raw SQL
-- in .github/workflows/deploy.yml, so `prisma migrate deploy` ALONE produces a
-- complete public schema on a fresh database (no out-of-band raw SQL needed).
-- Every statement is idempotent (IF NOT EXISTS) -> a no-op on already-patched
-- production databases.

-- 1. User auth/profile columns (match prisma/schema.prisma User model).
--    Note: phone + job_title were never in the deploy.yml raw SQL, so on existing
--    databases these two are actually created here for the first time.
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "auth_provider" TEXT NOT NULL DEFAULT 'email',
    ADD COLUMN IF NOT EXISTS "google_id" TEXT,
    ADD COLUMN IF NOT EXISTS "microsoft_id" TEXT,
    ADD COLUMN IF NOT EXISTS "picture" TEXT,
    ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "email_verify_code" TEXT,
    ADD COLUMN IF NOT EXISTS "email_verify_expires" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "phone" TEXT,
    ADD COLUMN IF NOT EXISTS "job_title" TEXT,
    ADD COLUMN IF NOT EXISTS "availability_status" TEXT NOT NULL DEFAULT 'offline',
    ADD COLUMN IF NOT EXISTS "max_capacity" INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS "skill_tags" TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP(3);

-- password is optional (OAuth / social-login accounts have none).
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- 2. platform_settings (global key/value config, accessed via raw SQL).
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'general',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_key_key" ON "platform_settings" ("key");
