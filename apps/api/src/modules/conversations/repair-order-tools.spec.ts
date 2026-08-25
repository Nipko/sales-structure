import { resolveVerticalCapabilityManifest } from '@parallext/shared';
import { VERTICAL_TOOL_CAPABILITY } from '../../common/contracts/vertical-capability-tools';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { REPAIR_ORDER_TOOLS } from './tools/repair-order-tools';
import { TOOL_POLICY_REGISTRY, isRegisteredStaticTool } from './tool-policy-registry';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const schemaName = 'tenant_workshop';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const orderId = '44444444-4444-4444-8444-444444444444';

function createExecutor(repairOrders: any) {
    const control = {
        preflight: jest.fn().mockResolvedValue({
            allowed: true,
            idempotencyKey: 'ledger-repair-1',
        }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const stub = () => ({}) as any;
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: jest.fn(), executeInTenantSchema: jest.fn().mockResolvedValue([]) } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
    );
    (executor as any).repairOrders = repairOrders;
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, control };
}

describe('repair-order tool contract', () => {
    const names = REPAIR_ORDER_TOOLS.map(tool => tool.name);

    it('registers every tool under central policy and keeps writers out of Agent Test', () => {
        for (const name of names) {
            expect(isRegisteredStaticTool(name)).toBe(true);
            expect(TOOL_POLICY_REGISTRY[name]).toBeDefined();
        }
        for (const name of ['create_repair_order', 'approve_repair', 'cancel_repair_order']) {
            const policy = TOOL_POLICY_REGISTRY[name];
            expect(policy.effect).toBe('write');
            expect(policy.confirmation).toBe('runtime_enforced');
            expect(policy.idempotency).not.toBe('missing');
            expect(policy.assuranceEnforcement).not.toBe('missing');
            expect(policy.agentTestAllowed).toBe(false);
        }
    });

    it('requires a VIN or plate in the published intake schema', () => {
        const create = REPAIR_ORDER_TOOLS.find(tool => tool.name === 'create_repair_order')!;
        expect(create.parameters.required).toEqual(['make', 'model', 'customerConcern']);
        expect(create.parameters.anyOf).toEqual([
            { required: ['vin'] },
            { required: ['licensePlate'] },
        ]);
        expect(create.description).toContain('NEVER turn symptoms into a diagnosis');
    });

    it('gives Taller a native repair register and removes dealership inventory', () => {
        const workshop = resolveVerticalCapabilityManifest('automotriz', 'taller');
        expect(workshop.capabilities).toContain('repair_orders');
        expect(workshop.toolGroups).toContain('repairOrders');
        expect(workshop.primaryObject).toBe('repair_order');
        expect(workshop.routes).toContain('/admin/repair-orders');
        expect(workshop.capabilities).not.toContain('vehicle_inventory');
        expect(workshop.toolGroups).not.toContain('vehicles');
        expect(VERTICAL_TOOL_CAPABILITY.repairOrders).toBe('repair_orders');
    });
});

describe('agent workshop runtime', () => {
    it('opens a repair order with the central ledger idempotency key and exposes its human route', async () => {
        const repairOrders = {
            create: jest.fn().mockResolvedValue({
                id: orderId,
                status: 'intake',
                customer_concern: 'Vibra al frenar',
                vehicle: { make: 'Mazda', model: '3', license_plate: 'ABC123' },
            }),
        };
        const { executor, control } = createExecutor(repairOrders);

        const result: any = await executor.execute(
            schemaName,
            tenantId,
            contactId,
            'create_repair_order',
            {
                make: 'Mazda', model: '3', licensePlate: 'ABC123',
                customerConcern: 'Vibra al frenar', reportedSymptoms: ['vibración'],
            },
            conversationId,
            { authority: authorityFor('create_repair_order') },
        );

        expect(control.preflight).toHaveBeenCalled();
        expect(repairOrders.create).toHaveBeenCalledWith(
            schemaName,
            expect.objectContaining({
                contactId,
                customerConcern: 'Vibra al frenar',
                idempotencyKey: 'ledger-repair-1',
                vehicle: expect.objectContaining({ licensePlate: 'ABC123' }),
            }),
            { type: 'agent' },
        );
        expect(result).toMatchObject({
            success: true,
            repairOrderId: orderId,
            activeObject: {
                kind: 'repair_order',
                id: orderId,
                href: '/admin/repair-orders',
            },
        });
    });

    it('lists and gets orders only through contact-scoped service reads', async () => {
        const repairOrders = {
            list: jest.fn().mockResolvedValue({
                items: [{
                    id: orderId, status: 'awaiting_approval', approval_status: 'pending',
                    customer_concern: 'Vibra al frenar', estimate_amount_cents: 125000,
                    currency: 'COP', make: 'Mazda', model: '3', license_plate: 'ABC123',
                }],
                total: 1,
            }),
            get: jest.fn().mockResolvedValue({
                id: orderId, status: 'awaiting_approval', approval_status: 'pending',
                customer_concern: 'Vibra al frenar', estimate_amount_cents: 125000,
                currency: 'COP', make: 'Mazda', model: '3', license_plate: 'ABC123', events: [],
            }),
        };
        const { executor } = createExecutor(repairOrders);

        const listed: any = await executor.execute(
            schemaName, tenantId, contactId, 'list_my_repair_orders', {}, conversationId,
            { authority: authorityFor('list_my_repair_orders') },
        );
        const detail: any = await executor.execute(
            schemaName, tenantId, contactId, 'get_repair_order', { repairOrderId: orderId }, conversationId,
            { authority: authorityFor('get_repair_order') },
        );

        expect(repairOrders.list).toHaveBeenCalledWith(schemaName, { contactId, limit: 20 });
        expect(repairOrders.get).toHaveBeenCalledWith(schemaName, orderId, contactId);
        expect(listed.repairOrders).toHaveLength(1);
        expect(detail.repairOrder.customerConcern).toBe('Vibra al frenar');
        expect(detail.repairOrder.diagnosisSummary).toBeUndefined();
    });

    it('records only the customer decision and cannot author or replace an estimate', async () => {
        const repairOrders = {
            decideEstimate: jest.fn().mockResolvedValue({
                id: orderId,
                status: 'approved',
                approval_status: 'approved',
                estimate_amount_cents: 125000,
                currency: 'COP',
            }),
        };
        const { executor } = createExecutor(repairOrders);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'approve_repair',
            { repairOrderId: orderId, accepted: true, amountCents: 1 },
            conversationId,
            { authority: authorityFor('approve_repair') },
        );

        expect(repairOrders.decideEstimate).toHaveBeenCalledWith(
            schemaName, orderId, contactId, true, 'agent',
        );
        expect(result).toMatchObject({
            success: true,
            repairOrderId: orderId,
            status: 'approved',
            estimateAmountCents: 125000,
        });
    });

    it('uses the owner-scoped cancellation path', async () => {
        const repairOrders = {
            cancelOwned: jest.fn().mockResolvedValue({ id: orderId, status: 'cancelled' }),
        };
        const { executor } = createExecutor(repairOrders);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'cancel_repair_order',
            { repairOrderId: orderId, reason: 'Ya no lo necesito' },
            conversationId,
            { authority: authorityFor('cancel_repair_order') },
        );

        expect(repairOrders.cancelOwned).toHaveBeenCalledWith(
            schemaName, orderId, contactId, 'Ya no lo necesito',
        );
        expect(result).toMatchObject({ success: true, repairOrderId: orderId, status: 'cancelled' });
    });
});
