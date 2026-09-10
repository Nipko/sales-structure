-- El ejecutor de certificación y el arnés de benchmark necesitan sus tablas en
-- los tenants que ya existen. Enteramente ADITIVA: CREATE TABLE / CREATE INDEX
-- con IF NOT EXISTS y ni una fila escrita, así que el código viejo la ignora
-- durante el rolling restart, que es lo que exige expand-contract.
--
-- SQL dinámico porque las tablas viven en el schema de cada tenant.
DO $agent_certification_backfill$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        -- Un schema nombrado en `tenants` que ya no existe no detiene al resto.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_certification_runs" (
                        id UUID PRIMARY KEY,
                        plan_hash TEXT NOT NULL,
                        request_key TEXT UNIQUE,
                        agent_id UUID NOT NULL,
                        config_hash TEXT NOT NULL,
                        dependency_revision TEXT NOT NULL,
                        k INTEGER NOT NULL,
                        threshold NUMERIC NOT NULL,
                        state TEXT NOT NULL,
                        mode TEXT NOT NULL DEFAULT 'live',
                        stop_reason TEXT,
                        budget_usd_cents INTEGER,
                        deadline_at TIMESTAMPTZ,
                        planned_cases INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT agent_certification_runs_state
                            CHECK (state IN ('planned','running','paused','finished','cancelled')),
                        CONSTRAINT agent_certification_runs_mode CHECK (mode IN ('dry_run','live')),
                        CONSTRAINT agent_certification_runs_k CHECK (k >= 1 AND k <= 5),
                        CONSTRAINT agent_certification_runs_threshold CHECK (threshold >= 7 AND threshold <= 10)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_certification_subjects" (
                        run_id UUID NOT NULL,
                        profile_id TEXT NOT NULL,
                        agent_id UUID NOT NULL,
                        config_hash TEXT NOT NULL,
                        dependency_revision TEXT NOT NULL,
                        mission JSONB,
                        tool_grants JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (run_id, profile_id)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_certification_cases" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        run_id UUID NOT NULL,
                        case_key TEXT NOT NULL,
                        attempt INTEGER NOT NULL DEFAULT 1,
                        profile_id TEXT NOT NULL,
                        scenario_key TEXT NOT NULL,
                        language TEXT NOT NULL,
                        channel_type TEXT NOT NULL,
                        model TEXT NOT NULL,
                        definition_hash TEXT NOT NULL,
                        reserve_usd_cents INTEGER NOT NULL DEFAULT 0,
                        state TEXT NOT NULL DEFAULT 'pending',
                        lease_token UUID,
                        lease_expires_at TIMESTAMPTZ,
                        served_model TEXT,
                        cost_usd_cents INTEGER,
                        latency_ms INTEGER,
                        transcript JSONB,
                        tools JSONB,
                        verification JSONB,
                        scenario JSONB,
                        error_code TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT agent_certification_cases_state
                            CHECK (state IN ('pending','leased','passed','failed','error')),
                        CONSTRAINT agent_certification_cases_attempt CHECK (attempt >= 1)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_certification_case_attempt
                        ON %s."agent_certification_cases" (run_id, case_key, attempt)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_certification_case_claimable
                        ON %s."agent_certification_cases" (run_id, state, lease_expires_at)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."benchmark_attempts" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        corpus_id TEXT NOT NULL,
                        corpus_hash TEXT NOT NULL,
                        subject_id TEXT NOT NULL,
                        task_key TEXT NOT NULL,
                        run_index INTEGER NOT NULL DEFAULT 1,
                        confirmed BOOLEAN,
                        cost_usd_cents INTEGER,
                        latency_ms INTEGER,
                        transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
                        error TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT benchmark_attempts_run CHECK (run_index >= 1)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_benchmark_attempt
                        ON %s."benchmark_attempts" (corpus_hash, subject_id, task_key, run_index)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."benchmark_reviews" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        corpus_hash TEXT NOT NULL,
                        task_key TEXT NOT NULL,
                        blind_label TEXT NOT NULL,
                        reviewer_id TEXT NOT NULL,
                        score NUMERIC NOT NULL,
                        notes TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT benchmark_reviews_score CHECK (score >= 0 AND score <= 10)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_benchmark_review
                        ON %s."benchmark_reviews" (corpus_hash, task_key, blind_label, reviewer_id)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."commitment_proposals" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        proposal_hash TEXT NOT NULL,
                        family TEXT NOT NULL,
                        action TEXT NOT NULL,
                        contact_id UUID NOT NULL,
                        conversation_id UUID,
                        inbound_message_id UUID,
                        idempotency_key TEXT,
                        proposal JSONB NOT NULL,
                        amount_cents NUMERIC,
                        currency TEXT,
                        accepted_at TIMESTAMPTZ,
                        consumed_entity_id UUID,
                        consumed_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT commitment_proposals_action
                            CHECK (action IN ('create','cancel','reschedule','quote','approve','update'))
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_commitment_proposal_key
                        ON %s."commitment_proposals" (idempotency_key) WHERE idempotency_key IS NOT NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_commitment_proposal_entity
                        ON %s."commitment_proposals" (consumed_entity_id) WHERE consumed_entity_id IS NOT NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_commitment_proposal_contact
                        ON %s."commitment_proposals" (contact_id)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."outbound_payloads" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        tenant_id UUID NOT NULL,
                        channel_type TEXT NOT NULL,
                        contact_id UUID,
                        conversation_id UUID,
                        release_ids TEXT[] NOT NULL DEFAULT '{}',
                        dedupe_id TEXT,
                        payload JSONB,
                        redacted_at TIMESTAMPTZ,
                        redacted_reason TEXT,
                        sent_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT outbound_payloads_reason
                            CHECK (redacted_reason IS NULL OR redacted_reason IN ('retraction','erasure','delivered'))
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_outbound_payload_dedupe
                        ON %s."outbound_payloads" (tenant_id, dedupe_id) WHERE dedupe_id IS NOT NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_outbound_payload_contact
                        ON %s."outbound_payloads" (contact_id) WHERE payload IS NOT NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_outbound_payload_release
                        ON %s."outbound_payloads" USING GIN (release_ids) WHERE payload IS NOT NULL
        $ddl$, target);
    END LOOP;
END
$agent_certification_backfill$;
