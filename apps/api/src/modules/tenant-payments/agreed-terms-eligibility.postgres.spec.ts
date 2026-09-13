import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { appointmentAgreedCurrencySql, appointmentAgreedPriceSql, appointmentAgreedTermsSql } from '../appointments/appointment-service-terms';
import { catalogAgreedAmountSql, catalogAgreedCurrencySql, catalogAgreedTermsSql } from '../orders/catalog-order-contract';
import { commitmentAgreedAmountSql, commitmentAgreedCurrencySql, commitmentAgreedTermsSql } from '../conversations/commitment-proposal';
import { PREFLIGHT_FAMILIES } from './agreed-terms-preflight';

const url = process.env.AGREED_TERMS_TEST_DATABASE_URL || process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * ═══ THE COUNT AND THE CHARGE HAVE TO MEAN THE SAME THING ═══
 *
 * A row is an "orphan" when the charge will refuse it for want of an agreement.
 * That is the definition, and it is only useful if ONE expression decides it —
 * because the pre-deploy gate's whole promise is that the number it reports is
 * the number of customers about to meet a payment link that does not work.
 *
 * It was four expressions. The charge read
 * `NULLIF(metadata->'serviceTerms'->>'price','')::numeric`; the counter read
 * `NOT (metadata ? 'serviceTerms')`; the detail listing wrote it a third time;
 * the pre-flight a fourth. Every one of the shapes below sits in the gap
 * between them: the charge refuses, the gate says zero, and the deploy proceeds.
 *
 *   · `metadata` SQL NULL          — `NULL ? 'x'` is NULL, `NOT NULL` is NULL,
 *                                     so the row does not match the counter at all
 *   · `{"serviceTerms": null}`     — the key exists, so the counter is satisfied
 *   · `{"serviceTerms": {}}`       — likewise
 *   · price `""` or absent         — `NULLIF(...,'')` is NULL, charge refuses
 *   · price `"abc"`                — the charge's `::numeric` THROWS rather than
 *                                     refusing, which is worse than either
 *   · currency absent              — half an agreement is not an agreement
 *
 * And the same class in the three commitment families: the charge requires
 * `amount_cents IS NOT NULL`, the counter only `accepted_at IS NOT NULL`, so an
 * accepted proposal with no amount is chargeable to nobody and invisible here.
 *
 * So every family now exposes ONE predicate — "a charge can read a complete
 * agreement here" — and the counter, the listing and the gate are its negation.
 * These cases run against real PostgreSQL because every one of them is about
 * three-valued logic and JSONB operators, which is precisely what a hand-written
 * double gets wrong.
 */
