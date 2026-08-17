import { PLAN_FEATURE_REGISTRY, validatePlanFeatures } from './plan-features.registry';

describe('customerPayments plan feature', () => {
    it('is a canonical boolean module feature', () => {
        expect(PLAN_FEATURE_REGISTRY).toContainEqual({
            key: 'customerPayments',
            type: 'boolean',
            category: 'module',
        });
        expect(validatePlanFeatures({ customerPayments: true })).toEqual({
            unknownKeys: [],
            typeErrors: [],
        });
    });

    it('rejects non-boolean values instead of treating them as entitlement', () => {
        expect(validatePlanFeatures({ customerPayments: 'true' })).toEqual({
            unknownKeys: [],
            typeErrors: ['customerPayments expected boolean'],
        });
    });
});
