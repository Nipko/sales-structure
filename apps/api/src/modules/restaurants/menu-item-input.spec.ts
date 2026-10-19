import { BadRequestException } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';

describe('Menu item writes reject malformed owner inputs before SQL', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const invalid = [
        { name: '', price: 10 },
        { name: '   ', price: 10 },
        { name: 42, price: 10 },
        { name: 'QA dish', price: -1 },
        { name: 'QA dish', price: '10' },
        { name: 'QA dish', price: NaN },
        { name: 'QA dish', price: Infinity },
        null,
        [],
    ];
    function fixture() {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([{ id }]) };
        return { prisma, service: new RestaurantsService(prisma as any, { emit: jest.fn() } as any) };
    }
    for (const method of ['create', 'update'] as const) {
        it.each(invalid.map((body, index) => [index, body] as const))(`${method}: rejects invalid input %s without a write`, async (_index, body) => {
            const { service, prisma } = fixture();
            const call = method === 'create'
                ? service.createItem('tenant_restaurant', body as any)
                : service.updateItem('tenant_restaurant', id, body);
            await expect(call).rejects.toBeInstanceOf(BadRequestException);
            expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        });
    }
    it.each(['isAvailable', 'isActive'])('rejects a string %s instead of coercing an availability change', async (key) => {
        const { service, prisma } = fixture();
        await expect(service.updateItem('tenant_restaurant', id, { [key]: 'false' })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
    it('accepts a real numeric zero price when creating a named free dish', async () => {
        const { service, prisma } = fixture();
        await service.createItem('tenant_restaurant', { name: 'QA free dish', price: 0, currency: 'USD' });
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(prisma.executeInTenantSchema.mock.calls[0][1]).toContain('INSERT INTO menu_items');
        expect(prisma.executeInTenantSchema.mock.calls[0][2][3]).toBe(0);
    });
    it('preserves partial availability updates without requiring or changing price and name', async () => {
        const { service, prisma } = fixture();
        await service.updateItem('tenant_restaurant', id, { isAvailable: false });
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        const [, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(sql).toContain('is_available = $1');
        expect(sql).not.toMatch(/price =|name =/);
        expect(params).toEqual([false, id]);
    });
});
