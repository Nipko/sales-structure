import { BadRequestException } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';

describe('RestaurantsService.createOrder', () => {
    const schemaName = 'tenant_restaurant';
    const orderId = '11111111-1111-4111-8111-111111111111';
    const menuItemOne = '22222222-2222-4222-8222-222222222222';
    const menuItemTwo = '33333333-3333-4333-8333-333333333333';

    const input = {
        contactId: '44444444-4444-4444-8444-444444444444',
        conversationId: '55555555-5555-4555-8555-555555555555',
        orderType: 'delivery' as const,
        deliveryAddress: 'Calle 1 # 2-3',
        items: [
            {
                menuItemId: menuItemOne,
                name: 'Arepa',
                quantity: 2,
                unitPrice: 10,
                currency: 'usd',
                prepTimeMinutes: 12,
            },
            {
                menuItemId: menuItemTwo,
                name: 'Sopa',
                quantity: 1,
                unitPrice: 15,
                currency: 'USD',
                prepTimeMinutes: 20,
            },
        ],
    };

    it('writes the header and every item in one transaction with currency and configured ETA', async () => {
        const estimatedAt = new Date('2026-08-08T18:27:00.000Z');
        const storedItems = input.items.map((item) => ({
            order_id: orderId,
            menu_item_id: item.menuItemId,
            name_snapshot: item.name,
        }));
        const query = jest.fn(async (sql: string, _params: any[]) => {
            if (sql.includes('INSERT INTO food_orders')) {
                return [{
                    id: orderId,
                    order_type: 'delivery',
                    currency: 'USD',
                    total: 35,
                    estimated_delivery_at: estimatedAt,
                }];
            }
            if (sql.includes('INSERT INTO food_order_items')) return [];
            if (sql.includes('SELECT * FROM food_order_items')) return storedItems;
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    settings: {
                        restaurants: {
                            etaBufferMinutes: { delivery: 7 },
                        },
                    },
                }),
            },
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const service = new RestaurantsService(prisma as any);

        const result = await service.createOrder(schemaName, input);

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();

        const headerCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO food_orders'))!;
        expect(headerCall[0]).toContain('currency');
        expect(headerCall[0]).toContain('estimated_delivery_at');
        expect(headerCall[1][12]).toBe('USD');
        expect(headerCall[1][13]).toBe(27); // MAX(12, 20) + delivery buffer 7
        expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO food_order_items')))
            .toHaveLength(2);
        expect(result).toMatchObject({
            id: orderId,
            currency: 'USD',
            estimated_delivery_at: estimatedAt,
            estimated_delivery_minutes: 27,
            items: storedItems,
        });
    });

    it('rejects the whole operation when an item insert fails inside the transaction', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: orderId }])
            .mockRejectedValueOnce(new Error('line item insert failed'));
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const service = new RestaurantsService(prisma as any);

        await expect(service.createOrder(schemaName, input))
            .rejects.toThrow('line item insert failed');

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledTimes(2);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('does not create an order whose catalog items use different currencies', async () => {
        const prisma = {
            tenant: { findUnique: jest.fn() },
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(),
        };
        const service = new RestaurantsService(prisma as any);

        await expect(service.createOrder(schemaName, {
            ...input,
            items: [input.items[0], { ...input.items[1], currency: 'COP' }],
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
