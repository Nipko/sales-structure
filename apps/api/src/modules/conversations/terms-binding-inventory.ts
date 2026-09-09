import { EVAL_WRITER_SANDBOX_FAMILIES } from './agent-test-tool-policy';

/**
 * Which canonical families bind the terms the customer accepted, and which do
 * not — computed, not remembered.
 *
 * A1 asks for consent and accepted terms bound to the command and to the charge.
 * Four families do it and eleven do not, and the way anybody found that out was
 * by reading fifteen services. "Faltan términos en otras familias" was the
 * shape of the answer, which is the same shape as "otras salidas" was for the
 * retraction sweep: a phrase, not a list.
 *
 * Two independent bindings, because they fail independently:
 *
 *   · COMMAND — the writer refuses to execute unless the agent hands back the
 *     hash of the terms it showed the customer, and it stores the snapshot with
 *     the row. Without it, a catalogue edit between the quote and the booking
 *     silently changes what was agreed;
 *   · CHARGE — the amount taken comes from that stored snapshot rather than from
 *     the live catalogue. Without it, the binding above is decoration: the row
 *     remembers the agreed price and the till reads a different one.
 *
 * `notPayable` is a third answer and not a gap. A family with nothing to charge
 * cannot bind a charge, and marking it `false` would put it in a list of things
 * to fix that can never be fixed.
 */

export const TERMS_BINDING = ['bound', 'partial', 'none', 'not_applicable'] as const;
export type TermsBinding = (typeof TERMS_BINDING)[number];

export interface FamilyTermsBinding {
    /** Key of `EVAL_WRITER_SANDBOX_FAMILIES`. */
    readonly family: string;
    /** Does the writer demand the accepted terms and store them with the row? */
    readonly command: TermsBinding;
    /** Does the amount charged come from that stored snapshot? */
    readonly charge: TermsBinding;
    /** How a row that predates the binding is treated when money is involved. */
    readonly legacyRows: 'fails_closed' | 'fails_open' | 'not_applicable';
    /** Where to look, and what is missing when something is. */
    readonly evidence: string;
}

const entry = (row: FamilyTermsBinding): FamilyTermsBinding => Object.freeze(row);

export const FAMILY_TERMS_BINDINGS: readonly FamilyTermsBinding[] = Object.freeze([
    entry({
        family: 'appointments', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'assertAppointmentServiceTerms inside the effect transaction; metadata.serviceTerms stored with the '
            + 'row; the charge reads appointmentAgreedPriceSql, which yields NULL for a legacy row rather than the '
            + 'catalogue price the customer never saw.',
    }),
    entry({
        family: 'appointment_transitions', command: 'partial', charge: 'not_applicable', legacyRows: 'fails_closed',
        evidence: 'schedule_test_drive asserts the terms and a test-drive edit re-asserts the stored ones; plain '
            + 'cancel_appointment and reschedule_appointment accept no expectedTermsHash, so a reschedule across a '
            + 'price change is not caught. A transition charges nothing itself.',
    }),
    entry({
        family: 'enrollments', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'enrollment terms and their hash are asserted and stored; waitlist promotion refuses to seat when the '
            + 'stored hash no longer matches; enrollmentPriceSql returns NULL for a legacy row.',
    }),
    entry({
        family: 'catalog_orders', command: 'bound', charge: 'none', legacyRows: 'fails_open',
        evidence: 'The agent must supply the catalog terms hash and the accepted terms are stored in the dedicated '
            + 'orders.catalog_terms column — which nothing reads back. The charge takes target.total_amount, a live '
            + 'column, so the snapshot is written and then ignored at the till.',
    }),
    entry({
        family: 'repair_orders', command: 'partial', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'approve_repair and cancel_repair_order take an expectedTermsHash and store the acceptance; '
            + 'create_repair_order takes none. repair_orders is not a payable kind.',
    }),
    entry({
        family: 'class_bookings', command: 'none', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'bookClass takes no accepted terms and stores none, so a price or cancellation rule that changed '
            + 'between the quote and the booking is not caught. Not a payable kind.',
    }),
    entry({
        family: 'insurance_quotes', command: 'none', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'calculate_quote stores no accepted terms; a quote is not itself a payable kind.',
    }),
    entry({
        family: 'pets', command: 'not_applicable', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'Registering or correcting a pet record commits no sale. The command is idempotent by request hash, '
            + 'which is a different guarantee from an accepted quote.',
    }),
    entry({
        family: 'property_bookings', command: 'none', charge: 'none', legacyRows: 'fails_open',
        evidence: 'No accepted terms are demanded or stored, and the charge reads the live night price, cleaning fee '
            + 'and currency from the booking row.',
    }),
    entry({
        family: 'tour_bookings', command: 'none', charge: 'none', legacyRows: 'fails_open',
        evidence: 'No accepted terms are demanded or stored, and the charge reads the live unit and total price '
            + 'from the booking row, so a tariff edit between the quote and the payment moves the amount.',
    }),
    entry({
        family: 'restaurant_orders', command: 'none', charge: 'none', legacyRows: 'fails_open',
        evidence: 'No accepted terms; the charge reads target.total. The writer does recalculate the total from the '
            + 'menu rather than trusting the model, which protects the arithmetic but not the agreement.',
    }),
    entry({
        family: 'service_requests', command: 'none', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'A request for a visit commits no price and stores no accepted terms; the quote comes later, '
            + 'from a person. Not a payable kind.',
    }),
    entry({
        family: 'photo_sessions', command: 'none', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'A quote request commits no price and stores no accepted terms; the photographer answers with '
            + 'one afterwards. Not a payable kind.',
    }),
    entry({
        family: 'resource_rentals', command: 'none', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'Neither the pet boarding nor the vehicle rental demands accepted terms. The vehicle rental is born '
            + 'pending_review and a person sets the price, so there is no agreed amount for a charge to bind to yet.',
    }),
    entry({
        family: 'insurance_claims', command: 'not_applicable', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'file_claim never reaches a writer at all: in an evaluation it exists to prove that the identity '
            + 'step-up refuses it, so there is no command and no charge to bind anything to.',
    }),
]);

/** The families where money can move on terms nobody pinned. */
export function familiesWithUnboundCharge(): readonly FamilyTermsBinding[] {
    return Object.freeze(FAMILY_TERMS_BINDINGS.filter(row => row.charge === 'none' || row.charge === 'partial'));
}

/** The families whose writer will execute without being shown what was agreed. */
export function familiesWithUnboundCommand(): readonly FamilyTermsBinding[] {
    return Object.freeze(FAMILY_TERMS_BINDINGS.filter(row => row.command === 'none' || row.command === 'partial'));
}

/** Every family the registry knows about, so the table cannot fall behind it. */
export function declaredFamilies(): readonly string[] {
    return Object.freeze(Object.keys(EVAL_WRITER_SANDBOX_FAMILIES).sort());
}
