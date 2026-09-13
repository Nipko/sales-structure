ALTER TABLE "platform_notification_outbox"
    DROP CONSTRAINT IF EXISTS "platform_notification_outbox_kind_check";
ALTER TABLE "platform_notification_outbox"
    ADD CONSTRAINT "platform_notification_outbox_kind_check" CHECK ("kind" IN (
        'feature_request.status_changed','billing.lifecycle_email','invitation.invite_email',
        'invitation.welcome_email','auth.access_code_email','auth.security_notice_email',
        'auth.access_code_sms','meta_compliance.request_email','email_template.test_send'
    ));
