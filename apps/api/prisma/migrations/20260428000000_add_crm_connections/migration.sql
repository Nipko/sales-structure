-- External CRM connections — per-tenant OAuth state
CREATE TABLE "crm_connections" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "external_account_id" TEXT,
    "external_account_name" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sync_mode" TEXT NOT NULL DEFAULT 'outbound',
    "last_sync_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_connections_tenant_provider_key" ON "crm_connections"("tenant_id", "provider");
CREATE INDEX "crm_connections_tenant_idx" ON "crm_connections"("tenant_id");
CREATE INDEX "crm_connections_status_idx" ON "crm_connections"("status");

-- Tenant-scoped tables are created lazily by the service on first sync via
-- ensureTenantCrmTables() because schemas are per-tenant. The DDL is mirrored
-- in tenant-schema.sql so newly-created tenants get them automatically.
