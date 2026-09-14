#!/usr/bin/env node
'use strict';

/**
 * One-time production bootstrap for the nine legacy appointment fixtures that
 * the 2026-09-13 agreed-terms preflight found. The operator confirmed that all
 * nine are test data. This script never creates an agreement or changes money.
 * It moves only the exact, pre-declared appointments from pending to cancelled.
 *
 * Safety properties:
 *   - dry-run unless the exact apply flag is present;
 *   - every id must exist exactly once across tenant schemas;
 *   - each unresolved row must still be pending, match its observed creation
 *     timestamp, and still fail the runtime's canonical agreed-terms predicate;
 *   - known tenant ownership is checked where GitHub did not mask the id;
 *   - all row locks, updates and audit entries share one SERIALIZABLE transaction;
 *   - a prior successful run is accepted only when our exact reason is stored.
 *
 * Usage in the candidate API image:
 *   node scripts/remediate-agreed-terms-test-fixtures.cjs --apply-authorized-test-fixtures
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APPLY_FLAG = '--apply-authorized-test-fixtures';
const CANCELLATION_REASON = 'production_readiness_test_fixture_2026_09_13';
const AUDIT_ACTION = 'deployment.agreed_terms_test_fixture_cancelled';
const ADVISORY_LOCK = 'parallly:agreed-terms-test-fixtures:2026-09-13';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The ids and non-personal observations printed by deploy run 34792674974.
 * null tenantId means GitHub masked part of that tenant id in its log. Exact id,
 * creation timestamp and state still make the appointment identity unambiguous.
 */
const AUTHORIZED_FIXTURES = Object.freeze([
    Object.freeze({ id: 'f3f210fd-55a1-4bd3-944d-a9c0f49b565b', tenantId: '3e8ad32e-a16b-42e6-9634-b8e8cc29292d', createdAt: '2026-05-21T04:09:27.000Z' }),
    Object.freeze({ id: 'ab40198b-e47f-43f6-b479-dc07a70a11cb', tenantId: '0633374a-4700-4c72-9b52-cd0cb2730a7a', createdAt: '2026-05-28T06:37:45.000Z' }),
    Object.freeze({ id: '90f5d2bb-78fc-4e40-831c-de9c8e52e3f6', tenantId: '0633374a-4700-4c72-9b52-cd0cb2730a7a', createdAt: '2026-05-26T04:17:02.000Z' }),
    Object.freeze({ id: '33dbd9a1-5672-4410-8b6f-a844e995a0bb', tenantId: '0633374a-4700-4c72-9b52-cd0cb2730a7a', createdAt: '2026-05-26T04:16:20.000Z' }),
    Object.freeze({ id: '6eba1ada-9f12-41bd-bc87-c633c232afb2', tenantId: '0633374a-4700-4c72-9b52-cd0cb2730a7a', createdAt: '2026-05-26T03:49:58.000Z' }),
    Object.freeze({ id: '11da9ded-89fb-46b6-8cd0-c59a4319ceba', tenantId: '0633374a-4700-4c72-9b52-cd0cb2730a7a', createdAt: '2026-05-26T03:49:02.000Z' }),
    Object.freeze({ id: '6d143978-086d-47b3-9f91-70de03d0c9dd', tenantId: '0633374a-4700-4c72-9b52-cd0cb2730a7a', createdAt: '2026-05-26T03:47:56.000Z' }),
    Object.freeze({ id: '7647ea49-d387-4cba-98f3-7ce21ba63465', tenantId: null, createdAt: '2026-05-20T05:53:29.000Z' }),
    // GitHub masked the time portion. The date is still an independent guard.
    Object.freeze({ id: '28867020-6909-498a-9b2d-bb7d12116c3b', tenantId: 'aaeaf495-92ec-464a-8cd4-9e457d3a12f9', createdAt: '2026-08-13' }),
]);

const TENANTS_SQL = `
    SELECT t.id::text AS id, t.schema_name AS schema
      FROM public.tenants t
     WHERE t.schema_name IS NOT NULL
       AND (t.is_active = true
            OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = t.schema_name))
     ORDER BY t.schema_name`;

