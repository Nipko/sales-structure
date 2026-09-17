import { randomUUID } from 'crypto';
import { DelayedError } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import { DISPATCH_OUTBOX_DDL, type DispatchBinding } from './agent-dispatch-outbox';
import { ConnectionRefusedError } from './connection-refusal';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import type { StrictDispatchOutcome } from './strict-dispatch-transport';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { permissiveSpendGate, resolvingChannelToken, openPauseStore } from './__fixtures__/spend-gate-double';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * The processor and the outbox, across the seam where the production error lived.
 *
 * `dispatch_terminal:suppressed` came out of `recordDispatchPreflightFailure`,
 * called by the processor's `preflight`: a refusal reached the row after the row
 * had already ended. The unit spec can only say what the processor does with a
 * code its double chose to throw. Whether the real store throws that code, on
 * which paths, and whether the row is left exactly as the decision that ended it
 * wrote it, only a real transaction can say — so both halves run for real here
 * and only the provider, the credential lookup and the money gate are doubles.
 */
(databaseUrl ? describe : describe.skip)('a dispatch refusal that finds its row already ended, on real PostgreSQL', () => {
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_dispatch_term_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, prisma: any, store: AgentDispatchOutboxStore;
    const redis = {
        get: jest.fn(async () => null), set: jest.fn(async () => undefined),
        hincrBy: jest.fn(async () => 1), expire: jest.fn(async () => 1),
    };

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const rawRow = async (id: string) => (await sql(
        `SELECT state, attempts, error_code, receipt, updated_at, lease_token
           FROM agent_dispatch_outbox WHERE id = $1::uuid`, [id]))[0];

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        // The lifecycle and the subscription are one lookup in production and
        // are stubbed together here. Everything the outbox decides is real SQL.
        prisma.tenant = { findUnique: jest.fn(async () => ({
            id: tenantId, schemaName: schema, isActive: true, onboardingCompletedAt: new Date(),
            isInternal: false, subscriptionStatus: 'active',
            subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
        })) };
        prisma.getTenantSchemaName = jest.fn(async () => schema);
        store = new AgentDispatchOutboxStore(prisma, redis as any);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active', channel_account_id TEXT)`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],
            channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        await sql('CREATE TABLE persona_config(config_json JSONB,is_active BOOLEAN,version INTEGER)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql(`CREATE TABLE learning_sources(id UUID PRIMARY KEY,agent_id UUID,source_kind TEXT,status TEXT,
            source_contact_id UUID,source_conversation_id UUID,channel TEXT,transcript JSONB,source_evidence JSONB)`);
        await sql('CREATE TABLE learning_examples(id UUID PRIMARY KEY,source_id UUID,agent_id UUID,status TEXT)');
        await sql(`CREATE TABLE learning_releases(id UUID PRIMARY KEY,agent_id UUID,status TEXT,snapshot JSONB,
            snapshot_hash TEXT,example_ids UUID[])`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_dispatch_term_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await sql(`TRUNCATE agent_dispatch_outbox_sources, agent_dispatch_outbox, messages, conversations,
            contacts, agent_personas, persona_config, learning_releases, learning_examples,
            learning_sources, customer_memory_erasure CASCADE`);
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}',
            ARRAY['whatsapp'],'{}'::text[],'24_7',true,true,1)`, [agentId]);
    });

    /** One prepared reply, bound to a real conversation and served by the real agent row. */
    async function preparedReply(): Promise<{ id: string; messageId: string }> {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,status,channel_account_id)
            VALUES($1::uuid,$2::uuid,'whatsapp','active','phone-1')`, [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        const binding: DispatchBinding = { conversationId, contactId, inboundMessageId,
            channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '+573000000000' };
        const [agent] = await sql('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        const { rows } = await store.prepare(tenantId, {
            binding, items: [{ kind: 'text', payload: { text: 'La respuesta del agente' } }],
            operationalScope: { kind: 'agent', tenantId, schemaName: schema, agentId, version: 1,
                operationalHash: operationalConfigurationHash(agent) },
        });
        return { id: rows[0].id, messageId: rows[0].messageId! };
    }

    function worker(options: {
        transport?: boolean;
        outcome?: StrictDispatchOutcome;
        getChannelToken?: () => Promise<{ accessToken: string }>;
    } = {}) {
        const sendStrict = jest.fn(async () => options.outcome ?? { kind: 'accepted', receipt: 'wamid.OK' });
        const gateway = {
            sendMessage: jest.fn(),
            getStrictTransport: jest.fn(() => (options.transport === false
                ? undefined : { channelType: 'whatsapp', sendStrict })),
        };
        const throttle = {
            reserveActionUsage: jest.fn(async () => ({ allowed: true, count: 1, adopted: false })),
            commitActionUsage: jest.fn(async () => undefined),
            releaseActionUsage: jest.fn(async () => undefined),
        };
        const spendGate = permissiveSpendGate();
        const channelToken = resolvingChannelToken({
            getChannelToken: jest.fn(options.getChannelToken ?? (async () => ({ accessToken: 'token' }))),
        });
        const processor = new OutboundQueueProcessor(gateway as any, throttle as any, channelToken,
            redis as any, { send: jest.fn() } as any, prisma, spendGate, openPauseStore(),
            undefined, undefined, store);
        return { processor, sendStrict, spendGate };
    }

    const jobFor = (dispatchId: string): any => ({
        id: `dispatch-${dispatchId}`, data: { dispatch: { tenantId, dispatchId } },
        moveToDelayed: jest.fn(async () => undefined),
    });

    describe('when the row ends between the processor reading it and recording the refusal', () => {
        it('ends the job as the early terminal check would, and leaves the row exactly as it was', async () => {
            // A second execution of the SAME job — BullMQ re-runs one whose lock
            // it believes lost, while the first is still alive — gets all the way
            // through: admitted, posted, refused for good by the provider, and
            // settled `suppressed`. Meanwhile the first is still waiting on its
            // credential lookup, which fails on the very Redis blip that cost it
            // the lock. Its refusal then reaches a row that has already ended.
            const reply = await preparedReply();
            let second: string | null | undefined;
            const healthy = worker({ outcome: { kind: 'rejected', errorCode: 'wa_131026', retryable: false } });
            const refusing = worker({
                getChannelToken: async () => {
                    second = await healthy.processor.process(jobFor(reply.id), 'token-2');
                    throw new ConnectionRefusedError('connection_state_unreadable',
                        { tenantId, channelType: 'whatsapp', requestedAccountId: 'phone-1' });
                },
            });
            const job = jobFor(reply.id);

            await expect(refusing.processor.process(job, 'token-1')).resolves.toBe('dispatch:suppressed');

            expect(second).toBe('dispatch:suppressed:wa_131026');
            // Exactly one remote effect, and it belongs to the execution that
            // held the lease. The late refusal produced none.
            expect(healthy.sendStrict).toHaveBeenCalledTimes(1);
            expect(refusing.sendStrict).not.toHaveBeenCalled();
            expect(refusing.spendGate.admit).not.toHaveBeenCalled();
            expect(job.moveToDelayed).not.toHaveBeenCalled();
            // The provider's answer is what the row says, and it was not
            // overwritten by a refusal about a credential lookup.
            const settled = await rawRow(reply.id);
            expect(settled).toMatchObject({ state: 'suppressed', error_code: 'wa_131026', attempts: 1 });
        });

        it('writes nothing at all to a row that ended first', async () => {
            const reply = await preparedReply();
            await sql(`UPDATE agent_dispatch_outbox SET state='suppressed', error_code='spend_cap_exhausted',
                updated_at = NOW() - INTERVAL '1 minute' WHERE id=$1::uuid`, [reply.id]);
            const before = await rawRow(reply.id);
            // The processor read the row while it was still `prepared`; the
            // suppression lands before its refusal does.
            const refusing = worker({ transport: false });
            const read = store.read.bind(store);
            const stale = jest.spyOn(store, 'read').mockImplementationOnce(async (tenant, id) =>
                ({ ...(await read(tenant, id))!, state: 'prepared' }));
            try {
                await expect(refusing.processor.process(jobFor(reply.id))).resolves.toBe('dispatch:suppressed');
            } finally { stale.mockRestore(); }
            const after = await rawRow(reply.id);
            expect(after).toEqual(before);
            expect(refusing.sendStrict).not.toHaveBeenCalled();
        });
    });

    describe('when admission itself suppressed the effect', () => {
        it('reports the decision admission committed instead of refusing on top of it', async () => {
            // No race is needed for this one, and it is the likelier source of
            // the production error: the agent changed while the reply waited.
            // `admit` suppresses and commits, then says
            // `dispatch_effect_superseded` — which the processor used to hand to
            // the generic permanent preflight, which reopened the row, found it
            // suppressed, and threw.
            const reply = await preparedReply();
            await sql('UPDATE agent_personas SET version=2 WHERE id=$1::uuid', [agentId]);
            const edited = worker();

            await expect(edited.processor.process(jobFor(reply.id)))
                .resolves.toBe('dispatch:suppressed:agent_agent_operational_revision_changed');

            expect(edited.sendStrict).not.toHaveBeenCalled();
            expect(edited.spendGate.admit).not.toHaveBeenCalled();
            // What admission wrote stands: the reason is the agent, not the
            // word the store used to announce it, and no attempt was spent twice.
            expect(await rawRow(reply.id)).toMatchObject({ state: 'suppressed',
                error_code: 'agent_agent_operational_revision_changed', attempts: 1, lease_token: null });
            const [history] = await sql('SELECT status FROM messages WHERE id=$1::uuid', [reply.messageId]);
            expect(history.status).toBe('failed');
        });
    });

    describe('a refusal on a row that is still open is recorded exactly as before', () => {
        it('spends an attempt and parks the job on the durable date when it may clear', async () => {
            const reply = await preparedReply();
            const refusing = worker({ getChannelToken: async () => {
                throw new ConnectionRefusedError('credential_not_client_scoped',
                    { tenantId, channelType: 'whatsapp', requestedAccountId: 'phone-1' });
            } });
            const job = jobFor(reply.id);
            await expect(refusing.processor.process(job, 'token-1')).rejects.toBeInstanceOf(DelayedError);
            expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
            expect(await rawRow(reply.id)).toMatchObject({ state: 'failed', attempts: 1,
                error_code: 'channel_credentials_unavailable:credential_not_client_scoped' });
            expect(refusing.sendStrict).not.toHaveBeenCalled();
        });

        it('suppresses at once when the refusal is permanent, and marks the history failed', async () => {
            const reply = await preparedReply();
            const refusing = worker({ transport: false });
            const job = jobFor(reply.id);
            await expect(refusing.processor.process(job))
                .resolves.toBe('dispatch:suppressed:transport_not_migrated:whatsapp');
            expect(job.moveToDelayed).not.toHaveBeenCalled();
            expect(await rawRow(reply.id)).toMatchObject({ state: 'suppressed', attempts: 1,
                error_code: 'transport_not_migrated:whatsapp' });
            const [history] = await sql('SELECT status FROM messages WHERE id=$1::uuid', [reply.messageId]);
            expect(history.status).toBe('failed');
        });

        it('still refuses to record anything against a permission somebody holds', async () => {
            // `admitted` is not an ending. The holder's outcome is what is
            // missing, so this stays an error rather than a completed job.
            const reply = await preparedReply();
            let holder: Awaited<ReturnType<AgentDispatchOutboxStore['admit']>> | undefined;
            const refusing = worker({ getChannelToken: async () => {
                holder = await store.admit(tenantId, reply.id);
                throw new Error('token lookup failed');
            } });
            await expect(refusing.processor.process(jobFor(reply.id)))
                .rejects.toMatchObject({ code: 'dispatch_lease_active' });
            expect(await rawRow(reply.id)).toMatchObject({ state: 'admitted', attempts: 1,
                lease_token: holder!.leaseToken });
        });
    });
});
