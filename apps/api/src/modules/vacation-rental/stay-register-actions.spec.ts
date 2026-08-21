import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { VacationRentalController } from './vacation-rental.controller';
import { PropertiesService } from './properties.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * Operar una estadía desde el registro, sin abrir antes la ficha.
 *
 * El plan pide que el agente vea, cree y cancele una reserva sin pasar por el
 * Kanban ni por la tarjeta del alojamiento. Ver y crear ya se podía; cancelar
 * era de supervisión — mientras el agente de IA sí cancelaba con confirmación
 * y verificación de titular. La persona del equipo tenía menos autoridad que
 * el modelo.
 */
describe('stay register actions', () => {
    it('lets the same role that creates a stay also cancel it', () => {
        const create = Reflect.getMetadata(
            ROLES_KEY, VacationRentalController.prototype.createBooking,
        );
        const cancel = Reflect.getMetadata(
            ROLES_KEY, VacationRentalController.prototype.cancelBooking,
        );
        expect(create).toContain('tenant_agent');
        expect(cancel).toContain('tenant_agent');
        expect([...cancel].sort()).toEqual([...create].sort());
    });

    /** Administrar el catálogo sigue siendo otro trabajo. */
    it('keeps unit management above the operator role', () => {
        const createProperty = Reflect.getMetadata(
            ROLES_KEY, VacationRentalController.prototype.createProperty,
        );
        expect(createProperty).not.toContain('tenant_agent');
    });

    /**
     * Sin write-back al PMS, una fila local es una reserva que el calendario
     * real del anfitrión nunca conoce. El registro tiene que recibir el motivo,
     * no un fallo genérico que invite a reintentar.
     */
    it('refuses to write a stay the channel manager owns, with a reason', async () => {
        const propertyId = '11111111-1111-4111-8111-111111111111';
        const service = new PropertiesService(
            { executeInTenantSchema: jest.fn().mockResolvedValue([]) } as any,
            { enforcePlanLimit: jest.fn() } as any,
            { renderAndSend: jest.fn() } as any,
            {
                resolveForProperty: jest.fn().mockResolvedValue({
                    sor: 'channel_manager',
                    provider: 'hostaway',
                    stale: false,
                    lastSyncedAt: '2026-08-20T10:00:00.000Z',
                }),
            } as any,
        );

        const attempt = service.createBooking('tenant_stay', propertyId, {
            tenantId: '22222222-2222-4222-8222-222222222222',
            checkIn: '2026-09-01',
            checkOut: '2026-09-04',
            guestName: 'Ana',
        });

        await expect(attempt).rejects.toBeInstanceOf(ConflictException);
        await attempt.catch((error: any) => {
            const body = error.getResponse();
            expect(body.error).toBe('channel_manager_owns_calendar');
            expect(body.provider).toBe('hostaway');
            expect(body.message).toBeTruthy();
        });
    });
});
