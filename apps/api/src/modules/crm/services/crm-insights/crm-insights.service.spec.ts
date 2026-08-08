import type { OutcomeEvaluationCertification } from '../../../../common/policies/ai-decision-readiness.policy';
import { CrmInsightsService } from './crm-insights.service';

describe('CrmInsightsService NBA readiness', () => {
    const evaluation: OutcomeEvaluationCertification = {
        outcome: 'crm_lead_next_best_action',
        suiteVersion: 'lead-nba-v1',
        evaluatedAt: new Date(Date.now() - 60_000).toISOString(),
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        passed: true,
        sampleSize: 50,
        minimumSampleSize: 50,
    };

    function harness() {
        const lead = {
            id: 'lead-1', first_name: 'Ana', last_name: 'Luz', stage: 'qualified', score: 8,
            created_at: new Date(Date.now() - 86_400_000), updated_at: new Date(Date.now() - 1_000),
        };
        const prisma = {
            executeInTenantSchema: jest.fn()
                .mockResolvedValueOnce([lead])
                .mockResolvedValueOnce([{ cnt: 2, last_message_at: new Date(Date.now() - 1_000) }]),
        };
        const redis = {
            get: jest.fn().mockResolvedValue('tenant_test'),
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
        };
        const llm = { execute: jest.fn().mockResolvedValue({
            content: '{"action":"Agendar demo","reasoning":"Alta intención"}',
        }) };
        const service = new CrmInsightsService(prisma as any, redis as any, llm as any);
        return { service, redis, llm };
    }

    it('cannot serve a legacy cache or call the model without an outcome eval', async () => {
        const { service, redis, llm } = harness();
        redis.getJson.mockResolvedValue({ action: 'stale', reasoning: 'legacy' });
        await expect(service.getInsight('tenant-1', 'lead-1')).resolves.toBeNull();
        expect(redis.getJson).not.toHaveBeenCalled();
        expect(llm.execute).not.toHaveBeenCalled();
    });

    it('generates only after lineage freshness and matching eval pass', async () => {
        const { service, llm } = harness();
        await expect(service.getInsight('tenant-1', 'lead-1', evaluation)).resolves.toEqual({
            action: 'Agendar demo', reasoning: 'Alta intención',
        });
        expect(llm.execute).toHaveBeenCalledTimes(1);
    });
});
