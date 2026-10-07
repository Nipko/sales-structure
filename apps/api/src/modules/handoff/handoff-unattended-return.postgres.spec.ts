import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffService } from './handoff.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * The unattended-handoff sweep against a real PostgreSQL: who counts as "a person
 * answered", on which channel, and that a second run changes nothing.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('unattended handoff return on PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_unattended_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let service: HandoffService;
    let events: { emit: jest.Mock };
    let redis: { del: jest.Mock };

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        (service as any).prisma.executeInTenantSchema(schema, text, params);

    async function conversation(over: { status?: string; assignedTo?: string | null; startedMinutesAgo?: number; inbound?: boolean } = {}) {
        const id = randomUUID();
        const minutes = over.startedMinutesAgo ?? 30;
        await sql(`INSERT INTO conversations(id, status, assigned_to, metadata)
            VALUES($1::uuid, $2, $3, jsonb_build_object('handoff', jsonb_build_object('startedAt',
                to_char((NOW() - ($4 || ' minutes')::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))`,
            [id, over.status ?? 'waiting_human', over.assignedTo ?? null, String(minutes)]);
        if (over.inbound !== false) {
            await sql(`INSERT INTO messages(conversation_id, direction, metadata, created_at)
                VALUES($1::uuid, 'inbound', '{}', NOW() - interval '2 minutes')`, [id]);
        }
        return id;
    }
    const outboxRow = (conversationId: string, kind: string) => sql(
        `INSERT INTO agent_dispatch_outbox(conversation_id, operational_scope, created_at)
         VALUES($1::uuid, jsonb_build_object('kind', $2::text), NOW() - interval '5 minutes')`, [conversationId, kind]);
    const status = async (id: string) => (await sql('SELECT status, assigned_to, metadata FROM conversations WHERE id = $1::uuid', [id]))[0];
    const sweep = async () => { events.emit.mockClear(); await service.returnUnattendedHandoffs(); };
    const returnedIds = () => events.emit.mock.calls.map(c => c[1].conversationId);

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
        const prisma: any = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.getTenantSchemaName = jest.fn(async () => schema);
        prisma.tenant = { findMany: jest.fn(async () => [{ id: tenantId, schemaName: schema }]) };
        events = { emit: jest.fn().mockReturnValue(true) };
        redis = { del: jest.fn().mockResolvedValue(undefined) };
        service = new HandoffService(prisma, redis as any, events as any, {} as any, {} as any, {} as any, {} as any,
            { runExclusive: jest.fn() } as any);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, status TEXT, assigned_to VARCHAR,
            metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
            direction TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE agent_dispatch_outbox(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
            operational_scope JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await sql(`CREATE TABLE conversation_assignments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID, agent_id UUID, assigned_at TIMESTAMP DEFAULT NOW(), resolved_at TIMESTAMP)`);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_unattended_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await sql('TRUNCATE conversations, messages, agent_dispatch_outbox, conversation_assignments');
        redis.del.mockClear();
    });

    it('returns an unattended waiting_human conversation to the agent, flagging the notice, exactly once', async () => {
        const id = await conversation();
        await sweep();
        expect(returnedIds()).toEqual([id]);
        const row = await status(id);
        expect(row.status).toBe('active');
        expect(row.metadata.handoff.returnedToAi).toBe(true);
        expect(row.metadata.handoff.returnNoticePending).toBe(true);
        const returned = (await status(id)).metadata;
        await sweep();
        // Not returned a second time: the row is unchanged. The only thing the next
        // sweep may do is ask again for the waiting message's replay (nobody claims
        // it in this harness), which the listener's claim makes harmless.
        expect((await status(id)).metadata).toEqual(returned);
        expect(returnedIds()).toEqual([id]);
    });

    it('leaves a handoff younger than 10 minutes, and one with no customer message since', async () => {
        const young = await conversation({ startedMinutesAgo: 5 });
        const silent = await conversation({ inbound: false });
        await sweep();
        expect(returnedIds()).toEqual([]);
        expect((await status(young)).status).toBe('waiting_human');
        expect((await status(silent)).status).toBe('waiting_human');
    });

    it('a person who answered through the durable outbox (WhatsApp, Instagram, Messenger, Telegram) keeps the conversation', async () => {
        const id = await conversation({ status: 'with_human', assignedTo: randomUUID() });
        await outboxRow(id, 'human_operator');
        await sweep();
        expect(returnedIds()).toEqual([]);
        expect((await status(id)).status).toBe('with_human');
    });

    it('a person who answered in the web widget keeps the conversation', async () => {
        const id = await conversation({ status: 'with_human', assignedTo: randomUUID() });
        await sql(`INSERT INTO messages(conversation_id, direction, metadata, created_at)
            VALUES($1::uuid, 'outbound', '{"source":"agent"}', NOW() - interval '5 minutes')`, [id]);
        await sweep();
        expect(returnedIds()).toEqual([]);
    });

    it('a canned reply from the send_canned macro (sender_type=agent, no outbox) keeps the conversation', async () => {
        const id = await conversation({ status: 'with_human', assignedTo: randomUUID() });
        await sql(`INSERT INTO messages(conversation_id, direction, metadata, created_at)
            VALUES($1::uuid, 'outbound', '{"sender_type":"agent","sender_id":"x"}', NOW() - interval '5 minutes')`, [id]);
        await sweep();
        expect(returnedIds()).toEqual([]);
    });

    it('an outbox row that is not a human operator does not count as an answer', async () => {
        const id = await conversation({ status: 'with_human', assignedTo: randomUUID() });
        await outboxRow(id, 'served_agent');
        await sweep();
        expect(returnedIds()).toEqual([id]);
    });

    it('a human reply BEFORE the handoff started is not an answer to it', async () => {
        const id = await conversation({ status: 'with_human', assignedTo: randomUUID() });
        await sql(`INSERT INTO agent_dispatch_outbox(conversation_id, operational_scope, created_at)
            VALUES($1::uuid, '{"kind":"human_operator"}', NOW() - interval '2 hours')`, [id]);
        await sweep();
        expect(returnedIds()).toEqual([id]);
    });

    it('an assigned conversation nobody wrote in is returned and its assignment closed', async () => {
        const agent = randomUUID();
        const id = await conversation({ status: 'with_human', assignedTo: agent });
        await sql('INSERT INTO conversation_assignments(conversation_id, agent_id) VALUES($1::uuid, $2::uuid)', [id, agent]);
        await sweep();
        expect(returnedIds()).toEqual([id]);
        const row = await status(id);
        expect(row.status).toBe('active');
        expect(row.assigned_to).toBeNull();
        expect((await sql('SELECT resolved_at FROM conversation_assignments WHERE conversation_id = $1::uuid', [id]))[0].resolved_at).not.toBeNull();
    });

    it('works on a tenant schema that has no outbox table yet', async () => {
        await sql('ALTER TABLE agent_dispatch_outbox RENAME TO agent_dispatch_outbox_off');
        try {
            const id = await conversation();
            await sweep();
            expect(returnedIds()).toEqual([id]);
        } finally {
            await sql('ALTER TABLE agent_dispatch_outbox_off RENAME TO agent_dispatch_outbox');
        }
    });
    // ── The catch-up for the waiting message (event lost, or its claim given back) ──
    async function returnedRow(handoff: Record<string, unknown>, over: { updatedHoursAgo?: number; status?: string } = {}) {
        const id = randomUUID();
        await sql(`INSERT INTO conversations(id, status, metadata, updated_at)
            VALUES($1::uuid, $2, jsonb_build_object('handoff', jsonb_build_object(
                'startedAt', to_char((NOW() - interval '20 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'returnedToAi', true, 'returnNoticePending', true) || $3::jsonb),
                NOW() - ($4 || ' hours')::interval)`,
            [id, over.status ?? 'active', JSON.stringify(handoff), String(over.updatedHoursAgo ?? 0)]);
        return id;
    }

    it('asks again for a returned conversation whose replay was never claimed', async () => {
        const id = await returnedRow({});
        await sweep();
        expect(returnedIds()).toEqual([id]);
    });

    it('does not ask for one whose replay is claimed for this episode, over the claim cap, older than a day, not active or answered by a person', async () => {
        const claimedFor = (await sql(`SELECT to_char((NOW() - interval '20 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t`))[0].t;
        // a claim for THIS episode is stored as the episode's own startedAt
        const claimed = randomUUID();
        await sql(`INSERT INTO conversations(id, status, metadata) VALUES($1::uuid, 'active',
            '{"handoff":{"startedAt":"2026-10-05T20:00:00Z","returnedToAi":true,"returnNoticePending":true,"returnReplayFor":"2026-10-05T20:00:00Z"}}')`, [claimed]);
        await returnedRow({ returnReplayClaims: 5 });
        await returnedRow({}, { updatedHoursAgo: 30 });
        await returnedRow({}, { status: 'waiting_human' });
        const answered = await returnedRow({});
        await outboxRow(answered, 'human_operator');
        expect(claimedFor).toBeTruthy();
        await sweep();
        expect(returnedIds()).toEqual([]);
    });

    it('a conversation the sweep returns now is announced once, not once by the sweep and again by the catch-up', async () => {
        const id = await conversation();
        await sweep();
        expect(returnedIds()).toEqual([id]);
    });
});
