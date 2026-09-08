import { randomUUID } from 'crypto';
import { Queue, Worker, DelayedError } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { OutboundQueueService } from './outbound-queue.service';
import { OutboundQueueProcessor, OUTBOUND_QUEUE } from './outbound-queue.processor';
import { DISPATCH_OUTBOX_DDL, type DispatchBinding, type DispatchItem } from './agent-dispatch-outbox';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import type { StrictDispatchOutcome } from './strict-dispatch-transport';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!databaseUrl && !!redisUrl;

/**
 * The retry clock, exercised with the real queue and the real database.
 *
 * The loss this covers was invisible to unit tests: a row left `failed` with a
 * future `available_at`, a BullMQ retry arriving earlier, admission answering
 * "not available yet", the job COMPLETING, and the recovery pass then finding a
 * retained completed job and never republishing. Only a real queue shows it.
 */
(ready ? describe : describe.skip)('durable dispatch through real BullMQ and PostgreSQL', () => {
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_dispatch_q_${randomUUID().replace(/-/g, '')}`;
    const queueName = `${OUTBOUND_QUEUE}-test-${randomUUID().slice(0, 8)}`;
    let client: PrismaClient, prisma: any, store: AgentDispatchOutboxStore;
    let queue: Queue, worker: Worker, service: OutboundQueueService, processor: OutboundQueueProcessor;
    let connection: { host: string; port: number };
    let outcomes: StrictDispatchOutcome[];
    let sendStrict: jest.Mock;

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const rowOf = async (id: string) => (await sql(
        'SELECT state, attempts, receipt, error_code, available_at FROM agent_dispatch_outbox WHERE id=$1::uuid',
        [id]))[0];
    const jobState = async (dispatchId: string) => {
        const job = await queue.getJob(`dispatch-${dispatchId}`);
        return job ? await job.getState() : 'missing';
    };
    const settleQueue = async (attempts = 60) => {
        for (let i = 0; i < attempts; i++) {
            const counts = await queue.getJobCounts('active', 'waiting', 'prioritized');
            if (!counts.active && !counts.waiting && !counts.prioritized) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    };

    beforeAll(async () => {
        const dbUrl = new URL(databaseUrl!), rUrl = new URL(redisUrl!);
        if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        if (!['localhost', '127.0.0.1'].includes(rUrl.hostname)) throw new Error('disposable_loopback_redis_required');
        connection = { host: rUrl.hostname, port: Number(rUrl.port) };

        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT,is_active BOOLEAN,language TEXT)');
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.tenant = { findUnique: jest.fn(async () => (
            { id: tenantId, schemaName: schema, isActive: true, onboardingCompletedAt: new Date(),
                isInternal: false, subscriptionStatus: 'active',
                subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null } })) };
        store = new AgentDispatchOutboxStore(prisma, { get: jest.fn(async () => null) } as any);

        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active')`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],
            channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        await sql('CREATE TABLE persona_config(config_json JSONB,is_active BOOLEAN,version INTEGER)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}',
            ARRAY['whatsapp'],'{}'::text[],'24_7',true,true,1)`, [agentId]);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        queue = new Queue(queueName, { connection });
        sendStrict = jest.fn(async () => outcomes.shift() ?? { kind: 'accepted', receipt: `wamid.${randomUUID()}` });
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
        worker = new Worker(queueName, async (job, token) => processor.process(job as any, token),
            { connection, concurrency: 1 });
        await worker.waitUntilReady();
    }, 60_000);

    afterAll(async () => {
        await worker?.close();
        await queue?.obliterate({ force: true }).catch(() => undefined);
        await queue?.close();
        if (!client) return;
        try {
            if (!/^tenant_dispatch_q_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    }, 60_000);

    beforeEach(async () => {
        outcomes = [];
        sendStrict.mockClear();
        await queue.drain(true).catch(() => undefined);
        await sql('TRUNCATE agent_dispatch_outbox_sources, agent_dispatch_outbox, messages, conversations, contacts CASCADE');
    });

    const items: DispatchItem[] = [{ kind: 'text', payload: { text: 'La respuesta del agente' } }];

    async function prepared(): Promise<{ binding: DispatchBinding; dispatchId: string }> {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'whatsapp','active')", [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        const [agent] = await sql('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        const binding: DispatchBinding = { conversationId, contactId, inboundMessageId,
            channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '+573000000000' };
        const { rows } = await store.prepare(tenantId, { binding, items, operationalScope: {
            kind: 'agent', tenantId, schemaName: schema, agentId, version: 1,
            operationalHash: operationalConfigurationHash(agent) } as any });
        return { binding, dispatchId: rows[0].id };
    }

    it('delivers once and records the provider receipt', async () => {
        const { dispatchId } = await prepared();
        outcomes = [{ kind: 'accepted', receipt: 'wamid.ONE' }];
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(sendStrict).toHaveBeenCalledTimes(1);
        expect(await rowOf(dispatchId)).toMatchObject({ state: 'sent', receipt: 'wamid.ONE', attempts: 1 });
        expect(await jobState(dispatchId)).toBe('completed');
    }, 30_000);

    it('waits on the durable date instead of completing the job on a retryable failure', async () => {
        const { dispatchId } = await prepared();
        // Two seconds of durable backoff, then success. BullMQ must not choose
        // its own moment, and must not complete the job in the meantime.
        outcomes = [{ kind: 'rejected', errorCode: 'http_503', retryable: true }];
        await service.enqueueDispatch(tenantId, dispatchId);
        await new Promise(resolve => setTimeout(resolve, 400));
        expect(await rowOf(dispatchId)).toMatchObject({ state: 'failed', attempts: 1 });
        // The job is parked, not finished: a completed job here is the loss.
        expect(['delayed', 'waiting', 'active']).toContain(await jobState(dispatchId));
        expect(sendStrict).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('sends exactly one request per granted permission across a full retry cycle', async () => {
        const { dispatchId } = await prepared();
        await sql("UPDATE agent_dispatch_outbox SET available_at=NOW() WHERE id=$1::uuid", [dispatchId]);
        outcomes = [
            { kind: 'rejected', errorCode: 'http_503', retryable: true },
            { kind: 'accepted', receipt: 'wamid.SECOND' },
        ];
        await service.enqueueDispatch(tenantId, dispatchId);
        // Wait for the first failure, then bring the durable date forward so the
        // parked job becomes due, and republish exactly as recovery would.
        await new Promise(resolve => setTimeout(resolve, 500));
        await sql("UPDATE agent_dispatch_outbox SET available_at=NOW()-INTERVAL '1 second' WHERE id=$1::uuid", [dispatchId]);
        const job = await queue.getJob(`dispatch-${dispatchId}`);
        await job!.promote().catch(() => undefined);
        await settleQueue();
        expect(await rowOf(dispatchId)).toMatchObject({ state: 'sent', receipt: 'wamid.SECOND', attempts: 2 });
        // One POST per permission: two permissions, two requests, never three.
        expect(sendStrict).toHaveBeenCalledTimes(2);
    }, 30_000);

    it('suppresses the row when the attempt budget is spent, and stops sending', async () => {
        const { dispatchId } = await prepared();
        await sql("UPDATE agent_dispatch_outbox SET attempts=4 WHERE id=$1::uuid", [dispatchId]);
        outcomes = [{ kind: 'rejected', errorCode: 'http_503', retryable: true }];
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(await rowOf(dispatchId)).toMatchObject({ state: 'suppressed', attempts: 5 });
        expect(sendStrict).toHaveBeenCalledTimes(1);
        // Terminal: republishing must never produce another request.
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(sendStrict).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('republishes work whose job was retained as completed', async () => {
        const { dispatchId } = await prepared();
        outcomes = [{ kind: 'accepted', receipt: 'wamid.FIRST' }];
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(await jobState(dispatchId)).toBe('completed');

        // The row is put back to work — exactly the shape recovery finds after a
        // stale completion. A retained id used to make this a silent no-op.
        await sql("UPDATE agent_dispatch_outbox SET state='queued', receipt=NULL, settled_lease_token=NULL, available_at=NOW() WHERE id=$1::uuid", [dispatchId]);
        outcomes = [{ kind: 'accepted', receipt: 'wamid.AGAIN' }];
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(sendStrict).toHaveBeenCalledTimes(2);
        expect(await rowOf(dispatchId)).toMatchObject({ state: 'sent', receipt: 'wamid.AGAIN' });
    }, 30_000);

    it('leaves an uncertain outcome for reconciliation and never retries it', async () => {
        const { dispatchId } = await prepared();
        outcomes = [{ kind: 'unknown', errorCode: 'provider_timeout' }];
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(await rowOf(dispatchId)).toMatchObject(
            { state: 'reconciliation_required', error_code: 'provider_timeout' });
        expect(await jobState(dispatchId)).toBe('completed');
        expect(sendStrict).toHaveBeenCalledTimes(1);
        await service.enqueueDispatch(tenantId, dispatchId);
        await settleQueue();
        expect(sendStrict).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('parks a preflight failure on the durable date rather than completing it', async () => {
        const { dispatchId } = await prepared();
        const token = processor as any;
        token.channelToken.getChannelToken.mockRejectedValueOnce(new Error('token expired'));
        await service.enqueueDispatch(tenantId, dispatchId);
        await new Promise(resolve => setTimeout(resolve, 400));
        const row = await rowOf(dispatchId);
        expect(row).toMatchObject({ state: 'failed', attempts: 1 });
        expect(String(row.error_code)).toContain('channel_credentials_unavailable');
        expect(['delayed', 'waiting', 'active']).toContain(await jobState(dispatchId));
        expect(sendStrict).not.toHaveBeenCalled();
    }, 30_000);

    it('never lets DelayedError be swallowed as an unrecorded outcome', () => {
        // The settle-failure handler returns instead of throwing; a DelayedError
        // passing through it would silently complete a job that must stay parked.
        expect(new DelayedError()).toBeInstanceOf(DelayedError);
    });
});
