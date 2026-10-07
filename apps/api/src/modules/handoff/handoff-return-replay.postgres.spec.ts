import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffReturnReplayService } from './handoff-return-replay.service';
import { ConversationsService } from '../conversations/conversations.service';
import { conversationHistorySql } from '../conversations/conversation-history-query';
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
    const widget = { processWidgetMessage: jest.fn().mockResolvedValue({ status: 'stored', messages: [] }) };
    jest.setTimeout(120_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    async function returned(over: {
        status?: string; pending?: boolean; returnedToAi?: boolean; startedMinutesAgo?: number;
        externalId?: string | null; waiting?: number; channel?: string; claims?: number;
    } = {}) {
        const id = randomUUID();
        const minutes = over.startedMinutesAgo ?? 15;
        await sql(`INSERT INTO conversations(id, contact_id, channel_type, channel_account_id, status, metadata)
            VALUES($1::uuid, $2::uuid, $7, 'bot-1', $3, jsonb_build_object('handoff', jsonb_build_object(
                'startedAt', to_char((NOW() - ($4 || ' minutes')::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'returnedToAi', $5::boolean, 'returnNoticePending', $6::boolean, 'returnReplayClaims', $8::int)))`,
            [id, contactId, over.status ?? 'active', String(minutes), over.returnedToAi ?? true, over.pending ?? true,
                over.channel ?? 'telegram', over.claims ?? 0]);
        const count = over.waiting ?? 1;
        for (let i = 0; i < count; i++) {
            const external = over.externalId === undefined ? `tgu${1000 + i}` : over.externalId;
            await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text, external_id, metadata, created_at)
                VALUES($1::uuid, 'inbound', 'text', $2, $3, $4::jsonb, NOW() - ($5 || ' seconds')::interval)`,
                [id, `mensaje ${i}`, external, JSON.stringify({ updateId: 1000 + i }), String((count - i) * 5)]);
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
            message_id UUID, operational_scope JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await sql('INSERT INTO contacts(id, external_id) VALUES($1::uuid, $2)', [contactId, '555000']);
        queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
        redis = { del: jest.fn().mockResolvedValue(1) };
        service = new HandoffReturnReplayService(prisma, redis as any, queue as any, {} as any);
        (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        (service as any).conversationsService = async () => widget;
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
        widget.processWidgetMessage.mockClear();
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
        const handoff = (await metadata(id)).handoff;
        expect(handoff.returnReplayFor).toBe(handoff.startedAt);
        expect(handoff.returnReplayClaims).toBe(1);
        // the instant the race guard compares later outbound messages against
        expect(Number.isNaN(Date.parse(handoff.returnReplayClaimedAt))).toBe(false);
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

    it('a queue-channel message without a provider id is not replayed, and the claim stays (a permanent skip)', async () => {
        const id = await returned({ externalId: null });
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'last_message_has_no_provider_id' });
        expect((await metadata(id)).handoff.returnReplayFor).toBeDefined();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('a replay that keeps failing is given up after five claims', async () => {
        const id = await returned();
        queue.enqueue.mockRejectedValue(new Error('redis down'));
        for (let i = 0; i < 5; i++) await expect(service.replayWaitingMessages(event(id))).rejects.toThrow('redis down');
        queue.enqueue.mockResolvedValue(undefined);
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect((await metadata(id)).handoff.returnReplayClaims).toBe(5);
    });

    it('the web chat is answered by its own turn on the stored inbound message, once', async () => {
        const id = await returned({ channel: 'web_widget', externalId: null });
        const lastMessage = (await sql(`SELECT id FROM messages WHERE conversation_id=$1::uuid ORDER BY created_at DESC LIMIT 1`, [id]))[0].id;
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'answered_in_widget' });
        expect(await service.replayWaitingMessages(event(id))).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect(widget.processWidgetMessage).toHaveBeenCalledTimes(1);
        expect(widget.processWidgetMessage.mock.calls[0][5]).toMatchObject({
            inboundMessageId: lastMessage, handoffReturnReplay: true, allowHumanHandoff: false });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });
    it('folds at most the 20 most recent waiting messages, oldest first among them', async () => {
        const id = await returned({ waiting: 25 });
        await service.replayWaitingMessages(event(id));
        const [msg] = queue.enqueue.mock.calls[0];
        const lines = String(msg.content.text).split('\n');
        expect(lines).toHaveLength(20);
        expect(lines[0]).toBe('mensaje 5');
        expect(lines[19]).toBe('mensaje 24');
        expect(msg.metadata.updateId).toBe(1024);
    });

    // ── The race guard: only a reply to the customer counts ──
    describe('has somebody already answered the customer since the claim?', () => {
        const conversations: any = Object.create(ConversationsService.prototype);
        const stale = (conversationId: string, inboundId: string) =>
            (conversations as any).returnReplayIsStale(schema, conversationId, inboundId);
        async function claimed() {
            const id = await returned();
            await sql(`UPDATE conversations SET metadata = jsonb_set(metadata, '{handoff,returnReplayClaimedAt}',
                to_jsonb(to_char(NOW() AT TIME ZONE 'UTC' - interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHERE id=$1::uuid`, [id]);
            const inbound = (await sql('SELECT id FROM messages WHERE conversation_id=$1::uuid ORDER BY created_at DESC LIMIT 1', [id]))[0].id;
            return { id, inbound };
        }
        const outbound = (id: string, metadata: object = {}) => sql(
            `INSERT INTO messages(conversation_id, direction, content_text, metadata, created_at)
             VALUES($1::uuid, 'outbound', 'x', $2::jsonb, NOW()) RETURNING id`, [id, JSON.stringify(metadata)]);
        const viaOutbox = async (id: string, kind: string) => {
            const [m] = await outbound(id);
            await sql(`INSERT INTO agent_dispatch_outbox(conversation_id, message_id, operational_scope) VALUES($1::uuid, $2::uuid, $3::jsonb)`,
                [id, m.id, JSON.stringify({ kind })]);
        };

        beforeAll(() => { (conversations as any).prisma = prisma; });

        it('nothing sent since the claim: not stale', async () => {
            const { id, inbound } = await claimed();
            expect(await stale(id, inbound)).toBe(false);
        });
        it.each(['agent', 'legacy', 'human_operator'])('a reply of scope «%s» through the durable lane: stale', async kind => {
            const { id, inbound } = await claimed();
            await viaOutbox(id, kind);
            expect(await stale(id, inbound)).toBe(true);
        });
        it('a reminder or campaign (proactive scope) answers nobody: not stale', async () => {
            const { id, inbound } = await claimed();
            await viaOutbox(id, 'proactive_policy');
            expect(await stale(id, inbound)).toBe(false);
        });
        it('an outbound row with no author at all (an automation) answers nobody: not stale', async () => {
            const { id, inbound } = await claimed();
            await outbound(id);
            expect(await stale(id, inbound)).toBe(false);
        });
        it.each([{ source: 'agent' }, { source: 'ai' }, { sender_type: 'agent' }])('a web chat or console reply (%j): stale', async metadata => {
            const { id, inbound } = await claimed();
            await outbound(id, metadata);
            expect(await stale(id, inbound)).toBe(true);
        });
        it('a reply sent BEFORE the claim is not an answer to the replay', async () => {
            const { id, inbound } = await claimed();
            await sql(`INSERT INTO messages(conversation_id, direction, content_text, metadata, created_at)
                VALUES($1::uuid, 'outbound', 'x', '{"source":"agent"}', NOW() - interval '10 minutes')`, [id]);
            expect(await stale(id, inbound)).toBe(false);
        });
        it('a newer customer message whose turn already took the notice: stale; while the notice is pending: not', async () => {
            const { id, inbound } = await claimed();
            await sql(`INSERT INTO messages(conversation_id, direction, content_text, external_id, created_at)
                VALUES($1::uuid, 'inbound', 'otra', 'tgu9999', NOW())`, [id]);
            expect(await stale(id, inbound)).toBe(false);
            await sql(`UPDATE conversations SET metadata = jsonb_set(metadata, '{handoff,returnNoticePending}', 'false'::jsonb) WHERE id=$1::uuid`, [id]);
            expect(await stale(id, inbound)).toBe(true);
        });
        it('works on a schema without the durable outbox table', async () => {
            const { id, inbound } = await claimed();
            await sql('ALTER TABLE agent_dispatch_outbox RENAME TO agent_dispatch_outbox_off');
            try {
                expect(await stale(id, inbound)).toBe(false);
                await outbound(id, { source: 'agent' });
                expect(await stale(id, inbound)).toBe(true);
            } finally { await sql('ALTER TABLE agent_dispatch_outbox_off RENAME TO agent_dispatch_outbox'); }
        });
    });

    // ── The model's history on the replay: the waiting messages are the live turn, not history ──
    it('the history drops only the inbound messages written after the handoff started, and keeps everything else', async () => {
        const id = await returned({ waiting: 0 });
        const ids: Record<string, string> = {};
        const add = async (key: string, direction: string, ago: string) => {
            ids[key] = (await sql(`INSERT INTO messages(conversation_id, direction, content_text, created_at)
                VALUES($1::uuid, $2, $3, NOW() - ($4 || ' seconds')::interval) RETURNING id`, [id, direction, key, ago]))[0].id;
        };
        await add('before-in', 'inbound', '3000');
        await add('before-out', 'outbound', '2900');
        await add('handoff-notice-out', 'outbound', '1200');
        await add('waiting-in-1', 'inbound', '300');
        await add('waiting-in-2', 'inbound', '200');
        await add('waiting-out', 'outbound', '100');
        await add('live', 'inbound', '50');
        const startedAt = (await metadata(id)).handoff.startedAt;
        const rows = (await sql(conversationHistorySql(false), [id, ids.live, startedAt])).map((r: any) => r.content_text).sort();
        expect(rows).toEqual(['before-in', 'before-out', 'handoff-notice-out', 'waiting-out']);
        // an ordinary turn (no replay) keeps the waiting inbound messages
        const ordinary = (await sql(conversationHistorySql(false), [id, ids.live, null])).map((r: any) => r.content_text).sort();
        expect(ordinary).toEqual(['before-in', 'before-out', 'handoff-notice-out', 'waiting-in-1', 'waiting-in-2', 'waiting-out']);
    });
});
