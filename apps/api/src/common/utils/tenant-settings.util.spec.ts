import {
    firstUnsupportedGenericTenantSetting,
    mergeTenantSettingsAtomic,
    mutateTenantSettingsAtomic,
    redactReservedTenantSettings,
    RESERVED_TENANT_SETTING_KEYS,
} from './tenant-settings.util';

describe('generic tenant settings boundary', () => {
    it('redacts every dedicated branch without mutating the source', () => {
        const settings: Record<string, unknown> = {
            timezone: 'America/Bogota',
            ...Object.fromEntries(RESERVED_TENANT_SETTING_KEYS.map((key) => [key, { secret: key }])),
        };

        const safe = redactReservedTenantSettings(settings) as Record<string, unknown>;

        expect(safe).toEqual({ timezone: 'America/Bogota' });
        for (const key of RESERVED_TENANT_SETTING_KEYS) expect(settings).toHaveProperty(key);
    });

    it('allows only the narrow generic localization, hours and quality contract', () => {
        expect(firstUnsupportedGenericTenantSetting({
            timezone: 'America/Lima',
            currency: 'PEN',
            businessHours: { is247: true },
            chatReasons: ['comprar'],
            customerTypes: ['empresa'],
        })).toBeNull();
        expect(firstUnsupportedGenericTenantSetting({ futureIntegration: true }))
            .toBe('futureIntegration');
    });
});

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

describe('mutateTenantSettingsAtomic', () => {
    it('locks and updates related keys from the live settings document', async () => {
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{
                settings: { featureFlags: { old: true }, unrelated: { keep: true } },
            }]),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        };
        const prisma = { $transaction: jest.fn(async (callback: any) => callback(tx)) };

        const next = await mutateTenantSettingsAtomic(
            prisma as any,
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            current => ({
                ...current,
                featureFlags: { next: true },
                featureFlagsMeta: { next: { setBy: 'owner' } },
            }),
        );

        expect(tx.$queryRawUnsafe.mock.calls[0][0]).toMatch(/FOR UPDATE/i);
        expect(next.unrelated).toEqual({ keep: true });
        const persisted = JSON.parse(tx.$executeRawUnsafe.mock.calls[0][2]);
        expect(persisted).toEqual(next);
    });
});
