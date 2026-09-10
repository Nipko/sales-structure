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
        family: 'appointment_transitions', command: 'bound', charge: 'not_applicable', legacyRows: 'fails_closed',
        evidence: 'schedule_test_drive asserts its own service terms; cancel_appointment and reschedule_appointment go '
            + 'through the shared commitment gate, which rebuilds the appointment, its service and the state it was in '
            + 'when the customer was told what would happen, so a transition across a change is refused. A transition '
            + 'charges nothing itself.',
    }),
    entry({
        family: 'enrollments', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'enrollment terms and their hash are asserted and stored; waitlist promotion refuses to seat when the '
            + 'stored hash no longer matches; enrollmentPriceSql returns NULL for a legacy row.',
    }),
    entry({
        family: 'catalog_orders', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'The agent must supply the catalog terms hash and the accepted terms are stored in '
            + 'orders.catalog_terms; the charge now reads that snapshot through catalogAgreedAmountSql, which yields '
            + 'NULL for a row that agreed to nothing and refuses a cancellation snapshot outright. The live '
            + 'total_amount beside it can move without the charge following, which is the whole point.',
    }),
    entry({
        family: 'repair_orders', command: 'bound', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'approve_repair and cancel_repair_order take an expectedTermsHash and store the acceptance; '
            + 'create_repair_order now goes through the shared commitment gate, which binds the vehicle and the '
            + 'diagnosis-before-quote condition. repair_orders is not a payable kind.',
    }),
    entry({
        family: 'class_bookings', command: 'bound', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'The shared commitment gate rebuilds the class from fitness_classes and binds its schedule, its '
            + 'capacity, the credits it costs and whether it has been cancelled, so a class that moved day or got '
            + 'more expensive in credits is refused. A seat is not a payable kind.',
    }),
    entry({
        family: 'insurance_quotes', command: 'bound', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'The shared commitment gate binds the plan, the premium floor the customer repeats back, the rest of '
            + 'the range, the deductible, what it covers and excludes and the age band. A quote is a number the '
            + 'customer will hold us to even though nothing is charged, so it is frozen like a price.',
    }),
    entry({
        family: 'pets', command: 'not_applicable', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'Registering or correcting a pet record commits no sale. The command is idempotent by request hash, '
            + 'which is a different guarantee from an accepted quote.',
    }),
    entry({
        family: 'property_bookings', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'The shared commitment gate rebuilds the stay from the property and refuses when the nightly rate, '
            + 'the cleaning fee, the dates, the guest count or the deposit policy moved since the guest was told. The '
            + 'charge reads the accepted proposal, so a booking with no acceptance behind it is not payable at all '
            + 'instead of payable at a number the system computed on its own.',
    }),
    entry({
        family: 'tour_bookings', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'The shared commitment gate binds the package, the unit price, the party size, the departure, the '
            + 'cancellation policy and the child discount. The charge reads the accepted proposal behind amount_due, '
            + 'so the deposit still works and a booking nobody agreed to is not payable.',
    }),
    entry({
        family: 'restaurant_orders', command: 'bound', charge: 'bound', legacyRows: 'fails_closed',
        evidence: 'The shared commitment gate binds every menu item, its quantity and its unit price, so a price edit '
            + 'between the menu the customer read and the order is refused rather than applied silently. The writer '
            + 'still recalculates the total from the menu, which protects the arithmetic; the gate protects the '
            + 'agreement, and the charge reads the accepted proposal.',
    }),
    entry({
        family: 'service_requests', command: 'bound', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'The shared commitment gate binds the service, the visit window, its duration and the list price the '
            + 'customer was told it usually costs — as a CONDITION, not a price, because the binding amount comes from '
            + 'the quote a person writes after the visit. Not a payable kind.',
    }),
    entry({
        family: 'photo_sessions', command: 'bound', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'The shared commitment gate binds the service and the session date. No price: the photographer '
            + 'answers with one afterwards, and freezing a zero would put a zero in a till.',
    }),
    entry({
        family: 'resource_rentals', command: 'bound', charge: 'not_applicable', legacyRows: 'not_applicable',
        evidence: 'The shared commitment gate binds both tools against their own catalogue — the vehicle for a rental, '
            + 'the service for a pet boarding — with the window and the vehicle status. Still not payable: the row is '
            + 'born pending_review and a person sets the price, so there is no agreed amount to bind a charge to.',
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
