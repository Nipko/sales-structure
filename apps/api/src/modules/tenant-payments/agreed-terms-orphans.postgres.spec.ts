import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { countAgreedTermsOrphans, isMissingAgreedTermsRefusal, type OrphanQuery } from './agreed-terms-orphans';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The rehearsal for the one change in this batch that can break a live tenant.
 *
 * Charging from the agreed snapshot is right, and it has a consequence with a
 * date on it: the moment the new code runs, an order or an appointment created
 * before the snapshot existed stops being payable. If a tenant has live ones,
 * their customers meet a link that does not work. Nobody could see that coming,
 * because the counting SQL existed and nothing called it.
 *
 * The property this file is really defending is the last one: the report must
 * never reconstruct consent. A number in `total_amount` is evidence that
 * somebody computed it, not that a person agreed to it, and a "helpful" backfill
 * from that column would put a fabricated agreement behind a real charge.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('the rows that predate the terms binding', () => {
    let pool: Pool;
    const schema = `orphans_${randomUUID().replace(/-/g, '')}`;
    const contactId = randomUUID();

    const transaction = async <T>(work: (query: OrphanQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work((async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows) as OrphanQuery);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        transaction(query => query(text, params)) as Promise<any[]>;

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 4 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        await sql(`CREATE TABLE orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contact_id UUID,
            status TEXT, total_amount NUMERIC, currency TEXT, catalog_terms JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await sql(`CREATE TABLE appointments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contact_id UUID,
            status TEXT, metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    it('reports nothing to do when every row carries its terms', async () => {
        await sql(`INSERT INTO orders(contact_id,status,total_amount,currency,catalog_terms)
            VALUES($1::uuid,'pending',10,'COP',$2::jsonb)`,
        [contactId, JSON.stringify({ version: 1, action: 'create', currency: 'COP', totalAmountCents: '1000' })]);
        await sql(`INSERT INTO appointments(contact_id,status,metadata)
            VALUES($1::uuid,'confirmed',$2::jsonb)`,
        [contactId, JSON.stringify({ serviceTerms: { price: 10, currency: 'COP' } })]);
        const report = await transaction(countAgreedTermsOrphans);
        expect(report.total).toBe(0);
        expect(report.blocksDeploy).toBe(false);
    }, 120000);

    it('counts the live rows a deploy would leave unpayable, with their states and dates', async () => {
        await sql("INSERT INTO orders(contact_id,status,total_amount,currency) VALUES($1::uuid,'pending',50,'COP')",
            [contactId]);
        await sql("INSERT INTO orders(contact_id,status,total_amount,currency) VALUES($1::uuid,'confirmed',70,'COP')",
            [contactId]);
        await sql("INSERT INTO appointments(contact_id,status) VALUES($1::uuid,'confirmed')", [contactId]);
        const report = await transaction(countAgreedTermsOrphans);
        expect(report.total).toBe(3);
        expect(report.blocksDeploy).toBe(true);
        const orders = report.families.find(entry => entry.family === 'catalog_orders')!;
        expect(orders.orphans).toBe(2);
        expect(orders.byStatus).toEqual({ pending: 1, confirmed: 1 });
        expect(orders.sample).toHaveLength(2);
        expect(orders.oldest).toEqual(expect.any(String));
        // Every one of them needs a person. There is no durable evidence of an
        // agreement for a row written before the snapshot existed.
        expect(report.families.every(entry => entry.resolution === 'human_review')).toBe(true);
    }, 120000);

    it('ignores rows nobody is going to charge anyway', async () => {
        await sql("INSERT INTO orders(contact_id,status,total_amount,currency) VALUES($1::uuid,'cancelled',50,'COP')",
            [contactId]);
        await sql("INSERT INTO appointments(contact_id,status) VALUES($1::uuid,'no_show')", [contactId]);
        const report = await transaction(countAgreedTermsOrphans);
        // Still the three from the previous test: a cancelled order and a no-show
        // are not a customer waiting on a broken link.
        expect(report.total).toBe(3);
    }, 120000);

    it('carries no personal data out of the tenant', async () => {
        const report = await transaction(countAgreedTermsOrphans);
        const serialised = JSON.stringify(report);
        // Ids, statuses and dates. Not the contact, not the amount: an
        // operations report is not a reason to copy a customer list into a log.
        expect(serialised).not.toContain(contactId);
        expect(serialised).not.toMatch(/total_amount|"amount"|phone|email/i);
    }, 120000);

    it('survives a tenant that has no such table at all', async () => {
        const bare = `orphans_bare_${randomUUID().replace(/-/g, '')}`;
        const client = await pool.connect();
        try {
            await client.query(`CREATE SCHEMA "${bare}"`);
            const rows = await (async () => {
                await client.query('BEGIN');
                await client.query(`SET LOCAL search_path TO "${bare}"`);
                const value = await countAgreedTermsOrphans((async (text: string, params: any[] = []) =>
                    (await client.query(text, params)).rows) as OrphanQuery);
                await client.query('ROLLBACK');
                return value;
            })();
            // A clinic with no catalogue is not an error, and a report that dies
            // on the first missing table says nothing about the rest.
            expect(rows.total).toBe(0);
            expect(rows.families).toHaveLength(5);
            await client.query(`DROP SCHEMA IF EXISTS "${bare}" CASCADE`);
        } finally { client.release(); }
    }, 120000);

    it('tells a missing snapshot apart from every other refusal', () => {
        // The resolver answered `null` for not-found, wrong-contact, wrong-status
        // and no-agreed-terms alike, so the one refusal that means a real person
        // is holding a broken link looked exactly like a typo in a reference.
        expect(isMissingAgreedTermsRefusal({ amount: null, currency: null }, 'order')).toBe(true);
        expect(isMissingAgreedTermsRefusal({ amount: null }, 'appointment')).toBe(true);
        expect(isMissingAgreedTermsRefusal({ amount: 10, currency: 'COP' }, 'order')).toBe(false);
        expect(isMissingAgreedTermsRefusal(undefined, 'order')).toBe(false);
        // A family that still charges from a live column cannot be refused for
        // missing an acceptance; one that does not is exactly what this catches.
        expect(isMissingAgreedTermsRefusal({ amount: null }, 'enrollment')).toBe(false);
        expect(isMissingAgreedTermsRefusal({ amount: null }, 'tour')).toBe(true);
    });
});
