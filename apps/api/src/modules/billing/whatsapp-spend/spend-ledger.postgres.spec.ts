import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    adoptReservation, claimReservation, declareTaskBudget, ensureCounters, findReservation,
    grantFreeDeliveries,
    readExposure, readPressure, readSpendSignals, recentIdenticalDeliveries, recordAllocation,
    releaseReservation, reserveAgainstCounter, retainReservation, settleReservation,
    sweepExpiredLeases,
    type ReservationIdentity, type SpendQuery,
} from './spend-ledger';
import { scopesFor } from './spend-scopes';
import { DEFAULT_REPETITION_POLICY, judgeRepetition } from './spend-repetition';

/**
 * ═══ THE MONEY ENGINE AGAINST A REAL POSTGRESQL ═══
 *
 * Every case here is one of the three failures the design exists for, and none
 * of them can be shown with a doubled database:
 *
 *   1. Two producers take the last budget at the same time. Concurrent
 *      transactions on real rows, not sequential calls — a sequential test
 *      passes against a design that has no locking at all.
 *   2. A timeout after acceptance. The reservation must stay counted; releasing
 *      it is how money gets spent with nothing holding it.
 *   3. An uncertain COMMIT. The worker reconnects and reaches the SAME
 *      reservation through `effect_key`, or discovers there is none.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the WhatsApp spend engine', () => {
    const schema = `tenant_spendengine_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    jest.setTimeout(120_000);

    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const identity = (over: Partial<ReservationIdentity> = {}): ReservationIdentity => ({
        tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
        channelAddress: '+1 555 000 1111',
        payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
        credentialId: 'cred-1', credentialSource: 'system_user',
        recipientScope: 'customer', recipientRef: 'contact-1',
        category: 'service', market: 'CO', currency: 'USD',
        rateVersion: 'card-2026-10', appliedLocalDate: '2026-10-05',
        admissionReason: 'inbound_reply', ...over,
    });

    const money = (reservedMinor: number, over: Record<string, unknown> = {}) => ({
        basis: 'priced' as const, decision: 'accepted' as const,
        reservedMinor, unitCeilingMinor: 100, exactMicros: reservedMinor * 10_000,
        freeDeliveries: 0, chargedDeliveries: 1, ...over,
    });

    /** A counter with a money ceiling, reset for each case. */
    const moneyCounter = async (scopeKey: string, capMinor: number) => {
        await query(`INSERT INTO "${schema}".whatsapp_spend_counters
            (scope_kind, scope_key, period_key, cap_kind, cap_minor, currency)
            VALUES ('account',$1,'2026-10','money',$2,'USD')
            ON CONFLICT (scope_kind, scope_key, period_key)
            DO UPDATE SET cap_kind='money', cap_minor=$2, cap_deliveries=NULL, currency='USD',
                reserved_minor=0, settled_minor=0, released_minor=0, used_deliveries=0`,
            [scopeKey, capMinor]);
    };

    const counterRow = async (scopeKey: string) => (await query<any[]>(
        `SELECT * FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind='account' AND scope_key=$1 AND period_key='2026-10'`, [scopeKey]))[0];

    /** One full reserve: lock, check the cap, claim, allocate. In one transaction. */
    const reserveOn = async (runner: Client, scopeKey: string, effectKey: string, amount: number,
        disposition: 'reactive' | 'proactive' = 'reactive') => {
        const run: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
            (await runner.query(sql, params)).rows as any;
        const scope = { kind: 'account' as const, key: scopeKey, period: '2026-10' };
        const outcome = await reserveAgainstCounter(run, schema, {
            scope, amountMinor: amount, deliveries: 1, currency: 'USD', disposition,
        });
        if (!outcome.ok) return { allowed: false as const, pressure: outcome.pressure };
        const reservation = await claimReservation(run, schema, {
            effectKey, identity: identity(), money: money(amount), leaseSeconds: 60,
        });
        if (reservation) await recordAllocation(run, schema, reservation.id,
            { scope, amountMinor: amount, deliveries: 1, currency: 'USD' }, 'USD');
        return { allowed: true as const, reservation, pressure: outcome.pressure };
    };

    /** How many backends are currently blocked on a lock in this database. */
    const blockedBackends = async (): Promise<number> => {
        const [row] = await query<any[]>(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
              WHERE wait_event_type = 'Lock' AND datname = current_database()`);
        return Number(row?.waiting ?? 0);
    };

    /** Wait on a condition, never on the clock. */
    const until = async (what: string, condition: () => Promise<boolean>, timeoutMs = 15_000) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (await condition()) return;
            if (Date.now() > deadline) throw new Error(`timed_out_waiting_for: ${what}`);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
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
            if (!/^tenant_spendengine_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    describe('two producers and one last amount', () => {
        it('lets exactly one through, and the sum never exceeds the cap', async () => {
            // 80 cents left, two producers each wanting 60.
            //
            // The interleaving is written out rather than raced with
            // `Promise.all`, because the second transaction BLOCKS on the row
            // lock until the first commits — and a `Promise.all` that awaits
            // both before committing either simply hangs. Spelling it out is
            // also what makes the assertion meaningful: the second writer is
            // provably still holding a lock when the first commits, so what
            // refuses it is the re-evaluated predicate and not luck.
            const scopeKey = `race-${randomUUID()}`;
            await moneyCounter(scopeKey, 80);

            const [left, right] = [new Client({ connectionString: connection }),
                new Client({ connectionString: connection })];
            await Promise.all([left.connect(), right.connect()]);
            try {
                await left.query('BEGIN');
                await right.query('BEGIN');

                // The first takes the row and holds it.
                const first = await reserveOn(left, scopeKey, `race-a-${randomUUID()}`, 60);
                expect(first.allowed).toBe(true);

                // The second starts and blocks. Not awaited yet, on purpose.
                const contending = reserveOn(right, scopeKey, `race-b-${randomUUID()}`, 60);
                await until('the second writer to be waiting on the row lock',
                    async () => (await blockedBackends()) > 0);

                await left.query('COMMIT');
                const second = await contending;
                await right.query('COMMIT');

                // The predicate re-evaluated against what the first committed.
                expect(second.allowed).toBe(false);
                const counter = await counterRow(scopeKey);
                expect(Number(counter.reserved_minor)).toBe(60);
                expect(Number(counter.reserved_minor)).toBeLessThanOrEqual(Number(counter.cap_minor));
            } finally { await Promise.all([left.end(), right.end()]); }
        });

        it('lets both through when both fit, so the refusal is the cap and not the lock', async () => {
            const scopeKey = `fits-${randomUUID()}`;
            await moneyCounter(scopeKey, 200);
            const [left, right] = [new Client({ connectionString: connection }),
                new Client({ connectionString: connection })];
            await Promise.all([left.connect(), right.connect()]);
            try {
                await left.query('BEGIN');
                await right.query('BEGIN');
                const first = await reserveOn(left, scopeKey, `fit-a-${randomUUID()}`, 60);
                const contending = reserveOn(right, scopeKey, `fit-b-${randomUUID()}`, 60);
                await until('the second writer to be waiting on the row lock',
                    async () => (await blockedBackends()) > 0);
                await left.query('COMMIT');
                const second = await contending;
                await right.query('COMMIT');
                // Same contention, different ceiling: both fit, so both pass.
                expect([first.allowed, second.allowed]).toEqual([true, true]);
                expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(120);
            } finally { await Promise.all([left.end(), right.end()]); }
        });
    });

    describe('two producers and the thousandth free delivery', () => {
        it('grants it to one of them and prices the other', async () => {
            // 999 used of 1,000. Deciding the split before the lock is the same
            // read-then-write bug: both would see one free and only one is.
            const scopeKey = `free-${randomUUID()}`;
            await query(`INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, cap_deliveries, used_deliveries)
                VALUES ('number_month',$1,'2026-10','deliveries',1000,999)`, [scopeKey]);
            const scope = { kind: 'number_month' as const, key: scopeKey, period: '2026-10' };
            const asQuery = (runner: Client): SpendQuery =>
                async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
                    (await runner.query(sql, params)).rows as any;

            const [left, right] = [new Client({ connectionString: connection }),
                new Client({ connectionString: connection })];
            await Promise.all([left.connect(), right.connect()]);
            try {
                await left.query('BEGIN');
                await right.query('BEGIN');
                const first = await grantFreeDeliveries(asQuery(left), schema, scope, 1);
                const contending = grantFreeDeliveries(asQuery(right), schema, scope, 1);
                await until('the second writer to be waiting on the allowance row',
                    async () => (await blockedBackends()) > 0);
                await left.query('COMMIT');
                const second = await contending;
                await right.query('COMMIT');
                // One free, one priced. Never two free out of one.
                expect([first, second].sort()).toEqual([0, 1]);
            } finally { await Promise.all([left.end(), right.end()]); }
        });
    });

    describe('a timeout after acceptance', () => {
        it('keeps the whole amount counted and never releases', async () => {
            const effectKey = `timeout-${randomUUID()}`;
            const scopeKey = `timeout-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 8);

            const retained = await retainReservation(query, schema, {
                effectKey, state: 'indeterminate', reason: 'timeout_without_message_id',
                remoteState: 'unknown',
            });
            expect(retained?.state).toBe('indeterminate');
            // The exposure is the FULL amount, not zero and not a fraction.
            const counter = await counterRow(scopeKey);
            expect(Number(counter.reserved_minor)).toBe(8);
            expect(Number(counter.released_minor)).toBe(0);
        });

        it('is not turned into a release by the lease sweeper', async () => {
            // A reservation held by a crashed worker would otherwise pin budget
            // forever. But the attempt may have reached the provider, so the
            // sweeper makes it VISIBLE rather than giving the money back.
            const effectKey = `sweep-${randomUUID()}`;
            const scopeKey = `sweep-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 8);
            await query(`UPDATE "${schema}".whatsapp_spend_reservations
                SET lease_expires_at = clock_timestamp() - INTERVAL '1 minute'
                WHERE effect_key = $1`, [effectKey]);

            expect(await sweepExpiredLeases(query, schema)).toContain(effectKey);
            const row = await findReservation(query, schema, effectKey);
            expect(row?.state).toBe('indeterminate');
            expect(Number((await counterRow(scopeKey)).released_minor)).toBe(0);
        });

        it('leaves a live lease alone', async () => {
            const effectKey = `live-${randomUUID()}`;
            const scopeKey = `live-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 8);
            expect(await sweepExpiredLeases(query, schema)).not.toContain(effectKey);
            expect((await findReservation(query, schema, effectKey))?.state).toBe('held');
        });
    });

    describe('an uncertain COMMIT', () => {
        it('finds the same reservation through the effect key when it committed', async () => {
            const effectKey = `commit-yes-${randomUUID()}`;
            const scopeKey = `commit-yes-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            const first = await reserveOn(client, scopeKey, effectKey, 8);

            // A different connection is the closest thing to "the worker
            // reconnected": nothing in memory, only what was committed.
            const reconnected = new Client({ connectionString: connection });
            await reconnected.connect();
            try {
                const found = await findReservation(async (sql, params) =>
                    (await reconnected.query(sql, params as any[])).rows as any, schema, effectKey);
                expect(found?.id).toBe(first.reservation!.id);
            } finally { await reconnected.end(); }
        });

        it('finds nothing when it did not commit, so the retry claims cleanly', async () => {
            const effectKey = `commit-no-${randomUUID()}`;
            const scopeKey = `commit-no-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);

            const doomed = new Client({ connectionString: connection });
            await doomed.connect();
            try {
                await doomed.query('BEGIN');
                await reserveOn(doomed, scopeKey, effectKey, 8);
                await doomed.query('ROLLBACK');
            } finally { await doomed.end(); }

            expect(await findReservation(query, schema, effectKey)).toBeNull();
            // And the counter has nothing held for a reservation that never was.
            expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(0);
            // The retry then claims for real.
            const retry = await reserveOn(client, scopeKey, effectKey, 8);
            expect(retry.allowed).toBe(true);
        });

        it('adopts rather than claiming a second time', async () => {
            const effectKey = `adopt-${randomUUID()}`;
            const scopeKey = `adopt-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            const first = await reserveOn(client, scopeKey, effectKey, 8);

            const again = await claimReservation(query, schema, {
                effectKey, identity: identity(), money: money(8), leaseSeconds: 60,
            });
            expect(again).toBeNull(); // the unique key refused the second claim

            const adopted = await adoptReservation(query, schema, effectKey, 60);
            expect(adopted?.id).toBe(first.reservation!.id);
            expect(adopted?.adopted).toBe(1);
            // One reservation, one exposure. Not two.
            expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(8);
        });

        it('adopts a retained reservation with its uncertainty, not a fresh one', async () => {
            // A retry inherits the original doubt. Giving it a clean reservation
            // would be the platform forgetting that a message may already have
            // gone out.
            const effectKey = `adopt-unknown-${randomUUID()}`;
            const scopeKey = `adopt-unknown-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 8);
            await retainReservation(query, schema, {
                effectKey, state: 'indeterminate', reason: 'timeout_without_message_id',
            });
            const adopted = await adoptReservation(query, schema, effectKey, 60);
            expect(adopted?.state).toBe('indeterminate');
        });
    });

    describe('settling and releasing', () => {
        it('settles once, gives back the surplus and refuses a second settle', async () => {
            const effectKey = `settle-${randomUUID()}`;
            const scopeKey = `settle-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 10);

            const settled = await settleReservation(query, schema, {
                effectKey, chargedMinor: 6, evidence: 'provider_reported_price',
                providerMessageId: 'wamid.OUT', remoteState: 'delivered',
            });
            expect(settled?.state).toBe('settled');
            const counter = await counterRow(scopeKey);
            expect(Number(counter.settled_minor)).toBe(6);
            // The four cents of rounding come back rather than staying held.
            expect(Number(counter.released_minor)).toBe(4);
            expect(Number(counter.reserved_minor)).toBe(0);

            // Zero rows the second time is success, not an error to retry.
            expect(await settleReservation(query, schema, {
                effectKey, chargedMinor: 6, evidence: 'provider_reported_price',
            })).toBeNull();
            expect(Number((await counterRow(scopeKey)).settled_minor)).toBe(6);
        });

        it('releases a proven rejection in full', async () => {
            const effectKey = `reject-${randomUUID()}`;
            const scopeKey = `reject-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 8);

            const released = await releaseReservation(query, schema, {
                effectKey, evidence: 'provider_rejected_without_message_id',
                reason: 'wa_131047', remoteState: 'rejected',
            });
            expect(released?.state).toBe('released');
            const counter = await counterRow(scopeKey);
            expect(Number(counter.released_minor)).toBe(8);
            expect(Number(counter.settled_minor)).toBe(0);
            expect(Number(counter.reserved_minor)).toBe(0);
        });

        it('will not settle or release something already retained', async () => {
            // Only a reconciliation may move a retained row, and it is not this.
            const effectKey = `retained-${randomUUID()}`;
            const scopeKey = `retained-${randomUUID()}`;
            await moneyCounter(scopeKey, 1000);
            await reserveOn(client, scopeKey, effectKey, 8);
            await retainReservation(query, schema, {
                effectKey, state: 'pending_reconciliation', reason: 'delivered_without_price',
            });
            expect(await settleReservation(query, schema, {
                effectKey, chargedMinor: 8, evidence: 'late' })).toBeNull();
            expect(await releaseReservation(query, schema, {
                effectKey, evidence: 'late' })).toBeNull();
            expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(8);
        });
    });

    describe('several ceilings at once', () => {
        it('reserves against every scope and releases every one of them', async () => {
            // The reason the allocation table exists: one effect crosses the
            // account, the contact and the campaign, and a release that returns
            // to one of them leaves the other two permanently short.
            const run = randomUUID();
            const scopes = scopesFor({
                channelAccountId: `acct-${run}`, payerBusinessId: `biz-${run}`,
                contactId: `contact-${run}`, taskId: `task-${run}`,
                allowanceMonth: '2026-10', spendPeriod: '2026-10',
            });
            await ensureCounters(query, schema, scopes, 'USD');
            // Give the money scopes a real ceiling; the allowance stays observe.
            for (const scope of scopes) {
                if (scope.kind === 'number_month') continue;
                await query(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind='money', cap_minor=100, cap_deliveries=NULL, currency='USD'
                    WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
                    [scope.kind, scope.key, scope.period]);
            }

            const effectKey = `multi-${run}`;
            const money = scopes.filter(scope => scope.kind !== 'number_month');
            for (const scope of money) {
                expect(await reserveAgainstCounter(query, schema,
                    { scope, amountMinor: 8, deliveries: 1, currency: 'USD', disposition: 'reactive' }))
                    .toMatchObject({ ok: true, pressure: 'clear' });
            }
            const reservation = await claimReservation(query, schema, {
                effectKey, identity: identity(), money: {
                    basis: 'priced', decision: 'accepted', reservedMinor: 8,
                    unitCeilingMinor: 100, exactMicros: 80_000,
                    freeDeliveries: 0, chargedDeliveries: 1,
                }, leaseSeconds: 60,
            });
            for (const scope of money) {
                await recordAllocation(query, schema, reservation!.id,
                    { scope, amountMinor: 8, deliveries: 1, currency: 'USD' }, 'USD');
            }

            await releaseReservation(query, schema, {
                effectKey, evidence: 'provider_rejected_without_message_id',
            });
            for (const scope of money) {
                const [row] = await query<any[]>(`SELECT reserved_minor, released_minor
                    FROM "${schema}".whatsapp_spend_counters
                    WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
                    [scope.kind, scope.key, scope.period]);
                expect({ scope: scope.kind, reserved: Number(row.reserved_minor),
                    released: Number(row.released_minor) })
                    .toEqual({ scope: scope.kind, reserved: 0, released: 8 });
            }
        });

        it('refuses the whole effect when any one ceiling says no', async () => {
            // The strictest ceiling wins. A contact limit of zero stops a send
            // the account could easily afford.
            const run = randomUUID();
            const generous = { kind: 'account' as const, key: `wide-${run}`, period: '2026-10' };
            const tight = { kind: 'contact' as const, key: `tight-${run}`, period: '2026-10' };
            await ensureCounters(query, schema, [generous, tight], 'USD');
            await query(`UPDATE "${schema}".whatsapp_spend_counters
                SET cap_kind='money', cap_minor=10000, cap_deliveries=NULL, currency='USD'
                WHERE scope_kind='account' AND scope_key=$1`, [generous.key]);
            await query(`UPDATE "${schema}".whatsapp_spend_counters
                SET cap_kind='money', cap_minor=0, cap_deliveries=NULL, currency='USD'
                WHERE scope_kind='contact' AND scope_key=$1`, [tight.key]);

            expect(await reserveAgainstCounter(query, schema,
                { scope: generous, amountMinor: 8, deliveries: 1, currency: 'USD', disposition: 'reactive' }))
                .toMatchObject({ ok: true, pressure: 'clear' });
            expect(await reserveAgainstCounter(query, schema,
                { scope: tight, amountMinor: 8, deliveries: 1, currency: 'USD', disposition: 'reactive' }))
                .toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });

        it('never refuses on an observe-only counter', async () => {
            // Where every tenant starts: counting, stopping nobody.
            const scope = { kind: 'account' as const, key: `observe-${randomUUID()}`, period: '2026-10' };
            await ensureCounters(query, schema, [scope], 'USD');
            // And reports `clear`, not a warning: an observe counter has no
            // ceiling to be a fraction of, so there is nothing to be near.
            expect(await reserveAgainstCounter(query, schema,
                { scope, amountMinor: 999_999, deliveries: 1, currency: 'USD', disposition: 'proactive' }))
                .toMatchObject({ ok: true, pressure: 'clear' });
        });
    });

    describe('the three heights of one ceiling', () => {
        /**
         * A ceiling with thresholds, and a reservation asked for by one or the
         * other kind of producer.
         *
         * Everything here is about one question: can the platform stop a
         * campaign without stopping a reply? A single ceiling cannot — it lets
         * everything through and then nothing — and to a business owner that is
         * indistinguishable from an outage.
         */
        const tieredCounter = async (scopeKey: string, capMinor: number,
            warn = 800, soft = 950) => {
            await query(`INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, cap_minor, currency,
                 warn_permille, soft_permille)
                VALUES ('account',$1,'2026-10','money',$2,'USD',$3,$4)
                ON CONFLICT (scope_kind, scope_key, period_key)
                DO UPDATE SET cap_kind='money', cap_minor=$2, cap_deliveries=NULL, currency='USD',
                    warn_permille=$3, soft_permille=$4,
                    reserved_minor=0, settled_minor=0, released_minor=0, used_deliveries=0`,
                [scopeKey, capMinor, warn, soft]);
        };

        const reserve = (scopeKey: string, amount: number,
            disposition: 'reactive' | 'proactive') =>
            reserveAgainstCounter(query, schema, {
                scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                amountMinor: amount, deliveries: 1, currency: 'USD', disposition,
            });

        it('says nothing until the warning line, then names it', async () => {
            const scopeKey = `tier-warn-${randomUUID()}`;
            await tieredCounter(scopeKey, 1000);           // warn at 800, soft at 950
            expect((await reserve(scopeKey, 700, 'reactive')).pressure).toBe('clear');
            // 700 + 100 = 800, exactly the warning line. Inclusive on purpose:
            // a threshold that only fires above itself never fires on a round
            // number, and round numbers are what people configure.
            expect((await reserve(scopeKey, 100, 'reactive')).pressure).toBe('warning');
        });

        it('pauses what we start and keeps answering who wrote in', async () => {
            const scopeKey = `tier-soft-${randomUUID()}`;
            await tieredCounter(scopeKey, 1000);
            await reserve(scopeKey, 940, 'reactive');

            // A campaign asking for 20 would cross 950. Refused, and told which
            // height refused it — `soft_stop`, not the undifferentiated
            // "exhausted" that would send somebody to raise a ceiling that has
            // 6 % left.
            const campaign = await reserve(scopeKey, 20, 'proactive');
            expect(campaign).toMatchObject({ ok: false, pressure: 'soft_stop' });

            // The same 20 for a customer who wrote in goes through.
            const reply = await reserve(scopeKey, 20, 'reactive');
            expect(reply.ok).toBe(true);
            expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(960);
        });

        it('stops the reply too at the ceiling itself', async () => {
            const scopeKey = `tier-hard-${randomUUID()}`;
            await tieredCounter(scopeKey, 1000);
            await reserve(scopeKey, 990, 'reactive');
            // 990 + 20 is over the ceiling. The soft stop protects the reply
            // from the campaign; nothing protects it from the ceiling, and
            // pretending otherwise would be spending money nobody authorised.
            expect(await reserve(scopeKey, 20, 'reactive')).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
            expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(990);
        });

        it('honours a ceiling configured as a cliff, all the way to the cliff', async () => {
            // warn = soft = 1000 turns all three heights into one. Somebody who
            // wants the old behaviour must be able to have it, or "configurable"
            // is a word rather than a feature.
            //
            // The last assertion is the one that matters and the one that caught
            // a real off-by-one: the soft comparison is STRICTLY below, to agree
            // with the pressure function, so at 1000 it would have made the
            // effective ceiling `cap - 1` — a limit one lower than the number
            // written on it, for proactive sends only, silently.
            const scopeKey = `tier-cliff-${randomUUID()}`;
            await tieredCounter(scopeKey, 1000, 1000, 1000);
            expect(await reserve(scopeKey, 999, 'proactive')).toMatchObject({ ok: true, pressure: 'clear' });
            // The thousandth minor unit is inside the ceiling and must go.
            expect(await reserve(scopeKey, 1, 'proactive')).toMatchObject({ ok: true, pressure: 'hard_stop' });
            // The thousand-and-first is not.
            expect(await reserve(scopeKey, 1, 'proactive')).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });

        it('counts a delivery ceiling by the same three heights', async () => {
            // The free monthly allowance is a delivery cap, not a money cap, and
            // an operator watching "how full is it" must get the same three
            // answers from both or the UI has to explain two vocabularies.
            const scopeKey = `tier-deliv-${randomUUID()}`;
            await query(`INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, cap_deliveries, currency,
                 warn_permille, soft_permille)
                VALUES ('account',$1,'2026-10','deliveries',100,'USD',800,950)
                ON CONFLICT (scope_kind, scope_key, period_key) DO UPDATE
                    SET cap_kind='deliveries', cap_deliveries=100, used_deliveries=0`,
                [scopeKey]);
            const step = (deliveries: number, disposition: 'reactive' | 'proactive') =>
                reserveAgainstCounter(query, schema, {
                    scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                    amountMinor: 0, deliveries, currency: 'USD', disposition,
                });
            expect((await step(79, 'reactive')).pressure).toBe('clear');
            expect((await step(1, 'reactive')).pressure).toBe('warning');
            expect(await step(15, 'proactive')).toMatchObject({ ok: false, pressure: 'soft_stop' });
            expect((await step(15, 'reactive')).pressure).toBe('soft_stop');
            expect(await step(10, 'reactive')).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });

        it('refuses two campaigns that would cross the soft stop together', async () => {
            // The soft stop has to be a predicate inside the statement, not a
            // check the caller runs first. Read-then-decide is the same race the
            // ceiling itself exists to close: two campaign workers would both
            // read 94 % and both go, landing at 102 %.
            const scopeKey = `tier-race-${randomUUID()}`;
            await tieredCounter(scopeKey, 1000);
            await reserve(scopeKey, 940, 'reactive');

            const [left, right] = [new Client({ connectionString: connection }),
                new Client({ connectionString: connection })];
            await Promise.all([left.connect(), right.connect()]);
            try {
                await left.query('BEGIN');
                await right.query('BEGIN');
                const runner = (client_: Client): SpendQuery =>
                    async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
                        (await client_.query(sql, params)).rows as any;
                const ask = (run: SpendQuery) => reserveAgainstCounter(run, schema, {
                    scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                    amountMinor: 5, deliveries: 1, currency: 'USD', disposition: 'proactive',
                });
                // 940 + 5 = 945, still under 950. Both would pass alone.
                const first = await ask(runner(left));
                const contending = ask(runner(right));
                await until('the second campaign worker to be waiting on the row lock',
                    async () => (await blockedBackends()) > 0);
                await left.query('COMMIT');
                const second = await contending;
                await right.query('COMMIT');
                expect(first.ok).toBe(true);
                // 945 + 5 = 950, which IS the soft stop. Re-evaluated against
                // what the first committed, so the second is refused.
                expect(second).toMatchObject({ ok: false, pressure: 'soft_stop' });
                expect(Number((await counterRow(scopeKey)).reserved_minor)).toBe(945);
            } finally { await Promise.all([left.end(), right.end()]); }
        });

        it('reads a ceiling as full even when it reserves nothing', async () => {
            // What the adoption path needs: a retry adds no amount, and a reading
            // of `clear` because nothing was added would report a full account as
            // empty on every retry.
            const scopeKey = `tier-read-${randomUUID()}`;
            const scope = [{ kind: 'account' as const, key: scopeKey, period: '2026-10' }];
            await tieredCounter(scopeKey, 1000);

            await reserve(scopeKey, 990, 'reactive');
            // 990 of 1,000 is past the soft stop and NOT at the ceiling — which
            // is the whole point of having both. Asserting `hard_stop` here would
            // be asserting that 99 % and 100 % are the same state.
            expect(await readPressure(query, schema, scope)).toBe('soft_stop');

            await reserve(scopeKey, 10, 'reactive');
            expect(await readPressure(query, schema, scope)).toBe('hard_stop');
        });

        it('refuses to let a zero ceiling read as room', async () => {
            const scopeKey = `tier-zero-${randomUUID()}`;
            await tieredCounter(scopeKey, 0);
            expect(await reserve(scopeKey, 1, 'reactive')).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });

        it('refuses the thresholds themselves when they are out of order', async () => {
            // `warn <= soft <= ceiling` is a CHECK and not a convention. Inverted,
            // the warning would arrive after the cut and the soft stop would fire
            // before the warning — worse than having neither.
            await expect(query(`INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, cap_minor, currency,
                 warn_permille, soft_permille)
                VALUES ('account',$1,'2026-10','money',1000,'USD',950,800)`,
                [`tier-bad-${randomUUID()}`])).rejects.toThrow(/whatsapp_spend_counters_thresholds/);
        });
    });

    describe('a batch that cannot outspend its own launch', () => {
        /**
         * The property: a campaign launched for N people cannot produce more
         * than N charges, no matter how many workers run it at once.
         *
         * Nothing in the per-message ceilings gives this. An account cap is
         * shared with every other producer, and the batch's own size is known
         * only at launch — so the size becomes a ceiling of its own, declared
         * BEFORE the fanout, and contended on by every worker inside its own
         * statement.
         */
        const budget = (taskId: string, deliveries: number) =>
            declareTaskBudget(query, schema, { taskId, period: '2026-10', deliveries, currency: 'USD' });

        const task = (taskId: string) => ({ kind: 'task' as const, key: taskId, period: '2026-10' });

        const send = (run: SpendQuery, taskId: string) => reserveAgainstCounter(run, schema, {
            scope: task(taskId), amountMinor: 0, deliveries: 1,
            currency: 'USD', disposition: 'proactive',
        });

        it('declares a ceiling in deliveries, which needs no rate card', async () => {
            // The reason it is deliveries and not money: this must work for an
            // account whose price cannot be resolved at all. A ceiling that
            // depends on a rate card is absent exactly when pricing is broken,
            // which is when an unbounded batch is most expensive.
            const taskId = `budget-${randomUUID()}`;
            expect(await budget(taskId, 3)).toEqual({
                capKind: 'deliveries', capDeliveries: 3, capMinor: null, usedDeliveries: 0,
            });
        });

        it('lets exactly the launched number through and refuses the rest', async () => {
            const taskId = `budget-exact-${randomUUID()}`;
            await budget(taskId, 3);
            for (let i = 0; i < 3; i++) expect((await send(query, taskId)).ok).toBe(true);
            expect(await send(query, taskId)).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });

        it('holds when two workers reach the last slot together', async () => {
            // A sequential test passes against a budget checked in application
            // code. This one does not: the second worker is provably blocked on
            // the row lock when the first commits, so what refuses it is the
            // re-evaluated predicate.
            const taskId = `budget-race-${randomUUID()}`;
            await budget(taskId, 1);

            const [left, right] = [new Client({ connectionString: connection }),
                new Client({ connectionString: connection })];
            await Promise.all([left.connect(), right.connect()]);
            try {
                await left.query('BEGIN');
                await right.query('BEGIN');
                const runner = (c: Client): SpendQuery =>
                    async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
                        (await c.query(sql, params)).rows as any;
                const first = await send(runner(left), taskId);
                const contending = send(runner(right), taskId);
                await until('the second worker to be waiting on the batch ceiling',
                    async () => (await blockedBackends()) > 0);
                await left.query('COMMIT');
                const second = await contending;
                await right.query('COMMIT');
                expect(first.ok).toBe(true);
                expect(second).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
                const [row] = await query<any[]>(
                    `SELECT used_deliveries, cap_deliveries FROM "${schema}".whatsapp_spend_counters
                      WHERE scope_kind='task' AND scope_key=$1 AND period_key='2026-10'`, [taskId]);
                expect(Number(row.used_deliveries)).toBe(Number(row.cap_deliveries));
            } finally { await Promise.all([left.end(), right.end()]); }
        });

        it('tops the ceiling up from where the campaign already is, on a relaunch', async () => {
            // A relaunch queues only the recipients still pending. A ceiling set
            // to "the pending count" would hard-stop a campaign that had already
            // sent half of itself — the limit firing on the very thing it was
            // raised to allow.
            const taskId = `budget-relaunch-${randomUUID()}`;
            await budget(taskId, 5);
            for (let i = 0; i < 5; i++) await send(query, taskId);
            expect(await send(query, taskId)).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });

            expect(await budget(taskId, 2)).toEqual({
                capKind: 'deliveries', capDeliveries: 7, capMinor: null, usedDeliveries: 5,
            });
            expect((await send(query, taskId)).ok).toBe(true);
            expect((await send(query, taskId)).ok).toBe(true);
            expect(await send(query, taskId)).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });

        it('has no soft stop of its own, because nothing else shares it', async () => {
            // A shared ceiling pauses campaigns to protect replies. A batch's own
            // ceiling has no replies to protect — it is the campaign — so a soft
            // stop there would simply drop the last five per cent of recipients
            // and call the campaign finished.
            const taskId = `budget-soft-${randomUUID()}`;
            await budget(taskId, 20);
            const [row] = await query<any[]>(
                `SELECT warn_permille, soft_permille FROM "${schema}".whatsapp_spend_counters
                  WHERE scope_kind='task' AND scope_key=$1 AND period_key='2026-10'`, [taskId]);
            expect({ warn: row.warn_permille, soft: row.soft_permille })
                .toEqual({ warn: 800, soft: 1000 });
            // And the warning still fires, so a big batch is visibly filling.
            for (let i = 0; i < 15; i++) await send(query, taskId);
            expect((await send(query, taskId)).pressure).toBe('warning');
        });

        it('honours a money ceiling when an operator sets one', async () => {
            const taskId = `budget-money-${randomUUID()}`;
            expect(await declareTaskBudget(query, schema, {
                taskId, period: '2026-10', capMinor: 250, currency: 'USD',
            })).toEqual({ capKind: 'money', capMinor: 250, capDeliveries: null, usedDeliveries: 0 });
            const spend = (amount: number) => reserveAgainstCounter(query, schema, {
                scope: task(taskId), amountMinor: amount, deliveries: 1,
                currency: 'USD', disposition: 'proactive',
            });
            expect((await spend(200)).ok).toBe(true);
            // 200 of 250 is 80 %: the warning line, and still permitted.
            expect((await spend(0)).pressure).toBe('warning');
            expect(await spend(60)).toMatchObject({ ok: false, refusal: 'cap', pressure: 'hard_stop' });
        });
    });

    describe('the same thing, to the same person, again', () => {
        /**
         * A different question from the one `effect_key` answers.
         *
         * That key mixes the producer and the ordinal into the hash, so it
         * recognises a RETRY of one effect. It cannot recognise the same
         * sentence arriving by another road — which is exactly how the
         * appointment reminder and the drip step end up buying two charges and
         * two identical buzzes on one person's phone.
         */
        const claim = async (over: {
            effectKey: string; digest: string | null; recipient?: string;
            producer?: string; account?: string;
        }) => claimReservation(query, schema, {
            effectKey: over.effectKey,
            identity: identity({
                channelAccountId: over.account ?? '15550009999',
                recipientRef: over.recipient ?? 'contact-repeat',
                admissionReason: over.producer ?? 'outbound_queue',
            }),
            money: money(8), contentDigest: over.digest, leaseSeconds: 60,
        });

        const recent = (over: { digest: string; recipient?: string; account?: string }) =>
            recentIdenticalDeliveries(query, schema, {
                channelAccountId: over.account ?? '15550009999',
                recipientRef: over.recipient ?? 'contact-repeat',
                contentDigest: over.digest,
                since: new Date(Date.now() - DEFAULT_REPETITION_POLICY.windowMs),
            });

        it('finds the sentence another producer already delivered', async () => {
            const digest = `d-${randomUUID()}`;
            await claim({ effectKey: `rep-a-${randomUUID()}`, digest,
                producer: 'appointment_reminder' });
            const found = await recent({ digest });
            expect(found.map(entry => entry.producer)).toEqual(['appointment_reminder']);
            expect(judgeRepetition(found).allowed).toBe(false);
        });

        it('does not confuse two people who were sent the same sentence', async () => {
            // The comparison is per recipient. A template sent to a thousand
            // customers is one message each, not a thousand repeats.
            const digest = `d-${randomUUID()}`;
            await claim({ effectKey: `rep-b-${randomUUID()}`, digest, recipient: 'contact-one' });
            expect(await recent({ digest, recipient: 'contact-two' })).toEqual([]);
        });

        it('does not confuse two numbers of the same tenant', async () => {
            // A sales line and a support line are different senders, and a
            // customer who hears the same thing from both heard it from two
            // businesses as far as they are concerned.
            const digest = `d-${randomUUID()}`;
            await claim({ effectKey: `rep-c-${randomUUID()}`, digest, account: '15550001111' });
            expect(await recent({ digest, account: '15550002222' })).toEqual([]);
        });

        it('does not count a proven rejection as something the customer heard', async () => {
            // `released` means the provider refused it with no message id: the
            // customer received nothing, so trying again is not repeating.
            const digest = `d-${randomUUID()}`;
            const effectKey = `rep-d-${randomUUID()}`;
            await claim({ effectKey, digest });
            await releaseReservation(query, schema,
                { effectKey, evidence: 'provider_rejected_without_message_id' });
            expect(await recent({ digest })).toEqual([]);
            expect(judgeRepetition(await recent({ digest })).allowed).toBe(true);
        });

        it('counts an uncertain outcome, because the message may well have arrived', async () => {
            const digest = `d-${randomUUID()}`;
            const effectKey = `rep-e-${randomUUID()}`;
            await claim({ effectKey, digest });
            await retainReservation(query, schema,
                { effectKey, state: 'pending_reconciliation', reason: 'timeout' });
            expect((await recent({ digest })).length).toBe(1);
        });

        it('ignores rows that predate the digest column instead of guessing', async () => {
            // Every reservation written before this migration has `NULL` there.
            // `NULL` equals nothing, so those rows simply do not count as
            // repeats — which is right: we do not know what they said.
            const effectKey = `rep-f-${randomUUID()}`;
            await claim({ effectKey, digest: null });
            const [row] = await query<any[]>(
                `SELECT content_digest FROM "${schema}".whatsapp_spend_reservations
                  WHERE effect_key = $1`, [effectKey]);
            expect(row.content_digest).toBeNull();
            expect(await recent({ digest: 'anything' })).toEqual([]);
        });

        it('leaves a retry of one effect to adoption, not to the duplicate rule', async () => {
            // The order inside `authorize` is what makes this work: adopt first,
            // then ask about repeats. Reversed, every retry of a message would
            // be refused as its own duplicate and the effect would never
            // complete.
            const digest = `d-${randomUUID()}`;
            const effectKey = `rep-g-${randomUUID()}`;
            expect(await claim({ effectKey, digest })).not.toBeNull();
            // The retry finds ITSELF through the effect key.
            expect((await findReservation(query, schema, effectKey))?.effectKey).toBe(effectKey);
            // And it is the same single row the repeat check would see.
            expect((await recent({ digest })).map(entry => entry.effectKey)).toEqual([effectKey]);
        });
    });

    describe('the balance, against an oracle that does not share its arithmetic', () => {
        /**
         * ═══ WHAT A COUNTER MAY STILL AUTHORISE ═══
         *
         * Computed here from first principles and NOT from the SQL, because a
         * test that asks the implementation what the answer should be agrees
         * with it about a wrong answer. The rule, in words:
         *
         *     a ceiling may still authorise what it has not already committed,
         *     and it has committed what it SETTLED plus what it is still HOLDING.
         *
         * Money that was handed back is gone from the commitment — it is not a
         * second credit. `released_minor` is a historical metric: "what did this
         * account reserve and not use". Subtracting it from the balance a second
         * time turns every rejection into new budget.
         */
        const oracleAvailable = (row: {
            cap_minor: number | string; settled_minor: number | string;
            reserved_minor: number | string;
        }) => Number(row.cap_minor) - Number(row.settled_minor) - Number(row.reserved_minor);

        const tiered = async (scopeKey: string, capMinor: number) => {
            await query(`INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, cap_minor, currency,
                 warn_permille, soft_permille)
                VALUES ('account',$1,'2026-10','money',$2,'USD',1000,1000)
                ON CONFLICT (scope_kind, scope_key, period_key) DO UPDATE
                    SET cap_kind='money', cap_minor=$2, cap_deliveries=NULL, currency='USD',
                        warn_permille=1000, soft_permille=1000,
                        reserved_minor=0, settled_minor=0, released_minor=0, used_deliveries=0`,
                [scopeKey, capMinor]);
        };

        /** One whole effect: reserve, claim, allocate. */
        const effect = async (scopeKey: string, amount: number) => {
            const scope = { kind: 'account' as const, key: scopeKey, period: '2026-10' };
            const effectKey = `arith-${randomUUID()}`;
            const outcome = await reserveAgainstCounter(query, schema,
                { scope, amountMinor: amount, deliveries: 1, currency: 'USD', disposition: 'reactive' });
            if (!outcome.ok) return { effectKey, admitted: false as const };
            const reservation = await claimReservation(query, schema, {
                effectKey, identity: identity(), money: money(amount), leaseSeconds: 60,
            });
            await recordAllocation(query, schema, reservation!.id,
                { scope, amountMinor: amount, deliveries: 1, currency: 'USD' }, 'USD');
            return { effectKey, admitted: true as const };
        };

        /**
         * How much MORE this counter will actually authorise.
         *
         * Found by ASKING THE ENGINE — `reserveAgainstCounter` itself, inside a
         * transaction that is rolled back — and never by re-stating its
         * predicate here. A probe that copies the SQL is the same helper on both
         * sides of the comparison, and it would have agreed with the very bug
         * these tests exist to catch.
         */
        const reallyAvailable = async (scopeKey: string, ceiling: number) => {
            const scope = { kind: 'account' as const, key: scopeKey, period: '2026-10' };
            let low = 0;
            let high = ceiling;
            while (low < high) {
                const probe = Math.ceil((low + high + 1) / 2);
                await query('BEGIN');
                let fits = false;
                try {
                    fits = (await reserveAgainstCounter(query, schema,
                        { scope, amountMinor: probe, deliveries: 0, currency: 'USD', disposition: 'reactive' })).ok;
                } finally {
                    await query('ROLLBACK');
                }
                if (fits) low = probe; else high = probe - 1;
            }
            return low;
        };

        const counter = async (scopeKey: string) => (await query<any[]>(
            `SELECT cap_minor, reserved_minor, settled_minor, released_minor
               FROM "${schema}".whatsapp_spend_counters
              WHERE scope_kind='account' AND scope_key=$1 AND period_key='2026-10'`,
            [scopeKey]))[0];

        it('does not invent budget when a reservation settles for less', async () => {
            // Reserve 10, settle 6. Four were never spent and were handed back.
            // The ceiling has committed 6, so it may still authorise cap - 6.
            const scopeKey = `arith-partial-${randomUUID()}`;
            await tiered(scopeKey, 100);
            const first = await effect(scopeKey, 10);
            await settleReservation(query, schema,
                { effectKey: first.effectKey, chargedMinor: 6, evidence: 'status_webhook' });

            const row = await counter(scopeKey);
            expect({ reserved: Number(row.reserved_minor), settled: Number(row.settled_minor),
                released: Number(row.released_minor) })
                .toEqual({ reserved: 0, settled: 6, released: 4 });
            expect(await reallyAvailable(scopeKey, 200)).toBe(oracleAvailable(row));
        });

        it('does not turn a rejection into new budget', async () => {
            // The worst shape: reserve 8 against a ceiling of 8 and have Meta
            // refuse it. Nothing was spent, so the whole ceiling is available
            // again — and not one unit more.
            const scopeKey = `arith-reject-${randomUUID()}`;
            await tiered(scopeKey, 8);
            const first = await effect(scopeKey, 8);
            await releaseReservation(query, schema,
                { effectKey: first.effectKey, evidence: 'provider_rejected_without_message_id' });

            const row = await counter(scopeKey);
            expect(Number(row.released_minor)).toBe(8);
            expect(await reallyAvailable(scopeKey, 100)).toBe(oracleAvailable(row));
        });

        it('does not let repeated rejections raise the ceiling', async () => {
            // Each release adds to `released_minor`. Subtracted from the balance,
            // a contact that rejects everything becomes a way to mint budget.
            const scopeKey = `arith-repeat-${randomUUID()}`;
            await tiered(scopeKey, 20);
            for (let i = 0; i < 3; i++) {
                const one = await effect(scopeKey, 20);
                expect(one.admitted).toBe(true);
                await releaseReservation(query, schema,
                    { effectKey: one.effectKey, evidence: 'provider_rejected_without_message_id' });
            }
            const row = await counter(scopeKey);
            expect(Number(row.released_minor)).toBe(60);
            expect(await reallyAvailable(scopeKey, 500)).toBe(oracleAvailable(row));
        });

        it('keeps the ceiling honest across a settle and a later reservation', async () => {
            // The sequence the audit named: settle part of one effect, then ask
            // for another. The second must see what the first really cost.
            const scopeKey = `arith-then-${randomUUID()}`;
            await tiered(scopeKey, 10);
            const first = await effect(scopeKey, 10);
            await settleReservation(query, schema,
                { effectKey: first.effectKey, chargedMinor: 6, evidence: 'status_webhook' });

            const second = await effect(scopeKey, 5);
            // 10 − 6 = 4 left. Five does not fit.
            expect(second.admitted).toBe(false);
            const third = await effect(scopeKey, 4);
            expect(third.admitted).toBe(true);
            expect(await reallyAvailable(scopeKey, 100)).toBe(oracleAvailable(await counter(scopeKey)));
        });

        it('reports pressure from what is committed, not from what came back', async () => {
            // The same arithmetic drives the three heights. A ceiling reading
            // `clear` because half its money was rejected would warn nobody.
            const scopeKey = `arith-pressure-${randomUUID()}`;
            await tiered(scopeKey, 100);
            const first = await effect(scopeKey, 100);
            await settleReservation(query, schema,
                { effectKey: first.effectKey, chargedMinor: 100, evidence: 'status_webhook' });
            expect(await readPressure(query, schema,
                [{ kind: 'account', key: scopeKey, period: '2026-10' }])).toBe('hard_stop');

            const other = `arith-pressure-b-${randomUUID()}`;
            await tiered(other, 100);
            const rejected = await effect(other, 100);
            await releaseReservation(query, schema,
                { effectKey: rejected.effectKey, evidence: 'provider_rejected_without_message_id' });
            // Nothing was spent: the ceiling is empty again, not negative.
            expect(await readPressure(query, schema,
                [{ kind: 'account', key: other, period: '2026-10' }])).toBe('clear');
        });
    });

    describe('what the platform can report', () => {
        it('separates reserved, settled, retained and released, per currency', async () => {
            // One number for two currencies is not money. And "we owe this" and
            // "we might owe this" are different answers to an operator.
            const account = `report-${randomUUID()}`;
            const scopeKey = `report-${randomUUID()}`;
            await moneyCounter(scopeKey, 10_000);
            const since = new Date(Date.now() - 60_000);

            const held = `rep-held-${randomUUID()}`;
            const done = `rep-settled-${randomUUID()}`;
            const lost = `rep-unknown-${randomUUID()}`;
            for (const [key, amount] of [[held, 10], [done, 20], [lost, 30]] as const) {
                await reserveAgainstCounter(query, schema,
                    { scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                        amountMinor: amount, deliveries: 1, currency: 'USD' });
                const row = await claimReservation(query, schema, {
                    effectKey: key, identity: identity({ channelAccountId: account }),
                    money: money(amount), leaseSeconds: 600,
                });
                await recordAllocation(query, schema, row!.id,
                    { scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                        amountMinor: amount, deliveries: 1, currency: 'USD' }, 'USD');
            }
            await settleReservation(query, schema,
                { effectKey: done, chargedMinor: 18, evidence: 'provider_reported_price' });
            await retainReservation(query, schema,
                { effectKey: lost, state: 'indeterminate', reason: 'timeout_without_message_id' });

            const [exposure] = await readExposure(query, schema, { channelAccountId: account, since });
            expect(exposure).toMatchObject({
                currency: 'USD', reservedMinor: 10, settledMinor: 18, retainedMinor: 30,
            });
        });

        it('reports two currencies as two rows rather than one sum', async () => {
            const account = `two-cur-${randomUUID()}`;
            const scopeKey = `two-cur-${randomUUID()}`;
            await moneyCounter(scopeKey, 10_000);
            const since = new Date(Date.now() - 60_000);
            for (const currency of ['USD', 'COP']) {
                await claimReservation(query, schema, {
                    effectKey: `cur-${currency}-${randomUUID()}`,
                    identity: identity({ channelAccountId: account, currency }),
                    money: money(10), leaseSeconds: 600,
                });
            }
            const rows = await readExposure(query, schema, { channelAccountId: account, since });
            expect(rows.map(row => row.currency).sort()).toEqual(['COP', 'USD']);
        });
    });

    describe('what the ledger can honestly say about the month', () => {
        /**
         * Signals, not sentences.
         *
         * The point of `disposition` being stored: "twenty messages to somebody
         * who never wrote back" is a count of OUR sends, and the platform is
         * deliberately incapable of turning it into a statement about that
         * customer. Nothing here reads a word anybody typed.
         */
        // A fresh number per case. Sharing one made the category assertion pass
        // against a row a DIFFERENT test had written — the aggregate is grouped
        // by account, so every earlier case was still in it.
        const newAccount = () => `1555000${randomUUID().replace(/-/g, '').slice(0, 10)}`;

        const send = async (over: {
            account: string;
            recipient: string; disposition: 'reactive' | 'proactive';
            category?: string; market?: string; currency?: string;
            settle?: number | null; retain?: boolean;
        }) => {
            const effectKey = `sig-${randomUUID()}`;
            await claimReservation(query, schema, {
                effectKey,
                identity: identity({
                    channelAccountId: over.account, recipientRef: over.recipient,
                    category: over.category ?? 'service',
                    market: over.market ?? 'CO',
                    currency: over.currency ?? 'USD',
                }),
                money: money(10), disposition: over.disposition,
                contentDigest: `c-${randomUUID()}`, leaseSeconds: 60,
            });
            if (over.retain) {
                await retainReservation(query, schema,
                    { effectKey, state: 'pending_reconciliation', reason: 'timeout' });
            } else if (over.settle !== null && over.settle !== undefined) {
                await settleReservation(query, schema, {
                    effectKey, chargedMinor: over.settle, evidence: 'status_webhook',
                });
            }
            return effectKey;
        };

        const signals = (account: string) => readSpendSignals(query, schema, {
            since: new Date(Date.now() - 60 * 60 * 1000), channelAccountId: account,
        });

        it('names the contact we wrote to who never wrote back', async () => {
            const account = newAccount();
            await send({ account, recipient: 'only-cost', disposition: 'proactive', settle: 8 });
            await send({ account, recipient: 'only-cost', disposition: 'proactive', settle: 8 });
            await send({ account, recipient: 'real-talk', disposition: 'proactive', settle: 8 });
            await send({ account, recipient: 'real-talk', disposition: 'reactive', settle: 8 });

            const rows = (await signals(account)).costliestRecipients;
            const lonely = rows.find(row => row.recipientRef === 'only-cost');
            const talking = rows.find(row => row.recipientRef === 'real-talk');
            // Two sends and no conversation, versus one send that started one.
            expect({ proactive: lonely?.proactive, reactive: lonely?.reactive })
                .toEqual({ proactive: 2, reactive: 0 });
            expect({ proactive: talking?.proactive, reactive: talking?.reactive })
                .toEqual({ proactive: 1, reactive: 1 });
        });

        it('separates money spent from money merely at risk', async () => {
            // An uncertain outcome is exposure, not cost. Reporting it as spend
            // would overstate the bill; reporting it as nothing would hide the
            // one number an operator actually has to chase.
            const account = newAccount();
            const recipient = `risk-${randomUUID().slice(0, 8)}`;
            await send({ account, recipient, disposition: 'proactive', settle: 7 });
            await send({ account, recipient, disposition: 'proactive', retain: true });

            const row = (await signals(account)).costliestRecipients
                .find(entry => entry.recipientRef === recipient);
            expect({ settled: row?.settledMinor, uncertain: row?.uncertainMinor })
                .toEqual({ settled: 7, uncertain: 10 });
        });

        it('forgets a proven rejection entirely', async () => {
            // Released means the provider refused with no message id: nothing
            // was delivered and nothing was charged, so it is not a cost and
            // not a message this contact ever received.
            const account = newAccount();
            const recipient = `rejected-${randomUUID().slice(0, 8)}`;
            const effectKey = await send({ account, recipient, disposition: 'proactive', settle: null });
            await releaseReservation(query, schema,
                { effectKey, evidence: 'provider_rejected_without_message_id' });
            expect((await signals(account)).costliestRecipients
                .find(entry => entry.recipientRef === recipient)).toBeUndefined();
        });

        it('never adds pesos to dollars', async () => {
            // The failure this prevents is a single number that is wrong in a
            // way nobody notices until they act on it.
            const account = newAccount();
            const recipient = `two-currencies-${randomUUID().slice(0, 8)}`;
            await send({ account, recipient, disposition: 'proactive', currency: 'USD', settle: 5 });
            await send({ account, recipient, disposition: 'proactive', currency: 'COP', settle: 900 });

            const rows = (await signals(account)).costliestRecipients
                .filter(entry => entry.recipientRef === recipient);
            expect(rows.map(row => ({ currency: row.currency, settled: row.settledMinor }))
                .sort((left, right) => left.currency.localeCompare(right.currency)))
                .toEqual([{ currency: 'COP', settled: 900 }, { currency: 'USD', settled: 5 }]);
        });

        it('shows which category and which market the money went to', async () => {
            const account = newAccount();
            const marker = randomUUID().slice(0, 8);
            await send({ account, recipient: `cat-${marker}`, disposition: 'proactive',
                category: 'marketing', market: 'MX', settle: 40 });
            await send({ account, recipient: `cat-${marker}`, disposition: 'reactive',
                category: 'service', market: 'CO', settle: 4 });

            const rows = (await signals(account)).byCategory;
            const marketing = rows.find(row => row.category === 'marketing' && row.market === 'MX');
            expect({ settled: marketing?.settledMinor, proactive: marketing?.proactive })
                .toEqual({ settled: 40, proactive: 1 });
            // And the cheap answer to somebody who wrote in is a separate row,
            // so "marketing in Mexico costs ten times a reply" is readable.
            expect(rows.find(row => row.category === 'service' && row.market === 'CO')?.settledMinor)
                .toBe(4);
        });

        it('leaves rows written before the column out of the disposition counts', async () => {
            // Every reservation older than the migration has NULL there. NULL
            // equals nothing, so those rows are counted as neither — which is
            // right, because we do not know which they were.
            const account = newAccount();
            const recipient = `legacy-${randomUUID().slice(0, 8)}`;
            await claimReservation(query, schema, {
                effectKey: `sig-legacy-${randomUUID()}`,
                identity: identity({ channelAccountId: account, recipientRef: recipient }),
                money: money(10), leaseSeconds: 60,
            });
            const row = (await signals(account)).costliestRecipients
                .find(entry => entry.recipientRef === recipient);
            expect({ proactive: row?.proactive, reactive: row?.reactive })
                .toEqual({ proactive: 0, reactive: 0 });
        });
    });

    describe('what the key refuses', () => {
        it('refuses an effect key with a colon, which BullMQ rejects as a job id', async () => {
            await expect(claimReservation(query, schema, {
                effectKey: 'tenant:effect:1', identity: identity(), money: money(8), leaseSeconds: 60,
            })).rejects.toThrow('spend_effect_key_has_colon');
        });

        it('refuses a schema name that is not a tenant schema', async () => {
            await expect(findReservation(query, 'public', 'anything'))
                .rejects.toThrow('spend_schema_invalid');
        });
    });
});
