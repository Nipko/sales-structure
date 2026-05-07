-- ============================================================
--  Parallext Engine — Delete a tenant completely
-- ============================================================
--  WHAT IT DOES
--  ------------
--  1. Resolves the tenant's real schema_name from the tenants
--     table (NOT the display name — those rarely match).
--  2. Deletes all rows in public-schema tables that reference
--     the tenant_id (FK-safe order: dependents first).
--  3. DROP SCHEMA <schema_name> CASCADE — wipes every per-tenant
--     table at once (conversations, contacts, leads, properties,
--     tour_packages, treatment_plans, real_estate_listings, etc.).
--  4. Removes the row in tenants itself.
--
--  USAGE
--  -----
--  Edit the `tid` UUID below, then pipe to psql:
--      docker exec -i parallext-postgres psql -U parallext \
--          -d parallext_engine < infra/scripts/delete-tenant.sql
--
--  Or copy-paste into psql directly. The script logs how many
--  rows it deleted from each table so you can verify.
--
--  AFTER RUNNING
--  -------------
--  Also flush Redis cache to drop stale tenant entries:
--      docker exec parallext-redis redis-cli --scan \
--          --pattern 'tenant:<tid>:*' | xargs -r \
--          docker exec -i parallext-redis redis-cli DEL
--      docker exec parallext-redis redis-cli DEL 'vertical:<tid>'
-- ============================================================

DO $$
DECLARE
    tid UUID := '0994a0ac-037b-4c41-bdb1-e8bb7fb2a756';   -- ← REPLACE THIS
    sname TEXT;
    tname TEXT;
    deleted_rows INT;
BEGIN
    -- 1. Resolve real schema_name from the tenants row.
    SELECT schema_name, name INTO sname, tname
    FROM tenants WHERE id = tid;

    IF sname IS NULL THEN
        RAISE EXCEPTION 'Tenant % not found in tenants table', tid;
    END IF;

    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE 'Eliminando tenant: % (id=%)', tname, tid;
    RAISE NOTICE 'Schema real a borrar: %', sname;
    RAISE NOTICE '═══════════════════════════════════════════';

    -- 2. Public-schema dependents (order matters — FKs).

    BEGIN
        DELETE FROM billing_events
        WHERE subscription_id IN (SELECT id FROM billing_subscriptions WHERE tenant_id = tid);
        GET DIAGNOSTICS deleted_rows = ROW_COUNT;
        RAISE NOTICE '  billing_events: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  billing_events: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM billing_payments WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  billing_payments: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  billing_payments: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM billing_subscriptions WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  billing_subscriptions: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  billing_subscriptions: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM audit_logs WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  audit_logs: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  audit_logs: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM channel_accounts WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  channel_accounts: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  channel_accounts: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM whatsapp_onboardings WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  whatsapp_onboardings: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  whatsapp_onboardings: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM whatsapp_credentials WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  whatsapp_credentials: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  whatsapp_credentials: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM tenant_financial_snapshots WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  tenant_financial_snapshots: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  tenant_financial_snapshots: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM crm_connections WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  crm_connections: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  crm_connections: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM feature_request_votes WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  feature_request_votes: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  feature_request_votes: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM feature_request_comments WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  feature_request_comments: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  feature_request_comments: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM feature_request_subscribers WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  feature_request_subscribers: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  feature_request_subscribers: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM feature_requests WHERE author_tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  feature_requests: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  feature_requests: skipped (%)', SQLERRM; END;

    BEGIN DELETE FROM users WHERE tenant_id = tid;
        GET DIAGNOSTICS deleted_rows = ROW_COUNT; RAISE NOTICE '  users: %', deleted_rows;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '  users: skipped (%)', SQLERRM; END;

    -- 3. Drop the tenant schema (cascades all per-tenant tables).
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', sname);
    RAISE NOTICE '  → DROP SCHEMA "%" CASCADE ejecutado', sname;

    -- 4. Finally remove the row in tenants itself.
    DELETE FROM tenants WHERE id = tid;
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    RAISE NOTICE '  tenants: %', deleted_rows;

    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE 'Tenant % eliminado por completo', tname;
    RAISE NOTICE '═══════════════════════════════════════════';
END $$;

-- Verification queries (run manually after the DO block above):
--
--   SELECT id, name, schema_name FROM tenants WHERE id = '0994a0ac-...';
--   -- expected: 0 rows
--
--   SELECT schema_name FROM information_schema.schemata
--   WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name;
--   -- expected: deleted schema is gone
