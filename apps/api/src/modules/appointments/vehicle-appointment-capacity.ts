import { dayOfWeekForLocalDate, type AppointmentTenantQuery } from './appointment-capacity.util';
import { holdStillAliveSql } from '../../common/utils/payment-policy.util';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { tenantActorDirectoryWithQuery } from './tenant-user-scope.util';
import type { EvalNamespaceLease } from '../simulation/isolated-eval-namespace';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class VehicleAppointmentError extends Error {
    constructor(readonly vehicleCode: string) { super(vehicleCode); }
}
export interface VehicleAppointmentTerms {version:1;vehicleId:string;label:string;identityHash:string}
export function vehicleAppointmentTerms(row: any): VehicleAppointmentTerms {
    if (!row || !UUID.test(row.id) || row.status !== 'available') throw new VehicleAppointmentError('appointment_vehicle_unavailable');
    return {version:1,vehicleId:row.id,label:[row.make,row.model,row.year,row.trim_level].filter(Boolean).join(' '),
        identityHash:revisionHash([row.id,row.make,row.model,row.year,row.trim_level??null,row.vin??null,row.license_plate??null])};
}
export function appointmentVehicleId(metadata: unknown): string | undefined {
    const value = (metadata as any)?.vehicleId ?? (metadata as any)?.vehicle_id;
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || !UUID.test(value)) throw new VehicleAppointmentError('appointment_vehicle_invalid');
    return value;
}
export type VehicleAppointmentCapacity = { schemaName: string; vehicleId: string; staffUserId: string | null;
    startAt: string; endAt: string; excludeAppointmentId?: string; expectedVehicleTerms?: VehicleAppointmentTerms;
    sandboxNamespace?: EvalNamespaceLease };

/** Read-only candidate filtering; the canonical writer must recheck under resource locks. */
export async function vehicleAppointmentBusyIntervals(query: AppointmentTenantQuery,vehicleId:string,date:string):Promise<Array<{start:string;end:string}>> {
    if(!UUID.test(vehicleId))throw new VehicleAppointmentError('appointment_vehicle_invalid');
    const [vehicle]=await query<any[]>('SELECT id,make,model,year,trim_level,vin,license_plate,status FROM vehicles WHERE id=$1::uuid',[vehicleId]);
    vehicleAppointmentTerms(vehicle);
    const rows=await query<any[]>(`SELECT to_char(start_at,'YYYY-MM-DD"T"HH24:MI:SS') AS start,to_char(end_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "end"
        FROM appointments WHERE COALESCE(metadata->>'vehicleId',metadata->>'vehicle_id')=$1
        AND status<>'cancelled' AND ${holdStillAliveSql()}
        AND start_at < $2::date + interval '1 day' AND end_at > $2::date`,[vehicleId,date]);
    const [legacyTable]=await query<any[]>("SELECT to_regclass('test_drives')::text AS name");
    if(legacyTable?.name){
        const legacy=await query<any[]>(`SELECT to_char(scheduled_date+scheduled_time,'YYYY-MM-DD"T"HH24:MI:SS') AS start,
            CASE WHEN duration_min>0 THEN to_char(scheduled_date+scheduled_time+duration_min*interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS') END AS "end"
            FROM test_drives WHERE vehicle_id=$1::uuid AND (status IS NULL OR status NOT IN ('cancelled','completed'))
            AND scheduled_date+scheduled_time < $2::date+interval '1 day'
            AND (duration_min IS NULL OR duration_min<=0 OR scheduled_date+scheduled_time+duration_min*interval '1 minute'>$2::date)`,[vehicleId,date]);
        if(legacy.some(row=>!row.end))throw new VehicleAppointmentError('test_drive_legacy_review_required');
        rows.push(...legacy);
    }
    return rows;
}

/** Caller holds the appointment capacity locks and vehicle row until its write commits.
 * Legacy rows remain historical evidence; overlapping unresolved rows require review.
 * This verifies the local agenda, never an external provider's confirmation.
 */
