import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
    DISPATCH_OUTBOX_DDL, DispatchOutboxError,
    admitDispatch, applyDispatchProviderStatus, expireDispatchLeases,
    prepareDispatchBatch, readDispatchBacklog, readDispatchReconciliation, readDispatchRow,
    readPendingDispatch, redactDispatchOutbox, settleDispatch,
    type DispatchBinding, type DispatchItem, type DispatchState,
} from './agent-dispatch-outbox';
import {
    TURN_LEDGER_DDL, openTurnLedger, readTurnLedger, recordTurnResult, settleTurnLedger,
    type TurnEnvelope,
} from '../conversations/agent-turn-ledger';
import {
    HANDOFF_EFFECTS_DDL, admitHandoffEffect, prepareHandoffEffects,
    readHandoffEffects, readUncertainHandoffEffects, settleHandoffEffect,
} from '../handoff/handoff-effects';
import { LoadMetrics } from '../../common/__fixtures__/load-metrics';

/**
 * The durable outbound path under concurrency, measured.
 *
 * Everything the outbox, the turn ledger and the handoff effects claim is a
 * statement about what two processes may do to one row at the same time, and a
 * single-threaded test cannot observe any of it: it exercises the same branches
 * with nobody on the other side of the lock. So this suite runs real
 * connections against real rows and tries to produce the two failures those
 * tables exist to prevent — two answers to one inbound, and one effect
 * delivered twice.
 *
 * It also records latency and terminal-state distribution. An SLO with no
 * measurement behind it is a threshold somebody invented; the numbers printed
 * here are what `docs/runbooks/dispatch-load-and-slo.md` quotes, with the
 * concurrency and hardware they were taken on.
 *
 * The primitives are driven directly rather than through AgentDispatchOutboxStore
 * because the contention under test is between transactions on one row. The
 * store's own fences are exercised end-to-end by the chaos suite beside this one,
 * which drives the real worker, the real queue and a real Valkey.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

type Query = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

/** Enough connections to contend, few enough that two Jest workers coexist. */
const POOL_SIZE = 12;
const CONVERSATIONS = 24;
const TURNS_PER_CONVERSATION = 5;
/** Duplicate webhook delivery, a recovery pass and a restarted worker, at once. */
const REPLICAS_PER_TURN = 3;

