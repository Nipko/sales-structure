import { ProviderResourceBindingService } from './provider-resource-binding.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function serviceWith(options: { configured: boolean; matches?: any[]; generation?: number }) {
    const execute = jest.fn(async (_schema: string, sql: string) => {
        if (sql.includes('MAX(generation)')) return [{ generation: options.generation ?? 0 }];
        if (sql.includes('external_duplicates')) return options.matches || [];
        return [];
    });
    const prisma = {
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_one'),
        executeInTenantSchema: execute,
        tenant: { findUnique: jest.fn().mockResolvedValue({ settings: options.configured ? { verticalIntegrations: { mindbody: {} } } : {} }) },
    };
    return new ProviderResourceBindingService(prisma as any);
}

describe('ProviderResourceBindingService', () => {
    const input = { provider: 'mindbody', connectionId: 'site-1', resourceType: 'location', resourceId: 'local-1' };

    it('resolves one exact binding without allowing the mapping to enable writes', async () => {
        const service = serviceWith({ configured: true, generation: 4, matches: [{
            id: '22222222-2222-4222-8222-222222222222', state: 'active', external_id: 'remote-9', generation: 3, external_duplicates: 1,
        }] });
        await expect(service.resolve(tenantId, input)).resolves.toMatchObject({
            mode: 'exact', owner: 'external', externalId: 'remote-9', generation: 3,
            allowExternalRead: true, allowExternalWrite: false, allowLocalWrite: false, cache: 'not_cached',
        });
    });

    it('preserves external ownership but closes all writes when a configured provider lacks a binding', async () => {
        const service = serviceWith({ configured: true, generation: 7, matches: [] });
        await expect(service.resolve(tenantId, input)).resolves.toMatchObject({
            mode: 'tenant_wide_conservative', owner: 'external', generation: 7,
            allowExternalRead: true, allowExternalWrite: false, allowLocalWrite: false,
            reason: 'resource_binding_required',
        });
    });

    it('blocks duplicate external mappings and uses native ownership only when provider is absent', async () => {
        const conflict = serviceWith({ configured: true, matches: [{ id: 'x', state: 'conflict', external_id: 'same', external_duplicates: 2 }] });
        await expect(conflict.resolve(tenantId, input)).resolves.toMatchObject({ mode: 'conflict', owner: 'blocked', allowLocalWrite: false });

        const native = serviceWith({ configured: false, generation: 0 });
        await expect(native.resolve(tenantId, input)).resolves.toMatchObject({ mode: 'native', owner: 'native', allowLocalWrite: true });
    });
});
