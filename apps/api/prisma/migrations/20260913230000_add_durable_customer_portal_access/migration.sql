-- Portal access is both an authentication challenge and an external delivery.
-- Keep both facts in PostgreSQL so a process restart cannot lose the code, send
-- it twice, or turn an unknown provider outcome into a retry.
CREATE TABLE IF NOT EXISTS "customer_portal_access_challenges" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "contact_id" UUID NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipient_digest" VARCHAR(64) NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "language" VARCHAR(16) NOT NULL DEFAULT 'es',
    "state" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
    "verify_attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ,
    "provider_reference" TEXT,
    "error_code" TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "started_at" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "superseded_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "customer_portal_access_channel_check"
        CHECK ("channel" IN ('email', 'sms')),
    CONSTRAINT "customer_portal_access_code_check"
        CHECK ("code" ~ '^[0-9]{6}$'),
    CONSTRAINT "customer_portal_access_state_check"
        CHECK ("state" IN ('pending','claimed','sending','sent','failed','reconciliation_required','suppressed')),
    CONSTRAINT "customer_portal_access_attempts_check"
        CHECK ("delivery_attempts" >= 0 AND "verify_attempts" BETWEEN 0 AND 5),
    CONSTRAINT "customer_portal_access_lease_check"
        CHECK (("state" IN ('claimed','sending')) = ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
    CONSTRAINT "customer_portal_access_receipt_check"
        CHECK (("state" = 'sent') = ("provider_reference" IS NOT NULL AND "sent_at" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_portal_access_one_live_challenge"
    ON "customer_portal_access_challenges"("tenant_id", "channel", "recipient_digest")
    WHERE "consumed_at" IS NULL AND "superseded_at" IS NULL;

CREATE INDEX IF NOT EXISTS "customer_portal_access_due_idx"
    ON "customer_portal_access_challenges"("next_attempt_at", "created_at")
    WHERE "state" IN ('pending','failed');

CREATE INDEX IF NOT EXISTS "customer_portal_access_contact_idx"
    ON "customer_portal_access_challenges"("tenant_id", "contact_id", "created_at" DESC);
