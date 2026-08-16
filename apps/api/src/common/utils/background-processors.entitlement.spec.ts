import { QualityProcessor } from '../../modules/quality/quality.processor';
import { SimulationProcessor } from '../../modules/simulation/simulation.processor';
import { EvalGateProcessor } from '../../modules/simulation/eval-gate.processor';
import { ExternalCrmProcessor } from '../../modules/external-crm/external-crm.processor';
import { CrmImportProcessor } from '../../modules/external-crm/crm-import.processor';

describe('paid background processors subscription boundary', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function lockedPrisma() {
        return {
            tenant: { findUnique: jest.fn().mockResolvedValue({
                isInternal: false,
                subscriptionStatus: 'expired',
                subscription: {
                    status: 'expired', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                },
            }) },
        };
    }

    it.each([
        ['quality scoring', (service: any, prisma: any) => new QualityProcessor(service, prisma),
            { tenantId, conversationId: 'conversation-1' }, 'scoreConversation'],
        ['simulation', (service: any, prisma: any) => new SimulationProcessor(service, prisma),
            { tenantId, runId: 'run-1' }, 'executeRun'],
        ['eval gate', (service: any, prisma: any) => new EvalGateProcessor(service, prisma),
            { tenantId, agentId: 'agent-1', trigger: 'persona_edit' }, 'runGateV2'],
        ['CRM sync', (service: any, prisma: any) => new ExternalCrmProcessor(service, prisma),
            { tenantId, provider: 'hubspot', entity: 'contact', connectionId: 'connection-1' }, 'runJob'],
        ['CRM import', (service: any, prisma: any) => new CrmImportProcessor(service, prisma),
            { tenantId, provider: 'hubspot', importId: 'import-1' }, 'runImport'],
    ] as const)(
        'discards queued %s before executing paid work',
        async (_label, createProcessor, data, method) => {
            const service = { [method]: jest.fn() };
            const processor = createProcessor(service, lockedPrisma());

            await expect(processor.process({ data } as any)).resolves.toMatchObject({
                ok: false,
                skipped: true,
                reason: 'subscription_expired',
            });
            expect(service[method]).not.toHaveBeenCalled();
        },
    );
});
