-- Access codes are authoritative database state before SMTP is admitted. A
-- revision prevents an older delivery from carrying a newly generated code.
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "email_challenge_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "two_factor_email_code" TEXT,
    ADD COLUMN IF NOT EXISTS "two_factor_email_expires" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "two_factor_email_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
    DROP CONSTRAINT IF EXISTS "users_email_challenge_revision_check";
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_challenge_revision_check"
    CHECK ("email_challenge_revision" >= 0 AND "two_factor_email_revision" >= 0);

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_kind_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_kind_check"
    CHECK ("kind" IN (
        'feature_request.status_changed',
        'billing.lifecycle_email',
        'invitation.invite_email',
        'invitation.welcome_email',
        'auth.access_code_email'
    ));
