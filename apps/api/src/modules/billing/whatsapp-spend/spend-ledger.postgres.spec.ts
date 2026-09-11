import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    adoptReservation, claimReservation, declareTaskBudget, ensureCounters, findReservation,
    grantFreeDeliveries,
    readExposure, readPressure, recordAllocation, releaseReservation, reserveAgainstCounter,
    retainReservation, settleReservation, sweepExpiredLeases,
    type ReservationIdentity, type SpendQuery,
} from './spend-ledger';
import { scopesFor } from './spend-scopes';

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
            DO UPDATE SET cap_kind='money', cap_minor=$2, currency='USD',
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
            scope, amountMinor: amount, deliveries: 1, disposition,
        });
        if (!outcome.ok) return { allowed: false as const, pressure: outcome.pressure };
        const reservation = await claimReservation(run, schema, {
            effectKey, identity: identity(), money: money(amount), leaseSeconds: 60,
        });
        if (reservation) await recordAllocation(run, schema, reservation.id,
            { scope, amountMinor: amount, deliveries: 1 }, 'USD');
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
                    SET cap_kind='money', cap_minor=100, currency='USD'
                    WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
                    [scope.kind, scope.key, scope.period]);
            }

            const effectKey = `multi-${run}`;
            const money = scopes.filter(scope => scope.kind !== 'number_month');
            for (const scope of money) {
                expect(await reserveAgainstCounter(query, schema,
                    { scope, amountMinor: 8, deliveries: 1, disposition: 'reactive' }))
                    .toEqual({ ok: true, pressure: 'clear' });
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
                    { scope, amountMinor: 8, deliveries: 1 }, 'USD');
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
                SET cap_kind='money', cap_minor=10000, currency='USD'
                WHERE scope_kind='account' AND scope_key=$1`, [generous.key]);
            await query(`UPDATE "${schema}".whatsapp_spend_counters
                SET cap_kind='money', cap_minor=0, currency='USD'
                WHERE scope_kind='contact' AND scope_key=$1`, [tight.key]);

            expect(await reserveAgainstCounter(query, schema,
                { scope: generous, amountMinor: 8, deliveries: 1, disposition: 'reactive' }))
                .toEqual({ ok: true, pressure: 'clear' });
            expect(await reserveAgainstCounter(query, schema,
                { scope: tight, amountMinor: 8, deliveries: 1, disposition: 'reactive' }))
                .toEqual({ ok: false, pressure: 'hard_stop' });
        });

        it('never refuses on an observe-only counter', async () => {
            // Where every tenant starts: counting, stopping nobody.
            const scope = { kind: 'account' as const, key: `observe-${randomUUID()}`, period: '2026-10' };
            await ensureCounters(query, schema, [scope], 'USD');
            // And reports `clear`, not a warning: an observe counter has no
            // ceiling to be a fraction of, so there is nothing to be near.
            expect(await reserveAgainstCounter(query, schema,
                { scope, amountMinor: 999_999, deliveries: 1, disposition: 'proactive' }))
                .toEqual({ ok: true, pressure: 'clear' });
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
                DO UPDATE SET cap_kind='money', cap_minor=$2, currency='USD',
                    warn_permille=$3, soft_permille=$4,
                    reserved_minor=0, settled_minor=0, released_minor=0, used_deliveries=0`,
                [scopeKey, capMinor, warn, soft]);
        };

        const reserve = (scopeKey: string, amount: number,
            disposition: 'reactive' | 'proactive') =>
            reserveAgainstCounter(query, schema, {
                scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                amountMinor: amount, deliveries: 1, disposition,
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
            expect(campaign).toEqual({ ok: false, pressure: 'soft_stop' });

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
            expect(await reserve(scopeKey, 20, 'reactive')).toEqual({ ok: false, pressure: 'hard_stop' });
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
            expect(await reserve(scopeKey, 999, 'proactive')).toEqual({ ok: true, pressure: 'clear' });
            // The thousandth minor unit is inside the ceiling and must go.
            expect(await reserve(scopeKey, 1, 'proactive')).toEqual({ ok: true, pressure: 'hard_stop' });
            // The thousand-and-first is not.
            expect(await reserve(scopeKey, 1, 'proactive')).toEqual({ ok: false, pressure: 'hard_stop' });
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
                    amountMinor: 0, deliveries, disposition,
                });
            expect((await step(79, 'reactive')).pressure).toBe('clear');
            expect((await step(1, 'reactive')).pressure).toBe('warning');
            expect(await step(15, 'proactive')).toEqual({ ok: false, pressure: 'soft_stop' });
            expect((await step(15, 'reactive')).pressure).toBe('soft_stop');
            expect(await step(10, 'reactive')).toEqual({ ok: false, pressure: 'hard_stop' });
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
                    amountMinor: 5, deliveries: 1, disposition: 'proactive',
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
                expect(second).toEqual({ ok: false, pressure: 'soft_stop' });
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
            expect(await reserve(scopeKey, 1, 'reactive')).toEqual({ ok: false, pressure: 'hard_stop' });
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
            scope: task(taskId), amountMinor: 0, deliveries: 1, disposition: 'proactive',
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
            expect(await send(query, taskId)).toEqual({ ok: false, pressure: 'hard_stop' });
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
                expect(second).toEqual({ ok: false, pressure: 'hard_stop' });
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
            expect(await send(query, taskId)).toEqual({ ok: false, pressure: 'hard_stop' });

            expect(await budget(taskId, 2)).toEqual({
                capKind: 'deliveries', capDeliveries: 7, capMinor: null, usedDeliveries: 5,
            });
            expect((await send(query, taskId)).ok).toBe(true);
            expect((await send(query, taskId)).ok).toBe(true);
            expect(await send(query, taskId)).toEqual({ ok: false, pressure: 'hard_stop' });
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
                scope: task(taskId), amountMinor: amount, deliveries: 1, disposition: 'proactive',
            });
            expect((await spend(200)).ok).toBe(true);
            // 200 of 250 is 80 %: the warning line, and still permitted.
            expect((await spend(0)).pressure).toBe('warning');
            expect(await spend(60)).toEqual({ ok: false, pressure: 'hard_stop' });
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
                        amountMinor: amount, deliveries: 1 });
                const row = await claimReservation(query, schema, {
                    effectKey: key, identity: identity({ channelAccountId: account }),
                    money: money(amount), leaseSeconds: 600,
                });
                await recordAllocation(query, schema, row!.id,
                    { scope: { kind: 'account', key: scopeKey, period: '2026-10' },
                        amountMinor: amount, deliveries: 1 }, 'USD');
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