function loadAppointmentOrphanPredicate() {
    const compiled = path.join(__dirname, '..', 'dist', 'modules', 'tenant-payments', 'agreed-terms-preflight.js');
    if (fs.existsSync(compiled)) {
        return require(compiled).PREFLIGHT_FAMILIES.appointments.orphanPredicate;
    }
    const source = path.join(__dirname, '..', 'src', 'modules', 'tenant-payments', 'agreed-terms-preflight.ts');
    if (!fs.existsSync(source)) throw new Error('preflight_module_missing');
    process.env.TS_NODE_PROJECT = path.join(__dirname, '..', 'tsconfig.json');
    require(path.join(__dirname, '..', '..', '..', 'node_modules', 'ts-node')).register({ transpileOnly: true });
    return require(source).PREFLIGHT_FAMILIES.appointments.orphanPredicate;
}

function assertManifest() {
    const ids = AUTHORIZED_FIXTURES.map(row => row.id);
    if (ids.length !== 9 || new Set(ids).size !== ids.length) throw new Error('invalid_authorized_manifest');
    for (const row of AUTHORIZED_FIXTURES) {
        if (!/^[0-9a-f-]{36}$/.test(row.id)
            || (row.tenantId !== null && !/^[0-9a-f-]{36}$/.test(row.tenantId))
            || !/^2026-[0-9]{2}-[0-9]{2}(T[0-9:.]+Z)?$/.test(row.createdAt)) {
            throw new Error('invalid_authorized_manifest');
        }
    }
}

function timestampMatches(actual, expected) {
    const iso = new Date(actual).toISOString();
    return expected.length === 10 ? iso.startsWith(expected) : iso === expected;
}

async function relationPresent(client, schema, table) {
    const result = await client.query('SELECT to_regclass($1)::text AS name', [`"${schema}"."${table}"`]);
    return result.rows.length === 1 && Boolean(result.rows[0].name);
}

async function inventoryRows(client, tenants, orphanPredicate) {
    const ids = AUTHORIZED_FIXTURES.map(row => row.id);
    const found = [];
    for (const tenant of tenants) {
        if (!tenant || typeof tenant.id !== 'string' || typeof tenant.schema !== 'string' || !IDENTIFIER.test(tenant.schema)) {
            throw new Error('invalid_tenant_schema');
        }
        if (!await relationPresent(client, tenant.schema, 'appointments')) continue;
        const sql = `SELECT target.id::text AS id, target.status::text AS status,
                            target.created_at, target.cancellation_reason,
                            (${orphanPredicate(tenant.schema)}) AS orphan
                       FROM "${tenant.schema}".appointments target
                      WHERE target.id = ANY($1::uuid[])
                      FOR UPDATE`;
        const result = await client.query(sql, [ids]);
        for (const row of result.rows) found.push({ ...row, tenantId: tenant.id, schema: tenant.schema });
    }
    return found;
}

function validateInventory(found) {
    const byId = new Map();
    for (const row of found) {
        const rows = byId.get(row.id) || [];
        rows.push(row);
        byId.set(row.id, rows);
    }
    const ready = [];
    const alreadyResolved = [];
    for (const expected of AUTHORIZED_FIXTURES) {
        const matches = byId.get(expected.id) || [];
        if (matches.length !== 1) throw new Error(matches.length ? 'duplicate_fixture_id' : 'missing_fixture_id');
        const actual = matches[0];
        if (expected.tenantId !== null && actual.tenantId !== expected.tenantId) throw new Error('fixture_tenant_changed');
        if (!timestampMatches(actual.created_at, expected.createdAt)) throw new Error('fixture_timestamp_changed');
        if (actual.status === 'cancelled' && actual.cancellation_reason === CANCELLATION_REASON) {
            alreadyResolved.push(actual);
            continue;
        }
        if (actual.status !== 'pending') throw new Error('fixture_status_changed');
        if (actual.orphan !== true) throw new Error('fixture_terms_changed');
        ready.push(actual);
    }
    if (found.length !== AUTHORIZED_FIXTURES.length) throw new Error('unexpected_fixture_cardinality');
    return { ready, alreadyResolved };
}

