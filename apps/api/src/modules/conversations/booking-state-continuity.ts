import type { BookingState } from './booking-engine.service';

/** Booking-write tools the model must not use while the mission is only an interest. */
export const TENTATIVE_BOOKING_BLOCKED_TOOLS: ReadonlySet<string> = new Set(['create_appointment', 'reschedule_appointment', 'send_booking_link']);
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
    // `savedAt` is rewritten on every turn, including turns the engine declines
    // (an informational question answered by the model). A dormant mission is
    // therefore bounded by the moment it went dormant, not by the last write.
    // A mission opened by a question and never confirmed with a datum is not a task to resume:
    // past the continuity window it simply expires.
    if (saved.origin === 'question' && !(Number.isFinite(age) && age >= 0 && age <= BOOKING_PROPOSAL_TTL_MS)) {
        return { state: { step: 'idle' }, requiresRevalidation: false };
    }
    const dormantAt = Date.parse(saved.dormantSince || '');
    if (Number.isFinite(dormantAt) && now - dormantAt > BOOKING_MISSION_RETENTION_MS) {
        return { state: { step: 'idle' }, requiresRevalidation: false };
    }
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
        // Past the continuity window the mission is dormant: kept, but the next
        // booking turn asks whether to resume it instead of continuing silently.
        resumeOffer: saved.resumeOffer ?? 'pending',
        dormantSince: saved.dormantSince
            ?? new Date(Number.isFinite(stamp) ? stamp : now).toISOString(),
    };
    return { state, requiresRevalidation: true };
}

/**
 * The mission as the model sees it in `<booking_state>`. A dormant mission (untouched past the
 * continuity window, waiting for the customer to say whether to resume it) is not shown: the
 * model read it as an open task and told the customer "tengo una reserva pendiente" about a
 * service they had only asked about. The engine owns the resume question.
 */
export function projectBookingStateForPrompt(state: BookingState | null | undefined): {
    step: BookingState['step'];
    service?: { id: string; name: string; durationMinutes?: number };
    date?: string;
    slot?: string;
} | undefined {
    if (!state?.step || state.step === 'idle' || state.resumeOffer || state.origin === 'question') return undefined;
    const selected = state.serviceId ? state.services?.find(s => s.id === state.serviceId) : undefined;
    return {
        step: state.step,
        service: state.serviceId ? {
            id: state.serviceId,
            name: state.serviceName || selected?.name || '',
            durationMinutes: selected?.durationMinutes,
        } : undefined,
        date: state.date,
        slot: state.time,
    };
}
