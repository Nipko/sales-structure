import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalNoticeService } from './operational-notice.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * The `handoff.sla_escalated` notice has two lives.
 *
 *  · the SLA escalation (5 minutes unanswered): the conversation is still in the queue
 *    (`waiting_human`/`with_human`) and `handoff.escalated` is set;
 *  · the unattended return (revision `<startedAt>:returned`): the agent has taken the conversation
 *    back (`active`, `returnedToAi`) because nobody answered, and the replay turn tells the team the
 *    customer had asked for a person. The first rule suppressed it every time (an active conversation
 *    is "not waiting"), so the supervisors were never told and the customer was nevertheless told
 *    the request was left for the team.
 *
 * Real PostgreSQL, because the delivery decision is a read of the conversation and of who answered.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('operational notice of an unattended handoff that came back (delivery)', () => {
    const tenantId = randomUUID();
    const schema = `tenant_hnotice_${randomUUID().replace(/-/g, '')}`;
    const operator = randomUUID();
    const STARTED = '2026-10-05T20:00:00Z';
    let client: PrismaClient;
    let prisma: any;
    let notices: any;
    jest.setTimeout(120_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> => prisma.executeInTenantSchema(schema, text, params);

    async function conversation(over: { status?: string; handoff?: Record<string, unknown> } = {}) {
        const contactId = randomUUID();
        const id = randomUUID();
        await sql(`INSERT INTO contacts(id, external_id, name, phone) VALUES($1::uuid, $2, 'Ana', '+57300')`, [contactId, `ext-${id}`]);
        await sql(`INSERT INTO conversations(id, contact_id, status, metadata) VALUES($1::uuid, $2::uuid, $3, $4::jsonb)`,
            [id, contactId, over.status ?? 'active', JSON.stringify({ handoff: { startedAt: STARTED, reason: 'human_request', ...(over.handoff ?? {}) } })]);
        return { id, contactId };
    }
    const noticeFor = (c: { id: string; contactId: string }, revision: string) => ({
        kind: 'handoff.sla_escalated', entity_id: c.id, contact_id: c.contactId, conversation_id: c.id,
        recipient_user_id: operator, event_key: `handoff.sla_escalated:${c.id}:${operator}:${revision}`,
    });
    const hydrate = (notice: any) => (notices as any).hydrate((s: string, p: any[]) => sql(s, p), schema, tenantId, notice);
    const returned = { returnedToAi: true, returnNoticePending: true };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(s => client.$executeRawUnsafe(s));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)', tenantId, schema, 'es');
        await client.$executeRawUnsafe(`INSERT INTO public.users(id,tenant_id,email,is_active,role)
            VALUES($1::uuid,$2::uuid,'supervisor@example.invalid',true,'tenant_supervisor')`, operator, tenantId);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.tenant = { findUnique: jest.fn(async () => ({ language: 'es' })) };
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, external_id VARCHAR(255), name TEXT, phone TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID, status TEXT, assigned_to VARCHAR,
            metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID, direction TEXT,
            metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`);
        await sql(`CREATE TABLE agent_dispatch_outbox(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
            operational_scope JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        notices = new OperationalNoticeService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_hnotice_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.users WHERE id=$1::uuid AND tenant_id=$2::uuid', operator, tenantId);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    it('delivers the notice of the SLA escalation as before: still in the queue, escalated, unanswered', async () => {
        const c = await conversation({ status: 'waiting_human', handoff: { escalated: 'true' } });
        const route = await hydrate(noticeFor(c, STARTED));
        expect(route).toMatchObject({ route: 'email', email: 'supervisor@example.invalid', conversationId: c.id });
    });

    it('still refuses the SLA notice for a conversation that is no longer waiting', async () => {
        const c = await conversation({ status: 'active', handoff: { escalated: 'true' } });
        await expect(hydrate(noticeFor(c, STARTED))).rejects.toMatchObject({ message: 'notice_domain_state_changed' });
    });

    it('delivers the notice of the unattended return: active again, returned for that same handoff', async () => {
        const c = await conversation({ handoff: returned });
        const route = await hydrate(noticeFor(c, `${STARTED}:returned`));
        expect(route).toMatchObject({ route: 'email', email: 'supervisor@example.invalid', conversationId: c.id });
        expect(String(route.subject)).toContain('Ana');
    });

    it('does not deliver it when nobody returned the conversation (the flag is not set)', async () => {
        const c = await conversation({ handoff: { returnNoticePending: true } });
        await expect(hydrate(noticeFor(c, `${STARTED}:returned`))).rejects.toMatchObject({ message: 'notice_domain_state_changed' });
    });

    it('does not deliver it when the conversation is in the queue again (a newer handoff took it)', async () => {
        const c = await conversation({ status: 'waiting_human', handoff: returned });
        await expect(hydrate(noticeFor(c, `${STARTED}:returned`))).rejects.toMatchObject({ message: 'notice_domain_state_changed' });
    });

    it('does not deliver the notice of an older episode once a newer handoff started', async () => {
        const c = await conversation({ handoff: { ...returned, startedAt: '2026-10-06T09:00:00Z' } });
        // the key names the old episode; nothing in the conversation matches it any more, so it is read as a plain SLA notice
        await expect(hydrate(noticeFor(c, `${STARTED}:returned`))).rejects.toMatchObject({ message: 'notice_domain_state_changed' });
    });

    it.each([
        ['a person replied in the web chat or console', async (id: string) => sql(
            `INSERT INTO messages(conversation_id, direction, metadata, created_at) VALUES($1::uuid, 'outbound', '{"source":"agent"}', NOW())`, [id])],
        ['a person replied through the durable outbox', async (id: string) => sql(
            `INSERT INTO agent_dispatch_outbox(conversation_id, operational_scope) VALUES($1::uuid, '{"kind":"human_operator"}')`, [id])],
    ])('does not deliver it when %s since the handoff started', async (_label, answer) => {
        const c = await conversation({ handoff: { ...returned, startedAt: new Date(Date.now() - 20 * 60_000).toISOString() } });
        await answer(c.id);
        const startedAt = (await sql('SELECT metadata->\'handoff\'->>\'startedAt\' AS s FROM conversations WHERE id=$1::uuid', [c.id]))[0].s;
        await expect(hydrate(noticeFor(c, `${startedAt}:returned`))).rejects.toMatchObject({ message: 'notice_domain_state_changed' });
    });

    it('a different contact on the notice still suppresses it', async () => {
        const c = await conversation({ handoff: returned });
        await expect(hydrate({ ...noticeFor(c, `${STARTED}:returned`), contact_id: randomUUID() }))
            .rejects.toMatchObject({ message: 'notice_contact_changed' });
    });
});
