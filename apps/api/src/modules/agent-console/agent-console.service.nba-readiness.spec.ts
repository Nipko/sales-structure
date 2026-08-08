import type { OutcomeEvaluationCertification } from '../../common/policies/ai-decision-readiness.policy';
import { AgentConsoleService } from './agent-console.service';

describe('AgentConsoleService NBA readiness', () => {
    const evaluation: OutcomeEvaluationCertification = {
        outcome: 'conversation_next_best_action',
        suiteVersion: 'conversation-nba-v1',
        evaluatedAt: new Date(Date.now() - 60_000).toISOString(),
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        passed: true,
        sampleSize: 50,
        minimumSampleSize: 50,
    };

    function harness() {
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue([{
                id: 'message-1', content_text: 'Necesito una demo', direction: 'inbound',
                created_at: new Date(Date.now() - 1_000),
            }]),
        };
        const redis = { get: jest.fn().mockResolvedValue('tenant_test') };
        const llm = { execute: jest.fn().mockResolvedValue({ content: 'Agenda la demo.' }) };
        const service = new AgentConsoleService(
            prisma as any, redis as any, {} as any, {} as any, {} as any,
            llm as any, {} as any, {} as any,
        );
        return { service, prisma, llm };
    }

    it('does not call the model without a current outcome evaluation', async () => {
        const { service, llm } = harness();
        await expect(service.nextBestAction('tenant-1', 'conversation-1')).resolves.toBe('');
        expect(llm.execute).not.toHaveBeenCalled();
    });

    it('allows a freshly sourced projection with a matching evaluation', async () => {
        const { service, llm } = harness();
        await expect(service.nextBestAction('tenant-1', 'conversation-1', evaluation))
            .resolves.toBe('Agenda la demo.');
        expect(llm.execute).toHaveBeenCalledTimes(1);
    });
});
