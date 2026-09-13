import { ProceduresService } from './procedures.service';

it('keeps authored ask validation and tool slot types through compilation and storage', async () => {
    const compiled = {
        name: 'Receipt', trigger: { keywords: ['receipt'] }, steps: [
            { id: 'ask', type: 'ask', config: { field: 'email', fieldType: 'email', required: true, explanation: 'Send the receipt.', question: 'Email?' } },
            { id: 'tool', type: 'tool', config: { tool: 'get_order_status', args: { orderId: '{{ order }}' }, slots: { orderId: { type: 'uuid', required: true } } } },
        ],
    };
    let savedSteps: unknown;
    const prisma = {
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_test'),
        executeInTenantSchema: jest.fn(async (_schema, _sql, params) => {
            savedSteps = JSON.parse(params[3]);
            return [{ id: 'id', name: params[0], trigger: JSON.parse(params[2]), steps: savedSteps, status: 'draft', version: 1 }];
        }),
    };
    const service = new ProceduresService(prisma as any, { get: async () => true, del: async () => undefined } as any, { execute: async () => ({ content: JSON.stringify(compiled) }) } as any);
    const result = await service.compile('tenant', 'Ask for the receipt email and find the order.');
    expect(savedSteps).toEqual(compiled.steps);
    expect(result.steps).toEqual(compiled.steps);
    expect(result.status).toBe('draft');
});
