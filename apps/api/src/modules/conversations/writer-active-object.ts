import {
    deepLinkForActiveObject,
    type ActiveObjectKind,
} from '@parallext/shared';

export interface WriterActiveObjectResult {
    version: 1;
    kind: ActiveObjectKind;
    id: string;
    href: string;
}
export interface WriterObjectDefinition {
    kind: ActiveObjectKind | null;
    resultKeys?: readonly string[];
    argumentKeys?: readonly string[];
}

/**
 * Runtime contract from a successful writer to the human surface that owns
 * the resulting record. This is production code, not a map that exists only
 * inside a coverage test.
 */
export const WRITER_ACTIVE_OBJECTS: Readonly<Record<string, WriterObjectDefinition>> = Object.freeze({
    create_appointment: object('appointment', ['appointmentId', 'appointment.id', 'id']),
    cancel_appointment: object('appointment', ['appointmentId', 'id'], ['appointmentId']),
    reschedule_appointment: object('appointment', ['appointmentId', 'id'], ['appointmentId']),
    place_catalog_order: object('order', ['orderId', 'order.id', 'id']),
    place_order: object('food_order', ['orderId', 'order.id', 'id']),
    cancel_order: object('food_order', ['orderId', 'id'], ['orderId']),
    create_property_booking: object('property_booking', ['bookingId', 'booking.id', 'id']),
    cancel_property_booking: object('property_booking', ['bookingId', 'id'], ['bookingId']),
    create_tour_booking: object('tour_booking', ['bookingId', 'booking.id', 'id']),
    cancel_tour_booking: object('tour_booking', ['bookingId', 'id'], ['bookingId']),
    schedule_test_drive: object('appointment', ['appointmentId', 'bookingId', 'id']),
    enroll_student: object('enrollment', ['enrollmentId', 'enrollment.id', 'id']),
    cancel_enrollment: object('enrollment', ['enrollmentId', 'id'], ['enrollmentId']),
    register_pet: object('pet', ['petId', 'pet.id', 'id']),
    update_pet: object('pet', ['petId', 'pet.id', 'id'], ['petId']),
    book_class: object('class_booking', ['bookingId', 'classBookingId', 'id']),
    cancel_class_booking: object('class_booking', ['bookingId', 'classBookingId', 'id'], ['bookingId']),
    freeze_membership: object('membership', ['membershipId', 'id'], ['membershipId']),
    calculate_quote: object('insurance_quote', ['quoteId', 'quote.id', 'id']),
    cancel_quote: object('insurance_quote', ['quoteId', 'id'], ['quoteId']),
    file_claim: object('insurance_claim', ['claimId', 'claim.id', 'id']),
    create_service_request: object('service_request', ['requestId', 'request.id', 'id']),
    cancel_service_request: object('service_request', ['requestId', 'id'], ['requestId']),
    create_vehicle_rental: object('vehicle_rental', ['rentalId', 'rental.id', 'id']),
    cancel_vehicle_rental: object('vehicle_rental', ['rentalId', 'id'], ['rentalId']),
    create_pet_boarding: object('pet_boarding', ['boardingId', 'rentalId', 'rental.id', 'id']),
    cancel_pet_boarding: object('pet_boarding', ['boardingId', 'rentalId', 'id'], ['boardingId']),
    request_photo_quote: object('photo_session', ['sessionId', 'photoSessionId', 'session.id', 'id']),
    cancel_photo_session: object('photo_session', ['sessionId', 'id'], ['sessionId']),

    ensure_crm_lead: object('crm_lead', ['leadId', 'lead.id', 'id']),
    create_crm_opportunity: object('crm_opportunity', ['opportunityId', 'opportunity.id', 'id']),
    move_crm_opportunity_stage: object('crm_opportunity', ['opportunityId', 'id'], ['opportunityId']),
    create_follow_up_task: object('crm_task', ['taskId', 'task.id', 'id']),
    record_contact_consent: object('consent_record', ['consentId', 'consent.id', 'id']),

    // These mutations deliberately do not create an operational record.
    triage_pet_emergency: none(),
    request_identity_code: none(),
    verify_identity_code: none(),
    get_placement_test_link: none(),
    add_contact_note: none(),
    tag_contact: none(),
    record_contact_interest: none(),
    create_payment_link: none(),
    refund_payment: none(),
    apply_discount: none(),
    send_product_image: none(),
    send_property_image: none(),
    send_listing_image: none(),
    send_vehicle_image: none(),
    send_portfolio: none(),
    send_booking_link: none(),
});

function object(
    kind: ActiveObjectKind,
    resultKeys: readonly string[],
    argumentKeys: readonly string[] = [],
): WriterObjectDefinition {
    return Object.freeze({ kind, resultKeys, argumentKeys });
}

function none(): WriterObjectDefinition {
    return Object.freeze({ kind: null });
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nestedValue(record: Record<string, any>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => (
        isRecord(value) ? value[key] : undefined
    ), record);
}

function firstIdentifier(record: Record<string, any>, keys: readonly string[]): string | null {
    for (const key of keys) {
        const value = nestedValue(record, key);
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function isSuccessfulResult(result: Record<string, any>): boolean {
    if (result.error) return false;
    if (result.success === false || result.ok === false) return false;
    const status = typeof result.status === 'string' ? result.status.toLowerCase() : '';
    return !['failed', 'error', 'rejected'].includes(status);
}

/**
 * Attach a canonical record reference only after a successful handler returned
 * a stable identifier. A vague `{success:true}` never becomes evidence that an
 * object exists.
 */
export function attachWriterActiveObject(
    toolName: string,
    rawResult: unknown,
    args: Record<string, unknown> = {},
): unknown {
    const definition = WRITER_ACTIVE_OBJECTS[toolName];
    if (!definition?.kind || !isRecord(rawResult) || !isSuccessfulResult(rawResult)) {
        return rawResult;
    }
    if (isRecord(rawResult.activeObject)) return rawResult;
    const id = firstIdentifier(rawResult, definition.resultKeys || [])
        || firstIdentifier(args, definition.argumentKeys || []);
    const href = deepLinkForActiveObject(definition.kind);
    if (!id || !href) return rawResult;
    const activeObject: WriterActiveObjectResult = {
        version: 1,
        kind: definition.kind,
        id,
        href,
    };
    return { ...rawResult, activeObject };
}
