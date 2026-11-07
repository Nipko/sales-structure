import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * La puerta del plan en la ejecución.
 *
 * Publicar ya retira lo que el plan no incluye, pero sólo alcanza al loop del
 * LLM: el motor de reservas, Procedures, la confirmación server-side y MCP
 * llaman por nombre. Estos casos fijan que la puerta común también lo verifica,
 * y cómo se comporta cuando el plan no se puede leer.
 */

const schemaName = 'tenant_plan_families';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function createExecutor(planFeatures: Record<string, any> | Error | null) {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    // El control responde "pide confirmación": si el caso llega acá, la puerta
    // del plan lo dejó pasar.
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: false, result: { error: 'confirmation_required' } }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const paymentOperations = {
        preparePaymentLink: jest.fn(),
        createPaymentLink: jest.fn(),
        getPaymentStatus: jest.fn().mockResolvedValue({ found: true, paymentStatus: 'pending', paid: false }),
        refundPayment: jest.fn(),
        applyDiscount: jest.fn(),
    };
    // Mismo orden posicional que los demás specs del ejecutor: veinte servicios
    // de dominio sin uso acá, el control, pagos y fotografía.
    const stubs = Array.from({ length: 20 }, () => ({}));
    const Executor = AIToolExecutorService as unknown as new (...args: unknown[]) => AIToolExecutorService;
    const executor = new Executor(prisma, ...stubs, control, paymentOperations, {});
    const throttle = planFeatures === null ? undefined : {
        getPlanFeatures: planFeatures instanceof Error
            ? jest.fn().mockRejectedValue(planFeatures)
            : jest.fn().mockResolvedValue(planFeatures),
    };
    (executor as any).planThrottle = throttle;
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, control, paymentOperations, throttle, warn, prisma };
}

const run = (executor: AIToolExecutorService, tool: string, args: Record<string, any> = {}) =>
    executor.execute(schemaName, tenantId, contactId, tool, args, conversationId, { authority: authorityFor(tool) });

describe('AIToolExecutorService: familias de tools por plan', () => {
    it('rechaza una tool cuya familia el plan excluye, sin ejecutarla', async () => {
        const f = createExecutor({ toolFamilies: ['faqs'] });

        const result = await run(f.executor, 'list_services');

        expect(result).toEqual(expect.objectContaining({
            error: 'plan_excludes_tool_family',
            tool: 'list_services',
            family: 'appointments',
            controlBlocked: true,
            persisted: false,
            shouldHandoff: true,
        }));
        expect(typeof result.message).toBe('string');
        expect(f.throttle!.getPlanFeatures).toHaveBeenCalledWith(tenantId, undefined);
        expect(f.control.preflight).not.toHaveBeenCalled();
        expect(f.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it.each([
        ['la familia está en la lista', { toolFamilies: ['appointments'] }],
        ['el plan no tiene lista (sin límite)', {}],
        ['la lista es null', { toolFamilies: null }],
    ])('deja pasar cuando %s', async (_case, features) => {
        const f = createExecutor(features);
        await expect(run(f.executor, 'list_services')).resolves.toEqual({ error: 'confirmation_required' });
        expect(f.control.preflight).toHaveBeenCalled();
    });

    it('sin servicio de plan inyectado (specs a mano) no hay puerta de plan', async () => {
        const f = createExecutor(null);
        await expect(run(f.executor, 'list_services')).resolves.toEqual({ error: 'confirmation_required' });
    });

    it('si el plan no se puede leer, una familia que no es pagos falla abierta con un aviso por minuto', async () => {
        const f = createExecutor(new Error('redis down'));

        await expect(run(f.executor, 'list_services')).resolves.toEqual({ error: 'confirmation_required' });
        await expect(run(f.executor, 'list_services')).resolves.toEqual({ error: 'confirmation_required' });

        const planWarnings = f.warn.mock.calls.filter(([message]) => String(message).includes('plan no disponible'));
        expect(planWarnings).toHaveLength(1);
    });

    it('si el plan no se puede leer, pagos falla cerrado', async () => {
        const f = createExecutor(new Error('redis down'));

        const result = await run(f.executor, 'create_payment_link', { payableReference: 'order:11111111-1111-4111-8111-111111111111' });

        expect(result).toEqual(expect.objectContaining({
            error: 'plan_unavailable', family: 'payments', controlBlocked: true, persisted: false,
        }));
        expect(f.paymentOperations.preparePaymentLink).not.toHaveBeenCalled();
        expect(f.paymentOperations.createPaymentLink).not.toHaveBeenCalled();
    });

    it('un plan sin pagos en la lista no cobra, pero el estado de un pago ya emitido se sigue leyendo', async () => {
        const f = createExecutor({ customerPayments: true, toolFamilies: ['faqs'] });

        const refused = await run(f.executor, 'create_payment_link', { payableReference: 'order:11111111-1111-4111-8111-111111111111' });
        expect(refused).toEqual(expect.objectContaining({ error: 'plan_excludes_tool_family', family: 'payments' }));
        expect(f.paymentOperations.createPaymentLink).not.toHaveBeenCalled();

        f.control.preflight.mockResolvedValue({ allowed: true, policy: { effect: 'read', externalEffect: 'provider_read' } } as any);
        const status = await run(f.executor, 'get_payment_status', { payableReference: 'order:11111111-1111-4111-8111-111111111111' });
        expect(status).toEqual({ found: true, paymentStatus: 'pending', paid: false });
    });
});