async function remediate(client, {
    apply = false,
    releaseSha = null,
    tenants: suppliedTenants = null,
    appointmentOrphanPredicate = null,
} = {}) {
    assertManifest();
    const orphanPredicate = appointmentOrphanPredicate || loadAppointmentOrphanPredicate();
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ADVISORY_LOCK]);
        const tenantResult = suppliedTenants ? { rows: suppliedTenants } : await client.query(TENANTS_SQL);
        if (!Array.isArray(tenantResult.rows)) throw new Error('invalid_tenant_inventory');
        const found = await inventoryRows(client, tenantResult.rows, orphanPredicate);
        const { ready, alreadyResolved } = validateInventory(found);

        if (!apply) {
            await client.query('ROLLBACK');
            return { expected: AUTHORIZED_FIXTURES.length, found: found.length, cancelled: 0, ready: ready.length, alreadyResolved: alreadyResolved.length, applied: false };
        }

        for (const row of ready) {
            const update = await client.query(
                `UPDATE "${row.schema}".appointments target
                    SET status = 'cancelled', cancellation_reason = $2, updated_at = clock_timestamp()
                  WHERE target.id = $1::uuid AND target.status = 'pending'
                    AND ${orphanPredicate(row.schema)}
                  RETURNING target.id::text AS id`,
                [row.id, CANCELLATION_REASON],
            );
            if (update.rows.length !== 1 || update.rows[0].id !== row.id) throw new Error('fixture_update_race');
            await client.query(
                `INSERT INTO public.audit_logs (tenant_id, action, resource, details)
                 VALUES ($1, $2, 'appointment', $3::jsonb)`,
                [row.tenantId, AUDIT_ACTION, JSON.stringify({
                    appointmentId: row.id,
                    previousStatus: 'pending',
                    newStatus: 'cancelled',
                    reason: CANCELLATION_REASON,
                    releaseSha,
                })],
            );
        }
        await client.query('COMMIT');
        return { expected: AUTHORIZED_FIXTURES.length, found: found.length, cancelled: ready.length, ready: 0, alreadyResolved: alreadyResolved.length, applied: true };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
}

function summaryLine(summary) {
    return `AGREED_TERMS_TEST_FIXTURE_REMEDIATION expected=${summary.expected}`
        + ` found=${summary.found} cancelled=${summary.cancelled}`
        + ` already_resolved=${summary.alreadyResolved} ready=${summary.ready}`
        + ` applied=${summary.applied ? 1 : 0} errors=0`;
}

function errorCode(error) {
    const code = error && (error.code || error.message);
    return typeof code === 'string' && /^[0-9A-Za-z_]{2,50}$/.test(code) ? code : 'remediation_failed';
}

async function main() {
    const connectionString = process.env.DIRECT_DATABASE_URL;
    if (!connectionString) throw new Error('direct_database_url_required');
    const client = new Client({ connectionString, application_name: 'agreed-terms-test-fixture-remediation' });
    await client.connect();
    try {
        await client.query('SET search_path TO public');
        const summary = await remediate(client, {
            apply: process.argv.includes(APPLY_FLAG),
            releaseSha: process.env.IMAGE_TAG || process.env.GITHUB_SHA || null,
        });
        console.log(summaryLine(summary));
        if (!summary.applied) {
            console.error(`::error::dry run only; pass ${APPLY_FLAG} after explicit operator authorization`);
            process.exitCode = 1;
        }
    } finally {
        await client.end().catch(() => undefined);
    }
}

module.exports = {
    APPLY_FLAG,
    CANCELLATION_REASON,
    AUDIT_ACTION,
    AUTHORIZED_FIXTURES,
    remediate,
    summaryLine,
    timestampMatches,
    validateInventory,
};

if (require.main === module) {
    main().catch(error => {
        console.error(`::error::agreed-terms fixture remediation failed (${errorCode(error)}); transaction rolled back`);
        process.exit(2);
    });
}