export async function assertVehicleAppointmentCapacity(query: AppointmentTenantQuery, input: VehicleAppointmentCapacity): Promise<VehicleAppointmentTerms> {
    if (!UUID.test(input.vehicleId)) throw new VehicleAppointmentError('appointment_vehicle_invalid');
    const [vehicle] = await query<any[]>('SELECT id,make,model,year,trim_level,vin,license_plate,status FROM vehicles WHERE id=$1::uuid FOR SHARE', [input.vehicleId]);
    const terms=vehicleAppointmentTerms(vehicle);
    if(input.expectedVehicleTerms && revisionHash(input.expectedVehicleTerms)!==revisionHash(terms)) throw new VehicleAppointmentError('test_drive_vehicle_terms_changed');
    if (!input.staffUserId || !UUID.test(input.staffUserId)) throw new VehicleAppointmentError('test_drive_staff_required');
    const directory = await tenantActorDirectoryWithQuery(query, input.schemaName, input.sandboxNamespace);
    const staff = await query<any[]>(`SELECT staff.id FROM ${directory.users} staff JOIN ${directory.tenants} owner ON owner.id=staff.tenant_id
        WHERE staff.id=$1::uuid AND staff.is_active=true AND owner.is_active=true AND owner.schema_name=$2 FOR SHARE OF staff,owner`,
    [input.staffUserId, input.schemaName]);
    if (staff.length !== 1) throw new VehicleAppointmentError('test_drive_staff_unavailable');
    if (input.startAt.slice(0, 10) !== input.endAt.slice(0, 10)) throw new VehicleAppointmentError('test_drive_day_interval_required');
    // Fence insertions as well as edits: a newly inserted blocked day must not
    // cross the authoritative availability check and the appointment commit.
    await query('LOCK TABLE availability_slots, blocked_dates IN SHARE MODE');
    const windows = await query<any[]>(`SELECT id FROM availability_slots WHERE user_id=$1::uuid AND day_of_week=$2
        AND is_active=true AND start_time <= $3::time AND end_time >= $4::time FOR SHARE`,
    [input.staffUserId, dayOfWeekForLocalDate(input.startAt), input.startAt.slice(11), input.endAt.slice(11)]);
    if (!windows.length) throw new VehicleAppointmentError('test_drive_staff_availability_unverified');
    const blocked = await query<any[]>(`SELECT id FROM blocked_dates WHERE blocked_date=$1::date
        AND (user_id IS NULL OR user_id=$2::uuid)`, [input.startAt.slice(0,10), input.staffUserId]);
    if (blocked.length) throw new VehicleAppointmentError('test_drive_staff_unavailable');
    const occupied = await query<any[]>(`SELECT id FROM appointments WHERE COALESCE(metadata->>'vehicleId',metadata->>'vehicle_id')=$1
        AND status NOT IN ('cancelled') AND ${holdStillAliveSql()}
        AND start_at < $2::timestamp AND end_at > $3::timestamp AND ($4::uuid IS NULL OR id<>$4::uuid) LIMIT 1`,
    [input.vehicleId, input.endAt, input.startAt, input.excludeAppointmentId || null]);
    if (occupied.length) throw new VehicleAppointmentError('test_drive_vehicle_slot_unavailable');
    const [legacyTable] = await query<any[]>("SELECT to_regclass('test_drives')::text AS name");
    if (legacyTable?.name) {
        await query('LOCK TABLE test_drives IN SHARE MODE');
        const legacy = await query<any[]>(`SELECT id FROM test_drives WHERE vehicle_id=$1::uuid
            AND (status IS NULL OR status NOT IN ('cancelled','completed'))
            AND scheduled_date + scheduled_time < $2::timestamp
            AND (duration_min IS NULL OR duration_min<=0 OR scheduled_date + scheduled_time + duration_min*interval '1 minute' > $3::timestamp)
            LIMIT 1`, [input.vehicleId, input.endAt, input.startAt]);
        if (legacy.length) throw new VehicleAppointmentError('test_drive_legacy_review_required');
    }
    return terms;
}
