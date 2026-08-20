import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { holdStillAliveSql, PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';
import {
    paymentConfirmedText,
    PaymentOutcomeNotifierService,
} from '../conversations/payment-outcome-notifier.service';
import { PushService } from '../push/push.service';

/**
 * Cierra el lazo: el huésped pagó, la estadía se confirma.
 *
 * El webhook del cobro marcaba `payment_status = 'paid'` y emitía
 * `tenant_payment.succeeded` — con un comentario que decía, textual, que el
 * evento existe "para que otra cosa reaccione, confirmar la reserva". **Nadie
 * reaccionaba**: se emitía en tres lugares y no tenía un solo oyente. Un huésped
 * podía pagar y la reserva se quedaba pendiente para siempre.
 *
 * Revalida antes de confirmar porque el cupo NO se bloquea mientras no se paga
 * (decisión del dueño: gana el que pague primero). Entre que se generó el enlace
 * y entró la plata, la fecha pudo venderse. Ese caso no se puede resolver solo:
 * hay plata cobrada y no hay dónde alojar, así que va a un humano.
 */
@Injectable()
export class BookingPaymentListener {
    private readonly logger = new Logger(BookingPaymentListener.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly events: EventEmitter2,
        // Opcional a propósito: si el módulo de avisos no está disponible, la
        // reserva se confirma igual. Perder el mensaje es malo; perder la
        // confirmación del pago sería mucho peor.
        @Optional() private readonly notifier?: PaymentOutcomeNotifierService,
        @Optional() private readonly push?: PushService,
    ) {}

    @OnEvent('tenant_payment.succeeded')
    async onPaid(event: { tenantId?: string; kind?: string; entityId?: string }): Promise<void> {
        if (event?.kind !== 'property' || !event.tenantId || !event.entityId) return;

        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;

            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, property_id, check_in, check_out, status, contact_id, conversation_id
                   FROM property_bookings WHERE id = $1::uuid`,
                [event.entityId],
            );
            const booking = rows?.[0];
            if (!booking) {
                this.logger.warn(`[Pago] la reserva ${event.entityId} no existe en ${schemaName}`);
                return;
            }
            // Idempotente: el webhook puede llegar varias veces, y una reserva
            // ya confirmada (o cancelada a mano) no se toca.
            if (booking.status !== PENDING_PAYMENT_STATUS) return;

            const conflicts = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT 1 FROM (
                    SELECT check_in, check_out FROM ical_blocks
                     WHERE property_id = $1::uuid AND is_deleted = false
                       AND check_in < $3::date
                       AND CASE WHEN date_range_semantics < 2
                                THEN check_out >= $2::date
                                ELSE check_out > $2::date END
                    UNION ALL
                    SELECT check_in, check_out FROM property_bookings
                     WHERE property_id = $1::uuid
                       AND id <> $4::uuid
                       AND Nonestatus NOT IN ('cancelled') AND ${holdStillAliveSql()}
                       AND check_in < $3::date AND check_out > $2::date
                 ) c LIMIT 1`,
                [booking.property_id, booking.check_in, booking.check_out, booking.id],
            );

            if (conflicts?.length) {
                // Cobrado y sin lugar. No se confirma ni se cancela sola: la
                // plata es real y la decisión (reubicar o devolver) es del dueño.
                this.logger.error(
                    `[Pago] la reserva ${booking.id} se pagó pero las fechas ya se ocuparon ` +
                    `(propiedad ${booking.property_id}, ${booking.check_in} a ${booking.check_out}) — requiere intervención`,
                );
                // Cobrado y sin lugar es lo más caro que puede pasar acá, y hasta
                // ahora la única huella era esta línea de log: nadie se
                // enteraba. Al huésped NO se le escribe solo — la decisión de
                // reubicar o devolver es del dueño y tiene que tomarla una
                // persona— pero el dueño tiene que saberlo ya.
                await this.push?.sendToTenantRole(event.tenantId, 'tenant_admin', {
                    title: 'Un pago entró sin disponibilidad',
                    body: `Se acreditó un pago para el ${booking.check_in} al ${booking.check_out} `
                        + 'pero las fechas ya se ocuparon. Hay que reubicar o devolver.',
                    tag: `paid-no-room-${booking.id}`,
                }).catch(() => { /* el aviso es best-effort; el log ya quedó */ });
                this.events.emit('property_booking.paid_but_unavailable', {
                    tenantId: event.tenantId,
                    bookingId: booking.id,
                    propertyId: booking.property_id,
                    contactId: booking.contact_id,
                    checkIn: booking.check_in,
                    checkOut: booking.check_out,
                });
                return;
            }

            const updated = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `UPDATE property_bookings SET status = 'confirmed', updated_at = NOW()
                  WHERE id = $1::uuid AND status = $2
                  RETURNING id`,
                [booking.id, PENDING_PAYMENT_STATUS],
            );
            if (!updated?.[0]) return;

            this.logger.log(`[Pago] reserva ${booking.id} confirmada tras acreditarse el pago`);
            // Confirmar en la base no es confirmarle al huésped. Sin este aviso
            // pagaba, Wompi le decía "listo" y de nosotros no recibía nada.
            await this.notifier?.notifyCustomer({
                tenantId: event.tenantId,
                conversationId: booking.conversation_id,
                contactId: booking.contact_id,
                text: paymentConfirmedText(undefined, 'tu reserva'),
                // Derivado de la reserva, no del reintento: el webhook llega
                // varias veces y el huésped no puede recibir tres veces lo mismo.
                dedupeId: `pay-ok-property-${booking.id}`,
            });
            this.events.emit('property_booking.confirmed_by_payment', {
                tenantId: event.tenantId,
                bookingId: booking.id,
                propertyId: booking.property_id,
                contactId: booking.contact_id,
            });
        } catch (e: any) {
            // Se traga la excepción a propósito: el pago YA se registró y hacer
            // fallar al emisor no lo revierte. El log es la señal.
            this.logger.error(`[Pago] no se pudo confirmar la reserva ${event.entityId}: ${e.message}`);
        }
    }
}
