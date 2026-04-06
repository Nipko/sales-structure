-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable: tenants
CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT NOT NULL DEFAULT 'general',
    "language" TEXT NOT NULL DEFAULT 'es-CO',
    "schema_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "public"."tenants"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_schema_name_key" ON "public"."tenants"("schema_name");

-- CreateTable: users
CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "first_name" TEXT NOT NULL DEFAULT '',
    "last_name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'tenant_agent',
    "tenant_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "public"."users"("email");
CREATE INDEX IF NOT EXISTS "users_tenant_id_idx" ON "public"."users"("tenant_id");

-- Generated column so raw SQL queries can reference u.name
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "name" TEXT
    GENERATED ALWAYS AS (TRIM("first_name" || ' ' || "last_name")) STORED;

ALTER TABLE "public"."users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: channel_accounts
CREATE TABLE IF NOT EXISTS "public"."channel_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "channel_type" VARCHAR(50) NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL DEFAULT '',
    "access_token" TEXT NOT NULL DEFAULT '',
    "refresh_token" TEXT,
    "webhook_secret" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_accounts_channel_type_account_id_key"
    ON "public"."channel_accounts"("channel_type", "account_id");
CREATE INDEX IF NOT EXISTS "channel_accounts_tenant_id_idx" ON "public"."channel_accounts"("tenant_id");

ALTER TABLE "public"."channel_accounts" ADD CONSTRAINT "channel_accounts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: audit_logs
CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT,
    "tenant_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_created_at_idx" ON "public"."audit_logs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "public"."audit_logs"("user_id");

-- CreateTable: whatsapp_onboardings
CREATE TABLE IF NOT EXISTS "public"."whatsapp_onboardings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'new',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "is_coexistence" BOOLEAN NOT NULL DEFAULT false,
    "coexistence_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "meta_business_id" TEXT,
    "waba_id" TEXT,
    "phone_number_id" TEXT,
    "display_phone_number" TEXT,
    "verified_name" TEXT,
    "exchange_payload" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_by_user_id" TEXT,
    "code_received_at" TIMESTAMPTZ,
    "exchange_completed_at" TIMESTAMPTZ,
    "assets_synced_at" TIMESTAMPTZ,
    "webhook_validated_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "whatsapp_onboardings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_onboardings_tenant_id_idx" ON "public"."whatsapp_onboardings"("tenant_id");
CREATE INDEX IF NOT EXISTS "whatsapp_onboardings_status_idx" ON "public"."whatsapp_onboardings"("status");

-- CreateTable: whatsapp_credentials
CREATE TABLE IF NOT EXISTS "public"."whatsapp_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "credential_type" TEXT NOT NULL DEFAULT 'system_user_token',
    "encrypted_value" TEXT NOT NULL DEFAULT '',
    "rotation_state" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "whatsapp_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_credentials_tenant_id_credential_type_idx"
    ON "public"."whatsapp_credentials"("tenant_id", "credential_type");

-- CreateTable: platform_settings
CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT UNIQUE NOT NULL,
    "value" TEXT,
    "is_secret" BOOLEAN DEFAULT false,
    "category" TEXT DEFAULT 'general',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
