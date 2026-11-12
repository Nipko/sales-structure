jest.mock('../../common/utils/tenant-lifecycle.util', () => ({
    resolveReadyTenantContext: jest.fn().mockResolvedValue({ tenantId: 'tenant-a' }),
}));

import { ForbiddenException } from '@nestjs/common';
import { SamlService } from './saml.service';

describe('SAML provisioning never adopts accounts outside the asserting tenant', () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const config = { enabled: true, emailDomains: ['platform.test'] } as any;
    const profile = { email: 'Admin@platform.test', nameId: 'admin@platform.test' };

    function setup(existing: Record<string, unknown> | null) {
        const prisma = {
            user: {
                findFirst: jest.fn().mockResolvedValue(existing),
                update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
            },
        };
        const service = Object.assign(Object.create(SamlService.prototype), { prisma, redis: {} }) as SamlService;
        return { service, prisma };
    }

    it('refuses to adopt the tenantless platform super_admin', async () => {
        const { service, prisma } = setup({ id: 'u1', email: 'admin@platform.test', role: 'super_admin', tenantId: null, authProvider: 'email' });
        await expect(service.provisionOrLinkUser(tenantId, profile, config)).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to adopt any other tenantless account', async () => {
        const { service, prisma } = setup({ id: 'u2', email: 'admin@platform.test', role: 'tenant_admin', tenantId: null, authProvider: 'email' });
        await expect(service.provisionOrLinkUser(tenantId, profile, config)).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('still rejects a user of a different tenant', async () => {
        const { service } = setup({ id: 'u3', email: 'admin@platform.test', role: 'tenant_admin', tenantId: 'other', authProvider: 'saml' });
        await expect(service.provisionOrLinkUser(tenantId, profile, config)).rejects.toThrow('User belongs to a different tenant');
    });

    it('keeps linking a user who already belongs to this tenant', async () => {
        const { service, prisma } = setup({ id: 'u4', email: 'admin@platform.test', role: 'tenant_agent', tenantId, authProvider: 'email' });
        await expect(service.provisionOrLinkUser(tenantId, profile, config)).resolves.toMatchObject({ id: 'u4', authProvider: 'saml' });
        expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });
});
