import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

describe('OrdersService transactional catalog contract', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const orderId = '33333333-3333-4333-8333-333333333333';
    const contactId = '44444444-4444-4444-8444-444444444444';
    const conversationId = '55555555-5555-4555-8555-555555555555';
    const opportunityId = '66666666-6666-4666-8666-666666666666';

    function setup(query: jest.Mock) {
        const prisma = {
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const redis = {
            get: jest.fn(async (key: string) => key === `tenant:${tenantId}:schema` ? 'tenant_demo' : 'true'),
            set: jest.fn(),
        };
        return {
            service: new OrdersService(prisma as any, redis as any),
            prisma,
        };
    }

    it('omits tenant-wide revenue aggregates from the operational agent view', async () => {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('FROM orders o')) {
                return [{
                    id: orderId,
                    contact_id: contactId,
                    contact_name: 'Cliente',
                    status: 'paid',
                    total_amount: '25000',
                    currency: 'COP',
                    metadata: {},
                    created_at: new Date('2026-08-11T00:00:00Z'),
                    updated_at: new Date('2026-08-11T00:00:00Z'),
                }];
            }
            if (sql.includes('FROM order_items')) return [];
            return [];
        });
        const service = new OrdersService({ executeInTenantSchema } as any, {
            get: jest.fn(async (key: string) => key === `tenant:${tenantId}:schema` ? 'tenant_demo' : 'ready'),
            set: jest.fn(),
        } as any);

        await expect(service.getOverview(tenantId, false)).resolves.toMatchObject({
            totalRevenue: 0,
            pendingRevenue: 0,
            financialsVisible: false,
            orderCount: 1,
            orders: [expect.objectContaining({ id: orderId, totalAmount: 25000 })],
        });
    });

    it('reports an unavailable overview instead of inventing empty successful data',async()=>{
        const service=new OrdersService({executeInTenantSchema:jest.fn().mockRejectedValue(new Error('database unavailable'))} as any,
            {get:async(key:string)=>key.includes(':schema')?'tenant_demo':'ready'} as any);
        await expect(service.getOverview(tenantId)).rejects.toThrow('database unavailable');
    });
    it('blocks unauthorized administrative cancellation before entering the domain writer',async()=>{
        const query=jest.fn(),{service,prisma}=setup(query);
        await expect(service.updateOrderStatus(tenantId,orderId,'cancelled','tenant_agent')).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
