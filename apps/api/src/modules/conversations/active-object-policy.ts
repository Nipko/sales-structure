import {
    ACTIVE_OBJECT_KINDS,
    VERTICAL_MANIFEST_INDUSTRIES,
    type ActiveObjectContextItemV1,
    type ActiveObjectKind,
    type VerticalAssuranceLevel,
} from '@parallext/shared';

export interface ActiveObjectExposurePolicy {
    /** bounded_context is an allow-listed projection; tool_only is never pre-injected. */
    mode: 'bounded_context' | 'tool_only';
    minimumAssurance: VerticalAssuranceLevel;
}

export interface ActiveObjectPolicyContext {
    industry?: string | null;
    subtype?: string | null;
}

const BOUNDED_A0: ActiveObjectExposurePolicy = Object.freeze({
    mode: 'bounded_context', minimumAssurance: 'A0',
});
const BOUNDED_A1: ActiveObjectExposurePolicy = Object.freeze({
    mode: 'bounded_context', minimumAssurance: 'A1',
});
const TOOL_ONLY_A2: ActiveObjectExposurePolicy = Object.freeze({
    mode: 'tool_only', minimumAssurance: 'A2',
});

/**
 * Exhaustive kind policy. Sensitive operational records never enter TurnContext;
 * a reviewed tool must enforce the listed assurance level at read time.
 */
export const ACTIVE_OBJECT_EXPOSURE_POLICY: Readonly<Record<ActiveObjectKind, ActiveObjectExposurePolicy>> = Object.freeze({
    appointment: BOUNDED_A1,
    order: BOUNDED_A1,
    food_order: BOUNDED_A1,
    property_booking: BOUNDED_A1,
    tour_booking: BOUNDED_A1,
    treatment_plan: TOOL_ONLY_A2,
    treatment_session: TOOL_ONLY_A2,
    catalog_item: BOUNDED_A0,
    real_estate_listing: BOUNDED_A0,
    vehicle: BOUNDED_A0,
    tour_package: BOUNDED_A0,
    // El alojamiento es dato publico de catalogo, igual que tour_package o vehicle:
    // nombre y id, nada del huesped. La reserva sigue siendo A1.
    property: BOUNDED_A0,
    course: BOUNDED_A0,
    enrollment: BOUNDED_A1,
    professional_case: TOOL_ONLY_A2,
    pet: BOUNDED_A1,
    membership: BOUNDED_A1,
    class_booking: BOUNDED_A1,
    insurance_policy: TOOL_ONLY_A2,
    insurance_claim: TOOL_ONLY_A2,
    insurance_quote: TOOL_ONLY_A2,
    service_request: TOOL_ONLY_A2,
    photo_session: BOUNDED_A1,
    // The lead/opportunity are the current contact's low-risk CRM projection.
    // Internal tasks and consent evidence stay tool-only: staff instructions
    // and legal evidence must not be pre-injected into every model turn.
    crm_lead: BOUNDED_A1,
    crm_opportunity: BOUNDED_A1,
    crm_task: TOOL_ONLY_A2,
    consent_record: TOOL_ONLY_A2,
    // Es el alquiler DEL PROPIO cliente: fechas y estado, nada de un tercero.
    // Mismo nivel que una reserva, que es exactamente lo que es.
    vehicle_rental: BOUNDED_A1,
    pet_boarding: BOUNDED_A1,
    repair_order: BOUNDED_A1,
});

// DELIBERATE PRODUCT DECISIONS, pending owner review:
//   · `moda_belleza` (salon, aesthetics included: `estetica`) is NOT sensitive: its appointments are prompt-visible and, with the
//     same classification, need no code to be seen, cancelled or moved. Aesthetic treatments are close to health care; if the owner
//     decides they must verify, make `isSensitiveAppointmentDomain` read that subtype too; the prompt and the tools follow it.
//   · `otro` IS sensitive: an unclassified business could be a clinic, so it is treated like one until it picks a real business type.
const SENSITIVE_APPOINTMENT_INDUSTRIES = new Set([
    'salud',
    'seguros',
    'finanzas',
    'otro',
]);
const NON_SENSITIVE_PROFESSIONAL_SUBTYPES = new Set(['arquitectos', 'consultores']);
const NON_SENSITIVE_VETERINARY_SUBTYPES = new Set(['peluqueria_canina']);
const CANONICAL_INDUSTRIES = new Set<string>(VERTICAL_MANIFEST_INDUSTRIES);

