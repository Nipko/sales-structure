-- Bind each analytics threshold email to the history row that triggered it.
-- Payload and recipient are frozen because alert rules remain editable while a
-- provider attempt is waiting in the durable lane.
DO $analytics_alert_notices$
DECLARE tenant_record RECORD; target TEXT;
BEGIN
    FOR tenant_record IN SELECT schema_name FROM public.tenants WHERE schema_name ~ '^tenant_[a-z0-9_]+$'
    LOOP
        target := format('%I.operational_notice_outbox', tenant_record.schema_name);
        IF to_regclass(target) IS NULL THEN CONTINUE; END IF;
        EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS recipient_email TEXT', target);
        EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS payload JSONB', target);
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check', target);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT operational_notice_outbox_kind_check CHECK(kind IN ('
            || '''appointment.payment_confirmed'',''appointment.payment_review'',''appointment.operator_slack'', '
            || '''analytics.threshold_alert'',''gym.waitlist_promoted'',''education.waitlist_promoted'', '
            || '''education.waitlist_review'',''home_service.emergency'',''tour.booking_confirmed'', '
            || '''property.booking_confirmed'',''order.confirmed'',''handoff.sla_escalated'')) NOT VALID', target);
        EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT operational_notice_outbox_kind_check', target);
    END LOOP;
END $analytics_alert_notices$;
