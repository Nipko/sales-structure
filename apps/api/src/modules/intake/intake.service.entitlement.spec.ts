import { IntakeService } from './intake.service';

describe('IntakeService public tenant entitlement boundary', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function serviceWith(tenant: any) {
        const prisma = {
            tenant: { findFirst: jest.fn().mockResolvedValue(tenant) },
        };
        const service = new IntakeService(
            prisma as any,
            { emit: jest.fn() } as any,
            {} as any,
        );
        return { service, prisma };
    }

    it('returns only the authoritative tenant id and schema for an active subscription', async () => {
        const h = serviceWith({
            id: tenantId,
            schemaName: 'tenant_authoritative',
            subscriptionStatus: 'active',
            subscription: {
                status: 'active',
                trialEndsAt: null,
                cancelAtPeriodEnd: false,
                currentPeriodEnd: null,
                cancellationReason: null,
                dunningStartedAt: null,
            },
        });

        await expect(h.service.resolvePublicTenant('forged-schema-name', 'write')).resolves.toEqual({
            tenantId,
            schemaName: 'tenant_authoritative',
        });
        expect(h.prisma.tenant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { isActive: true, slug: 'forged-schema-name' },
        }));
    });

    it('rejects public writes while payment authorization is pending', async () => {
        const h = serviceWith({
            id: tenantId,
            schemaName: 'tenant_locked',
            subscriptionStatus: 'pending_auth',
            subscription: {
                status: 'pending_auth',
                trialEndsAt: null,
                cancelAtPeriodEnd: false,
                currentPeriodEnd: null,
                cancellationReason: null,
                dunningStartedAt: null,
            },
        });

        await expect(h.service.resolvePublicTenant(tenantId, 'write')).resolves.toBeNull();
    });

    it('allows read but rejects write during the durable soft-lock window', async () => {
        const tenant = {
            id: tenantId,
            schemaName: 'tenant_past_due',
            subscriptionStatus: 'past_due',
            subscription: {
                status: 'past_due',
                cancelAtPeriodEnd: false,
                trialEndsAt: null,
                currentPeriodEnd: null,
                cancellationReason: null,
                dunningStartedAt: new Date(Date.now() - 4 * 86_400_000),
            },
        };
        const h = serviceWith(tenant);

        await expect(h.service.resolvePublicTenant(tenantId, 'read')).resolves.toEqual({
            tenantId,
            schemaName: tenant.schemaName,
        });
        await expect(h.service.resolvePublicTenant(tenantId, 'write')).resolves.toBeNull();
    });
});
