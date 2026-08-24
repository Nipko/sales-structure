import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { VerticalsController } from './verticals.controller';
import { VERTICAL_REGISTRY } from './vertical-definitions';
import {
    SUBTYPE_ALIASES,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    listBlockedSubtypeProfiles,
} from '@parallext/shared';
import {
    VERTICAL_IDENTIFIER_CONTRACT_VERSION,
    VERTICAL_INDUSTRY_ALIASES,
} from './vertical-identifiers';

describe('VerticalsController tenant isolation', () => {
    const methodGuards = (method: keyof VerticalsController): unknown[] => (
        Reflect.getMetadata(GUARDS_METADATA, VerticalsController.prototype[method]) || []
    );

    it.each([
        'getConfig',
        'getStagesPresets',
        'reseedContent',
        'getOperatingCurrency',
        'configureOperatingCurrency',
        'previewMigration',
        'approveMigration',
        'applyMigration',
        'rollbackMigration',
    ] as const)(
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
        const controller = new VerticalsController({} as any, {} as any, {} as any);

        const result = await controller.getDefinitions();

        expect(Object.keys(result.data)).toEqual(Object.keys(VERTICAL_REGISTRY));
        expect(Object.keys(result.data)).toHaveLength(18);
        expect(result.data.otro).toEqual([]);
        expect(result.meta).toMatchObject({
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

    /**
     * El catálogo sigue COMPLETO a propósito.
     *
     * Sacar del payload lo que ya no se ofrece rompería la pantalla del tenant
     * que hoy está en uno de esos perfiles: su propio subtipo desaparecería del
     * selector y la pantalla no sabría cómo llamarlo. Se devuelve todo,
     * anotado, y cada superficie decide qué ofrece.
     */
    it('anota la disponibilidad sin sacar nada del catálogo', async () => {
        const controller = new VerticalsController({} as any, {} as any, {} as any);

        const result = await controller.getDefinitions();

        // Los 75 siguen ahí: el conteo no cambia porque un perfil se cierre.
        expect(result.meta.subtypeCount).toBe(75);
        for (const blocked of listBlockedSubtypeProfiles()) {
            const id = `${blocked.industry}/${blocked.subtype}`;
            expect(result.meta.availability[id]).toBe('legacy_only');
            expect(result.data[blocked.industry].some((s: any) => s.key === blocked.subtype))
                .toBe(true);
        }
        // Y el resto se puede elegir: cerrar siete no cierra el producto.
        expect(result.meta.availability['restaurantes/comida_rapida']).toBe('selectable');
        expect(result.meta.signupAvailability).toEqual(['selectable']);
        expect(result.meta.adminCreateAvailability).toEqual(['selectable', 'pilot']);
    });

    it('cada subtipo lleva su disponibilidad en la lista, no solo en meta', async () => {
        const controller = new VerticalsController({} as any, {} as any, {} as any);

        const result = await controller.getDefinitions();

        for (const subTypes of Object.values(result.data)) {
            for (const subType of subTypes as any[]) {
                // Sin esto el selector tendría que cruzar dos estructuras para
                // saber si puede ofrecer una opción, y ese cruce es el que se
                // olvida cuando se agrega una pantalla nueva.
                expect(typeof subType.availability).toBe('string');
            }
        }
    });

    it('mantiene aliases sólo como legacy y publica su destino canónico', async () => {
        const controller = new VerticalsController({} as any, {} as any, {} as any);
        const result = await controller.getDefinitions();

        expect(result.meta.subtypeAliases).toEqual(SUBTYPE_ALIASES);
        for (const source of Object.keys(SUBTYPE_ALIASES)) {
            const [industry, subtype] = source.split('/');
            const remainsInHistoricCatalog = result.data[industry]
                ?.some((entry: any) => entry.key === subtype);
            expect(result.meta.availability[source])
                .toBe(remainsInHistoricCatalog ? 'legacy_only' : undefined);
        }
    });

    it('publishes and resolves the read-only operational manifest through the service', () => {
        const manifest = { manifestVersion: 1, industryCount: 18, configurationCount: 76 };
        const resolved = { manifestVersion: 1, industry: 'turismo', subtype: 'hotel' };
        const service = {
            getCapabilityManifest: jest.fn().mockReturnValue(manifest),
            resolveCapabilityManifest: jest.fn().mockReturnValue(resolved),
        };
        const controller = new VerticalsController(service as any, {} as any, {} as any);

        expect(controller.getCapabilityManifest()).toEqual({ success: true, data: manifest });
        expect(controller.resolveCapabilityManifest('turismo', 'hotel')).toEqual({
            success: true,
            data: resolved,
        });
        expect(service.resolveCapabilityManifest).toHaveBeenCalledWith('turismo', 'hotel');
    });

    it('serves subtype pipeline presets only after the current manifest is published', async () => {
        const service = {
            getVerticalConfig: jest.fn()
                .mockResolvedValueOnce({
                    industry: 'technology',
                    subType: 'hardware',
                    manifestVersion: 1,
                    effectiveCapabilities: ['appointment_booking'],
                })
                .mockResolvedValueOnce({
                    industry: 'technology',
                    subType: 'hardware',
                    manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
                    effectiveCapabilities: ['catalog_search'],
                }),
        };
        const controller = new VerticalsController(service as any, {} as any, {} as any);

        const legacy = await controller.getStagesPresets('tenant-id');
        const current = await controller.getStagesPresets('tenant-id');
        const legacyRules = legacy.data.flatMap((stage: any) => stage.transitionRules || []);
        const currentRules = current.data.flatMap((stage: any) => stage.transitionRules || []);

        expect(legacy.data).toEqual(VERTICAL_REGISTRY.technology.pipeline.stages);
        expect(legacyRules).toContainEqual({ type: 'appointment_required' });
        expect(currentRules).toContainEqual({ type: 'order_required' });
        expect(currentRules).not.toContainEqual({ type: 'appointment_required' });
    });

    it('keeps content reseeding restricted to tenant administrators', () => {
        expect(Reflect.getMetadata(ROLES_KEY, VerticalsController.prototype.reseedContent))
            .toEqual(['tenant_admin']);
    });

    it.each([
        'configureOperatingCurrency',
        'previewMigration',
        'approveMigration',
        'applyMigration',
        'rollbackMigration',
    ] as const)('keeps %s restricted to tenant administrators', (method) => {
        expect(Reflect.getMetadata(ROLES_KEY, VerticalsController.prototype[method]))
            .toEqual(['tenant_admin']);
    });
});
