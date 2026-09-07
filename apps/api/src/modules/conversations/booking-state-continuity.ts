import type { BookingState } from './booking-engine.service';

export const BOOKING_PROPOSAL_TTL_MS = 30 * 60 * 1000;
export const BOOKING_MISSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Keep the customer's mission while expiring the evidence authorizing a write. */
export function restoreBookingMission(
    saved: BookingState | null | undefined,
    savedAt?: string | null,
    now = Date.now(),
): { state: BookingState; requiresRevalidation: boolean } {
    if (!saved?.step || saved.step === 'idle') return { state: { step: 'idle' }, requiresRevalidation: false };
    const stamp = Date.parse(savedAt || saved.savedAt || '');
    const age = now - stamp;
    if (Number.isFinite(age) && age >= 0 && age <= BOOKING_PROPOSAL_TTL_MS) {
        return { state: structuredClone(saved), requiresRevalidation: false };
    }
    if (Number.isFinite(age) && age > BOOKING_MISSION_RETENTION_MS) {
        return { state: { step: 'idle' }, requiresRevalidation: false };
    }
    // No timestamp means no authority to reuse a price, slot or confirmation.
    // A completed appointment remains discoverable through the domain readers.
    if (saved.step === 'booked') return { state: { step: 'idle' }, requiresRevalidation: false };
    const state: BookingState = {
        missionId: saved.missionId,
        step: saved.serviceId ? 'ask_date' : 'show_services',
        serviceId: saved.serviceId, serviceName: saved.serviceName,
        customerName: saved.customerName, customerEmail: saved.customerEmail,
        customerPhone: saved.customerPhone, pausedAt: saved.pausedAt,
        // A desired date is a preference, never availability evidence. The
        // engine re-reads services and slots and obtains a new confirmation.
        date: /^\d{4}-\d{2}-\d{2}$/.test(saved.date || '') ? saved.date : undefined,
        resumedAfterExpiry: true,
    };
    return { state, requiresRevalidation: true };
}
