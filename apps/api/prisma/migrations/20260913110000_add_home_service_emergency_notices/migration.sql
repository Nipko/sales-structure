-- One delivery authority per operator who must receive a home-service emergency.
-- The payload remains in the canonical request; the outbox stores only identities.
DO $home_service_emergency_notices$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT schema_name FROM public.tenants ORDER BY schema_name
    LOOP
        target := quote_ident(tenant_record.schema_name);
        CONTINUE WHEN to_regclass(target || '.operational_notice_outbox') IS NULL;

        EXECUTE format('ALTER TABLE %s.operational_notice_outbox ADD COLUMN IF NOT EXISTS recipient_user_id UUID', target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check', target);
        EXECUTE format(
            'ALTER TABLE %s.operational_notice_outbox ADD CONSTRAINT operational_notice_outbox_kind_check '
            || 'CHECK(kind IN (''appointment.payment_confirmed'',''appointment.payment_review'',''gym.waitlist_promoted'','
            || '''education.waitlist_promoted'',''education.waitlist_review'',''home_service.emergency'')) NOT VALID', target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox VALIDATE CONSTRAINT operational_notice_outbox_kind_check', target);
    END LOOP;
END
$home_service_emergency_notices$;
