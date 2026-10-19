import { BadRequestException } from '@nestjs/common';
import { ToursService } from './tours.service';

describe('ToursService read package IDs', () => {
    const schema = 'tenant_synthetic';
    const valid = 'A1111111-B222-4333-8444-C55555555555';
    const build = () => {
        const execute = jest.fn().mockResolvedValue([]);
        return { execute, service: new ToursService(
            { executeInTenantSchema: execute } as any, {} as any, {} as any,
        ) };
    };
    for (const method of ['getPackage', 'listInventory', 'listBookings'] as const) {
        it.each(['sparkqa-invalid-id', '', ['bad', 'id'], null, '11111111-1111-4111-8111-11111111111Z'])(`${method} rejects invalid ID %j before SQL`, async (value) => {
            const { execute, service } = build();
            await expect(service[method](schema, value as any)).rejects.toBeInstanceOf(BadRequestException);
            expect(execute).not.toHaveBeenCalled();
        });
        it(`${method} preserves a valid uppercase UUID and its bound parameter`, async () => {
            const { execute, service } = build();
            await service[method](schema, valid);
            expect(execute).toHaveBeenCalledTimes(1);
            expect(execute.mock.calls[0][2]).toEqual([valid]);
            expect(execute.mock.calls[0][1]).toContain('::uuid');
        });
    }
    it('preserves omitted booking filter', async () => {
        const { execute, service } = build();
        await expect(service.listBookings(schema)).resolves.toEqual([]);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][2]).toEqual([]);
        expect(execute.mock.calls[0][1]).not.toContain('WHERE b.package_id');
    });
});
