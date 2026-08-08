import { loadFactoryPlanContracts } from './factory-plan-contracts';
import {
    getVerticalContractLocales,
    runVerticalContractMatrix,
    summarizeVerticalContractMatrix,
    VERTICAL_CONTRACT_LAYER,
} from './vertical-contract-matrix';
import { VERTICAL_REGISTRY } from '../verticals/vertical-definitions';

describe('vertical contract/static matrix', () => {
    it('derives the real dimensions without duplicated configuration, locale, or plan lists', () => {
        const plans = loadFactoryPlanContracts();
        const locales = getVerticalContractLocales();

        expect(plans).toHaveLength(5);
        expect(new Set(plans.map((plan) => plan.slug)).size).toBe(plans.length);
        expect(locales).toHaveLength(4);
        expect(new Set(locales).size).toBe(locales.length);
    });

    it('executes exactly 76 × 4 × 5 = 1,520 deterministic scenarios', () => {
        const report = runVerticalContractMatrix();

        expect(report.layer).toBe(VERTICAL_CONTRACT_LAYER);
        expect(report.bootstrapCertified).toBe(false);
        expect(report.sources.productPolicyVersion).toBe(1);
        expect(report.dimensions).toEqual({ configurations: 76, locales: 4, plans: 5 });
        expect(report.scenarios).toHaveLength(1_520);
        expect(new Set(report.scenarios.map((scenario) => scenario.id)).size).toBe(1_520);
        expect(report.summary).toEqual({
            scenarios: 1_520,
            passed: 1_520,
            failed: 0,
            failureCount: 0,
        });

        const compact = summarizeVerticalContractMatrix(report);
        expect(compact).not.toHaveProperty('scenarios');
        expect(compact.failures).toEqual([]);
    });

    it('requires an explicit won and lost terminal outcome in every canonical pipeline', () => {
        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY)) {
            const outcomes = new Set(
                definition.pipeline.stages
                    .filter((stage) => stage.isTerminal)
                    .map((stage) => stage.terminalOutcome),
            );
            expect({ industry, outcomes: [...outcomes].sort() }).toEqual({
                industry,
                outcomes: ['lost', 'won'],
            });
        }
    });
});
