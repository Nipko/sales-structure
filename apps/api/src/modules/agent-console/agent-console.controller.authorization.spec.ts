import 'reflect-metadata';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AgentConsoleController } from './agent-console.controller';

describe('AgentConsoleController mutation authorization', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const actorId = '33333333-3333-4333-8333-333333333333';
    const spoofedId = '44444444-4444-4444-8444-444444444444';
    const req = { user: { id: actorId, role: 'tenant_agent', tenantId } };

    function makeHarness() {
        const service = {
            assertCanActOnConversation: jest.fn().mockResolvedValue(undefined),
            assertCanActOnConversations: jest.fn().mockResolvedValue(undefined),
            assertCanViewConversation: jest.fn().mockResolvedValue(undefined),
            assignConversation: jest.fn().mockResolvedValue(undefined),
            claimConversation: jest.fn().mockResolvedValue(undefined),
            getConversation: jest.fn().mockResolvedValue({ id: conversationId }),
            getAISuggestion: jest.fn().mockResolvedValue('suggestion'),
            nextBestAction: jest.fn().mockResolvedValue('next'),
            sendAgentMessage: jest.fn().mockResolvedValue({ id: 'message-1' }),
            resolveConversation: jest.fn().mockResolvedValue(undefined),
            returnToAI: jest.fn().mockResolvedValue(undefined),
            addNote: jest.fn().mockResolvedValue({ id: 'note-1' }),
            reopenConversation: jest.fn().mockResolvedValue(undefined),
            archiveConversation: jest.fn().mockResolvedValue(undefined),
            deleteConversation: jest.fn().mockResolvedValue(undefined),
            deleteMessage: jest.fn().mockResolvedValue(undefined),
            bulkArchive: jest.fn().mockResolvedValue(undefined),
            bulkDelete: jest.fn().mockResolvedValue(undefined),
        };
        const availability = { updateStatus: jest.fn().mockResolvedValue(undefined) };
        const archives = { getArchivedMessages: jest.fn().mockResolvedValue([]) };
        const macros = { executeMacro: jest.fn().mockResolvedValue({}) };
        const snooze = {
            snooze: jest.fn().mockResolvedValue(undefined),
            unsnooze: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new AgentConsoleController(
            service as any,
            {} as any,
            availability as any,
            macros as any,
            snooze as any,
            archives as any,
        );
        return { controller, service, availability, archives, macros, snooze };
    }

    it('excludes viewer from the entire HTTP Inbox controller', () => {
        const roles = Reflect.getMetadata(ROLES_KEY, AgentConsoleController);
        expect(roles).toEqual(['tenant_admin', 'tenant_supervisor', 'tenant_agent']);
        expect(roles).not.toContain('tenant_viewer');
    });

    it('derives message and note authors from req.user and ignores spoofed body agentId', async () => {
        const h = makeHarness();

        await h.controller.sendMessage(
            tenantId,
            conversationId,
            req,
            { content: 'Hola', agentId: spoofedId } as any,
        );
        await h.controller.addNote(
            tenantId,
            conversationId,
            req,
            { content: 'Nota', agentId: spoofedId } as any,
        );

        expect(h.service.assertCanActOnConversation).toHaveBeenCalledTimes(2);
        expect(h.service.sendAgentMessage).toHaveBeenCalledWith(
            tenantId, conversationId, actorId, 'Hola', undefined, undefined, undefined, undefined,
        );
        expect(h.service.addNote).toHaveBeenCalledWith(tenantId, conversationId, actorId, 'Nota');
    });

    it('stops the mutation when ownership validation rejects the actor', async () => {
        const h = makeHarness();
        h.service.assertCanActOnConversation.mockRejectedValue(
            new ForbiddenException('not assigned'),
        );

        await expect(h.controller.resolveConversation(tenantId, conversationId, req))
            .rejects.toBeInstanceOf(ForbiddenException);

        expect(h.service.resolveConversation).not.toHaveBeenCalled();
    });

    it('maps the legacy assign route to an atomic self-claim for tenant agents', async () => {
        const h = makeHarness();

        await h.controller.assignConversation(
            tenantId,
            conversationId,
            req,
            { agentId: actorId },
        );

        expect(h.service.claimConversation).toHaveBeenCalledWith(
            tenantId, conversationId, actorId,
        );
        expect(h.service.assignConversation).not.toHaveBeenCalled();
    });

    it('rejects another target on the legacy assign route for tenant agents', async () => {
        const h = makeHarness();

        await expect(h.controller.assignConversation(
            tenantId,
            conversationId,
            req,
            { agentId: spoofedId },
        )).rejects.toBeInstanceOf(ForbiddenException);

        expect(h.service.claimConversation).not.toHaveBeenCalled();
        expect(h.service.assignConversation).not.toHaveBeenCalled();
    });

    it('does not let the legacy agent path reassign an already claimed conversation', async () => {
        const h = makeHarness();
        h.service.claimConversation.mockRejectedValue(
            new ConflictException('Conversation is already assigned or does not exist'),
        );

        await expect(h.controller.assignConversation(
            tenantId,
            conversationId,
            req,
            { agentId: actorId },
        )).rejects.toBeInstanceOf(ConflictException);

        expect(h.service.claimConversation).toHaveBeenCalledWith(
            tenantId, conversationId, actorId,
        );
        expect(h.service.assignConversation).not.toHaveBeenCalled();
    });

    it.each(['tenant_admin', 'tenant_supervisor'])(
        'preserves elevated reassignment for %s',
        async (role) => {
            const h = makeHarness();
            const elevatedReq = { user: { id: actorId, role, tenantId } };

            await h.controller.assignConversation(
                tenantId,
                conversationId,
                elevatedReq,
                { agentId: spoofedId },
            );

            expect(h.service.assignConversation).toHaveBeenCalledWith(
                tenantId, conversationId, spoofedId,
            );
            expect(h.service.claimConversation).not.toHaveBeenCalled();
        },
    );

    it('authorizes return, snooze, archive, delete and macro before mutating', async () => {
        const h = makeHarness();

        await h.controller.returnToAI(tenantId, conversationId, req);
        await h.controller.snoozeConversation(
            tenantId, conversationId, req, { snoozeUntil: '2026-08-12T12:00:00.000Z' },
        );
        await h.controller.unsnoozeConversation(tenantId, conversationId, req);
        await h.controller.archiveConversation(tenantId, conversationId, req);
        await h.controller.deleteConversation(tenantId, conversationId, req);
        await h.controller.executeMacro(tenantId, 'macro-1', req, {
            conversationId,
            agentId: spoofedId,
        } as any);

        expect(h.service.assertCanActOnConversation).toHaveBeenCalledTimes(6);
        for (const call of h.service.assertCanActOnConversation.mock.calls) {
            expect(call).toEqual([tenantId, conversationId, actorId, 'tenant_agent']);
        }
        expect(h.macros.executeMacro).toHaveBeenCalledWith(
            tenantId, 'macro-1', conversationId, actorId, 'tenant_agent',
        );
        expect(h.service.archiveConversation).toHaveBeenCalledWith(
            tenantId, conversationId, actorId,
        );
    });

    it('binds message deletion to the authorized conversation', async () => {
        const h = makeHarness();
        const messageId = '55555555-5555-4555-8555-555555555555';

        await h.controller.deleteMessage(tenantId, conversationId, messageId, req);

        expect(h.service.assertCanActOnConversation).toHaveBeenCalledWith(
            tenantId, conversationId, actorId, 'tenant_agent',
        );
        expect(h.service.deleteMessage).toHaveBeenCalledWith(
            tenantId, conversationId, messageId,
        );
    });

    it('validates every bulk target before archive or delete', async () => {
        const h = makeHarness();
        const ids = [conversationId, '66666666-6666-4666-8666-666666666666'];

        await h.controller.bulkArchive(tenantId, req, { conversationIds: ids });
        await h.controller.bulkDelete(tenantId, req, { conversationIds: ids });

        expect(h.service.assertCanActOnConversations).toHaveBeenCalledTimes(2);
        expect(h.service.assertCanActOnConversations).toHaveBeenCalledWith(
            tenantId, ids, actorId, 'tenant_agent',
        );
    });

    it('authorizes every conversation detail/AI read before loading sensitive data', async () => {
        const h = makeHarness();

        await h.controller.getConversation(tenantId, conversationId, req);
        await h.controller.getArchivedMessages(tenantId, conversationId, req);
        await h.controller.getAISuggestion(tenantId, conversationId, req);
        await h.controller.nextBestAction(tenantId, conversationId, req);

        expect(h.service.assertCanViewConversation).toHaveBeenCalledTimes(4);
        for (const call of h.service.assertCanViewConversation.mock.calls) {
            expect(call).toEqual([tenantId, conversationId, actorId, 'tenant_agent']);
        }
    });

    it('does not load conversation data when the agent cannot view it', async () => {
        const h = makeHarness();
        h.service.assertCanViewConversation.mockRejectedValue(new ForbiddenException('peer owned'));

        await expect(h.controller.getConversation(tenantId, conversationId, req))
            .rejects.toBeInstanceOf(ForbiddenException);

        expect(h.service.getConversation).not.toHaveBeenCalled();
    });

    it('ignores a spoofed status path user and updates only the authenticated tenant member', async () => {
        const h = makeHarness();

        await h.controller.updateAgentStatus(spoofedId, req, { status: 'busy' });

        expect(h.availability.updateStatus).toHaveBeenCalledWith(tenantId, actorId, 'busy');
        expect(h.availability.updateStatus).not.toHaveBeenCalledWith(tenantId, spoofedId, 'busy');
    });
});
