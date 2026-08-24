import { VerticalTaxonomyInventoryService } from './vertical-taxonomy-inventory.service';

describe('VerticalTaxonomyInventoryService', () => {
    it('scans read-only, classifies structured declarations and omits PII/settings', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
                id: '11111111-1111-4111-8111-111111111111',
                industry: 'inmobiliaria',
                name: 'Must not leave Prisma',
                settings: {
                    verticalConfig: { subType: 'construccion', businessModel: 'ambos' },
                    phone: '+57 secret',
                },
            },
            {
                id: '22222222-2222-4222-8222-222222222222',
                industry: 'fotografia',
                settings: {
                    subType: 'wedding_planner',
                    verticalTaxonomyMigration: { ownerConsent: true },
                },
            },
            {
                id: '33333333-3333-4333-8333-333333333333',
                industry: 'retail',
                settings: { subType: 'moda' },
            },
        ]);
        const service = new VerticalTaxonomyInventoryService({
            tenant: { findMany },
        } as any);

        const result = await service.inventory();

        expect(findMany).toHaveBeenCalledWith({
            select: { id: true, industry: true, settings: true },
        });
        expect(result).toMatchObject({
            applySupported: false,
            targetCatalog: {
                industryCount: 20,
                canonicalConfigurationCount: 76,
                canonicalProfileCount: 76,
                resolvableProfileCount: 81,
            },
            scanned: 3,
            affected: 2,
            byStatus: { candidate: 1, needs_owner: 0, approved: 1 },
        });
        expect(result.rows[0]).toMatchObject({
            currentProfileId: 'inmobiliaria/construccion',
            status: 'candidate',
            candidates: ['inmobiliaria/promotora', 'construccion/contratista_general'],
            selectedTargets: [],
            applySupported: false,
        });
        expect(result.rows[1]).toMatchObject({
            currentProfileId: 'fotografia/wedding_planner',
            status: 'approved',
            selectedTargets: ['event_planning/weddings'],
            applySupported: false,
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('Must not leave Prisma');
        expect(serialized).not.toContain('+57 secret');
        expect(serialized).not.toContain('settings');
    });

    it('does not infer a business model from arbitrary tenant prose', async () => {
        const service = new VerticalTaxonomyInventoryService({
            tenant: {
                findMany: jest.fn().mockResolvedValue([{
                    id: '11111111-1111-4111-8111-111111111111',
                    industry: 'technology',
                    settings: {
                        subType: 'consultoria_ti',
                        about: 'Somos un MSP con soporte administrado',
                    },
                }]),
            },
        } as any);

        const result = await service.inventory();
        expect(result.rows[0]).toMatchObject({
            status: 'needs_owner', candidates: [],
            reasonCodes: ['BUSINESS_MODEL_REQUIRED'],
        });
    });
});
