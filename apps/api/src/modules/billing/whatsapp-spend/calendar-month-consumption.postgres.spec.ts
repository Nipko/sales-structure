import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readCalendarMonthConsumption, readExposure, type SpendQuery } from './spend-ledger';

/**
 * ═══ THE MONTH META BILLS, NOT THE LAST THIRTY DAYS ═══
 *
 * Two facts an operator is trying to reconcile before an invoice arrives are
 * both CALENDAR-MONTH facts: the thousand free service deliveries reset at
 * midnight on the first — in the WhatsApp account's own time zone — and Meta
 * invoices by calendar month.
 *
 * The only reading the product had was a rolling window, which straddles that
 * boundary by construction. Somebody comparing our figure to their allowance
 * was comparing two different periods and being told they disagreed, and the
 * conclusion a reasonable person draws from that is that our number is wrong.
 *
 * The oracle throughout is the row's own `applied_local_date` — the WABA-local
 * date the RATE was chosen against, written when the reservation was priced.
 * Nothing here recomputes a month from `created_at`, which is the mistake this
 * exists to make impossible: a message sent at 8pm in Bogotá on the 31st is
 * still October, and grouping its UTC timestamp would file it under November.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('consumption by the calendar the invoice uses', () => {
    const schema = `tenant_calmonth_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    const NUMBER = '15550001111';
    const OTHER = '15557770000';
    let client: Client;
    jest.setTimeout(180_000);

    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    /**
     * One reservation row, written directly.
     *
     * Direct because the subject here is the READING, not the writing: going
     * through the whole admission to place a row in a past month would need a
     * clock nobody can move, and the columns it would set are exactly the ones
     * spelled out below.
     */
    const reservation = async (over: {
        localDate: string | null; channelAccountId?: string; state?: string;
        market?: string | null; category?: string; currency?: string;
        free?: number; charged?: number; settledMinor?: number; reservedMinor?: number;
    }) => {
        await query(
            `INSERT INTO "${schema}".whatsapp_spend_reservations
                (effect_key, tenant_id, channel_type, channel_account_id,
                 payer_kind, credential_id, credential_source,
                 recipient_scope, recipient_ref, category, market, currency,
                 applied_local_date, admission_reason, basis, decision,
                 reserved_minor, unit_ceiling_minor, state,
                 free_deliveries, charged_deliveries, charged_minor, lease_expires_at,
                 evidence)
             VALUES ($1, $2::uuid, 'whatsapp', $3,
                 'business_direct', 'cred-1', 'channel_account',
                 'customer', 'ref-1', $4, $5, $6,
                 $7::date, 'test', 'priced', 'accepted',
                 $8, $8, $9,
                 $10, $11, $12, clock_timestamp() + interval '1 hour',
                 -- A settled or released row must name what settled it. The
                 -- CHECK says so, and a fixture that dodges it would be
                 -- rehearsing a row production cannot hold.
                 $13::jsonb)`,
            [`effect-${randomUUID()}`, TENANT, over.channelAccountId ?? NUMBER,
                over.category ?? 'service', over.market ?? 'Colombia', over.currency ?? 'USD',
                over.localDate, over.reservedMinor ?? 100, over.state ?? 'settled',
                over.free ?? 0, over.charged ?? 1,
                (over.state ?? 'settled') === 'settled' ? (over.settledMinor ?? 100) : null,
                ['settled', 'released'].includes(over.state ?? 'settled')
                    ? JSON.stringify({ source: 'test_fixture' }) : null]);
    };

    const monthOf = (rows: readonly any[], month: string | null, account = NUMBER) =>
        rows.find(row => row.month === month && row.channelAccountId === account);

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await query(`CREATE SCHEMA "${schema}"`);
        // The real DDL, from the checked-in definition of a tenant.
        const tenantSchema = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await query(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_calmonth_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    afterEach(async () => {
        // `DELETE`, not `TRUNCATE`: the allocations table references this one,
        // and truncating a referenced table is refused outright.
        await query(`DELETE FROM "${schema}".whatsapp_spend_reservations`);
    });

    const thisMonth = () => new Date().toISOString().slice(0, 7);
    const dayIn = (monthsAgo: number, day = 15) => {
        const at = new Date();
        at.setUTCDate(1);
        at.setUTCMonth(at.getUTCMonth() - monthsAgo);
        at.setUTCDate(day);
        return at.toISOString().slice(0, 10);
    };

    describe('the boundary a rolling window gets wrong', () => {
        it('files a delivery under the month its RATE was applied in', async () => {
            // THE POINT. `applied_local_date` is the WABA-local date the price
            // was chosen against. A message sent at 8pm in Bogotá on the last
            // of the month is still that month, and grouping its UTC timestamp
            // would file it under the next one — against an allowance that has
            // not reset and an invoice it does not belong to.
            const last = dayIn(1, 28);
            await reservation({ localDate: last, free: 1, charged: 0 });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 3 });
            expect(rows).toHaveLength(1);
            expect(rows[0].month).toBe(last.slice(0, 7));
            expect(rows[0].freeDeliveries).toBe(1);
        });

        it('keeps two months apart even when a rolling window would merge them', async () => {
            await reservation({ localDate: dayIn(0, 3), free: 2, charged: 0 });
            await reservation({ localDate: dayIn(1, 28), free: 5, charged: 0 });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 3 });
            expect(rows).toHaveLength(2);
            expect(monthOf(rows, thisMonth())!.freeDeliveries).toBe(2);
            expect(monthOf(rows, dayIn(1).slice(0, 7))!.freeDeliveries).toBe(5);
            // And the rolling reading, over a window that covers both, sums
            // them into one figure — which is the reading an operator was being
            // handed and could not reconcile with anything.
            const rolling = await readExposure(query, schema, {
                since: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
            });
            expect(rolling[0].freeDeliveries).toBe(7);
        });

        it('returns the newest month first, so the answer is the one on top', async () => {
            await reservation({ localDate: dayIn(2) });
            await reservation({ localDate: dayIn(0) });
            await reservation({ localDate: dayIn(1) });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 6 });
            expect(rows.map(row => row.month))
                .toEqual([dayIn(0).slice(0, 7), dayIn(1).slice(0, 7), dayIn(2).slice(0, 7)]);
        });
    });

    describe('the allowance, which is per NUMBER per month', () => {
        it('never pools two numbers into one figure', async () => {
            // The thousand free deliveries are per number. Pooling them would
            // tell a tenant with two numbers they had used twice their
            // allowance on one of them, or half of it.
            await reservation({ localDate: dayIn(0), free: 400, charged: 0 });
            await reservation({ localDate: dayIn(0), channelAccountId: OTHER, free: 900, charged: 0 });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 1 });
            expect(rows).toHaveLength(2);
            expect(monthOf(rows, thisMonth(), NUMBER)!.freeDeliveries).toBe(400);
            expect(monthOf(rows, thisMonth(), OTHER)!.freeDeliveries).toBe(900);
        });

        it('answers for one number when one is asked for', async () => {
            await reservation({ localDate: dayIn(0), free: 400, charged: 0 });
            await reservation({ localDate: dayIn(0), channelAccountId: OTHER, free: 900, charged: 0 });
            const rows = await readCalendarMonthConsumption(query, schema,
                { channelAccountId: OTHER, months: 1 });
            expect(rows).toHaveLength(1);
            expect(rows[0].freeDeliveries).toBe(900);
        });

        it('counts free and charged deliveries as different things', async () => {
            // A free delivery is still a delivery and still counts against the
            // allowance; it just costs nothing. Folding them together loses
            // exactly the number the allowance is about.
            await reservation({ localDate: dayIn(0), free: 3, charged: 0, settledMinor: 0 });
            await reservation({ localDate: dayIn(0), free: 0, charged: 7, settledMinor: 700 });
            const row = monthOf(await readCalendarMonthConsumption(query, schema, { months: 1 }),
                thisMonth())!;
            expect(row.freeDeliveries).toBe(3);
            expect(row.chargedDeliveries).toBe(7);
        });
    });

    describe('the money', () => {
        it('never sums across currencies', async () => {
            // A single total across pesos and dollars is wrong in the way
            // nobody notices until they act on it.
            await reservation({ localDate: dayIn(0), currency: 'USD', settledMinor: 500 });
            await reservation({ localDate: dayIn(0), currency: 'COP', settledMinor: 200_000 });
            const row = monthOf(await readCalendarMonthConsumption(query, schema, { months: 1 }),
                thisMonth())!;
            expect(row.money).toEqual([
                { currency: 'COP', settledMinor: 200_000, retainedMinor: 0 },
                { currency: 'USD', settledMinor: 500, retainedMinor: 0 },
            ]);
        });

        it('separates what is settled from what is still merely reserved', async () => {
            // `accepted` money is exposure, not spend: the provider took the
            // message and nobody has priced the delivery yet. Reporting it as
            // settled would say the month cost more than it has.
            await reservation({ localDate: dayIn(0), state: 'settled', settledMinor: 500,
                reservedMinor: 500 });
            await reservation({ localDate: dayIn(0), state: 'accepted', settledMinor: 0,
                reservedMinor: 300 });
            const row = monthOf(await readCalendarMonthConsumption(query, schema, { months: 1 }),
                thisMonth())!;
            expect(row.money).toEqual([{ currency: 'USD', settledMinor: 500, retainedMinor: 300 }]);
        });

        it('does not count a released reservation as a delivery', async () => {
            // Released means the effect never happened. Counting it would
            // consume an allowance nobody used.
            await reservation({ localDate: dayIn(0), state: 'released', charged: 4,
                settledMinor: 0, reservedMinor: 400 });
            const row = monthOf(await readCalendarMonthConsumption(query, schema, { months: 1 }),
                thisMonth())!;
            expect(row.chargedDeliveries).toBe(0);
            expect(row.money).toEqual([{ currency: 'USD', settledMinor: 0, retainedMinor: 0 }]);
        });
    });

    describe('where it went', () => {
        it('splits by the recipient’s market and the category Meta charged by', async () => {
            await reservation({ localDate: dayIn(0), market: 'Colombia', category: 'marketing',
                charged: 10, settledMinor: 1_000 });
            await reservation({ localDate: dayIn(0), market: 'Germany', category: 'marketing',
                charged: 2, settledMinor: 900 });
            await reservation({ localDate: dayIn(0), market: 'Colombia', category: 'service',
                free: 30, charged: 0, settledMinor: 0 });
            const row = monthOf(await readCalendarMonthConsumption(query, schema, { months: 1 }),
                thisMonth())!;
            expect(row.byMarketCategory).toEqual([
                { market: 'Colombia', category: 'service', deliveries: 30, currency: 'USD',
                    settledMinor: 0, retainedMinor: 0 },
                { market: 'Colombia', category: 'marketing', deliveries: 10, currency: 'USD',
                    settledMinor: 1_000, retainedMinor: 0 },
                { market: 'Germany', category: 'marketing', deliveries: 2, currency: 'USD',
                    settledMinor: 900, retainedMinor: 0 },
            ]);
        });
    });

    describe('the rows nobody could price', () => {
        it('reports them as undated instead of filing them under this month', async () => {
            // Attributing unpriced spend to a month it may not belong to is how
            // a reconciliation that looks complete hides the rows that need
            // attention.
            await reservation({ localDate: null, market: null, charged: 1, settledMinor: 0 });
            await reservation({ localDate: dayIn(0), charged: 1, settledMinor: 100 });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 1 });
            expect(rows.map(row => row.month)).toEqual([thisMonth(), null]);
            expect(monthOf(rows, null)!.chargedDeliveries).toBe(1);
            expect(monthOf(rows, thisMonth())!.chargedDeliveries).toBe(1);
        });

        it('keeps an undated row visible however far back the window goes', async () => {
            // It has no month, so no window can exclude it — and a window that
            // did would make it disappear rather than get resolved.
            await reservation({ localDate: null, charged: 1 });
            expect(await readCalendarMonthConsumption(query, schema, { months: 1 }))
                .toHaveLength(1);
        });
    });

    describe('the window', () => {
        it('excludes a month older than the one asked for', async () => {
            await reservation({ localDate: dayIn(0) });
            await reservation({ localDate: dayIn(5) });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 2 });
            expect(rows.map(row => row.month)).toEqual([thisMonth()]);
        });

        it('bounds an absurd request rather than scanning the whole table', async () => {
            // 9999 months is a full scan of the busiest table a tenant has,
            // asked for by a query string. The bound has to be OBSERVABLE, or
            // this test passes whether or not it exists: a row further back
            // than the ceiling must be excluded even though the caller asked
            // for it.
            await reservation({ localDate: dayIn(0) });
            await reservation({ localDate: dayIn(30) });
            const rows = await readCalendarMonthConsumption(query, schema, { months: 9_999 });
            expect(rows.map(row => row.month)).toEqual([thisMonth()]);
        });

        it('defaults to three months when nobody says', async () => {
            await reservation({ localDate: dayIn(0) });
            await reservation({ localDate: dayIn(2) });
            await reservation({ localDate: dayIn(4) });
            expect((await readCalendarMonthConsumption(query, schema, {})).map(row => row.month))
                .toEqual([thisMonth(), dayIn(2).slice(0, 7)]);
        });
    });
});
