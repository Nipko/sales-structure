import { WidgetRateLimitService, WIDGET_SECURITY_LIMITS } from './widget-rate-limit.service';

describe('WidgetRateLimitService', () => {
    const input = {
        ip: '203.0.113.10',
        visitorId: 'visitor-sensitive-id',
        widgetId: 'wgt_123',
        tenantId: 'tenant-1',
    };

    it('atomically consumes every stable session scope without exposing raw identifiers', async () => {
        const redis = { incrementRateLimit: jest.fn().mockResolvedValue(1) };
        const service = new WidgetRateLimitService(redis as any);

        await expect(service.consumeSession(input)).resolves.toEqual({
            allowed: true,
            retryAfterSeconds: 0,
        });
        expect(redis.incrementRateLimit).toHaveBeenCalledTimes(4);
        const keys = redis.incrementRateLimit.mock.calls.map(call => call[0]).join('|');
        expect(keys).not.toContain(input.ip);
        expect(keys).not.toContain(input.visitorId);
        expect(keys).toContain('widget:rl:session:widget:wgt_123');
        expect(keys).toContain('widget:rl:session:tenant:tenant-1');
    });

    it('blocks a rotated visitor once the stable IP ceiling is exceeded', async () => {
        const redis = {
            incrementRateLimit: jest.fn().mockImplementation((key: string) =>
                Promise.resolve(key.includes(':ip:') ? WIDGET_SECURITY_LIMITS.sessionsPerIpHour + 1 : 1),
            ),
        };
        const service = new WidgetRateLimitService(redis as any);

        await expect(service.consumeSession(input)).resolves.toEqual({
            allowed: false,
            blockedScope: 'ip',
            retryAfterSeconds: 3600,
        });
        expect(redis.incrementRateLimit).toHaveBeenCalledTimes(4);
    });

    it('enforces message ceilings across session, visitor, IP, widget and tenant', async () => {
        const redis = {
            incrementRateLimit: jest.fn().mockImplementation((key: string) =>
                Promise.resolve(key.includes(':session:') ? WIDGET_SECURITY_LIMITS.messagesPerSessionMinute + 1 : 1),
            ),
        };
        const service = new WidgetRateLimitService(redis as any);

        const result = await service.consumeMessage({ ...input, sessionId: 'session-1' });
        expect(result).toEqual({ allowed: false, blockedScope: 'session', retryAfterSeconds: 60 });
        expect(redis.incrementRateLimit).toHaveBeenCalledTimes(5);
    });
});
