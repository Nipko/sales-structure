import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffReturnReplayService } from './handoff-return-replay.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * The claim behind the unattended-return replay, against a real PostgreSQL: one
 * claim per handoff episode (even when two callers race), and none while a
 * person has answered, the notice was consumed or the conversation is not
 * active.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('handoff return replay on PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_hreplay_${randomUUID().replace(/-/g, '')}`;
    const contactId = randomUUID();
    let client: PrismaClient;
    let prisma: any;
    let service: HandoffReturnReplayService;
    let queue: { enqueue: jest.Mock };
    let redis: { del: jest.Mock };
    jest.setTimeout(120_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    async function returned(over: {
        status?: string; pending?: boolean; returnedToAi?: boolean; startedMinutesAgo?: number;
        externalId?: string | null; waiting?: number;
    } = {}) {
        const id = randomUUID();
        const minutes = over.startedMinutesAgo ?? 15;
        await sql(`INSERT INTO conversations(id, contact_id, channel_type, channel_account_id, status, metadata)
            VALUES($1::uuid, $2::uuid, 'telegram', 'bot-1', $3, jsonb_build_object('handoff', jsonb_build_object(
                'startedAt', to_char((NOW() - ($4 || ' minutes')::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'returnedToAi', $5::boolean, 'returnNoticePending', $6::boolean)))`,
            [id, contactId, over.status ?? 'active', String(minutes), over.returnedToAi ?? true, over.pending ?? true]);
        const count = over.waiting ?? 1;
        for (let i = 0; i < count; i++) {
            const external = over.externalId === undefined ? `tgu${1000 + i}` : over.externalId;
            await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text, external_id, metadata, created_at)
                VALUES($1::uuid, 'inbound', 'text', $2, $3, $4::jsonb, NOW() - ($5 || ' minutes')::interval)`,
                [id, `mensaje ${i}`, external, JSON.stringify({ updateId: 1000 + i }), String(5 - i)]);
        }
        return id;
    }
    const event = (conversationId: string) => ({ tenantId, schemaName: schema, conversationId });
    const metadata = async (id: string) => (await sql('SELECT metadata FROM conversations WHERE id=$1::uuid', [id]))[0].metadata;

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(s => client.$executeRawUnsafe(s));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',
            tenantId, schema, 'es');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, external_id VARCHAR(255))');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID, channel_type TEXT,
            channel_account_id TEXT, status TEXT, metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
            direction TEXT, content_type TEXT DEFAULT 'text', content_text TEXT, media_url TEXT, media_mime_type TEXT,
            caption TEXT, external_id VARCHAR(255), metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`);
        await sql(`CREATE TABLE agent_dispatch_outbox(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
            operational_scope JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await sql('INSERT INTO contacts(id, external_id) VALUES($1::uuid, $2)', [contactId, '555000']);
        queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
        redis = { del: jest.fn().mockResolvedValue(1) };
        service = new HandoffReturnReplayService(prisma, redis as any, queue as any, { detectOptOut: () => false } as any);
        (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_hreplay_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await sql('TRUNCATE conversations, messages, agent_dispatch_outbox');
        queue.enqueue.mockClear();
        queue.enqueue.mockResolvedValue(undefined);
        redis.del.mockClear();
    });

    it('replays the waiting messages once, as one turn, and records the episode it did it for', async () => {
        const id = await returned({ waiting: 2 });
        const result = await service.replayWaitingMessages(event(id));
        expect(result.kind).toBe('enqueued');
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        const [msg] = queue.enqueue.mock.calls[0];
        expect(msg.content.text).toBe('mensaje 0\nmensaje 1');
        expect(msg.contactId).toBe('555000');
        expect(msg.metadata.updateId).toBe(1001);
        expect((await metadata(id)).handoff.returnReplayFor).toBe((await metadata(id)).handoff.startedAt);
    });

    it('a second event, or a second sweep process, does not replay again', async () => {
        const id = await returned();
        await service.replayWaitingMessages(event(id));
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('two callers racing for the same episode: exactly one enqueue', async () => {
        const id = await returned();
        await Promise.all([1, 2, 3, 4].map(() => service.replayWaitingMessages(event(id))));
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(redis.del).toHaveBeenCalledTimes(1);
    });

    it('a NEW handoff episode of the same conversation can be replayed again', async () => {
        const id = await returned();
        await service.replayWaitingMessages(event(id));
        await sql(`UPDATE conversations SET metadata = jsonb_set(metadata, '{handoff,startedAt}', to_jsonb(to_char((NOW() - interval '12 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) WHERE id=$1::uuid`, [id]);
        await sql(`UPDATE messages SET created_at = NOW() - interval '1 minute' WHERE conversation_id=$1::uuid`, [id]);
        expect((await service.replayWaitingMessages(event(id))).kind).toBe('enqueued');
        expect(queue.enqueue).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['waiting_human', { status: 'waiting_human' }],
        ['with_human', { status: 'with_human' }],
        ['the return notice was already consumed by a normal turn', { pending: false }],
        ['it was never returned to the agent', { returnedToAi: false }],
    ])('nothing is replayed when %s', async (_label, over) => {
        const id = await returned(over as any);
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect(queue.enqueue).not.toHaveBeenCalled();
        expect(redis.del).not.toHaveBeenCalled();
    });

    it('nothing is replayed when a person answered through the durable outbox since the handoff', async () => {
        const id = await returned();
        await sql(`INSERT INTO agent_dispatch_outbox(conversation_id, operational_scope) VALUES($1::uuid, '{"kind":"human_operator"}')`, [id]);
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('nothing is replayed when a person answered in the widget or with a canned reply', async () => {
        for (const meta of ['{"source":"agent"}', '{"sender_type":"agent"}']) {
            const id = await returned();
            await sql(`INSERT INTO messages(conversation_id, direction, metadata, created_at) VALUES($1::uuid, 'outbound', $2::jsonb, NOW() - interval '1 minute')`, [id, meta]);
            expect((await service.replayWaitingMessages(event(id))).kind).toBe('skipped');
        }
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('a person who answered BEFORE the handoff started does not block it', async () => {
        const id = await returned();
        await sql(`INSERT INTO agent_dispatch_outbox(conversation_id, operational_scope, created_at)
            VALUES($1::uuid, '{"kind":"human_operator"}', NOW() - interval '2 hours')`, [id]);
        expect((await service.replayWaitingMessages(event(id))).kind).toBe('enqueued');
    });

    it('a failed enqueue returns the claim, so the next event replays', async () => {
        const id = await returned();
        queue.enqueue.mockRejectedValue(new Error('redis down'));
        await expect(service.replayWaitingMessages(event(id))).rejects.toThrow('redis down');
        expect((await metadata(id)).handoff.returnReplayFor).toBeUndefined();
        queue.enqueue.mockResolvedValue(undefined);
        expect((await service.replayWaitingMessages(event(id))).kind).toBe('enqueued');
    });

    it('a message without a provider id is left alone and the claim returned', async () => {
        const id = await returned({ externalId: null });
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'last_message_has_no_provider_id' });
        expect((await metadata(id)).handoff.returnReplayFor).toBeUndefined();
    });
});
