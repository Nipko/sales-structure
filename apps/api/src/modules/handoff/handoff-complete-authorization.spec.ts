import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HandoffController } from './handoff.controller';
import { HandoffService } from './handoff.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const ASSIGNED_AGENT = '33333333-3333-4333-8333-333333333333';
const OTHER_AGENT = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';

function buildService(rows: Array<{ assigned_to: string | null }>) {
    const prisma = {
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_acme'),
        executeInTenantSchema: jest.fn().mockResolvedValue(rows),
    };
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    const events = { emit: jest.fn() };
    const service = new HandoffService(
        prisma as any, redis as any, events as any,
        {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma, redis, events };
}

describe('POST /handoff/:id/complete is limited to the assigned agent or tenant admins', () => {
    it('allows the agent the conversation is assigned to', async () => {
        const { service } = buildService([{ assigned_to: ASSIGNED_AGENT }]);
        await expect(service.assertCanCompleteHandoff(
            TENANT_ID, CONVERSATION_ID, ASSIGNED_AGENT, 'tenant_agent',
        )).resolves.toBeUndefined();
    });

    it('allows a tenant admin and a supervisor on a conversation held by someone else or by nobody', async () => {
        for (const role of ['tenant_admin', 'tenant_supervisor']) {
            for (const assigned_to of [ASSIGNED_AGENT, null]) {
                const { service } = buildService([{ assigned_to }]);
                await expect(service.assertCanCompleteHandoff(
                    TENANT_ID, CONVERSATION_ID, ADMIN, role,
                )).resolves.toBeUndefined();
            }
        }
    });

    it('keeps super_admin allowed, as before', async () => {
        const { service } = buildService([{ assigned_to: ASSIGNED_AGENT }]);
        await expect(service.assertCanCompleteHandoff(
            TENANT_ID, CONVERSATION_ID, ADMIN, 'super_admin',
        )).resolves.toBeUndefined();
    });

    it('denies another agent completing a colleague\'s handoff', async () => {
        const { service } = buildService([{ assigned_to: ASSIGNED_AGENT }]);
        await expect(service.assertCanCompleteHandoff(
            TENANT_ID, CONVERSATION_ID, OTHER_AGENT, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies a plain agent on an unassigned conversation (it is not theirs to return)', async () => {
        const { service } = buildService([{ assigned_to: null }]);
        await expect(service.assertCanCompleteHandoff(
            TENANT_ID, CONVERSATION_ID, OTHER_AGENT, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies roles outside the inbox and reports a missing conversation', async () => {
        const { service } = buildService([{ assigned_to: ASSIGNED_AGENT }]);
        await expect(service.assertCanCompleteHandoff(
            TENANT_ID, CONVERSATION_ID, ASSIGNED_AGENT, 'viewer',
        )).rejects.toBeInstanceOf(ForbiddenException);

        const missing = buildService([]);
        await expect(missing.service.assertCanCompleteHandoff(
            TENANT_ID, CONVERSATION_ID, ADMIN, 'tenant_admin',
        )).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the route runs the check before it mutates anything', async () => {
        const { service, prisma, redis, events } = buildService([{ assigned_to: ASSIGNED_AGENT }]);
        const controller = new HandoffController(service);

        await expect(controller.completeHandoff(
            TENANT_ID, CONVERSATION_ID, { user: { id: OTHER_AGENT, role: 'tenant_agent' } },
        )).rejects.toBeInstanceOf(ForbiddenException);
        // Only the ownership lookup ran: no UPDATE, no cache purge, no event.
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(redis.del).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();

        await expect(controller.completeHandoff(
            TENANT_ID, CONVERSATION_ID, { user: { id: ASSIGNED_AGENT, role: 'tenant_agent' } },
        )).resolves.toMatchObject({ success: true });
        expect(events.emit).toHaveBeenCalledWith('handoff.completed', { tenantId: TENANT_ID, conversationId: CONVERSATION_ID });
    });
});
