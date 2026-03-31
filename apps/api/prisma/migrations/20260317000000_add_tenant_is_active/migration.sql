-- AlterTable: Add is_active column (snake_case) to tenants, users, channel_accounts
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."channel_accounts" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT true;

-- Drop old camelCase columns if they exist (from previous broken migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='isActive') THEN
    -- Copy data from old column to new if both exist
    UPDATE "public"."tenants" SET is_active = "isActive" WHERE is_active IS DISTINCT FROM "isActive";
    ALTER TABLE "public"."tenants" DROP COLUMN "isActive";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='isActive') THEN
    UPDATE "public"."users" SET is_active = "isActive" WHERE is_active IS DISTINCT FROM "isActive";
    ALTER TABLE "public"."users" DROP COLUMN "isActive";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='channel_accounts' AND column_name='isActive') THEN
    UPDATE "public"."channel_accounts" SET is_active = "isActive" WHERE is_active IS DISTINCT FROM "isActive";
    ALTER TABLE "public"."channel_accounts" DROP COLUMN "isActive";
  END IF;
END $$;
