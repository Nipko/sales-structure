import {
    projectVerticalIntentAvailability,
    VerticalTurnContextService,
} from './vertical-turn-context.service';

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
                contractVersion: 2,
                profileId: 'restaurantes/dark_kitchen',
            },
        });
        expect(context?.notOffered?.length).toBeGreaterThan(0);
        expect(context?.industryGuidance).toContain('place_order');
    });

    it.each(['en', 'pt', 'fr'])('does not inject Spanish source prose into %s', async language => {
        const context = await service.resolve({
            tenantId: 'tenant-id', language,
            toolsConfig: { restaurants: { enabled: true } },
        });
        expect(context?.notOffered).toBeUndefined();
        expect(context?.avoidTerms).toBeUndefined();
        expect(context?.industryGuidance).toBeUndefined();
        expect(context?.domainReviewRequired).toEqual(expect.arrayContaining([
            `prompt.notOffered.${language}`,
            `flowGuidance.${language}`,
        ]));
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
        });
    });
});
