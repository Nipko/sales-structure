import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BiApiGuard } from './bi-api.guard';

describe('BiApiGuard subscription-enforcement handoff', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(options: { key?: string; tenant?: { id: string } | null; feature?: boolean } = {}) {
        const request: any = { headers: { 'x-api-key': options.key ?? 'bi-secret' } };
        const prisma = {
            tenant: { findFirst: jest.fn().mockResolvedValue(options.tenant === undefined ? { id: tenantId } : options.tenant) },
        };
        const throttle = {
            isFeatureEnabled: jest.fn().mockResolvedValue(options.feature ?? true),
        };
        const context: any = {
            switchToHttp: () => ({ getRequest: () => request }),
        };
        return {
            guard: new BiApiGuard(prisma as any, throttle as any),
            request,
            context,
            prisma,
            throttle,
        };
    }

    it('authenticates and publishes tenantId before the subscription interceptor', async () => {
        const h = harness();
        await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
        expect(h.request.tenantId).toBe(tenantId);
        expect(h.request.apiKeyKind).toBe('bi');
    });

    it('rejects an unknown key without publishing tenant context', async () => {
        const h = harness({ tenant: null });
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(h.request.tenantId).toBeUndefined();
    });

    it('rejects a tenant whose plan has no BI feature', async () => {
        const h = harness({ feature: false });
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.request.tenantId).toBeUndefined();
    });
});
