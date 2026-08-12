import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentConsoleService } from './agent-console.service';

describe('AgentConsoleService conversation ownership', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const actorId = '33333333-3333-4333-8333-333333333333';
    const otherAgentId = '44444444-4444-4444-8444-444444444444';
    const schemaName = 'tenant_acme';

    function makeHarness(rows: any[]) {
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue(rows),
        };
        const redis = { get: jest.fn().mockResolvedValue(schemaName) };
        const service = new AgentConsoleService(
            prisma as any,
            redis as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { emit: jest.fn() } as any,
            {} as any,
        );
        return { service, prisma };
    }

    it('requires an agent to own the conversation and does not treat unassigned as owned', async () => {
        const mine = makeHarness([{ assigned_to: actorId }]);
        const free = makeHarness([{ assigned_to: null }]);
        const another = makeHarness([{ assigned_to: otherAgentId }]);

        await expect(mine.service.assertCanActOnConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).resolves.toBeUndefined();
        await expect(free.service.assertCanActOnConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);
        await expect(another.service.assertCanActOnConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an agent view own or unassigned conversations but never a peer-owned one', async () => {
        const mine = makeHarness([{ assigned_to: actorId }]);
        const free = makeHarness([{ assigned_to: null }]);
        const another = makeHarness([{ assigned_to: otherAgentId }]);

        await expect(mine.service.canViewConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).resolves.toBe(true);
        await expect(free.service.canViewConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).resolves.toBe(true);
        await expect(another.service.canViewConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).resolves.toBe(false);
        await expect(another.service.assertCanViewConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['tenant_admin', 'tenant_supervisor'])(
        'allows %s over any existing conversation in the tenant schema',
        async (role) => {
            const h = makeHarness([{ assigned_to: otherAgentId }]);
            await expect(h.service.assertCanActOnConversation(
                tenantId, conversationId, actorId, role,
            )).resolves.toBeUndefined();
        },
    );

    it.each(['tenant_viewer', 'super_admin'])(
        'rejects non-tenant Inbox role %s',
        async (role) => {
            const h = makeHarness([{ assigned_to: actorId }]);
            await expect(h.service.assertCanActOnConversation(
                tenantId, conversationId, actorId, role,
            )).rejects.toBeInstanceOf(ForbiddenException);
        },
    );

    it('fails closed when the conversation is not tenant-visible', async () => {
        const h = makeHarness([]);
        await expect(h.service.assertCanActOnConversation(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(NotFoundException);
        await expect(h.service.conversationExists(tenantId, conversationId)).resolves.toBe(false);
    });

    it('rejects a mixed-ownership bulk mutation as one unit', async () => {
        const ids = [conversationId, '55555555-5555-4555-8555-555555555555'];
        const h = makeHarness([
            { id: ids[0], assigned_to: actorId },
            { id: ids[1], assigned_to: otherAgentId },
        ]);

        await expect(h.service.assertCanActOnConversations(
            tenantId, ids, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires every requested bulk id to exist in the tenant schema', async () => {
        const ids = [conversationId, '55555555-5555-4555-8555-555555555555'];
        const h = makeHarness([{ id: ids[0], assigned_to: actorId }]);

        await expect(h.service.assertCanActOnConversations(
            tenantId, ids, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a message only when it belongs to the authorized conversation', async () => {
        const h = makeHarness([]);
        const messageId = '55555555-5555-4555-8555-555555555555';

        await h.service.deleteMessage(tenantId, conversationId, messageId);

        expect(h.prisma.executeInTenantSchema).toHaveBeenCalledWith(
            schemaName,
            expect.stringContaining('AND conversation_id = $2::uuid'),
            [messageId, conversationId],
        );
    });
});
