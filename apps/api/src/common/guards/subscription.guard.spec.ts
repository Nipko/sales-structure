import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';

describe('SubscriptionGuard billing recovery boundaries', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(options: {
        url?: string;
        status?: string | null;
        redisError?: boolean;
        dbError?: boolean;
        dunningStartedAt?: Date | null;
        cancellationReason?: string | null;
        apiKeyPrincipal?: boolean;
    } = {}) {
        const redis = {
            get: jest.fn(async () => {
                if (options.redisError) throw new Error('redis down');
                return null;
            }),
            set: jest.fn(async () => undefined),
        };
        const prisma = {
            tenant: {
                findUnique: jest.fn(async () => {
                    if (options.dbError) throw new Error('db down');
                    const status = options.status ?? 'pending_auth';
                    return {
                        isInternal: false,
                        subscriptionStatus: status,
                        subscription: {
                            status,
                            trialEndsAt: null,
                            cancelAtPeriodEnd: false,
                            currentPeriodEnd: null,
                            dunningStartedAt: options.dunningStartedAt ?? null,
                            cancellationReason: options.cancellationReason ?? null,
                        },
                    };
                }),
            },
            billingSubscription: {
                findUnique: jest.fn(async () => {
                    if (options.dbError) throw new Error('db down');
                    return {
                        dunningStartedAt: options.dunningStartedAt ?? null,
                        cancellationReason: options.cancellationReason ?? null,
                    };
                }),
            },
        };
        const request: any = {
            url: options.url ?? '/api/v1/contacts',
            originalUrl: options.url ?? '/api/v1/contacts',
            method: 'POST',
            ...(options.apiKeyPrincipal
                ? { tenantId }
                : { user: { role: 'tenant_admin', tenantId } }),
        };
        const context: any = {
            getType: () => 'http',
            switchToHttp: () => ({ getRequest: () => request }),
        };
        return {
            guard: new SubscriptionGuard(prisma as any),
            context,
            request,
            prisma,
            redis,
        };
    }

    it('does not exempt a protected route through a query-string value', async () => {
        const h = harness({ url: '/api/v1/contacts?next=/billing/' });
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not exempt a nested billing segment', async () => {
        const h = harness({ url: '/api/v1/contacts/billing/export' });
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('enforces pending_auth for an API-key tenant even when there is no JWT user', async () => {
        const h = harness({ apiKeyPrincipal: true });
        await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'payment_method_required' }),
        });
    });

    it('keeps the real billing recovery route reachable', async () => {
        const h = harness({ url: '/api/v1/billing/payment-sources/' + tenantId });
        await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
        expect(h.prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('fails closed when subscription status cannot be read', async () => {
        const h = harness({ redisError: true, dbError: true });
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('uses the canonical durable dunning clock without depending on Redis', async () => {
        const h = harness({
            status: 'past_due',
            redisError: true,
            dunningStartedAt: new Date(Date.now() - 4 * 86_400_000),
        });
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.prisma.tenant.findUnique).toHaveBeenCalled();
    });

    it('fails closed when the request path is unavailable', async () => {
        const h = harness();
        delete h.request.url;
        delete h.request.originalUrl;
        await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('keeps a voluntary pause read-only without inventing a dunning expiry clock', async () => {
        const h = harness({ status: 'past_due', cancellationReason: 'paused: vacation' });
        await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'subscription_paused' }),
        });

        h.request.method = 'GET';
        await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    });
});
