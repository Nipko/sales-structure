import {
    applyVerticalAgentDefaults,
    resolveVerticalAgentDefaults,
    VerticalAgentDefaultsError,
} from './vertical-agent-defaults.util';

describe('vertical agent defaults', () => {
    it('migrates a persisted v1 native-operation profile to manifest v2 defaults', () => {
        const defaults = resolveVerticalAgentDefaults({
            verticalConfig: {
                industry: 'turismo',
                subType: 'hotel',
                bookingEnabled: false,
                manifestVersion: 1,
                effectiveCapabilities: ['crm_pipeline', 'faq_search', 'nightly_booking'],
            },
        });

        expect(defaults).toEqual(expect.objectContaining({
            manifestVersion: 2,
            industry: 'turismo',
            subType: 'hotel',
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'nightly_booking'],
            toolDefaults: {
                faqs: { enabled: true },
                properties: { enabled: true },
            },
        }));
        expect(defaults.toolDefaults).not.toHaveProperty('appointments');
    });

    it.each([
        ['moda_belleza', 'boutique', 'catalog'],
        ['restaurantes', 'delivery', 'restaurants'],
    ])('retains legacy %s/%s manifest compatibility', (industry, subType, expectedTool) => {
        const defaults = resolveVerticalAgentDefaults({
            verticalConfig: { industry, subType, bookingEnabled: false },
        });

        expect(defaults.toolDefaults).toHaveProperty(expectedTool, { enabled: true });
        expect(defaults.toolDefaults).not.toHaveProperty('appointments');
    });

    it('preserves every explicit agent value while filling only absent defaults', () => {
        const defaults = resolveVerticalAgentDefaults({
            verticalConfig: {
                industry: 'pet_services',
                subType: 'peluqueria',
                bookingEnabled: true,
                effectiveCapabilities: [
                    'crm_pipeline', 'faq_search', 'appointment_booking',
                    'pet_records', 'pet_services',
                ],
            },
        });
        const result = applyVerticalAgentDefaults({
            capabilities: ['explicit_only'],
            tools: {
                appointments: { enabled: false, canBook: false },
                pets: null,
            },
        }, defaults);

        expect(result.capabilities).toEqual(['explicit_only']);
        expect(result.tools.appointments).toEqual({ enabled: false, canBook: false });
        expect(result.tools.pets).toBeNull();
        expect(result.tools.faqs).toEqual({ enabled: true });
        expect(result.tools.petServices).toEqual({ enabled: true });
    });

    it.each([
        [
            { verticalConfig: { industry: 'restaurantes', subType: 'boutique', bookingEnabled: false } },
            'vertical_manifest_unresolvable',
        ],
        [
            { verticalConfig: { industry: 'restaurantes', bookingEnabled: true } },
            'vertical_subtype_required',
        ],
        [
            { verticalConfig: { industry: 'retail', subType: 'moda', bookingEnabled: false, manifestVersion: 99 } },
            'vertical_manifest_version_unsupported',
        ],
        [
            {
                verticalConfig: {
                    industry: 'retail', subType: 'moda', bookingEnabled: false,
                    effectiveCapabilities: ['catalog_search', 'nightly_booking'],
                },
            },
            'vertical_effective_capabilities_invalid',
        ],
    ])('fails closed for an invalid tenant contract', (settings, reason) => {
        try {
            resolveVerticalAgentDefaults(settings);
            throw new Error('expected vertical resolution to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(VerticalAgentDefaultsError);
            expect((error as VerticalAgentDefaultsError).reason).toBe(reason);
        }
    });
});
