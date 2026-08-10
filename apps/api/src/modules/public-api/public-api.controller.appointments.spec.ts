import { BadRequestException } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';

describe('PublicApiController appointment contact contract', () => {
    it('returns 400 before resolving the tenant or calling the writer when contactId is omitted', async () => {
        const prisma = { getTenantSchemaName: jest.fn() };
        const appointments = { create: jest.fn() };
        const controller = new PublicApiController(
            prisma as any,
            {} as any,
            appointments as any,
            {} as any,
        );

        await expect(controller.createAppointment({ tenantId: 'tenant-id' }, {
            serviceName: 'Consulta',
            startAt: '2026-08-12T09:00:00',
            endAt: '2026-08-12T09:30:00',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(appointments.create).not.toHaveBeenCalled();
    });
});
