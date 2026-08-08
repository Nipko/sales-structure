import * as jwt from 'jsonwebtoken';
import { WidgetService } from './widget.service';

describe('WidgetService security containment', () => {
    const secret = 'widget-test-secret-that-is-long-enough';

    function makeService(overrides: Record<string, any> = {}) {
        const prisma = {
            $queryRawUnsafe: jest.fn(),
            tenant: { findUnique: jest.fn().mockResolvedValue({
                id: 'tenant-1', schemaName: 'tenant_1', isActive: true,
                onboardingCompletedAt: new Date(),
            }) },
            ...overrides.prisma,
        };
        const redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
            ...overrides.redis,
        };
        const config = {
            get: jest.fn((key: string) => key === 'WIDGET_JWT_SECRET' ? secret : undefined),
            getOrThrow: jest.fn(() => secret),
        };
        const throttle = {
            getPlanFeatures: jest.fn().mockResolvedValue({ widget: true }),
            ...overrides.throttle,
        };
        return {
            service: new WidgetService(prisma as any, redis as any, config as any, throttle as any),
            prisma, redis, throttle,
        };
    }

    it('signs the exact UUID inserted for a first session', async () => {
        const { service, prisma } = makeService();
        let insertedId = '';
        prisma.$queryRawUnsafe.mockImplementation((sql: string, ...params: any[]) => {
            if (sql.includes('SELECT id, conversation_id, token')) return Promise.resolve([]);
            if (sql.includes('INSERT INTO public.widget_sessions')) {
                insertedId = params[0];
                return Promise.resolve([{ id: insertedId }]);
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        const created = await service.createSession({
            id: '11111111-1111-4111-8111-111111111111',
            tenant_id: 'tenant-1',
            widget_id: 'wgt_123',
        }, { visitorId: 'visitor-1' });

        const decoded = jwt.verify(created.token, secret) as any;
        expect(created.sessionId).toBe(insertedId);
        expect(decoded.sessionId).toBe(insertedId);
    });

    it('rejects a rotated/stale token before tenant or plan lookup', async () => {
        const { service, prisma, throttle } = makeService();
        prisma.$queryRawUnsafe.mockResolvedValue([]);
        const stale = jwt.sign({
            sessionId: '11111111-1111-4111-8111-111111111111',
            tenantId: 'tenant-1',
            widgetId: 'wgt_123',
        }, secret, { expiresIn: '7d' });

        await expect(service.getSessionByToken(stale)).resolves.toBeNull();
        expect(String(prisma.$queryRawUnsafe.mock.calls[0][0])).toContain('ws.token = $2');
        expect(String(prisma.$queryRawUnsafe.mock.calls[0][0])).toContain('wc.is_active = true');
        expect(throttle.getPlanFeatures).not.toHaveBeenCalled();
    });

    it('fails closed when the tenant plan no longer includes the widget', async () => {
        const { service, prisma } = makeService({
            throttle: { getPlanFeatures: jest.fn().mockResolvedValue({ widget: false }) },
        });
        const token = jwt.sign({
            sessionId: '11111111-1111-4111-8111-111111111111',
            tenantId: 'tenant-1',
            widgetId: 'wgt_123',
        }, secret, { expiresIn: '7d' });
        prisma.$queryRawUnsafe.mockResolvedValue([{
            id: '11111111-1111-4111-8111-111111111111',
            tenant_id: 'tenant-1', widget_id: 'wgt_123', token,
            widget_is_active: true, allowed_domains: [],
        }]);

        await expect(service.getSessionByToken(token)).resolves.toBeNull();
    });

    it('does not trust a cached config after the widget has been disabled', async () => {
        const cached = {
            id: '11111111-1111-4111-8111-111111111111',
            tenant_id: 'tenant-1',
            widget_id: 'wgt_123',
            is_active: true,
        };
        const { service, prisma, throttle } = makeService({
            redis: { get: jest.fn().mockResolvedValue(JSON.stringify(cached)) },
        });
        prisma.$queryRawUnsafe.mockResolvedValue([]);

        await expect(service.getConfig('wgt_123')).resolves.toBeNull();
        expect(String(prisma.$queryRawUnsafe.mock.calls[0][0])).toContain('is_active = true');
        expect(throttle.getPlanFeatures).not.toHaveBeenCalled();
    });

    it('rejects an otherwise valid session when the tenant is suspended', async () => {
        const { service, prisma } = makeService({
            prisma: {
                tenant: { findUnique: jest.fn().mockResolvedValue({
                    id: 'tenant-1', schemaName: 'tenant_1', isActive: false,
                    onboardingCompletedAt: new Date(),
                }) },
            },
        });
        const token = jwt.sign({
            sessionId: '11111111-1111-4111-8111-111111111111',
            tenantId: 'tenant-1',
            widgetId: 'wgt_123',
        }, secret, { expiresIn: '7d' });
        prisma.$queryRawUnsafe.mockResolvedValue([{
            id: '11111111-1111-4111-8111-111111111111',
            tenant_id: 'tenant-1', widget_id: 'wgt_123', token,
            widget_is_active: true, allowed_domains: [],
        }]);

        await expect(service.getSessionByToken(token)).resolves.toBeNull();
    });
});
