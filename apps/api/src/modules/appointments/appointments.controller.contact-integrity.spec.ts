import { BadRequestException } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';

describe('AppointmentsController contact contract', () => {
    const appointments = {
        create: jest.fn(),
        createRecurring: jest.fn(),
    };
    const controller = new AppointmentsController(
        appointments as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    const user = { schemaName: 'tenant_auth' };

    beforeEach(() => jest.clearAllMocks());

    it('returns 400 before the authenticated single writer when contactId is omitted', async () => {
        await expect(controller.create('tenant-id', {
            serviceName: 'Consulta',
            startAt: '2026-08-12T09:00:00',
            endAt: '2026-08-12T09:30:00',
        }, user)).rejects.toBeInstanceOf(BadRequestException);

        expect(appointments.create).not.toHaveBeenCalled();
    });

    it('returns 400 before the authenticated recurring writer when contactId is omitted', async () => {
        await expect(controller.createRecurring('tenant-id', {
            serviceName: 'Consulta',
            startAt: '2026-08-12T09:00:00',
            endAt: '2026-08-12T09:30:00',
            recurrence: { frequency: 'weekly', count: 2 },
        }, user)).rejects.toBeInstanceOf(BadRequestException);

        expect(appointments.createRecurring).not.toHaveBeenCalled();
    });
});
