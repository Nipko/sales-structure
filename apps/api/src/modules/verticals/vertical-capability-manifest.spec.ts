import {
    ASSURANCE_LEVEL_MATRIX,
    ASSURANCE_LEVELS,
    assuranceLevelSatisfies,
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
    VERTICAL_CAPABILITY_MANIFEST,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    VERTICAL_MANIFEST_INDUSTRIES,
} from '@parallext/shared';
import { VERTICAL_REGISTRY } from './vertical-definitions';

describe('VerticalCapabilityManifest v1 contract', () => {
    it('publishes the cumulative A0-A4 authority matrix without gaps', () => {
        expect(ASSURANCE_LEVELS).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
        expect(Object.keys(ASSURANCE_LEVEL_MATRIX)).toEqual(ASSURANCE_LEVELS);

        for (const [index, level] of ASSURANCE_LEVELS.entries()) {
            const contract = ASSURANCE_LEVEL_MATRIX[level];
            expect(contract.rank).toBe(index);
            expect(contract.idempotencyLedger).toBe('writes');
            expect(assuranceLevelSatisfies(level, 'A0')).toBe(true);
        }

        expect(ASSURANCE_LEVEL_MATRIX.A0.requiresContactContext).toBe(false);
        expect(ASSURANCE_LEVEL_MATRIX.A1).toMatchObject({
            requiresContactContext: true,
            requiresStepUpIdentity: false,
            signedConfirmation: 'writes',
        });
        expect(ASSURANCE_LEVEL_MATRIX.A2.requiresStepUpIdentity).toBe(true);
        expect(ASSURANCE_LEVEL_MATRIX.A3.scope).toBe('signature_payment_or_high_sensitivity');
        expect(ASSURANCE_LEVEL_MATRIX.A4).toMatchObject({
            scope: 'regulated_irreversible_or_financial_override',
            humanApproval: 'writes',
        });
        expect(assuranceLevelSatisfies('A2', 'A3')).toBe(false);
    });

    it('covers the same 18 industries, 75 subtypes and 76 catalogued configurations', () => {
        expect(VERTICAL_CAPABILITY_MANIFEST_VERSION).toBe(1);
        expect(VERTICAL_MANIFEST_INDUSTRIES).toHaveLength(18);
        expect([...VERTICAL_MANIFEST_INDUSTRIES]).toEqual(Object.keys(VERTICAL_REGISTRY));

        let subtypeCount = 0;
        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            const manifestEntry = VERTICAL_CAPABILITY_MANIFEST[industry];
            const definitionSubtypes = VERTICAL_REGISTRY[industry].subTypes.map(({ key }) => key);
            expect(manifestEntry.industry).toBe(industry);
            expect(manifestEntry.subtypes).toEqual(definitionSubtypes);
            subtypeCount += manifestEntry.subtypes.length;

            for (const overrideKey of Object.keys(manifestEntry.subtypeOverrides || {})) {
                expect([
                    ...manifestEntry.subtypes,
                    ...(manifestEntry.legacySubtypes || []),
                ]).toContain(overrideKey);
            }
        }

        const configurations = listVerticalCapabilityConfigurations();
        expect(subtypeCount).toBe(75);
        expect(configurations).toHaveLength(76);
        expect(configurations.filter(({ subtype }) => subtype !== null)).toHaveLength(75);
        expect(configurations.filter(({ subtype }) => subtype === null)).toEqual([
            expect.objectContaining({ industry: 'otro', subtype: null }),
        ]);
        expect(VERTICAL_CAPABILITY_MANIFEST.moda_belleza.legacySubtypes).toEqual(['boutique']);
        expect(VERTICAL_CAPABILITY_MANIFEST.restaurantes.legacySubtypes).toEqual(['delivery']);
    });

    it('resolves every catalogued pair exactly once with unique operational values', () => {
        const configurations = listVerticalCapabilityConfigurations();
        const keys = configurations.map(({ industry, subtype }) => `${industry}/${subtype || '-'}`);
        expect(new Set(keys).size).toBe(76);

        for (const configuration of configurations) {
            expect(resolveVerticalCapabilityManifest(
                configuration.industry,
                configuration.subtype,
            )).toEqual(configuration);
            expect(configuration.manifestVersion).toBe(VERTICAL_CAPABILITY_MANIFEST_VERSION);
            expect(configuration.capabilities).toContain('crm_pipeline');
            expect(configuration.capabilities).toContain('faq_search');
            expect(configuration.toolGroups).toContain('faqs');
            expect(configuration.readiness.enforcement).toBe('advisory');
            expect(configuration.routes.every((route) => route.startsWith('/admin/'))).toBe(true);

            for (const values of [
                configuration.capabilities,
                configuration.toolGroups,
                configuration.routes,
                configuration.readiness.requirements,
                configuration.events,
                configuration.kpiContract.dashboard,
                configuration.kpiContract.verticalAnalytics.metrics,
            ]) {
                expect(new Set(values).size).toBe(values.length);
            }

            const verticalAnalytics = configuration.kpiContract.verticalAnalytics;
            expect(verticalAnalytics.availability === 'implemented')
                .toBe(verticalAnalytics.metrics.length > 0);
        }
    });

    it('rejects unknown identifiers instead of falling back to another vertical', () => {
        expect(() => resolveVerticalCapabilityManifest('inventada', null))
            .toThrow('Unknown vertical capability manifest industry');
        expect(() => resolveVerticalCapabilityManifest('turismo', 'crucero'))
            .toThrow('Unknown vertical capability manifest subtype');
    });

    it('keeps current subtype branches and assurance limits explicit', () => {
        const hotel = resolveVerticalCapabilityManifest('turismo', 'hotel');
        expect(hotel.capabilities).toContain('nightly_booking');
        expect(hotel.capabilities).not.toContain('appointment_booking');
        expect(hotel.toolGroups).toContain('properties');
        expect(hotel.toolGroups).not.toContain('appointments');
        expect(hotel.primaryObject).toBe('property_booking');

        const petHotel = resolveVerticalCapabilityManifest('pet_services', 'hotel');
        expect(petHotel.capabilities).toContain('appointment_booking');
        expect(petHotel.toolGroups).toContain('petServices');

        const pharmacy = resolveVerticalCapabilityManifest('salud', 'farmacia');
        expect(pharmacy.capabilities).toEqual(expect.arrayContaining(['catalog_search']));
        expect(pharmacy.capabilities).not.toContain('appointment_booking');

        const darkKitchen = resolveVerticalCapabilityManifest('restaurantes', 'dark_kitchen');
        expect(darkKitchen.capabilities).toContain('restaurant_ordering');
        expect(darkKitchen.capabilities).not.toContain('appointment_booking');

        // Compatibility profiles stay resolvable without becoming part of the
        // advertised 75/76 catalog contract.
        expect(resolveVerticalCapabilityManifest('moda_belleza', 'boutique').capabilities)
            .toContain('catalog_search');
        expect(resolveVerticalCapabilityManifest('restaurantes', 'delivery').capabilities)
            .not.toContain('appointment_booking');

        const insurance = resolveVerticalCapabilityManifest('seguros', 'broker');
        expect(insurance.assurance).toEqual({
            minimum: 'A0',
            enforcedActions: {
                check_policy_status: 'A2',
                file_claim: 'A2',
                list_my_claims: 'A2',
            },
        });

        expect(resolveVerticalCapabilityManifest('salud', 'dental').assurance.enforcedActions)
            .toMatchObject({ get_treatment_plan: 'A2', list_upcoming_sessions: 'A2' });
        expect(resolveVerticalCapabilityManifest('moda_belleza', 'spa').assurance.enforcedActions)
            .toMatchObject({ get_treatment_plan: 'A2', list_upcoming_sessions: 'A2' });
        expect(resolveVerticalCapabilityManifest('veterinaria', 'clinica_general').assurance.enforcedActions)
            .toMatchObject({ get_vaccination_status: 'A2' });
        expect(resolveVerticalCapabilityManifest('servicios_profesionales', 'abogados').assurance.enforcedActions)
            .toMatchObject({ get_case_status: 'A2' });
        expect(resolveVerticalCapabilityManifest('turismo', 'hotel').assurance.enforcedActions)
            .toMatchObject({ get_check_in_instructions: 'A2' });
    });

    it('publishes a non-empty implemented analytics contract for all 18 verticals', () => {
        const implemented = VERTICAL_MANIFEST_INDUSTRIES.filter((industry) => (
            VERTICAL_CAPABILITY_MANIFEST[industry]
                .profile.kpiContract.verticalAnalytics.availability === 'implemented'
        ));
        expect(implemented).toEqual(VERTICAL_MANIFEST_INDUSTRIES);
    });
});
