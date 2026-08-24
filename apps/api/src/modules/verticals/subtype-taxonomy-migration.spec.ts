import {
    SUBTYPE_TAXONOMY_MIGRATION_APPLY_SUPPORTED,
    SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS,
    classifySubtypeTaxonomyMigration,
} from '@parallext/shared';

describe('subtype taxonomy migration dry-run contract', () => {
    it('is compile-time fail-closed and covers only the four legacy identities', () => {
        expect(SUBTYPE_TAXONOMY_MIGRATION_APPLY_SUPPORTED).toBe(false);
        expect(Object.keys(SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS).sort()).toEqual([
            'finanzas/fintech',
            'fotografia/wedding_planner',
            'inmobiliaria/construccion',
            'technology/consultoria_ti',
        ]);
        for (const contract of Object.values(SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS)) {
            expect(contract).toMatchObject({ requiresOwnerConsent: true, applySupported: false });
        }
    });

    it('never converts a generic fintech declaration into payments', () => {
        expect(classifySubtypeTaxonomyMigration({
            industry: 'finanzas', subType: 'fintech', businessModel: 'wallet',
        })).toMatchObject({
            status: 'needs_owner', candidates: [],
            reasonCodes: ['FINTECH_FAMILY_UNSUPPORTED'],
            applySupported: false,
        });

        expect(classifySubtypeTaxonomyMigration({
            industry: 'finanzas', subType: 'fintech', businessModel: 'recaudos',
        })).toMatchObject({
            status: 'candidate',
            candidates: ['finanzas/pagos_recaudos'],
            selectedTargets: [],
        });
    });

    it('classifies construction as developer, contractor or two workspaces', () => {
        expect(classifySubtypeTaxonomyMigration({
            industry: 'inmobiliaria', subType: 'construccion', businessModel: 'developer',
        })?.candidates).toEqual(['inmobiliaria/promotora']);
        expect(classifySubtypeTaxonomyMigration({
            industry: 'inmobiliaria', subType: 'construccion', businessModel: 'contratista',
        })?.candidates).toEqual(['construccion/contratista_general']);
        expect(classifySubtypeTaxonomyMigration({
            industry: 'inmobiliaria', subType: 'construccion', businessModel: 'ambos',
        })?.candidates).toEqual([
            'inmobiliaria/promotora', 'construccion/contratista_general',
        ]);
    });

    it('separates MSP from project consulting and supports a dual result', () => {
        expect(classifySubtypeTaxonomyMigration({
            industry: 'technology', subType: 'consultoria_ti', businessModel: 'msp',
        })?.candidates).toEqual(['technology/soporte_ti_msp']);
        expect(classifySubtypeTaxonomyMigration({
            industry: 'technology', subType: 'consultoria_ti', businessModel: 'proyectos',
        })?.candidates).toEqual(['servicios_profesionales/consultores']);
        expect(classifySubtypeTaxonomyMigration({
            industry: 'technology', subType: 'consultoria_ti', businessModel: 'both',
        })?.candidates).toEqual([
            'technology/soporte_ti_msp', 'servicios_profesionales/consultores',
        ]);
    });

    it('requires separately recorded owner consent even for deterministic weddings', () => {
        const candidate = classifySubtypeTaxonomyMigration({
            industry: 'fotografia', subType: 'wedding_planner',
        });
        expect(candidate).toMatchObject({
            status: 'candidate',
            candidates: ['event_planning/weddings'],
            selectedTargets: [],
            reasonCodes: ['WEDDING_PLANNER_RECLASSIFICATION', 'OWNER_CONSENT_REQUIRED'],
        });

        expect(classifySubtypeTaxonomyMigration({
            industry: 'fotografia', subType: 'wedding_planner', ownerConsent: true,
        })).toMatchObject({
            status: 'approved',
            selectedTargets: ['event_planning/weddings'],
            applySupported: false,
        });
    });

    it('returns null outside the explicit migration sources', () => {
        expect(classifySubtypeTaxonomyMigration({
            industry: 'retail', subType: 'marketplace', businessModel: 'platform',
        })).toBeNull();
    });
});
