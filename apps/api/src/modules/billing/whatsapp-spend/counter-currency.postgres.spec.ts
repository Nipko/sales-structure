import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import {
    ensureCounters, reserveAgainstCounter, type SpendQuery,
} from './spend-ledger';

/**
 * ═══ MINOR UNITS OF WHAT ═══
 *
 * `reserved_minor` counts minor units, and which currency's minor units is a
 * fact about the COUNTER, not about the addition. The primary key is (scope,
 * period) with the currency as an ordinary column, so a month that opened with
 * a USD reservation and later received a COP one simply added the two:
 *
 *   3 500 COP centavos + 8 US cents = 3 508 "minor units" of nothing.
 *
 * At roughly 4 000 COP to the dollar that is a factor-of-four-thousand error,
 * and it runs in the direction that makes a ceiling look full — so the visible
 * symptom is a tenant who cannot send, with a number on the screen that is not
 * wrong by a rounding error but by three orders of magnitude.
 *
 * The refusal is deliberately not a cap refusal. No budget fixes it, no retry
 * gets past it, and an operator who reads "limit reached" will raise the limit
 * and make it worse. Somebody has to decide which currency the period is in.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('a counter keeps its numbers in one currency', () => {
    const schema = `tenant_currency_${randomUUID().replace(/-/g, '')}`;
    let client: Client;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const account = (key: string) => ({ kind: 'account' as const, key, period: '2026-10' });

    /** Read from the table, never from the call that wrote it. */
    const counter = async (key: string) => (await q(
        `SELECT currency, reserved_minor FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind='account' AND scope_key=$1 AND period_key='2026-10'`, [key]))[0];

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${schema}"`);
        const tenantSchema = readFileSync(
            resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';')
            .filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_currency_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    it('accepts an amount in its own currency, so the refusal below means something', async () => {
        const key = `same-${randomUUID()}`;
        await ensureCounters(query, schema, [account(key)], 'USD');
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind='money', cap_minor=100000, cap_deliveries=NULL, currency='USD'
                  WHERE scope_key=$1`, [key]);

        expect(await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 8, deliveries: 1, currency: 'USD',
        })).toMatchObject({ ok: true });
        expect(Number((await counter(key)).reserved_minor)).toBe(8);
    });

    it('refuses an amount in another currency instead of adding it', async () => {
        const key = `mixed-${randomUUID()}`;
        await ensureCounters(query, schema, [account(key)], 'USD');
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind='money', cap_minor=100000, cap_deliveries=NULL, currency='USD'
                  WHERE scope_key=$1`, [key]);
        await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 8, deliveries: 1, currency: 'USD',
        });

        const outcome = await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 3_500, deliveries: 1, currency: 'COP',
        });
        expect(outcome).toMatchObject({
            ok: false, refusal: 'currency', counterCurrency: 'USD',
        });
        // And nothing moved. The old behaviour left 3 508 here.
        expect(Number((await counter(key)).reserved_minor)).toBe(8);
    });

    it('says `currency`, not `cap`, because the two need opposite answers', async () => {
        // An operator reading "limit reached" raises the limit, which makes a
        // currency mix-up worse rather than better.
        const key = `named-${randomUUID()}`;
        await ensureCounters(query, schema, [account(key)], 'USD');
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind='money', cap_minor=100000, cap_deliveries=NULL, currency='USD'
                  WHERE scope_key=$1`, [key]);
        const cop = await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 1, deliveries: 1, currency: 'COP',
        });
        expect(cop.refusal).toBe('currency');

        // Whereas a genuine ceiling still says `cap`, at the height that said it.
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_minor=0 WHERE scope_key=$1`, [key]);
        const full = await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 1, deliveries: 1, currency: 'USD',
        });
        expect(full).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
    });

    it('refuses however much room the ceiling has', async () => {
        // The currency test is not a ceiling test wearing a hat. An empty
        // counter with a huge cap still refuses, because the problem is what
        // the numbers mean and not how many of them there is room for.
        const key = `empty-${randomUUID()}`;
        await ensureCounters(query, schema, [account(key)], 'USD');
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind='money', cap_minor=999999999, cap_deliveries=NULL, currency='USD'
                  WHERE scope_key=$1`, [key]);
        expect(await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 1, deliveries: 1, currency: 'COP',
        })).toMatchObject({ ok: false, refusal: 'currency' });
    });

    it('refuses on an `observe` counter too, which otherwise allows everything', async () => {
        // `observe` exists to know rather than to stop, and a measurement in
        // the wrong units is not knowledge. This is the case that would
        // otherwise slip through every ceiling test: a tenant in `observe` is
        // exactly the tenant nobody is watching yet.
        const key = `observe-${randomUUID()}`;
        await ensureCounters(query, schema, [account(key)], 'USD');
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET currency='USD' WHERE scope_key=$1`, [key]);
        expect((await counter(key)).currency).toBe('USD');
        expect(await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 3_500, deliveries: 1, currency: 'COP',
        })).toMatchObject({ ok: false, refusal: 'currency' });
        expect(Number((await counter(key)).reserved_minor)).toBe(0);
    });

    it('accepts anything while the counter has committed to no currency', async () => {
        // A row created before a currency was ever established is not a
        // conflict; refusing it would be inventing one. The FIRST reservation
        // is what a period's currency comes from.
        const key = `blank-${randomUUID()}`;
        await q(`INSERT INTO "${schema}".whatsapp_spend_counters
                    (scope_kind, scope_key, period_key, cap_kind)
                 VALUES ('account', $1, '2026-10', 'observe')`, [key]);
        expect(await reserveAgainstCounter(query, schema, {
            scope: account(key), amountMinor: 3_500, deliveries: 1, currency: 'COP',
        })).toMatchObject({ ok: true });
    });

    it('holds under two connections racing with different currencies', async () => {
        // The test is a PREDICATE in the same statement as the cap, for the
        // same reason the cap is: read-then-write leaves a window two workers
        // can both pass through, and one of them would be adding centavos.
        const key = `race-${randomUUID()}`;
        await ensureCounters(query, schema, [account(key)], 'USD');
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind='money', cap_minor=100000, cap_deliveries=NULL, currency='USD'
                  WHERE scope_key=$1`, [key]);

        const other = new Client({ connectionString: connection });
        await other.connect();
        try {
            const otherQuery: SpendQuery = async <R = any[]>(
                sql: string, params: any[] = []): Promise<R> =>
                (await other.query(sql, params)).rows as any;
            const [usd, cop] = await Promise.all([
                reserveAgainstCounter(query, schema, {
                    scope: account(key), amountMinor: 8, deliveries: 1, currency: 'USD',
                }),
                reserveAgainstCounter(otherQuery, schema, {
                    scope: account(key), amountMinor: 3_500, deliveries: 1, currency: 'COP',
                }),
            ]);
            expect(usd.ok).toBe(true);
            expect(cop).toMatchObject({ ok: false, refusal: 'currency' });
            expect(Number((await counter(key)).reserved_minor)).toBe(8);
        } finally { await other.end(); }
    });
});
