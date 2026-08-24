import {
    PROFILE_SYSTEM_OF_RECORD_POLICIES,
    resolveSubtypeExperienceProfile,
} from '@parallext/shared';
import { EffectiveCapabilityService } from './effective-capability.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_sor';

function build(readsAvailable: boolean) {
    const throttle = {
        getPlanFeatures: jest.fn().mockResolvedValue({}),
        getTenantPlan: jest.fn().mockResolvedValue('pro'),
    };
    const readiness = {
        evaluate: jest.fn().mockResolvedValue({ checks: [], unmet: [], degraded: false }),
    };
    const sor = {
        resolve: jest.fn().mockResolvedValue({ readsAvailable }),
    };
    const service = new EffectiveCapabilityService(
        throttle as any,
        readiness as any,
        undefined,
        sor as any,
    );
    return { service, sor };
}

describe('system-of-record dentro del contrato efectivo', () => {
    it('sin binding externo, farmacia conserva lectura y writer nativos', async () => {
        const { service } = build(false);
        const contract = await service.resolve({
            tenantId,
            schemaName,
            industry: 'salud',
            subType: 'farmacia',
            toolsConfig: { catalog: { enabled: true } },
        });
        expect(contract.publishedTools).toEqual(expect.arrayContaining([
            'search_products', 'get_product', 'check_stock', 'place_catalog_order',
        ]));
        expect(contract.excluded.some(e => e.reason === 'provider_unavailable')).toBe(false);
        expect(contract.excluded.some(e => e.reason === 'external_system_of_record')).toBe(false);
    });

    it('alquiler vacacional sin Channel Manager conserva list/check/create', async () => {
        const { service, sor } = build(false);
        const contract = await service.resolve({
            tenantId,
            schemaName,
            industry: 'turismo',
            subType: 'alquiler_vacacional',
            toolsConfig: { properties: { enabled: true } },
        });
        expect(contract.publishedTools).toContain('list_properties');
        expect(contract.publishedTools).toContain('check_property_availability');
        expect(contract.publishedTools).toContain('create_property_booking');
        // Ownership is per property and is enforced by PropertiesService once
        // the tool has a propertyId; a profile-level resolver must not guess.
        expect(sor.resolve).not.toHaveBeenCalled();
    });

    it.each(
        Object.values(PROFILE_SYSTEM_OF_RECORD_POLICIES)
            .filter(policy => policy.boundary === 'conditional_provider')
            .map(policy => [policy.profileId, policy] as const),
    )('%s conserva capacidades nativas mientras no exista un binding verificable', async (profileId, policy) => {
        const { service, sor } = build(false);
        const [industry, subType] = profileId.split('/');
        const profile = resolveSubtypeExperienceProfile(industry, subType);
        const toolsConfig = Object.fromEntries(
            profile.capability.toolGroups.map(group => [group, { enabled: true }]),
        );
        const contract = await service.resolve({
            tenantId, schemaName, industry, subType, toolsConfig,
        });

        expect(contract.publishedTools).toEqual(expect.arrayContaining([
            ...policy.readTools,
            ...policy.displacedWriters,
        ]));
        expect(sor.resolve).not.toHaveBeenCalled();
    });

    it('una frontera nativa no consulta el resolver externo ni recorta sus tools', async () => {
        const { service, sor } = build(false);
        const contract = await service.resolve({
            tenantId,
            schemaName,
            industry: 'fotografia',
            subType: 'producto',
            toolsConfig: { photography: { enabled: true } },
        });
        expect(sor.resolve).not.toHaveBeenCalled();
        expect(contract.publishedTools).toContain('list_photo_packages');
    });
});
