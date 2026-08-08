import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

describe('OrdersService transactional catalog contract', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const orderId = '33333333-3333-4333-8333-333333333333';
    const contactId = '44444444-4444-4444-8444-444444444444';

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

    it('uses the locked catalog snapshot and commits header, line and stock together', async () => {
        const query: jest.Mock = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
                return [{ id: productId, name: 'Producto real', price: '12500', currency: 'COP', stock: 7, is_available: true }];
            }
            if (sql.includes('INSERT INTO orders')) return [{ id: orderId }];
            if (sql.includes('UPDATE products')) return [{ stock: 5 }];
            return [];
        });
        const { service, prisma } = setup(query);

        await expect(service.createOrder(tenantId, {
            contactId,
            items: [{ productId, productName: 'Nombre manipulado', quantity: 2, unitPrice: 1 }],
        })).resolves.toEqual({ id: orderId });

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        const header = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders'));
        expect(header?.[1]).toEqual([contactId, 25_000, 'COP', '', '{"payment_method":"cash"}', 'pending']);
        const line = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO order_items'));
        expect(line?.[1]).toEqual([orderId, productId, 'Producto real', 2, 12_500, 25_000]);
    });

    it('rejects insufficient stock before an order header can be inserted', async () => {
        const query: jest.Mock = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM products')) {
                return [{ id: productId, name: 'Última unidad', price: 100, currency: 'COP', stock: 1, is_available: true }];
            }
            return [];
        });
        const { service } = setup(query);

        await expect(service.createOrder(tenantId, {
            contactId,
            items: [{ productId, productName: 'x', quantity: 2, unitPrice: 1 }],
        })).rejects.toBeInstanceOf(ConflictException);
        expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO orders'))).toBe(false);
    });

    it('rejects invalid quantities before opening a transaction', async () => {
        const query: jest.Mock = jest.fn();
        const { service, prisma } = setup(query);
        await expect(service.createOrder(tenantId, {
            contactId,
            items: [{ productId, productName: 'x', quantity: 0, unitPrice: 10 }],
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('restores stock once when a confirmed order is cancelled', async () => {
        const query: jest.Mock = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM orders') && sql.includes('FOR UPDATE')) return [{ id: orderId, status: 'confirmed' }];
            if (sql.includes('FROM order_items')) return [{ product_id: productId, product_name: 'Producto', quantity: 3 }];
            if (sql.includes('SELECT stock FROM products')) return [{ stock: 4 }];
            return [];
        });
        const { service } = setup(query);

        await service.updateOrderStatus(tenantId, orderId, 'cancelled', 'tenant_supervisor');

        const restock = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE products'));
        expect(restock?.[1]).toEqual([productId, 7]);
        const statusUpdate = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE orders SET status'));
        expect(statusUpdate?.[1]).toEqual(['cancelled', orderId]);
    });

    it('keeps terminal orders immutable', async () => {
        const query: jest.Mock = jest.fn(async (sql: string, _params?: any[]) => sql.includes('FROM orders') ? [{ id: orderId, status: 'paid' }] : []);
        const { service } = setup(query);

        await expect(service.updateOrderStatus(tenantId, orderId, 'cancelled', 'tenant_admin'))
            .rejects.toBeInstanceOf(ConflictException);
        expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE orders SET status'))).toBe(false);
    });

    it('validates a provided contact UUID before opening a transaction', async () => {
        const query: jest.Mock = jest.fn();
        const { service, prisma } = setup(query);

        await expect(service.createOrder(tenantId, {
            contactId: '',
            items: [{ productId, productName: 'x', quantity: 1, unitPrice: 10 }],
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('creates a consumer order without a contact', async () => {
        const query: jest.Mock = jest.fn(async (sql: string) => {
            if (sql.includes('FROM products')) {
                return [{ id: productId, name: 'Producto', price: 100, currency: 'COP', stock: 2, is_available: true }];
            }
            if (sql.includes('INSERT INTO orders')) return [{ id: orderId }];
            if (sql.includes('UPDATE products')) return [{ stock: 1 }];
            return [];
        });
        const { service } = setup(query);

        await service.createOrder(tenantId, {
            items: [{ productId, productName: 'x', quantity: 1, unitPrice: 1 }],
        });

        const header = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders'));
        expect(header?.[1]?.[0]).toBeNull();
    });

    it.each(['pending', 'confirmed', 'paid'] as const)(
        'persists the supported initial status %s',
        async (status) => {
            const query: jest.Mock = jest.fn(async (sql: string) => {
                if (sql.includes('FROM products')) {
                    return [{ id: productId, name: 'Producto', price: 100, currency: 'COP', stock: 2, is_available: true }];
                }
                if (sql.includes('INSERT INTO orders')) return [{ id: orderId }];
                if (sql.includes('UPDATE products')) return [{ stock: 1 }];
                return [];
            });
            const { service } = setup(query);

            await service.createOrder(tenantId, {
                contactId,
                status,
                items: [{ productId, productName: 'x', quantity: 1, unitPrice: 1 }],
            });

            const header = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders'));
            expect(header?.[1]?.[5]).toBe(status);
        },
    );

    it('rejects unsupported initial states before opening a transaction', async () => {
        const query: jest.Mock = jest.fn();
        const { service, prisma } = setup(query);

        await expect(service.createOrder(tenantId, {
            contactId,
            status: 'cancelled' as any,
            items: [{ productId, productName: 'x', quantity: 1, unitPrice: 10 }],
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('allows agents to advance orders but not to cancel them', async () => {
        const advanceQuery: jest.Mock = jest.fn(async (sql: string) => {
            if (sql.includes('FROM orders')) return [{ id: orderId, status: 'pending' }];
            return [];
        });
        const advance = setup(advanceQuery);
        await expect(advance.service.updateOrderStatus(tenantId, orderId, 'confirmed', 'tenant_agent'))
            .resolves.toBeUndefined();

        const cancelQuery: jest.Mock = jest.fn();
        const cancellation = setup(cancelQuery);
        await expect(cancellation.service.updateOrderStatus(tenantId, orderId, 'cancelled', 'tenant_agent'))
            .rejects.toBeInstanceOf(ForbiddenException);
        expect(cancellation.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
