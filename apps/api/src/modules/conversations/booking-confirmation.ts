import { createHash } from 'crypto';
import type { BookingState } from './booking-engine.service';
import { appointmentServiceTermsHash } from '../appointments/appointment-service-terms';

/** A button and a typed confirmation must refer to the same displayed terms. */
export function bookingConfirmationHash(state: BookingState): string {
    const service = state.services?.find(item => item.id === state.serviceId);
    return createHash('sha256').update(JSON.stringify({
        serviceId: state.serviceId, date: state.date, time: state.time,
        staffId: state.staffId || null, name: state.customerName, email: state.customerEmail,
        price: service?.price, currency: service?.currency,
        paymentRequired: service?.requiresPaymentToConfirm === true,
        amountDue: service?.amountDueToConfirm ?? null,
        serviceTerms: appointmentServiceTermsHash(service?.appointmentTerms),
    })).digest('hex');
}
