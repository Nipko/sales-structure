import { VehicleInventoryService } from './vehicle-inventory.service';

describe('VehicleInventoryService pagination', () => {
    it('searches identifying fields and retrieves inventory after item 200', async () => {
        // The service now takes a tenantId and resolves the real schema itself,
        // so the fake Prisma has to answer both the resolution and the queries.
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([{ total: 245 }])
            .mockResolvedValueOnce(Array.from({ length: 45 }, (_, index) => ({ id: `vehicle-${index}` })));
        const getTenantSchemaName = jest.fn().mockResolvedValue('tenant_schema');
        const service = new VehicleInventoryService(
            { executeInTenantSchema, getTenantSchemaName } as any,
            {} as any,
        );
        jest.spyOn(service, 'ensureTables').mockResolvedValue(undefined);

        const page = await service.listVehicles('3e8ad32e-a16b-42e6-9634-b8e8cc29292d', {
            search: 'ABC', limit: 100, offset: 200,
        });

        expect(page).toMatchObject({ total: 245 });
        expect(page.items).toHaveLength(45);
        expect(getTenantSchemaName).toHaveBeenCalledWith('3e8ad32e-a16b-42e6-9634-b8e8cc29292d');
        expect(service.ensureTables).toHaveBeenCalledWith('tenant_schema');
        expect(executeInTenantSchema.mock.calls[0][0]).toBe('tenant_schema');
        expect(executeInTenantSchema.mock.calls[0][1]).toContain('license_plate');
        expect(executeInTenantSchema.mock.calls[0][1]).toContain('vin');
        expect(executeInTenantSchema.mock.calls[0][1]).not.toContain('tenant_schema".');
        expect(executeInTenantSchema.mock.calls[0][2]).toEqual(['%ABC%']);
        expect(executeInTenantSchema.mock.calls[1][0]).toBe('tenant_schema');
        expect(executeInTenantSchema.mock.calls[1][2].slice(-2)).toEqual([100, 200]);
    });
});
