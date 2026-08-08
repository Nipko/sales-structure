import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { VerticalsController } from './verticals.controller';
import { VERTICAL_REGISTRY } from './vertical-definitions';
import {
    VERTICAL_IDENTIFIER_CONTRACT_VERSION,
    VERTICAL_INDUSTRY_ALIASES,
} from './vertical-identifiers';

describe('VerticalsController tenant isolation', () => {
    const methodGuards = (method: keyof VerticalsController): unknown[] => (
        Reflect.getMetadata(GUARDS_METADATA, VerticalsController.prototype[method]) || []
    );

    it.each(['getConfig', 'getStagesPresets', 'reseedContent'] as const)(
        'protects %s with TenantGuard',
        (method) => {
            expect(methodGuards(method)).toContain(TenantGuard);
        },
    );

    it('keeps the global definitions endpoint independent of tenant context', () => {
        expect(methodGuards('getDefinitions')).not.toContain(TenantGuard);
        expect(methodGuards('getCapabilityManifest')).not.toContain(TenantGuard);
        expect(methodGuards('resolveCapabilityManifest')).not.toContain(TenantGuard);
    });

    it('publishes every canonical vertical, including entries with no subtypes', async () => {
        const controller = new VerticalsController({} as any);

        const result = await controller.getDefinitions();

        expect(Object.keys(result.data)).toEqual(Object.keys(VERTICAL_REGISTRY));
        expect(Object.keys(result.data)).toHaveLength(18);
        expect(result.data.otro).toEqual([]);
        expect(result.meta).toEqual({
            version: VERTICAL_IDENTIFIER_CONTRACT_VERSION,
            contract: 'vertical-identifiers',
            count: 18,
            subtypeCount: 75,
            configurationCount: 76,
            aliases: VERTICAL_INDUSTRY_ALIASES,
        });
        expect(result.meta.aliases.educacion).toBe('education');
        expect(result.meta.aliases.professional_services).toBe('servicios_profesionales');
    });

    it('publishes and resolves the read-only operational manifest through the service', () => {
        const manifest = { manifestVersion: 1, industryCount: 18, configurationCount: 76 };
        const resolved = { manifestVersion: 1, industry: 'turismo', subtype: 'hotel' };
        const service = {
            getCapabilityManifest: jest.fn().mockReturnValue(manifest),
            resolveCapabilityManifest: jest.fn().mockReturnValue(resolved),
        };
        const controller = new VerticalsController(service as any);

        expect(controller.getCapabilityManifest()).toEqual({ success: true, data: manifest });
        expect(controller.resolveCapabilityManifest('turismo', 'hotel')).toEqual({
            success: true,
            data: resolved,
        });
        expect(service.resolveCapabilityManifest).toHaveBeenCalledWith('turismo', 'hotel');
    });

    it('keeps content reseeding restricted to tenant administrators', () => {
        expect(Reflect.getMetadata(ROLES_KEY, VerticalsController.prototype.reseedContent))
            .toEqual(['tenant_admin']);
    });
});