(url ? describe : describe.skip)('what the charge refuses is what the gate counts', () => {
    const schema = `tenant_eligib_${randomUUID().replace(/-/g, '')}`;
    let client: Client;

    /** True when the family's agreement predicate holds for that row. */
    const agrees = async (sql: string, table: string, id: string): Promise<boolean | null> => {
        const rows = await client.query(
            `SELECT ${sql} AS ok FROM "${schema}".${table} target WHERE target.id = $1::uuid`, [id]);
        return rows.rows[0].ok;
    };

    /** What the charge would actually read: amount and currency, or NULL. */
    const charge = async (amountSql: string, currencySql: string, table: string, id: string) => {
        const rows = await client.query(
            `SELECT ${amountSql} AS amount, ${currencySql} AS currency
               FROM "${schema}".${table} target WHERE target.id = $1::uuid`, [id]);
        return { amount: rows.rows[0].amount, currency: rows.rows[0].currency };
    };

    /** What the pre-flight counts, for exactly this row. */
    const countedByGate = async (family: keyof typeof PREFLIGHT_FAMILIES, id: string): Promise<boolean> => {
        const spec = PREFLIGHT_FAMILIES[family];
        const rows = await client.query(
            `SELECT ${spec.orphanPredicate(schema)} AS orphan
               FROM "${schema}".${spec.table} target WHERE target.id = $1::uuid`, [id]);
        return rows.rows[0].orphan === true;
    };

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new Client({ connectionString: url });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`CREATE TABLE "${schema}".appointments(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL,
            metadata JSONB, amount_due NUMERIC, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.query(`CREATE TABLE "${schema}".orders(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL,
            catalog_terms JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.query(`CREATE TABLE "${schema}".property_bookings(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.query(`CREATE TABLE "${schema}".commitment_proposals(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), consumed_entity_id UUID,
            accepted_at TIMESTAMPTZ, amount_cents NUMERIC, currency TEXT)`);
    }, 120_000);

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_eligib_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    describe('appointments', () => {
        const insert = async (metadata: string | null) => {
            const rows = await client.query(
                `INSERT INTO "${schema}".appointments(status, metadata) VALUES('confirmed', $1::jsonb) RETURNING id::text`,
                [metadata]);
            return rows.rows[0].id as string;
        };

        it.each([
            ['metadata is SQL NULL', null],
            ['serviceTerms is JSON null', '{"serviceTerms": null}'],
            ['serviceTerms is an empty object', '{"serviceTerms": {}}'],
            ['serviceTerms is not an object', '{"serviceTerms": "later"}'],
            ['the price is an empty string', '{"serviceTerms": {"price": "", "currency": "COP"}}'],
            ['the price is absent', '{"serviceTerms": {"currency": "COP"}}'],
            ['the price is not a number', '{"serviceTerms": {"price": "a convenir", "currency": "COP"}}'],
            // The separator has to be a real dot. Written as `\.` inside a
            // template literal, JavaScript eats the backslash and PostgreSQL
            // receives `.` — "any character" — so `40000x50` would have passed
            // as a price and then thrown on the cast. The lint contract caught
            // it; this keeps it caught.
            ['the price uses something other than a dot', '{"serviceTerms": {"price": "40000x50", "currency": "COP"}}'],
            ['the price has a thousands separator', '{"serviceTerms": {"price": "40,000", "currency": "COP"}}'],
            ['the currency is absent', '{"serviceTerms": {"price": "40000"}}'],
            ['the currency is an empty string', '{"serviceTerms": {"price": "40000", "currency": ""}}'],
        ])('refuses the charge and counts the row when %s', async (_name, metadata) => {
            const id = await insert(metadata);
            // The predicate says no…
            expect(await agrees(appointmentAgreedTermsSql(), 'appointments', id)).toBe(false);
            // …the charge reads nothing usable, without throwing…
            const read = await charge(appointmentAgreedPriceSql(), appointmentAgreedCurrencySql(), 'appointments', id);
            expect(read.amount === null || read.currency === null).toBe(true);
            // …and the gate counts it, which is the whole point.
            expect(await countedByGate('appointments', id)).toBe(true);
        });

        it('charges, and does not count, a row whose agreement is complete', async () => {
            const id = await insert('{"serviceTerms": {"price": "40000.50", "currency": "COP"}}');
            expect(await agrees(appointmentAgreedTermsSql(), 'appointments', id)).toBe(true);
            const read = await charge(appointmentAgreedPriceSql(), appointmentAgreedCurrencySql(), 'appointments', id);
            expect(Number(read.amount)).toBe(40000.5);
            expect(read.currency).toBe('COP');
            expect(await countedByGate('appointments', id)).toBe(false);
        });

        it('never lets a bad price abort the statement it appears in', async () => {
            // `'a convenir'::numeric` throws, and a gate that throws mid-sweep
            // reports nothing about the tenants after it. The guard has to be in
            // the expression, not in a hope about the data.
            await insert('{"serviceTerms": {"price": "a convenir", "currency": "COP"}}');
            const rows = await client.query(
                `SELECT count(*)::int AS n, count(${appointmentAgreedPriceSql()}) AS priced
                   FROM "${schema}".appointments target`);
            expect(Number(rows.rows[0].n)).toBeGreaterThan(0);
        });
    });

    describe('catalogue orders', () => {
        const insert = async (terms: string | null) => {
            const rows = await client.query(
                `INSERT INTO "${schema}".orders(status, catalog_terms) VALUES('pending', $1::jsonb) RETURNING id::text`,
                [terms]);
            return rows.rows[0].id as string;
        };

        it.each([
            ['catalog_terms is SQL NULL', null],
            ['the action is not create', '{"action": "cancel", "totalAmountCents": "1000", "currency": "COP"}'],
            ['the amount is absent', '{"action": "create", "currency": "COP"}'],
            ['the amount is an empty string', '{"action": "create", "totalAmountCents": "", "currency": "COP"}'],
            ['the amount is not a number', '{"action": "create", "totalAmountCents": "mil", "currency": "COP"}'],
            ['the currency is absent', '{"action": "create", "totalAmountCents": "1000"}'],
        ])('refuses the charge and counts the row when %s', async (_name, terms) => {
            const id = await insert(terms);
            expect(await agrees(catalogAgreedTermsSql(), 'orders', id)).toBe(false);
            const read = await charge(catalogAgreedAmountSql(), catalogAgreedCurrencySql(), 'orders', id);
            expect(read.amount === null || read.currency === null).toBe(true);
            expect(await countedByGate('catalog_orders', id)).toBe(true);
        });

        it('charges, and does not count, an order whose agreement is complete', async () => {
            const id = await insert('{"action": "create", "totalAmountCents": "125000", "currency": "COP"}');
            expect(await agrees(catalogAgreedTermsSql(), 'orders', id)).toBe(true);
            const read = await charge(catalogAgreedAmountSql(), catalogAgreedCurrencySql(), 'orders', id);
            expect(Number(read.amount)).toBe(1250);
            expect(read.currency).toBe('COP');
            expect(await countedByGate('catalog_orders', id)).toBe(false);
        });
    });

    describe('the three families that read a proposal', () => {
        const booking = async () => {
            const rows = await client.query(
                `INSERT INTO "${schema}".property_bookings(status) VALUES('confirmed') RETURNING id::text`);
            return rows.rows[0].id as string;
        };
        const proposal = async (entityId: string, fields: { accepted: boolean; amount: number | null; currency: string | null }) => {
            await client.query(
                `INSERT INTO "${schema}".commitment_proposals(consumed_entity_id, accepted_at, amount_cents, currency)
                 VALUES($1::uuid, ${fields.accepted ? 'NOW()' : 'NULL'}, $2, $3)`,
                [entityId, fields.amount, fields.currency]);
        };

        it.each([
            ['there is no proposal at all', null],
            ['the proposal was never accepted', { accepted: false, amount: 125000, currency: 'COP' }],
            ['the accepted proposal has no amount', { accepted: true, amount: null, currency: 'COP' }],
            ['the accepted proposal has no currency', { accepted: true, amount: 125000, currency: null }],
        ])('refuses the charge and counts the row when %s', async (_name, fields) => {
            const id = await booking();
            if (fields) await proposal(id, fields as any);
            expect(await agrees(commitmentAgreedTermsSql('target', `"${schema}".`), 'property_bookings', id)).toBe(false);
            const read = await charge(commitmentAgreedAmountSql('target', `"${schema}".`), commitmentAgreedCurrencySql('target', `"${schema}".`), 'property_bookings', id);
            expect(read.amount === null || read.currency === null).toBe(true);
            expect(await countedByGate('property_bookings', id)).toBe(true);
        });

        it('charges, and does not count, a booking with a complete accepted proposal', async () => {
            const id = await booking();
            await proposal(id, { accepted: true, amount: 125000, currency: 'COP' });
            expect(await agrees(commitmentAgreedTermsSql('target', `"${schema}".`), 'property_bookings', id)).toBe(true);
            const read = await charge(commitmentAgreedAmountSql('target', `"${schema}".`), commitmentAgreedCurrencySql('target', `"${schema}".`), 'property_bookings', id);
            expect(Number(read.amount)).toBe(1250);
            expect(read.currency).toBe('COP');
            expect(await countedByGate('property_bookings', id)).toBe(false);
        });

        it('takes the most recent complete acceptance when an earlier one was incomplete', async () => {
            // A first proposal accepted without an amount, then a real one. The
            // charge reads the newest COMPLETE agreement, so the row is payable —
            // and the gate must agree rather than counting it on the strength of
            // the incomplete row.
            const id = await booking();
            await client.query(
                `INSERT INTO "${schema}".commitment_proposals(consumed_entity_id, accepted_at, amount_cents, currency)
                 VALUES($1::uuid, NOW() - INTERVAL '1 hour', NULL, 'COP')`, [id]);
            await proposal(id, { accepted: true, amount: 90000, currency: 'COP' });
            expect(await agrees(commitmentAgreedTermsSql('target', `"${schema}".`), 'property_bookings', id)).toBe(true);
            expect(Number((await charge(commitmentAgreedAmountSql('target', `"${schema}".`), commitmentAgreedCurrencySql('target', `"${schema}".`), 'property_bookings', id)).amount)).toBe(900);
            expect(await countedByGate('property_bookings', id)).toBe(false);
        });
    });

    it('counts exactly the rows the charge cannot read, family by family', async () => {
        // The property the gate actually promises: its number is the number of
        // live rows whose charge would refuse. Asserted by asking both questions
        // of every row in the schema rather than of the ones this suite inserted.
        for (const [family, spec] of Object.entries(PREFLIGHT_FAMILIES)) {
            if (!['appointments', 'catalog_orders', 'property_bookings'].includes(family)) continue;
            const agreed = family === 'appointments' ? appointmentAgreedTermsSql()
                : family === 'catalog_orders' ? catalogAgreedTermsSql()
                    : commitmentAgreedTermsSql('target', `"${schema}".`);
            const rows = await client.query(
                `SELECT count(*) FILTER (WHERE ${spec.orphanPredicate(schema)}) AS gate,
                        count(*) FILTER (WHERE NOT COALESCE(${agreed}, false)) AS refused
                   FROM "${schema}".${spec.table} target`);
            expect({ family, gate: Number(rows.rows[0].gate) })
                .toEqual({ family, gate: Number(rows.rows[0].refused) });
        }
    });
});
