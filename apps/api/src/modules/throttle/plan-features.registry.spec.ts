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

describe('commercial feature domains', () => {
    it.each([{llmTier:'premium'}, {maxContacts:-2}, {maxChannelAccounts:{whatsapp:-2}},
        {rateLimits:{outbound:-100}}, {rateLimits:{priority:0}}, {channels:['email']},
        {channels:['whatsapp','whatsapp']}, {llmHardBudgetUsdCents:1.5},
        {llmHardBudgetUsdCents:100,llmCostBudgetUsdCents:101}])('rejects unsafe limits %p', features => {
        expect(validatePlanFeatures(features).typeErrors.length).toBeGreaterThan(0);
    });
});
