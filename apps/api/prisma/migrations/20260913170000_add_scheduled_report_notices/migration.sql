-- A report with several recipients is one business run and several SMTP
-- effects. Track each effect independently so a partial provider failure cannot
-- resend the recipients that already accepted it.
DO $scheduled_report_notices$
DECLARE tenant_record RECORD; outbox_target TEXT; report_target TEXT;
BEGIN
    FOR tenant_record IN SELECT schema_name FROM public.tenants WHERE schema_name ~ '^tenant_[a-z0-9_]+$'
    LOOP
        outbox_target := format('%I.operational_notice_outbox', tenant_record.schema_name);
        report_target := format('%I.scheduled_reports', tenant_record.schema_name);
        IF to_regclass(report_target) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS last_enqueued_at TIMESTAMPTZ', report_target);
        END IF;
        IF to_regclass(outbox_target) IS NULL THEN CONTINUE; END IF;
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check', outbox_target);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT operational_notice_outbox_kind_check CHECK(kind IN ('
            || '''appointment.payment_confirmed'',''appointment.payment_review'',''appointment.operator_slack'', '
            || '''analytics.threshold_alert'',''analytics.scheduled_report'',''gym.waitlist_promoted'', '
            || '''education.waitlist_promoted'',''education.waitlist_review'',''home_service.emergency'', '
            || '''tour.booking_confirmed'',''property.booking_confirmed'',''order.confirmed'', '
            || '''handoff.sla_escalated'')) NOT VALID', outbox_target);
        EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT operational_notice_outbox_kind_check', outbox_target);
    END LOOP;
END $scheduled_report_notices$;
