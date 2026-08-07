import { getVerticalDefinition, VERTICAL_REGISTRY } from './vertical-definitions';
import {
    InvalidVerticalSelectionError,
    resolveVerticalSelection,
    VERTICAL_IDENTIFIER_CONTRACT_VERSION,
} from './vertical-identifiers';

describe('resolveVerticalSelection', () => {
    it('publishes a versioned identifier contract', () => {
        expect(VERTICAL_IDENTIFIER_CONTRACT_VERSION).toBe(1);
    });

    it('accepts every canonical industry/subtype pair in the registry', () => {
        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY)) {
            if (definition.subTypes.length === 0) {
                expect(resolveVerticalSelection(industry)).toEqual({ industry, subType: null });
                continue;
            }

            for (const subType of definition.subTypes) {
                expect(resolveVerticalSelection(industry, subType.key)).toEqual({
                    industry,
                    subType: subType.key,
                });
            }
        }
    });

    it.each([
        ['educacion', 'idiomas', 'education'],
        ['restaurante', 'cafeteria', 'restaurantes'],
        ['belleza', 'spa', 'moda_belleza'],
        ['hogar', 'plomeria', 'servicios_hogar'],
        ['servicios-mascotas', 'hotel', 'pet_services'],
        ['ecommerce', 'marketplace', 'retail'],
        ['tecnologia', 'saas', 'technology'],
        ['other', undefined, 'otro'],
    ])('canonicalizes %s/%s to %s', (input, subType, expectedIndustry) => {
        expect(resolveVerticalSelection(input, subType)).toEqual({
            industry: expectedIndustry,
            subType: subType ?? null,
        });
    });

    it('maps the legacy finanzas/seguros pair to the complete insurance vertical', () => {
        expect(resolveVerticalSelection('finanzas', 'seguros')).toEqual({
            industry: 'seguros',
            subType: 'broker',
        });
    });

    it.each([
        ['', undefined],
        ['inventada', 'algo'],
        ['pet_services', 'tienda'],
        ['otro', 'general'],
        ['salud', undefined],
    ])('rejects an invalid pair (%s/%s)', (industry, subType) => {
        expect(() => resolveVerticalSelection(industry, subType))
            .toThrow(InvalidVerticalSelectionError);
    });

    it('never silently falls back to the generic vertical', () => {
        expect(() => getVerticalDefinition('inventada'))
            .toThrow('Unknown vertical definition: inventada');
    });
});