(databaseUrl ? describe : describe.skip)('durable dispatch under concurrency', () => {
    const schema = `tenant_dispatch_load_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    const agentId = randomUUID();
    let pool: Pool;
    const metrics = new LoadMetrics('load: durable dispatch under concurrency');
    jest.setTimeout(240_000);

    const scope = { kind: 'agent', tenantId, schemaName: schema, agentId, version: 1,
        operationalHash: 'a'.repeat(64) };

    async function tx<T>(work: (query: Query) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        const query = (async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
            (await client.query(sql, params)).rows as any) as Query;
        try {
            await client.query('BEGIN');
            const result = await work(query);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }

    /** A transaction the test holds open, so an interleaving can be chosen. */
    async function openTx(): Promise<{ query: Query; commit: () => Promise<void>; rollback: () => Promise<void> }> {
        const client = await pool.connect();
        await client.query('BEGIN');
        const query = (async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
            (await client.query(sql, params)).rows as any) as Query;
        let closed = false;
        const finish = async (verb: 'COMMIT' | 'ROLLBACK') => {
            if (closed) return;
            closed = true;
            try { await client.query(verb); } finally { client.release(); }
        };
        return { query, commit: () => finish('COMMIT'), rollback: () => finish('ROLLBACK') };
    }

    const sql = async <R = any[]>(text: string, params: any[] = []): Promise<R> =>
        (await pool.query(text, params)).rows as any;

    /**
     * The same shared privacy fence AgentDispatchOutboxStore takes around every
     * admission and every settle. Without it the erasure race in this file would
     * be a race the production path never runs: shared holders do not block each
     * other, and an erasure's exclusive hold is the only thing that waits.
     */
    const fenced = <T>(work: (query: Query) => Promise<T>): Promise<T> => tx(async query => {
        await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',
            [`agent-privacy:${schema}`]);
        return work(query);
    });

    const errorOf = async (pending: Promise<unknown>): Promise<string> => {
        try { await pending; } catch (error) {
            if (error instanceof DispatchOutboxError) return error.code;
            return `unexpected:${(error as Error).message}`;
        }
        return 'no_error';
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        const admin = new Pool({ connectionString: databaseUrl, max: 1 });
        try {
            await admin.query(`CREATE SCHEMA "${schema}"`);
        } finally { await admin.end(); }
        // search_path on the startup packet rather than a SET per checkout: the
        // outbox and the handoff effects address their tables unqualified, and a
        // pooled connection that lost the setting would silently read `public`.
        pool = new Pool({ connectionString: databaseUrl, max: POOL_SIZE,
            options: `-c search_path=${schema},public` });
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active')`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        for (const statement of [...DISPATCH_OUTBOX_DDL, ...TURN_LEDGER_DDL, ...HANDOFF_EFFECTS_DDL]) {
            await sql(statement);
        }
    }, 120_000);

    afterAll(async () => {
        if (!pool) return;
        metrics.print();
        const admin = new Pool({ connectionString: databaseUrl, max: 1 });
        try {
            await pool.end();
            if (!/^tenant_dispatch_load_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await admin.end(); }
    }, 120_000);

    async function conversationFixture(): Promise<{ conversationId: string; contactId: string }> {
        const contactId = randomUUID(), conversationId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'whatsapp','active')",
            [conversationId, contactId]);
        return { conversationId, contactId };
    }

    async function inboundFixture(conversationId: string, contactId: string): Promise<DispatchBinding> {
        const inboundMessageId = randomUUID();
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Necesito ayuda','delivered')`,
            [inboundMessageId, conversationId]);
        return { conversationId, contactId, inboundMessageId,
            channelType: 'whatsapp', channelAccountId: 'wa-main', recipient: '+573000000000' };
    }

    const envelopeFor = (text: string): TurnEnvelope => Object.freeze({
        text, chunks: Object.freeze([text]),
        paymentLinks: Object.freeze(['https://checkout.test/abc']),
        media: Object.freeze([{ url: 'https://cdn.test/one.jpg', caption: 'la foto' }]),
        learningFootprints: Object.freeze([]),
    }) as TurnEnvelope;

    /**
     * The items a turn owes, derived from the envelope the ledger returned —
     * never from the one this attempt happened to generate. That is the whole
     * discipline the two tables enforce between them: the ledger decides which
     * answer exists, and the outbox records that answer's effects. An attempt
     * that prepared from its own words would be the second answer.
     */
    const itemsOf = (envelope: TurnEnvelope): DispatchItem[] => [
        { kind: 'media', payload: { mediaUrl: envelope.media[0].url, mediaType: 'image' } },
        { kind: 'text', payload: { text: envelope.text } },
    ];

    describe('concurrent bursts', () => {
        it('answers each inbound once and delivers each effect once, across conversations at once', async () => {
            const conversations = await Promise.all(
                Array.from({ length: CONVERSATIONS }, () => conversationFixture()));
            const inbounds: DispatchBinding[] = [];
            for (const conversation of conversations) {
                for (let turn = 0; turn < TURNS_PER_CONVERSATION; turn++) {
                    inbounds.push(await inboundFixture(conversation.conversationId, conversation.contactId));
                }
            }

            /** rowId → how many times a provider was actually called for it. */
            const sends = new Map<string, number>();
            const observedEnvelopes = new Map<string, Set<string>>();
            const admissionCodes = new Map<string, number>();
            const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

            /**
             * One whole attempt at a turn, exactly as a worker performs it:
             * claim, record the result, own the batch, then walk the batch —
             * stopping the moment this attempt stops being the one delivering,
             * which is what the real processor does when its job completes and
             * the chain belongs to whoever settled.
             */
            const attempt = async (binding: DispatchBinding, replica: number): Promise<void> => {
                await metrics.time('turn.open', () => tx(query => openTurnLedger(query, schema, binding)));
                const recorded = await metrics.time('turn.record', () => tx(query =>
                    recordTurnResult(query, schema, {
                        inboundMessageId: binding.inboundMessageId,
                        envelope: envelopeFor(`Respuesta de la réplica ${replica}`),
                        writers: [{ tool: 'create_appointment', status: 'succeeded', receipt: `apt-${replica}` }],
                        agentId, agentVersion: 1, operationalScope: scope,
                    })));
                const envelope = recorded.envelope!;
                if (!observedEnvelopes.has(binding.inboundMessageId)) {
                    observedEnvelopes.set(binding.inboundMessageId, new Set());
                }
                observedEnvelopes.get(binding.inboundMessageId)!.add(envelope.text);

                const { rows } = await metrics.time('batch.prepare', () => tx(query =>
                    prepareDispatchBatch(query, schema, {
                        binding, items: itemsOf(envelope), operationalScope: scope,
                    })));

                for (const row of rows) {
                    const leaseToken = randomUUID();
                    const asked = Date.now();
                    try {
                        await fenced(query => admitDispatch(query, schema,
                            { dispatchId: row.id, leaseToken, leaseSeconds: 60 }));
                    } catch (error) {
                        metrics.samples('admit.refused').add(Date.now() - asked);
                        bump(admissionCodes, error instanceof DispatchOutboxError ? error.code : String(error));
                        // A refused attempt is a worker whose job completes; the
                        // rest of the batch belongs to whoever settles this item.
                        return;
                    }
                    metrics.samples('admit.granted').add(Date.now() - asked);
                    bump(admissionCodes, 'granted');
                    // COMMITTED. This is the only place a provider may be called
                    // for this row, and the counter is what proves it.
                    bump(sends, row.id);
                    await new Promise(resolve => setTimeout(resolve, 1 + Math.floor(Math.random() * 4)));
                    await metrics.time('settle', () => fenced(query => settleDispatch(query, schema, {
                        dispatchId: row.id, leaseToken,
                        outcome: { kind: 'sent', receipt: `wamid.${row.id}` },
                    })));
                }
                await tx(query => settleTurnLedger(query, schema, binding.inboundMessageId));
            };

            const started = Date.now();
            await Promise.all(inbounds.flatMap(binding =>
                Array.from({ length: REPLICAS_PER_TURN }, (_, replica) => attempt(binding, replica))));
            const elapsed = Date.now() - started;

            const [{ outbound }] = await sql<any[]>(
                "SELECT COUNT(*)::int AS outbound FROM messages WHERE direction='outbound'");
            const [{ batches }] = await sql<any[]>(
                'SELECT COUNT(DISTINCT batch_id)::int AS batches FROM agent_dispatch_outbox');
            const states = await sql<any[]>(
                'SELECT state, COUNT(*)::int AS total FROM agent_dispatch_outbox GROUP BY state');
            const ledger = await sql<any[]>(
                `SELECT attempts, envelope->>'text' AS text, state FROM "${schema}".agent_turn_ledger`);

            // One answer per inbound: one batch, one pair of history rows, and
            // every attempt seeing the same words no matter which one generated
            // them first.
            expect(batches).toBe(inbounds.length);
            expect(outbound).toBe(inbounds.length * 2);
            expect(ledger).toHaveLength(inbounds.length);
            expect(ledger.every(row => Number(row.attempts) === REPLICAS_PER_TURN)).toBe(true);
            expect(ledger.every(row => row.state === 'settled')).toBe(true);
            expect([...observedEnvelopes.values()].every(texts => texts.size === 1)).toBe(true);

            // No duplicated effect: a provider call happened once per row, and
            // every row reached the one terminal state that means it arrived.
            expect([...sends.values()].filter(count => count > 1)).toHaveLength(0);
            expect(sends.size).toBe(inbounds.length * 2);
            expect(states).toEqual([{ state: 'sent', total: inbounds.length * 2 }]);
            const [{ pending }] = await sql<any[]>(
                "SELECT COUNT(*)::int AS pending FROM messages WHERE direction='outbound' AND status<>'sent'");
            expect(pending).toBe(0);

            for (const [code, total] of admissionCodes) metrics.count(`admission.${code}`, total);
            for (const row of states) metrics.count(`state.${row.state}`, Number(row.total));
            metrics.count('turns', inbounds.length);
            metrics.count('attempts', inbounds.length * REPLICAS_PER_TURN);
            metrics.count('provider_calls', [...sends.values()].reduce((total, n) => total + n, 0));
            metrics.count('duplicate_provider_calls', [...sends.values()].filter(n => n > 1).length);
            metrics.note(`${CONVERSATIONS} conversations x ${TURNS_PER_CONVERSATION} inbounds`
                + ` x ${REPLICAS_PER_TURN} racing attempts, pool=${POOL_SIZE}`);
            metrics.note(`burst wall time ${elapsed}ms`
                + ` → ${(inbounds.length / (elapsed / 1000)).toFixed(1)} turns/s,`
                + ` ${((inbounds.length * 2) / (elapsed / 1000)).toFixed(1)} delivered effects/s`);
        }, 240_000);

        it('records what one turn costs with nobody else on the connection pool', async () => {
            // The burst above measures latency at pool saturation, which is the
            // number an operator feels but not the cost of the work. This is the
            // same turn with no queueing in front of it, so an SLO can tell a
            // slow database apart from a busy one.
            const { conversationId, contactId } = await conversationFixture();
            for (let index = 0; index < 25; index++) {
                const binding = await inboundFixture(conversationId, contactId);
                await metrics.time('serial.turn.open', () => tx(query => openTurnLedger(query, schema, binding)));
                const recorded = await metrics.time('serial.turn.record', () => tx(query =>
                    recordTurnResult(query, schema, {
                        inboundMessageId: binding.inboundMessageId,
                        envelope: envelopeFor('Respuesta sin contención'), agentId, agentVersion: 1,
                    })));
                const { rows } = await metrics.time('serial.batch.prepare', () => tx(query =>
                    prepareDispatchBatch(query, schema, {
                        binding, items: itemsOf(recorded.envelope!), operationalScope: scope,
                    })));
                for (const row of rows) {
                    const leaseToken = randomUUID();
                    await metrics.time('serial.admit', () => fenced(query => admitDispatch(query, schema,
                        { dispatchId: row.id, leaseToken, leaseSeconds: 60 })));
                    await metrics.time('serial.settle', () => fenced(query => settleDispatch(query, schema, {
                        dispatchId: row.id, leaseToken,
                        outcome: { kind: 'sent', receipt: `wamid.${row.id}` },
                    })));
                }
            }
            const [{ leftover }] = await sql<any[]>(
                "SELECT COUNT(*)::int AS leftover FROM agent_dispatch_outbox WHERE state<>'sent'");
            expect(leftover).toBe(0);
        }, 120_000);

        it('refuses a second, differently shaped answer to the same inbound', async () => {
            const { conversationId, contactId } = await conversationFixture();
            const binding = await inboundFixture(conversationId, contactId);
            await tx(query => prepareDispatchBatch(query, schema, {
                binding, items: itemsOf(envelopeFor('La primera respuesta')), operationalScope: scope,
            }));
            // A replay that generated its own answer and prepared from it rather
            // than from the ledger: two results claiming one turn.
            expect(await errorOf(tx(query => prepareDispatchBatch(query, schema, {
                binding, items: [{ kind: 'text', payload: { text: 'Otra respuesta' } }], operationalScope: scope,
            })))).toBe('dispatch_batch_conflict');
        });
    });

    describe('lock contention', () => {
        it('grants exactly one permission when workers race the same dispatch row', async () => {
            const { conversationId, contactId } = await conversationFixture();
            const binding = await inboundFixture(conversationId, contactId);
            const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
                binding, items: [{ kind: 'text', payload: { text: 'Una sola vez' } }], operationalScope: scope,
            }));
            const racers = 8;
            const outcomes = await Promise.all(Array.from({ length: racers }, () =>
                errorOf(metrics.time('admit.race', () => fenced(query => admitDispatch(query, schema,
                    { dispatchId: rows[0].id, leaseToken: randomUUID(), leaseSeconds: 60 }))))));
            expect(outcomes.filter(code => code === 'no_error')).toHaveLength(1);
            expect(outcomes.filter(code => code === 'dispatch_lease_active')).toHaveLength(racers - 1);
            // The attempt count is the permission count, and it survived every
            // rolled-back refusal: exactly one attempt was ever authorised.
            const row = await tx(query => readDispatchRow(query, schema, rows[0].id));
            expect(row).toMatchObject({ state: 'admitted', attempts: 1 });
            metrics.count('lock.dispatch_row.racers', racers);
        });

        it('keeps one envelope when workers race the same turn ledger row', async () => {
            const { conversationId, contactId } = await conversationFixture();
            const binding = await inboundFixture(conversationId, contactId);
            const racers = 8;
            await Promise.all(Array.from({ length: racers }, () =>
                metrics.time('turn.open.race', () => tx(query => openTurnLedger(query, schema, binding)))));
            const recorded = await Promise.all(Array.from({ length: racers }, (_, index) =>
                metrics.time('turn.record.race', () => tx(query => recordTurnResult(query, schema, {
                    inboundMessageId: binding.inboundMessageId,
                    envelope: envelopeFor(`Respuesta ${index}`), agentId, agentVersion: 1,
                })))));
            const texts = new Set(recorded.map(row => row.envelope!.text));
            expect(texts.size).toBe(1);
            const stored = await tx(query => readTurnLedger(query, schema, binding.inboundMessageId));
            expect(stored!.attempts).toBe(racers);
            expect(stored!.envelope!.text).toBe([...texts][0]);
            // The writers of the losing attempts are not merged in: the stored
            // result is one attempt's whole result, not a union of several.
            expect(stored!.writers).toHaveLength(0);
        });

        it('blocks rather than refuses while another transaction holds the row', async () => {
            const { conversationId, contactId } = await conversationFixture();
            const binding = await inboundFixture(conversationId, contactId);
            const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
                binding, items: [{ kind: 'text', payload: { text: 'Contención' } }], operationalScope: scope,
            }));
            const holder = await openTx();
            await holder.query('SELECT id FROM agent_dispatch_outbox WHERE id=$1::uuid FOR UPDATE', [rows[0].id]);
            const holdMs = 400;
            const started = Date.now();
            const waiting = fenced(query => admitDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: randomUUID(), leaseSeconds: 60 }));
            setTimeout(() => { void holder.rollback(); }, holdMs);
            const admitted = await waiting;
            const waited = Date.now() - started;
            // A contended admission waits for the truth rather than guessing at
            // it: a row it could not read is never treated as available.
            expect(admitted.state).toBe('admitted');
            expect(waited).toBeGreaterThanOrEqual(holdMs - 50);
            metrics.samples('admit.lock_wait').add(waited);
            metrics.note(`row lock held ${holdMs}ms → contended admission returned after ${waited}ms`);
        });
    });

    describe('duplicate and out-of-order provider status', () => {
        async function sentRow(receipt: string): Promise<string> {
            const { conversationId, contactId } = await conversationFixture();
            const binding = await inboundFixture(conversationId, contactId);
            const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
                binding, items: [{ kind: 'text', payload: { text: 'Con recibo' } }], operationalScope: scope,
            }));
            const leaseToken = randomUUID();
            await tx(query => admitDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken, leaseSeconds: 60 }));
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken, outcome: { kind: 'sent', receipt } }));
            return rows[0].id;
        }
        const statusOf = async (dispatchId: string): Promise<string> => (await sql<any[]>(
            `SELECT m.status FROM agent_dispatch_outbox d JOIN messages m ON m.id=d.message_id
              WHERE d.id=$1::uuid`, [dispatchId]))[0].status;

        it('never moves a status backwards, however the events arrive', async () => {
            const receipt = `wamid.${randomUUID()}`;
            const dispatchId = await sentRow(receipt);
            const apply = (status: any, errorCode?: string) => metrics.time('status.apply', () => tx(query =>
                applyDispatchProviderStatus(query, schema, { providerMessageId: receipt, status, errorCode })));

            expect((await apply('delivered')).reason).toBe('applied');
            expect((await apply('read')).reason).toBe('applied');
            // Out of order and repeated: Meta sends both, and neither may undo
            // what the customer's phone already confirmed.
            expect((await apply('sent')).reason).toBe('not_newer');
            expect((await apply('delivered')).reason).toBe('not_newer');
            expect((await apply('read')).reason).toBe('not_newer');
            expect((await apply('failed', 'wa_131047')).reason).toBe('already_delivered');
            expect(await statusOf(dispatchId)).toBe('read');
        });

        it('refuses a rejection that arrives after an acceptance, even under contention', async () => {
            /**
             * The guard and the ranking were always right; both were decided
             * from `m.status` read in the SELECT that took `FOR UPDATE OF d`.
             * The lock was on the dispatch row and the message status came from
             * the statement snapshot taken before that lock was granted, so the
             * second transaction serialised correctly and then decided from a
             * value that was already stale — writing `failed` over `delivered`,
             * the exact statement this path exists to prevent. Reached in
             * production whenever two webhook bodies for one receipt are in
             * flight: Meta retries, and the API and the WhatsApp app both apply.
             *
             * The row is locked first and the status read second now.
             */
            const receipt = `wamid.${randomUUID()}`;
            const dispatchId = await sentRow(receipt);
            const winner = await openTx();
            const accepted = await applyDispatchProviderStatus(winner.query, schema,
                { providerMessageId: receipt, status: 'delivered' });
            expect(accepted.reason).toBe('applied');
            // Starts while the acceptance is uncommitted, so it blocks on the
            // dispatch row and resumes after it commits.
            const late = tx(query => applyDispatchProviderStatus(query, schema,
                { providerMessageId: receipt, status: 'failed', errorCode: 'wa_131047' }));
            await new Promise(resolve => setTimeout(resolve, 150));
            await winner.commit();
            const result = await late;

            expect(result).toMatchObject({ applied: false, reason: 'already_delivered' });
            expect(await statusOf(dispatchId)).toBe('delivered');
            metrics.count('status.late_rejection_refused_after_delivery');
        });

        it('applies one of a burst of identical events and reports the rest as not newer', async () => {
            /**
             * The second face of the same defect. Ten identical `delivered`
             * events used to serialise on the dispatch row and every one of them
             * then decided from the snapshot it took before the lock, saw
             * `sent`, and wrote. The recorded status stayed right — the writes
             * were identical — but `applied` is what the channel report hands
             * its caller as "this changed something", so ten of them was a lie
             * about the same fact ten times.
             */
            const receipt = `wamid.${randomUUID()}`;
            const dispatchId = await sentRow(receipt);
            const duplicates = 10;
            const results = await Promise.all(Array.from({ length: duplicates }, () =>
                metrics.time('status.duplicate', () => tx(query => applyDispatchProviderStatus(query, schema,
                    { providerMessageId: receipt, status: 'delivered' })))));
            expect(results.filter(result => result.reason === 'applied')).toHaveLength(1);
            expect(results.filter(result => result.reason === 'not_newer')).toHaveLength(duplicates - 1);
            expect(await statusOf(dispatchId)).toBe('delivered');
            metrics.count('status.concurrent_duplicates_refused', duplicates - 1);
        });
    });

    describe('erasure concurrent with delivery', () => {
        it('never delivers erased words and never hands the row back', async () => {
            const trials = 10;
            const finalStates: DispatchState[] = [];
            let settledBeforeErasure = 0;
            for (let trial = 0; trial < trials; trial++) {
                const { conversationId, contactId } = await conversationFixture();
                const binding = await inboundFixture(conversationId, contactId);
                const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
                    binding, items: [{ kind: 'text', payload: { text: 'Palabras a borrar' } }],
                    operationalScope: scope,
                }));
                const leaseToken = randomUUID();
                const admitted = await fenced(query => admitDispatch(query, schema,
                    { dispatchId: rows[0].id, leaseToken, leaseSeconds: 60 }));
                // The permission carried the words; erasure lands while the
                // request they belong to is in flight.
                expect(admitted.payload).toMatchObject({ text: 'Palabras a borrar' });

                const deliver = (async () => {
                    await new Promise(resolve => setTimeout(resolve, trial % 5));
                    return errorOf(fenced(query => settleDispatch(query, schema, {
                        dispatchId: rows[0].id, leaseToken,
                        outcome: { kind: 'sent', receipt: `wamid.${rows[0].id}` },
                    })));
                })();
                const erase = metrics.time('redact', () => tx(query =>
                    redactDispatchOutbox(query, schema, { contactIds: [contactId] })));
                const [settleCode, redacted] = await Promise.all([deliver, erase]);
                expect(redacted).toBe(1);
                if (settleCode === 'no_error') settledBeforeErasure++;

                const row = await tx(query => readDispatchRow(query, schema, rows[0].id));
                expect(row!.redacted).toBe(true);
                expect(row!.payload).toBeNull();
                // Either the acceptance was recorded before erasure, or the row
                // is uncertain. Never available, never carrying words again.
                expect(['sent', 'reconciliation_required']).toContain(row!.state);
                finalStates.push(row!.state);
                expect(await errorOf(tx(query => admitDispatch(query, schema,
                    { dispatchId: rows[0].id, leaseToken: randomUUID(), leaseSeconds: 60 }))))
                    .toBe('dispatch_redacted');
                const pending = await tx(query => readPendingDispatch(query, schema, 100));
                expect(pending.map(entry => entry.id)).not.toContain(rows[0].id);
            }
            for (const state of new Set(finalStates)) {
                metrics.count(`erasure.final.${state}`, finalStates.filter(value => value === state).length);
            }
            metrics.note(`erasure raced delivery ${trials}x → ${settledBeforeErasure} settled first,`
                + ` ${trials - settledBeforeErasure} became uncertain; 0 delivered erased words`);
        });
    });

    describe('lapsed permissions and the reconciliation queue', () => {
        it('turns an unsettled permission into an uncertain row that is never retried', async () => {
            const rowIds: string[] = [];
            const batch = 20;
            for (let index = 0; index < batch; index++) {
                const { conversationId, contactId } = await conversationFixture();
                const binding = await inboundFixture(conversationId, contactId);
                const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
                    binding, items: [{ kind: 'text', payload: { text: 'Sin respuesta del proveedor' } }],
                    operationalScope: scope,
                }));
                await tx(query => admitDispatch(query, schema,
                    { dispatchId: rows[0].id, leaseToken: randomUUID(), leaseSeconds: 5 }));
                rowIds.push(rows[0].id);
            }
            // Time is the database's, so the lease is pushed rather than waited
            // out: what is under test is the transition, not the clock.
            await sql("UPDATE agent_dispatch_outbox SET lease_expires_at = NOW() - INTERVAL '1 second' "
                + 'WHERE id = ANY($1::uuid[])', [rowIds]);
            const expired = await metrics.time('expire_leases', () => tx(query =>
                expireDispatchLeases(query, schema, 100)));
            // Earlier cases in this file leave leases of their own behind, so the
            // claim is about these rows, not about the pass being alone here.
            expect(expired.filter(row => rowIds.includes(row.id))).toHaveLength(batch);
            expect(expired.every(row => row.state === 'reconciliation_required')).toBe(true);
            expect(expired.every(row => row.errorCode === 'lease_expired_after_admission')).toBe(true);

            const pending = await tx(query => readPendingDispatch(query, schema, 200));
            expect(pending.filter(row => rowIds.includes(row.id))).toHaveLength(0);
            expect(await errorOf(tx(query => admitDispatch(query, schema,
                { dispatchId: rowIds[0], leaseToken: randomUUID(), leaseSeconds: 60 }))))
                .toBe('dispatch_terminal:reconciliation_required');

            const backlog = await metrics.time('backlog.read', () => tx(query =>
                readDispatchBacklog(query, schema)));
            expect(backlog.total).toBeGreaterThanOrEqual(batch);
            const queue = await metrics.time('reconciliation.read', () => tx(query =>
                readDispatchReconciliation(query, schema, { limit: 200 })));
            expect(queue.length).toBeGreaterThanOrEqual(batch);
            // A queue view is not a reason to hand out phone numbers, and the
            // decision is about whether an effect happened, never about words.
            expect(queue.every(entry => !entry.recipientHint?.includes('573000000000'))).toBe(true);
            metrics.count('reconciliation.rows', backlog.total);
            metrics.note(`${batch} lapsed permissions reconciled in one pass;`
                + ` backlog read over ${backlog.total} row(s)`);
        });
    });

    describe('handoff effects per destination', () => {
        // No receipt row is needed: `receipt_id` deliberately carries no foreign
        // key, so the effects outlive an erased transfer and still stop a resend.
        const receiptFor = async (): Promise<string> => {
            const receiptId = randomUUID();
            await tx(query => prepareHandoffEffects(query, schema, receiptId,
                ['inbox', 'crm', 'webhooks', 'push', 'slack', 'sms']));
            return receiptId;
        };

        it('admits one attempt per destination when six consumers race', async () => {
            const receiptId = await receiptFor();
            const destinations = ['inbox', 'crm', 'webhooks', 'push', 'slack', 'sms'] as const;
            const racersPerDestination = 4;
            const outcomes = await Promise.all(destinations.flatMap(destination =>
                Array.from({ length: racersPerDestination }, async () => {
                    try {
                        await metrics.time('handoff.admit', () => tx(query => admitHandoffEffect(query, schema,
                            { receiptId, destination, leaseToken: randomUUID(), leaseSeconds: 60 })));
                        return `${destination}:granted`;
                    } catch (error: any) {
                        return `${destination}:${error?.code ?? error?.message}`;
                    }
                })));
            for (const destination of destinations) {
                expect(outcomes.filter(value => value === `${destination}:granted`)).toHaveLength(1);
            }
            const rows = await tx(query => readHandoffEffects(query, schema, receiptId));
            // One paid SMS, one Slack message, one CRM note — the aggregate flag
            // this table replaced could not make that claim per destination.
            expect(rows.every(row => row.attempts === 1 && row.state === 'admitted')).toBe(true);
            metrics.count('handoff.destinations_admitted', rows.length);
        });

        it('turns a lapsed handoff permission into uncertainty a person can see', async () => {
            /**
             * `admitHandoffEffect` used to write the `unknown` transition and
             * then throw from the same transaction. `handoff.service.ts` runs it
             * inside `transactionInTenantSchema`, so Prisma rolled the write back
             * with the refusal and the row stayed `admitted` behind a dead lease.
             * Safety held — every later admission refused, so no second Slack
             * message and no second paid SMS — but nobody ever learned the effect
             * was uncertain, because nothing persisted `unknown` and no surface
             * listed it. The existing unit suite missed it entirely: it drives a
             * raw autocommit client, where the write survives the throw.
             *
             * The refusal is now a returned state rather than an exception, so
             * the transition commits with it.
             */
            const receiptId = await receiptFor();
            const leaseToken = randomUUID();
            await tx(query => admitHandoffEffect(query, schema,
                { receiptId, destination: 'slack', leaseToken, leaseSeconds: 1 }));
            await sql("UPDATE agent_handoff_effects SET lease_expires_at = NOW() - INTERVAL '1 second' "
                + "WHERE receipt_id=$1::uuid AND destination='slack'", [receiptId]);

            const states = await Promise.all(Array.from({ length: 4 }, async () => {
                try {
                    const row = await tx(query => admitHandoffEffect(query, schema,
                        { receiptId, destination: 'slack', leaseToken: randomUUID(), leaseSeconds: 60 }));
                    return row.state;
                } catch (error: any) { return String(error?.code ?? error?.message); }
            }));
            expect(states.filter(state => state === 'admitted')).toHaveLength(0);
            expect(new Set(states)).toEqual(new Set(['unknown']));

            const [slack] = (await tx(query => readHandoffEffects(query, schema, receiptId)))
                .filter(row => row.destination === 'slack');
            expect(slack).toMatchObject({ state: 'unknown', attempts: 1,
                errorCode: 'lease_expired_after_admission' });
            const uncertain = await tx(query => readUncertainHandoffEffects(query, schema, 50));
            expect(uncertain.map(row => row.id)).toContain(slack.id);

            // The holder whose lease ran out can no longer settle it — but the
            // receipt it carries is the only record that the destination was
            // reached, so it is kept rather than thrown away with the refusal.
            const stale = await tx(query => settleHandoffEffect(query, schema,
                { receiptId, destination: 'slack', leaseToken, outcome: { kind: 'accepted', receipt: 'ts.1' } }));
            expect(stale.state).toBe('unknown');
            const [after] = (await tx(query => readHandoffEffects(query, schema, receiptId)))
                .filter(row => row.destination === 'slack');
            expect(after).toMatchObject({ state: 'unknown', receipt: 'ts.1' });
            metrics.count('handoff.lapsed_reached_operator');
        });
    });
});
