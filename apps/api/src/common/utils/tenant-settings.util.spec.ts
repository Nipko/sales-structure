import { mergeTenantSettingsAtomic } from './tenant-settings.util';

describe('mergeTenantSettingsAtomic', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    it('uses one JSONB merge statement and preserves independent concurrent patches', async () => {
        let stored: Record<string, unknown> = {
            billing: { status: 'trialing' },
        };
        const prisma: any = {
            $executeRawUnsafe: jest.fn(async (sql: string, id: string, patch: string) => {
                expect(sql).toContain("COALESCE(settings, '{}'::jsonb) || $2::jsonb");
                expect(sql).toContain('WHERE id = $1::uuid');
                expect(id).toBe(tenantId);
                stored = { ...stored, ...JSON.parse(patch) };
                return 1;
            }),
        };

        await Promise.all([
            mergeTenantSettingsAtomic(prisma, tenantId, { verticalProvisioning: { status: 'pending' } }),
            mergeTenantSettingsAtomic(prisma, tenantId, { timezone: 'America/Bogota' }),
        ]);

        expect(stored).toEqual({
            billing: { status: 'trialing' },
            verticalProvisioning: { status: 'pending' },
            timezone: 'America/Bogota',
        });
        expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('fails closed when the tenant row no longer exists', async () => {
        const prisma: any = { $executeRawUnsafe: jest.fn().mockResolvedValue(0) };

        await expect(mergeTenantSettingsAtomic(prisma, tenantId, { a: 1 }))
            .rejects.toThrow(`Tenant ${tenantId} not found`);
    });
});
