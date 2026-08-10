import { OrdersService } from './orders.service';

describe('OrdersService contact pagination', () => {
    it('searches server-side and exposes contacts beyond the first 200', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([{ total: 250 }])
            .mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => ({
                id: `contact-${index}`,
                name: `Cliente ${index}`,
                phone: `300${index}`,
                email: `c${index}@example.com`,
            })));
        const service = new OrdersService(
            { executeInTenantSchema } as any,
            { get: jest.fn().mockResolvedValue('tenant_schema') } as any,
        );

        await expect(service.getContacts('tenant-id', { search: 'ana', limit: 50, offset: 200 }))
            .resolves.toMatchObject({ total: 250, offset: 200, hasMore: false });
        expect(executeInTenantSchema.mock.calls[0][1]).toContain('email ILIKE $1');
        expect(executeInTenantSchema.mock.calls[0][2]).toEqual(['%ana%']);
        expect(executeInTenantSchema.mock.calls[1][2]).toEqual(['%ana%', 50, 200]);
    });

    it('propagates database errors instead of returning an empty success', async () => {
        const failure = new Error('database unavailable');
        const service = new OrdersService(
            { executeInTenantSchema: jest.fn().mockRejectedValue(failure) } as any,
            { get: jest.fn().mockResolvedValue('tenant_schema') } as any,
        );

        await expect(service.getContacts('tenant-id')).rejects.toBe(failure);
    });
});
