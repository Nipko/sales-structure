import { randomUUID } from 'crypto';
import { AgentAvailabilityService } from './agent-availability.service';
import { ensureOperationalNoticeOutbox, enqueueOperationalNoticesForTenantRoles } from '../operational-notices/operational-notice-outbox';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · REGRESSION (was a confirmed defect, fixed) AUT-46 — only the FIRST escalated handoff of a tenant ever
 * notifies a supervisor.
 *
 * `enqueueOperationalNoticesForTenantRoles` (operational-notices/operational-notice-outbox.ts)
 * builds the idempotency key as `$1 || ':' || u.id || ':' || $7` with `$1 = input.kind`, i.e.
 * `handoff.sla_escalated:<userId>:1` — the entity (conversation) id is NOT part of it
 * (`$3`, the entity, is inserted in `entity_id` but never in `event_key`).
 * `ON CONFLICT (event_key) DO NOTHING` therefore swallows the notice of every later handoff:
 * the conversation is flagged `escalated = true` (so it is never retried) and no supervisor
 * is told. The single-conversation existing spec cannot see it.
 *
 * Oracle: `operational_notice_outbox` rows per escalated conversation.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-46: every escalated handoff notifies the supervisors', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    const adminId = randomUUID(), supervisorId = randomUUID();

    beforeAll(async () => {
        lane = await openLane('n3slad', [
            ...LANE_CHAT_DDL,
            "ALTER TABLE messages ADD COLUMN metadata JSONB DEFAULT '{}'",
            'ALTER TABLE conversations ADD COLUMN assigned_to TEXT',
            'CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY, erased_at TIMESTAMPTZ DEFAULT NOW())',
        ]);
        for (const [id, email, role] of [[adminId, 'admin@example.com', 'tenant_admin'], [supervisorId, 'supervisor@example.com', 'tenant_supervisor']] as const)
            await lane.client.$executeRawUnsafe('INSERT INTO public.users(id,tenant_id,email,role,is_active) VALUES($1::uuid,$2::uuid,$3,$4,true)', id, lane.tenantId, email, role);
        (lane.prisma as any).tenant.findMany = async () => [{ id: lane.tenantId, schemaName: lane.schema, language: 'es' }];
        service = new AgentAvailabilityService(lane.prisma, { emit: () => undefined } as any, {} as any);
    });
    afterAll(async () => {
        if (!lane) return;
        try { await lane.client.$executeRawUnsafe('DELETE FROM public.users WHERE id=ANY($1::uuid[])', [adminId, supervisorId]); } finally { await lane.close(); }
    });

    const handoff = async () => {
        const contactId = randomUUID(), conversationId = randomUUID();
        await lane.sql("INSERT INTO contacts(id,name,phone) VALUES($1::uuid,'Ana','+573001112233')", [contactId]);
        await lane.sql("INSERT INTO conversations(id,contact_id,status,assigned_to,metadata) VALUES($1::uuid,$2::uuid,'waiting_human',$3,$4::jsonb)",
            [conversationId, contactId, randomUUID(), JSON.stringify({ handoff: { startedAt: new Date(Date.now() - 10 * 60_000).toISOString(), reason: 'customer_request' } })]);
        return conversationId;
    };

    it('AUT-46: a second unanswered handoff, escalated later, notifies both supervisors too', async () => {
        const first = await handoff();
        await service.escalateStaleHandoffs();
        const second = await handoff();
        await service.escalateStaleHandoffs();
        const rows = await lane.sql("SELECT entity_id, recipient_user_id FROM operational_notice_outbox WHERE kind='handoff.sla_escalated'");
        const flagged = await lane.sql("SELECT id FROM conversations WHERE metadata->'handoff'->>'escalated' = 'true'");
        const count = (id: string) => rows.filter((r: any) => r.entity_id === id).length;
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-46] escalated conversations=${flagged.length} notices first=${count(first)} second=${count(second)}`);
        expect(flagged).toHaveLength(2);
        expect(count(first)).toBe(2);
        expect(count(second)).toBe(2);
    });

    it('AUT-46: the SAME conversation handed off again later (new startedAt) notifies the supervisors again, once per handoff', async () => {
        const conversationId = await handoff();
        await service.escalateStaleHandoffs();
        await service.escalateStaleHandoffs(); // a repeated sweep must not duplicate
        const notices = async () => (await lane.sql("SELECT recipient_user_id FROM operational_notice_outbox WHERE kind='handoff.sla_escalated' AND entity_id=$1::uuid", [conversationId])).length;
        expect(await notices()).toBe(2);
        // The customer is handed to a human a second time, much later: a fresh handoff object.
        await lane.sql("UPDATE conversations SET metadata=$2::jsonb WHERE id=$1::uuid",
            [conversationId, JSON.stringify({ handoff: { startedAt: new Date(Date.now() - 6 * 60_000).toISOString(), reason: 'customer_request' } })]);
        await service.escalateStaleHandoffs();
        expect(await notices()).toBe(4);
    });

    it('home_service.emergency: two different requests notify the operators separately; the same request is notified once', async () => {
        await ensureOperationalNoticeOutbox(lane.prisma, lane.schema);
        const [a, b] = [randomUUID(), randomUUID()];
        const enqueue = (entityId: string) => lane.prisma.transactionInTenantSchema(lane.schema, (query: any) =>
            enqueueOperationalNoticesForTenantRoles(query, lane.schema, { kind: 'home_service.emergency', entityId, roles: ['tenant_admin', 'tenant_supervisor'] }));
        expect(await enqueue(a)).toHaveLength(2);
        expect(await enqueue(b)).toHaveLength(2);
        expect(await enqueue(a)).toHaveLength(0);
    });
});
