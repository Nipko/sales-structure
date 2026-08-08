import {
    createFreshLineage,
    evaluateAiDecisionReadiness,
    type OutcomeEvaluationCertification,
} from './ai-decision-readiness.policy';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const EVAL: OutcomeEvaluationCertification = {
    outcome: 'conversation_next_best_action',
    suiteVersion: 'nba-conversation-v1',
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    validUntil: '2026-09-01T00:00:00.000Z',
    passed: true,
    sampleSize: 100,
    minimumSampleSize: 100,
};

describe('AI decision readiness policy', () => {
    it('requires lineage, freshness and an outcome-matched passing evaluation', () => {
        const result = evaluateAiDecisionReadiness({
            outcome: 'conversation_next_best_action',
            now: NOW,
            evaluation: EVAL,
            lineage: [createFreshLineage(
                'tenant.messages', 'message-1', NOW, '2026-08-01T00:00:00.000Z', 60_000,
            )],
        });
        expect(result).toEqual({ allowed: true, reasons: [] });
    });

    it('fails closed on missing evals, mismatched outcomes and stale evidence', () => {
        const missing = evaluateAiDecisionReadiness({
            outcome: 'conversation_next_best_action', lineage: [], now: NOW,
        });
        expect(missing.allowed).toBe(false);
        expect(missing.reasons).toEqual(expect.arrayContaining([
            'outcome_evaluation_missing', 'lineage_missing',
        ]));

        const invalid = evaluateAiDecisionReadiness({
            outcome: 'crm_lead_next_best_action',
            now: NOW,
            evaluation: EVAL,
            lineage: [{
                source: 'tenant.leads', recordId: 'lead-1',
                readAt: '2026-08-08T11:00:00.000Z',
                freshUntil: '2026-08-08T11:01:00.000Z',
            }],
        });
        expect(invalid.allowed).toBe(false);
        expect(invalid.reasons).toEqual(expect.arrayContaining([
            'outcome_evaluation_mismatch', 'lineage_0_stale',
        ]));
    });
});
