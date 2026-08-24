import {
    EVAL_SANDBOX_CONTACT_ID,
    isEvalSandboxMutatingToolName,
} from './agent-test-tool-policy';

/**
 * Stable catalog identities used only by the evaluation tenant fixture.
 * They are intentionally outside every user-created sequence and every row is
 * tagged `evalSandbox=true`, so setup and cleanup can prove ownership before
 * touching it.
 */
export const EVAL_SANDBOX_FIXTURE_IDS = Object.freeze({
    service: '00000000-0000-4000-8000-00000000b001',
    property: '00000000-0000-4000-8000-00000000b002',
    tourPackage: '00000000-0000-4000-8000-00000000b003',
    tourInventory: '00000000-0000-4000-8000-00000000b004',
    menuItem: '00000000-0000-4000-8000-00000000b005',
    member: '00000000-0000-4000-8000-00000000b006',
    fitnessClass: '00000000-0000-4000-8000-00000000b007',
    course: '00000000-0000-4000-8000-00000000b008',
    cohort: '00000000-0000-4000-8000-00000000b009',
    product: '00000000-0000-4000-8000-00000000b00a',
    vehicle: '00000000-0000-4000-8000-00000000b00b',
    pet: '00000000-0000-4000-8000-00000000b00c',
    boardingService: '00000000-0000-4000-8000-00000000b00d',
    insurancePolicy: '00000000-0000-4000-8000-00000000b00e',
});

