import { AgentConsoleGateway } from './agent-console.gateway';

describe('AgentConsoleGateway tenant and role isolation', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const agentId = '33333333-3333-4333-8333-333333333333';

    function makeGateway(overrides: Record<string, any> = {}) {
        const agentConsoleService = {
            getInbox: jest.fn().mockResolvedValue([]),
            getConversation: jest.fn().mockResolvedValue({ id: conversationId }),
            conversationExists: jest.fn().mockResolvedValue(true),
            canActOnConversation: jest.fn().mockResolvedValue(true),
            canViewConversation: jest.fn().mockResolvedValue(true),
            ...overrides.agentConsoleService,
        };
        const copilot = {
            getSuggestions: jest.fn().mockResolvedValue([{ text: 'Hola', tone: 'friendly' }]),
            ...overrides.copilot,
        };
        const collision = {
            startViewing: jest.fn().mockResolvedValue(undefined),
            stopViewing: jest.fn().mockResolvedValue(undefined),
            heartbeat: jest.fn().mockResolvedValue(undefined),
            getViewers: jest.fn().mockResolvedValue([]),
            removeAgent: jest.fn().mockResolvedValue([]),
        };
        const prisma = overrides.prisma || {
            user: {
                findUnique: jest.fn().mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }),
                findFirst: jest.fn().mockResolvedValue({ role: 'tenant_agent', email: 'ada@example.com' }),
            },
        };
        const redis = overrides.redis || { get: jest.fn().mockResolvedValue(null) };
        const jwt = overrides.jwt || { verify: jest.fn() };
        const config = overrides.config || { get: jest.fn().mockReturnValue('secret') };
        const wsRelay = { publish: jest.fn(), subscribe: jest.fn() };
        const gateway = new AgentConsoleGateway(
            agentConsoleService as any,
            copilot as any,
            collision as any,
            prisma as any,
            redis as any,
            jwt as any,
            config as any,
            wsRelay as any,
        );
        const room = { emit: jest.fn() };
        gateway.server = { to: jest.fn().mockReturnValue(room) };
        return { gateway, agentConsoleService, copilot, collision, prisma, redis, jwt, room, wsRelay };
    }

    function client() {
        const room = { emit: jest.fn() };
        return {
            id: 'socket-1',
            handshake: { auth: { token: 'jwt' } },
            emit: jest.fn(),
            disconnect: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            to: jest.fn().mockReturnValue(room),
            room,
        };
    }

    function authorizeSocket(gateway: AgentConsoleGateway, socket: ReturnType<typeof client>, role = 'tenant_agent') {
        (gateway as any).socketMeta.set(socket.id, {
            tenantId,
            agentId,
            role,
            agentName: 'Ada',
        });
    }

    it('rejects a viewer even when their signed token and tenant are otherwise valid', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isActive: true,
                    onboardingCompleted: true,
                    tenantId,
                    tenant: {
                        id: tenantId,
                        schemaName: 'tenant_acme',
                        isActive: true,
                        onboardingCompletedAt: new Date(),
                    },
                }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const jwt = {
            verify: jest.fn().mockReturnValue({
                sub: agentId,
                tenantId,
                role: 'tenant_viewer',
                email: 'viewer@example.com',
            }),
        };
        const h = makeGateway({ prisma, jwt });
        const socket = client();

        await h.gateway.handleConnection(socket);

        expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: agentId,
                tenantId,
                isActive: true,
                role: { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
            }),
        }));
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect((socket as any).jwtPayload).toBeUndefined();
    });

    it('defensively rejects a viewer at join and never joins any room', async () => {
        const h = makeGateway();
        const socket = client();
        (socket as any).jwtPayload = { sub: agentId, tenantId, role: 'tenant_viewer', email: 'v@example.com' };

        await h.gateway.handleAgentJoin(socket, { agentId, tenantId });

        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.join).not.toHaveBeenCalled();
    });

    it('uses tenant-scoped agent and conversation rooms', async () => {
        const h = makeGateway();
        const socket = client();
        (socket as any).jwtPayload = { sub: agentId, tenantId, role: 'tenant_agent', email: 'a@example.com' };

        await h.gateway.handleAgentJoin(socket, { agentId, tenantId });
        await h.gateway.handleOpenConversation(socket, { conversationId });

        expect(socket.join).toHaveBeenCalledWith(`tenant:${tenantId}`);
        expect(socket.join).toHaveBeenCalledWith(`agent:${tenantId}:${agentId}`);
        expect(socket.join).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(h.gateway.server.to).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
    });

    it('does not join or register viewing when the tenant-scoped conversation is missing', async () => {
        const h = makeGateway({
            agentConsoleService: { getConversation: jest.fn().mockResolvedValue(null) },
        });
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleOpenConversation(socket, { conversationId });

        expect(socket.join).not.toHaveBeenCalled();
        expect(h.collision.startViewing).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Conversation not found' });
    });

    it.each([
        ['conversation:open', (gateway: AgentConsoleGateway, socket: any) =>
            gateway.handleOpenConversation(socket, { conversationId })],
        ['conversation:viewing_start', (gateway: AgentConsoleGateway, socket: any) =>
            gateway.handleViewingStart(socket, { conversationId })],
    ])('leaves the scoped room when assignment wins the %s visibility race', async (_event, invoke) => {
        let resolveRecheck!: (visible: boolean) => void;
        const recheck = new Promise<boolean>((resolve) => { resolveRecheck = resolve; });
        const canViewConversation = jest.fn()
            .mockResolvedValueOnce(true)
            .mockReturnValueOnce(recheck);
        const h = makeGateway({ agentConsoleService: { canViewConversation } });
        const socket = client();
        authorizeSocket(h.gateway, socket);

        const pending = invoke(h.gateway, socket);
        // Advance through the initial visibility check (and, for open, detail
        // loading) until the socket is joined and waiting on the final re-check.
        for (let i = 0; i < 4 && socket.join.mock.calls.length === 0; i++) {
            await Promise.resolve();
        }
        expect(socket.join).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);

        // Simulate another agent claiming/reassigning between join and re-check.
        resolveRecheck(false);
        await pending;

        expect(socket.leave).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(socket.emit).not.toHaveBeenCalledWith('conversation:detail', expect.anything());
        expect(h.collision.startViewing).not.toHaveBeenCalled();
    });

    it('drops typing without socket metadata or ownership of the tenant conversation', async () => {
        const h = makeGateway({
            agentConsoleService: { canViewConversation: jest.fn().mockResolvedValue(false) },
        });
        const unauthenticated = client();
        await h.gateway.handleTyping(unauthenticated, { conversationId, typing: true });
        expect(unauthenticated.to).not.toHaveBeenCalled();

        const authenticated = client();
        authorizeSocket(h.gateway, authenticated);
        await h.gateway.handleTyping(authenticated, { conversationId, typing: true });
        expect(h.agentConsoleService.canViewConversation).toHaveBeenCalledWith(
            tenantId, conversationId, agentId, 'tenant_agent',
        );
        expect(authenticated.to).not.toHaveBeenCalled();
    });

    it('does not join, expose detail, or publish presence for a conversation owned by another agent', async () => {
        const h = makeGateway({
            agentConsoleService: { canViewConversation: jest.fn().mockResolvedValue(false) },
        });
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleOpenConversation(socket, { conversationId });
        await h.gateway.handleViewingStart(socket, { conversationId });
        await h.gateway.handleHeartbeat(socket, { conversationId });

        expect(h.agentConsoleService.getConversation).not.toHaveBeenCalled();
        expect(h.agentConsoleService.canViewConversation).toHaveBeenCalledWith(
            tenantId, conversationId, agentId, 'tenant_agent',
        );
        expect(socket.join).not.toHaveBeenCalled();
        expect(socket.emit).not.toHaveBeenCalledWith('conversation:detail', expect.anything());
        expect(h.collision.startViewing).not.toHaveBeenCalled();
        expect(h.collision.heartbeat).not.toHaveBeenCalled();
    });

    it('joins and leaves only the tenant-scoped conversation room while viewing', async () => {
        const h = makeGateway();
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleViewingStart(socket, { conversationId });
        await h.gateway.handleViewingStop(socket, { conversationId });

        expect(socket.join).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(socket.leave).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(socket.join).not.toHaveBeenCalledWith(`conversation:${conversationId}`);
        expect(socket.leave).not.toHaveBeenCalledWith(`conversation:${conversationId}`);
    });

    it('emits typing and inbound messages only to tenant-scoped conversation rooms', async () => {
        const h = makeGateway();
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleTyping(socket, { conversationId, typing: true });
        h.gateway.notifyNewMessage(tenantId, conversationId, { id: 'message-1' });

        expect(socket.to).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(h.gateway.server.to).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(h.gateway.server.to).not.toHaveBeenCalledWith(`conversation:${conversationId}`);
        expect(h.gateway.server.to).toHaveBeenCalledWith(`tenant:${tenantId}`);
        expect(h.room.emit).not.toHaveBeenCalledWith('inbox:new_message', expect.anything());
        expect(h.room.emit).toHaveBeenCalledWith('inbox:refresh', {});
    });

    it('always cleans up viewing state after ownership is lost without revealing viewers', async () => {
        const h = makeGateway({
            agentConsoleService: { canViewConversation: jest.fn().mockResolvedValue(false) },
        });
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleViewingStop(socket, { conversationId });

        expect(h.collision.stopViewing).toHaveBeenCalledWith(tenantId, conversationId, agentId);
        expect(socket.leave).toHaveBeenCalledWith(`conversation:${tenantId}:${conversationId}`);
        expect(h.collision.getViewers).not.toHaveBeenCalled();
        expect(h.gateway.server.to).not.toHaveBeenCalled();
    });

    it('rejects Copilot for a peer-owned conversation before generation', async () => {
        const h = makeGateway({
            agentConsoleService: { canViewConversation: jest.fn().mockResolvedValue(false) },
        });
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleCopilotSuggest(socket, { conversationId });

        expect(h.copilot.getSuggestions).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
            message: expect.stringContaining('permiso'),
        }));
    });

    it('surfaces Copilot rate limiting over WebSocket without leaking suggestions', async () => {
        const rateError: any = new Error('rate limited');
        rateError.getStatus = () => 429;
        const h = makeGateway({ copilot: { getSuggestions: jest.fn().mockRejectedValue(rateError) } });
        const socket = client();
        authorizeSocket(h.gateway, socket);

        await h.gateway.handleCopilotSuggest(socket, { conversationId });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ statusCode: 429 }));
        expect(socket.emit).toHaveBeenCalledWith('copilot:suggestions', {
            conversationId,
            suggestions: [],
        });
    });
});
