ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "two_factor_sms_code" VARCHAR(6),
    ADD COLUMN IF NOT EXISTS "two_factor_sms_expires" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "two_factor_sms_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_two_factor_sms_code_check";
ALTER TABLE "users" ADD CONSTRAINT "users_two_factor_sms_code_check" CHECK (
    "two_factor_sms_code" IS NULL OR "two_factor_sms_code" ~ '^[0-9]{6}$');
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_two_factor_sms_revision_check";
ALTER TABLE "users" ADD CONSTRAINT "users_two_factor_sms_revision_check" CHECK (
    "two_factor_sms_revision">=0);

ALTER TABLE "platform_notification_outbox"
    ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT;

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_kind_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_kind_check" CHECK ("kind" IN (
        'feature_request.status_changed','billing.lifecycle_email','invitation.invite_email',
        'invitation.welcome_email','auth.access_code_email','auth.security_notice_email',
        'auth.access_code_sms','meta_compliance.request_email'
    ));

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_recipient_identity_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_recipient_identity_check" CHECK (
        ("recipient_user_id" IS NOT NULL AND "recipient_email" IS NULL AND "recipient_phone" IS NULL)
        OR ("kind"='auth.access_code_sms' AND "recipient_user_id" IS NOT NULL
            AND "recipient_email" IS NULL AND "recipient_phone" IS NOT NULL)
        OR ("recipient_user_id" IS NULL AND "recipient_email" IS NOT NULL
            AND "recipient_phone" IS NULL AND "tenant_id" IS NOT NULL)
        OR ("kind"='meta_compliance.request_email' AND "recipient_user_id" IS NULL
            AND "recipient_email" IS NOT NULL AND "recipient_phone" IS NULL AND "tenant_id" IS NULL)
    );
