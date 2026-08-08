import {
    resolveReadyTenantContext,
    resolveReadyUserTenantContext,
    tenantLifecycleLockKey,
    tenantPurgingFenceKey,
} from './tenant-lifecycle.util';

describe('tenant lifecycle readiness boundary', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const readyTenant = {
        id: tenantId,
        schemaName: 'tenant_ready',
        isActive: true,
        onboardingCompletedAt: new Date('2026-08-08T00:00:00.000Z'),
    };

    function harness(overrides: { user?: any; tenant?: any; fence?: string | null } = {}) {
        const tenant = overrides.tenant === undefined ? readyTenant : overrides.tenant;
        const user = overrides.user === undefined ? {
            isActive: true,
            onboardingCompleted: true,
            tenantId,
            tenant,
        } : overrides.user;
        return {
            prisma: {
                tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
                user: { findUnique: jest.fn().mockResolvedValue(user) },
            } as any,
            redis: { get: jest.fn().mockResolvedValue(overrides.fence ?? null) } as any,
        };
    }

    it('returns authoritative tenant context only after user and tenant readiness commit', async () => {
        const h = harness();
        await expect(resolveReadyUserTenantContext(h.prisma, h.redis, userId, tenantId))
            .resolves.toEqual({ tenantId, schemaName: 'tenant_ready' });
    });

    it.each([
        ['user provisioning incomplete', { onboardingCompleted: false }],
        ['user inactive', { isActive: false }],
    ])('strips context when %s', async (_label, userPatch) => {
        const h = harness({
            user: {
                isActive: true,
                onboardingCompleted: true,
                tenantId,
                tenant: readyTenant,
                ...userPatch,
            },
        });
        await expect(resolveReadyUserTenantContext(h.prisma, h.redis, userId, tenantId)).resolves.toBeNull();
    });

    it.each([
        ['inactive', { ...readyTenant, isActive: false }],
        ['without onboarding commit', { ...readyTenant, onboardingCompletedAt: null }],
    ])('strips context when tenant is %s', async (_label, tenant) => {
        const h = harness({ tenant });
        await expect(resolveReadyTenantContext(h.prisma, h.redis, tenantId)).resolves.toBeNull();
    });

    it('strips both user and super-admin context while the purge fence exists', async () => {
        const h = harness({ fence: '1' });
        await expect(resolveReadyTenantContext(h.prisma, h.redis, tenantId)).resolves.toBeNull();
        await expect(resolveReadyUserTenantContext(h.prisma, h.redis, userId, tenantId)).resolves.toBeNull();
    });

    it('fails closed when Redis cannot verify the purge fence', async () => {
        const h = harness();
        h.redis.get.mockRejectedValue(new Error('redis unavailable'));
        await expect(resolveReadyTenantContext(h.prisma, h.redis, tenantId)).rejects.toThrow('redis unavailable');
    });

    it('uses one common lifecycle lease namespace and a distinct runtime purge fence', () => {
        expect(tenantLifecycleLockKey(tenantId)).toBe(`lock:tenant-lifecycle:${tenantId}`);
        expect(tenantPurgingFenceKey(tenantId)).toBe(`tenant:purging:${tenantId}`);
    });
});
