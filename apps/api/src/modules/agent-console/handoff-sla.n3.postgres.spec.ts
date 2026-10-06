import { randomUUID } from 'crypto';
import { AgentAvailabilityService } from './agent-availability.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-46 — the handoff SLA: a conversation handed to a person and unanswered for
 * more than five minutes is escalated to every active supervisor ONCE.
 *
 *   window      4 min waiting: nothing; 6 min: escalated (waiting_human and with_human).
 *   answered    an agent message after the handoff started: no escalation.
 *   once        a second sweep, and two concurrent sweeps (the cron runs on the API and on
 *               the worker), leave one notice per supervisor.
 *   audience    one notice per ACTIVE tenant_admin / tenant_supervisor; inactive ones and
 *               other tenants' users receive none; agents are not supervisors.
 *   status      a resolved or active conversation with stale handoff metadata is not escalated.
 *
 * Oracle: `operational_notice_outbox` rows and `conversations.metadata.handoff.escalated`.
 * Time is seeded in `handoff.startedAt` relative to the test's own clock.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-46: handoff SLA escalation', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let events: jest.Mock;
    const adminId = randomUUID(), supervisorId = randomUUID(), inactiveId = randomUUID(), agentId = randomUUID(), otherTenantUser = randomUUID();
    const otherTenant = randomUUID();

    beforeAll(async () => {
        lane = await openLane('n3sla', [
            ...LANE_CHAT_DDL,
            "ALTER TABLE messages ADD COLUMN metadata JSONB DEFAULT '{}'",
            'ALTER TABLE conversations ADD COLUMN assigned_to TEXT',
            'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT',
            'CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY, erased_at TIMESTAMPTZ DEFAULT NOW())',
        ]);
        await lane.client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', otherTenant, `tenant_n3slaother_${randomUUID().replace(/-/g, '')}`);
        for (const [id, tenant, email, role, active] of [
            [adminId, lane.tenantId, 'admin@example.com', 'tenant_admin', true],
            [supervisorId, lane.tenantId, 'supervisor@example.com', 'tenant_supervisor', true],
            [inactiveId, lane.tenantId, 'inactive@example.com', 'tenant_admin', false],
            [agentId, lane.tenantId, 'agent@example.com', 'tenant_agent', true],
            [otherTenantUser, otherTenant, 'other@example.com', 'tenant_admin', true],
        ] as const) await lane.client.$executeRawUnsafe('INSERT INTO public.users(id,tenant_id,email,role,is_active) VALUES($1::uuid,$2::uuid,$3,$4,$5)', id, tenant, email, role, active);
        (lane.prisma as any).tenant.findMany = async () => [{ id: lane.tenantId, schemaName: lane.schema, language: 'es' }];
        (lane.prisma as any).$queryRawUnsafe = lane.client.$queryRawUnsafe.bind(lane.client);
        events = jest.fn();
        service = new AgentAvailabilityService(lane.prisma, { emit: events } as any, {} as any);
    });
    afterAll(async () => {
        if (!lane) return;
        try {
            await lane.client.$executeRawUnsafe('DELETE FROM public.users WHERE id=ANY($1::uuid[])', [adminId, supervisorId, inactiveId, agentId, otherTenantUser]);
            await lane.client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', otherTenant);
        } finally { await lane.close(); }
    });
    beforeEach(async () => {
        events.mockClear();
        const [present] = await lane.client.$queryRawUnsafe<any[]>('SELECT to_regclass($1)::text AS name', `${lane.schema}.operational_notice_outbox`);
        if (present?.name) await lane.sql('TRUNCATE operational_notice_outbox');
        await lane.sql('TRUNCATE messages, conversations, contacts CASCADE');
    });

    const handoff = async (over: { minutes?: number; status?: string; escalated?: boolean } = {}) => {
        const contactId = randomUUID(), conversationId = randomUUID();
        await lane.sql("INSERT INTO contacts(id,name,phone) VALUES($1::uuid,'Ana','+573001112233')", [contactId]);
        await lane.sql(`INSERT INTO conversations(id,contact_id,status,assigned_to,metadata) VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [
            conversationId, contactId, over.status ?? 'waiting_human', randomUUID(),
            JSON.stringify({ handoff: { startedAt: new Date(Date.now() - (over.minutes ?? 10) * 60_000).toISOString(), reason: 'customer_request', ...(over.escalated ? { escalated: 'true' } : {}) } })]);
        return { contactId, conversationId };
    };
    const notices = async () => {
        const [present] = await lane.client.$queryRawUnsafe<any[]>('SELECT to_regclass($1)::text AS name', `${lane.schema}.operational_notice_outbox`);
        return present?.name ? lane.sql("SELECT recipient_user_id, entity_id, kind, state FROM operational_notice_outbox WHERE kind='handoff.sla_escalated'") : [];
    };
    const escalated = async (id: string) => (await lane.sql("SELECT metadata->'handoff'->>'escalated' AS e FROM conversations WHERE id=$1::uuid", [id]))[0].e;

    it('AUT-46: 4 minutes of waiting is within the SLA; 6 minutes is not (both waiting_human and with_human)', async () => {
        const within = await handoff({ minutes: 4 });
        const late = await handoff({ minutes: 6 });
        const lateWithHuman = await handoff({ minutes: 6, status: 'with_human' });
        await service.escalateStaleHandoffs();
        expect(await escalated(within.conversationId)).toBeNull();
        expect(await escalated(late.conversationId)).toBe('true');
        expect(await escalated(lateWithHuman.conversationId)).toBe('true');
        expect((await notices()).some((n: any) => n.entity_id === late.conversationId)).toBe(true);
    });

    it('AUT-46: the notice goes to every ACTIVE admin/supervisor of the tenant, and to nobody else', async () => {
        const h = await handoff();
        await service.escalateStaleHandoffs();
        const recipients = (await notices()).filter((n: any) => n.entity_id === h.conversationId).map((n: any) => n.recipient_user_id);
        expect(new Set(recipients)).toEqual(new Set([adminId, supervisorId]));
        expect(recipients).toHaveLength(2);
    });

    it('AUT-46: an agent message after the handoff started means no escalation', async () => {
        const h = await handoff();
        await lane.sql("INSERT INTO messages(conversation_id,direction,metadata) VALUES($1::uuid,'outbound','{\"source\":\"agent\"}'::jsonb)", [h.conversationId]);
        await service.escalateStaleHandoffs();
        expect(await escalated(h.conversationId)).toBeNull();
        expect(await notices()).toHaveLength(0);
    });

    it('AUT-46: a bot reply (not an agent) does not count as an answer', async () => {
        const h = await handoff();
        await lane.sql("INSERT INTO messages(conversation_id,direction,metadata) VALUES($1::uuid,'outbound','{\"source\":\"ai\"}'::jsonb)", [h.conversationId]);
        await service.escalateStaleHandoffs();
        expect(await escalated(h.conversationId)).toBe('true');
    });

    it('AUT-46: two sweeps and then two concurrent sweeps (API + worker) leave one notice per supervisor and one alert event', async () => {
        const h = await handoff();
        await service.escalateStaleHandoffs();
        await service.escalateStaleHandoffs();
        expect((await notices()).filter((n: any) => n.entity_id === h.conversationId)).toHaveLength(2);
        expect(events).toHaveBeenCalledTimes(1);
        events.mockClear();
        await lane.sql('TRUNCATE operational_notice_outbox');
        await lane.sql("UPDATE conversations SET metadata = jsonb_set(metadata,'{handoff,escalated}','false'::jsonb)");
        await Promise.all([service.escalateStaleHandoffs(), service.escalateStaleHandoffs()]);
        expect(await notices()).toHaveLength(2);
        expect(events).toHaveBeenCalledTimes(1);
    });

    it('AUT-46: an already-escalated, a resolved and an active conversation are not escalated (again)', async () => {
        const already = await handoff({ escalated: true });
        const resolved = await handoff({ status: 'resolved' });
        const active = await handoff({ status: 'active' });
        await service.escalateStaleHandoffs();
        expect(await notices()).toHaveLength(0);
        expect(await escalated(resolved.conversationId)).toBeNull();
        expect(await escalated(active.conversationId)).toBeNull();
        expect(await escalated(already.conversationId)).toBe('true');
    });
});
