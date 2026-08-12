import { ForbiddenException, HttpException } from '@nestjs/common';
import { WidgetPublicController } from './widget-public.controller';

describe('WidgetPublicController security containment', () => {
    const config = {
        id: 'widget-config-1',
        widget_id: 'wgt_123',
        tenant_id: 'tenant-1',
        allowed_domains: ['example.com'],
    };

    function makeController() {
        const widgetService = {
            getConfig: jest.fn().mockResolvedValue(config),
            createSession: jest.fn().mockResolvedValue({ sessionId: 'session-1', token: 'token-1' }),
            getSessionByToken: jest.fn(),
        };
        const triggers = { getTriggersForWidget: jest.fn().mockResolvedValue([]) };
        const rateLimit = {
            consumeSession: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
        };
        const controller = new WidgetPublicController(
            widgetService as any, triggers as any, rateLimit as any,
        );
        const request = {
            headers: {}, ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' },
        } as any;
        return { controller, widgetService, triggers, rateLimit, request };
    }

    it('fails closed when a session request omits Origin', async () => {
        const { controller, widgetService, rateLimit, request } = makeController();

        await expect(controller.createSession({
            widgetId: 'wgt_123', visitorId: 'visitor-1',
        }, undefined, request)).rejects.toBeInstanceOf(ForbiddenException);
        expect(rateLimit.consumeSession).not.toHaveBeenCalled();
        expect(widgetService.createSession).not.toHaveBeenCalled();
    });

    it('enforces the domain on public config reads too', async () => {
        const { controller } = makeController();
        await expect(controller.getConfig({ widgetId: 'wgt_123' }, 'https://example.com.evil.test'))
            .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('scopes public trigger projection to the already validated widget tenant', async () => {
        const { controller, triggers } = makeController();

        await controller.getConfig({ widgetId: 'wgt_123' }, 'https://shop.example.com');

        expect(triggers.getTriggersForWidget).toHaveBeenCalledWith('tenant-1', 'widget-config-1');
    });

    it('returns HTTP 429 before creating a session when any atomic scope blocks', async () => {
        const { controller, widgetService, rateLimit, request } = makeController();
        rateLimit.consumeSession.mockResolvedValue({
            allowed: false, blockedScope: 'tenant', retryAfterSeconds: 3600,
        });

        let thrown: unknown;
        try {
            await controller.createSession({
                widgetId: 'wgt_123', visitorId: 'visitor-1',
            }, 'https://shop.example.com', request);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(HttpException);
        expect((thrown as HttpException).getStatus()).toBe(429);
        expect(widgetService.createSession).not.toHaveBeenCalled();
    });
});
