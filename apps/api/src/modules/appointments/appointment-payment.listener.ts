import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';
import { OCCUPANCY_EXCLUDED_SQL, PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * El cliente pagó la seña: la cita se confirma y recién ahí entra a la agenda.
 *
 * Como el turno NO se bloquea mientras no se paga (decisión del dueño), dos
 * personas pueden pedir el mismo horario sin pagar y las dos pagar. El primero
 * que acredite se queda con el turno; el segundo llega a un horario ocupado y
 * eso no se puede resolver solo — hay plata cobrada y no hay turno, así que va
 * a un humano.
 *
 * La cita entra al calendario del profesional acá y no al crearse: sincronizar
 * una cita impaga le taparía la agenda con algo que todavía está a la venta.
 */
@Injectable()
export class AppointmentPaymentListener {
    private readonly logger = new Logger(AppointmentPaymentListener.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly events: EventEmitter2,
    ) {}

    @OnEvent('tenant_payment.succeeded')
    async onPaid(event: { tenantId?: string; kind?: string; entityId?: string }): Promise<void> {
        if (event?.kind !== 'appointment' || !event.tenantId || !event.entityId) return;

        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;

            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, service_id, assigned_to, start_at, end_at, status, contact_id
                   FROM appointments WHERE id = $1::uuid`,
                [event.entityId],
            );
            const appointment = rows?.[0];
            if (!appointment) {
                this.logger.warn(`[Pago] la cita ${event.entityId} no existe en ${schemaName}`);
                return;
            }
            // Idempotente: el webhook puede llegar varias veces.
            if (appointment.status !== PENDING_PAYMENT_STATUS) return;

            // Revalida contra el mismo criterio que usa la capacidad: staff
            // ocupado o servicio sin cupo concurrente en esa franja.
            const taken = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT 1 FROM appointments a
                  WHERE a.id <> $1::uuid
                    AND a.status NOT IN ('cancelled', ${OCCUPANCY_EXCLUDED_SQL})
                    AND a.start_at < $3::timestamp AND a.end_at > $2::timestamp
                    AND (
                        ($4::uuid IS NOT NULL AND a.assigned_to = $4::uuid)
                        OR a.service_id = $5::uuid
                    )
                  GROUP BY a.service_id
                 HAVING COUNT(*) >= (
                        SELECT COALESCE(MAX(s.max_concurrent), 1) FROM services s WHERE s.id = $5::uuid
                 )
                  LIMIT 1`,
                [
                    appointment.id, appointment.start_at, appointment.end_at,
                    appointment.assigned_to, appointment.service_id,
                ],
            );

            if (taken?.length) {
                this.logger.error(
                    `[Pago] la cita ${appointment.id} se pagó pero el horario ya se ocupó ` +
                    `(${appointment.start_at}) — requiere intervención`,
                );
                this.events.emit('appointment.paid_but_unavailable', {
                    tenantId: event.tenantId,
                    appointmentId: appointment.id,
                    contactId: appointment.contact_id,
                    startAt: appointment.start_at,
                });
                return;
            }

            // Confirmar y encolar al calendario van juntos: una cita confirmada
            // que no llegó a la agenda del profesional es un turno que nadie ve.
            const confirmed = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                const updated = await query<any[]>(
                    `UPDATE appointments SET status = 'confirmed', updated_at = NOW()
                      WHERE id = $1::uuid AND status = $2
                      RETURNING id`,
                    [appointment.id, PENDING_PAYMENT_STATUS],
                );
                if (!updated?.[0]) return false;
                await CalendarSyncOutboxService.enqueueWithTransaction(query, appointment.id, 'upsert');
                return true;
            });
            if (!confirmed) return;

            this.logger.log(`[Pago] cita ${appointment.id} confirmada tras acreditarse el pago`);
            this.events.emit('appointment.confirmed_by_payment', {
                tenantId: event.tenantId,
                appointmentId: appointment.id,
                contactId: appointment.contact_id,
            });
        } catch (e: any) {
            // El pago YA se registró: hacer fallar al emisor no lo revierte.
            this.logger.error(`[Pago] no se pudo confirmar la cita ${event.entityId}: ${e.message}`);
        }
    }
}
