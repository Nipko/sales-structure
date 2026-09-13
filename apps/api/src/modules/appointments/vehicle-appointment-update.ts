import { ConflictException } from '@nestjs/common';
import { lockAndAssertAppointmentCapacity, type AppointmentTenantQuery } from './appointment-capacity.util';
import { appointmentVehicleId, VehicleAppointmentError } from './vehicle-appointment-capacity';
import { assertAppointmentServiceTerms } from './appointment-service-terms';
import { operationalContactWasErased } from '../operational-notices/operational-notice-outbox';
import type { EvalNamespaceLease } from '../simulation/isolated-eval-namespace';

export interface VehicleAppointmentUpdate {
    startAt: string;
    endAt: string;
    assignedTo: string | null;
    status: string;
    location: string | null;
    notes: string | null;
}

/** Resource locks precede the row update, matching the create/settlement lock order.
 * A concurrent payment, cancellation or edit invalidates the snapshot instead of
 * being overwritten by an older dashboard request.
 */
export async function updateVehicleAppointment(
    query: AppointmentTenantQuery, schemaName: string, snapshot: any, next: VehicleAppointmentUpdate,
    sandboxNamespace?: EvalNamespaceLease,
): Promise<void> {
    const vehicleId = appointmentVehicleId(snapshot.metadata);
    if (!vehicleId) throw new VehicleAppointmentError('appointment_vehicle_invalid');
    await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schemaName}`]);
    if (await operationalContactWasErased(query, snapshot.contact_id)) throw new ConflictException({ error: 'contact_erased' });
    const terminal = ['cancelled', 'completed', 'no_show'];
    if (terminal.includes(snapshot.status) || !['pending', 'pending_payment', 'confirmed', ...terminal].includes(next.status)) {
        throw new ConflictException({ error: 'test_drive_status_transition_requires_review' });
    }
    if (next.status === 'pending_payment' && snapshot.status !== 'pending_payment'
        || snapshot.status === 'pending_payment' && !['pending_payment', 'cancelled'].includes(next.status)) {
        throw new ConflictException({ error: 'test_drive_payment_settlement_required' });
    }
    if (['completed', 'no_show'].includes(next.status) && snapshot.status !== 'confirmed') {
        throw new ConflictException({ error: 'test_drive_status_transition_requires_review' });
    }
    const schedulingChanged = next.startAt !== snapshot.start_local || next.endAt !== snapshot.end_local
        || next.assignedTo !== snapshot.assigned_to;
    if (terminal.includes(next.status) && schedulingChanged) {
        throw new ConflictException({ error: 'test_drive_terminal_schedule_change' });
    }
    if (schedulingChanged || next.status === 'confirmed' && snapshot.status !== 'confirmed') {
        if (!snapshot.metadata?.vehicleTerms || !snapshot.metadata?.serviceTerms) {
            throw new ConflictException({ error: 'test_drive_legacy_review_required' });
        }
        const service = await lockAndAssertAppointmentCapacity(query, {
            schemaName, serviceId: snapshot.service_id, staffUserId: next.assignedTo,
            startAt: next.startAt, endAt: next.endAt, excludeAppointmentId: snapshot.id,
            vehicleId, expectedVehicleTerms: snapshot.metadata.vehicleTerms, sandboxNamespace,
        });
        assertAppointmentServiceTerms(snapshot.metadata.serviceTerms, service);
    }
    const changed = await query<any[]>(`UPDATE appointments SET start_at=$2::timestamp, end_at=$3::timestamp,
        assigned_to=$4::uuid, status=$5::text, location=$6, notes=$7, updated_at=NOW(),
        completed_at=CASE WHEN $5::text='completed' THEN NOW() ELSE completed_at END,
        completed_by=CASE WHEN $5::text='completed' THEN 'staff' ELSE completed_by END
        WHERE id=$1::uuid AND updated_at::text=$8 AND metadata=$9::jsonb
          AND status=$10 AND contact_id=$11::uuid RETURNING id`,
    [snapshot.id, next.startAt, next.endAt, next.assignedTo, next.status, next.location, next.notes,
        snapshot.update_revision, JSON.stringify(snapshot.metadata), snapshot.status, snapshot.contact_id]);
    if (changed.length !== 1) throw new ConflictException({ error: 'test_drive_changed_concurrently' });
}
