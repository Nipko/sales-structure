-- AlterTable
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
