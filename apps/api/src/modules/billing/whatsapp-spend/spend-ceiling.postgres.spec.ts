import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    declareSpendCeiling, readSpendCeilings, readPressure, reserveAgainstCounter,
    type SpendQuery,
} from './spend-ledger';

/**
 * ═══ A CEILING SOMEBODY SET, AND WHAT IT ACTUALLY STOPS ═══
 *
 * `whatsapp_spend_counters` has had the cap columns since the ledger was built,
 * and the reservation path has always honoured them — but nothing ever wrote a
 * standing one. The only rows anybody created were the free-allowance counter
 * and per-task budgets, so a tenant could not say "never more than fifty
 * dollars a month on this number", which is the first thing somebody asks for
 * when messages start costing money.
 *
 * The sharper gap is the one this suite spends most of its cases on: a ceiling
 * could be money OR messages, never both. The thousand free service deliveries
 * per number per calendar month are a MESSAGE quota that costs nothing, so a
 * money ceiling does not limit them at all — the whole franchise can be burned
 * without the money ceiling moving, and from then on every message is charged.
 * That is the moment the money ceiling starts working, already too late.
 *
 * Every assertion is against real PostgreSQL and the real constraints, because
 * half of what is being pinned here IS a constraint.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('a standing ceiling on what Parallly sends', () => {
    const schema = `tenant_ceiling_${randomUUID().replace(/-/g, '')}`;
    let client: Client;
    jest.setTimeout(180_000);

    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const scope = (kind: any = 'account') => ({
        kind, key: `k-${randomUUID()}`, period: '2026-10',
    });

    /** Spend against a ceiling the way a producer does, in one transaction. */
    const spend = async (on: any, over: {
        amountMinor?: number; deliveries?: number;
        disposition?: 'reactive' | 'proactive';
    } = {}) =>
        reserveAgainstCounter(query, schema, {
            scope: on, amountMinor: over.amountMinor ?? 0, deliveries: over.deliveries ?? 1,
            currency: 'USD', disposition: over.disposition ?? 'proactive',
        });

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await query(`CREATE SCHEMA "${schema}"`);
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
            if (!/^tenant_ceiling_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    describe('money and messages apply together', () => {
        it('stores both ceilings on one scope', async () => {
            // The constraint used to forbid this outright.
            const on = scope();
            const ceiling = await declareSpendCeiling(query, schema, {
                scope: on, capMinor: 5_000, capDeliveries: 100, currency: 'USD',
            });
            expect(ceiling.capKind).toBe('both');
            expect(ceiling.capMinor).toBe(5_000);
            expect(ceiling.capDeliveries).toBe(100);
        });

        it('stops on the MESSAGE ceiling even when the money ceiling is untouched', async () => {
            // THE CASE THIS EXISTS FOR. Free service deliveries cost nothing,
            // so a money ceiling never fills. With only a money ceiling the
            // whole franchise burns and nothing refuses.
            const on = scope();
            await declareSpendCeiling(query, schema, {
                scope: on, capMinor: 1_000_000, capDeliveries: 3, currency: 'USD',
                warnPermille: 999, softPermille: 1000,
            });
            for (let i = 0; i < 3; i++) {
                expect((await spend(on, { amountMinor: 0 })).ok).toBe(true);
            }
            const refused = await spend(on, { amountMinor: 0 });
            expect(refused.ok).toBe(false);
            expect(refused.pressure).toBe('hard_stop');
        });

        it('stops on the MONEY ceiling even when the message ceiling is untouched', async () => {
            const on = scope();
            await declareSpendCeiling(query, schema, {
                scope: on, capMinor: 100, capDeliveries: 1_000_000, currency: 'USD',
                warnPermille: 999, softPermille: 1000,
            });
            expect((await spend(on, { amountMinor: 90 })).ok).toBe(true);
            const refused = await spend(on, { amountMinor: 90 });
            expect(refused.ok).toBe(false);
            expect(refused.pressure).toBe('hard_stop');
        });

        it('reports the WORSE of the two pressures, not the first one checked', async () => {
            const on = scope();
            await declareSpendCeiling(query, schema, {
                scope: on, capMinor: 1_000_000, capDeliveries: 10, currency: 'USD',
                warnPermille: 500, softPermille: 900,
            });
            // Nine of ten messages: the delivery side is at its soft line
            // while the money side is nowhere near anything. Reactive, because
            // the soft stop would refuse the ninth PROACTIVE one — which is the
            // stop working, and would leave eight on the counter and the
            // pressure a step lower than the case is about.
            for (let i = 0; i < 9; i++) {
                expect((await spend(on, { amountMinor: 1, disposition: 'reactive' })).ok).toBe(true);
            }
            expect(await readPressure(query, schema, [on])).toBe('soft_stop');
        });
    });

    describe('setting one at all', () => {
        it.each([
            ['money only', { capMinor: 500, currency: 'USD' }, 'money'],
            ['messages only', { capDeliveries: 50 }, 'deliveries'],
            ['neither', {}, 'observe'],
        ])('records %s as %s', async (_case, over, expected) => {
            const ceiling = await declareSpendCeiling(query, schema, { scope: scope(), ...over });
            expect(ceiling.capKind).toBe(expected);
        });

        it('keeps counting but stops refusing when set to observe', async () => {
            // A real operator choice: "I want to see it before I limit it."
            // Deliberately not the same as deleting the row, which would throw
            // away what has been counted.
            const on = scope();
            await declareSpendCeiling(query, schema,
                { scope: on, capDeliveries: 1, warnPermille: 999, softPermille: 1000 });
            await spend(on);
            expect((await spend(on)).ok).toBe(false);

            await declareSpendCeiling(query, schema, { scope: on });
            const after = await spend(on);
            expect(after.ok).toBe(true);
            expect(after.pressure).toBe('clear');
            // And the count survived the change.
            const [stored] = await readSpendCeilings(query, schema, { periodKey: '2026-10' })
                .then(rows => rows.filter(row => row.scopeKey === on.key));
            expect(stored.usedDeliveries).toBeGreaterThanOrEqual(2);
        });

        it('refuses a money ceiling in no currency rather than defaulting one', async () => {
            // "50" in a currency nobody named is a number that will be read as
            // whichever currency the reader expects.
            await expect(declareSpendCeiling(query, schema, { scope: scope(), capMinor: 5_000 }))
                .rejects.toMatchObject({ message: expect.stringContaining('currency_required') });
        });

        it('refuses thresholds that cross over', async () => {
            await expect(declareSpendCeiling(query, schema, {
                scope: scope(), capDeliveries: 10, warnPermille: 900, softPermille: 500,
            })).rejects.toMatchObject({ message: expect.stringContaining('out_of_order') });
        });

        it('ignores a negative ceiling rather than storing it', async () => {
            const ceiling = await declareSpendCeiling(query, schema,
                { scope: scope(), capMinor: -5, capDeliveries: -1 });
            expect(ceiling.capKind).toBe('observe');
        });
    });

    describe('changing one', () => {
        it('lowers a ceiling ABSOLUTELY, below what was already spent', async () => {
            // A task budget tops itself up from where the task already is, so a
            // relaunch is not capped below its own progress. A standing ceiling
            // is the opposite: somebody lowering a monthly limit below the
            // spend means STOP, and silently raising it to what was already
            // spent would be the system overruling the person.
            const on = scope();
            await declareSpendCeiling(query, schema,
                { scope: on, capDeliveries: 100, warnPermille: 999, softPermille: 1000 });
            for (let i = 0; i < 5; i++) await spend(on);

            const lowered = await declareSpendCeiling(query, schema,
                { scope: on, capDeliveries: 2, warnPermille: 999, softPermille: 1000 });
            expect(lowered.capDeliveries).toBe(2);
            expect(lowered.usedDeliveries).toBe(5);
            const refused = await spend(on);
            expect(refused.ok).toBe(false);
            expect(refused.pressure).toBe('hard_stop');
        });

        it('raises one without losing what has been counted', async () => {
            const on = scope();
            await declareSpendCeiling(query, schema,
                { scope: on, capDeliveries: 2, warnPermille: 999, softPermille: 1000 });
            await spend(on);
            await spend(on);
            expect((await spend(on)).ok).toBe(false);

            const raised = await declareSpendCeiling(query, schema,
                { scope: on, capDeliveries: 10, warnPermille: 999, softPermille: 1000 });
            expect(raised.usedDeliveries).toBe(2);
            expect((await spend(on)).ok).toBe(true);
        });

        it('can drop the money half and keep the message half', async () => {
            const on = scope();
            await declareSpendCeiling(query, schema,
                { scope: on, capMinor: 500, capDeliveries: 10, currency: 'USD' });
            const after = await declareSpendCeiling(query, schema,
                { scope: on, capDeliveries: 10 });
            expect(after.capKind).toBe('deliveries');
            expect(after.capMinor).toBeNull();
        });
    });

    describe('reading them back', () => {
        it('lists every scope in a period with what is committed against it', async () => {
            const period = `2026-${String(Math.floor(Math.random() * 9) + 1).padStart(2, '0')}`;
            const account = { kind: 'account' as const, key: `a-${randomUUID()}`, period };
            const number = { kind: 'number_month' as const, key: `n-${randomUUID()}`, period };
            await declareSpendCeiling(query, schema,
                { scope: account, capMinor: 5_000, currency: 'USD' });
            await declareSpendCeiling(query, schema, { scope: number, capDeliveries: 1_000 });
            await spend(account, { amountMinor: 250 });

            const rows = await readSpendCeilings(query, schema, { periodKey: period });
            expect(rows).toHaveLength(2);
            const stored = rows.find(row => row.scopeKey === account.key)!;
            expect(stored.capMinor).toBe(5_000);
            expect(stored.currency).toBe('USD');
            expect(stored.reservedMinor + stored.settledMinor).toBe(250);
        });

        it('narrows to one kind of scope when asked', async () => {
            const period = `2027-${String(Math.floor(Math.random() * 9) + 1).padStart(2, '0')}`;
            await declareSpendCeiling(query, schema,
                { scope: { kind: 'account', key: `a-${randomUUID()}`, period }, capDeliveries: 1 });
            await declareSpendCeiling(query, schema,
                { scope: { kind: 'contact', key: `c-${randomUUID()}`, period }, capDeliveries: 1 });
            const rows = await readSpendCeilings(query, schema,
                { periodKey: period, scopeKind: 'contact' });
            expect(rows.map(row => row.scopeKind)).toEqual(['contact']);
        });
    });
});
