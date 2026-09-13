DO $gbp_reply_effects$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN SELECT schema_name FROM public.tenants ORDER BY schema_name LOOP
        target := quote_ident(tenant_record.schema_name);
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.schemata
            WHERE schema_name=tenant_record.schema_name);
        CONTINUE WHEN to_regclass(target || '.gbp_reviews') IS NULL;
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s.gbp_reply_effects (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_key TEXT UNIQUE NOT NULL,
                review_id UUID NOT NULL REFERENCES %s.gbp_reviews(id) ON DELETE CASCADE,
                desired_comment TEXT NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL,
                state VARCHAR(24) NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','sending','accepted','rejected','unknown','failed')),
                attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
                lease_token UUID,
                lease_expires_at TIMESTAMPTZ,
                provider_reference TEXT,
                error_code TEXT,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CHECK ((state='sending' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
                    OR (state<>'sending' AND lease_token IS NULL AND lease_expires_at IS NULL))
            )
        $ddl$, target, target);
        EXECUTE format($index$
            CREATE INDEX IF NOT EXISTS idx_gbp_reply_effects_due
                ON %s.gbp_reply_effects(state,created_at)
                WHERE state IN ('pending','unknown','failed')
        $index$, target);
    END LOOP;
END
$gbp_reply_effects$;
