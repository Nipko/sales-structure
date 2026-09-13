-- Invitation state and its outbound email intent must advance as one fact.
-- Existing invitations remain revision 0, so deploying this migration never
-- replays an old invitation or welcome email.
ALTER TABLE IF EXISTS "tenant_invitations"
    ADD COLUMN IF NOT EXISTS "notification_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS "tenant_invitations"
    DROP CONSTRAINT IF EXISTS "tenant_invitations_notification_revision_check";
ALTER TABLE IF EXISTS "tenant_invitations"
    ADD CONSTRAINT "tenant_invitations_notification_revision_check"
    CHECK ("notification_revision" >= 0);

ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_kind_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_kind_check"
    CHECK ("kind" IN (
        'feature_request.status_changed',
        'billing.lifecycle_email',
        'invitation.invite_email',
        'invitation.welcome_email'
    ));
