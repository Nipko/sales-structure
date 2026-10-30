import {
    projectVerticalIntentAvailability,
    VerticalTurnContextService,
} from './vertical-turn-context.service';
import { VERTICAL_DOMAIN_CONTRACT_VERSION } from '@parallext/shared';

describe('VerticalTurnContextService', () => {
    const verticals = {
        getVerticalConfig: jest.fn().mockResolvedValue({
            industry: 'restaurantes',
            subType: 'dark_kitchen',
            terminology: {},
        }),
    };
    const prisma = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({
                settings: {
                    chatReasons: ['ventas', 'other:confirmar pedidos'],
                    customerTypes: ['consumidor_final'],
                },
            }),
        },
    };
    const service = new VerticalTurnContextService(prisma as any, verticals as any);

    it('projects the domain contract and owner goals in Spanish', async () => {
        const context = await service.resolve({
            tenantId: 'tenant-id', language: 'es-CO',
            toolsConfig: { restaurants: { enabled: true } },
        });
        expect(context).toMatchObject({
            industry: 'restaurantes',
            subType: 'dark_kitchen',
            businessGoals: ['ventas', 'confirmar pedidos'],
            targetAudiences: ['consumidor_final'],
            domainContract: {
                contractVersion: VERTICAL_DOMAIN_CONTRACT_VERSION,
                profileId: 'restaurantes/dark_kitchen',
            },
        });
        // R3b: sin valor del negocio no hay <not_offered> (la lista de plataforma del perfil se retiró)
        expect(context?.notOffered).toBeUndefined();
        expect(context?.industryGuidance).toContain('place_order');
    });

    it('<not_offered> is what the business declared (CORE.OFFER.NOT_OFFERED), never the profile exclusions', async () => {
        const businessFacts = { notOffered: jest.fn().mockResolvedValue([{ item: 'pedidos para recoger', alternative: 'domicilio' }, { item: 'eventos' }]) };
        const withFacts = new VerticalTurnContextService(prisma as any, verticals as any, businessFacts as any);
        const context = await withFacts.resolve({ tenantId: 'tenant-id', language: 'es', toolsConfig: { restaurants: { enabled: true } } });
        expect(businessFacts.notOffered).toHaveBeenCalledWith('tenant-id', undefined);
        expect(context?.notOffered).toEqual(['pedidos para recoger (alternative: domicilio)', 'eventos']);
        businessFacts.notOffered.mockResolvedValueOnce(null);
        expect((await withFacts.resolve({ tenantId: 'tenant-id', language: 'es', toolsConfig: {} }))?.notOffered).toBeUndefined();
    });

    it.each([
        ['AR', 'turno', 'turnos'], ['UY', 'turno', 'turnos'], ['CO', 'cita', 'citas'], [undefined, 'cita', 'citas'],
    ])('names the appointment object for the customer by tenant country (%s)', async (country, noun, plural) => {
        verticals.getVerticalConfig.mockResolvedValueOnce({ industry: 'salud', subType: 'dental', terminology: {} });
        const context = await service.resolve({ tenantId: 'tenant-id', language: 'es', country, toolsConfig: {} });
        expect(context?.primaryObjectNoun).toBe(noun);
        expect(context?.primaryObjectNounPlural).toBe(plural);
    });

    it.each([
        ['en', 'For an order'],
        ['pt', 'Para um pedido'],
        ['fr', 'Pour une commande'],
    ])('uses reviewed business boundaries and tool-flow guidance in %s', async (language, expectedGuidance) => {
        const context = await service.resolve({
            tenantId: 'tenant-id', language,
            toolsConfig: { restaurants: { enabled: true } },
        });
        expect(context?.notOffered).toBeUndefined();
        expect(context?.avoidTerms?.length).toBeGreaterThan(0);
        expect(context?.domainContract?.claims.length).toBeGreaterThan(0);
        expect(context?.industryGuidance).toContain(expectedGuidance);
        expect(context?.industryGuidance).toContain('place_order');
        expect(context?.domainReviewRequired).not.toContain(`prompt.notOffered.${language}`);
        expect(context?.domainReviewRequired).not.toContain(`prompt.claims.${language}`);
        expect(context?.domainReviewRequired).not.toContain(`terminology.avoid.${language}`);
        expect(context?.domainReviewRequired).not.toContain(`flowGuidance.${language}`);
        expect(context?.domainContract?.intents.length).toBeGreaterThan(0);
    });

    it('does not use a Spanish configured term as an English translation', async () => {
        verticals.getVerticalConfig.mockResolvedValueOnce({
            industry: 'restaurantes',
            subType: 'dark_kitchen',
            terminology: { serviceNoun: { es: 'plato' } },
        });
        const context = await service.resolve({
            tenantId: 'tenant-id', language: 'en', toolsConfig: {},
        });
        expect(context?.serviceNoun).toBeUndefined();
        expect(context?.domainReviewRequired).toContain('terminology.serviceNoun.en');
    });

    it('keeps the authored tool plan but marks the exact runtime subset', () => {
        const context = projectVerticalIntentAvailability({
            domainContract: {
                contractVersion: 2,
                profileId: 'retail/moda',
                status: 'draft',
                scope: 'venta_directa',
                claims: [],
                intents: [{
                    key: 'buy', commits: true,
                    toolPlan: ['search_products', 'check_stock', 'place_catalog_order'],
                }],
                unresolved: [],
            },
        }, ['search_products', 'check_stock']);

        expect(context?.domainContract?.intents[0]).toEqual({
            key: 'buy', commits: true,
            toolPlan: ['search_products', 'check_stock', 'place_catalog_order'],
            runtimeToolPlan: ['search_products', 'check_stock'],
            runtimeStatus: 'partial',
            missingTools: ['place_catalog_order'],
            defaultDeny: true,
            workflowReadiness: 'blocked_missing_tools',
            workflowBlockedReason: 'blocked_missing_tools',
        });
    });
});
