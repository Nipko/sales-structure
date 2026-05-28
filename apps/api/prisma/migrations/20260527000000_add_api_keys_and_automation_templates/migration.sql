-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "key_prefix" VARCHAR(12) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_rpm" INTEGER NOT NULL DEFAULT 60,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."automation_templates" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" JSONB NOT NULL,
    "description" JSONB,
    "category" VARCHAR(100) NOT NULL,
    "industry" VARCHAR(100),
    "icon" VARCHAR(50),
    "trigger_config" JSONB NOT NULL,
    "actions_config" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "popularity_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_key" ON "public"."api_keys"("key_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_api_keys_tenant" ON "public"."api_keys"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_api_keys_prefix" ON "public"."api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_automation_templates_category" ON "public"."automation_templates"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_automation_templates_industry" ON "public"."automation_templates"("industry");
