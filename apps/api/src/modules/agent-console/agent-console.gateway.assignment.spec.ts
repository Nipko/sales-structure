import { AgentConsoleGateway } from './agent-console.gateway';

describe('AgentConsoleGateway assignment authorization', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const otherAgentId = '44444444-4444-4444-8444-444444444444';

    function makeHarness(role: string) {
        const agentConsoleService = {
            assignConversation: jest.fn().mockResolvedValue(undefined),
            claimConversation: jest.fn().mockResolvedValue(undefined),
        };
        const gateway = new AgentConsoleGateway(
            agentConsoleService as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        const room = { emit: jest.fn() };
        gateway.server = { to: jest.fn().mockReturnValue(room) };
        const client = { id: 'socket-1', emit: jest.fn() };
        (gateway as any).socketMeta.set(client.id, {
            tenantId,
            agentId,
            role,
            agentName: 'Agent',
        });
        return { gateway, agentConsoleService, client };
    }

    it('lets an agent claim only for their authenticated socket identity', async () => {
        const h = makeHarness('tenant_agent');

        await h.gateway.handleAssign(h.client, { conversationId, agentId });

        expect(h.agentConsoleService.claimConversation).toHaveBeenCalledWith(
            tenantId,
            conversationId,
            agentId,
        );
        expect(h.agentConsoleService.assignConversation).not.toHaveBeenCalled();
        expect(h.gateway.server.to).toHaveBeenCalledWith(`agent:${tenantId}:${agentId}`);
    });

    it('rejects an agent-supplied target that differs from the socket identity', async () => {
        const h = makeHarness('tenant_agent');

        await h.gateway.handleAssign(h.client, { conversationId, agentId: otherAgentId });

        expect(h.client.emit).toHaveBeenCalledWith('error', expect.any(Object));
        expect(h.agentConsoleService.claimConversation).not.toHaveBeenCalled();
        expect(h.agentConsoleService.assignConversation).not.toHaveBeenCalled();
    });

    it.each(['tenant_admin', 'tenant_supervisor'])(
        'allows %s to reassign an already managed conversation',
        async (role) => {
            const h = makeHarness(role);

            await h.gateway.handleAssign(h.client, { conversationId, agentId: otherAgentId });

            expect(h.agentConsoleService.assignConversation).toHaveBeenCalledWith(
                tenantId,
                conversationId,
                otherAgentId,
            );
            expect(h.agentConsoleService.claimConversation).not.toHaveBeenCalled();
            expect(h.gateway.server.to).toHaveBeenCalledWith(`agent:${tenantId}:${otherAgentId}`);
        },
    );
});