function normalized(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isSensitiveAppointmentDomain(context?: ActiveObjectPolicyContext): boolean {
    const industry = normalized(context?.industry);
    const subtype = normalized(context?.subtype);
    // Missing, legacy or mistyped industries cannot silently downgrade an
    // appointment to prompt-visible A1 data. Canonicalization must happen
    // before this boundary; unknown values fail closed here.
    if (!industry || !CANONICAL_INDUSTRIES.has(industry)) return true;
    return SENSITIVE_APPOINTMENT_INDUSTRIES.has(industry)
        // Missing/unknown subtypes fail closed: legal/tax and clinical pet
        // appointments cannot become prompt-safe because metadata was absent.
        || (industry === 'servicios_profesionales' && !NON_SENSITIVE_PROFESSIONAL_SUBTYPES.has(subtype))
        || (industry === 'veterinaria' && !NON_SENSITIVE_VETERINARY_SUBTYPES.has(subtype));
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The tenant row's vertical, exactly as stored (legacy and unknown values are preserved so the exposure boundary can fail
 * closed on them). It is the ONE place the vertical is read for the identity decision below: the prompt context, the
 * central guard's per-tool assurance and the transition engine all start from this projection.
 */
export function tenantActiveObjectPolicyContext(tenant: any): ActiveObjectPolicyContext {
    const verticalConfig = isRecord(tenant?.settings?.verticalConfig) ? tenant.settings.verticalConfig : {};
    return {
        industry: verticalConfig.industry || tenant?.industry,
        subtype: verticalConfig.subType || verticalConfig.subtype,
    };
}

/**
 * Whether a contact must verify with an out-of-band code to SEE or ACT ON their own appointments.
 *
 * One rule for every surface: the appointments the prompt may carry (`filterActiveObjectsForPrompt`),
 * `list_customer_appointments`, `get_appointment_details`, `cancel_appointment` and `reschedule_appointment`. A salon, a
 * fitness studio or an architect's office does not need a code; a clinic, an insurer, a bank or a law firm does. Records are
 * always scoped to the contact bound to the conversation either way.
 */
export function appointmentRecordsNeedIdentityCode(context?: ActiveObjectPolicyContext): boolean {
    return activeObjectPolicyFor('appointment', context).minimumAssurance === 'A2';
}

// Runtime assertion protects JavaScript callers and catches drift even if a
// future kind is added without compiling this package in strict mode.
for (const kind of ACTIVE_OBJECT_KINDS) {
    if (!ACTIVE_OBJECT_EXPOSURE_POLICY[kind]) {
        throw new Error(`Missing ActiveObject exposure policy for ${kind}`);
    }
}

export function activeObjectPolicyFor(
    kind: ActiveObjectKind,
    context?: ActiveObjectPolicyContext,
): ActiveObjectExposurePolicy {
    if (kind === 'appointment' && isSensitiveAppointmentDomain(context)) {
        return TOOL_ONLY_A2;
    }
    return ACTIVE_OBJECT_EXPOSURE_POLICY[kind];
}

/**
 * Sensitive records never enter the prompt — not even to say one exists.
 *
 * In a health, legal or clinical-veterinary practice the mere existence of an
 * appointment is information about the person, so the reviewed A2 tool is the
 * only way to read it. The agent's blindness to a booking it just made is real
 * (see FT-7) but the answer is to make that tool REACHABLE — the identity
 * step-up is now published wherever appointments are — not to leak the record
 * into every prompt.
 */
export function filterActiveObjectsForPrompt(
    items: readonly ActiveObjectContextItemV1[],
    context?: ActiveObjectPolicyContext,
): ActiveObjectContextItemV1[] {
    return items.filter((item) => activeObjectPolicyFor(item.kind, context).mode === 'bounded_context');
}
