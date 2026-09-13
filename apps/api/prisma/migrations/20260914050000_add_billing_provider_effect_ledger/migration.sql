CREATE TABLE IF NOT EXISTS "billing_provider_effects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "effect_key" TEXT NOT NULL,
    "effect_type" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "provider_resource_id" TEXT,
    "local_resource_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "billing_provider_effects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_provider_effects_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "billing_provider_effect_type_check"
        CHECK ("effect_type" IN ('payment_source_create', 'payment_source_void')),
    CONSTRAINT "billing_provider_effect_state_check"
        CHECK ("state" IN ('sending', 'accepted', 'rejected', 'unknown')),
    CONSTRAINT "billing_provider_effect_attempts_check" CHECK ("attempts" >= 1),
    CONSTRAINT "billing_provider_effect_lease_check" CHECK (
        ("state" = 'sending') = ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_effects_effect_key_key"
    ON "billing_provider_effects"("effect_key");
CREATE INDEX IF NOT EXISTS "billing_provider_effects_tenant_state_idx"
    ON "billing_provider_effects"("tenant_id", "state");
CREATE INDEX IF NOT EXISTS "billing_provider_effects_state_lease_idx"
    ON "billing_provider_effects"("state", "lease_expires_at");
