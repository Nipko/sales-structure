import type { ProcedureDefinition, ProcedureRunState } from '@parallext/shared';
import { ProcedureEngineService } from './procedure-engine.service';

const schemaName = 'tenant_procedure_control';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const procedureId = '44444444-4444-4444-8444-444444444444';

const procedure: ProcedureDefinition = {
    id: procedureId,
    name: 'Writer control regression',
    trigger: { keywords: ['refund'] },
    status: 'active',
    version: 1,
    steps: [
        {
            id: 'writer',
            type: 'tool',
            config: { tool: 'refund_payment', args: { paymentReference: 'pay-1' }, saveAs: 'refund' },
        },
        { id: 'done', type: 'message', config: { text: 'Refund completed.' } },
    ],
};

function createHarness(toolResult: Record<string, unknown>) {
    const initialState: ProcedureRunState = {
        procedureId,
        version: 1,
        currentStepId: 'writer',
        collected: {},
        awaitingField: null,
        startedAt: '2026-08-08T00:00:00.000Z',
    };
    let savedState: ProcedureRunState | null = null;
    const redis = {
        getJson: jest.fn().mockResolvedValue(initialState),
        setJson: jest.fn(async (_key: string, value: ProcedureRunState) => { savedState = structuredClone(value); }),
        del: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
        executeInTenantSchema: jest.fn().mockResolvedValue([{ ...procedure, steps: procedure.steps }]),
    };
    const toolExecutor = { execute: jest.fn().mockResolvedValue(toolResult) };
    const service = new ProcedureEngineService(prisma as any, redis as any, toolExecutor as any);
    return { service, redis, toolExecutor, getSavedState: () => savedState };
}

describe('ProcedureEngine central writer controls', () => {
    it.each([
        ['confirmation_required', false],
        ['approval_required', true],
    ])('does not advance a writer while %s is pending', async (error, shouldHandoff) => {
        const { service, redis, toolExecutor, getSavedState } = createHarness({
            error,
            message: `Pending ${error}`,
            shouldHandoff,
        });

        const result = await service.process(
            schemaName,
            tenantId,
            conversationId,
            contactId,
            'confirm',
            // El motor ahora compila cada paso contra el agente: sin este
            // contrato ningún paso `tool` puede ejecutarse. `refund_payment` se
            // autoriza porque el tenant tiene pagos habilitados y el paso está
            // escrito a mano, no elegido por el modelo.
            { toolsConfig: { payments: { enabled: true } } },
        );

        expect(result).toMatchObject({
            handled: true,
            completed: false,
            text: `Pending ${error}`,
            handoff: shouldHandoff,
        });
        expect(toolExecutor.execute).toHaveBeenCalledWith(
            schemaName,
            tenantId,
            contactId,
            'refund_payment',
            { paymentReference: 'pay-1' },
            conversationId,
            { channelType: undefined, commitmentBlocked: null },
        );
        expect(getSavedState()).toMatchObject({
            currentStepId: 'writer',
            collected: { refund: { error, message: `Pending ${error}`, shouldHandoff } },
        });
        expect(redis.del).not.toHaveBeenCalled();
    });
});
