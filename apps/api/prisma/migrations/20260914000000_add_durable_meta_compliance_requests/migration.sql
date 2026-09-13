-- Meta callbacks acknowledge a legal request. The request and the notification
-- that puts it in front of the compliance operator must be one durable fact.
CREATE TABLE IF NOT EXISTS "meta_compliance_requests" (
    "code" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "request_key" VARCHAR(160) NOT NULL UNIQUE,
    "source" VARCHAR(24) NOT NULL,
    "fb_user_id" TEXT,
    "email" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "processed_at" TIMESTAMPTZ,
    "status" VARCHAR(16) NOT NULL DEFAULT 'received',
    "notes" TEXT,
    "retention_until" TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '90 days',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "meta_compliance_source_check" CHECK ("source" IN ('meta_callback','user_request')),
    CONSTRAINT "meta_compliance_status_check" CHECK ("status" IN ('received','processing','completed','rejected')),
    CONSTRAINT "meta_compliance_identity_check" CHECK (
        ("source"='meta_callback' AND "fb_user_id" IS NOT NULL AND "email" IS NULL)
        OR ("source"='user_request' AND "email" IS NOT NULL AND "fb_user_id" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "meta_compliance_retention_idx"
    ON "meta_compliance_requests"("retention_until");

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_kind_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_kind_check"
    CHECK ("kind" IN (
        'feature_request.status_changed',
        'billing.lifecycle_email',
        'invitation.invite_email',
        'invitation.welcome_email',
        'auth.access_code_email',
        'auth.security_notice_email',
        'meta_compliance.request_email'
    ));

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_recipient_identity_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_recipient_identity_check" CHECK (
        ("recipient_user_id" IS NOT NULL AND "recipient_email" IS NULL)
        OR ("recipient_user_id" IS NULL AND "recipient_email" IS NOT NULL AND "tenant_id" IS NOT NULL)
        OR ("kind"='meta_compliance.request_email' AND "recipient_user_id" IS NULL
            AND "recipient_email" IS NOT NULL AND "tenant_id" IS NULL)
    );
