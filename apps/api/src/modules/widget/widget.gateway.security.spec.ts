import { WidgetGateway } from './widget.gateway';

function socket(overrides: Record<string, any> = {}): any {
    return {
        handshake: {
            auth: { token: 'token-1' },
            query: {},
            headers: { origin: 'https://shop.example.com' },
            address: '203.0.113.10',
        },
        emit: jest.fn(),
        disconnect: jest.fn(),
        join: jest.fn(),
        ...overrides,
    };
}

describe('WidgetGateway security containment', () => {
    function makeGateway() {
        const widgetService = { getSessionByToken: jest.fn() };
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue({
                id: 'tenant-1', schemaName: 'tenant_1', isActive: true,
                onboardingCompletedAt: new Date(),
            }) },
            executeInTenantSchema: jest.fn(),
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_1'),
        };
        const redis = { get: jest.fn().mockResolvedValue(null) };
        const conversations = { streamWidgetMessage: jest.fn() };
        const rateLimit = { consumeMessage: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }) };
        return {
            gateway: new WidgetGateway(
                widgetService as any, prisma as any, redis as any,
                conversations as any, rateLimit as any,
            ),
            widgetService, prisma, redis, conversations, rateLimit,
        };
    }

    const session = {
        id: 'session-1', tenant_id: 'tenant-1', widget_id: 'wgt_123',
        visitor_id: 'visitor-1', allowed_domains: ['example.com'],
    };

    it('rejects a websocket with missing Origin even when its token is valid', async () => {
        const { gateway, widgetService } = makeGateway();
        widgetService.getSessionByToken.mockResolvedValue(session);
        const client = socket();
        delete client.handshake.headers.origin;

        await gateway.handleConnection(client);

        expect(client.disconnect).toHaveBeenCalled();
        expect(client.join).not.toHaveBeenCalled();
        expect(client.emit).toHaveBeenCalledWith('widget:error', { message: 'Origin not allowed' });
    });

    it('revalidates the stored token on every message before any database write', async () => {
        const { gateway, widgetService, prisma, rateLimit } = makeGateway();
        widgetService.getSessionByToken.mockResolvedValue(null);
        const client = socket();
        client.widgetToken = 'rotated-token';

        await gateway.handleMessage(client, { content: 'hello' });

        expect(widgetService.getSessionByToken).toHaveBeenCalledWith('rotated-token');
        expect(client.disconnect).toHaveBeenCalled();
        expect(rateLimit.consumeMessage).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('blocks message abuse before persistence or provider execution', async () => {
        const { gateway, widgetService, prisma, conversations, rateLimit } = makeGateway();
        widgetService.getSessionByToken.mockResolvedValue(session);
        rateLimit.consumeMessage.mockResolvedValue({ allowed: false, blockedScope: 'ip', retryAfterSeconds: 3600 });
        const client = socket();
        client.widgetToken = 'token-1';

        await gateway.handleMessage(client, { content: 'hello' });

        expect(client.emit).toHaveBeenCalledWith('widget:error', expect.objectContaining({ code: 'rate_limited' }));
        expect(client.disconnect).toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(conversations.streamWidgetMessage).not.toHaveBeenCalled();
    });
});
