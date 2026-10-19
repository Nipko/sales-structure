import { BadRequestException } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';

describe('listing search numeric boundaries', () => {
    function build() {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        return { prisma, service: new ListingsService(prisma as any) };
    }

    it.each([
        ['limit', -1], ['limit', 0], ['limit', 1.5], ['limit', NaN], ['limit', Infinity], ['limit', '10'], ['limit', true], ['limit', null],
        ['minPrice', -1], ['minPrice', NaN], ['minPrice', Infinity], ['minPrice', '0'], ['minPrice', null],
        ['maxPrice', -1], ['maxPrice', NaN], ['minBedrooms', -1], ['minBedrooms', 1.5], ['minAreaM2', -1], ['minAreaM2', NaN],
    ])('rejects invalid %s=%s before executing tenant search SQL', async (key, value) => {
        const { service, prisma } = build();
        await expect(service.search('tenant_qa', { [key]: value } as any)).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('binds explicit zero prices, bedroom count and area instead of dropping the filters', async () => {
        const { service, prisma } = build();
        await service.search('tenant_qa', { maxPrice: 0, minPrice: 0, minBedrooms: 0, minAreaM2: 0 });
        const [, sql, values] = prisma.executeInTenantSchema.mock.calls[0];
        expect(sql).toContain('price <= $1'); expect(sql).toContain('price >= $2');
        expect(sql).toContain('bedrooms >= $3'); expect(sql).toContain('area_m2 >= $4');
        expect(values).toEqual([0, 0, 0, 0]);
    });

    it('preserves fractional prices and area with integer bedroom counts', async () => {
        const { service, prisma } = build();
        await service.search('tenant_qa', { maxPrice: 125.5, minPrice: 0.25, minBedrooms: 0, minAreaM2: 1.5 });
        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual([125.5, 0.25, 0, 1.5]);
    });

    it.each([[undefined, 10], [1, 1], [500, 50]])('keeps default and bounded positive limit %s -> %s', async (limit, expected) => {
        const { service, prisma } = build();
        await service.search('tenant_qa', { limit });
        expect(prisma.executeInTenantSchema.mock.calls[0][1]).toContain(`LIMIT ${expected}`);
    });
});

describe('listing search HTTP numeric query parsing', () => {
    function build() {
        const service = { search: jest.fn().mockResolvedValue([]) };
        const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_qa') };
        return { controller: new ListingsController(service as any, prisma as any), service };
    }

    it.each([
        { limit: 'sparkqa_invalid' }, { minPrice: 'sparkqa_invalid' }, { maxPrice: '' },
        { minBedrooms: ['1', '2'] }, { minAreaM2: ' ' }, { limit: true }, { limit: 'Infinity' },
    ])('rejects malformed query %j rather than ignoring it or forwarding NaN', async query => {
        const { controller, service } = build();
        await expect(controller.search('tenant-qa', query)).rejects.toBeInstanceOf(BadRequestException);
        expect(service.search).not.toHaveBeenCalled();
    });

    it('parses valid numeric strings, including zero and decimals, without changing text filters', async () => {
        const { controller, service } = build();
        await controller.search('tenant-qa', { transactionType: 'sale', city: 'Ciudad QA', maxPrice: '0', minPrice: '0', minBedrooms: '0', minAreaM2: '1.5', limit: '5' });
        expect(service.search).toHaveBeenCalledWith('tenant_qa', expect.objectContaining({ transactionType: 'sale', city: 'Ciudad QA', maxPrice: 0, minPrice: 0, minBedrooms: 0, minAreaM2: 1.5, limit: 5 }));
    });
});
