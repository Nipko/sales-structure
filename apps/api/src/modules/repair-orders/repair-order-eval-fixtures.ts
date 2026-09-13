import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import type { EvalNamespaceQuery } from '../simulation/isolated-eval-namespace';

export const REPAIR_EVAL_IDS = Object.freeze({
    repairVehicle: '00000000-0000-4000-8000-00000000b020',
    repairOrder: '00000000-0000-4000-8000-00000000b021',
    busyRepairOrder: '00000000-0000-4000-8000-00000000b022',
    otherRepairContact: '00000000-0000-4000-8000-00000000b023',
    otherRepairVehicle: '00000000-0000-4000-8000-00000000b024',
    otherRepairOrder: '00000000-0000-4000-8000-00000000b025',
});

/** Explicit synthetic technician-authored estimates; never copied from a live customer. */
export async function prepareRepairEvalFixtures(query: EvalNamespaceQuery, schema: string): Promise<void> {
    if (!/^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/.test(schema)) throw new Error('eval_fixture_namespace_required');
    const table = (name: string) => `"${schema}".${name}`, ids = REPAIR_EVAL_IDS;
    await query(`INSERT INTO ${table('contacts')} (id,external_id,channel_type,name)
        VALUES($1::uuid,'eval-repair-other-owner','web_widget','[EVAL] Other vehicle owner')`, [ids.otherRepairContact]);
    for (const [id, owner, plate] of [[ids.repairVehicle, EVAL_SANDBOX_CONTACT_ID, 'EVAL123'], [ids.otherRepairVehicle, ids.otherRepairContact, 'OTHER456']]) {
        await query(`INSERT INTO ${table('customer_vehicles')} (id,contact_id,make,model,license_plate,metadata)
            VALUES($1::uuid,$2::uuid,'Mazda','3',$3,'{"evalSandbox":true}')`, [id, owner, plate]);
    }
    for (const [id, owner, vehicle, status, approval] of [
        [ids.repairOrder, EVAL_SANDBOX_CONTACT_ID, ids.repairVehicle, 'awaiting_approval', 'pending'],
        [ids.busyRepairOrder, EVAL_SANDBOX_CONTACT_ID, ids.repairVehicle, 'in_progress', 'approved'],
        [ids.otherRepairOrder, ids.otherRepairContact, ids.otherRepairVehicle, 'awaiting_approval', 'pending'],
    ]) {
        await query(`INSERT INTO ${table('repair_orders')} (id,contact_id,vehicle_id,customer_concern,status,approval_status,
            estimate_amount_cents,currency,estimate_line_items,external_id,metadata,version)
            VALUES($1::uuid,$2::uuid,$3::uuid,'[EVAL] Existing repair',$4,$5,12000,'COP',
                '[{"description":"[EVAL] Inspection","quantity":1,"unitAmountCents":12000}]',$1::text,'{"evalSandbox":true}',2)`, [id, owner, vehicle, status, approval]);
        await query(`INSERT INTO ${table('repair_order_events')} (repair_order_id,event_type,actor_type,payload)
            VALUES($1::uuid,'eval_fixture_published','system','{"evalSandbox":true}')`, [id]);
    }
}
