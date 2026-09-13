-- Appointment Slack delivery is an operational effect. Admit it in the same
-- transaction that creates the appointment, then let the existing durable
-- notice worker perform the remote webhook call.
DO $appointment_slack_notice$
DECLARE tenant_record RECORD; target TEXT;
BEGIN
    FOR tenant_record IN SELECT schema_name FROM public.tenants WHERE schema_name ~ '^tenant_[a-z0-9_]+$'
    LOOP
        target := format('%I.operational_notice_outbox', tenant_record.schema_name);
        IF to_regclass(target) IS NULL THEN CONTINUE; END IF;
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check', target);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT operational_notice_outbox_kind_check CHECK(kind IN ('
            || '''appointment.payment_confirmed'',''appointment.payment_review'',''appointment.operator_slack'', '
            || '''gym.waitlist_promoted'',''education.waitlist_promoted'',''education.waitlist_review'', '
            || '''home_service.emergency'',''tour.booking_confirmed'',''property.booking_confirmed'', '
            || '''order.confirmed'',''handoff.sla_escalated'')) NOT VALID', target);
        EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT operational_notice_outbox_kind_check', target);
    END LOOP;
END $appointment_slack_notice$;
