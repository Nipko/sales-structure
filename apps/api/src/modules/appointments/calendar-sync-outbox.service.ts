import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarIntegrationService } from './calendar-integration.service';

export type CalendarSyncOperation = 'upsert' | 'delete';
export type CalendarSyncState = 'not_configured' | 'pending' | 'processing' | 'synced' | 'failed' | 'reconciliation_required' | 'deleted';

export interface CalendarSyncOwner {
    integrationId: string;
    ownerUserId: string;
    provider: 'google' | 'microsoft';
}

export interface CalendarSyncOutboxPayload {
    appointmentId: string;
    integrationId: string;
    ownerUserId: string;
    provider: 'google' | 'microsoft';
    externalEventId: string | null;
    summary: string;
    startAt: string;
    endAt: string;
    location?: string;
    description?: string;
    attendeeEmail?: string;
    isOnline?: boolean;
}

type TenantQuery = <T = unknown>(sql: string, params?: unknown[]) => Promise<T>;

const MAX_ATTEMPTS = 10;
const LEASE_SECONDS = 90;
const BATCH_SIZE = 25;
// The integration layer aborts provider requests at 30s. The outbox gives up
// first so an unresolved lookup/token/request is classified as ambiguous and
// never automatically requeued while its underlying promise winds down.
const PROVIDER_DEADLINE_MS = 25_000;

/**
 * Transactional outbox for calendar ownership and provider synchronization.
 * Appointment writers call enqueueWithQuery inside the same tenant transaction;
 * only this worker performs remote provider I/O after the domain commit.
 */
@Injectable()
export class CalendarSyncOutboxService {
    private readonly logger = new Logger(CalendarSyncOutboxService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly calendars: CalendarIntegrationService,
    ) {}

    async enqueueWithQuery(
        query: TenantQuery,
        appointmentId: string,
        operation: CalendarSyncOperation,
    ): Promise<{ outboxId: string; revision: number } | null> {
        return CalendarSyncOutboxService.enqueueWithTransaction(query, appointmentId, operation);
    }

