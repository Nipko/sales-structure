import { AuthService } from './auth.service';

describe('AuthService tenant readiness claims', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';

    function setup(input: {
        userOnboarding?: boolean;
        tenantActive?: boolean;
        tenantCompleted?: boolean;
        purging?: boolean;
    } = {}) {
        const tenant = {
            id: tenantId,
            schemaName: 'tenant_claims',
            isActive: input.tenantActive ?? true,
            onboardingCompletedAt: (input.tenantCompleted ?? true) ? new Date() : null,
        };
        const user = {
            id: userId,
            email: 'owner@example.com',
            role: 'tenant_admin',
            tenantId,
            isActive: true,
            onboardingCompleted: input.userOnboarding ?? true,
            emailVerified: true,
            tenant,
        };
        const prisma: any = {
            user: { findUnique: jest.fn().mockResolvedValue(user) },
            tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
        };
        const redis: any = {
            get: jest.fn(async (key: string) => input.purging && key.startsWith('tenant:purging:') ? '1' : null),
        };
        const service = new AuthService(
            prisma,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            redis,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        return { service };
    }

    it.each([
        ['user provisioning incomplete', { userOnboarding: false }],
        ['tenant inactive', { tenantActive: false }],
        ['tenant provisioning incomplete', { tenantCompleted: false }],
        ['tenant purging', { purging: true }],
    ])('validateUser strips tenantId/schemaName when %s', async (_label, input) => {
        const { service } = setup(input);
        const validated = await service.validateUser({
            sub: userId,
            email: 'owner@example.com',
            role: 'tenant_admin',
            tenantId,
        } as any);

        expect(validated.tenantId).toBeUndefined();
        expect(validated.schemaName).toBeUndefined();
    });

    it('validateUser returns authoritative context after readiness commit', async () => {
        const { service } = setup();
        await expect(service.validateUser({
            sub: userId,
            email: 'owner@example.com',
            role: 'tenant_admin',
            tenantId,
        } as any)).resolves.toEqual(expect.objectContaining({
            tenantId,
            schemaName: 'tenant_claims',
        }));
    });
});
