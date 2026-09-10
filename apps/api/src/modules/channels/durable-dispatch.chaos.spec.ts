import { randomUUID } from 'crypto';
import { createServer, connect, type Server, type Socket } from 'net';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { DispatchRecoveryService } from './dispatch-recovery.service';
import { OutboundQueueService } from './outbound-queue.service';
import { OutboundQueueProcessor, OUTBOUND_QUEUE } from './outbound-queue.processor';
import {
    DISPATCH_OUTBOX_DDL, DISPATCH_TERMINAL_STATES, redactDispatchOutbox,
    type DispatchBinding, type DispatchItem, type DispatchRow, type DispatchState,
} from './agent-dispatch-outbox';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import type { StrictDispatchOutcome } from './strict-dispatch-transport';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { LoadMetrics } from '../../common/__fixtures__/load-metrics';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!databaseUrl && !!redisUrl;

/**
 * The durable path while things break underneath it.
 *
 * Every claim the outbox makes is about a failure that cannot be staged from
 * inside one process: the cache disappears, the provider stops answering, the
 * worker dies holding a permission, an erasure lands mid-flight. The load suite
 * beside this one contends transactions; this one drives the real worker against
 * a real queue and then takes the ground away.
 *
 * Valkey is reached through a TCP gate this file owns rather than by restarting
 * the container. The container is shared with whatever else the run is doing,
 * and a suite that kills infrastructure its neighbours depend on is a flake
 * generator. From the client's side the gate is indistinguishable from a
 * restart: sockets die mid-command and new connections are refused until it
 * opens again.
 */
