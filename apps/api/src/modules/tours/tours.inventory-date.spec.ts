import { BadRequestException } from '@nestjs/common';
import { ToursService } from './tours.service';

describe('ToursService inventory date filter', () => {
    const schema = 'tenant_synthetic';
    const packageId = '11111111-1111-4111-8111-111111111111';
    const build = () => {
        const execute = jest.fn().mockResolvedValue([]);
        return { execute, service: new ToursService(
            { executeInTenantSchema: execute } as any,
            {} as any, {} as any,
        ) };
    };

    it.each([
        '2027-02-30', 'sparkqa_invalid_date', ['2026-12-15', '2026-12-16'],
        '', '2026-12-15T09:00:00Z', '2026-2-1', '0000-01-01',
    ])('rejects invalid calendar filter %j before SQL', async (fromDate) => {
        const { execute, service } = build();
        await expect(service.listInventory(schema, packageId, fromDate as any))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(['2000-01-01', '2028-02-29', '2026-12-15'])
    ('preserves valid historical, leap and future filters: %s', async (fromDate) => {
        const { execute, service } = build();
        await expect(service.listInventory(schema, packageId, fromDate)).resolves.toEqual([]);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(schema,
            expect.stringContaining('departure_date >= $2::date'), [packageId, fromDate]);
    });

    it('preserves an omitted filter and the existing ordered inventory read', async () => {
        const { execute, service } = build();
        await expect(service.listInventory(schema, packageId)).resolves.toEqual([]);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(schema,
            expect.not.stringContaining('departure_date >= $2::date'), [packageId]);
        expect(execute.mock.calls[0][1]).toContain('ORDER BY departure_date, departure_time');
    });
});
