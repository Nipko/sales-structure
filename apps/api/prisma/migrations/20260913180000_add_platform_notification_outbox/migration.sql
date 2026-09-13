-- Durable platform-owned notifications. Unlike tenant operational notices,
-- these facts live in public tables and may address users from many tenants.
ALTER TABLE IF EXISTS "feature_requests"
    ADD COLUMN IF NOT EXISTS "status_revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "platform_notification_outbox" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "event_key" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "entity_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "state" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ,
    "provider_reference" TEXT,
    "error_code" TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "platform_notification_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_notification_outbox_event_key_key" UNIQUE ("event_key"),
    CONSTRAINT "platform_notification_outbox_kind_check"
        CHECK ("kind" IN ('feature_request.status_changed')),
    CONSTRAINT "platform_notification_outbox_state_check"
        CHECK ("state" IN ('pending','claimed','sending','sent','failed','reconciliation_required','suppressed')),
    CONSTRAINT "platform_notification_outbox_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "platform_notification_outbox_lease_check" CHECK (
        ("state" IN ('claimed','sending') AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
        OR ("state" NOT IN ('claimed','sending') AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
    ),
    CONSTRAINT "platform_notification_outbox_recipient_fkey"
        FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_platform_notification_due"
    ON "platform_notification_outbox" ("state", "next_attempt_at", "created_at")
    WHERE "state" IN ('pending','failed');

CREATE INDEX IF NOT EXISTS "idx_platform_notification_recipient"
    ON "platform_notification_outbox" ("recipient_user_id", "created_at" DESC);
