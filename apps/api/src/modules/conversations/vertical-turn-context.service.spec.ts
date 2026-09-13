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

    it.each([
        ['en', 'For an order'],
        ['pt', 'Para um pedido'],
        ['fr', 'Pour une commande'],
    ])('uses reviewed business boundaries and tool-flow guidance in %s', async (language, expectedGuidance) => {
        const context = await service.resolve({
            tenantId: 'tenant-id', language,
            toolsConfig: { restaurants: { enabled: true } },
        });
        expect(context?.notOffered?.length).toBeGreaterThan(0);
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