    /** Shared by canonical appointment writers without requiring provider I/O injection. */
    static async enqueueWithTransaction(
        query: TenantQuery,
        appointmentId: string,
        operation: CalendarSyncOperation,
    ): Promise<{ outboxId: string; revision: number } | null> {
        const appointments = await query<any[]>(
            `SELECT id, assigned_to, service_id, service_name,
                    to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at,
                    to_char(end_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_at,
                    location, notes, metadata, customer_email,
                    calendar_integration_id, calendar_owner_id, calendar_provider,
                    calendar_event_id, google_event_id, outlook_event_id,
                    COALESCE(calendar_sync_revision, 0) AS calendar_sync_revision
             FROM appointments
             WHERE id = $1::uuid
             FOR UPDATE`,
            [appointmentId],
        );
        const appointment = appointments?.[0];
        if (!appointment) throw new Error('Appointment not found while enqueuing calendar sync');

        const owner = await this.resolveOwner(query, appointment);
        if (!owner) {
            await query(
                `UPDATE appointments
                 SET calendar_sync_state = 'not_configured',
                     calendar_sync_error = NULL,
                     updated_at = NOW()
                 WHERE id = $1::uuid`,
                [appointmentId],
            );
            return null;
        }

        const revision = Number(appointment.calendar_sync_revision || 0) + 1;
        const outboxId = randomUUID();
        const idempotencyKey = this.idempotencyKey(appointmentId, revision, operation);
        const metadata = appointment.metadata || {};
        const ownedExternalEventId = appointment.calendar_event_id
            || (owner.provider === 'google'
                ? appointment.google_event_id
                : appointment.outlook_event_id)
            || null;
        const payload: CalendarSyncOutboxPayload = {
            appointmentId,
            integrationId: owner.integrationId,
            ownerUserId: owner.ownerUserId,
            provider: owner.provider,
            externalEventId: ownedExternalEventId,
            summary: appointment.service_name || 'Appointment',
            startAt: this.toIsoValue(appointment.start_at),
            endAt: this.toIsoValue(appointment.end_at),
            location: appointment.location || undefined,
            description: appointment.notes || undefined,
            attendeeEmail: appointment.customer_email || metadata.customerEmail || undefined,
            isOnline: metadata.isOnline === true,
        };

        // A newer revision may supersede only work that provably has not been
        // claimed. Failed/processing work can represent an ambiguous provider
        // result and must finish/reconcile before a later revision runs.
        await query(
            `UPDATE calendar_sync_outbox
             SET state = 'superseded', updated_at = NOW()
             WHERE appointment_id = $1::uuid
               AND state = 'pending'`,
            [appointmentId],
        );
        await query(
            `UPDATE appointments
             SET calendar_integration_id = $2::uuid,
                 calendar_owner_id = $3::uuid,
                 calendar_provider = $4,
                 calendar_sync_state = 'pending',
                 calendar_sync_revision = $5,
                 calendar_sync_error = NULL,
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [appointmentId, owner.integrationId, owner.ownerUserId, owner.provider, revision],
        );
        await query(
            `INSERT INTO calendar_sync_outbox
                (id, appointment_id, operation, revision, idempotency_key,
                 integration_id, provider, payload, state, next_attempt_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8::jsonb,
                     'pending', NOW())
             ON CONFLICT (appointment_id, revision, operation) DO NOTHING`,
            [
                outboxId,
                appointmentId,
                operation,
                revision,
                idempotencyKey,
                owner.integrationId,
                owner.provider,
                JSON.stringify(payload),
            ],
        );
        return { outboxId, revision };
    }

    async processTenant(schemaName: string): Promise<number> {
        let processed = 0;
        // Claim immediately before provider I/O. Claiming 25 rows with one
        // 90-second lease let rows near the end expire before their request
        // even started, allowing a second worker to perform overlapping I/O.
        while (processed < BATCH_SIZE) {
            const leaseToken = randomUUID();
            const claimed = await this.prisma.transactionInTenantSchema(schemaName, async (query) => (
                query<any[]>(
                `WITH due AS (
                    SELECT id
                    FROM calendar_sync_outbox
                    WHERE state IN ('pending', 'failed')
                      AND attempts < $1
                      AND next_attempt_at <= NOW()
                      AND NOT EXISTS (
                          SELECT 1
                          FROM calendar_sync_outbox earlier
                          WHERE earlier.appointment_id = calendar_sync_outbox.appointment_id
                            AND earlier.revision < calendar_sync_outbox.revision
                            AND earlier.state IN ('processing', 'failed', 'reconciliation_required')
                      )
                    ORDER BY revision, created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                 )
                 UPDATE calendar_sync_outbox o
                 SET state = 'processing',
                     attempts = o.attempts + 1,
                     lease_token = $2::uuid,
                     lease_expires_at = NOW() + make_interval(secs => $3),
                     updated_at = NOW()
                 FROM due
                 WHERE o.id = due.id
                 RETURNING o.*`,
                    [MAX_ATTEMPTS, leaseToken, LEASE_SECONDS],
                )
            ));
            const row = claimed?.[0];
            if (!row) break;
            await this.processClaimed(schemaName, row, leaseToken);
            processed += 1;
        }
        return processed;
    }

    async reconcileTenant(schemaName: string): Promise<number> {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const expiredLeases = await query<any[]>(
                `UPDATE calendar_sync_outbox
                 SET state = 'reconciliation_required', lease_token = NULL,
                     lease_expires_at = NULL,
                     last_error = 'calendar_sync_lease_expired_ambiguous',
                     updated_at = NOW()
                 WHERE state = 'processing' AND lease_expires_at < NOW()
                 RETURNING appointment_id, revision`,
            );
            for (const row of expiredLeases || []) {
                await query(
                    `UPDATE appointments
                     SET calendar_sync_state = 'reconciliation_required',
                         calendar_sync_error = 'calendar_reconciliation_required',
                         updated_at = NOW()
                     WHERE id = $1::uuid AND calendar_sync_revision = $2`,
                    [row.appointment_id, row.revision],
                );
            }

            const exhausted = await query<any[]>(
                `UPDATE calendar_sync_outbox
                 SET state = 'reconciliation_required', lease_token = NULL,
                     lease_expires_at = NULL,
                     last_error = COALESCE(last_error, 'calendar_sync_attempts_exhausted'),
                     updated_at = NOW()
                 WHERE state = 'failed' AND attempts >= $1
                 RETURNING appointment_id, revision`,
                [MAX_ATTEMPTS],
            );
            for (const row of exhausted || []) {
                await query(
                    `UPDATE appointments
                     SET calendar_sync_state = 'reconciliation_required',
                         calendar_sync_error = 'calendar_reconciliation_required',
                         updated_at = NOW()
                     WHERE id = $1::uuid AND calendar_sync_revision = $2`,
                    [row.appointment_id, row.revision],
                );
            }

            // An inactive/missing owner can never be considered synchronized.
            await query(
                `UPDATE appointments a
                 SET calendar_sync_state = 'reconciliation_required',
                     calendar_sync_error = 'calendar_integration_unavailable',
                     updated_at = NOW()
                 WHERE a.calendar_integration_id IS NOT NULL
                   AND a.calendar_sync_state IN ('pending', 'synced')
                   AND NOT EXISTS (
                       SELECT 1 FROM calendar_integrations ci
                       WHERE ci.id = a.calendar_integration_id AND ci.is_active = true
                   )`,
            );

            const missing = await query<any[]>(
                `SELECT a.id,
                        CASE WHEN a.status = 'cancelled' THEN 'delete' ELSE 'upsert' END AS operation
                 FROM appointments a
                 WHERE a.calendar_sync_state IN ('pending', 'failed')
                   AND NOT EXISTS (
                       SELECT 1 FROM calendar_sync_outbox o
                       WHERE o.appointment_id = a.id
                         AND o.state IN ('pending', 'processing', 'failed', 'reconciliation_required')
                   )
                 ORDER BY a.updated_at
                 LIMIT $1
                 FOR UPDATE OF a SKIP LOCKED`,
                [BATCH_SIZE],
            );
            for (const row of missing || []) {
                await this.enqueueWithQuery(query, row.id, row.operation);
            }
            return missing?.length || 0;
        });
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async processAllTenants(): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { schemaName: true },
        });
        for (const tenant of tenants) {
            try {
                await this.processTenant(tenant.schemaName);
            } catch (error: any) {
                this.logger.warn(`Calendar outbox failed for ${tenant.schemaName}: ${this.sanitizeError(error)}`);
            }
        }
    }

    @Cron('17 */15 * * * *')
    async reconcileAllTenants(): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { schemaName: true },
        });
        for (const tenant of tenants) {
            try {
                await this.reconcileTenant(tenant.schemaName);
            } catch (error: any) {
                this.logger.warn(`Calendar reconciliation failed for ${tenant.schemaName}: ${this.sanitizeError(error)}`);
            }
        }
    }

    private async processClaimed(schemaName: string, row: any, leaseToken: string): Promise<void> {
        const payload = row.payload as CalendarSyncOutboxPayload;
        try {
            let externalEventId = payload.externalEventId;
            let meetingUrl: string | undefined;

            if (row.operation === 'delete') {
                if (externalEventId) {
                    const deleted = await this.withProviderDeadline(
                        this.calendars.deleteEventForIntegration(
                            schemaName,
                            payload.integrationId,
                            externalEventId,
                        ),
                    );
                    if (!deleted) throw new Error('calendar_provider_delete_failed');
                }
            } else if (externalEventId) {
                const updated = await this.withProviderDeadline(
                    this.calendars.updateEventForIntegration(
                        schemaName,
                        payload.integrationId,
                        externalEventId,
                        payload,
                    ),
                );
                if (!updated) throw new Error('calendar_provider_update_failed');
            } else {
                const created = await this.withProviderDeadline(
                    this.calendars.createEventForIntegration(
                        schemaName,
                        payload.integrationId,
                        {
                            ...payload,
                            idempotencyKey: row.idempotency_key,
                        },
                    ),
                );
                if (!created.eventId) throw new Error('calendar_provider_create_failed');
                externalEventId = created.eventId;
                meetingUrl = created.meetingUrl;
            }

            await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                const completed = await query<any[]>(
                    `UPDATE calendar_sync_outbox
                     SET state = 'completed', lease_token = NULL, lease_expires_at = NULL,
                         completed_at = NOW(), last_error = NULL,
                         provider_event_id = $3, updated_at = NOW()
                     WHERE id = $1::uuid AND lease_token = $2::uuid AND state = 'processing'
                     RETURNING id`,
                    [row.id, leaseToken, externalEventId],
                );
                if (!completed?.length) return;
                const ownerRows = await query<any[]>(
                    `SELECT calendar_integration_id, calendar_sync_revision
                     FROM appointments WHERE id = $1::uuid FOR UPDATE`,
                    [payload.appointmentId],
                );
                const currentOwner = ownerRows?.[0]?.calendar_integration_id || null;
                if (
                    externalEventId
                    && row.operation !== 'delete'
                    && currentOwner
                    && currentOwner !== payload.integrationId
                ) {
                    // Explicit reassignment raced with a provider create. Do not
                    // let the newer revision create again until the exact old
                    // owner/event has been compensated.
                    await query(
                        `UPDATE calendar_sync_outbox
                         SET state = 'superseded', last_error = 'calendar_owner_changed_during_sync',
                             updated_at = NOW()
                         WHERE appointment_id = $1::uuid AND revision > $2
                           AND state IN ('pending', 'failed')`,
                        [payload.appointmentId, row.revision],
                    );
                    await query(
                        `INSERT INTO calendar_sync_outbox
                            (id, appointment_id, operation, revision, idempotency_key,
                             integration_id, provider, payload, state, next_attempt_at)
                         VALUES ($1::uuid, $2::uuid, 'delete', $3, $4, $5::uuid, $6,
                                 $7::jsonb, 'pending', NOW())
                         ON CONFLICT (appointment_id, revision, operation) DO NOTHING`,
                        [
                            randomUUID(),
                            payload.appointmentId,
                            row.revision,
                            `${row.idempotency_key}:compensate-delete`,
                            payload.integrationId,
                            payload.provider,
                            JSON.stringify({ ...payload, externalEventId }),
                        ],
                    );
                    await query(
                        `UPDATE appointments
                         SET calendar_sync_state = 'failed',
                             calendar_sync_error = 'calendar_owner_changed_during_sync',
                             updated_at = NOW()
                         WHERE id = $1::uuid`,
                        [payload.appointmentId],
                    );
                    return;
                }
                // If revision N was already superseded while its provider call
                // was in flight, carry the exact provider event into N+1 before
                // N+1 can be claimed. This avoids creating an orphan duplicate.
                if (externalEventId && row.operation !== 'delete') {
                    await query(
                        `UPDATE calendar_sync_outbox
                         SET payload = jsonb_set(payload, '{externalEventId}', to_jsonb($3::text), true),
                             updated_at = NOW()
                         WHERE appointment_id = $1::uuid
                           AND revision > $2
                           AND integration_id = $4::uuid
                           AND state IN ('pending', 'failed')
                           AND COALESCE(payload->>'externalEventId', '') = ''`,
                        [payload.appointmentId, row.revision, externalEventId, payload.integrationId],
                    );
                    await query(
                        `UPDATE appointments
                         SET calendar_event_id = COALESCE(calendar_event_id, $2),
                             google_event_id = CASE WHEN $3 = 'google'
                                THEN COALESCE(google_event_id, $2) ELSE google_event_id END,
                             outlook_event_id = CASE WHEN $3 = 'microsoft'
                                THEN COALESCE(outlook_event_id, $2) ELSE outlook_event_id END,
                             updated_at = NOW()
                         WHERE id = $1::uuid AND calendar_integration_id = $4::uuid`,
                        [payload.appointmentId, externalEventId, payload.provider, payload.integrationId],
                    );
                }
                await query(
                    `UPDATE appointments
                     SET calendar_event_id = $2,
                         google_event_id = CASE WHEN $3 = 'google' THEN $2 ELSE google_event_id END,
                         outlook_event_id = CASE WHEN $3 = 'microsoft' THEN $2 ELSE outlook_event_id END,
                         calendar_sync_state = $4,
                         calendar_sync_error = NULL,
                         calendar_synced_at = NOW(),
                         metadata = CASE WHEN $5::text IS NULL THEN COALESCE(metadata, '{}'::jsonb)
                            ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('meetingUrl', $5::text) END,
                         updated_at = NOW()
                     WHERE id = $1::uuid AND calendar_sync_revision = $6`,
                    [
                        payload.appointmentId,
                        externalEventId,
                        payload.provider,
                        row.operation === 'delete' ? 'deleted' : 'synced',
                        meetingUrl || null,
                        row.revision,
                    ],
                );
            });
        } catch (error: any) {
            const sanitized = this.sanitizeError(error);
            const delaySeconds = Math.min(3600, 2 ** Math.min(Number(row.attempts || 1), 10) * 15);
            await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                const reconciliationRequired = Number(row.attempts || 0) >= MAX_ATTEMPTS
                    || sanitized === 'calendar_provider_deadline_exceeded';
                const failed = await query<any[]>(
                    `UPDATE calendar_sync_outbox
                     SET state = $5, lease_token = NULL, lease_expires_at = NULL,
                         last_error = $3, next_attempt_at = NOW() + make_interval(secs => $4),
                         updated_at = NOW()
                     WHERE id = $1::uuid AND lease_token = $2::uuid AND state = 'processing'
                     RETURNING appointment_id, revision`,
                    [
                        row.id,
                        leaseToken,
                        sanitized,
                        delaySeconds,
                        reconciliationRequired ? 'reconciliation_required' : 'failed',
                    ],
                );
                if (failed?.length) {
                    await query(
                        `UPDATE appointments
                         SET calendar_sync_state = $4, calendar_sync_error = $2, updated_at = NOW()
                         WHERE id = $1::uuid AND calendar_sync_revision = $3`,
                        [
                            payload.appointmentId,
                            reconciliationRequired ? 'calendar_reconciliation_required' : sanitized,
                            row.revision,
                            reconciliationRequired ? 'reconciliation_required' : 'failed',
                        ],
                    );
                }
            });
        }
    }

    private async withProviderDeadline<T>(operation: Promise<T>): Promise<T> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
                () => reject(new Error('calendar_provider_deadline_exceeded')),
                PROVIDER_DEADLINE_MS,
            );
            timeout.unref?.();
        });
        try {
            return await Promise.race([operation, deadline]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    private static async resolveOwner(query: TenantQuery, appointment: any): Promise<CalendarSyncOwner | null> {
        if (appointment.calendar_integration_id) {
            const exact = await query<any[]>(
                `SELECT ci.id, ci.user_id, ci.provider
                 FROM calendar_integrations ci
                 JOIN public.users owner_user
                   ON owner_user.id = ci.user_id AND owner_user.is_active = true
                 JOIN public.tenants owner_tenant
                   ON owner_tenant.id = owner_user.tenant_id
                  AND owner_tenant.schema_name = current_schema()
                  AND owner_tenant.is_active = true
                 WHERE ci.id = $1::uuid AND ci.is_active = true`,
                [appointment.calendar_integration_id],
            );
            if (exact?.length) return this.mapOwner(exact[0]);
            // Once an external event has an owner, never fail over implicitly:
            // another account could create a duplicate or receive a delete for
            // an event it does not own. Reassignment is a separate explicit flow.
            throw new Error('calendar_owner_reconciliation_required');
        }

        // Legacy rows may have a provider event but no durable integration
        // owner. Selecting a currently-active general/staff account here could
        // patch or delete an event belonging to a different account. These
        // records require an explicit ownership reconciliation first.
        if (
            appointment.calendar_event_id
            || appointment.google_event_id
            || appointment.outlook_event_id
        ) {
            throw new Error('calendar_owner_reconciliation_required');
        }

        if (appointment.service_id) {
            const service = await query<any[]>(
                `SELECT ci.id, ci.user_id, ci.provider
                 FROM calendar_integrations ci
                 JOIN public.users owner_user
                   ON owner_user.id = ci.user_id AND owner_user.is_active = true
                 JOIN public.tenants owner_tenant
                   ON owner_tenant.id = owner_user.tenant_id
                  AND owner_tenant.schema_name = current_schema()
                  AND owner_tenant.is_active = true
                 WHERE ci.assignment_type = 'service'
                   AND ci.assignment_id = $1::uuid AND ci.is_active = true
                 ORDER BY ci.connected_at, ci.id LIMIT 1`,
                [appointment.service_id],
            );
            if (service?.length) return this.mapOwner(service[0]);
        }

        if (appointment.assigned_to) {
            const staff = await query<any[]>(
                `SELECT ci.id, ci.user_id, ci.provider
                 FROM staff_operational_bindings b
                 JOIN staff_members staff
                   ON staff.id = b.staff_id
                  AND staff.is_active = true
                 JOIN calendar_integrations ci
                   ON ci.is_active = true
                  AND (
                       ci.id = b.calendar_integration_id
                       OR (ci.assignment_type = 'staff' AND ci.assignment_id = b.staff_id)
                  )
                 JOIN public.users owner_user
                   ON owner_user.id = ci.user_id AND owner_user.is_active = true
                 JOIN public.tenants owner_tenant
                   ON owner_tenant.id = owner_user.tenant_id
                  AND owner_tenant.schema_name = current_schema()
                  AND owner_tenant.is_active = true
                 WHERE b.user_id = $1::uuid
                 ORDER BY
                   CASE WHEN ci.id = b.calendar_integration_id THEN 0 ELSE 1 END,
                   ci.connected_at, ci.id
                 LIMIT 1`,
                [appointment.assigned_to],
            );
            if (staff?.length) return this.mapOwner(staff[0]);

            const unreconciledLegacyStaff = await query<any[]>(
                `SELECT legacy_ci.id
                   FROM calendar_integrations legacy_ci
                  WHERE legacy_ci.is_active = true
                    AND legacy_ci.assignment_type = 'staff'
                    AND legacy_ci.assignment_id = $1::uuid
                    AND NOT EXISTS (
                        SELECT 1
                          FROM staff_operational_bindings b
                          JOIN staff_members staff
                            ON staff.id = b.staff_id
                           AND staff.is_active = true
                         WHERE b.user_id = $1::uuid
                    )
                  ORDER BY legacy_ci.connected_at, legacy_ci.id
                  LIMIT 1`,
                [appointment.assigned_to],
            );
            if (unreconciledLegacyStaff?.length) {
                throw new Error('calendar_staff_binding_reconciliation_required');
            }
        }

        const general = await query<any[]>(
            `SELECT ci.id, ci.user_id, ci.provider
             FROM calendar_integrations ci
             JOIN public.users owner_user
               ON owner_user.id = ci.user_id AND owner_user.is_active = true
             JOIN public.tenants owner_tenant
               ON owner_tenant.id = owner_user.tenant_id
              AND owner_tenant.schema_name = current_schema()
              AND owner_tenant.is_active = true
             WHERE ci.assignment_type = 'general' AND ci.is_active = true
             ORDER BY ci.connected_at, ci.id LIMIT 1`,
        );
        return general?.length ? this.mapOwner(general[0]) : null;
    }

    private static mapOwner(row: any): CalendarSyncOwner {
        if (row.provider !== 'google' && row.provider !== 'microsoft') {
            throw new Error('unsupported_calendar_provider');
        }
        return {
            integrationId: row.id,
            ownerUserId: row.user_id,
            provider: row.provider,
        };
    }

    private static idempotencyKey(appointmentId: string, revision: number, operation: string): string {
        return `appointment:${appointmentId}:calendar:${revision}:${operation}`;
    }

    private static toIsoValue(value: unknown): string {
        if (value instanceof Date) return value.toISOString();
        return String(value);
    }

    private sanitizeError(error: any): string {
        const raw = String(error?.message || error || 'calendar_sync_failed');
        return raw
            .replace(/https?:\/\/\S+/gi, '[url]')
            .replace(/(?:token|secret|authorization|credential)\s*[=:]\s*\S+/gi, '$1=[redacted]')
            .replace(/[\r\n\t]+/g, ' ')
            .slice(0, 500);
    }
}
