import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import {
    paymentConfirmedText,
    PaymentOutcomeNotifierService,
} from '../conversations/payment-outcome-notifier.service';
import { PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * El cliente pagó su tour: la reserva pasa a firme.
 *
 * Es MÁS SIMPLE que alojamiento y citas, y por una razón concreta: el asiento se
 * descontó de `tour_inventory` al crear la reserva, así que nunca estuvo a la
 * venta para otro. No hace falta revalidar disponibilidad porque no hubo carrera
 * — el cupo ya era suyo.
 *
 * El único caso que sí puede fallar es el pago que llega tarde: si la retención
 * venció, el barrido ya devolvió el asiento y otro pudo tomarlo. Eso se ataja
 * antes de que la plata entre —el pagable rechaza `expired`— y acá se vuelve a
 * verificar, porque entre el rechazo y este listener puede haber pasado tiempo.
 */
@Injectable()
export class TourPaymentListener {
    private readonly logger = new Logger(TourPaymentListener.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly events: EventEmitter2,
        // Opcionales: si faltan, la reserva se confirma igual. Perder el aviso es
        // malo; perder la confirmación del pago sería mucho peor.
        @Optional() private readonly notifier?: PaymentOutcomeNotifierService,
        @Optional() private readonly push?: PushService,
    ) {}

    @OnEvent('tenant_payment.succeeded')
    async onPaid(event: { tenantId?: string; kind?: string; entityId?: string }): Promise<void> {
        if (event?.kind !== 'tour' || !event.tenantId || !event.entityId) return;

        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;

            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, status, contact_id, conversation_id, departure_date, party_size, hold_expires_at
                   FROM tour_bookings WHERE id = $1::uuid`,
                [event.entityId],
            );
            const booking = rows?.[0];
            if (!booking) {
                this.logger.warn(`[Pago] la reserva de tour ${event.entityId} no existe en ${schemaName}`);
                return;
            }
            // Idempotente: el webhook del proveedor llega varias veces por
            // diseño, y una reserva ya firme no se vuelve a tocar.
            if (booking.status !== PENDING_PAYMENT_STATUS) return;

            // Pago tarde. El barrido ya devolvió el asiento y pudo tomarlo otro,
            // así que esto no se resuelve solo: hay plata cobrada y puede no
            // haber lugar. La decisión —reubicar o devolver— es del dueño.
            const holdExpired = booking.hold_expires_at
                && new Date(booking.hold_expires_at).getTime() <= Date.now();
            if (holdExpired) {
                this.logger.error(
                    `[Pago] la reserva de tour ${booking.id} se pagó con la retención vencida `
                    + `(salida ${booking.departure_date}) — requiere intervención`,
                );
                await this.push?.sendToTenantRole(event.tenantId, 'tenant_admin', {
                    title: 'Un pago de tour entró tarde',
                    body: `Se acreditó un pago para la salida del ${booking.departure_date} `
                        + 'pero la retención ya había vencido y el cupo volvió al inventario.',
                    tag: `paid-late-tour-${booking.id}`,
                }).catch(() => { /* best-effort: el log ya quedó */ });
                this.events.emit('tour_booking.paid_but_expired', {
                    tenantId: event.tenantId,
                    bookingId: booking.id,
                    contactId: booking.contact_id,
                });
                return;
            }

            const updated = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `UPDATE tour_bookings SET status = 'reserved', updated_at = NOW()
                  WHERE id = $1::uuid AND status = $2
                  RETURNING id`,
                [booking.id, PENDING_PAYMENT_STATUS],
            );
            if (!updated?.[0]) return;

            this.logger.log(`[Pago] reserva de tour ${booking.id} confirmada tras acreditarse el pago`);
            await this.notifier?.notifyCustomer({
                tenantId: event.tenantId,
                conversationId: booking.conversation_id,
                contactId: booking.contact_id,
                text: paymentConfirmedText(undefined, 'tu reserva'),
                dedupeId: `pay-ok-tour-${booking.id}`,
            });
            this.events.emit('tour_booking.confirmed_by_payment', {
                tenantId: event.tenantId,
                bookingId: booking.id,
                contactId: booking.contact_id,
            });
        } catch (e: any) {
            // Se traga la excepción a propósito: el pago YA se registró y hacer
            // fallar al emisor no lo revierte. El log es la señal.
            this.logger.error(`[Pago] no se pudo confirmar la reserva de tour ${event.entityId}: ${e.message}`);
        }
    }
}
