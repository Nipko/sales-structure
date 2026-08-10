import { VehicleInventoryService } from './vehicle-inventory.service';

describe('VehicleInventoryService pagination', () => {
    it('searches identifying fields and retrieves inventory after item 200', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ total: 245 }])
            .mockResolvedValueOnce(Array.from({ length: 45 }, (_, index) => ({ id: `vehicle-${index}` })));
        const service = new VehicleInventoryService(
            { $queryRawUnsafe: query } as any,
            {} as any,
        );
        jest.spyOn(service, 'ensureTables').mockResolvedValue(undefined);

        const page = await service.listVehicles('tenant_schema', { search: 'ABC', limit: 100, offset: 200 });

        expect(page).toMatchObject({ total: 245 });
        expect(page.items).toHaveLength(45);
        expect(query.mock.calls[0][0]).toContain("license_plate");
        expect(query.mock.calls[0][0]).toContain("vin");
        expect(query.mock.calls[0].slice(1)).toEqual(['%ABC%']);
        expect(query.mock.calls[1].slice(-2)).toEqual([100, 200]);
    });
});
