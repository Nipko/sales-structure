import { ListingsService } from './listings.service';

describe('listing creation preserves explicit room counts', () => {
    async function create(data: Record<string, unknown>) {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222' }]) };
        const service = new ListingsService(prisma as any);
        await service.create('tenant_qa', { name: 'Synthetic studio', transactionType: 'sale', ...data });
        const [schema, sql, parameters] = prisma.executeInTenantSchema.mock.calls[0];
        expect(schema).toBe('tenant_qa');
        expect(sql).toContain('INSERT INTO real_estate_listings');
        return parameters;
    }

    it.each([
        [{ bedrooms: 0, bathrooms: 2 }, 0, 2],
        [{ bedrooms: 2, bathrooms: 0 }, 2, 0],
        [{ bedrooms: 0, bathrooms: 0 }, 0, 0],
    ])('keeps explicit zero instead of silently adding a room: %j', async (data, bedrooms, bathrooms) => {
        const values = await create(data);
        expect(values[10]).toBe(bedrooms);
        expect(values[11]).toBe(bathrooms);
    });

    it('preserves fractional bathrooms', async () => {
        const values = await create({ bedrooms: 2, bathrooms: 1.5 });
        expect(values[10]).toBe(2);
        expect(values[11]).toBe(1.5);
    });

    it('keeps existing defaults for unspecified room counts', async () => {
        const values = await create({});
        expect(values[10]).toBe(1);
        expect(values[11]).toBe(1);
    });
});
