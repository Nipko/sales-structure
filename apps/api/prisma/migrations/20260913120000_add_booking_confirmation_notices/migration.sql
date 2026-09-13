-- Extend the durable operational-notice authority to tour and lodging confirmations.
DO $booking_confirmation_notices$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN SELECT schema_name FROM public.tenants ORDER BY schema_name
    LOOP
        target := quote_ident(tenant_record.schema_name);
        CONTINUE WHEN NOT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=tenant_record.schema_name);
        EXECUTE format('CREATE TABLE IF NOT EXISTS %s.operational_notice_outbox(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_key VARCHAR(200) NOT NULL UNIQUE,
            kind VARCHAR(60) NOT NULL,entity_id UUID NOT NULL,contact_id UUID,conversation_id UUID,
            recipient_user_id UUID,state VARCHAR(40) NOT NULL DEFAULT ''pending'' CHECK(state IN
                (''pending'',''queued'',''processing'',''sent'',''stored'',''failed'',''suppressed'',''reconciliation_required'')),
            route VARCHAR(30),provider_reference VARCHAR(512),attempts INTEGER NOT NULL DEFAULT 0,
            lease_token UUID,lease_expires_at TIMESTAMPTZ,started_at TIMESTAMPTZ,
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),error_code VARCHAR(100),completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox ADD COLUMN IF NOT EXISTS recipient_user_id UUID',target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check',target);
        EXECUTE format(
            'ALTER TABLE %s.operational_notice_outbox ADD CONSTRAINT operational_notice_outbox_kind_check '
            || 'CHECK(kind IN (''appointment.payment_confirmed'',''appointment.payment_review'',''gym.waitlist_promoted'','
            || '''education.waitlist_promoted'',''education.waitlist_review'',''home_service.emergency'','
            || '''tour.booking_confirmed'',''property.booking_confirmed'')) NOT VALID',target);
        EXECUTE format('ALTER TABLE %s.operational_notice_outbox VALIDATE CONSTRAINT operational_notice_outbox_kind_check',target);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_operational_notice_due ON %s.operational_notice_outbox(state,next_attempt_at) WHERE state IN (''pending'',''queued'',''failed'')',target);
        IF to_regclass(target || '.property_bookings') IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %s.property_bookings ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT ''es''',target);
        END IF;
    END LOOP;
END
$booking_confirmation_notices$;