type QueryClient = {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function safeSchema(schema: string): string {
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error('invalid_eval_schema');
    return schema;
}

function uuid(value: unknown, fallback: string): string {
    const candidate = String(value || '').trim();
    return UUID_RE.test(candidate) ? candidate : fallback;
}

function date(value: unknown, fallback: string): string {
    const candidate = String(value || '').trim();
    return DATE_RE.test(candidate) ? candidate : fallback;
}

function time(value: unknown, fallback = '10:00'): string {
    const candidate = String(value || '').trim();
    return TIME_RE.test(candidate) ? candidate : fallback;
}

function text(value: unknown, fallback: string, max = 500): string {
    const candidate = String(value || '').trim();
    return (candidate || fallback).slice(0, max);
}

function positiveInt(value: unknown, fallback = 1): number {
    const candidate = Math.floor(Number(value));
    return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function dateSpan(startRaw: unknown, endRaw: unknown): { start: string; end: string; days: number } {
    const start = date(startRaw, '2099-06-01');
    let end = date(endRaw, '2099-06-02');
    const startMs = Date.parse(`${start}T00:00:00Z`);
    let endMs = Date.parse(`${end}T00:00:00Z`);
    if (!Number.isFinite(endMs) || endMs <= startMs) {
        endMs = startMs + 86_400_000;
        end = new Date(endMs).toISOString().slice(0, 10);
    }
    return { start, end, days: Math.max(1, Math.round((endMs - startMs) / 86_400_000)) };
}

function firstRowId(rows: unknown): string | undefined {
    return Array.isArray(rows) ? String((rows[0] as any)?.id || '') || undefined : undefined;
}

/**
 * The only mutation implementation reachable from evalMode.
 *
 * It deliberately depends on SQL only. Domain services, EventEmitter,
 * calendars, providers, queues and notifications are absent from its type, so
 * adding a new writer cannot accidentally inherit a production side effect.
 * The regular authority/confirmation/idempotency preflight still runs before
 * this adapter is called by AIToolExecutorService.
 */
export async function executeEvalSandboxMutation(
    db: QueryClient,
    schemaName: string,
    contactId: string,
    conversationId: string | undefined,
    toolName: string,
    args: Record<string, any>,
): Promise<Record<string, unknown>> {
    if (contactId.toLowerCase() !== EVAL_SANDBOX_CONTACT_ID) {
        return { error: 'eval_sandbox_contact_required', persisted: false };
    }
    if (!isEvalSandboxMutatingToolName(toolName)) {
        return { error: 'eval_writer_not_audited', tool: toolName, persisted: false };
    }
    const schema = safeSchema(schemaName);
    const metadata = JSON.stringify({ evalSandbox: true, tool: toolName });
    const conversation = conversationId && UUID_RE.test(conversationId) ? conversationId : null;
    let rows: unknown;

    switch (toolName) {
        case 'create_appointment': {
            const serviceId = uuid(args.serviceId, EVAL_SANDBOX_FIXTURE_IDS.service);
            const onDate = date(args.date, '2099-06-01');
            const atTime = time(args.time);
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".appointments
                    (contact_id, conversation_id, service_id, service_name, start_at, end_at,
                     status, customer_name, customer_email, customer_phone, notes, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, 'Eval Sandbox Service',
                         ($4 || ' ' || $5)::timestamp, ($4 || ' ' || $5)::timestamp + INTERVAL '30 minutes',
                         'pending', $6, $7, $8, $9, $10::jsonb)
                 RETURNING id::text`,
                contactId, conversation, serviceId, onDate, atTime,
                text(args.customerName, 'Eval Customer', 255),
                text(args.customerEmail, 'eval@example.invalid', 255),
                args.customerPhone ? text(args.customerPhone, '', 50) : null,
                args.notes ? text(args.notes, '', 1000) : null,
                metadata,
            );
            return { success: true, appointmentId: firstRowId(rows), status: 'pending', evalSandbox: true };
        }
        case 'create_property_booking': {
            const span = dateSpan(args.checkIn, args.checkOut);
            const propertyId = uuid(args.propertyId, EVAL_SANDBOX_FIXTURE_IDS.property);
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".property_bookings
                    (property_id, contact_id, conversation_id, guest_name, guest_phone, guests_count,
                     check_in, check_out, nights, status, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::date, $8::date, $9,
                         'pending', $10::jsonb)
                 RETURNING id::text`,
                propertyId, contactId, conversation, text(args.guestName, 'Eval Guest', 255),
                args.guestPhone ? text(args.guestPhone, '', 50) : null,
                positiveInt(args.guests), span.start, span.end, span.days, metadata,
            );
            const id = firstRowId(rows);
            return { success: true, booking: { id, propertyId, status: 'pending' }, evalSandbox: true };
        }
        case 'create_tour_booking': {
            const packageId = uuid(args.packageId, EVAL_SANDBOX_FIXTURE_IDS.tourPackage);
            const partySize = positiveInt(args.partySize);
            const requestedChildren = Math.max(0, Math.floor(Number(args.children) || 0));
            // Keep the canonical party-size invariant even when a model sends
            // inconsistent optional adults/children. Production validates the
            // same equation; the sandbox must never fail for an infrastructure
            // reason unrelated to the expected tool/effect assertion.
            const children = Math.min(partySize, requestedChildren);
            const adults = partySize - children;
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".tour_bookings
                    (package_id, inventory_id, contact_id, conversation_id, guest_name, guest_phone,
                     guest_email, departure_date, departure_time, party_size, adults, children,
                     status, payment_status, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::date, $9::time,
                         $10, $11, $12, 'reserved', 'pending', $13::jsonb)
                 RETURNING id::text`,
                packageId, EVAL_SANDBOX_FIXTURE_IDS.tourInventory, contactId, conversation,
                text(args.guestName, 'Eval Traveller', 255),
                args.guestPhone ? text(args.guestPhone, '', 50) : null,
                args.guestEmail ? text(args.guestEmail, '', 255) : null,
                date(args.departureDate, '2099-06-01'),
                args.departureTime ? time(args.departureTime) : null,
                partySize, adults, children,
                metadata,
            );
            return { success: true, bookingId: firstRowId(rows), status: 'reserved', evalSandbox: true };
        }
        case 'place_order': {
            const orderType = ['delivery', 'pickup', 'dine_in'].includes(args.orderType) ? args.orderType : 'pickup';
            const items = Array.isArray(args.items) && args.items.length ? args.items.slice(0, 20) : [{ name: 'Eval Menu Item', quantity: 1 }];
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".food_orders
                    (contact_id, conversation_id, order_type, customer_name, customer_phone,
                     delivery_address, table_number, status, metadata)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'received',
                         $8::jsonb || jsonb_build_object('items', $9::jsonb))
                 RETURNING id::text`,
                contactId, conversation, orderType, text(args.customerName, 'Eval Customer', 255),
                args.customerPhone ? text(args.customerPhone, '', 50) : null,
                orderType === 'delivery' ? text(args.deliveryAddress, 'Eval Address', 1000) : null,
                orderType === 'dine_in' ? text(args.tableNumber, 'EVAL', 50) : null,
                metadata, JSON.stringify(items),
            );
            return { success: true, orderId: firstRowId(rows), status: 'received', evalSandbox: true };
        }
        case 'book_class': {
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".class_bookings
                    (class_id, member_id, contact_id, status, credits_used, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, 'confirmed', 1, $4::jsonb)
                 ON CONFLICT DO NOTHING RETURNING id::text`,
                uuid(args.classId, EVAL_SANDBOX_FIXTURE_IDS.fitnessClass),
                EVAL_SANDBOX_FIXTURE_IDS.member, contactId, metadata,
            );
            return { success: true, bookingId: firstRowId(rows), status: 'confirmed', evalSandbox: true };
        }
        case 'enroll_student': {
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".enrollments
                    (cohort_id, course_id, contact_id, student_name, student_email, student_phone,
                     status, payment_status, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'enrolled', 'pending', $7::jsonb)
                 RETURNING id::text`,
                uuid(args.cohortId, EVAL_SANDBOX_FIXTURE_IDS.cohort),
                EVAL_SANDBOX_FIXTURE_IDS.course, contactId,
                text(args.studentName, 'Eval Student', 255),
                args.studentEmail ? text(args.studentEmail, '', 255) : null,
                args.studentPhone ? text(args.studentPhone, '', 50) : null,
                metadata,
            );
            return { success: true, enrollmentId: firstRowId(rows), status: 'enrolled', evalSandbox: true };
        }
        case 'create_service_request': {
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".service_requests
                    (contact_id, conversation_id, service_type, urgency, customer_name, customer_phone,
                     address, city, issue_description, preferred_date, preferred_time_window,
                     status, metadata)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::date, $11,
                         'pending', $12::jsonb)
                 RETURNING id::text`,
                contactId, conversation, text(args.serviceType, 'other', 100),
                ['emergencia', 'alta', 'normal', 'flexible'].includes(args.urgency) ? args.urgency : 'normal',
                text(args.customerName, 'Eval Customer', 255),
                args.customerPhone ? text(args.customerPhone, '', 50) : null,
                args.address ? text(args.address, '', 1000) : null,
                args.city ? text(args.city, '', 100) : null,
                args.issueDescription ? text(args.issueDescription, '', 2000) : null,
                args.preferredDate ? date(args.preferredDate, '2099-06-01') : null,
                args.preferredTimeWindow ? text(args.preferredTimeWindow, '', 50) : null,
                metadata,
            );
            return { success: true, requestId: firstRowId(rows), status: 'pending', evalSandbox: true };
        }
        case 'request_photo_quote': {
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".photo_sessions
                    (contact_id, conversation_id, session_type, package_name, client_name, client_phone,
                     scheduled_at, location, status, notes, metadata)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamp, $8, 'requested', $9, $10::jsonb)
                 RETURNING id::text`,
                contactId, conversation, text(args.sessionType, 'other', 50),
                args.packageName ? text(args.packageName, '', 255) : null,
                text(args.customerName, 'Eval Customer', 255),
                args.customerPhone ? text(args.customerPhone, '', 50) : null,
                `${date(args.date, '2099-06-01')} 10:00`,
                args.location ? text(args.location, '', 1000) : null,
                args.specialRequests ? text(args.specialRequests, '', 2000) : null,
                metadata,
            );
            return { success: true, received: true, sessionId: firstRowId(rows), evalSandbox: true };
        }
        case 'create_vehicle_rental':
        case 'create_pet_boarding': {
            const pet = toolName === 'create_pet_boarding';
            const span = dateSpan(args.startDate, args.endDate);
            const resourceId = pet
                ? uuid(args.petId, EVAL_SANDBOX_FIXTURE_IDS.pet)
                : uuid(args.vehicleId, EVAL_SANDBOX_FIXTURE_IDS.vehicle);
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".resource_rentals
                    (rental_type, resource_id, service_id, contact_id, customer_name, customer_phone,
                     start_date, end_date, status, notes, metadata)
                 VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::date, $8::date,
                         'reserved', $9, $10::jsonb)
                 RETURNING id::text`,
                pet ? 'pet_boarding' : 'vehicle_rental', resourceId,
                pet ? uuid(args.serviceId, EVAL_SANDBOX_FIXTURE_IDS.boardingService) : null,
                contactId, pet ? 'Eval Pet Tutor' : text(args.driverName, 'Eval Driver', 255),
                pet ? null : (args.driverPhone ? text(args.driverPhone, '', 50) : null),
                span.start, span.end, args.notes ? text(args.notes, '', 1000) : null, metadata,
            );
            const id = firstRowId(rows);
            return pet
                ? { success: true, boarding: { id, status: 'reserved' }, evalSandbox: true }
                : { success: true, rental: { id, status: 'reserved' }, evalSandbox: true };
        }
        case 'place_catalog_order': {
            const items = Array.isArray(args.items) && args.items.length
                ? args.items.slice(0, 50).map((item: any) => ({
                    productId: uuid(item?.productId, EVAL_SANDBOX_FIXTURE_IDS.product),
                    quantity: positiveInt(item?.quantity),
                }))
                : [{ productId: EVAL_SANDBOX_FIXTURE_IDS.product, quantity: 1 }];
            rows = await db.$queryRawUnsafe(
                `INSERT INTO "${schema}".orders
                    (contact_id, conversation_id, items, total_amount, currency, status,
                     payment_status, notes, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::jsonb, 0, 'COP', 'pending', 'pending', $4, $5::jsonb)
                 RETURNING id::text`,
                contactId, conversation, JSON.stringify(items),
                args.notes ? text(args.notes, '', 1000) : null, metadata,
            );
            return { success: true, orderId: firstRowId(rows), status: 'pending', evalSandbox: true };
        }
        default:
            return { error: 'eval_writer_not_audited', tool: toolName, persisted: false };
    }
}

/** Step-up / human-approved operations cannot complete inside an evaluation identity. */
export function evalIdentityChallengeResult(toolName: string): Record<string, unknown> {
    return {
        error: 'identity_verification_required',
        tool: toolName,
        needsVerification: true,
        outboundSuppressed: true,
        persisted: false,
        evalSandbox: true,
        message: 'Identity step-up is required; evaluation mode never sends or accepts a real verification code.',
    };
}
