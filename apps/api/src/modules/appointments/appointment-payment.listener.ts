import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';
import { PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';
import { Cron } from '@nestjs/schedule';
import { CronLockService } from '../redis/cron-lock.service';
import { lockAndAssertAppointmentCapacity, AppointmentSlotConflictError, AppointmentServiceUnavailableError } from './appointment-capacity.util';
import { PushService } from '../push/push.service';
import {
    paymentConfirmedText,
    PaymentOutcomeNotifierService,
} from '../conversations/payment-outcome-notifier.service';

/**
 * El cliente pagó la seña: la cita se confirma y recién ahí entra a la agenda.
 *
 * El turno queda RETENIDO 20 minutos mientras el cliente paga, así que la
 * carrera normal ya no existe. Pero la retención vence: si el pago se acredita
 * tarde, el segundo puede haberse quedado con el horario. Ahí hay plata cobrada
 * y no hay turno, y eso no se resuelve solo — va a una persona.
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
        // Opcionales: si faltan, la cita se confirma igual. Perder el aviso es
        // malo; perder la confirmación del pago sería mucho peor.
        @Optional() private readonly notifier?: PaymentOutcomeNotifierService,
        @Optional() private readonly push?: PushService,
        @Optional() private readonly cronLock?: CronLockService,
    ) {}

    /** Recover a paid row if its event handler failed after payment settlement. */
    @Cron('*/5 * * * *')
    async reconcilePaidAppointmentsCron(): Promise<void> {
        if (!this.cronLock) return;
        await this.cronLock.runExclusive('appointments.reconcilePaid', 240, () => this.reconcilePaidAppointments());
    }

    async reconcilePaidAppointments(): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true, schemaName: true } });
        for (const tenant of tenants) {
            try {
                const rows = await this.prisma.executeInTenantSchema<any[]>(tenant.schemaName,
                    `SELECT id FROM appointments WHERE payment_status = 'paid'
                     AND status IN ('pending_payment', 'expired') ORDER BY updated_at LIMIT 100`);
                for (const row of rows) await this.onPaid({ tenantId: tenant.id, kind: 'appointment', entityId: row.id });
            } catch (error: any) {
                this.logger.warn(`Paid appointment reconciliation failed for ${tenant.id}: ${error.message}`);
            }
        }
    }

    @OnEvent('tenant_payment.succeeded')
    async onPaid(event: { tenantId?: string; kind?: string; entityId?: string }): Promise<void> {
        if (event?.kind !== 'appointment' || !event.tenantId || !event.entityId) return;

        try {
            const schemaName = await this.prisma.getTenantSchemaName(event.tenantId);
            if (!schemaName) return;

            let appointment: any;
            let unavailable = false;
            const confirmed = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                [appointment] = await query<any[]>(
                    `SELECT id, service_id, assigned_to,
                            to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at,
                            to_char(end_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_at, status, payment_status,
                            contact_id, conversation_id, metadata FROM appointments WHERE id = $1::uuid FOR UPDATE`,
                    [event.entityId],
                );
                // Only settlement recorded on this tenant-owned row can confirm it.
                if (!appointment || !['pending_payment', 'expired'].includes(appointment.status)
                    || appointment.payment_status !== 'paid' || appointment.metadata?.source === 'eval_gate') return false;
                try {
                    await lockAndAssertAppointmentCapacity(query, {
                        schemaName, serviceId: appointment.service_id, staffUserId: appointment.assigned_to,
                        startAt: appointment.start_at, endAt: appointment.end_at, excludeAppointmentId: appointment.id,
                    });
                } catch (error) {
                    if (!(error instanceof AppointmentSlotConflictError) && !(error instanceof AppointmentServiceUnavailableError)) throw error;
                    unavailable = !appointment.metadata?.paymentConfirmationIssue;
                    await query(`UPDATE appointments SET metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('paymentConfirmationIssue', 'availability_requires_review'), updated_at = NOW()
                        WHERE id = $1::uuid`, [appointment.id]);
                    return false;
                }
                await query(`UPDATE appointments SET status = 'confirmed', hold_expires_at = NULL,
                    metadata = COALESCE(metadata, '{}'::jsonb) - 'paymentConfirmationIssue', updated_at = NOW()
                    WHERE id = $1::uuid`, [appointment.id]);
                await CalendarSyncOutboxService.enqueueWithTransaction(query, appointment.id, 'upsert');
                return true;
            });

            if (unavailable) {
                this.logger.error(
                    `[Pago] la cita ${appointment.id} se pagó pero el horario ya se ocupó ` +
                    `(${appointment.start_at}) — requiere intervención`,
                );
                // Al cliente NO se le escribe solo: reprogramar o devolver es una
                // decisión del negocio. Al dueño sí, y ya.
                await this.push?.sendToTenantRole(event.tenantId, 'tenant_admin', {
                    title: 'Un pago entró sin turno disponible',
                    body: `Se acreditó un pago para el turno del ${appointment.start_at} `
                        + 'pero el horario ya se ocupó. Hay que reprogramar o devolver.',
                    tag: `paid-no-slot-${appointment.id}`,
                }).catch(() => { /* best-effort: el log ya quedó */ });
                this.events.emit('appointment.paid_but_unavailable', {
                    tenantId: event.tenantId,
                    appointmentId: appointment.id,
                    contactId: appointment.contact_id,
                    startAt: appointment.start_at,
                });
                return;
            }

            if (!confirmed) return;

            this.logger.log(`[Pago] cita ${appointment.id} confirmada tras acreditarse el pago`);
            // Confirmar en la base no es confirmarle al cliente.
            await this.notifier?.notifyCustomer({
                tenantId: event.tenantId,
                conversationId: appointment.conversation_id,
                contactId: appointment.contact_id,
                text: paymentConfirmedText(undefined, 'tu cita'),
                dedupeId: `pay-ok-appointment-${appointment.id}`,
            });
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
