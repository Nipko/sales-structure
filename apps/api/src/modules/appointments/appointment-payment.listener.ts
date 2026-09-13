import { ensureOperationalNoticeOutbox, enqueueOperationalNotice, operationalContactWasErased } from '../operational-notices/operational-notice-outbox';
import { OperationalNoticeService } from '../operational-notices/operational-notice.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';
import { Cron } from '@nestjs/schedule';
import { CronLockService } from '../redis/cron-lock.service';
import { lockAndAssertAppointmentCapacity, lockAppointmentCapacityResources, AppointmentSlotConflictError, AppointmentServiceUnavailableError } from './appointment-capacity.util';
import { appointmentVehicleId, VehicleAppointmentError } from './vehicle-appointment-capacity';

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
        @Optional() private readonly notices?: OperationalNoticeService,
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
                await ensureOperationalNoticeOutbox(this.prisma,tenant.schemaName);
                const rows = await this.prisma.executeInTenantSchema<any[]>(tenant.schemaName,
                    `SELECT id FROM appointments WHERE payment_status = 'paid'
                     AND status IN ('pending_payment', 'expired', 'confirmed')
                     AND (status<>'confirmed' OR NOT EXISTS(SELECT 1 FROM operational_notice_outbox n WHERE n.entity_id=appointments.id AND n.kind='appointment.payment_confirmed'))
                     ORDER BY updated_at LIMIT 100`);
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
            await ensureOperationalNoticeOutbox(this.prisma,schemaName);

            let appointment: any;
            let unavailable = false;
            const confirmed = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schemaName}`]);
                const appointmentSql = `SELECT id, service_id, assigned_to,
                            to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at,
                            to_char(end_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_at, status, payment_status,
                            contact_id, conversation_id, metadata, updated_at::text AS update_revision FROM appointments WHERE id = $1::uuid`;
                const [snapshot] = await query<any[]>(appointmentSql, [event.entityId]);
                if (!snapshot || snapshot.payment_status !== 'paid') return false;
                // Match create/reschedule ordering: resource locks before the row.
                // Never hold a row while waiting for a resource owned by its editor.
                await lockAppointmentCapacityResources(query, {
                    schemaName, serviceId: snapshot.service_id, staffUserId: snapshot.assigned_to,
                    startAt: snapshot.start_at, endAt: snapshot.end_at, vehicleId: appointmentVehicleId(snapshot.metadata),
                });
                [appointment] = await query<any[]>(`${appointmentSql} FOR UPDATE`, [event.entityId]);
                if (JSON.stringify(snapshot) !== JSON.stringify(appointment)) return false;
                // Only settlement recorded on this tenant-owned row can confirm it.
                if (!appointment || appointment.payment_status !== 'paid' || appointment.metadata?.source === 'eval_gate') return false;
                if (await operationalContactWasErased(query,appointment.contact_id)) return false;
                if (appointment.status==='confirmed') {
                    await enqueueOperationalNotice(query,schemaName,{kind:'appointment.payment_confirmed',entityId:appointment.id,
                        contactId:appointment.contact_id,conversationId:appointment.conversation_id,historical:true});
                    return false;
                }
                if (!['pending_payment','expired'].includes(appointment.status)) return false;
                try {
                    if (appointmentVehicleId(appointment.metadata) && !appointment.metadata?.vehicleTerms) throw new VehicleAppointmentError('test_drive_legacy_review_required');
                    await lockAndAssertAppointmentCapacity(query, {
                        schemaName, serviceId: appointment.service_id, staffUserId: appointment.assigned_to,
                        startAt: appointment.start_at, endAt: appointment.end_at, excludeAppointmentId: appointment.id,
                        vehicleId: appointmentVehicleId(appointment.metadata), expectedVehicleTerms: appointment.metadata?.vehicleTerms,
                    });
                } catch (error) {
                    if (!(error instanceof AppointmentSlotConflictError) && !(error instanceof AppointmentServiceUnavailableError) && !(error instanceof VehicleAppointmentError)) throw error;
                    unavailable = !appointment.metadata?.paymentConfirmationIssue;
                    await query(`UPDATE appointments SET metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('paymentConfirmationIssue', 'availability_requires_review'), updated_at = NOW()
                        WHERE id = $1::uuid`, [appointment.id]);
                    await enqueueOperationalNotice(query,schemaName,{kind:'appointment.payment_review',entityId:appointment.id,
                        contactId:appointment.contact_id,conversationId:appointment.conversation_id,historical:!unavailable});
                    return false;
                }
                await query(`UPDATE appointments SET status = 'confirmed', hold_expires_at = NULL,
                    metadata = COALESCE(metadata, '{}'::jsonb) - 'paymentConfirmationIssue', updated_at = NOW()
                    WHERE id = $1::uuid`, [appointment.id]);
                await CalendarSyncOutboxService.enqueueWithTransaction(query, appointment.id, 'upsert');
                await enqueueOperationalNotice(query,schemaName,{kind:'appointment.payment_confirmed',entityId:appointment.id,
                    contactId:appointment.contact_id,conversationId:appointment.conversation_id});
                return true;
            });

            if (unavailable) {
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

            if (!confirmed) return;

            this.logger.log(`[Pago] cita ${appointment.id} confirmada tras acreditarse el pago`);
            await this.notices?.recoverTenant(event.tenantId);
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
