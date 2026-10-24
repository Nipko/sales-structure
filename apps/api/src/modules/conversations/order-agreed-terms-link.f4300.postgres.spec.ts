import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { COMMITMENT_PROPOSAL_DDL, linkAcceptedCommitment } from './commitment-proposal';
import { PREFLIGHT_FAMILIES } from '../tenant-payments/agreed-terms-preflight';

const url = process.env.AGREED_TERMS_TEST_DATABASE_URL || process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * F4300-31 against real PostgreSQL: the statement the order writer runs inside
 * its own transaction is what makes the pre-flight (and the till, which reads
 * the same predicate) see the agreement. Production's row — an accepted
 * 1350000 COP proposal with `consumed_entity_id` NULL — is counted; the same
 * order linked in its own transaction is not; a rolled-back order leaves the
 * acceptance free and creates nothing.
 */
(url ? describe : describe.skip)('F4300-31 · the food order and its accepted proposal commit together', () => {
    const schema = `tenant_f4300_31_${randomUUID().replace(/-/g, '')}`;
    let client: Client;
    const query = (async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows) as any;

    const accept = async (key: string) => {
        await client.query(
            `INSERT INTO commitment_proposals
                (proposal_hash, family, action, contact_id, idempotency_key, proposal, amount_cents, currency, accepted_at)
             VALUES ('h', 'restaurant_orders', 'create', $1::uuid, $2,
                     '{"price":{"currency":"COP","amountCents":"1350000"},"action":"create","family":"restaurant_orders"}'::jsonb,
                     1350000, 'COP', NOW())`, [randomUUID(), key]);
    };
    const orderInTransaction = async (key: string | null, commit: boolean): Promise<string> => {
        await client.query('BEGIN');
        const [order] = (await client.query(`INSERT INTO food_orders(status) VALUES('received') RETURNING id`)).rows;
        if (key) expect(await linkAcceptedCommitment(query, { idempotencyKey: key, entityId: order.id, family: 'restaurant_orders' })).toBe('linked');
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        return order.id;
    };
    const countedByPreflight = async (id: string): Promise<boolean> => {
        const spec = PREFLIGHT_FAMILIES.restaurant_orders;
        const rows = await client.query(
            `SELECT ${spec.orphanPredicate(schema)} AS orphan FROM "${schema}".${spec.table} target WHERE target.id = $1::uuid`, [id]);
        return rows.rows[0].orphan === true;
    };

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new Client({ connectionString: url });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET search_path TO "${schema}", public`);
        for (const statement of COMMITMENT_PROPOSAL_DDL) await client.query(statement);
        await client.query(`CREATE TABLE food_orders(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'received',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.end();
    });

    it('counts the production shape: accepted proposal, order created, link never written', async () => {
        await accept('f4300-31:unlinked');
        const id = await orderInTransaction(null, true);
        expect(await countedByPreflight(id)).toBe(true);
    });

    it('does not count an order linked to its acceptance inside its own transaction', async () => {
        await accept('f4300-31:linked');
        const id = await orderInTransaction('f4300-31:linked', true);
        expect(await countedByPreflight(id)).toBe(false);
        const [row] = (await client.query(
            `SELECT consumed_entity_id::text AS entity, consumed_at FROM commitment_proposals WHERE idempotency_key = $1`,
            ['f4300-31:linked'])).rows;
        expect(row.entity).toBe(id);
        expect(row.consumed_at).toBeInstanceOf(Date);
    });

    it('leaves the acceptance free and no order behind when the order rolls back', async () => {
        await accept('f4300-31:rolled-back');
        const id = await orderInTransaction('f4300-31:rolled-back', false);
        expect((await client.query(`SELECT 1 FROM food_orders WHERE id = $1::uuid`, [id])).rows).toHaveLength(0);
        const [row] = (await client.query(
            `SELECT consumed_entity_id FROM commitment_proposals WHERE idempotency_key = $1`, ['f4300-31:rolled-back'])).rows;
        expect(row.consumed_entity_id).toBeNull();
    });

    it('refuses to hand one acceptance to a second order, and never invents one', async () => {
        await accept('f4300-31:once');
        const first = await orderInTransaction('f4300-31:once', true);
        const [second] = (await client.query(`INSERT INTO food_orders(status) VALUES('received') RETURNING id`)).rows;
        expect(await linkAcceptedCommitment(query, { idempotencyKey: 'f4300-31:once', entityId: second.id, family: 'restaurant_orders' })).toBe('conflict');
        expect(await linkAcceptedCommitment(query, { idempotencyKey: 'f4300-31:never-accepted', entityId: second.id, family: 'restaurant_orders' })).toBe('no_acceptance');
        expect(await countedByPreflight(first)).toBe(false);
        expect(await countedByPreflight(second.id)).toBe(true);
        expect(Number((await client.query(`SELECT count(*) AS n FROM commitment_proposals`)).rows[0].n)).toBe(4);
    });
});
