import {
    resolveVerticalProductPolicy,
    VERTICAL_CERTIFICATION_ANCHORS,
    VERTICAL_MANIFEST_INDUSTRIES,
    VERTICAL_PRODUCT_POLICY,
    VERTICAL_PRODUCT_POLICY_VERSION,
} from '@parallext/shared';

describe('Vertical product policy v1', () => {
    it('publishes one honest, uncertified mode for every canonical vertical', () => {
        expect(VERTICAL_PRODUCT_POLICY_VERSION).toBe(1);
        expect(Object.keys(VERTICAL_PRODUCT_POLICY)).toEqual([...VERTICAL_MANIFEST_INDUSTRIES]);
        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            expect(resolveVerticalProductPolicy(industry)).toEqual(VERTICAL_PRODUCT_POLICY[industry]);
            expect(VERTICAL_PRODUCT_POLICY[industry].certificationState)
                .toBe('implemented_not_certified');
            expect(VERTICAL_PRODUCT_POLICY[industry].deepMarketingAllowed).toBe(false);
        }
    });

    it('adopts restaurants, tourism and home services as the first certification cohort', () => {
        expect(VERTICAL_CERTIFICATION_ANCHORS).toEqual([
            'restaurantes',
            'turismo',
            'servicios_hogar',
        ]);
        for (const industry of VERTICAL_CERTIFICATION_ANCHORS) {
            expect(VERTICAL_PRODUCT_POLICY[industry].mode).toBe('certification_anchor');
        }
    });

    it('keeps finance, technology and professional services horizontal and otro generic', () => {
        for (const industry of ['finanzas', 'technology', 'servicios_profesionales'] as const) {
            expect(VERTICAL_PRODUCT_POLICY[industry].mode).toBe('horizontal_preset');
        }
        expect(VERTICAL_PRODUCT_POLICY.otro.mode).toBe('generic_fallback');
        expect(() => resolveVerticalProductPolicy('inventada')).toThrow('Unknown vertical product policy');
    });
});
