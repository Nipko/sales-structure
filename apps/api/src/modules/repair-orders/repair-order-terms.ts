import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';

/** Facts proposed to this customer, not a diagnosis or a promise of capacity. */
export interface RepairOrderTerms {
    version: 1;
    action: 'estimate_decision' | 'cancel';
    repairOrderId: string;
    orderVersion: number;
    vehicleId: string;
    vehicle: { make: string; model: string; vin: string | null; licensePlate: string | null };
    status: string;
    estimateAmountCents: string | null;
    currency: string | null;
    estimateLineItems: unknown[];
    estimateNotes: string | null;
    promisedAt: string | null;
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
        .map(key => [key, stable((value as Record<string, unknown>)[key])]));
    return value;
}
export const repairRequestHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

export function repairOrderTerms(row: any, action: RepairOrderTerms['action']): RepairOrderTerms {
    if (!row?.id || !Number.isInteger(row.version) || row.version < 1 || !row.vehicle_id) throw new Error('repair_terms_unavailable');
    const amount = row.estimate_amount_cents == null ? null : String(row.estimate_amount_cents);
    if (amount !== null && !/^\d+$/.test(amount)) throw new Error('repair_terms_unavailable');
    if (action === 'estimate_decision' && (amount === null || !/^[A-Z]{3}$/.test(row.currency || ''))) throw new Error('repair_terms_unavailable');
    return { version: 1, action, repairOrderId: row.id, orderVersion: row.version, vehicleId: row.vehicle_id,
        vehicle: { make: row.make || '', model: row.model || '', vin: row.vin || null, licensePlate: row.license_plate || null },
        status: row.status, estimateAmountCents: amount, currency: row.currency || null,
        estimateLineItems: Array.isArray(row.estimate_line_items) ? row.estimate_line_items : [],
        estimateNotes: row.metadata?.estimateNotes || null,
        promisedAt: row.promised_at ? new Date(row.promised_at).toISOString() : null };
}

export class RepairTermsChangedError extends ConflictException {
    constructor(readonly currentTerms: RepairOrderTerms) {
        super({ error: 'repair_terms_changed', message: 'Repair order terms changed. Review the current version before deciding.' });
    }
}

export function repairTermsReviewResult(terms: RepairOrderTerms, error = 'repair_terms_changed'): Record<string, unknown> {
    return { error, persisted: false, requiresConfirmation: true, retryable: false, repairTerms: terms,
        message: 'Review the exact vehicle, current estimate items, amount, currency and requested decision with the customer. Obtain a new confirmation. No repair action has been completed.' };
}

/** Only reviewed domain messages become customer-safe recovery data. */
export function repairActionErrorResult(error: unknown): Record<string, unknown> | null {
    const message = error instanceof Error ? error.message : '';
    const errors: Record<string, { error: string; message: string; shouldHandoff?: boolean }> = {
        'Repair order can no longer be cancelled by the customer': { error: 'repair_cancellation_not_allowed', message: 'The workshop must review this cancellation because work is already underway or the order is closed. No cancellation or refund was made.', shouldHandoff: true },
        'Repair order not found': { error: 'repair_order_not_found', message: 'No matching order was found for this customer. Ask the customer to identify one of their own orders.' },
        'Repair order idempotency conflict': { error: 'repair_request_changed', message: 'This request reference was already used for different intake details. Review the existing order before starting a new request.' },
        'Vehicle identity conflicts with the registered vehicle': { error: 'repair_vehicle_identity_conflict', message: 'The vehicle details conflict with the registered vehicle. Verify the VIN and plate with the workshop before changing the record.', shouldHandoff: true },
        'Vehicle identity is ambiguous': { error: 'repair_vehicle_identity_conflict', message: 'The VIN and plate match different vehicles. The workshop must review the identity.', shouldHandoff: true },
        'Repair estimate is not awaiting a decision': { error: 'repair_estimate_not_pending', message: 'The order has no estimate awaiting a decision. Read its current status; do not claim approval.' },
        'contact_erased': { error: 'contact_erased', message: 'The contact data was erased. No new operation is permitted for this contact.' },
    };
    return errors[message] ? { ...errors[message], persisted: false, retryable: false } : null;
}
