import { VacationRentalController } from './vacation-rental.controller';

describe('VacationRentalController.listUpcomingBookings', () => {
    it('uses the tenant-local date when from is omitted', async () => {
        const rows = [{ id: 'booking-1' }];
        const propertiesService = {
            getTenantLocalDate: jest.fn().mockResolvedValue('2026-08-07'),
            listUpcomingBookings: jest.fn().mockResolvedValue(rows),
        };
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_vacation'),
        };
        const controller = new VacationRentalController(
            propertiesService as any,
            {} as any,
            prisma as any,
        );

        await expect(controller.listUpcomingBookings('tenant-id')).resolves.toEqual({
            success: true,
            data: rows,
        });
        expect(propertiesService.getTenantLocalDate).toHaveBeenCalledWith('tenant-id');
        expect(propertiesService.listUpcomingBookings)
            .toHaveBeenCalledWith('tenant_vacation', '2026-08-07');
    });

    it('passes an explicit date through for strict service validation', async () => {
        const propertiesService = {
            getTenantLocalDate: jest.fn(),
            listUpcomingBookings: jest.fn().mockResolvedValue([]),
        };
        const controller = new VacationRentalController(
            propertiesService as any,
            {} as any,
            { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_vacation') } as any,
        );

        await controller.listUpcomingBookings('tenant-id', '2026-08-10');

        expect(propertiesService.getTenantLocalDate).not.toHaveBeenCalled();
        expect(propertiesService.listUpcomingBookings)
            .toHaveBeenCalledWith('tenant_vacation', '2026-08-10');
    });
});
