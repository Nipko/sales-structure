import { AIToolExecutorService } from './ai-tool-executor.service';

const schemaName = 'tenant_executor_controls';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function createExecutor(
    control: any,
    options: { paymentOperations?: any; omitPaymentOperations?: boolean } = {},
) {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    const defaultPaymentOperations = {
        createPaymentLink: jest.fn(),
        refundPayment: jest.fn(),
        applyDiscount: jest.fn(),
    };
    const paymentOperations = options.omitPaymentOperations
        ? undefined
        : options.paymentOperations || defaultPaymentOperations;
    const executor = new AIToolExecutorService(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        control,
        paymentOperations as any,
        {} as any,
    );
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, prisma, paymentOperations };
}

describe('AIToolExecutorService central authority boundary', () => {
    it.each([
        ['authority control', undefined, {}],
        ['payment ledger', { preflight: jest.fn() }, { omitPaymentOperations: true }],
    ])('fails closed when required %s wiring is absent', async (_dependency, control, options) => {
        const { executor, prisma } = createExecutor(control, options);

        await expect(executor.execute(
            schemaName,
            tenantId,
            contactId,
            'list_services',
            {},
            conversationId,
        )).resolves.toEqual({
            error: 'tool_control_wiring_unavailable',
            message: 'Los controles de ejecución no están disponibles. La acción no puede continuar.',
            shouldHandoff: true,
        });
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('returns a guard decision before the handler switch', async () => {
        const control = {
            preflight: jest.fn().mockResolvedValue({
                allowed: false,
                result: { error: 'confirmation_required' },
            }),
            complete: jest.fn(),
            fail: jest.fn(),
        };
        const { executor, prisma } = createExecutor(control);

        const result = await executor.execute(
            schemaName,
            tenantId,
            contactId,
            'list_services',
            {},
            conversationId,
        );

        expect(result).toEqual({ error: 'confirmation_required' });
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(control.complete).not.toHaveBeenCalled();
    });

    it('commits a successful handler result to the ledger before returning it', async () => {
        const decision = {
            allowed: true,
            policy: { externalEffect: 'none' },
            ledgerId: '44444444-4444-4444-8444-444444444444',
            idempotencyKey: 'idem-1',
        };
        const control = {
            preflight: jest.fn().mockResolvedValue(decision),
            complete: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn(),
        };
        const { executor } = createExecutor(control);

        const result = await executor.execute(
            schemaName,
            tenantId,
            contactId,
            'list_services',
            {},
            conversationId,
        );

        expect(result).toEqual({ services: [] });
        expect(control.complete).toHaveBeenCalledWith(schemaName, decision, { services: [] });
    });

    it('fails closed when the post-handler ledger commit fails', async () => {
        const decision = {
            allowed: true,
            policy: { externalEffect: 'provider_write' },
            ledgerId: '44444444-4444-4444-8444-444444444444',
        };
        const control = {
            preflight: jest.fn().mockResolvedValue(decision),
            complete: jest.fn().mockRejectedValue(new Error('db unavailable')),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const { executor } = createExecutor(control);

        const result = await executor.execute(
            schemaName,
            tenantId,
            contactId,
            'list_services',
            {},
            conversationId,
        );

        expect(result).toEqual({
            error: 'tool_failed',
            message: 'No se pudo completar esta acción en este momento.',
        });
        expect(control.fail).toHaveBeenCalledWith(schemaName, decision, 'tool_execution_failed');
    });

    it('never enters the payment handler when A3 assurance is denied', async () => {
        const control = {
            preflight: jest.fn().mockResolvedValue({
                allowed: false,
                result: { error: 'identity_verification_required' },
            }),
            complete: jest.fn(),
            fail: jest.fn(),
        };
        const { executor, paymentOperations } = createExecutor(control);

        const result = await executor.execute(
            schemaName,
            tenantId,
            contactId,
            'create_payment_link',
            { amountCents: 1000, currency: 'USD', description: 'Deposit', externalReference: 'order:1' },
            conversationId,
        );

        expect(result).toEqual({ error: 'identity_verification_required' });
        expect(paymentOperations.createPaymentLink).not.toHaveBeenCalled();
    });
});
