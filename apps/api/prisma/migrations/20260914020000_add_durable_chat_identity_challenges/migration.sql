CREATE TABLE IF NOT EXISTS "chat_identity_challenges" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipient_digest" VARCHAR(64) NOT NULL,
    "hint" TEXT NOT NULL,
    "code" VARCHAR(6),
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
    "verified_at" TIMESTAMPTZ,
    "verified_expires_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "chat_identity_channel_check" CHECK ("channel" IN ('email','sms')),
    CONSTRAINT "chat_identity_code_check" CHECK ("code" IS NULL OR "code" ~ '^[0-9]{6}$'),
    CONSTRAINT "chat_identity_state_check" CHECK (
        "state" IN ('pending','claimed','sending','sent','failed','reconciliation_required','suppressed')),
    CONSTRAINT "chat_identity_attempts_check" CHECK ("delivery_attempts">=0 AND "verify_attempts">=0),
    CONSTRAINT "chat_identity_lease_check" CHECK (
        ("state" IN ('claimed','sending')) =
        ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
    CONSTRAINT "chat_identity_receipt_check" CHECK (
        "state"<>'sent' OR ("provider_reference" IS NOT NULL AND "sent_at" IS NOT NULL)),
    CONSTRAINT "chat_identity_verification_check" CHECK (
        ("verified_at" IS NULL AND "verified_expires_at" IS NULL)
        OR ("verified_at" IS NOT NULL AND "verified_expires_at">"verified_at"))
);

CREATE INDEX IF NOT EXISTS "chat_identity_conversation_idx"
    ON "chat_identity_challenges"("conversation_id","created_at" DESC);
CREATE INDEX IF NOT EXISTS "chat_identity_due_idx"
    ON "chat_identity_challenges"("next_attempt_at","created_at")
    WHERE "state" IN ('pending','failed');
CREATE INDEX IF NOT EXISTS "chat_identity_contact_idx"
    ON "chat_identity_challenges"("tenant_id","contact_id");
