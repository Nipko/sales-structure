/* eslint-disable @typescript-eslint/no-var-requires */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';
import { PREFLIGHT_FAMILIES } from './agreed-terms-preflight';

const {
    AUDIT_ACTION,
    AUTHORIZED_FIXTURES,
    CANCELLATION_REASON,
    remediate,
} = require('../../../scripts/remediate-agreed-terms-test-fixtures.cjs');

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the authorized fixture remediation against PostgreSQL', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const schemas = [0, 1, 2, 3].map(index => `tenant_fixture_${index}_${suffix}`);
    const tenantIds = [
        '3e8ad32e-a16b-42e6-9634-b8e8cc29292d',
        '0633374a-4700-4c72-9b52-cd0cb2730a7a',
        '6b24f86a-ff01-48c0-b071-355781700564',
        'aaeaf495-92ec-464a-8cd4-9e457d3a12f9',
    ];
    const tenants = schemas.map((schema, index) => ({ id: tenantIds[index], schema }));
    let client: Client;

    const schemaFor = (fixture: any): string => {
        if (fixture.tenantId === tenantIds[0]) return schemas[0];
        if (fixture.tenantId === tenantIds[1]) return schemas[1];
        if (fixture.tenantId === tenantIds[3]) return schemas[3];
        return schemas[2];
    };

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_loopback_database_required');
        client = new Client({ connectionString: connection });
        await client.connect();
        await client.query(`CREATE TABLE IF NOT EXISTS public.audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, user_id TEXT,
            action TEXT NOT NULL, resource TEXT NOT NULL DEFAULT '', details JSONB NOT NULL DEFAULT '{}',
            ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        for (const schema of schemas) {
            await client.query(`CREATE SCHEMA "${schema}"`);
            await client.query(`CREATE TABLE "${schema}".appointments (
                id UUID PRIMARY KEY, status TEXT NOT NULL, metadata JSONB,
                cancellation_reason TEXT, created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        }
        for (const fixture of AUTHORIZED_FIXTURES) {
            const createdAt = fixture.createdAt.length === 10
                ? `${fixture.createdAt}T13:37:02.000Z`
                : fixture.createdAt;
            await client.query(
                `INSERT INTO "${schemaFor(fixture)}".appointments (id, status, metadata, created_at)
                 VALUES ($1::uuid, 'pending', '{}'::jsonb, $2::timestamptz)`,
                [fixture.id, createdAt],
            );
        }
    }, 120000);

    afterAll(async () => {
        if (!client) return;
        await client.query('DELETE FROM public.audit_logs WHERE action = $1', [AUDIT_ACTION]).catch(() => undefined);
        for (const schema of schemas) {
            if (/^tenant_fixture_[0-3]_[a-f0-9]{32}$/.test(schema)) {
                await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
            }
        }
        await client.end().catch(() => undefined);
    });

    const options = (apply: boolean) => ({
        apply,
        releaseSha: 'integration-test',
        tenants,
        appointmentOrphanPredicate: PREFLIGHT_FAMILIES.appointments.orphanPredicate,
    });

    it('rolls a dry run back without changing or auditing any row', async () => {
        await expect(remediate(client, options(false))).resolves.toMatchObject({
            expected: 9, found: 9, ready: 9, cancelled: 0, applied: false,
        });
        const states = await client.query(
            schemas.map(schema => `SELECT status FROM "${schema}".appointments`).join(' UNION ALL '));
        expect(states.rows).toHaveLength(9);
        expect(states.rows.every(row => row.status === 'pending')).toBe(true);
        expect((await client.query('SELECT count(*)::int AS n FROM public.audit_logs WHERE action = $1', [AUDIT_ACTION])).rows[0].n).toBe(0);
    });

    it('aborts all nine when one observed fact changed', async () => {
        const changed = AUTHORIZED_FIXTURES[0];
        await client.query(`UPDATE "${schemaFor(changed)}".appointments SET status = 'confirmed' WHERE id = $1::uuid`, [changed.id]);
        await expect(remediate(client, options(true))).rejects.toThrow('fixture_status_changed');
        const pending = await client.query(
            schemas.map(schema => `SELECT count(*)::int AS n FROM "${schema}".appointments WHERE status = 'pending'`).join(' UNION ALL '));
        expect(pending.rows.reduce((sum, row) => sum + row.n, 0)).toBe(8);
        expect((await client.query('SELECT count(*)::int AS n FROM public.audit_logs WHERE action = $1', [AUDIT_ACTION])).rows[0].n).toBe(0);
        await client.query(`UPDATE "${schemaFor(changed)}".appointments SET status = 'pending' WHERE id = $1::uuid`, [changed.id]);
    });

    it('cancels and audits the exact nine atomically, then becomes idempotent', async () => {
        await expect(remediate(client, options(true))).resolves.toMatchObject({
            expected: 9, found: 9, cancelled: 9, alreadyResolved: 0, applied: true,
        });
        const rows = await client.query(schemas.map(schema =>
            `SELECT status, cancellation_reason FROM "${schema}".appointments`).join(' UNION ALL '));
        expect(rows.rows).toHaveLength(9);
        expect(rows.rows.every(row => row.status === 'cancelled'
            && row.cancellation_reason === CANCELLATION_REASON)).toBe(true);
        expect((await client.query('SELECT count(*)::int AS n FROM public.audit_logs WHERE action = $1', [AUDIT_ACTION])).rows[0].n).toBe(9);

        await expect(remediate(client, options(true))).resolves.toMatchObject({
            expected: 9, found: 9, cancelled: 0, alreadyResolved: 9, applied: true,
        });
        expect((await client.query('SELECT count(*)::int AS n FROM public.audit_logs WHERE action = $1', [AUDIT_ACTION])).rows[0].n).toBe(9);
    });
});