(ready ? describe : describe.skip)('durable dispatch while the ground moves', () => {
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_dispatch_chaos_${randomUUID().replace(/-/g, '')}`;
    const queueName = `${OUTBOUND_QUEUE}-chaos-${randomUUID().slice(0, 8)}`;
    const metrics = new LoadMetrics('chaos: durable dispatch under failure');
    jest.setTimeout(300_000);

    let client: PrismaClient, prisma: any, store: AgentDispatchOutboxStore;
    let queue: Queue, worker: Worker | undefined;
    let service: OutboundQueueService, processor: OutboundQueueProcessor, recovery: DispatchRecoveryService;
    let gate: ValkeyGate;
    /** Flipped with the gate: the real RedisService fails closed the same way. */
    let valkeyDown = false;
    let sendStrict: jest.Mock;

    /**
     * A TCP gate in front of Valkey.
     *
     * `cut` destroys everything in flight and answers new connections with an
     * immediate reset, which is what a client sees while a server is restarting.
     * The port stays bound throughout, so nothing else can take it in between.
     */
    class ValkeyGate {
        private server?: Server;
        private readonly live = new Set<Socket>();
        private open = true;
        port = 0;

        async listen(target: { host: string; port: number }): Promise<void> {
            this.server = createServer(inbound => {
                if (!this.open) { inbound.destroy(); return; }
                const upstream = connect(target.port, target.host);
                this.live.add(inbound); this.live.add(upstream);
                const drop = () => { inbound.destroy(); upstream.destroy(); };
                inbound.on('error', drop); upstream.on('error', drop);
                inbound.on('close', () => { this.live.delete(inbound); upstream.destroy(); });
                upstream.on('close', () => { this.live.delete(upstream); inbound.destroy(); });
                inbound.pipe(upstream); upstream.pipe(inbound);
            });
            this.server.on('error', () => undefined);
            await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
            this.port = (this.server!.address() as any).port;
        }

        cut(): void {
            this.open = false;
            for (const socket of [...this.live]) socket.destroy();
            this.live.clear();
        }

        restore(): void { this.open = true; }

        async close(): Promise<void> {
            this.cut();
            await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve());
        }
    }

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const rowOf = async (id: string): Promise<any> => (await sql(
        `SELECT state, attempts, receipt, error_code, payload, redacted_at
           FROM agent_dispatch_outbox WHERE id=$1::uuid`, [id]))[0];
    const statesOf = async (ids: readonly string[]): Promise<DispatchState[]> => {
        const rows = await sql('SELECT id, state FROM agent_dispatch_outbox WHERE id = ANY($1::uuid[])', [ids]);
        const byId = new Map(rows.map(row => [String(row.id), row.state as DispatchState]));
        return ids.map(id => byId.get(id)!);
    };
    /** What the transport was asked to send, as an identity we can count. */
    const bodyOf = (request: any): string =>
        String(request?.payload?.text ?? request?.payload?.mediaUrl ?? '');

    /** Tolerates an unreachable queue: during a cut the counts cannot be read. */
    const settleQueue = async (attempts = 200): Promise<void> => {
        for (let index = 0; index < attempts; index++) {
            try {
                const counts = await queue.getJobCounts('active', 'waiting', 'prioritized', 'delayed');
                if (!counts.active && !counts.waiting && !counts.prioritized && !counts.delayed) return;
            } catch { /* the gate is shut; keep waiting for it to open */ }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    };

    const startWorker = async (concurrency = 1): Promise<void> => {
        worker = new Worker(queueName, async (job, token) => processor.process(job as any, token),
            { connection: { host: '127.0.0.1', port: gate.port, maxRetriesPerRequest: null }, concurrency });
        worker.on('error', () => undefined);
        await worker.waitUntilReady();
    };

    beforeAll(async () => {
        const dbUrl = new URL(databaseUrl!), valkeyUrl = new URL(redisUrl!);
        if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        if (!['localhost', '127.0.0.1'].includes(valkeyUrl.hostname))
            throw new Error('disposable_loopback_redis_required');
        gate = new ValkeyGate();
        await gate.listen({ host: valkeyUrl.hostname, port: Number(valkeyUrl.port) });

        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.tenant = {
            findUnique: jest.fn(async () => ({
                id: tenantId, schemaName: schema, isActive: true, onboardingCompletedAt: new Date(),
                isInternal: false, subscriptionStatus: 'active',
                subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
            })),
            findMany: jest.fn(async () => [{ id: tenantId }]),
        };
        // The production RedisService fails closed on an unreachable Valkey, and
        // the purge fence is read through it before any admission. Modelling that
        // is the point: an outage must refuse work, never guess at it.
        const storeRedis = {
            get: jest.fn(async () => {
                if (valkeyDown) throw new Error('Connection is closed.');
                return null;
            }),
        } as any;
        store = new AgentDispatchOutboxStore(prisma, storeRedis);

        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active')`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql('CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL');
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],
            channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        await sql('CREATE TABLE persona_config(config_json JSONB,is_active BOOLEAN,version INTEGER)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}',
            ARRAY['whatsapp'],'{}'::text[],'24_7',true,true,1)`, [agentId]);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        queue = new Queue(queueName, { connection: { host: '127.0.0.1', port: gate.port } });
        queue.on('error', () => undefined);
        sendStrict = jest.fn();
        processor = new OutboundQueueProcessor(
            { getStrictTransport: () => ({ channelType: 'whatsapp', sendStrict }), sendMessage: jest.fn() } as any,
            { isOverLimit: jest.fn(async () => false), recordUsage: jest.fn(async () => undefined),
                getPriority: jest.fn(async () => 1), getMaxPendingJobs: jest.fn(async () => Infinity) } as any,
            { getChannelToken: jest.fn(async () => ({ accessToken: 'token' })) } as any,
            { get: jest.fn(), set: jest.fn(), incr: jest.fn(), expire: jest.fn(), incrBy: jest.fn() } as any,
            { send: jest.fn() } as any, prisma as any, undefined, undefined, store);
        service = new OutboundQueueService(queue as any,
            { getPriority: jest.fn(async () => 1), getMaxPendingJobs: jest.fn(async () => Infinity) } as any,
            { incr: jest.fn(), expire: jest.fn() } as any);
        processor.attachQueue(service);
        // The shipped recovery pass, not a copy of it: what is under test is
        // whether recovery reaches reconciliation instead of a second send.
        recovery = new DispatchRecoveryService(prisma, store, service, { runExclusive: jest.fn() } as any);
        await startWorker(1);
    }, 120_000);

    afterAll(async () => {
        metrics.print();
        await worker?.close(true).catch(() => undefined);
        await queue?.obliterate({ force: true }).catch(() => undefined);
        await queue?.close().catch(() => undefined);
        await gate?.close().catch(() => undefined);
        if (!client) return;
        try {
            if (!/^tenant_dispatch_chaos_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    }, 120_000);

    beforeEach(async () => {
        valkeyDown = false;
        gate.restore();
        sendStrict.mockReset();
        sendStrict.mockImplementation(async () =>
            ({ kind: 'accepted', receipt: `wamid.${randomUUID()}` }) as StrictDispatchOutcome);
        // Obliterate, not drain: a killed worker leaves its job `active`, and
        // BullMQ only reconsiders a stalled job half a minute later. Draining
        // would leave that behind and every later measurement would be timing
        // the stalled checker instead of the path under test.
        await queue.obliterate({ force: true }).catch(() => undefined);
    });

    async function batchOf(items: readonly DispatchItem[]): Promise<DispatchRow[]> {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'whatsapp','active')",
            [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        const [agent] = await sql('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        const binding: DispatchBinding = { conversationId, contactId, inboundMessageId,
            channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '+573000000000' };
        const { rows } = await store.prepare(tenantId, { binding, items, operationalScope: {
            kind: 'agent', tenantId, schemaName: schema, agentId, version: 1,
            operationalHash: operationalConfigurationHash(agent) } as any });
        return rows;
    }

    const oneText = (marker: string): DispatchItem[] => [{ kind: 'text', payload: { text: marker } }];

    describe('Valkey unavailable and restarted mid-run', () => {
        it('loses no effect and repeats none when the cache disappears under a running burst', async () => {
            const rows: DispatchRow[] = [];
            for (let index = 0; index < 14; index++) {
                rows.push((await batchOf(oneText(`Respuesta ${index}`)))[0]);
            }
            const ids = rows.map(row => row.id);
            const sent: string[] = [];
            const outageAt = 4;
            sendStrict.mockImplementation(async (request: any) => {
                sent.push(bodyOf(request));
                if (sent.length === outageAt) {
                    // Cut precisely here: the permission is committed, the
                    // provider has been called, and the outcome is not written
                    // yet. That window is the entire reason this table exists,
                    // and waiting for chance to produce it makes a flaky test.
                    valkeyDown = true;
                    gate.cut();
                    setTimeout(() => { gate.restore(); valkeyDown = false; }, 1500);
                }
                await new Promise(resolve => setTimeout(resolve, 40));
                return { kind: 'accepted', receipt: `wamid.${randomUUID()}` };
            });

            const started = Date.now();
            for (const id of ids) await service.enqueueDispatch(tenantId, id);
            await new Promise(resolve => setTimeout(resolve, 2200));
            await settleQueue(400);

            // A permission granted before the outage may have reached the provider
            // and been unable to say so. Production waits out the 120 s lease; the
            // test brings that date forward, because the transition is what is
            // under test and not the wall clock.
            await sql("UPDATE agent_dispatch_outbox SET lease_expires_at = NOW() - INTERVAL '1 second' "
                + "WHERE state='admitted' AND id = ANY($1::uuid[])", [ids]);
            const pass = await recovery.recoverPending();
            await settleQueue(400);
            const elapsed = Date.now() - started;

            const states = await statesOf(ids);
            expect(states.every(state => DISPATCH_TERMINAL_STATES.includes(state))).toBe(true);
            // The claim of the whole design: an outage may cost certainty, never
            // a second copy. Every row's words left this process at most once.
            const perRow = new Map<string, number>();
            for (const body of sent) perRow.set(body, (perRow.get(body) ?? 0) + 1);
            expect([...perRow.values()].filter(count => count > 1)).toHaveLength(0);
            const [{ receipts }] = await sql(
                `SELECT COUNT(DISTINCT receipt)::int AS receipts FROM agent_dispatch_outbox
                  WHERE id = ANY($1::uuid[]) AND receipt IS NOT NULL`, [ids]);
            expect(Number(receipts)).toBe(states.filter(state => state === 'sent').length);
            // Nothing was lost either: every row either arrived or is on a
            // person's desk, and none is quietly stuck in `prepared`.
            expect(states.filter(state => state === 'sent').length
                + states.filter(state => state === 'reconciliation_required').length).toBe(ids.length);
            // Exactly the one whose outcome could not be written. An accepted
            // delivery nobody could record is uncertain, not failed and not
            // retryable — which is the honest answer and the expensive one.
            expect(states.filter(state => state === 'reconciliation_required')).toHaveLength(1);

            for (const state of new Set(states)) {
                metrics.count(`valkey_outage.final.${state}`, states.filter(value => value === state).length);
            }
            metrics.count('valkey_outage.sent_before_cut', outageAt - 1);
            metrics.count('valkey_outage.provider_calls', sent.length);
            metrics.count('valkey_outage.recovery_republished', pass.republished);
            metrics.count('valkey_outage.recovery_reconciled', pass.reconciled);
            metrics.note(`${ids.length} rows, Valkey unreachable 1500ms mid-burst;`
                + ` all terminal ${elapsed}ms after publish, ${sent.length} provider calls, 0 repeated`);
        }, 240_000);

        it('refuses to admit while the purge fence cannot be read, and keeps the work', async () => {
            const [row] = await batchOf(oneText('Sin caché no hay permiso'));
            valkeyDown = true;
            // Fail closed: a fence that cannot be read is not a fence that said
            // yes. The row keeps its state and no provider is called.
            await expect(store.admit(tenantId, row.id)).rejects.toBeDefined();
            expect(sendStrict).not.toHaveBeenCalled();
            expect(await rowOf(row.id)).toMatchObject({ state: 'prepared', attempts: 0 });
            valkeyDown = false;
            await service.enqueueDispatch(tenantId, row.id);
            await settleQueue(200);
            expect(await rowOf(row.id)).toMatchObject({ state: 'sent', attempts: 1 });
            expect(sendStrict).toHaveBeenCalledTimes(1);
        }, 120_000);
    });

    describe('a provider that stops answering', () => {
        it('leaves the row uncertain when the lease lapses mid-request, and never retries it', async () => {
            const [row] = await batchOf(oneText('El proveedor no contesta'));
            // Five seconds is the shortest permission the outbox grants; the
            // request outlives it, which is the shape of a provider that accepted
            // and never answered.
            const admit = jest.spyOn(store, 'admit').mockImplementation((tenant: string, dispatchId: string) =>
                AgentDispatchOutboxStore.prototype.admit.call(store, tenant, dispatchId, { leaseSeconds: 5 }));
            let released = 0;
            sendStrict.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 6500));
                released++;
                return { kind: 'accepted', receipt: 'wamid.TOO_LATE' };
            });

            const started = Date.now();
            await service.enqueueDispatch(tenantId, row.id);
            await new Promise(resolve => setTimeout(resolve, 5600));
            expect(await rowOf(row.id)).toMatchObject({ state: 'admitted' });
            // The pass that retires abandoned permissions, run while the request
            // is still in the air.
            const pass = await recovery.recoverPending();
            expect(pass.reconciled).toBeGreaterThanOrEqual(1);
            const lapsed = Date.now() - started;
            await settleQueue(400);

            expect(released).toBe(1);
            expect(sendStrict).toHaveBeenCalledTimes(1);
            const after = await rowOf(row.id);
            expect(after).toMatchObject({ state: 'reconciliation_required',
                error_code: 'lease_expired_after_admission' });
            // OBSERVATION: the acceptance the provider did give back is dropped.
            // `settleDispatch` refuses a lease the row no longer holds, so the
            // receipt an operator would need is written nowhere — the runbook
            // sends them to WhatsApp Manager to find it by hand.
            expect(after.receipt).toBeNull();

            // Nothing brings it back: not the recovery pass, not a republished job.
            const { rows: stillPending } = await store.pending(tenantId, 200);
            expect(stillPending.map(entry => entry.id)).not.toContain(row.id);
            await service.enqueueDispatch(tenantId, row.id);
            await settleQueue(200);
            expect(sendStrict).toHaveBeenCalledTimes(1);
            admit.mockRestore();
            metrics.samples('lease_lapse.time_to_reconciliation').add(lapsed);
            metrics.count('slow_provider.uncertain_rows');
            metrics.note('lease 5s vs 6.5s provider: row uncertain, receipt not retained, zero automatic retries');
        }, 240_000);
    });

    describe('a worker killed between admission and settle', () => {
        it('reaches reconciliation rather than a second send', async () => {
            const [row] = await batchOf(oneText('El worker muere con el permiso'));
            let inFlight!: () => void;
            const reached = new Promise<void>(resolve => { inFlight = resolve; });
            sendStrict.mockImplementation(async () => {
                inFlight();
                // Never answers: the process dies holding the permission.
                return new Promise<StrictDispatchOutcome>(() => undefined);
            });
            await service.enqueueDispatch(tenantId, row.id);
            await reached;
            expect(await rowOf(row.id)).toMatchObject({ state: 'admitted', attempts: 1 });

            // SIGKILL, as far as the queue is concerned: the job is abandoned
            // mid-flight and nothing in this process will ever settle it.
            await worker!.close(true);
            worker = undefined;
            // The abandoned job is dropped rather than waited out: BullMQ hands a
            // stalled job back half a minute later, and what is under test is the
            // row's refusal, not that timer.
            await queue.obliterate({ force: true }).catch(() => undefined);
            await sql("UPDATE agent_dispatch_outbox SET lease_expires_at = NOW() - INTERVAL '1 second' "
                + 'WHERE id=$1::uuid', [row.id]);

            const pass = await recovery.recoverPending();
            expect(pass.reconciled).toBeGreaterThanOrEqual(1);
            expect(await rowOf(row.id)).toMatchObject({ state: 'reconciliation_required' });
            const { rows: stillPending } = await store.pending(tenantId, 200);
            expect(stillPending.map(entry => entry.id)).not.toContain(row.id);

            // A new worker, and the same row handed to it again. BullMQ re-delivers
            // a stalled job on its own schedule; publishing a second job for the
            // row is the same event without waiting 30 s for it. The row, not the
            // queue, is what refuses.
            sendStrict.mockImplementation(async () => ({ kind: 'accepted', receipt: 'wamid.SECOND' }));
            await startWorker(1);
            await queue.add('dispatch', { dispatch: { tenantId, dispatchId: row.id } },
                { jobId: `dispatch-${row.id}-redelivery`, attempts: 1, removeOnComplete: true });
            await settleQueue(200);
            expect(sendStrict).toHaveBeenCalledTimes(1);
            expect(await rowOf(row.id)).toMatchObject({ state: 'reconciliation_required', receipt: null });
            metrics.count('worker_killed.reconciled');
        }, 240_000);
    });

    describe('concurrent bursts through the real queue', () => {
        it('delivers each effect once and each batch in order, with four workers', async () => {
            await worker?.close();
            await startWorker(4);
            const batches: DispatchRow[][] = [];
            for (let index = 0; index < 10; index++) {
                batches.push(await batchOf([
                    { kind: 'media', payload: { mediaUrl: `https://cdn.test/${index}.jpg`, mediaType: 'image' } },
                    { kind: 'text', payload: { text: `Pie de foto ${index}` } },
                ]));
            }
            const order: string[] = [];
            let started = Date.now();
            sendStrict.mockImplementation(async (request: any) => {
                order.push(bodyOf(request));
                metrics.samples('queue_burst.publish_to_send').add(Date.now() - started);
                await new Promise(resolve => setTimeout(resolve, 5 + Math.floor(Math.random() * 15)));
                return { kind: 'accepted', receipt: `wamid.${randomUUID()}` };
            });

            started = Date.now();
            await Promise.all(batches.map(rows =>
                store.publishBatch(tenantId, rows, (id, delay) => service.enqueueDispatch(tenantId, id, delay))));
            await settleQueue(600);
            const elapsed = Date.now() - started;

            const ids = batches.flat().map(row => row.id);
            expect(await statesOf(ids)).toEqual(ids.map(() => 'sent'));
            expect(sendStrict).toHaveBeenCalledTimes(ids.length);
            expect(new Set(order).size).toBe(ids.length);
            for (const [index] of batches.entries()) {
                // A caption may never overtake its own picture, whichever worker
                // happens to pick either of them up.
                const picture = order.indexOf(`https://cdn.test/${index}.jpg`);
                const caption = order.indexOf(`Pie de foto ${index}`);
                expect(picture).toBeGreaterThanOrEqual(0);
                expect(caption).toBeGreaterThan(picture);
            }
            metrics.count('queue_burst.effects', ids.length);
            metrics.note(`${batches.length} two-effect batches, worker concurrency 4:`
                + ` ${elapsed}ms end to end → ${(ids.length / (elapsed / 1000)).toFixed(1)} effects/s`);
            await worker?.close();
            await startWorker(1);
        }, 240_000);
    });

    describe('erasure concurrent with delivery', () => {
        it('never sends erased words and never repeats the effect', async () => {
            const [row] = await batchOf(oneText('Palabras que el cliente hará borrar'));
            const [{ contact_id: contactId }] = await sql(
                'SELECT contact_id FROM agent_dispatch_outbox WHERE id=$1::uuid', [row.id]);
            let inFlight!: () => void;
            const reached = new Promise<void>(resolve => { inFlight = resolve; });
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const sentBodies: string[] = [];
            sendStrict.mockImplementation(async (request: any) => {
                sentBodies.push(bodyOf(request));
                inFlight();
                await held;
                return { kind: 'accepted', receipt: 'wamid.ERASURE' };
            });

            await service.enqueueDispatch(tenantId, row.id);
            await reached;
            // The right to be forgotten lands while the request is in the air.
            const redacted = await prisma.transactionInTenantSchema(schema, (query: any) =>
                redactDispatchOutbox(query, schema, { contactIds: [String(contactId)] }));
            expect(redacted).toBeGreaterThanOrEqual(1);
            release();
            await settleQueue(200);

            const after = await rowOf(row.id);
            expect(after.payload).toBeNull();
            expect(after.redacted_at).not.toBeNull();
            // Admitted at the moment of erasure, so the effect is uncertain by
            // definition — and a redacted row is never resent under any evidence.
            expect(after.state).toBe('reconciliation_required');
            expect(sentBodies).toEqual(['Palabras que el cliente hará borrar']);

            await recovery.recoverPending();
            await service.enqueueDispatch(tenantId, row.id);
            await settleQueue(200);
            expect(sendStrict).toHaveBeenCalledTimes(1);
            metrics.count('erasure_in_flight.reconciled');
        }, 240_000);
    });
});
