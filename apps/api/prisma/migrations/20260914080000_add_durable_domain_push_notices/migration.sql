DO $domain_push_notices$
DECLARE tenant_record RECORD; target TEXT;
BEGIN
    FOR tenant_record IN SELECT schema_name FROM public.tenants ORDER BY schema_name LOOP
        target := quote_ident(tenant_record.schema_name);
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.schemata
            WHERE schema_name=tenant_record.schema_name);
        CONTINUE WHEN to_regclass(target || '.operational_notice_outbox') IS NULL;
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check', target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox ADD CONSTRAINT operational_notice_outbox_kind_check CHECK(kind IN ('
            || '''appointment.payment_confirmed'',''appointment.payment_review'',''appointment.operator_slack'',''analytics.threshold_alert'',''analytics.scheduled_report'','
            || '''gym.waitlist_promoted'',''education.waitlist_promoted'',''education.waitlist_review'',''home_service.emergency'','
            || '''tour.booking_confirmed'',''property.booking_confirmed'',''order.confirmed'',''handoff.sla_escalated'',''push.domain_event'')) NOT VALID', target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox VALIDATE CONSTRAINT operational_notice_outbox_kind_check', target);
    END LOOP;
END
$domain_push_notices$;
